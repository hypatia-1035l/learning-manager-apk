import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useAppData, updateReminder, regeneratePlanDayInStore, dropPlanForDate, dateKey } from '../store'
import {
  requestNotificationPermission,
  scheduleReminders,
  cancelAllReminders,
  cancelReengageNudge,
  scheduleReengageNudge,
  getNextReminderPreview,
  sendTestReminder,
  isExactAlarmDegraded,
} from '../reminderService'
import {
  canScheduleExactAlarmsNative,
  openExactAlarmSettingsNative,
} from '../studyNotifications'
import type { PlanTiming, TimeWindow, NotificationIntensity } from '../types'

interface Props {
  onClose: () => void
}

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
  return sameDay ? `今天 ${hh}:${mm}` : `明天 ${hh}:${mm}`
}
function formatCountdown(targetAtMs: number): string {
  const diff = Math.max(0, targetAtMs - Date.now())
  const s = Math.floor(diff / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}小时${m}分后`
  if (m > 0) return `${m}分后`
  return `${s % 60}秒后`
}

const TIMING_OPTIONS: { value: PlanTiming; label: string; desc: string }[] = [
  { value: 'random', label: '随机时刻', desc: '时段内随机分布' },
  { value: 'interval', label: '固定间隔', desc: '从时段开始按间隔顺排' },
]

const INTENSITY_OPTIONS: { value: NotificationIntensity; label: string; desc: string }[] = [
  { value: 'strong', label: '强', desc: '声音+震动+弹窗' },
  { value: 'weak', label: '弱', desc: '仅通知栏，不发声' },
  { value: 'silent', label: '静默', desc: '只留记录，最低打扰' },
]

// 提醒设置弹窗：唯一次日计划模式
// 参与星期由各方向自带（编辑方向里设置），此处只配规模 / 节奏 / 时段。
export function ReminderSettings({ onClose }: Props) {
  const data = useAppData()
  const reminder = data.reminder!

  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string>('')
  // 精确闹钟权限降级提示（原生通道未获授权时提醒会漂移）
  const [exactDegraded, setExactDegraded] = useState<boolean>(isExactAlarmDegraded())
  // 刷新倒计时用的 tick
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 探测精确闹钟权限状态（仅 Android 原生通道有意义；Web/iOS 恒为 false）
  useEffect(() => {
    canScheduleExactAlarmsNative()
      .then((ok) => setExactDegraded(!ok))
      .catch(() => {})
  }, [])

  // 表单缓冲
  const [planSessions, setPlanSessions] = useState(String(reminder.planSessions))
  const [planTiming, setPlanTiming] = useState<PlanTiming>(reminder.planTiming)
  const [interval, setIntervalMin] = useState(String(reminder.intervalMinutes))
  const [cooldown, setCooldown] = useState(String(reminder.cooldownMinutes))
  const [skipMinutes, setSkipMinutes] = useState(String(reminder.skipAfterSessionMinutes))
  const [deferMin, setDeferMin] = useState(String(reminder.deferMinutes ?? 0))
  const [reengageDays, setReengageDays] = useState(String(reminder.reengageDays ?? 2))
  const [planLookahead, setPlanLookahead] = useState(String(reminder.planLookaheadDays ?? 3))
  const [intensity, setIntensity] = useState<NotificationIntensity>(reminder.intensity)

  // 时间窗：纯开始/结束
  const [windows, setWindows] = useState<TimeWindow[]>(() =>
    (reminder.windows ?? []).map((w) => ({
      startMinute: typeof w.startMinute === 'number' ? w.startMinute : 9 * 60,
      endMinute: typeof w.endMinute === 'number' ? w.endMinute : 22 * 60,
    })),
  )
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

  const buildNext = (enabled: boolean) => ({
    ...reminder,
    enabled,
    planSessions: clampInt(parseNum(planSessions, 4), 1, 12),
    planTiming,
    intervalMinutes: clampInt(parseNum(interval, 90), 5, 1440),
    cooldownMinutes: clampInt(parseNum(cooldown, 30), 1, 720),
    skipAfterSessionMinutes: clampInt(parseNum(skipMinutes, 0), 0, 480),
    deferMinutes: clampInt(parseNum(deferMin, 0), 0, 120),
    reengageDays: clampInt(parseNum(reengageDays, 2), 0, 14),
    planLookaheadDays: clampInt(parseNum(planLookahead, 3), 1, 7),
    windows: windows.map((w) => ({
      startMinute: clampInt(w.startMinute, 0, 1439),
      endMinute: clampInt(w.endMinute, 0, 1439),
    })),
    intensity,
  })

  const handleToggleEnabled = async (enabled: boolean) => {
    const next = buildNext(enabled)
    updateReminder(next)
    if (enabled) {
      const ok = await requestNotificationPermission()
      setPermGranted(ok)
      if (!ok) { setMsg('未授予通知权限，请在系统设置中开启通知权限'); return }
      // 丢弃今天/明天的旧计划（可能已过期或参数过时），让调度器按新状态重排
      const now = new Date()
      dropPlanForDate(dateKey(now))
      dropPlanForDate(dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)))
      await scheduleReminders()
      await scheduleReengageNudge()
      setMsg('已开启提醒，今天剩余与未来几天的计划已生成，并安排了回归提醒')
    } else {
      await cancelAllReminders()
      await cancelReengageNudge()
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
    // 按新参数重排：今天保留已完成项、重排待办项；明天整体丢弃重排
    const now = new Date()
    regeneratePlanDayInStore(dateKey(now))
    dropPlanForDate(dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)))
    await scheduleReminders()
    await scheduleReengageNudge()
    setBusy(false)
    setMsg('已应用设置，计划已重新生成/调度')
  }

  const handleTest = async () => {
    setTesting(true)
    const ok = await requestNotificationPermission()
    setPermGranted(ok)
    if (!ok) { setMsg('未授予通知权限，无法发送测试提醒'); setTesting(false); return }
    await sendTestReminder()
    setMsg('测试提醒已安排，5 秒后弹出。')
    setTesting(false)
  }

  // 预览：直接读 store 的实时计划（应用前显示的是当前已生效计划）
  const preview = getNextReminderPreview()
  const previewText = !reminder.enabled
    ? '提醒已关闭'
    : !preview
      ? '暂无待提醒的计划项（打开提醒或等下次生成）'
      : `下一计划项 ${formatPreviewTime(preview.at)}（${formatCountdown(preview.at.getTime())}）`

  void tick

  return (
    <Modal
      title="提醒设置"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>关闭</button>
          <button className="btn primary" onClick={handleApply} disabled={busy || !reminder.enabled}>
            {busy ? '调度中…' : '应用并重新生成'}
          </button>
        </>
      }
    >
      <div className="form-stack" style={{ gap: 12 }}>
        {/* 启用 + 预览 */}
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="muted" style={{ fontSize: 14, display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={reminder.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <strong style={{ marginLeft: 6 }}>启用次日计划</strong>
          </label>
          {reminder.enabled && (
            <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{previewText}</p>
          )}
          {permGranted === false && (
            <p className="muted" style={{ color: 'var(--red)', fontSize: 13 }}>
              未授予通知权限。请到系统设置 → 应用 → 今天摸啥鱼 → 通知，开启通知权限。
            </p>
          )}
          {exactDegraded && reminder.enabled && (
            <p
              className="muted"
              style={{
                color: 'var(--orange, #c47f00)',
                fontSize: 13,
                background: 'var(--bg-soft)',
                padding: '8px 10px',
                borderRadius: 8,
                marginTop: 8,
              }}
            >
              未授予「精确闹钟」权限，提醒可能漂移/不准时。
              <button
                className="btn sm"
                style={{ marginLeft: 8 }}
                onClick={async () => {
                  await openExactAlarmSettingsNative()
                  canScheduleExactAlarmsNative()
                    .then((ok) => setExactDegraded(!ok))
                    .catch(() => {})
                }}
              >
                去设置开启
              </button>
            </p>
          )}
        </div>

        {/* 计划规模 */}
        <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
          <label>方向数</label>
          <input
            type="number" className="input" min={1} max={12} step={1}
            value={planSessions}
            onChange={(e) => setPlanSessions(e.target.value)}
            disabled={!reminder.enabled}
          />
        </div>

        {/* 提醒强度 */}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>提醒强度</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {INTENSITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={intensity === o.value ? 'btn primary' : 'btn'}
                style={{ flex: '1 1 80px' }}
                onClick={() => setIntensity(o.value)}
                disabled={!reminder.enabled}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>{o.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 提醒节奏 */}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>提醒节奏</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TIMING_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={planTiming === o.value ? 'btn primary' : 'btn'}
                style={{ flex: '1 1 110px' }}
                onClick={() => setPlanTiming(o.value)}
                disabled={!reminder.enabled}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>{o.desc}</div>
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 12, marginTop: 8 }}>
            {planTiming === 'interval' ? (
              <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
                <label className="faint" style={{ fontSize: 12 }}>间隔</label>
                <input
                  type="number" className="input" min={5} max={1440} step={5}
                  value={interval}
                  onChange={(e) => setIntervalMin(e.target.value)}
                  disabled={!reminder.enabled}
                />
              </div>
            ) : (
              <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
                <label className="faint" style={{ fontSize: 12 }}>最小间隔</label>
                <input
                  type="number" className="input" min={1} max={720} step={5}
                  value={cooldown}
                  onChange={(e) => setCooldown(e.target.value)}
                  disabled={!reminder.enabled}
                />
              </div>
            )}
            <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
              <label className="faint" style={{ fontSize: 12 }}>跳过</label>
              <input
                type="number" className="input" min={0} max={480} step={5}
                value={skipMinutes}
                onChange={(e) => setSkipMinutes(e.target.value)}
                disabled={!reminder.enabled}
              />
            </div>
            <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
              <label className="faint" style={{ fontSize: 12 }}>冲突延迟</label>
              <input
                type="number" className="input" min={0} max={120} step={1}
                value={deferMin}
                onChange={(e) => setDeferMin(e.target.value)}
                disabled={!reminder.enabled}
              />
            </div>
            <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
              <label className="faint" style={{ fontSize: 12 }}>回归提醒</label>
              <input
                type="number" className="input" min={0} max={14} step={1}
                value={reengageDays}
                onChange={(e) => setReengageDays(e.target.value)}
                disabled={!reminder.enabled}
              />
            </div>
            <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
              <label className="faint" style={{ fontSize: 12 }}>提前排程</label>
              <input
                type="number" className="input" min={1} max={7} step={1}
                value={planLookahead}
                onChange={(e) => setPlanLookahead(e.target.value)}
                disabled={!reminder.enabled}
              />
            </div>
          </div>
          {reminder.enabled && (
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              冲突延迟：会话进行中、原定计划项到点时，推迟到本次会话结束后再补发（分钟）；0 = 不延迟（直接丢弃）。多个被冲突项按原顺序错开 1 分钟依次补发。
            </p>
          )}
          {reminder.enabled && (
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              回归提醒：连续 N 天未打开 App，系统推送"该回来摸鱼了"（0 = 关闭）；每次打开都会把提醒往后推 N 天，所以日常打开不会触发。提前排程：计划提醒排到未来 N 天（含今天），使真实计划提醒也能跨天触发。
            </p>
          )}
        </div>

        {/* 时间段 */}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>提醒时间段</label>
          {windows.map((w, i) => {
            const cross = w.startMinute > w.endMinute
            return (
              <div key={i} className="row" style={{ gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="faint" style={{ fontSize: 12 }}>开始</label>
                  <input
                    type="time" className="input"
                    value={minuteToTime(w.startMinute)}
                    onChange={(e) => updateWindow(i, 'startMinute', timeToMinute(e.target.value))}
                    disabled={!reminder.enabled}
                  />
                </div>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="faint" style={{ fontSize: 12 }}>
                    结束{cross && <span style={{ marginLeft: 4 }}>· 跨夜</span>}
                  </label>
                  <input
                    type="time" className="input"
                    value={minuteToTime(w.endMinute)}
                    onChange={(e) => updateWindow(i, 'endMinute', timeToMinute(e.target.value))}
                    disabled={!reminder.enabled}
                  />
                </div>
                <button
                  className="btn sm"
                  onClick={() => removeWindow(i)}
                  disabled={!reminder.enabled || windows.length <= 1}
                >
                  删除
                </button>
              </div>
            )
          })}
          {windows.some((w) => w.startMinute === w.endMinute) && (
            <p className="muted" style={{ color: 'var(--amber)', fontSize: 12, margin: '2px 0 6px' }}>
              存在开始=结束的时段，该段不会排计划。
            </p>
          )}
          <button className="btn sm" onClick={addWindow} disabled={!reminder.enabled || windows.length >= 4}>
            + 加一段
          </button>
        </div>

        {/* 说明与工具 */}
        <div className="field" style={{ marginBottom: 0 }}>
          <p className="faint" style={{ fontSize: 12 }}>
            参与星期在「方向 → 编辑」里设置；有序列倒计时的计划项会显示番茄时长。
            通知卡片带「开始 / 换一个 / 取消」，点开始直接进入计时，结束保存后计划项自动标完成。
          </p>
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={handleTest} disabled={testing}>
              {testing ? '发送中…' : '测试提醒'}
            </button>
            <button
              className="btn sm"
              onClick={async () => {
                setBusy(true)
                await cancelAllReminders()
                await cancelReengageNudge()
                setBusy(false)
                setMsg('已取消所有定时提醒')
              }}
            >
              取消所有提醒
            </button>
          </div>
          {msg && <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{msg}</p>}
        </div>
      </div>
    </Modal>
  )
}
