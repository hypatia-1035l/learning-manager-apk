import { LocalNotifications } from '@capacitor/local-notifications'
import type {
  ReminderConfig,
  Task,
  Sequence,
  TimeWindow,
} from './types'
import {
  getReminderPool,
  getReminderPoolForWindow,
  isWindowActiveOnWeekday,
  pickSequence,
  formatSequenceProgress,
  isMinuteInAnyWindow,
  getReminderFiredToday,
  incrementReminderFiredToday,
  getLastSessionEnd,
} from './store'
import {
  isNativeNotificationsAvailable,
  scheduleNative,
  cancelAllNative,
  canScheduleExactAlarmsNative,
  type NotifItem,
} from './studyNotifications'

// 通知 ID 命名空间：1 起递增，用于窗口内多次提醒
// 99 用作测试提醒 ID
export const NOTIF_ID_BASE = 1
export const NOTIF_ID_TEST = 99
export const NOTIF_ID_MAX = 120

// ===== 会话状态 + 冷却管理 =====
let sessionActive = false
let cooldownUntil = 0

const COOLDOWN_KEY = 'learning-manager:cooldown-until'
const SESSION_ACTIVE_KEY = 'learning-manager:session-active'

try {
  const raw = localStorage.getItem(COOLDOWN_KEY)
  if (raw) {
    const ts = Number(raw)
    if (!isNaN(ts) && ts > Date.now()) {
      cooldownUntil = ts
    }
  }
  const sessRaw = localStorage.getItem(SESSION_ACTIVE_KEY)
  if (sessRaw === '1') {
    sessionActive = true
  }
} catch {
  /* ignore */
}

let onSessionEndCallback: (() => void) | null = null

export function registerSessionEndCallback(cb: () => void): () => void {
  onSessionEndCallback = cb
  return () => {
    if (onSessionEndCallback === cb) onSessionEndCallback = null
  }
}

export function isSessionActive(): boolean {
  return sessionActive
}

export async function setSessionActive(active: boolean): Promise<void> {
  const wasActive = sessionActive
  sessionActive = active
  try {
    localStorage.setItem(SESSION_ACTIVE_KEY, active ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (active) {
    await cancelAllReminders()
  } else if (wasActive) {
    if (onSessionEndCallback) onSessionEndCallback()
  }
}

export async function endSessionAndReschedule(
  tasks: Task[],
  reminder: ReminderConfig,
): Promise<void> {
  setCooldown(reminder.cooldownMinutes)
  await scheduleReminders(tasks, reminder)
}

export function setCooldown(cooldownMinutes: number): void {
  cooldownUntil = Date.now() + Math.max(cooldownMinutes, 1) * 60 * 1000
  try {
    localStorage.setItem(COOLDOWN_KEY, String(cooldownUntil))
  } catch {
    /* ignore */
  }
}

export function getCooldownUntil(): number {
  return cooldownUntil
}

// ---------- 精确闹钟权限降级标记 ----------
let exactAlarmDegraded = false

// 原生通道未获精确闹钟授权时，提醒会降级为不精确定时（可能漂移）。
// 由 scheduleReminders 在调原生前探测并写入；UI 可读取后提示用户去授权。
export function isExactAlarmDegraded(): boolean {
  return exactAlarmDegraded
}

// ---------- 权限 ----------
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'granted') return true
    const req = await LocalNotifications.requestPermissions()
    return req.display === 'granted'
  } catch {
    return false
  }
}

