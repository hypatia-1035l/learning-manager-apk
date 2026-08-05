import { registerPlugin, Capacitor } from '@capacitor/core'

/**
 * 原生自定义通知发布插件。
 * 相比 @capacitor/local-notifications：
 *   - Snooze/Ignore 动作按钮使用 Broadcast PendingIntent，<b>不启动 App</b>
 *   - 定时使用 AlarmManager.setAndAllowWhileIdle，保证后台准时
 */
export interface NotifItem {
  id: number
  title: string
  body: string
  taskId?: string
  atMs?: number // 0 或空 = 立即
}

export interface PendingNotifAction {
  action: string // 'start' | 'reroll' | ''
  taskId: string
}

export interface StudyNotificationsPlugin {
  ensureChannel(): Promise<void>
  fireNow(o: { id: number; title: string; body: string; taskId?: string }): Promise<void>
  schedule(o: { items: NotifItem[] }): Promise<{ scheduled: number }>
  cancelAll(): Promise<void>
  // 查询是否被授予精确闹钟权限（Android 12+；其他平台恒为 true）
  canScheduleExactAlarms(): Promise<{ granted: boolean }>
  // 跳转到系统"精确闹钟"授权设置页（Android 12+）
  openExactAlarmSettings(): Promise<void>
  // 读取并清除由通知动作（开始/换一个）写入的 pending action
  consumePendingNotifAction(): Promise<PendingNotifAction>
}

const StudyNotifications = registerPlugin<StudyNotificationsPlugin>('StudyNotifications')

/** 是否支持原生插件（仅 Android + 插件已注册时 true）*/
export function isNativeNotificationsAvailable(): boolean {
  try {
    return (
      typeof Capacitor !== 'undefined' &&
      Capacitor.isNativePlatform() &&
      !!StudyNotifications
    )
  } catch {
    return false
  }
}

export async function ensureChannelNative(): Promise<void> {
  try { if (isNativeNotificationsAvailable()) await StudyNotifications.ensureChannel() } catch { /* ignore */ }
}

export async function fireNowNative(o: { id: number; title: string; body: string; taskId?: string }): Promise<void> {
  try { if (isNativeNotificationsAvailable()) await StudyNotifications.fireNow(o) } catch { /* ignore */ }
}

export async function scheduleNative(items: NotifItem[]): Promise<number> {
  try {
    if (isNativeNotificationsAvailable()) {
      const r = await StudyNotifications.schedule({ items })
      return r?.scheduled ?? 0
    }
  } catch { /* ignore */ }
  return 0
}

export async function cancelAllNative(): Promise<void> {
  try { if (isNativeNotificationsAvailable()) await StudyNotifications.cancelAll() } catch { /* ignore */ }
}

/**
 * 查询是否被授予精确闹钟权限。
 * 非原生平台（Web/iOS）无此概念，返回 true（视为具备）。
 */
export async function canScheduleExactAlarmsNative(): Promise<boolean> {
  try {
    if (!isNativeNotificationsAvailable()) return true
    const r = await StudyNotifications.canScheduleExactAlarms()
    return !!r?.granted
  } catch {
    return true
  }
}

/** 跳转到系统"精确闹钟"授权设置页（仅 Android 12+ 有效）。 */
export async function openExactAlarmSettingsNative(): Promise<void> {
  try { if (isNativeNotificationsAvailable()) await StudyNotifications.openExactAlarmSettings() } catch { /* ignore */ }
}

// 读取并清除原生端暂存的通知动作（开始/换一个）
export async function consumePendingNotifAction(): Promise<PendingNotifAction | null> {
  try {
    if (!isNativeNotificationsAvailable()) return null
    const r = await StudyNotifications.consumePendingNotifAction()
    if (!r || !r.action) return null
    return { action: r.action, taskId: r.taskId || '' }
  } catch { /* ignore */ }
  return null
}
