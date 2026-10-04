import { LocalNotifications } from '@capacitor/local-notifications'
import type { PlanDay, PlanItem, Sequence, Task, NotificationIntensity } from './types'
import {
  getAppData,
  ensurePlansInStore,
  dateKey,
  pickSequence,
  formatSequenceProgress,
  setPlanItemsDeferred,
  carryOverManualPlanItems,
} from './store'
import {
  isNativeNotificationsAvailable,
  scheduleNative,
  cancelAllNative,
  canScheduleExactAlarmsNative,
  ensureChannelsNative,
  type NotifItem,
  type NotifChannel,
} from './studyNotifications'

// 通知 ID 命名空间：1 起递增，用于计划项提醒
// 99 用作测试提醒 ID
export const NOTIF_ID_BASE = 1
export const NOTIF_ID_TEST = 99
export const NOTIF_ID_MAX = 120
// 回归提醒专用 ID：独立于计划项 1–120，避免互相取消干扰
export const NOTIF_ID_REENGAGE = 1000
// 「下一项」常驻通知 ID：固定在通知栏显示接下来最近的一条计划，独立于计划项与回归提醒
export const NOTIF_ID_NEXT = 2001

// ===== 会话状态 + 冷却管理 =====
let sessionActive = false
let cooldownUntil = 0
// 当前会话的开始时刻（ms）：用于"冲突延迟"——判定哪些计划项是在会话期间到点的
let sessionStartTs = 0

const COOLDOWN_KEY = 'learning-manager:cooldown-until'
const SESSION_ACTIVE_KEY = 'learning-manager:session-active'
const SESSION_START_KEY = 'learning-manager:session-start'
const LAST_ACTIVE_KEY = 'learning-manager:last-active'

// 回归提醒：最后活跃时刻（ms）。每次打开 App 都会刷新并把提醒往后推 N 天；
// 连续 N 天未打开 → OS 到点推送"回来摸鱼"。
let lastActiveTs = Date.now()

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
  const startRaw = localStorage.getItem(SESSION_START_KEY)
  if (startRaw) {
    const ts = Number(startRaw)
    if (!isNaN(ts)) sessionStartTs = ts
  }
  const laRaw = localStorage.getItem(LAST_ACTIVE_KEY)
  if (laRaw) {
    const ts = Number(laRaw)
    if (!isNaN(ts)) lastActiveTs = ts
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
    // 记录会话开始时刻（用于冲突延迟判定），并清掉上一次遗留的延迟补发标记
    sessionStartTs = Date.now()
    try {
      localStorage.setItem(SESSION_START_KEY, String(sessionStartTs))
    } catch {
      /* ignore */
    }
    await cancelAllReminders()
  } else if (wasActive) {
    if (onSessionEndCallback) onSessionEndCallback()
  }
}

// 会话结束：进入冷却并重新调度（重排剩余计划项）
export async function endSessionAndReschedule(): Promise<void> {
  const { reminder } = getAppData()
  if (reminder) setCooldown(reminder.cooldownMinutes)
  // 先把会话期间到点的计划项标记为"延迟补发"，再统一调度（deferredAtMs 会被 scheduleReminders 读取）
  await applyDeferral()
  await scheduleReminders()
}

