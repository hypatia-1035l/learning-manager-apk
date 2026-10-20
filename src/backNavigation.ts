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

// ---------- 返回拦截栈 ----------
// 弹窗、设置子页这些「局部 UI 状态」App 层看不到，但它们打开时按返回键应该
// 先关掉它们，而不是直接退到桌面。做法：这些组件挂载时压一个 blocker，
// 由 App 统一计算「能不能退桌面」，并在返回事件里优先派发给栈顶。
type BackBlocker = { id: number; onBack: () => void }
const blockers: BackBlocker[] = []
let appLevelCanExit = true
let nextBlockerId = 1
let lastSentCanExit: boolean | null = null

function syncCanExit(): void {
  const canExit = appLevelCanExit && blockers.length === 0
  if (canExit === lastSentCanExit) return
  lastSentCanExit = canExit
  setCanExitAppNative(canExit).catch(() => {})
}

/** App 层（子页面/计时会话）的「能否退桌面」；弹窗会在此基础上再叠加拦截 */
export function setAppLevelCanExit(canExit: boolean): void {
  appLevelCanExit = canExit
  syncCanExit()
}

/** 压入一个返回拦截器（如弹窗的关闭逻辑），返回清理函数 */
export function pushBackBlocker(onBack: () => void): () => void {
  const id = nextBlockerId++
  blockers.push({ id, onBack })
  syncCanExit()
  return () => {
    const i = blockers.findIndex((b) => b.id === id)
    if (i >= 0) {
      blockers.splice(i, 1)
      syncCanExit()
    }
  }
}

/** 返回事件优先交给栈顶拦截器；有拦截器时返回 true（已消费） */
export function runTopBackBlocker(): boolean {
  const top = blockers[blockers.length - 1]
  if (!top) return false
  top.onBack()
  return true
}

/** 当前是否有弹窗类拦截器（测试/调试用） */
export function hasBackBlocker(): boolean {
  return blockers.length > 0
}
