// 越界管控所需的系统权限：查询状态 + 跳设置页
//
// 三项分工（详见 docs/严格模式与界面改版方案.md）：
//   1. usageAccess 使用情况访问 —— 判定前台应用的前提，没它就是瞎的
//   2. overlay     悬浮窗       —— Android 10+ 后台 startActivity 的豁免凭据，「拉回」必需
//   3. 自启动/后台弹出界面（厂商私有）—— 没有标准 API 可读状态，只能跳过去让用户自己开，
//      所以 openAutoStart() 只回报「页面有没有打开成功」，绝不谎报「已开启」
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface NativePermStatus {
  usageAccess: boolean
  overlay: boolean
  sdkInt?: number
}

interface NativePermPlugin {
  check(): Promise<NativePermStatus>
  openUsageAccess(): Promise<void>
  openOverlay(): Promise<void>
  openAppDetails(): Promise<void>
  openAutoStart(): Promise<{ opened: boolean }>
}

export const NativePerm = registerPlugin<NativePermPlugin>('NativePerm')

/** Web 预览下整套能力降级（返回 false / 空状态，不抛错） */
export function isNativePermAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

/** 读取权限状态；Web 端返回全 false */
export async function checkNativePerms(): Promise<NativePermStatus> {
  if (!isNativePermAvailable()) return { usageAccess: false, overlay: false }
  try {
    const r = await NativePerm.check()
    return {
      usageAccess: !!r?.usageAccess,
      overlay: !!r?.overlay,
      sdkInt: r?.sdkInt,
    }
  } catch {
    return { usageAccess: false, overlay: false }
  }
}

/** 跳「使用情况访问」设置页 */
export async function openUsageAccessSettings(): Promise<void> {
  if (!isNativePermAvailable()) return
  try {
    await NativePerm.openUsageAccess()
  } catch {
    /* ignore */
  }
}

/** 跳本应用的悬浮窗授权页 */
export async function openOverlaySettings(): Promise<void> {
  if (!isNativePermAvailable()) return
  try {
    await NativePerm.openOverlay()
  } catch {
    /* ignore */
  }
}

/** 跳应用详情页（厂商自启动藏得深时的兜底落点） */
export async function openAppDetailsSettings(): Promise<void> {
  if (!isNativePermAvailable()) return
  try {
    await NativePerm.openAppDetails()
  } catch {
    /* ignore */
  }
}

/**
 * 尝试打开厂商自启动管理页。
 * 返回 false 表示这台机器上找不到已知的页面入口 —— UI 应提示走「应用详情 → 自启动」手动路径，
 * 不要显示成「已开启」。
 */
export async function openAutoStartSettings(): Promise<boolean> {
  if (!isNativePermAvailable()) return false
  try {
    const r = await NativePerm.openAutoStart()
    return !!r?.opened
  } catch {
    return false
  }
}