// 冲突延迟：把"在会话期间（sessionStartTs ~ endedAt）原定到点"的今日 pending 计划项，
// 推迟到本次会话结束之后补发。写入 plan 的 deferredAtMs，使后续任意一次 reschedule 都能存活。
//   - deferMinutes <= 0：不延迟（这些项将被 scheduleReminders 当作过点直接丢弃，旧行为）
//   - 多个被冲突项：按原顺序、每项错开 1 分钟依次补发
export async function applyDeferral(endedAtMs?: number): Promise<void> {
  const { reminder, plans } = getAppData()
  if (!reminder?.enabled) return
  const defer = reminder.deferMinutes ?? 0
  if (defer <= 0) return
  if (sessionStartTs <= 0) return
  const endedAt = endedAtMs ?? Date.now()
  if (endedAt < sessionStartTs) return
  const todayStr = dateKey(new Date())
  const today = (plans ?? []).find((p) => p.date === todayStr)
  if (!today) return
  const updates: { id: string; at: number }[] = []
  let idx = 0
  for (const it of today.items) {
    if (it.status !== 'pending') continue
    const baseFire = planItemDate(today, it).getTime()
    // 仅"在会话期间原定到点"的项需要延迟；会话前就已过点的按旧逻辑丢弃
    if (baseFire < sessionStartTs || baseFire > endedAt) continue
    if (idx >= NOTIF_ID_MAX) break
    const at = endedAt + defer * 60000 + idx * 60000
    updates.push({ id: it.id, at })
    idx++
  }
  if (updates.length === 0) return
  setPlanItemsDeferred(todayStr, updates)
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
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// 计划项通知正文：轻量 1-2 行，优先动作意图
function buildPlanBody(
  item: PlanItem,
  timeStr: string,
  seq: Sequence | null,
): string {
  // 第一行：时间 + 方向 +（序列）
  const first = seq
    ? `${timeStr} · ${item.taskName} · ${seq.name}`
    : `${timeStr} · ${item.taskName}`
  // 第二行：进度 + 时长
  const parts: string[] = []
  if (seq) {
    parts.push(`进度 ${formatSequenceProgress(seq)}`)
  }
  if (item.durationSec && item.durationSec > 0) {
    parts.push(`${Math.round(item.durationSec / 60)} 分钟`)
  }
  if (parts.length === 0) return first
  return `${first}\n${parts.join(' · ')}`
}

// 计划项 → 当日时刻 Date（本地时区）
function planItemDate(day: PlanDay, item: PlanItem): Date {
  const [y, m, d] = day.date.split('-').map(Number)
  return new Date(y, m - 1, d, Math.floor(item.minuteOfDay / 60), item.minuteOfDay % 60, 0, 0)
}

// ---------- 核心调度：唯一次日计划 ----------
// 打开 App / 切回前台 / 会话结束 / 设置变更时调用：
//   1. ensurePlansInStore：补齐今天剩余 + 预生成明天
//   2. 为今天（now 之后）+ 明天的 pending 计划项逐个调度通知
// 冷却与「学习后跳过」不改变计划固定时刻（那是生成时的约束）。
const INTENSITY_TO_CHANNEL: Record<NotificationIntensity, NotifChannel> = {
  strong: 'reminders_strong',
  weak: 'reminders_weak',
  silent: 'reminders_silent',
}

export async function scheduleReminders(): Promise<void> {
  // 先保证计划存在（含固定任务注入）：即便提醒关闭，固定任务也要进入每日计划
  const plans = ensurePlansInStore()
  const { reminder } = getAppData()
  const enabled = !!reminder?.enabled
  const pinnedExists = (getAppData().pinnedTasks?.length ?? 0) > 0
  const shouldNotify = enabled || pinnedExists

  if (sessionActive) {
    // 会话进行中：计时常驻通知已显示当前任务；下一项通知照常刷新（或关闭）
    if (shouldNotify) await postNextTaskNotification()
    else await cancelNextTaskNotification()
    return
  }
  await cancelAllReminders()
  await ensureNotificationActionsRegistered()
  await ensureChannelsNative()
  if (!shouldNotify) {
    await cancelNextTaskNotification()
    return
  }

  // 调度前先顺延手动计划项（通常已在 App 层做过，这里兜底保证通知不漏）
  try {
    carryOverManualPlanItems()
  } catch {
    /* ignore */
  }
  const channel = INTENSITY_TO_CHANNEL[reminder!.intensity ?? 'weak']

  const now = new Date()
  // 排程窗口：今天 + 未来 planLookaheadDays 天
  const lookahead = Math.min(7, Math.max(1, (reminder?.planLookaheadDays) || 3))

  // dual channel: LocalNotifications for 跨平台/Web，原生 plugin 保证动作不进 App
  const notifications: Array<{
    id: number
    title: string
    body: string
    schedule: { at?: Date }
    actionTypeId?: string
    extra?: Record<string, unknown>
  }> = []
  const nativeItems: NotifItem[] = []
  let id = NOTIF_ID_BASE

  const pushItem = (day: PlanDay, item: PlanItem) => {
    if (id >= NOTIF_ID_MAX) return
    if (item.status !== 'pending') return
    // 冲突延迟补发：若该项被写入 deferredAtMs（晚于原定时刻），以其为准
    let fireAt = planItemDate(day, item)
    let deferred = false
    if (typeof item.deferredAtMs === 'number' && item.deferredAtMs > fireAt.getTime()) {
      fireAt = new Date(item.deferredAtMs)
      deferred = true
    }
    // 已过期（含 30 秒缓冲）不再排：延迟项本应已触发；普通项直接丢弃（旧行为）
    if (fireAt.getTime() <= now.getTime() + 30 * 1000) return
    const task: Task | undefined = tasks.find((t) => t.id === item.taskId)
    // 方向还在且序列被删时回退到当前序列
    const seq = task
      ? task.group?.items.find((s) => s.id === item.sequenceId) ?? pickSequence(task)
      : null
    const timeStr = `${pad2(fireAt.getHours())}:${pad2(fireAt.getMinutes())}`
    // 标题用方向名，比固定应用名更轻量、更像一条 nudge
    const title = item.taskName || '该摸一条鱼了'
    const body = deferred
      ? `${buildPlanBody(item, timeStr, seq)}\n（上一会话结束后补发）`
      : buildPlanBody(item, timeStr, seq)
    notifications.push({
      id,
      title,
      body,
      schedule: { at: fireAt },
      actionTypeId: 'REMINDER_WITH_ACTIONS',
      extra: {
        taskId: item.taskId,
        sequenceId: seq?.id ?? null,
        _title: title,
        _body: body,
      },
    })
    // 原生通道：带 atMs + taskId + channel，用 Broadcast action PendingIntent，不启动 App
    nativeItems.push({
      id,
      title,
      body,
      taskId: item.taskId,
      atMs: fireAt.getTime(),
      channel,
    })
    id++
  }

  const { tasks } = getAppData()
  if (enabled) {
    for (let d = 0; d <= lookahead; d++) {
      const ds = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d))
      const day = plans.find((p) => p.date === ds)
      if (day) for (const it of day.items) pushItem(day, it)
    }
    // 回归提醒：与计划排程同步续命（每次调度都刷新 lastActive 并把提醒往后推 N 天）
    await scheduleReengageNudge()
  }

  if (notifications.length === 0) {
    // 无计划提醒项时（如提醒关闭但仍有固定任务），仍刷新「下一项」常驻通知
    if (shouldNotify) await postNextTaskNotification()
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
  // 刷新「下一项」常驻通知
  if (shouldNotify) await postNextTaskNotification()
}

