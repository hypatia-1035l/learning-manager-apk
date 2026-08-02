import { LocalNotifications } from '@capacitor/local-notifications'
import type {
  ReminderConfig,
  Task,
  Sequence,
} from './types'
import {
  getReminderPool,
  pickSequence,
  formatSequenceProgress,
} from './store'

// 通知 ID 命名空间：1 起递增，用于窗口内多次提醒
export const NOTIF_ID_BASE = 1

// ===== 会话状态 + 冷却管理 =====
// 学习会话活跃时抑制提醒；会话结束后开始冷却
// sessionActive 持久化到 localStorage，App 重启后可恢复，避免 Service 在跑但前端认为未开始导致提醒误触发
let sessionActive = false
let cooldownUntil = 0 // 时间戳：在此时间之前不触发提醒

const COOLDOWN_KEY = 'learning-manager:cooldown-until'
const SESSION_ACTIVE_KEY = 'learning-manager:session-active'

// 初始化：从 localStorage 恢复冷却截止时间和会话活跃状态
try {
  const raw = localStorage.getItem(COOLDOWN_KEY)
  if (raw) {
    const ts = Number(raw)
    if (!isNaN(ts) && ts > Date.now()) {
      cooldownUntil = ts
    }
  }
  // 恢复会话活跃状态：上次 App 被杀时若仍在计时，启动时也认为活跃
  const sessRaw = localStorage.getItem(SESSION_ACTIVE_KEY)
  if (sessRaw === '1') {
    sessionActive = true
  }
} catch {
  /* ignore */
}

// 会话结束回调：App 注册后用于会话结束时重新调度提醒
let onSessionEndCallback: (() => void) | null = null

// 注册会话结束回调（App 启动时调用）
export function registerSessionEndCallback(cb: () => void): () => void {
  onSessionEndCallback = cb
  return () => {
    if (onSessionEndCallback === cb) onSessionEndCallback = null
  }
}

// 查询当前会话活跃状态（App 启动时用于判断是否需要恢复计时界面）
export function isSessionActive(): boolean {
  return sessionActive
}

// 标记学习会话活跃状态
// active=true 时取消所有待触发提醒（计时中不触发）
// active=false 时设置冷却并触发重新调度
export async function setSessionActive(active: boolean): Promise<void> {
  const wasActive = sessionActive
  sessionActive = active
  try {
    localStorage.setItem(SESSION_ACTIVE_KEY, active ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (active) {
    // 进入计时：取消所有待触发提醒
    await cancelAllReminders()
  } else if (wasActive) {
    // 从计时中退出：触发回调让 App 重新调度（回调中会设置冷却 + scheduleReminders）
    if (onSessionEndCallback) onSessionEndCallback()
  }
}

// 会话结束时设置冷却并重新调度（由 App 回调中调用）
export async function endSessionAndReschedule(
  tasks: Task[],
  reminder: ReminderConfig,
): Promise<void> {
  setCooldown(reminder.cooldownMinutes)
  await scheduleReminders(tasks, reminder)
}

// 设置冷却截止时间（延迟/忽略/会话结束时调用）
// cooldownMinutes: 冷却分钟数
export function setCooldown(cooldownMinutes: number): void {
  cooldownUntil = Date.now() + Math.max(cooldownMinutes, 1) * 60 * 1000
  try {
    localStorage.setItem(COOLDOWN_KEY, String(cooldownUntil))
  } catch {
    /* ignore */
  }
}

// 获取当前冷却截止时间
export function getCooldownUntil(): number {
  return cooldownUntil
}

// ---------- 权限 ----------
// 请求通知权限（Android 13+ 需运行时申请）
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'granted') return true
    const req = await LocalNotifications.requestPermissions()
    return req.display === 'granted'
  } catch {
    // Web 端或无通知权限时静默失败
    return false
  }
}

// ---------- 通知内容构建 ----------
// 数据来源由「Task + 当前 object」改为「Task + Sequence（学习序列）」
// 展示语义：学习方向 / 当前序列 / 进度
// 注：仅替换数据来源，通知展示逻辑不变。
function buildBody(task: Task, seq: Sequence | null): string {
  const lines = ['该摸一条鱼了：', `学习方向：${task.name}`]
  if (seq) {
    lines.push(`当前序列：${seq.name}`)
    lines.push(`进度：${formatSequenceProgress(seq)}`)
  }
  return lines.join('\n')
}

