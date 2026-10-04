import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useAppData, updateReminder } from '../store'
import { getUsageStatsPermissionStatus, openUsageStatsSettings } from '../usageStats'

interface Props {
  onClose: () => void
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}

// 越界提醒设置（P3）：总开关 + 容忍分钟数 + 权限引导
// 仅在「学习计时进行中、本 App 在后台」时由原生前台服务轮询检测（见 StudyTimerService）。
export function GuardSettings({ onClose }: Props) {
  const data = useAppData()
  const reminder = data.reminder!
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [grace, setGrace] = useState(String(reminder.guardGraceMinutes ?? 5))
  const [enabled, setEnabled] = useState(reminder.guardEnabled ?? false)

  useEffect(() => {
    getUsageStatsPermissionStatus()
      .then(setPermGranted)
      .catch(() => {})
  }, [])

  const apply = (nextEnabled: boolean, nextGrace: number) => {
    updateReminder({
      ...reminder,
      guardEnabled: nextEnabled,
      guardGraceMinutes: clampInt(nextGrace, 0, 120),
    })
  }

  const handleToggle = (v: boolean) => {
    setEnabled(v)
    apply(v, Number(grace) || 5)
  }

  const handleGrace = (s: string) => {
    setGrace(s)
    const n = Number(s)
    if (!isNaN(n)) apply(enabled, n)
  }

  return (
    <Modal
      title="越界提醒"
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}
    >
      <div className="form-stack" style={{ gap: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="muted" style={{ fontSize: 14, display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => handleToggle(e.target.checked)}
            />
            <strong style={{ marginLeft: 6 }}>启用越界提醒</strong>
          </label>
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            学习计时进行中、你跑去打开别的 App 时，按方向名单提醒你回来。只提醒不拦截；关闭时零轮询、零耗电。
          </p>
        </div>

        <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
          <label>未列出应用容忍分钟数</label>
          <input
            type="number" className="input" min={0} max={120} step={1}
            value={grace}
            onChange={(e) => handleGrace(e.target.value)}
            disabled={!enabled}
          />
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            命中「分心名单」立即提醒；命中「未列出」的应用需停留超过该分钟数才提醒；命中「允许名单」不打扰。
          </p>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          {permGranted === false ? (
            <p
              className="muted"
              style={{
                color: 'var(--red)', fontSize: 13,
                background: 'var(--bg-soft)', padding: '8px 10px', borderRadius: 8,
              }}
            >
              未授予「使用情况访问」权限，越界检测无法读取前台应用。开启越界提醒后请点下方按钮去系统设置开启。
            </p>
          ) : (
            <p className="faint" style={{ fontSize: 12 }}>
              越界检测依赖系统「使用情况访问」权限（非运行时弹窗，需手动授予）。
            </p>
          )}
          <button
            className="btn sm"
            style={{ marginTop: 8 }}
            onClick={async () => {
              await openUsageStatsSettings()
              getUsageStatsPermissionStatus().then(setPermGranted).catch(() => {})
            }}
          >
            去设置开启「使用情况访问」
          </button>
        </div>
      </div>
    </Modal>
  )
}
