import { useState } from 'react'
import { useAppData, updateReminder, getReminderPool } from '../store'
import { getTypeLabel } from '../taskTypes'
import {
  requestNotificationPermission,
  scheduleReminders,
  cancelAllReminders,
} from '../reminderService'

interface Props {
  onBack: () => void
}

export function ReminderSettings({ onBack }: Props) {
  const data = useAppData()
  const reminder = data.reminder!
  const [busy, setBusy] = useState(false)
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string>('')

  const pool = getReminderPool(data.tasks, reminder)

  const handleToggleEnabled = async (enabled: boolean) => {
    updateReminder({ enabled })
    if (enabled) {
      const ok = await requestNotificationPermission()
      setPermGranted(ok)
      if (!ok) {
        setMsg('未授予通知权限，请在系统设置中开启通知权限')
        return
      }
      await scheduleReminders(data.tasks, { ...reminder, enabled: true })
      setMsg('已开启提醒，调度已生效')
    } else {
      await cancelAllReminders()
      setMsg('已关闭提醒，所有定时通知已取消')
    }
  }

  const handleNumberChange = async (
    field: 'intervalMinutes' | 'cooldownMinutes' | 'startHour' | 'endHour',
    value: number,
  ) => {
    updateReminder({ [field]: value } as any)
  }

  // 调整后点保存才重新调度，避免频繁调度
  const handleApply = async () => {
    setBusy(true)
    const ok = await requestNotificationPermission()
    setPermGranted(ok)
    if (!ok) {
      setMsg('未授予通知权限')
      setBusy(false)
      return
    }
    await scheduleReminders(data.tasks, data.reminder!)
    setBusy(false)
    setMsg('已应用设置并重新调度提醒')
  }

  const toggleTask = (taskId: string, checked: boolean) => {
    const set = new Set(reminder.enabledTaskIds)
    if (checked) set.add(taskId)
    else set.delete(taskId)
    updateReminder({ enabledTaskIds: Array.from(set) })
  }

  const isRandomMode = reminder.intervalMinutes === 0

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← 返回
      </button>
      <header className="app-header">
        <h1 className="app-title">提醒设置</h1>
      </header>
      <p className="app-tagline">
        让应用主动提醒你开始一个任务 · 间隔为 0 即随机提醒
      </p>

      {/* 总开关 */}
      <section className="section">
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="muted" style={{ fontSize: 14 }}>
            <input
              type="checkbox"
              checked={reminder.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <strong style={{ marginLeft: 6 }}>启用提醒</strong>
          </label>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 12 }}>
            {reminder.enabled ? '已开启' : '已关闭'}
          </span>
        </div>
        {permGranted === false && (
          <p className="muted" style={{ color: 'var(--red)', fontSize: 13 }}>
            未授予通知权限。请到系统设置 → 应用 → 今天摸啥鱼 → 通知，开启通知权限。
          </p>
        )}
      </section>

      {/* 时间参数 */}
      <section className="section">
        <div className="section-title">时间设置</div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>
            提醒间隔（分钟）<span className="faint" style={{ fontSize: 12 }}>· 0 = 随机提醒</span>
          </label>
          <input
            type="number"
            className="input"
            min={0}
            step={5}
            value={reminder.intervalMinutes}
            onChange={(e) =>
              handleNumberChange(
                'intervalMinutes',
                Math.max(0, Number(e.target.value) || 0),
              )
            }
            disabled={!reminder.enabled}
          />
          <span className="faint" style={{ fontSize: 12 }}>
            {isRandomMode
              ? '随机提醒：在提醒窗口内随机时机触发'
              : '固定间隔：每隔该时长触发一次提醒'}
          </span>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>冷却时间（分钟）</label>
          <input
            type="number"
            className="input"
            min={1}
            step={5}
            value={reminder.cooldownMinutes}
            onChange={(e) =>
              handleNumberChange(
                'cooldownMinutes',
                Math.max(1, Number(e.target.value) || 30),
              )
            }
            disabled={!reminder.enabled}
          />
          <span className="faint" style={{ fontSize: 12 }}>
            两次提醒之间的最小间隔，避免频繁打扰
          </span>
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>窗口开始（小时 0-23）</label>
            <input
              type="number"
              className="input"
              min={0}
              max={23}
              value={reminder.startHour}
              onChange={(e) =>
                handleNumberChange(
                  'startHour',
                  Math.min(23, Math.max(0, Number(e.target.value) || 0)),
                )
              }
              disabled={!reminder.enabled}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>窗口结束（小时 0-23）</label>
            <input
              type="number"
              className="input"
              min={0}
              max={23}
              value={reminder.endHour}
              onChange={(e) =>
                handleNumberChange(
                  'endHour',
                  Math.min(23, Math.max(0, Number(e.target.value) || 0)),
                )
              }
              disabled={!reminder.enabled}
            />
          </div>
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          只在 {reminder.startHour}:00 - {reminder.endHour}:00 之间触发提醒，避免深夜打扰。
        </p>
      </section>

      {/* 提醒池：具体任务 */}
      <section className="section">
        <div className="section-title">
          提醒池 · 具体任务
          <span className="count">（{pool.length} 项参与）</span>
        </div>
        {data.tasks.length === 0 ? (
          <p className="faint">还没有任务，先去任务池添加。</p>
        ) : (
          <div className="obj-list">
            {data.tasks.map((task) => {
              const checked =
                reminder.enabledTaskIds.length === 0 ||
                reminder.enabledTaskIds.includes(task.id)
              const inPool = pool.some((t) => t.id === task.id)
              return (
                <div
                  key={task.id}
                  className={`obj-item ${inPool ? 'current' : ''}`}
                >
                  <span className="tc-icon">{task.icon}</span>
                  <span className="name">{task.name}</span>
                  <span className="prog">
                    {getTypeLabel(task.type)}
                  </span>
                  <div className="ops">
                    <label className="muted" style={{ fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!reminder.enabled || !task.enabled}
                        onChange={(e) => toggleTask(task.id, e.target.checked)}
                      />
                      参与
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          注：未启用的任务无法参与提醒。白名单为空时，所有已启用任务都参与。
        </p>
      </section>

      {/* 操作 */}
      <section className="section">
        <div className="row">
          <button
            className="btn primary"
            onClick={handleApply}
            disabled={busy || !reminder.enabled}
          >
            {busy ? '调度中…' : '应用并重新调度'}
          </button>
          <button
            className="btn"
            onClick={async () => {
              setBusy(true)
              await cancelAllReminders()
              setBusy(false)
              setMsg('已取消所有定时提醒')
            }}
          >
            取消所有提醒
          </button>
        </div>
        {msg && (
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            {msg}
          </p>
        )}
      </section>
    </div>
  )
}
