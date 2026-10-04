// 应用名单（设置页子视图）—— 维护全局应用池
//
// 池子只存**元数据**（包名 → 应用名），策略全在各方向的 allowedApps / blockedApps 上。
// 这里负责三件事：新增 / 移除池内应用、显示每个应用被哪些方向引用、
// 把两类异常数据摆到台面上（同方向双名单冲突、当前设备上已找不到的应用）。
import { useEffect, useMemo, useState } from 'react'
import {
  useAppData,
  removeAppFromPool,
  addAppsToPool,
  appLabelOf,
  classifyAppForTask,
} from '../store'
import { AppIcon } from './AppIcon'
import { ConfirmModal } from './ConfirmModal'
import { Modal } from './Modal'
import { AppPicker } from './AppPicker'
import { isAppListAvailable, listInstalledApps } from '../appList'
import type { InstalledApp } from '../appList'

interface Props {
  onBack: () => void
}

export function AppListSettings({ onBack }: Props) {
  const data = useAppData()
  const pool = data.appPool ?? []
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const native = isAppListAvailable()

  // 当前设备上实际存在的包名集合；null = 还没拿到 / 拿不到 → 此时不做「已卸载」判断
  const [installed, setInstalled] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!native) return
    let alive = true
    listInstalledApps()
      .then((list) => {
        // 只有确实拿到非空列表才启用判断：空列表既可能是读取失败，
        // 也可能来自异常环境，直接当成「全都被卸载」会把整个池子标灰
        if (alive && list.length > 0) {
          setInstalled(new Set(list.map((a) => a.packageName)))
        }
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      alive = false
    }
  }, [native])

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

  // 双名单冲突：同方向的 allowedApps 与 blockedApps 都含该包名。
  // 判定复用 classifyAppForTask，保证提示与「允许优先」的实际规则完全一致（方案 §3.1）。
  const conflicts = useMemo(() => {
    const out: { key: string; taskName: string; label: string; packageName: string }[] = []
    for (const t of data.tasks) {
      for (const pkg of t.blockedApps ?? []) {
        if (classifyAppForTask(t, pkg) !== 'allow') continue
        out.push({
          key: t.id + '|' + pkg,
          taskName: t.name,
          label: appLabelOf(pool, pkg),
          packageName: pkg,
        })
      }
    }
    return out
  }, [data.tasks, pool])

  // 当前设备上找不到的应用（可能已卸载，也可能只是没有可启动入口）
  const missingSet = useMemo(() => {
    if (!installed) return new Set<string>()
    return new Set(
      pool.filter((e) => !installed.has(e.packageName)).map((e) => e.packageName),
    )
  }, [pool, installed])

  const orphanCount = pool.filter((e) => !usage.has(e.packageName)).length

  return (
    <div className="pool-compact">
      <header className="shell-header">
        <button className="back-link" onClick={onBack}>
          ← 返回
        </button>
      </header>

      <div className="section" style={{ marginTop: 4 }}>
        <div className="row">
          <div className="section-title">应用池（{pool.length}）</div>
          <div className="spacer" />
          <button
            type="button"
            className="btn sm"
            onClick={() => setPicking(true)}
            disabled={!native}
            title={native ? '从已安装应用里挑选' : '浏览器预览下不可用，请在手机上操作'}
          >
            ＋ 添加应用
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          这里只是应用的「名字缓存」。哪份名单允许、哪份分心，都在各方向的编辑页里定。
        </p>

        {conflicts.length > 0 && (
          <div className="notice-block">
            <div className="notice-title">⚠️ 有 {conflicts.length} 处名单冲突</div>
            <div className="notice-body">
              同一个应用同时出现在某个方向的「允许」和「分心」名单里。按既定规则以「允许」为准：
              计时页仍会给入口，越界提醒也不会命中它。建议去该方向的编辑页删掉其中一侧。
              <ul className="notice-list">
                {conflicts.map((c) => (
                  <li key={c.key}>
                    {c.taskName}：{c.label}
                    <span className="faint">（{c.packageName}）</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {missingSet.size > 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            其中 {missingSet.size} 个在当前设备上找不到（可能已卸载，或没有可启动入口），已灰显。
          </p>
        )}

        {pool.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            还没有应用。点右上角「＋ 添加应用」从已安装列表里挑，或在各方向的编辑页里添加。
          </p>
        ) : (
          <div className="app-pool-list">
            {pool.map((e) => {
              const u = usage.get(e.packageName)
              const unused = !u
              const missing = missingSet.has(e.packageName)
              return (
                <div
                  key={e.packageName}
                  className={`app-pool-row${unused ? ' unused' : ''}${missing ? ' missing' : ''}`}
                >
                  <AppIcon packageName={e.packageName} appName={e.appName} size={30} />
                  <div className="app-pool-main">
                    <div className="app-pool-name">{e.appName}</div>
                    <div className="app-pool-pkg">{e.packageName}</div>
                    <div className="app-pool-refs">
                      {missing && <span className="tag-warn">系统里找不到</span>}
                      {unused ? (
                        !missing && <span className="faint">未被任何方向引用</span>
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

      {picking && (
        <Modal
          title="添加应用"
          onClose={() => setPicking(false)}
          footer={
            <button className="btn primary" onClick={() => setPicking(false)}>
              完成
            </button>
          }
        >
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            从设备已安装的应用里挑选，选中的会记进应用池，之后可在各方向的编辑页里引用。
            已在池中的应用这里点不动——要移除请用列表里的「移除」（会二次确认）。
          </p>
          <AppPicker
            selected={pool.map((e) => e.packageName)}
            pool={pool}
            onToggle={(app: InstalledApp) => {
              // 池内应用不在这里移除：移除会连带清掉所有方向的引用，必须走列表里的二次确认
              if (pool.some((e) => e.packageName === app.packageName)) return
              addAppsToPool([{ packageName: app.packageName, appName: app.appName }])
            }}
          />
        </Modal>
      )}

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
