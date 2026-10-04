// 应用清单：Capacitor 原生插件 wrapper
//
// 对应原生 `AppListPlugin.java`（listApps / getIcon / launch）。
// Web 端（浏览器预览）不做任何支持，全部降级为「不可用」——
// 因为浏览器拿不到已安装应用列表，也无法按包名启动。
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface InstalledApp {
  packageName: string
  appName: string
  isSystem: boolean
}

interface AppListPlugin {
  listApps(): Promise<{ ok: boolean; apps?: InstalledApp[]; error?: string }>
  getIcon(o: {
    packageName: string
  }): Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  launch(o: { packageName: string }): Promise<{ ok: boolean; error?: string }>
}

export const AppList = registerPlugin<AppListPlugin>('AppList')

/** 原生端是否可用（Web 预览下整个功能降级） */
export function isAppListAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

/** 列出已安装且**可启动**的应用（已按名称排序） */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (!isAppListAvailable()) return []
  try {
    const r = await AppList.listApps()
    if (!r?.ok || !Array.isArray(r.apps)) return []
    return [...r.apps].sort((a, b) =>
      (a.appName || a.packageName).localeCompare(b.appName || b.packageName, 'zh-Hans-CN'),
    )
  } catch {
    return []
  }
}

// 图标缓存：同一包名只向原生取一次（base64 PNG，体积不小）
const iconCache = new Map<string, string | null>()

/** 取单个应用图标（dataURL）；失败返回 null，调用方用首字母色块兜底 */
export async function getAppIcon(packageName: string): Promise<string | null> {
  if (!packageName) return null
  if (iconCache.has(packageName)) return iconCache.get(packageName) ?? null
  if (!isAppListAvailable()) {
    iconCache.set(packageName, null)
    return null
  }
  try {
    const r = await AppList.getIcon({ packageName })
    const url = r?.ok && r.dataUrl ? r.dataUrl : null
    iconCache.set(packageName, url)
    return url
  } catch {
    iconCache.set(packageName, null)
    return null
  }
}

/** 按包名启动应用；返回是否成功 */
export async function launchApp(packageName: string): Promise<boolean> {
  if (!isAppListAvailable()) return false
  try {
    const r = await AppList.launch({ packageName })
    return !!r?.ok
  } catch {
    return false
  }
}
