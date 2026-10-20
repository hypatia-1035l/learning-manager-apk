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

  // 解析输入框里的容忍分钟数：空白/非法回退 5，0 是合法值（= 未列出应用立即提醒）
  const parseGrace = (s: string): number => {
    const t = s.trim()
    if (!t) return 5
    const n = Number(t)
    return Number.isFinite(n) ? clampInt(n, 0, 120) : 5
  }

  const handleToggle = (v: boolean) => {
    setEnabled(v)
    // 注意不能用 `Number(grace) || 5`：0 是合法值，falsy 会被静默改成 5
    const g = parseGrace(grace)
    setGrace(String(g))
    apply(v, g)
  }

  const handleGrace = (s: string) => {
    setGrace(s)
    // 输入过程允许暂时为空；只在能解析成数字时落盘，避免边打字边写入回退值
    if (!s.trim()) return
    const n = Number(s)
    if (Number.isFinite(n)) apply(enabled, n)
  }

  // 失焦时把输入规整成最终落盘值，保证界面显示与实际持久化一致
  const handleGraceBlur = () => {
    const g = parseGrace(grace)
    setGrace(String(g))
    apply(enabled, g)
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
            onBlur={handleGraceBlur}
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
