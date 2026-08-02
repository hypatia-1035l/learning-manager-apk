import { useEffect, useState } from 'react'
import {
  useAppData,
  updateReminder,
  getReminderPool,
  getReminderFiredToday,
} from '../store'
import {
  requestNotificationPermission,
  scheduleReminders,
  cancelAllReminders,
  getNextReminderPreview,
  sendTestReminder,
} from '../reminderService'
import type {
  ReminderConfig,
  ReminderDailyMode,
  TimeWindow,
} from '../types'

interface Props {
  onBack: () => void
}

const WEEKDAY_LABELS: { label: string; value: number }[] = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 0 },
]

const MODE_OPTIONS: { value: ReminderDailyMode; label: string; desc: string }[] = [
  { value: 'interval',   label: '固定间隔', desc: '按固定分钟数提醒' },
  { value: 'random',     label: '随机提醒', desc: '窗口内随机时间点提醒' },
  { value: 'dailyCount', label: '每日固定次数', desc: '均匀分布提醒' },
]

function parseNum(s: string, fallback: number): number {
  const trimmed = s.trim()
  if (!trimmed) return fallback
  const n = Number(trimmed)
  return isNaN(n) ? fallback : n
}
function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}
function minuteToTime(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
function timeToMinute(t: string): number {
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return 0
  return clampInt(h * 60 + m, 0, 1439)
}
function formatPreviewTime(d: Date): string {
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return sameDay ? `${hh}:${mm}` : `明天 ${hh}:${mm}`
}
function formatCountdown(targetAtMs: number): string {
  const diff = Math.max(0, targetAtMs - Date.now())
  const s = Math.floor(diff / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}小时${m}分${sec}秒后`
  if (m > 0) return `${m}分${sec}秒后`
  return `${sec}秒后`
}

export function ReminderSettings({ onBack }: Props) {
  const data = useAppData()
  const reminder = data.reminder!

  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string>('')

  // 刷新计数/倒计时用的 tick
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 模式
  const [mode, setMode] = useState<ReminderDailyMode>(reminder.dailyMode)
  // 数字缓冲
  const [interval, setIntervalMin] = useState(String(reminder.intervalMinutes))
  const [cooldown, setCooldown] = useState(String(reminder.cooldownMinutes))
  const [dailyCount, setDailyCount] = useState(String(reminder.dailyCount))
  const [skipMinutes, setSkipMinutes] = useState(String(reminder.skipAfterSessionMinutes))

  // 时间窗：支持多个
  const [windows, setWindows] = useState<TimeWindow[]>(() => {
    if (reminder.windows && reminder.windows.length) {
      return reminder.windows.map((w) => ({
        startMinute: typeof w.startMinute === 'number' ? w.startMinute : 9 * 60,
        endMinute:   typeof w.endMinute   === 'number' ? w.endMinute   : 22 * 60,
      }))
    }
    return [{
      startMinute: typeof reminder.startMinute === 'number' ? reminder.startMinute : 9 * 60,
      endMinute:   typeof reminder.endMinute   === 'number' ? reminder.endMinute   : 22 * 60,
    }]
  })
  const addWindow = () => {
    setWindows((ws) => {
      if (ws.length >= 4) return ws
      const last = ws[ws.length - 1]
      return [...ws, { startMinute: last?.endMinute ?? 9 * 60, endMinute: 22 * 60 }]
    })
  }
  const removeWindow = (idx: number) =>
    setWindows((ws) => (ws.length <= 1 ? ws : ws.filter((_, i) => i !== idx)))
  const updateWindow = (idx: number, k: 'startMinute' | 'endMinute', v: number) =>
    setWindows((ws) => ws.map((w, i) => (i === idx ? { ...w, [k]: v } : w)))

  // 星期白名单
  const [wdays, setWdays] = useState<number[]>(
    reminder.enabledWeekdays?.length
      ? reminder.enabledWeekdays
      : [1, 2, 3, 4, 5, 6, 0],
  )
  const toggleWday = (v: number) => {
    const s = new Set(wdays)
    if (s.has(v)) {
      if (s.size > 1) s.delete(v)
    } else s.add(v)
    setWdays(Array.from(s).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)))
  }

  const pool = getReminderPool(data.tasks, reminder)

  const buildNext = (enabled: boolean): ReminderConfig => {
    const dailyMode: ReminderDailyMode =
      mode === 'dailyCount' ? 'dailyCount' : mode === 'interval' ? 'interval' : 'random'
    const intervalV = clampInt(parseNum(interval, dailyMode === 'random' ? 0 : 60), 0, 1440)
    const dailyCountV = clampInt(parseNum(dailyCount, 6), 1, 96)
    return {
      ...reminder,
      enabled,
      dailyMode,
      intervalMinutes: dailyMode === 'random' ? 0 : intervalV,
      dailyCount: dailyCountV,
      cooldownMinutes: clampInt(parseNum(cooldown, 30), 1, 720),
      windows: windows.map((w) => ({
        startMinute: clampInt(w.startMinute, 0, 1439),
        endMinute: clampInt(w.endMinute, 0, 1439),
      })),
      // 兼容旧字段，用第一窗填充
      startMinute: clampInt(windows[0].startMinute, 0, 1439),
      endMinute:   clampInt(windows[0].endMinute,   0, 1439),
      enabledWeekdays: wdays.length ? wdays : [0,1,2,3,4,5,6],
      skipAfterSessionMinutes: clampInt(parseNum(skipMinutes, 0), 0, 480),
    }
  }

  const handleToggleEnabled = async (enabled: boolean) => {
    const next = buildNext(enabled)
    updateReminder(next)
    if (enabled) {
      const ok = await requestNotificationPermission()
      setPermGranted(ok)
      if (!ok) { setMsg('未授予通知权限，请在系统设置中开启通知权限'); return }
      await scheduleReminders(data.tasks, next)
      setMsg('已开启提醒，调度已生效')
    } else {
      await cancelAllReminders()
      setMsg('已关闭提醒，所有定时通知已取消')
    }
  }

  const handleApply = async () => {
    setBusy(true)
    const ok = await requestNotificationPermission()
    setPermGranted(ok)
    if (!ok) { setMsg('未授予通知权限'); setBusy(false); return }
    const next = buildNext(reminder.enabled)
    updateReminder(next)
    await scheduleReminders(data.tasks, next)
    setBusy(false)
    setMsg('已应用设置并重新调度提醒')
  }

  const toggleTask = async (taskId: string, checked: boolean) => {
    const set = new Set(reminder.enabledTaskIds)
    if (checked) set.add(taskId)
    else set.delete(taskId)
    const next = buildNext(reminder.enabled)
    next.enabledTaskIds = Array.from(set)
    updateReminder(next)
    if (reminder.enabled) await scheduleReminders(data.tasks, next)
  }

  const handleTest = async () => {
    setTesting(true)
    const ok = await requestNotificationPermission()
    setPermGranted(ok)
    if (!ok) { setMsg('未授予通知权限，无法发送测试提醒'); setTesting(false); return }
    await sendTestReminder()
    setMsg('测试提醒已安排，5 秒后弹出。点击“10分钟后/30分钟后/忽略”不会进入 App。')
    setTesting(false)
  }

  const next = buildNext(reminder.enabled)
  const preview = getNextReminderPreview(data.tasks, next)
  const todayFired = getReminderFiredToday()
  const todayText = `今日已提醒 ${todayFired.count} 次（${todayFired.date || '今日'}）`

  const previewText = !reminder.enabled
    ? '提醒已关闭'
    : !preview
      ? '提醒池为空，暂无提醒可调度'
      : preview.mode === 'windowStart'
        ? `下一窗口开始 ${formatPreviewTime(preview.at)} 触发（${formatCountdown(preview.at.getTime())}）`
        : preview.mode === 'skipSession'
          ? `学习后跳过中，${formatPreviewTime(preview.at)} 恢复（${formatCountdown(preview.at.getTime())}）`
          : preview.mode === 'dailyCount'
            ? `下次提醒 ${formatPreviewTime(preview.at)}（${formatCountdown(preview.at.getTime())}，今日固定 ${next.dailyCount} 次）`
            : preview.mode === 'fixed'
              ? `下次提醒 ${formatPreviewTime(preview.at)}（${formatCountdown(preview.at.getTime())}）`
              : `窗口内随机触发（最早 ${formatPreviewTime(preview.at)}，${formatCountdown(preview.at.getTime())}）`

  void tick

  return (
    <div>
      <button className="back-link" onClick={onBack}>← 返回</button>
      <header className="app-header">
        <h1 className="app-title">提醒设置</h1>
      </header>
      <p className="app-tagline">
        让应用主动提醒你开始一个任务 · 通知卡片上的延迟/忽略可直接处理，不必进入 App
      </p>

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
            {reminder.enabled ? '已开启' : '已关闭'} · {todayText}
          </span>
        </div>
        {permGranted === false && (
          <p className="muted" style={{ color: 'var(--red)', fontSize: 13 }}>
            未授予通知权限。请到系统设置 → 应用 → 今天摸啥鱼 → 通知，开启通知权限。
          </p>
        )}
        {reminder.enabled && (
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{previewText}</p>
        )}
      </section>

      <section className="section">
        <div className="section-title">提醒模式</div>
        <div className="segmented" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MODE_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={mode === o.value ? 'btn primary' : 'btn'}
              style={{ flex: '1 1 96px' }}
              onClick={() => setMode(o.value)}
              disabled={!reminder.enabled}
            >
              <div style={{ fontWeight: 600 }}>{o.label}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>{o.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-title">时间参数</div>

        <div className="row wrap" style={{ gap: 12, marginBottom: 10 }}>
          {mode !== 'random' && (
            <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}>
              <label>
                间隔（分钟）
                <span className="faint" style={{ fontSize: 12 }}> · 1–1440</span>
              </label>
              <input
                type="number" className="input" min={1} max={1440} step={5}
                value={interval}
                onChange={(e) => setIntervalMin(e.target.value)}
                disabled={!reminder.enabled}
              />
            </div>
          )}
          {mode === 'dailyCount' && (
            <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}>
              <label>
                每日次数
                <span className="faint" style={{ fontSize: 12 }}> · 1–96 次，均匀分布</span>
              </label>
              <input
                type="number" className="input" min={1} max={96} step={1}
                value={dailyCount}
                onChange={(e) => setDailyCount(e.target.value)}
                disabled={!reminder.enabled}
              />
            </div>
          )}
          <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}>
            <label>
              冷却（分钟）
              <span className="faint" style={{ fontSize: 12 }}> · 1–720</span>
            </label>
            <input
              type="number" className="input" min={1} max={720} step={5}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              disabled={!reminder.enabled}
            />
            <span className="faint" style={{ fontSize: 12 }}>两次提醒之间的最小间隔</span>
          </div>
          <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}>
            <label>
              学习后跳过（分钟）
              <span className="faint" style={{ fontSize: 12 }}> · 0=关闭，上限 480</span>
            </label>
            <input
              type="number" className="input" min={0} max={480} step={5}
              value={skipMinutes}
              onChange={(e) => setSkipMinutes(e.target.value)}
              disabled={!reminder.enabled}
            />
            <span className="faint" style={{ fontSize: 12 }}>刚学完的一段时间内不再提醒你</span>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 10 }}>提醒时间段（最多 4 段）</div>
        {windows.map((w, i) => {
          const cross = w.startMinute > w.endMinute
          const empty = w.startMinute === w.endMinute
          return (
            <div key={i} className="row wrap" style={{ gap: 12, marginBottom: 10, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 120px', marginBottom: 0 }}>
                <label>第 {i + 1} 段 · 开始</label>
                <input
                  type="time" className="input"
                  value={minuteToTime(w.startMinute)}
                  onChange={(e) => updateWindow(i, 'startMinute', timeToMinute(e.target.value))}
                  disabled={!reminder.enabled}
                />
              </div>
              <div className="field" style={{ flex: '1 1 120px', marginBottom: 0 }}>
                <label>
                  结束
                  {cross && <span className="faint" style={{ fontSize: 12 }}> · 跨夜</span>}
                </label>
                <input
                  type="time" className="input"
                  value={minuteToTime(w.endMinute)}
                  onChange={(e) => updateWindow(i, 'endMinute', timeToMinute(e.target.value))}
                  disabled={!reminder.enabled}
                />
              </div>
              <button
                className="btn"
                onClick={() => removeWindow(i)}
                disabled={!reminder.enabled || windows.length <= 1}
                style={{ alignSelf: 'center' }}
              >
                删除
              </button>
              {empty && (
                <p className="muted" style={{ color: 'var(--amber)', fontSize: 12, margin: '4px 0 0', flex: '1 1 100%' }}>
                  该段开始=结束，不会触发。请调整结束时间。
                </p>
              )}
            </div>
          )
        })}
        <button
          className="btn"
          onClick={addWindow}
          disabled={!reminder.enabled || windows.length >= 4}
        >
          + 加一段
        </button>
      </section>

      <section className="section">
        <div className="section-title">生效星期</div>
        <div className="row wrap" style={{ gap: 6 }}>
          {WEEKDAY_LABELS.map((w) => {
            const on = wdays.includes(w.value)
            return (
              <button
                key={w.value}
                className={on ? 'btn primary' : 'btn'}
                onClick={() => toggleWday(w.value)}
                disabled={!reminder.enabled}
                style={{ minWidth: 48 }}
              >
                周{w.label}
              </button>
            )
          })}
        </div>
      </section>

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
                <div key={task.id} className={`obj-item ${inPool ? 'current' : ''}`}>
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
          未启用的任务无法参与提醒。白名单为空时，所有已启用任务都参与。勾选后自动重调度。
        </p>
      </section>

      <section className="section">
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn primary" onClick={handleApply} disabled={busy || !reminder.enabled}>
            {busy ? '调度中…' : '应用并重新调度'}
          </button>
          <button className="btn" onClick={handleTest} disabled={testing}>
            {testing ? '发送中…' : '立即测试提醒'}
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
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{msg}</p>
        )}
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          修改后点击「应用并重新调度」生效；任务勾选会自动重调度；
          测试提醒带“10分钟后/30分钟后/忽略”按钮，点击后不会进入 App。
        </p>
      </section>
    </div>
  )
}
