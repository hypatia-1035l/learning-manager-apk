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
}

// Service 当前运行状态
export interface StudyTimerStatus {
  isRunning: boolean
  taskName: string
  objectName: string
  elapsedSeconds: number
}

export interface StudyTimerPlugin {
  start(o: {
    taskName: string
    objectName: string
    elapsedSeconds: number
  }): Promise<void>
  update(o: {
    taskName: string
    objectName: string
    elapsedSeconds: number
  }): Promise<void>
  stop(): Promise<void>
  consumePendingAction(): Promise<StudyTimerPendingAction | null>
  getStatus(): Promise<StudyTimerStatus>
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
): Promise<void> {
  try {
    await StudyTimer.start({ taskName, objectName, elapsedSeconds })
  } catch {
    /* Web 端不支持，静默 */
  }
}

export async function updateStudyTimer(
  taskName: string,
  objectName: string,
  elapsedSeconds: number,
): Promise<void> {
  try {
    await StudyTimer.update({ taskName, objectName, elapsedSeconds })
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
