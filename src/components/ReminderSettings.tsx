import { useState } from 'react'
import { useAppData, updateReminder, getReminderPool } from '../store'
import {
  requestNotificationPermission,
  scheduleReminders,
  cancelAllReminders,
} from '../reminderService'

interface Props {
  onBack: () => void
}

// 解析输入框字符串为数字：空或非法时返回 fallback
function parseNum(s: string, fallback: number): number {
  const trimmed = s.trim()
  if (!trimmed) return fallback
  const n = Number(trimmed)
  return isNaN(n) ? fallback : n
}

// 分钟数（0-1439） <-> "HH:MM" 互转（time input 值格式）
function minuteToTime(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
function timeToMinute(t: string): number {
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return 0
  return Math.min(1439, Math.max(0, h * 60 + m))
}

export function ReminderSettings({ onBack }: Props) {
  const data = useAppData()
  const reminder = data.reminder!
  const [busy, setBusy] = useState(false)
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string>('')

  // 数字字段使用本地 state 缓冲，避免清空时被立即重写为默认值
  // 仅在「应用并重新调度」或「切换开关」时才提交到 store
  const [interval, setIntervalMin] = useState(String(reminder.intervalMinutes))
  const [cooldown, setCooldown] = useState(String(reminder.cooldownMinutes))
  // 时间窗用原生 time 选择器，缓冲 "HH:MM" 字符串
  const [startTime, setStartTime] = useState(minuteToTime(reminder.startMinute))
  const [endTime, setEndTime] = useState(minuteToTime(reminder.endMinute))

  const pool = getReminderPool(data.tasks, reminder)

  // 由本地缓冲字段构造完整的下一份 reminder 配置
  const buildNext = (enabled: boolean) => ({
    ...reminder,
    enabled,
    intervalMinutes: Math.max(0, parseNum(interval, 0)),
    cooldownMinutes: Math.max(1, parseNum(cooldown, 30)),
    startMinute: timeToMinute(startTime),
    endMinute: timeToMinute(endTime),
  })

  const handleToggleEnabled = async (enabled: boolean) => {
    const next = buildNext(enabled)
    updateReminder(next)
    if (enabled) {
      const ok = await requestNotificationPermission()
      setPermGranted(ok)
      if (!ok) {
        setMsg('未授予通知权限，请在系统设置中开启通知权限')
        return
      }
      await scheduleReminders(data.tasks, next)
      setMsg('已开启提醒，调度已生效')
    } else {
      await cancelAllReminders()
      setMsg('已关闭提醒，所有定时通知已取消')
    }
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
    const next = buildNext(reminder.enabled)
    updateReminder(next)
    await scheduleReminders(data.tasks, next)
    setBusy(false)
    setMsg('已应用设置并重新调度提醒')
  }

  const toggleTask = (taskId: string, checked: boolean) => {
    const set = new Set(reminder.enabledTaskIds)
    if (checked) set.add(taskId)
    else set.delete(taskId)
    updateReminder({ enabledTaskIds: Array.from(set) })
  }

  const isRandomMode = parseNum(interval, 0) === 0

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
            value={interval}
            onChange={(e) => setIntervalMin(e.target.value)}
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
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
            disabled={!reminder.enabled}
          />
          <span className="faint" style={{ fontSize: 12 }}>
            两次提醒之间的最小间隔，避免频繁打扰
          </span>
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>窗口开始</label>
            <input
              type="time"
              className="input"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={!reminder.enabled}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>窗口结束</label>
            <input
              type="time"
              className="input"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={!reminder.enabled}
            />
          </div>
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          只在 {startTime} - {endTime} 之间触发提醒，避免深夜打扰。
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
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          修改数字后点击「应用并重新调度」才会生效。
        </p>
      </section>
    </div>
  )
}
