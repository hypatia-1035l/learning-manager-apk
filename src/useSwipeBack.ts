import { useEffect, useRef } from 'react'

interface Options {
  // 仅从屏幕左边缘起滑（默认 false：页面内任意位置右滑均可返回）
  fromEdge?: boolean
  edgeWidth?: number
  // 是否启用（默认 true；如弹窗/会话打开时可传 false 关闭手势）
  enabled?: boolean
}

// 右滑返回手势：水平方向为主、垂直偏移很小、向右滑动超过阈值即触发 onBack。
// 使用 pointer 事件，覆盖触摸 / 触控笔 / 鼠标（Web 预览可用鼠标拖拽测试）。
// 从表单控件或按钮上起滑不触发，避免干扰输入选字与点击。
export function useSwipeBack(onBack: () => void, opts: Options = {}) {
  const fromEdge = opts.fromEdge ?? false
  const edgeWidth = opts.edgeWidth ?? 40
  const enabled = opts.enabled ?? true
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!enabled) return
    let sx = 0
    let sy = 0
    let tracking = false
    let horizontal = false

    // 表单控件/按钮上起滑不参与手势（避免输入选字、按钮拖动误触）
    const isFormField = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      !!el.closest('input, textarea, select, button, a, label, .icon-btn')

    const down = (e: PointerEvent) => {
      if (isFormField(e.target)) return
      if (fromEdge && e.clientX > edgeWidth) return
      sx = e.clientX
      sy = e.clientY
      tracking = true
      horizontal = false
    }
    const move = (e: PointerEvent) => {
      if (!tracking) return
      const dx = e.clientX - sx
      const dy = e.clientY - sy
      if (!horizontal) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        horizontal = Math.abs(dx) > Math.abs(dy)
        // 垂直为主（滚动列表）则放弃本次手势
        if (!horizontal) tracking = false
      }
    }
    const up = (e: PointerEvent) => {
      if (!tracking) {
        tracking = false
        return
      }
      tracking = false
      const dx = e.clientX - sx
      const dy = e.clientY - sy
      if (horizontal && dx > 48 && Math.abs(dy) < 60) {
        onBackRef.current()
      }
    }
    const cancel = () => {
      tracking = false
      horizontal = false
    }

    document.addEventListener('pointerdown', down)
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
    }
  }, [fromEdge, edgeWidth, enabled])
}