// ---------- 按权重随机选任务 ----------
// 完全随机，但权重仍参与计算（weight 越大越易被选中）
function pickWeightedTask(pool: Task[]): Task {
  const weighted = pool.filter((t) => t.weight > 0)
  if (weighted.length === 0) {
    // 全部权重为 0：等概率随机
    return pool[Math.floor(Math.random() * pool.length)]
  }
  const total = weighted.reduce((s, t) => s + t.weight, 0)
  let r = Math.random() * total
  for (const t of weighted) {
    r -= t.weight
    if (r <= 0) return t
  }
  return weighted[weighted.length - 1]
}

// ---------- 调度提醒 ----------
// 统一逻辑：
//   - intervalMinutes > 0：按固定间隔调度，每次按权重随机选任务
//   - intervalMinutes == 0：在窗口内随机时机提醒，每次按权重随机选任务
// 冷却时间 cooldownMinutes 用于避免提醒过于频繁（两次提醒最小间隔）
// 会话活跃时不调度（由 setSessionActive 取消）；冷却期内跳过
export async function scheduleReminders(
  tasks: Task[],
  reminder: ReminderConfig,
): Promise<void> {
  // 会话活跃时不调度（计时中不触发提醒）
  if (sessionActive) return

  // 先取消旧的
  await cancelAllReminders()
  if (!reminder.enabled) return

  // 提醒池为空不调度
  const pool = getReminderPool(tasks, reminder)
  if (pool.length === 0) return

  const now = new Date()
  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  // 当前已超出窗口（如夜间），则只调度下一次窗口开始时的一次提醒
  const inWindow = isInWindow(minuteOfDay, reminder.startMinute, reminder.endMinute)
  if (!inWindow) {
    await scheduleNextWindowStart(reminder)
    return
  }

  // 计算窗口结束时间
  const end = new Date()
  end.setHours(Math.floor(reminder.endMinute / 60), reminder.endMinute % 60, 0, 0)
  if (end <= now) end.setDate(end.getDate() + 1)

  // 间隔：>0 用固定间隔；==0 用随机间隔（窗口内 3-5 次）
  const intervalMs = reminder.intervalMinutes * 60 * 1000
  const cooldownMs = Math.max(reminder.cooldownMinutes, 1) * 60 * 1000

  // 冷却截止时间：在此时间之前不安排提醒
  const cooldownEnd = Math.max(cooldownUntil, 0)

  const notifications = []
  let at = new Date(now.getTime())
  let i = 0

  if (reminder.intervalMinutes > 0) {
    // 固定间隔模式：第一次提醒在 now + intervalMs，但如果在冷却期内则推后到冷却结束
    let firstAt = new Date(now.getTime() + intervalMs)
    if (cooldownEnd > firstAt.getTime()) {
      firstAt = new Date(cooldownEnd)
    }
    at = firstAt
    while (at < end && i < 50) {
      if (isInWindow(at.getHours() * 60 + at.getMinutes(), reminder.startMinute, reminder.endMinute)) {
        const task = pickWeightedTask(pool)
        // 选定学习方向后，再从其下选一个具体序列（保留原随机算法，仅替换数据来源）
        const seq = pickSequence(task)
        notifications.push({
          id: NOTIF_ID_BASE + i,
          title: '今天摸啥鱼',
          body: buildBody(task, seq),
          schedule: { at },
          extra: { taskId: task.id, sequenceId: seq?.id ?? null },
        })
        i++
      }
      at = new Date(at.getTime() + intervalMs)
    }
  } else {
    // 随机模式：在窗口内安排若干次提醒
    // 起始时间：冷却结束后的时间
    if (cooldownEnd > at.getTime()) {
      at = new Date(cooldownEnd)
    }
    const windowMs = end.getTime() - at.getTime()
    if (windowMs <= 0) {
      await scheduleNextWindowStart(reminder)
      return
    }
    const targetCount = Math.min(
      5,
      Math.max(1, Math.floor(windowMs / Math.max(cooldownMs, 30 * 60 * 1000))),
    )
    for (let k = 0; k < targetCount; k++) {
      // 在剩余窗口时间内随机取一个时间点
      const remaining = end.getTime() - at.getTime()
      if (remaining <= cooldownMs) break
      const offset = Math.random() * (remaining - cooldownMs)
      const fireAt = new Date(at.getTime() + offset)
      if (!isInWindow(fireAt.getHours() * 60 + fireAt.getMinutes(), reminder.startMinute, reminder.endMinute)) {
        continue
      }
      const task = pickWeightedTask(pool)
      const seq = pickSequence(task)
      notifications.push({
        id: NOTIF_ID_BASE + i,
        title: '今天摸啥鱼',
        body: buildBody(task, seq),
        schedule: { at: fireAt },
        extra: { taskId: task.id, sequenceId: seq?.id ?? null },
      })
      i++
      // 下一次提醒至少在冷却时间之后
      at = new Date(fireAt.getTime() + cooldownMs)
    }
  }

  if (notifications.length === 0) {
    await scheduleNextWindowStart(reminder)
    return
  }
  try {
    await LocalNotifications.schedule({ notifications })
  } catch {
    /* ignore */
  }
}