// ---------- 「下一项」常驻通知（固定在通知栏）----------
// 显示今天~未来窗口内最早的一条待提醒计划；每次调度都刷新。
// 用固定 ID（2001）立即投递，留在通知栏直到下次刷新/取消；App 关着也仍在（系统通知）。
export async function cancelNextTaskNotification(): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID_NEXT }] })
  } catch {
    /* ignore */
  }
}

export async function postNextTaskNotification(): Promise<void> {
  const { plans } = getAppData()
  const now = Date.now()
  let best: { item: PlanItem; at: number } | null = null
  for (const day of plans ?? []) {
    for (const it of day.items) {
      if (it.status !== 'pending') continue
      const base = planItemDate(day, it).getTime()
      const at =
        typeof it.deferredAtMs === 'number' && it.deferredAtMs > base
          ? it.deferredAtMs
          : base
      if (at <= now) continue
      if (!best || at < best.at) best = { item: it, at }
    }
  }
  if (!best) {
    await cancelNextTaskNotification()
    return
  }
  const t = new Date(best.at)
  const timeStr = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`
  const item = best.item
  try {
    await cancelNextTaskNotification()
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIF_ID_NEXT,
          title: `下一项：${item.taskName || '摸鱼'}`,
          body: `${timeStr}${item.sequenceName ? ' · ' + item.sequenceName : ''} · 点开即开始`,
        },
      ],
    })
  } catch {
    /* ignore */
  }
}

// ---------- 取消 ----------
export async function cancelAllReminders() {
  // 只取消「提醒自身」的 id：计划项 1..NOTIF_ID_MAX（含测试 99）、回归 1000、「下一项」2001。
  // 显式传给原生端，避免它用 cancelAll() 连带清掉计时常驻通知与越界提醒。
  const ownIds = [
    ...Array.from({ length: NOTIF_ID_MAX }, (_, i) => i + 1),
    NOTIF_ID_REENGAGE,
    NOTIF_ID_NEXT,
  ]
  try {
    await LocalNotifications.cancel({
      notifications: ownIds.map((id) => ({ id })),
    })
  } catch {
    /* ignore */
  }
  await cancelAllNative(ownIds)
}

// ---------- 回归提醒（跨天留存）----------
// 机制：记录 lastActiveTs，每次打开 App 都把提醒排到 lastActiveTs + N 天；
// 只要日常打开，提醒永远被往后推，永不触发；连续 N 天未打开 → OS 到点推送。
// 通知本身由 LocalNotifications（Android 走插件 AlarmManager）排程，App 关着也能响。
export function touchLastActive(): void {
  lastActiveTs = Date.now()
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(lastActiveTs))
  } catch {
    /* ignore */
  }
}

export async function cancelReengageNudge(): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID_REENGAGE }] })
  } catch {
    /* ignore */
  }
}

export async function scheduleReengageNudge(): Promise<void> {
  const { reminder } = getAppData()
  if (!reminder?.enabled) {
    await cancelReengageNudge()
    return
  }
  const days = reminder.reengageDays ?? 0
  if (days <= 0) {
    await cancelReengageNudge()
    return
  }
  touchLastActive()
  // at = 最后活跃 + N 天；防御：若已过点（极端时钟回拨），顺延到当前 + N 天
  let at = new Date(lastActiveTs + days * 24 * 60 * 60 * 1000)
  if (at.getTime() <= Date.now()) {
    at = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID_REENGAGE }] })
  } catch {
    /* ignore */
  }
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIF_ID_REENGAGE,
          title: '该回来摸鱼了',
          body: `已经 ${days} 天没来学习了，今天挑一条顺手的开始吧。`,
          schedule: { at },
        },
      ],
    })
  } catch {
    /* ignore */
  }
}

// ---------- 下次提醒预览 ----------
export interface NextReminderPreview {
  at: Date
  mode: 'plan'
}
// 返回今天/明天计划中下一个待提醒项的时刻；无则 null
export function getNextReminderPreview(): NextReminderPreview | null {
  const { reminder, plans } = getAppData()
  if (!reminder?.enabled) return null
  const now = Date.now()
  let best: Date | null = null
  for (const day of plans ?? []) {
    for (const it of day.items) {
      if (it.status !== 'pending') continue
      const base = planItemDate(day, it).getTime()
      // 冲突延迟项以其补发时刻为准
      const at = typeof it.deferredAtMs === 'number' && it.deferredAtMs > base
        ? it.deferredAtMs
        : base
      if (at <= now) continue
      if (!best || at < best.getTime()) best = new Date(at)
    }
  }
  return best ? { at: best, mode: 'plan' } : null
}

// ---------- 立即测试提醒 ----------
export async function sendTestReminder(): Promise<void> {
  await ensureNotificationActionsRegistered()
  await ensureChannelsNative()
  const atMs = Date.now() + 5000
  const { reminder } = getAppData()
  const channel = INTENSITY_TO_CHANNEL[reminder?.intensity ?? 'weak']
  const item: NotifItem = {
    id: NOTIF_ID_TEST,
    title: '测试提醒',
    body: '通知通道正常。点「开始」直接计时，「换一个」重抽，「取消」忽略。',
    taskId: undefined,
    atMs,
    channel,
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
        const { reminder } = getAppData()
        setCooldown(reminder?.cooldownMinutes ?? 30)
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
    return () => {
      if (attached) {
        LocalNotifications.removeAllListeners().catch(() => {})
      }
    }
  } catch {
    return () => {}
  }
}
