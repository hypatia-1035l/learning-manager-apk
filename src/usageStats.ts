import { registerPlugin } from '@capacitor/core'

// 应用使用统计插件 wrapper（接原生 UsageStatsPlugin）
//
// ⚠️ 边界（2026-10-28 B3 起）：**权限判定不要用这里的 getUsageStatsPermissionStatus**，
// 统一走 src/nativePerm.ts 的 checkNativePerms()（AppOps 判定更准，且和悬浮窗放在同一处体检）。
// 本文件保留给后续「统计页」用 —— queryTodayUsageStats（今日各应用前台时长）是它唯一还没被取代的价值。
//
// 越界检测本身不在这里：真正的轮询在原生 StudyTimerService 内完成（见 checkForeground），
// 这里只做只读查询，不负责轮询。

export interface UsageStatsTodayItem {
  packageName: string
  appName: string
  foregroundMs: number
}

export interface UsageStatsPlugin {
  hasPermission(): Promise<{ granted: boolean }>
  requestPermission(): Promise<{ opened: boolean }>
  queryTodayStats(): Promise<{
    ok: boolean
    error?: string
    totalForegroundMs?: number
    stats?: UsageStatsTodayItem[]
    startMs?: number
    endMs?: number
  }>
  getForegroundApp(): Promise<{ ok: boolean; error?: string; packageName?: string }>
}

const UsageStats = registerPlugin<UsageStatsPlugin>('UsageStats')

/** 是否注册了原生 UsageStats 插件（仅 Android 有意义）。 */
export function isUsageStatsSupported(): boolean {
  try {
    return !!UsageStats
  } catch {
    return false
  }
}

/** 查询「使用情况访问」权限是否已授予（未授权时 queryTodayStats / getForegroundApp 拿不到数据）。 */
export async function getUsageStatsPermissionStatus(): Promise<boolean> {
  try {
    const r = await UsageStats.hasPermission()
    return !!r?.granted
  } catch {
    return false
  }
}

/** 跳转到系统「使用情况访问」设置页（该权限非运行时弹窗，必须用户手动开启）。 */
export async function openUsageStatsSettings(): Promise<void> {
  try {
    await UsageStats.requestPermission()
  } catch {
    /* ignore */
  }
}

/** 读取今日各应用前台时长（统计页用）。Web / 未授权时返回 null。 */
export async function queryTodayUsageStats(): Promise<UsageStatsTodayItem[] | null> {
  try {
    const r = await UsageStats.queryTodayStats()
    if (r && r.ok && Array.isArray(r.stats)) return r.stats
    return null
  } catch {
    return null
  }
}

/** 取当前最近前台应用的包名（演示 / 调试用）。Web / 未授权时返回 null。 */
export async function getForegroundPackage(): Promise<string | null> {
  try {
    const r = await UsageStats.getForegroundApp()
    return r && r.ok && r.packageName ? r.packageName : null
  } catch {
    return null
  }
}
