import { useState } from 'react'
import { Modal } from './Modal'
import { updateTask, useAppData, addAppsToPool, appLabelOf } from '../store'
import { WeekdayPicker } from './WeekdayPicker'
import { AppIcon } from './AppIcon'
import { AppPicker } from './AppPicker'
import type { InstalledApp } from '../appList'
import type { Task } from '../types'

interface Props {
  task: Task
  onClose: () => void
}

// 方向编辑：名称 / 提醒星期 / 放行应用
// v2 起只有**一份**名单语义：放行集合 = 全局白名单 ∪ 本方向额外放行。
// 这里只编辑「额外」那部分；全局部分只读展示，避免同一个应用在两个地方各配一次。
export function TaskEditForm({ task, onClose }: Props) {
  const data = useAppData()
  const pool = data.appPool ?? []
  const globalAllowed = data.globalAllowedApps ?? []

  const [name, setName] = useState(task.name)
  const [weekdays, setWeekdays] = useState<number[]>(task.weekdays ?? [])
  // 方向级：全局之外的额外放行
  const [extra, setExtra] = useState<string[]>(
    (task.allowedApps ?? []).filter((p) => !globalAllowed.includes(p)),
  )
  const [picking, setPicking] = useState(false)

  const toggleExtra = (app: InstalledApp) => {
    if (extra.includes(app.packageName)) {
      setExtra(extra.filter((p) => p !== app.packageName))
      return
    }
    setExtra([...extra, app.packageName])
    // 顺手把元数据写进池子，供别处显示应用名
    addAppsToPool([{ packageName: app.packageName, appName: app.appName }])
  }

  const submit = () => {
    if (!name.trim()) return
    updateTask(task.id, {
      name: name.trim(),
      weekdays,
      allowedApps: extra,
    })
    onClose()
  }

  const renderChips = (list: string[]) => (
    <div className="app-chips">
      {list.length === 0 && (
        <span className="faint" style={{ fontSize: 12 }}>
          未选
        </span>
      )}
      {list.map((pkg) => (
        <span key={pkg} className="app-chip static" title={pkg}>
          <AppIcon packageName={pkg} appName={appLabelOf(pool, pkg)} size={18} />
          <span className="app-chip-name">{appLabelOf(pool, pkg)}</span>
          <button
            type="button"
            className="app-chip-x"
            aria-label={`从名单移除 ${appLabelOf(pool, pkg)}`}
            onClick={() => setExtra(extra.filter((p) => p !== pkg))}
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" className="app-chip add" onClick={() => setPicking(true)}>
        ＋ 添加
      </button>
    </div>
  )

  // 选择视图：复用同一层 Modal，避免嵌套 Portal 导致 Esc 双关闭
  if (picking) {
    return (
      <Modal
        title="额外放行"
        onClose={() => setPicking(false)}
        footer={
          <button className="btn primary" onClick={() => setPicking(false)}>
            完成
          </button>
        }
      >
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          只列全局白名单之外的额外应用。已在全局白名单里的不在这里出现——
          那些在「设置 → 应用白名单」里统一改。
        </p>
        <AppPicker
          selected={extra}
          excluded={globalAllowed}
          pool={pool}
          onToggle={toggleExtra}
        />
      </Modal>
    )
  }

  return (
    <Modal
      title="编辑方向"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            保存
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field">
          <label>名称</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="field">
          <label>
            提醒星期
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              该方向参与次日计划的星期
            </span>
          </label>
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
        </div>

        <div className="field">
          <label>
            继承全局白名单
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              {globalAllowed.length} 个
            </span>
          </label>
          {globalAllowed.length === 0 ? (
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              还没有全局白名单。到「设置 → 应用白名单」里加一次，所有方向共用。
            </p>
          ) : (
            <div className="app-chips">
              {globalAllowed.map((pkg) => (
                <span key={pkg} className="app-chip static" title={pkg}>
                  <AppIcon packageName={pkg} appName={appLabelOf(pool, pkg)} size={18} />
                  <span className="app-chip-name">{appLabelOf(pool, pkg)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label>
            本方向额外放行
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              只属于这个方向
            </span>
          </label>
          {renderChips(extra)}
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            最终放行 = 上面那份 + 这份，只加不减。不在其中的应用计时页不给入口，越界时按「越界管控」的强度处理。
          </p>
        </div>
      </div>
    </Modal>
  )
}