// ---------- 通知动作注册（用于通知卡片上的按钮）----------
// actionId 约定（原生端由 StudyNotificationActionReceiver / StudyNotificationPlugin 构建对应 PendingIntent）：
//   'start'   → 开始：打开 App，弹出操作弹窗 / 进入会话
//   'reroll'  → 换一个：打开 App，重新随机抽一个任务
//   'cancel'  → 取消：不打开 App，仅进入冷却（原生广播处理）
let actionsRegistered = false
export async function ensureNotificationActionsRegistered(): Promise<void> {
  if (actionsRegistered) return
  actionsRegistered = true
  try {
    // Web/iOS 走 Capacitor；Android 实际由原生插件构建按钮（3 个：开始/换一个/取消）
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'REMINDER_WITH_ACTIONS',
          actions: [
            { id: 'start', title: '开始', destructive: false, input: false, foreground: true },
            { id: 'reroll', title: '换一个', destructive: false, input: false, foreground: true },
            { id: 'cancel', title: '取消', destructive: true, input: false, foreground: false },
          ],
        },
      ],
    })
  } catch {
    /* 插件端不支持或 Web 端，静默降级 */
  }
}

// ---------- 通知内容构建 ----------
function buildBody(task: Task, seq: Sequence | null): string {
  const lines = ['该摸一条鱼了：', `学习方向：${task.name}`]
  if (seq) {
    lines.push(`当前序列：${seq.name}`)
    lines.push(`进度：${formatSequenceProgress(seq)}`)
  }
  return lines.join('\n')
}

// ---------- 按权重随机选任务 ----------
function pickWeightedTask(pool: Task[]): Task {
  const weighted = pool.filter((t) => t.weight > 0)
  if (weighted.length === 0) {
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

// ---------- 多窗口 + 星期的下一次"窗口开始"计算 ----------
// 找出 now 之后第一个窗口的起点
//   - 考虑今天剩余窗口、跨夜、明天起的窗口
//   - 每段窗口可单独绑 weekdays；未绑则用全局 enabledWeekdays
function nextWindowStartAfter(tasks: Task[], reminder: ReminderConfig, from: Date): Date {
  const windows: TimeWindow[] = reminder.windows.length ? reminder.windows : [{ startMinute: 9 * 60, endMinute: 22 * 60 }]
  // 枚举今天到未来 7 天的每一天，找到最早命中 weekday 且存在窗口起点 > from
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + dayOffset)
    const dow = d.getDay()
    for (const w of windows) {
      // 窗口独立星期优先，否则全局
      if (!isWindowActiveOnWeekday(w, dow, reminder.enabledWeekdays)) continue
      const candidate = new Date(d)
      candidate.setHours(Math.floor(w.startMinute / 60), w.startMinute % 60, 0, 0)
      if (candidate.getTime() > from.getTime()) {
        // 同时要求该窗口在当天有可用的任务池（避免排到"空池窗口"）
        const poolW = getReminderPoolForWindow(tasks, reminder, w)
        if (poolW.length > 0) return candidate
      }
    }
  }
  // 兜底：1 小时后
  return new Date(from.getTime() + 60 * 60 * 1000)
}

// 找出 now 之后第一个窗口的结束时间（用于在当前窗口内安排提醒时的"上界"）
// 若 now 在某个窗口内，返回该窗口的结束点；否则返回 nextWindowStart 后的窗口结束点
function nextWindowEndAfter(tasks: Task[], reminder: ReminderConfig, from: Date): { endAt: Date; inWindowNow: boolean } {
  const windows: TimeWindow[] = reminder.windows.length ? reminder.windows : [{ startMinute: 9 * 60, endMinute: 22 * 60 }]
  const fromMinute = from.getHours() * 60 + from.getMinutes()
  const fromDow = from.getDay()
  if (isMinuteInAnyWindow(fromMinute, windows)) {
    // 在某段窗口内：找到当前命中的窗口，返回其结束点（跨夜时为次日）
    for (const w of windows) {
      if (isMinuteInWindow(fromMinute, w.startMinute, w.endMinute)) {
        // 命中窗口还需 weekday 生效（独立星期或全局）
        if (!isWindowActiveOnWeekday(w, fromDow, reminder.enabledWeekdays)) continue
        const end = new Date(from)
        const eh = Math.floor(w.endMinute / 60)
        const em = w.endMinute % 60
        if (w.startMinute <= w.endMinute) {
          end.setHours(eh, em, 0, 0)
        } else {
          // 跨夜：结束时间在次日
          end.setDate(end.getDate() + 1)
          end.setHours(eh, em, 0, 0)
        }
        return { endAt: end, inWindowNow: true }
      }
    }
  }
  // 不在窗口：nextWindowStart 对应的窗口结束
  const start = nextWindowStartAfter(tasks, reminder, from)
  const startMinuteLocal = start.getHours() * 60 + start.getMinutes()
  for (const w of windows) {
    if (w.startMinute === startMinuteLocal) {
      const end = new Date(start)
      const eh = Math.floor(w.endMinute / 60)
      const em = w.endMinute % 60
      if (w.startMinute <= w.endMinute) {
        end.setHours(eh, em, 0, 0)
      } else {
        end.setDate(end.getDate() + 1)
        end.setHours(eh, em, 0, 0)
      }
      return { endAt: end, inWindowNow: false }
    }
  }
  const end = new Date(start.getTime() + 13 * 60 * 60 * 1000)
  return { endAt: end, inWindowNow: false }
}

