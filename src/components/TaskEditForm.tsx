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

type ListKind = 'allow' | 'block'

export function TaskEditForm({ task, onClose }: Props) {
  const data = useAppData()
  const pool = data.appPool ?? []

  const [name, setName] = useState(task.name)
  const [weekdays, setWeekdays] = useState<number[]>(task.weekdays ?? [])
  // 方向级应用名单：允许（给入口）/ 分心（不给入口，越界时提醒最重）
  const [allowed, setAllowed] = useState<string[]>(task.allowedApps ?? [])
  const [blocked, setBlocked] = useState<string[]>(task.blockedApps ?? [])
  // 当前打开的选择视图：null = 主表单
  const [picker, setPicker] = useState<ListKind | null>(null)

  const toggleIn = (kind: ListKind, app: InstalledApp) => {
    const cur = kind === 'allow' ? allowed : blocked
    const setCur = kind === 'allow' ? setAllowed : setBlocked
    const other = kind === 'allow' ? blocked : allowed
    const setOther = kind === 'allow' ? setBlocked : setAllowed

    if (cur.includes(app.packageName)) {
      setCur(cur.filter((p) => p !== app.packageName))
      return
    }
    setCur([...cur, app.packageName])
    // 互斥：选进这一侧就从另一侧移除（选择器里已置灰，这里是双保险）
    if (other.includes(app.packageName)) {
      setOther(other.filter((p) => p !== app.packageName))
    }
    // 顺手把元数据写进池子，供别处显示应用名
    addAppsToPool([{ packageName: app.packageName, appName: app.appName }])
  }

  const submit = () => {
    if (!name.trim()) return
    updateTask(task.id, {
      name: name.trim(),
      weekdays,
      allowedApps: allowed,
      blockedApps: blocked,
    })
    onClose()
  }

  const renderChips = (list: string[], kind: ListKind) => (
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
            onClick={() =>
              kind === 'allow'
                ? setAllowed(allowed.filter((p) => p !== pkg))
                : setBlocked(blocked.filter((p) => p !== pkg))
            }
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" className="app-chip add" onClick={() => setPicker(kind)}>
        ＋ 添加
      </button>
    </div>
  )

  // 选择视图：复用同一层 Modal，避免嵌套 Portal 导致 Esc 双关闭
  if (picker) {
    const isAllow = picker === 'allow'
    return (
      <Modal
        title={isAllow ? '允许的应用' : '分心的应用'}
        onClose={() => setPicker(null)}
        footer={
          <button className="btn primary" onClick={() => setPicker(null)}>
            完成
          </button>
        }
      >
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {isAllow
            ? '只有这里选中的应用，才会出现在计时页的图标行里，可点击直接进入。'
            : '该方向明确的分心项：不给入口；开启「越界提醒」后命中它会被立刻提醒。'}
        </p>
        <AppPicker
          selected={isAllow ? allowed : blocked}
          excluded={isAllow ? blocked : allowed}
          pool={pool}
          onToggle={(app) => toggleIn(picker, app)}
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
            允许的应用
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              计时页可直接点开
            </span>
          </label>
          {renderChips(allowed, 'allow')}
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            默认策略是「禁止」：不在这个列表里的应用，计时页不会给它入口。
          </p>
        </div>

        <div className="field">
          <label>
            分心的应用
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              本方向明确要躲开的
            </span>
          </label>
          {renderChips(blocked, 'block')}
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            它们本来就不给入口；列在这里是为了让「越界提醒」逮到时更严厉。
          </p>
        </div>
      </div>
    </Modal>
  )
}
