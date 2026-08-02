import { registerPlugin, Capacitor } from '@capacitor/core'

/**
 * 返回导航管理插件。
 * JS 端通知原生层当前是否允许「按返回退到桌面」：
 *   - 子页面 / 有弹窗 → 不允许，返回事件交给 JS 监听器处理（关弹窗 / 回上层）
 *   - 顶层 Tab → 允许，退到桌面（moveTaskToBack）
 */
export interface BackNavigationPlugin {
  setCanExitApp(o: { canExitApp: boolean }): Promise<void>
}

const BackNavigation = registerPlugin<BackNavigationPlugin>('BackNavigation')

/** 是否支持原生插件（仅 Android + 插件已注册时 true）*/
function isNativeAvailable(): boolean {
  try {
    return (
      typeof Capacitor !== 'undefined' &&
      Capacitor.isNativePlatform() &&
      !!BackNavigation
    )
  } catch {
    return false
  }
}

/**
 * 通知原生层：当前是否允许按返回键退出到桌面。
 * @param canExitApp true=顶层Tab可退桌面；false=子页面/有弹窗时交给JS处理
 */
export async function setCanExitAppNative(canExitApp: boolean): Promise<void> {
  try {
    if (isNativeAvailable()) {
      await BackNavigation.setCanExitApp({ canExitApp })
    }
  } catch {
    /* ignore */
  }
}