// 单窗口判定函数（兼容 windows 中 start>end 跨午夜）
function isMinuteInWindow(
  minuteOfDay: number,
  startMinute: number,
  endMinute: number,
): boolean {
  if (startMinute <= endMinute) return minuteOfDay >= startMinute && minuteOfDay < endMinute
  return minuteOfDay >= startMinute || minuteOfDay < endMinute
}

// 日期命中提醒（weekday + date 层面）
// 逐窗口判断：fireAt 落在哪段窗口，就用该窗口的 weekdays；窗口未绑则用全局
function isReminderActiveAt(tasks: Task[], reminder: ReminderConfig, d: Date): boolean {
  const minute = d.getHours() * 60 + d.getMinutes()
  const dow = d.getDay()
  for (const w of reminder.windows.length ? reminder.windows : [{ startMinute: 9 * 60, endMinute: 22 * 60 }]) {
    if (isMinuteInWindow(minute, w.startMinute, w.endMinute) &&
        isWindowActiveOnWeekday(w, dow, reminder.enabledWeekdays)) {
      // 还需该窗口在当天有可用任务池
      const poolW = getReminderPoolForWindow(tasks, reminder, w)
      if (poolW.length > 0) return true
    }
  }
  return false
}

// 找到 fireAt 命中的窗口（用于按窗口任务池挑任务）
function findWindowAt(reminder: ReminderConfig, d: Date): TimeWindow | null {
  const minute = d.getHours() * 60 + d.getMinutes()
  const windows = reminder.windows.length ? reminder.windows : [{ startMinute: 9 * 60, endMinute: 22 * 60 }]
  for (const w of windows) {
    if (isMinuteInWindow(minute, w.startMinute, w.endMinute)) return w
  }
  return null
}

