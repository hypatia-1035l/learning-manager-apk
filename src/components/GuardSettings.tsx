import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useAppData, updateReminder, appLabelOf } from '../store'
import {
  checkNativePerms,
  openUsageAccessSettings,
  openOverlaySettings,
  openAutoStartSettings,
  openAppDetailsSettings,
} from '../nativePerm'
import type { NativePermStatus } from '../nativePerm'
import { readGuardLog, clearGuardLog } from '../studyTimer'
import type { GuardLogEntry } from '../studyTimer'
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

// 判定日志的时间显示：只到秒，够定位「那会儿我在干什么」
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const VERDICT_LABEL: Record<GuardLogEntry['verdict'], string> = {
  away: '离开',
  trigger: '已提醒',
  pull: '已拉回',
}

// 权限体检的一行：状态点 + 名称 + 说明 + 动作
function PermRow({
  ok,
  title,
  desc,
  actionText,
  onAction,
}: {
  ok: boolean
  title: string
  desc: string
  actionText: string
  onAction: () => void
}) {
  return (
    <div className="app-pool-row" style={{ padding: '8px 0' }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          flexShrink: 0,
          background: ok ? 'var(--accent, #8b6f47)' : 'var(--red)',
        }}
      />
      <div className="app-pool-main">
        <div className="app-pool-name">{title}</div>
        <div className="app-pool-refs" style={{ fontSize: 12 }}>
          <span className={ok ? 'faint' : ''}>{desc}</span>
        </div>
      </div>
      <button type="button" className="btn sm" onClick={onAction}>
        {actionText}
      </button>
    </div>
  )
}

