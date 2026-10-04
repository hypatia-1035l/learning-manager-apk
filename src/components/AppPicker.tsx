// 应用选择器（内容组件，自带 Modal）——
// 从「设备上已安装的应用」里挑，勾选即自动写入全局应用池。
//
// 为什么是内容组件而不是独立弹窗：
//   本项目的 Modal 用 Portal 挂 body，嵌套两个 Modal 会让 Esc 同时关掉两层。
//   所以由父组件在自己的 Modal 里切换内容（与设置页「说明」子视图同一套路）。
//
// 设计要点：
// - 顶部固定一段「已选」，即使系统列表里查不到（卸载/列表加载失败）也能取消
// - 搜索框：按应用名或包名过滤
// - `excluded` 用于同一方向的两份名单互斥（另一侧已选 → 置灰不可点）
import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from './AppIcon'
import { isAppListAvailable, listInstalledApps } from '../appList'
import type { InstalledApp } from '../appList'
import type { AppEntry } from '../types'

interface Props {
  /** 当前这份名单已选的包名 */
  selected: string[]
  /** 另一份名单已选的包名（置灰互斥） */
  excluded?: string[]
  /** 全局应用池：提供已选应用的显示名 */
  pool: AppEntry[]
  onToggle: (app: InstalledApp) => void
  /** 原生不可用时给出的说明（Web 预览） */
  unavailableHint?: string
}

export function AppPicker({
  selected,
  excluded = [],
  pool,
  onToggle,
  unavailableHint = '浏览器预览下无法读取已安装应用，请在手机上使用。',
}: Props) {
  const [apps, setApps] = useState<InstalledApp[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    listInstalledApps()
      .then((list) => {
        if (alive) setApps(list)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const selSet = useMemo(() => new Set(selected), [selected])
  const excSet = useMemo(() => new Set(excluded), [excluded])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return apps
    return apps.filter(
      (a) =>
        a.appName.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q),
    )
  }, [apps, query])

  // 已选项的展示信息：优先系统列表名称，其次池子，最后回退包名
  const selectedRows: InstalledApp[] = selected.map((pkg) => {
    const inSystem = apps.find((a) => a.packageName === pkg)
    const inPool = pool.find((e) => e.packageName === pkg)
    return {
      packageName: pkg,
      appName: inSystem?.appName || inPool?.appName || pkg,
      isSystem: inSystem?.isSystem ?? false,
    }
  })

  const native = isAppListAvailable()

  return (
    <>
      {native && selectedRows.length > 0 && (
        <div className="field">
          <label>已选（{selectedRows.length}）</label>
          <div className="app-chips">
            {selectedRows.map((a) => (
              <button
                key={a.packageName}
                type="button"
                className="app-chip"
                onClick={() => onToggle(a)}
                title="点击移除"
              >
                <AppIcon packageName={a.packageName} appName={a.appName} size={18} />
                <span className="app-chip-name">{a.appName}</span>
                <span className="app-chip-x">×</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!native ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          {unavailableHint}
        </p>
      ) : (
        <>
          <div className="field">
            <input
              className="input"
              placeholder="搜索应用名或包名"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="app-pick-list">
            {loading && (
              <p className="muted" style={{ fontSize: 13 }}>
                正在读取已安装应用…
              </p>
            )}
            {!loading && filtered.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                没有匹配的应用。
              </p>
            )}
            {filtered.map((a) => {
              const isSel = selSet.has(a.packageName)
              const isExc = !isSel && excSet.has(a.packageName)
              return (
                <button
                  key={a.packageName}
                  type="button"
                  className={`app-pick-row${isSel ? ' on' : ''}${isExc ? ' off' : ''}`}
                  disabled={isExc}
                  onClick={() => onToggle(a)}
                  title={isExc ? '已在另一份名单里' : a.packageName}
                >
                  <AppIcon packageName={a.packageName} appName={a.appName} size={30} />
                  <span className="app-pick-main">
                    <span className="app-pick-name">{a.appName}</span>
                    <span className="app-pick-pkg">{a.packageName}</span>
                  </span>
                  <span className="app-pick-mark">{isSel ? '✓' : isExc ? '另一名单' : ''}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