// ---------- 核心调度 ----------
export async function scheduleReminders(
  tasks: Task[],
  reminder: ReminderConfig,
): Promise<void> {
  if (sessionActive) return
  await cancelAllReminders()
  await ensureNotificationActionsRegistered()
  if (!reminder.enabled) return
  const pool = getReminderPool(tasks, reminder)
  if (pool.length === 0) return

  let now = new Date()

  // 窗口外：仅排一个"下次窗口开始"提醒
  const { inWindowNow } = nextWindowEndAfter(tasks, reminder, now)
  if (!inWindowNow) {
    await scheduleNextWindowStart(tasks, reminder)
    return
  }

  const { endAt: windowEnd } = nextWindowEndAfter(tasks, reminder, now)
  const cooldownMs = Math.max(reminder.cooldownMinutes, 1) * 60 * 1000
  let cooldownEnd = Math.max(cooldownUntil, 0)

  // 学习后跳过：如果最近有会话结束，且仍在 skip 窗口内，把 cooldownEnd 推后到 skip 结束
  if (reminder.skipAfterSessionMinutes > 0) {
    const lastEnd = getLastSessionEnd()
    if (lastEnd > 0) {
      const skipUntil = lastEnd + reminder.skipAfterSessionMinutes * 60 * 1000
      if (skipUntil > cooldownEnd) cooldownEnd = skipUntil
    }
  }

  // dual channel: LocalNotifications for 跨平台/Web，原生 plugin 保证 snooze/ignore 不进 App
  const notifications: Array<{
    id: number
    title: string
    body: string
    schedule: { at?: Date }
    actionTypeId?: string
    extra?: Record<string, unknown>
  }> = []
  const nativeItems: NotifItem[] = []
  let at = new Date(Math.max(now.getTime(), cooldownEnd))
  let id = NOTIF_ID_BASE

  const alreadyFired = getReminderFiredToday().count

  // 按窗口挑任务：fireAt 命中的窗口若绑了独立 taskIds，用窗口池；否则用全局池
  const pushOne = (fireAt: Date) => {
    if (id >= NOTIF_ID_MAX) return
    const w = findWindowAt(reminder, fireAt)
    const poolAt = w ? getReminderPoolForWindow(tasks, reminder, w) : pool
    if (poolAt.length === 0) return
    const task = pickWeightedTask(poolAt)
    const seq = pickSequence(task)
    const title = '今天摸啥鱼'
    const body = buildBody(task, seq)
    notifications.push({
      id,
      title,
      body,
      schedule: { at: fireAt },
      actionTypeId: 'REMINDER_WITH_ACTIONS',
      extra: {
        taskId: task.id,
        sequenceId: seq?.id ?? null,
        _title: title,
        _body: body,
      },
    })
    // 原生通道：带 atMs + taskId，用 Broadcast action PendingIntent，不启动 App
    nativeItems.push({
      id,
      title,
      body,
      taskId: task.id,
      atMs: fireAt.getTime(),
    })
    id++
  }

  if (reminder.dailyMode === 'interval' && reminder.intervalMinutes > 0) {
    const intervalMs = reminder.intervalMinutes * 60 * 1000
    let cursor = at
    while (cursor < windowEnd && id < NOTIF_ID_MAX) {
      const cd = new Date(cursor)
      if (isReminderActiveAt(tasks, reminder, cd)) {
        pushOne(cd)
      }
      cursor = new Date(cursor.getTime() + intervalMs)
    }
  } else if (reminder.dailyMode === 'dailyCount') {
    // 每日固定次数：在窗口剩余时间 + 剩余目标次数内，均匀分布后再抖动
    const target = Math.max(1, Math.min(20, reminder.dailyCount)) - alreadyFired - 0
    if (target <= 0) {
      // 今天已到目标：排到明天窗口开始
      await scheduleNextWindowStart(tasks, reminder)
      return
    }
    const remaining = windowEnd.getTime() - at.getTime()
    if (remaining <= cooldownMs) {
      await scheduleNextWindowStart(tasks, reminder)
      return
    }
    const step = remaining / (target + 1)
    for (let k = 1; k <= target && id < NOTIF_ID_MAX; k++) {
      const base = at.getTime() + step * k
      const jitter = (Math.random() - 0.5) * Math.min(step * 0.4, 15 * 60 * 1000) // ±25% 或 ±15分
      const fireAt = new Date(Math.max(at.getTime() + cooldownMs * Math.max(0, k - 1), base + jitter))
      if (fireAt >= windowEnd) continue
      if (!isReminderActiveAt(tasks, reminder, fireAt)) continue
      pushOne(fireAt)
    }
  } else {
    // random 模式：窗口内按冷却间隔与 cooldown 估算 N 次，随机分布
    const remaining = windowEnd.getTime() - at.getTime()
    if (remaining <= cooldownMs) {
      await scheduleNextWindowStart(tasks, reminder)
      return
    }
    const targetCount = Math.min(
      5,
      Math.max(1, Math.floor(remaining / Math.max(cooldownMs, 30 * 60 * 1000))),
    )
    let cursor = at
    for (let k = 0; k < targetCount && id < NOTIF_ID_MAX; k++) {
      const left = windowEnd.getTime() - cursor.getTime()
      if (left <= cooldownMs) break
      const offset = Math.random() * (left - cooldownMs)
      const fireAt = new Date(cursor.getTime() + offset)
      if (!isReminderActiveAt(tasks, reminder, fireAt)) continue
      pushOne(fireAt)
      cursor = new Date(fireAt.getTime() + cooldownMs)
    }
  }

  if (notifications.length === 0) {
    await scheduleNextWindowStart(tasks, reminder)
    return
  }
  // 双通道：
  //   Web/iOS 走 LocalNotifications；
  //   Android 走原生 StudyNotifications（action 用 Broadcast，不启动 App）。
  if (isNativeNotificationsAvailable()) {
    // 探测精确闹钟权限：缺失则标记降级（原生端已自动降级为不精确闹钟）
    canScheduleExactAlarmsNative()
      .then((ok) => { exactAlarmDegraded = !ok })
      .catch(() => {})
    await scheduleNative(nativeItems)
    // 同时把 LocalNotifications 清掉，避免双通道都发重复通知
    try {
      await LocalNotifications.cancel({
        notifications: nativeItems.map(n => ({ id: n.id })),
      })
    } catch { /* ignore */ }
  } else {
    try { await LocalNotifications.schedule({ notifications }) } catch { /* ignore */ }
  }
}

