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
export async function scheduleReminders(
  tasks: Task[],
  reminder: ReminderConfig,
): Promise<void> {
  // 先取消旧的
  await cancelAllReminders()
  if (!reminder.enabled) return

  // 提醒池为空不调度
  const pool = getReminderPool(tasks, reminder)
  if (pool.length === 0) return

  const now = new Date()
  const hour = now.getHours()
  // 当前已超出窗口（如夜间），则只调度下一次窗口开始时的一次提醒
  const inWindow = isInWindow(hour, reminder.startHour, reminder.endHour)
  if (!inWindow) {
    await scheduleNextWindowStart(reminder)
    return
  }

  // 计算窗口结束时间
  const end = new Date()
  end.setHours(reminder.endHour, 0, 0, 0)
  if (end <= now) end.setDate(end.getDate() + 1)

  // 间隔：>0 用固定间隔；==0 用随机间隔（窗口内 3-5 次）
  const intervalMs = reminder.intervalMinutes * 60 * 1000
  const cooldownMs = Math.max(reminder.cooldownMinutes, 1) * 60 * 1000

  const notifications = []
  let at = new Date(now.getTime())
  let i = 0

  if (reminder.intervalMinutes > 0) {
    // 固定间隔模式
    at = new Date(now.getTime() + intervalMs)
    while (at < end && i < 50) {
      if (isInWindow(at.getHours(), reminder.startHour, reminder.endHour)) {
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
    const windowMs = end.getTime() - now.getTime()
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
      if (!isInWindow(fireAt.getHours(), reminder.startHour, reminder.endHour)) {
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
function isInWindow(hour: number, start: number, end: number): boolean {
  if (start <= end) return hour >= start && hour < end
  return hour >= start || hour < end
}

// 计算下一次窗口开始时间
function nextWindowStart(reminder: ReminderConfig): Date {
  const now = new Date()
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  next.setHours(reminder.startHour)
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
  action?: string // 通知类型标识（如 'slacking'）
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
        action: extra.action as string | undefined,
        randomStart: extra.randomStart as boolean | undefined,
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
