// 应用图标 —— 懒加载 + 首字母色块兜底
//
// 图标来自原生 `AppList.getIcon`（base64 PNG），同一包名只取一次（appList.ts 内有缓存）。
// 列表里可能有 200+ 应用，因此**进入视口才请求**，避免一次性发几百个 bridge 调用。
import { useEffect, useRef, useState } from 'react'
import { getAppIcon } from '../appList'

interface Props {
  packageName: string
  appName: string
  size?: number
  className?: string
}

/** 由包名派生一个稳定的色相，保证同一应用每次渲染底色一致 */
function hueOf(pkg: string): number {
  let h = 7
  for (let i = 0; i < pkg.length; i++) h = (h * 31 + pkg.charCodeAt(i)) % 360
  return h
}

export function AppIcon({ packageName, appName, size = 32, className }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !packageName) return
    let alive = true
    const load = () => {
      getAppIcon(packageName).then((u) => {
        if (alive) setUrl(u)
      })
    }
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => {
        alive = false
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          load()
        }
      },
      { rootMargin: '160px' },
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [packageName])

  const first = (appName || packageName || '?').trim().charAt(0) || '?'

  return (
    <span
      ref={ref}
      className={`app-icon${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt={appName} width={size} height={size} />
      ) : (
        <span
          className="app-icon-fb"
          style={{ background: `hsl(${hueOf(packageName)} 42% 42%)`, fontSize: Math.round(size * 0.5) }}
        >
          {first}
        </span>
      )}
    </span>
  )
}
