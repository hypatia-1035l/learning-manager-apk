import type { PluginListenerHandle } from '@capacitor/core'
import { registerPlugin } from '@capacitor/core'

// 通知按钮动作
export type StudyTimerAction = 'complete' | 'end'

// Native 侧暂存的 pending action（冷启动恢复用）
export interface StudyTimerPendingAction {
  action: 'complete' | 'end'
  taskName: string
  objectName: string
  elapsedSeconds: number
  // 写入时刻（ms）：用于丢弃过期动作。旧版本原生端不返回，视为未知（不过期）
  savedAt?: number
}

// Service 当前运行状态
export interface StudyTimerStatus {
  isRunning: boolean
  taskName: string
  objectName: string
  elapsedSeconds: number
}

// 越界管控配置：随 start 一并传给原生前台服务，用于后台轮询检测跑偏
// level：off 不检测 / warn 只提醒 / pull 拉回（需悬浮窗权限，未授权原生侧降级为 warn）
export interface StudyTimerGuard {
  level: 'off' | 'warn' | 'pull'
  // 宽限时间（秒）：离开放行集合超过这么久才动作
  graceSeconds: number
  // 最终放行集合（全局白名单 ∪ 方向额外放行）。自动放行项由原生侧自行叠加：
  // 本 App / 桌面 / 输入法 / 默认拨号 / systemui —— 这些 JS 侧拿不到，必须原生算。
  allowedApps: string[]
}

export interface StudyTimerPlugin {
  start(o: {
    taskName: string
    objectName: string
    elapsedSeconds: number
    // 当前进度节点名（序列配了 progressNodes 且为数量型时才有值；空则通知不显示节点）
    nodeLabel?: string
    // 越界管控配置（扁平传参，与原生 StudyTimerPlugin.start 读取一致）
    guardLevel?: 'off' | 'warn' | 'pull'
    guardGraceSeconds?: number
    allowedApps?: string[]
  }): Promise<void>
  update(o: {
    taskName: string
    objectName: string
    elapsedSeconds: number
    nodeLabel?: string
  }): Promise<void>
  stop(): Promise<void>
  consumePendingAction(): Promise<StudyTimerPendingAction | null>
  // 只读取不清除：启动时判断能否直接恢复到结束页（真正消费仍在 LearningSession）
  peekPendingAction(): Promise<StudyTimerPendingAction | null>
  getStatus(): Promise<StudyTimerStatus>
  // 判定日志（B2）：返回 JSON 字符串，字段形状在 JS 侧解析
  getGuardLog(): Promise<{ json?: string }>
  clearGuardLog(): Promise<void>
  addListener(
    eventName: 'studyTimerAction',
    listener: (data: { action: StudyTimerAction }) => void,
  ): Promise<PluginListenerHandle>
}

export const StudyTimer = registerPlugin<StudyTimerPlugin>('StudyTimer')

// ---------- 便捷封装 ----------
// Web 端所有调用静默失败（不支持）

export async function startStudyTimer(
  taskName: string,
  objectName: string,
  elapsedSeconds: number = 0,
  guard?: StudyTimerGuard,
  nodeLabel?: string,
): Promise<void> {
  try {
    // 展开为扁平参数以匹配原生 StudyTimerPlugin.start 的读取
    await StudyTimer.start({
      taskName,
      objectName,
      elapsedSeconds,
      nodeLabel,
      guardLevel: guard?.level ?? 'off',
      guardGraceSeconds: guard?.graceSeconds ?? 5,
      allowedApps: guard?.allowedApps ?? [],
    })
  } catch {
    /* Web 端不支持，静默 */
  }
}

export async function updateStudyTimer(
  taskName: string,
  objectName: string,
  elapsedSeconds: number,
  nodeLabel?: string,
): Promise<void> {
  try {
    await StudyTimer.update({ taskName, objectName, elapsedSeconds, nodeLabel })
  } catch {
    /* ignore */
  }
}

export async function stopStudyTimer(): Promise<void> {
  try {
    await StudyTimer.stop()
  } catch {
    /* ignore */
  }
}

// 读取并清除 Native 侧暂存的 pending action（冷启动恢复用）
export async function consumePendingAction(): Promise<StudyTimerPendingAction | null> {
  try {
    const r = await StudyTimer.consumePendingAction()
    if (r && r.action) return r
    return null
  } catch {
    return null
  }
}

// 读取 Native 侧暂存的 pending action（不清除）；仅用于启动时决定是否直接进会话
export async function peekPendingAction(): Promise<StudyTimerPendingAction | null> {
  try {
    const r = await StudyTimer.peekPendingAction()
    if (r && r.action) return r
    return null
  } catch {
    return null
  }
}

// 查询 Service 当前运行状态（用于检测 WebView 被杀后 Service 是否仍在运行）
export async function getStudyTimerStatus(): Promise<StudyTimerStatus | null> {
  try {
    return await StudyTimer.getStatus()
  } catch {
    return null
  }
}

// 监听通知按钮动作（Activity 在前台时即时回调）
export function onStudyTimerAction(
  cb: (action: StudyTimerAction) => void,
): () => void {
  let handle: PluginListenerHandle | null = null
  let attached = false
  try {
    const p = StudyTimer.addListener('studyTimerAction', (data: { action: StudyTimerAction }) => {
      cb(data?.action ?? 'end')
    })
    if (p && typeof (p as Promise<PluginListenerHandle>).then === 'function') {
      ;(p as Promise<PluginListenerHandle>).then((h) => {
        handle = h
        attached = true
      })
    } else {
      handle = p as unknown as PluginListenerHandle
      attached = true
    }
  } catch {
    /* ignore */
  }
  return () => {
    if (attached && handle) {
      handle.remove().catch(() => {})
    }
  }
}

// ---------- 判定日志（B2） ----------
// 原生只在这两个时机写一条，避免 3 秒一条把日志变成噪声：
//   away    = 刚发现前台不在放行集合（本轮越界的起点）
//   trigger = 超过宽限、且真的发出了提醒
// 用途：误报率要有数据可看，不靠感觉。
export interface GuardLogEntry {
  ts: number
  pkg: string
  verdict: 'away' | 'trigger'
  awayMs: number
}

/** 读取判定日志（最新在后）；Web 端 / 读失败返回空数组 */
export async function readGuardLog(): Promise<GuardLogEntry[]> {
  try {
    const r = await StudyTimer.getGuardLog()
    const raw = r?.json
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const out: GuardLogEntry[] = []
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      if (typeof o.ts !== 'number' || typeof o.pkg !== 'string') continue
      out.push({
        ts: o.ts,
        pkg: o.pkg,
        verdict: o.verdict === 'trigger' ? 'trigger' : 'away',
        awayMs: typeof o.awayMs === 'number' ? o.awayMs : 0,
      })
    }
    return out
  } catch {
    return []
  }
}

/** 清空判定日志（只清日志，不动计时状态） */
export async function clearGuardLog(): Promise<void> {
  try {
    await StudyTimer.clearGuardLog()
  } catch {
    /* ignore */
  }
}
