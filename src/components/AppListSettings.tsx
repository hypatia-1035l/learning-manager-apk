// 应用名单（设置页子视图）—— 管理全局应用池
//
// 池子只存**元数据**（包名 → 应用名），策略全在各方向的 allowedApps / blockedApps 上。
// 这里只做两件事：看清有哪些应用、把不再需要的清出去（会同步清理所有方向的引用）。
import { useMemo, useState } from 'react'
import { useAppData, removeAppFromPool } from '../store'
import { AppIcon } from './AppIcon'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  onBack: () => void
}

export function AppListSettings({ onBack }: Props) {
  const data = useAppData()
  const pool = data.appPool ?? []
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)

  // 右滑返回由父层 Settings 统一注册（避免父子各注册一次造成重复消费）

  // 包名 → 引用它的方向（区分允许 / 分心）
  const usage = useMemo(() => {
    const m = new Map<string, { allow: string[]; block: string[] }>()
    const push = (pkg: string, kind: 'allow' | 'block', taskName: string) => {
      const e = m.get(pkg) ?? { allow: [], block: [] }
      if (!e[kind].includes(taskName)) e[kind].push(taskName)
      m.set(pkg, e)
    }
    for (const t of data.tasks) {
      for (const p of t.allowedApps ?? []) push(p, 'allow', t.name)
      for (const p of t.blockedApps ?? []) push(p, 'block', t.name)
    }
    return m
  }, [data.tasks])

  const orphanCount = pool.filter((e) => !usage.has(e.packageName)).length

  return (
    <div className="pool-compact">
      <header className="shell-header">
        <button className="back-link" onClick={onBack}>
          ← 返回
        </button>
      </header>

      <div className="section" style={{ marginTop: 4 }}>
        <div className="section-title">应用池（{pool.length}）</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          这里只是应用的「名字缓存」。哪份名单允许、哪份分心，都在各方向的编辑页里定。
        </p>

        {pool.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            还没有应用。去「方向 → 编辑」里给某个方向添加允许的应用，这里就会自动记下它。
          </p>
        ) : (
          <div className="app-pool-list">
            {pool.map((e) => {
              const u = usage.get(e.packageName)
              const unused = !u
              return (
                <div key={e.packageName} className={`app-pool-row${unused ? ' unused' : ''}`}>
                  <AppIcon packageName={e.packageName} appName={e.appName} size={30} />
                  <div className="app-pool-main">
                    <div className="app-pool-name">{e.appName}</div>
                    <div className="app-pool-pkg">{e.packageName}</div>
                    <div className="app-pool-refs">
                      {unused ? (
                        <span className="faint">未被任何方向引用</span>
                      ) : (
                        <>
                          {u.allow.length > 0 && (
                            <span className="tag-allow">允许 · {u.allow.join('、')}</span>
                          )}
                          {u.block.length > 0 && (
                            <span className="tag-block">分心 · {u.block.join('、')}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="app-pool-del"
                    onClick={() => setPendingRemove(e.packageName)}
                    title="从池中移除"
                  >
                    移除
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {orphanCount > 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            其中 {orphanCount} 个未被任何方向引用，可以清掉。
          </p>
        )}
      </div>

      {pendingRemove && (
        <ConfirmModal
          title="移除应用"
          message={`确定把「${
            pool.find((e) => e.packageName === pendingRemove)?.appName ?? pendingRemove
          }」移出应用池？\n\n它同时会从所有方向的允许/分心名单里删掉，之后计时页不再显示它的入口。`}
          confirmText="移除"
          onConfirm={() => {
            removeAppFromPool(pendingRemove)
            setPendingRemove(null)
          }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}
