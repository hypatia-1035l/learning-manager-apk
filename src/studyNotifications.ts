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

export interface StudyNotificationsPlugin {
  ensureChannel(): Promise<void>
  fireNow(o: { id: number; title: string; body: string; taskId?: string }): Promise<void>
  schedule(o: { items: NotifItem[] }): Promise<{ scheduled: number }>
  cancelAll(): Promise<void>
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
