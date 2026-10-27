import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useAppData, updateReminder } from '../store'
import { getUsageStatsPermissionStatus, openUsageStatsSettings } from '../usageStats'
import { GUARD_LEVEL_LABELS } from '../types'
import type { GuardLevel, ReminderConfig } from '../types'

interface Props {
  onClose: () => void
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}

// 三档顺序：关闭 / 提醒 / 拉回
const LEVELS: GuardLevel[] = ['off', 'warn', 'pull']

// 越界管控设置：三档 + 宽限秒数 + 权限引导
// 检测在原生 StudyTimerService 里做（仅学习计时进行中、本 App 在后台时轮询）。
// 判定依据只有一个：当前前台应用是否在「放行集合」内（全局白名单 ∪ 方向额外放行 ∪ 自动放行）。
export function GuardSettings({ onClose }: Props) {
  const data = useAppData()
  const reminder = data.reminder!
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [grace, setGrace] = useState(String(reminder.guardGraceSeconds ?? 5))
  const level: GuardLevel = reminder.guardLevel ?? 'off'

  useEffect(() => {
    getUsageStatsPermissionStatus()
      .then(setPermGranted)
      .catch(() => {})
  }, [])

  const apply = (patch: Partial<ReminderConfig>) => updateReminder({ ...reminder, ...patch })

  // 解析宽限秒数：空白/非法回退 5，0 是合法值（= 立刻算越界）
  const parseGrace = (s: string): number => {
    const t = s.trim()
    if (!t) return 5
    const n = Number(t)
    return Number.isFinite(n) ? clampInt(n, 0, 600) : 5
  }

  const handleLevel = (v: GuardLevel) => {
    // 拉回档在 B1 不落地（原生仍按提醒执行），这里不允许选，避免给出按了没反应的开关
    if (v === 'pull') return
    const g = parseGrace(grace)
    setGrace(String(g))
    apply({ guardLevel: v, guardGraceSeconds: g })
  }

  const handleGrace = (s: string) => {
    setGrace(s)
    // 输入过程允许暂时为空；只在能解析成数字时落盘，避免边打字边写入回退值
    if (!s.trim()) return
    const n = Number(s)
    if (Number.isFinite(n)) apply({ guardGraceSeconds: clampInt(n, 0, 600) })
  }

  // 失焦时把输入规整成最终落盘值，保证界面显示与实际持久化一致
  const handleGraceBlur = () => {
    const g = parseGrace(grace)
    setGrace(String(g))
    apply({ guardGraceSeconds: g })
  }

  return (
    <Modal
      title="越界管控"
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}
    >
      <div className="form-stack" style={{ gap: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>强度</label>
          <div className="seg-row">
            {LEVELS.map((lv) => {
              const isPull = lv === 'pull'
              return (
                <button
                  key={lv}
                  type="button"
                  className={`seg-item ${level === lv ? 'active' : ''}`}
                  disabled={isPull}
                  title={isPull ? '需要悬浮窗权限，下一版提供；现在选它也只能提醒' : undefined}
                  onClick={() => handleLevel(lv)}
                >
                  {GUARD_LEVEL_LABELS[lv]}
                </button>
              )
            })}
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            计时进行中跑去开别的 App，按这里的强度处理。
            「离开就拉回」需要悬浮窗权限，要在下一版才落地，现在灰着；选它会按「只提醒」执行，不给你假开关。
          </p>
        </div>

        <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
          <label>
            宽限时间（秒）
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              离开后多久才算越界
            </span>
          </label>
          <input
            type="number" className="input" min={0} max={600} step={1}
            value={grace}
            onChange={(e) => handleGrace(e.target.value)}
            onBlur={handleGraceBlur}
            disabled={level === 'off'}
          />
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            默认 5 秒：切出去看一眼消息、按一下 Home 键不会立刻响。
            只要前台不在放行集合里（全局白名单 + 方向额外放行 + 本 App/桌面/输入法/拨号/系统界面）就计时。
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
              未授予「使用情况访问」权限，越界检测读不到前台应用，开了也不会生效。请点下方按钮去系统设置开启。
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