// 窗口判断：start <= end 时正常区间；start > end 时跨午夜
// 参数均为"当天分钟数"（0-1439）
function isInWindow(minuteOfDay: number, start: number, end: number): boolean {
  if (start <= end) return minuteOfDay >= start && minuteOfDay < end
  return minuteOfDay >= start || minuteOfDay < end
}

// 计算下一次窗口开始时间
function nextWindowStart(reminder: ReminderConfig): Date {
  const now = new Date()
  const next = new Date(now)
  next.setHours(Math.floor(reminder.startMinute / 60), reminder.startMinute % 60, 0, 0)
  if (next <= now) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

async function scheduleNextWindowStart(reminder: ReminderConfig) {
  const at = nextWindowStart(reminder)
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIF_ID_BASE,
          title: '今天摸啥鱼',
          body: '新的一天，准备好开始摸鱼了吗？',
          schedule: { at },
          extra: { taskId: null },
        },
      ],
    })
  } catch {
    /* ignore */
  }
}

// ---------- 下次提醒预览 ----------
// 计算下次提醒的预计触发时间（用于 UI 预览，不实际调度）
// 返回 { at: Date, mode: 'fixed' | 'random' | 'windowStart' } 或 null
export interface NextReminderPreview {
  at: Date
  mode: 'fixed' | 'random' | 'windowStart'
}
export function getNextReminderPreview(
  tasks: Task[],
  reminder: ReminderConfig,
): NextReminderPreview | null {
  if (!reminder.enabled) return null
  const pool = getReminderPool(tasks, reminder)
  if (pool.length === 0) return null

  const now = new Date()
  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  const inWindow = isInWindow(minuteOfDay, reminder.startMinute, reminder.endMinute)

  if (!inWindow) {
    return { at: nextWindowStart(reminder), mode: 'windowStart' }
  }

  const cooldownEnd = Math.max(cooldownUntil, now.getTime())
  if (reminder.intervalMinutes > 0) {
    const intervalMs = reminder.intervalMinutes * 60 * 1000
    let firstAt = now.getTime() + intervalMs
    if (cooldownEnd > firstAt) firstAt = cooldownEnd
    return { at: new Date(firstAt), mode: 'fixed' }
  }
  // 随机模式：返回冷却结束时间作为最早可能时间
  return { at: new Date(cooldownEnd), mode: 'random' }
}

// ---------- 立即测试提醒 ----------
// 5 秒后发送一条测试通知，用于验证权限与通道
export async function sendTestReminder(): Promise<void> {
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 99,
          title: '今天摸啥鱼',
          body: '这是一条测试提醒，证明通知通道工作正常。',
          schedule: { at: new Date(Date.now() + 5000) },
          extra: { taskId: null },
        },
      ],
    })
  } catch {
    /* ignore */
  }
}

// ---------- 取消 ----------
export async function cancelAllReminders() {
  try {
    await LocalNotifications.cancel({
      notifications: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })),
    })
  } catch {
    /* ignore */
  }
}

// ---------- 通知点击监听 ----------
// 通知点击动作信息
export interface NotificationAction {
  taskId: string | null
  randomStart?: boolean // 是否触发随机开始
}

// 监听通知点击，返回动作信息（taskId + 额外标识）
export function onNotificationClick(
  cb: (action: NotificationAction) => void,
): () => void {
  let attached = false
  try {
    const handle = async (event: {
      notification?: { extra?: Record<string, unknown> }
    }) => {
      const extra = event?.notification?.extra ?? {}
      cb({
        taskId: (extra.taskId as string | null) ?? null,
      })
    }
    // Capacitor 的 addListener 返回 Promise<PluginListenerHandle>
    LocalNotifications.addListener(
      'localNotificationActionPerformed',
      handle as Parameters<typeof LocalNotifications.addListener>[1],
    ).then(() => {
      attached = true
    })
    return () => {
      if (attached) {
        LocalNotifications.removeAllListeners().catch(() => {})
      }
    }
  } catch {
    return () => {}
  }
}
