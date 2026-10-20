import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { pushBackBlocker } from '../backNavigation'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}

// 可聚焦元素选择器（disabled 的一律排除）
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 决定 Tab / Shift+Tab 应该把焦点移到哪。
 *
 * 返回 null 表示「浏览器默认行为已经正确，无需干预」。
 * 抽成不碰 DOM 的纯函数，是为了能脱离浏览器做回归测试
 * （本仓库没有 DOM 测试环境，见 scripts/verify-fixes.mjs）。
 */
export function resolveTabTarget(
  items: HTMLElement[],
  active: HTMLElement | null,
  shiftKey: boolean,
  root: HTMLElement,
): HTMLElement | null {
  // 没有任何可聚焦元素：把焦点留在对话框容器上，别让它跑出去
  if (items.length === 0) return root
  const first = items[0]
  const last = items[items.length - 1]
  const inside = !!active && root.contains(active)
  if (shiftKey) {
    // 在首元素（或焦点已在弹窗外）时反向 → 绕到末元素
    return !inside || active === first ? last : null
  }
  // 在末元素（或焦点已在弹窗外）时正向 → 绕回首元素
  return !inside || active === last ? first : null
}

export function Modal({ title, onClose, children, footer }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  // 用 ref 保存最新的 onClose：拦截器只在挂载时压栈一次，
  // 但每次渲染的 onClose 可能是新函数，派发时取最新的那个
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // 弹窗打开时拦截系统返回键：先关弹窗，而不是直接退到桌面
  useEffect(() => pushBackBlocker(() => onCloseRef.current()), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // 焦点陷阱：Tab / Shift+Tab 在弹窗内循环，不把焦点送回背后的页面
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      const target = resolveTabTarget(
        items,
        document.activeElement as HTMLElement | null,
        e.shiftKey,
        root,
      )
      if (target) {
        e.preventDefault()
        target.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 打开时把焦点移进对话框；内容里已有 autoFocus 元素时不动它。
  // 关闭时把焦点还给打开弹窗的那个元素（否则焦点会掉到 body 上）。
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    const root = dialogRef.current
    if (root && !root.contains(document.activeElement)) root.focus()
    return () => {
      const prev = restoreRef.current
      if (prev && document.contains(prev) && typeof prev.focus === 'function') prev.focus()
    }
  }, [])

  // 必须用 Portal 挂到 body：否则在 SwiperSlide（带 transform）里，
  // position:fixed 会退化成相对 slide 定位，模态框被卡在 slide 内出不来。
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