// ---------- 窗口边界调度 ----------
function nextWindowStart(tasks: Task[], reminder: ReminderConfig): Date {
  return nextWindowStartAfter(tasks, reminder, new Date())
}

async function scheduleNextWindowStart(tasks: Task[], reminder: ReminderConfig) {
  await ensureNotificationActionsRegistered()
  const at = nextWindowStart(tasks, reminder)
  const item: NotifItem = {
    id: NOTIF_ID_BASE,
    title: '今天摸啥鱼',
    body: '新的一段学习窗口，准备好开始摸鱼了吗？',
    taskId: undefined,
    atMs: at.getTime(),
  }
  if (isNativeNotificationsAvailable()) {
    await scheduleNative([item])
    try { await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID_BASE }] }) } catch { /* ignore */ }
  } else {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: NOTIF_ID_BASE,
            title: item.title,
            body: item.body,
            schedule: { at },
            actionTypeId: 'REMINDER_WITH_ACTIONS',
            extra: { taskId: null },
          },
        ],
      })
    } catch { /* ignore */ }
  }
}

// ---------- 取消 ----------
export async function cancelAllReminders() {
  try {
    await LocalNotifications.cancel({
      notifications: Array.from({ length: NOTIF_ID_MAX }, (_, i) => ({ id: i + 1 })),
    })
  } catch {
    /* ignore */
  }
  await cancelAllNative()
}