// 越界管控设置：三档 + 宽限秒数 + 权限体检 + 判定记录
// 检测在原生 StudyTimerService 里做（仅学习计时进行中、本 App 在后台时轮询）。
// 判定依据只有一个：当前前台应用是否在「放行集合」内（全局白名单 ∪ 方向额外放行 ∪ 自动放行）。
export function GuardSettings({ onClose }: Props) {
  const data = useAppData()
  const reminder = data.reminder!
  const [grace, setGrace] = useState(String(reminder.guardGraceSeconds ?? 5))
  const level: GuardLevel = reminder.guardLevel ?? 'off'
  // 权限状态：null = 还没读到
  const [perms, setPerms] = useState<NativePermStatus | null>(null)
  // 判定日志（B2）：展开时才去原生读，避免每次打开设置都拉一遍
  const [logOpen, setLogOpen] = useState(false)
  const [log, setLog] = useState<GuardLogEntry[] | null>(null)

  const refreshPerms = () => {
    checkNativePerms()
      .then(setPerms)
      .catch(() => setPerms({ usageAccess: false, overlay: false }))
  }

  useEffect(() => {
    refreshPerms()
    // 用户去系统设置授权完回来，状态要跟着更新，否则还得关掉重开
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshPerms()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const apply = (patch: Partial<ReminderConfig>) => updateReminder({ ...reminder, ...patch })

  // 解析宽限秒数：空白/非法回退 5，0 是合法值（= 立刻算越界）
  const parseGrace = (s: string): number => {
    const t = s.trim()
    if (!t) return 5
    const n = Number(t)
    return Number.isFinite(n) ? clampInt(n, 0, 600) : 5
  }

  const overlayOk = !!perms?.overlay
  const usageOk = !!perms?.usageAccess

  const handleLevel = (v: GuardLevel) => {
    // 拉回档必须先有悬浮窗权限：没权限还让它可选，就是给一个按了没反应的开关
    if (v === 'pull' && !overlayOk) return
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

  const toggleLog = async () => {
    if (logOpen) {
      setLogOpen(false)
      return
    }
    setLogOpen(true)
    setLog(await readGuardLog())
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
              const blocked = isPull && !overlayOk
              return (
                <button
                  key={lv}
                  type="button"
                  className={`seg-item ${level === lv ? 'active' : ''}`}
                  disabled={blocked}
                  title={
                    blocked ? '需要先授予「悬浮窗」权限，下方体检区可一键去开' : undefined
                  }
                  onClick={() => handleLevel(lv)}
                >
                  {GUARD_LEVEL_LABELS[lv]}
                </button>
              )
            })}
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            计时进行中跑去开别的 App，按这里的强度处理。
            「离开就拉回」需要悬浮窗权限——没有它 Android 10+ 不允许从后台把你拽回来，
            所以按钮会灰着，不做按了没反应的开关。
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
            判定按 3 秒轮询，所以实际响应大约是「宽限 + 最多 3 秒」。
          </p>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <label style={{ marginBottom: 0 }}>权限体检</label>
            <div className="spacer" />
            <button className="btn sm" onClick={refreshPerms}>
              重新检测
            </button>
          </div>
          <div style={{ marginTop: 6 }}>
            <PermRow
              ok={usageOk}
              title="使用情况访问（必需）"
              desc={usageOk ? '已授权，能读到前台应用' : '没授权则整套检测读不到前台应用，开了也不生效'}
              actionText={usageOk ? '去看看' : '去开启'}
              onAction={openUsageAccessSettings}
            />
            <PermRow
              ok={overlayOk}
              title="悬浮窗（拉回必需）"
              desc={overlayOk ? '已授权，可以把你从别的应用拽回来' : '没授权时「离开就拉回」不可用，只能提醒'}
              actionText={overlayOk ? '去看看' : '去开启'}
              onAction={openOverlaySettings}
            />
            <PermRow
              ok={false}
              title="自启动 / 后台弹出界面（小米等）"
              desc="厂商私有开关，读不到状态，只能自己确认；没开的话可能收不到提醒"
              actionText="去开"
              onAction={async () => {
                const opened = await openAutoStartSettings()
                // 打不开已知页面时不装作成功：直接退到应用详情页，给一条能走的手动路径
                if (!opened) await openAppDetailsSettings()
              }}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <label style={{ marginBottom: 0 }}>判定记录</label>
            <div className="spacer" />
            <button className="btn sm" onClick={toggleLog}>
              {logOpen ? '收起' : '查看'}
            </button>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            记「发现离开」「真的响了」「真的拉回」三个时刻，用来判断误报。
            觉得误报了把这里贴给我，比“好像老响”有用得多。
          </p>

          {logOpen && (
            <div style={{ marginTop: 8 }}>
              {log === null ? (
                <p className="faint" style={{ fontSize: 12 }}>读取中…</p>
              ) : log.length === 0 ? (
                <p className="faint" style={{ fontSize: 12 }}>
                  还没有记录。开一档强度、跑一次计时，这里就会出现时间线。
                </p>
              ) : (
                <>
                  <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
                    共 {log.length} 条，显示最近 {Math.min(log.length, 30)} 条
                  </div>
                  <div className="app-pool-list">
                    {[...log]
                      .reverse()
                      .slice(0, 30)
                      .map((e, i) => (
                        <div key={`${e.ts}-${i}`} className="app-pool-row unused">
                          <div className="app-pool-main">
                            <div className="app-pool-name">{appLabelOf(data.appPool, e.pkg)}</div>
                            <div className="app-pool-refs">
                              <span className={e.verdict === 'away' ? 'tag-allow' : 'tag-warn'}>
                                {VERDICT_LABEL[e.verdict]}
                              </span>
                              <span className="faint" style={{ fontSize: 12 }}>
                                {fmtTime(e.ts)}
                                {e.verdict === 'away'
                                  ? ''
                                  : ` · 离开 ${Math.round(e.awayMs / 1000)} 秒`}
                              </span>
                            </div>
                            <div className="app-pool-pkg">{e.pkg}</div>
                          </div>
                        </div>
                      ))}
                  </div>
                  <button
                    className="btn sm"
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      await clearGuardLog()
                      setLog([])
                    }}
                  >
                    清空记录
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
