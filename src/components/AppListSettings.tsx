// 应用白名单（设置子页）—— 维护**全局**放行名单
//
// v2 起只有一份策略语义：
//   最终放行 = 自动放行（本 App/桌面/输入法/拨号/系统界面）
//            ∪ 全局白名单（本页维护）
//            ∪ 方向额外放行（各方向编辑页维护，本页只读摘要）
// 只做加法，没有黑名单，也没有"方向级排除全局项"。
import { useEffect, useMemo, useState } from 'react'
import {
  useAppData,
  appLabelOf,
  addAppToGlobalAllowed,
  removeAppFromGlobalAllowed,
  addAppsToPool,
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
  const globalAllowed = data.globalAllowedApps ?? []
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
        // 也可能来自异常环境，直接当成「全都被卸载」会把整个名单标灰
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

  const missingSet = useMemo(() => {
    if (!installed) return new Set<string>()
    return new Set(globalAllowed.filter((p) => !installed.has(p)))
  }, [globalAllowed, installed])

  // 各方向的额外放行摘要（只读，指向方向编辑页去改）
  const extrasByTask = useMemo(() => {
    return data.tasks
      .map((t) => ({
        id: t.id,
        name: t.name,
        extras: (t.allowedApps ?? []).filter((p) => !globalAllowed.includes(p)),
      }))
      .filter((x) => x.extras.length > 0)
  }, [data.tasks, globalAllowed])

  return (
    <div className="pool-compact">
      <header className="shell-header">
        <button className="back-link" onClick={onBack}>
          ← 返回
        </button>
      </header>

      <div className="section" style={{ marginTop: 4 }}>
        <div className="row">
          <div className="section-title">全局白名单（{globalAllowed.length}）</div>
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
          这里的应用**所有方向共用**（词典、识日这类哪个方向都要开的，加一次就够）。
          各方向还能在自己的编辑页里额外放行几个，两者取并集。
        </p>

        {missingSet.size > 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            其中 {missingSet.size} 个在当前设备上找不到（可能已卸载，或没有可启动入口），已灰显。
          </p>
        )}

        {globalAllowed.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            还没有全局白名单。点右上角「＋ 添加应用」挑几个常用的；也可以只在各方向里单独加。
          </p>
        ) : (
          <div className="app-pool-list">
            {globalAllowed.map((pkg) => {
              const missing = missingSet.has(pkg)
              return (
                <div
                  key={pkg}
                  className={`app-pool-row${missing ? ' missing' : ''}`}
                >
                  <AppIcon packageName={pkg} appName={appLabelOf(pool, pkg)} size={30} />
                  <div className="app-pool-main">
                    <div className="app-pool-name">{appLabelOf(pool, pkg)}</div>
                    <div className="app-pool-pkg">{pkg}</div>
                    <div className="app-pool-refs">
                      {missing && <span className="tag-warn">系统里找不到</span>}
                      <span className="tag-allow">全局 · 所有方向</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="app-pool-del"
                    onClick={() => setPendingRemove(pkg)}
                    title="从全局白名单移除"
                  >
                    移除
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {extrasByTask.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 18, fontSize: 14 }}>
              各方向的额外放行
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              这些只在对应方向生效，改要去方向详情页的「编辑」。
            </p>
            <div className="app-pool-list">
              {extrasByTask.map((t) => (
                <div key={t.id} className="app-pool-row unused">
                  <div className="app-pool-main">
                    <div className="app-pool-name">{t.name}</div>
                    <div className="app-pool-refs">
                      <span className="tag-allow">
                        {t.extras.map((p) => appLabelOf(pool, p)).join('、')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          另外这些应用**永远放行**，不用手动加：本 App、桌面、输入法、电话、系统界面。
          不加它们，按 Home 键或打字时会被当成越界。
        </p>
      </div>

      {picking && (
        <Modal
          title="加入全局白名单"
          onClose={() => setPicking(false)}
          footer={
            <button className="btn primary" onClick={() => setPicking(false)}>
              完成
            </button>
          }
        >
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            选中的会立刻进入全局白名单，所有方向共用。已在名单里的这里显示为已勾选，再点一次可移除。
          </p>
          <AppPicker
            selected={globalAllowed}
            pool={pool}
            onToggle={(app: InstalledApp) => {
              if (globalAllowed.includes(app.packageName)) {
                removeAppFromGlobalAllowed(app.packageName)
                return
              }
              addAppToGlobalAllowed(app.packageName, app.appName)
              addAppsToPool([{ packageName: app.packageName, appName: app.appName }])
            }}
          />
        </Modal>
      )}

      {pendingRemove && (
        <ConfirmModal
          title="移出全局白名单"
          message={`确定把「${appLabelOf(pool, pendingRemove)}」移出全局白名单？\n\n所有方向都会失去这个入口。各方向自己额外加的那份不受影响。`}
          confirmText="移除"
          onConfirm={() => {
            removeAppFromGlobalAllowed(pendingRemove)
            setPendingRemove(null)
          }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}