// ---------- 下次提醒预览 ----------
export interface NextReminderPreview {
  at: Date
  mode: 'fixed' | 'random' | 'windowStart' | 'dailyCount' | 'skipSession'
}
export function getNextReminderPreview(
  tasks: Task[],
  reminder: ReminderConfig,
): NextReminderPreview | null {
  if (!reminder.enabled) return null
  const pool = getReminderPool(tasks, reminder)
  if (pool.length === 0) return null

  const now = new Date()
  const { inWindowNow } = nextWindowEndAfter(tasks, reminder, now)
  if (!inWindowNow) {
    return { at: nextWindowStartAfter(tasks, reminder, now), mode: 'windowStart' }
  }

  let firstAtMs = Math.max(now.getTime(), cooldownUntil)
  // 学习后跳过
  if (reminder.skipAfterSessionMinutes > 0) {
    const lastEnd = getLastSessionEnd()
    if (lastEnd > 0) {
      const skipUntil = lastEnd + reminder.skipAfterSessionMinutes * 60 * 1000
      if (skipUntil > firstAtMs) firstAtMs = skipUntil
    }
  }

  const { endAt: windowEnd } = nextWindowEndAfter(tasks, reminder, now)
  if (firstAtMs >= windowEnd.getTime()) {
    return { at: nextWindowStartAfter(tasks, reminder, now), mode: 'windowStart' }
  }

  if (firstAtMs > cooldownUntil) {
    return { at: new Date(firstAtMs), mode: 'skipSession' }
  }
  if (reminder.dailyMode === 'interval' && reminder.intervalMinutes > 0) {
    const firstAt = Math.max(firstAtMs, now.getTime() + reminder.intervalMinutes * 60 * 1000)
    return { at: new Date(firstAt), mode: 'fixed' }
  }
  if (reminder.dailyMode === 'dailyCount') {
    return { at: new Date(firstAtMs), mode: 'dailyCount' }
  }
  return { at: new Date(firstAtMs), mode: 'random' }
}

// ---------- 立即测试提醒 ----------
export async function sendTestReminder(): Promise<void> {
  await ensureNotificationActionsRegistered()
  const atMs = Date.now() + 5000
  const item: NotifItem = {
    id: NOTIF_ID_TEST,
    title: '今天摸啥鱼',
    body: '这是一条测试提醒，证明通知通道工作正常。（点卡片或「开始」进入App；「换一个」重抽；「取消」不进App）',
    taskId: undefined,
    atMs,
  }
  if (isNativeNotificationsAvailable()) {
    await scheduleNative([item])
    try { await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID_TEST }] }) } catch { /* ignore */ }
  } else {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: NOTIF_ID_TEST,
            title: item.title,
            body: item.body,
            schedule: { at: new Date(atMs) },
            actionTypeId: 'REMINDER_WITH_ACTIONS',
            extra: { taskId: null },
          },
        ],
      })
    } catch { /* ignore */ }
  }
}

// ---------- 通知点击 + 动作监听 ----------
export interface NotificationAction {
  taskId: string | null
  reroll?: boolean // "换一个"：重新随机抽任务
  cancelled?: boolean // "取消"：进入冷却，不弹窗
}

export function onNotificationClick(
  cb: (action: NotificationAction) => void,
): () => void {
  let attached = false
  ensureNotificationActionsRegistered().catch(() => {})
  try {
    const handleAction = async (event: {
      notification?: { extra?: Record<string, unknown> }
      actionId?: string
    }) => {
      const extra = event?.notification?.extra ?? {}
      const actionId = event?.actionId
      // Android 原生通知的"取消"由广播处理，不进 App；
      // 这里仅兜底 Web 端 / 原生未接入场景。
      if (actionId === 'cancel') {
        setCooldown(1)
        cb({ taskId: (extra.taskId as string | null) ?? null, cancelled: true })
        return
      }
      if (actionId === 'reroll') {
        cb({ taskId: (extra.taskId as string | null) ?? null, reroll: true })
        return
      }
      // start 或点击通知本体
      cb({
        taskId: (extra.taskId as string | null) ?? null,
      })
    }
    // 同时监听点击通知本体和点击动作按钮
    LocalNotifications.addListener(
      'localNotificationActionPerformed',
      handleAction as Parameters<typeof LocalNotifications.addListener>[1],
    ).then(() => { attached = true })
    LocalNotifications.addListener(
      'localNotificationReceived',
      () => {
        // 仅用于计数：通知发出时 +1（仅当该条是"当日有效调度"时）
        incrementReminderFiredToday()
      },
    ).catch(() => {})
    return () => {
      if (attached) {
        LocalNotifications.removeAllListeners().catch(() => {})
      }
    }
  } catch {
    return () => {}
  }
}
