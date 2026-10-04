import { useEffect, useRef, useState } from 'react'
import type { Task, LearningObject } from '../types'
import {
  getCurrentObject,
  finishStudySession,
  completeCurrentObject,
  getSequenceProgress,
  formatSequenceProgress,
  getCurrentNodeLabel,
  togglePinnedTask,
  isTaskPinned,
  useAppData,
  appLabelOf,
} from '../store'
import { formatTimer } from '../utils'
import { ConfirmModal } from './ConfirmModal'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'
import { launchApp } from '../appList'
import {
  startStudyTimer,
  updateStudyTimer,
  stopStudyTimer,
  consumePendingAction,
  getStudyTimerStatus,
  onStudyTimerAction,
} from '../studyTimer'
import { setSessionActive, scheduleReminders } from '../reminderService'
import type { StudyTimerAction, StudyTimerGuard } from '../studyTimer'

// 暂停状态持久化：App 被杀后重启可恢复为 paused（避免误启动新计时）
const PAUSED_TASK_KEY = 'learning-manager:paused-task'
const PAUSED_ELAPSED_KEY = 'learning-manager:paused-elapsed'

// 最低有效计时：不足该时长保存前先确认（防误触产生 0 秒垃圾记录）
const MIN_SAVE_SECONDS = 5

function readPausedState(taskId: string): number | null {
  try {
    const id = localStorage.getItem(PAUSED_TASK_KEY)
    if (id !== taskId) return null
    const sec = Number(localStorage.getItem(PAUSED_ELAPSED_KEY))
    return isNaN(sec) || sec < 0 ? null : sec
  } catch {
    return null
  }
}

function clearPausedState() {
  try {
    localStorage.removeItem(PAUSED_TASK_KEY)
    localStorage.removeItem(PAUSED_ELAPSED_KEY)
  } catch {
    /* ignore */
  }
}

// 当前进度节点名（无节点 / 非数量型返回 undefined，通知里不显示节点段）
function nodeLabelOf(o: LearningObject | undefined | null): string | undefined {
  return o ? getCurrentNodeLabel(o) ?? undefined : undefined
}

interface Props {
  task: Task
  onClose: () => void
  // 当学习对象因「完成」而切换时，通知父组件刷新 task 引用
  onTaskMutated: () => void
}

export function LearningSession({ task, onClose, onTaskMutated }: Props) {
  // 累积时长（秒）：跨「计时→结束→继续」多次切换保留
  const accumulatedRef = useRef(0)
  // 当前计时阶段开始的时刻
  const resumeAtRef = useRef<number>(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [phase, setPhase] = useState<'timing' | 'paused' | 'ending'>('timing')
  // 数量型：本次完成数量（增量）；位置型：当前进度文本
  const [endProgress, setEndProgress] = useState('')
  const [deltaInput, setDeltaInput] = useState('')
  // 学习备注（可选）
  const [noteInput, setNoteInput] = useState('')
  // 暂停恢复提示：true 时在计时/暂停阶段显示提示卡；用户点"知道了"后隐藏
  const [showResumeHint, setShowResumeHint] = useState(false)
  // 完成当前对象确认弹窗
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  // 计时过短确认：保存前弹出（坚持退出 / 继续计时）
  const [shortConfirm, setShortConfirm] = useState(false)
  // 结束幂等守卫：handleEnd 可被「倒计时归零 / 原生事件 / 卸载清理」多条路径触发，
  // 重复执行会把同一段计时重复累加进 accumulatedRef
  const endedRef = useRef(false)
  // 固定（标星）状态：当前方向/序列是否被固定到每日计划
  const [pinned, setPinned] = useState(false)
  // 应用启动失败提示（null = 不显示）
  const [appErr, setAppErr] = useState<string | null>(null)

  // 应用池：只是包名 → 应用名的缓存，供图标行显示名字
  const data = useAppData()
  const appPool = data.appPool ?? []
  // 本方向允许进入的应用（默认策略=禁止：不在名单里的不给入口）
  const allowedApps = task.allowedApps ?? []
  // 越界提醒（P3）配置：仅在计时启动时随 start 一起传给原生前台服务
  const blockedApps = task.blockedApps ?? []
  const guardEnabled = data.reminder?.guardEnabled ?? false
  const guardGraceMinutes = data.reminder?.guardGraceMinutes ?? 5
  const guard: StudyTimerGuard | undefined = guardEnabled
    ? { enabled: true, graceMinutes: guardGraceMinutes, allowedApps, blockedApps }
    : undefined

  const obj = getCurrentObject(task)
  // 固定状态随当前方向/序列变化同步
  useEffect(() => {
    setPinned(isTaskPinned(task.id, obj?.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, obj?.id])
  const startProgress = obj?.progress ?? ''
  // 序列进度模型：count 型输入增量，position 型输入文本
  const prog = obj ? getSequenceProgress(obj) : null
  const isCount = prog?.type === 'count'
  // 倒计时模式：序列设置了 countdownSeconds 且 > 0
  const countdownSec = obj?.countdownSeconds ?? 0
  const isCountdown = countdownSec > 0
  // 倒计时模式下的剩余时间
  const remaining = isCountdown ? Math.max(0, countdownSec - elapsed) : 0

  useEffect(() => {
    // 预填：count 型默认本次完成 1（一次学完立刻点保存只需一步）；position 型预填当前进度方便微调
    setDeltaInput(isCount ? '1' : '')
    setEndProgress(isCount ? '' : startProgress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.currentObjectId])

  // 仅在计时阶段运行定时器；进入 ending 阶段后立即停止
  useEffect(() => {
    if (phase !== 'timing') return
    const timer = setInterval(() => {
      const newElapsed =
        accumulatedRef.current +
        Math.floor((Date.now() - resumeAtRef.current) / 1000)
      setElapsed(newElapsed)
      // 倒计时模式：到 0 自动结束
      if (isCountdown && newElapsed >= countdownSec) {
        handleEnd()
      }
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isCountdown, countdownSec])

  // 进入计时阶段时标记会话活跃（抑制提醒）；退出时解除
  // 用 ref 防止 React 18 StrictMode 下双调用导致状态翻转
  const sessionFlaggedRef = useRef(false)
  useEffect(() => {
    if (phase === 'timing' && !sessionFlaggedRef.current) {
      sessionFlaggedRef.current = true
      setSessionActive(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // 挂载时：检查 Native Service 状态，恢复计时 + 消费 pending action
  // 用 ref 守卫，避免 StrictMode 下 bootstrap 被执行两次导致重复启动 Service
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true

    let cancelled = false

    async function bootstrap() {
      // 1. 查询 Service 是否在运行（WebView 被杀后冷启动恢复）
      const status = await getStudyTimerStatus()
      if (cancelled) return

      if (status?.isRunning) {
        // Service 在跑，同步 React 累积时间
        accumulatedRef.current = status.elapsedSeconds
        resumeAtRef.current = Date.now()
        setElapsed(status.elapsedSeconds)
        setPhase('timing')
        // Service 在跑说明上次未正常结束；展示短暂恢复提示
        setShowResumeHint(true)
      } else {
        // Service 不在运行：先检查是否有暂停状态可恢复
        const pausedElapsed = readPausedState(task.id)
        if (pausedElapsed !== null) {
          // 上次是暂停状态退出，恢复为 paused（不重启 Service）
          accumulatedRef.current = pausedElapsed
          resumeAtRef.current = Date.now()
          setElapsed(pausedElapsed)
          setPhase('paused')
          // 暂停期间仍认为会话活跃，抑制提醒
          setSessionActive(true)
          // 暂停恢复提示
          setShowResumeHint(true)
        } else {
          // Service 不在运行，启动常驻通知
          startStudyTimer(task.name, obj?.name ?? '', 0, guard, nodeLabelOf(obj))
        }
      }

      // 2. 消费 pending action（冷启动恢复的关键）
      const pending = await consumePendingAction()
      if (cancelled) return
      if (pending?.action === 'complete') {
        handleCompleteObject()
      } else if (pending?.action === 'end') {
        // 同步 elapsed 到 pending 中记录的值
        accumulatedRef.current = pending.elapsedSeconds
        setElapsed(pending.elapsedSeconds)
        setPhase('ending')
        // pending=end 时 Service 已被停止（用户点了结束），无需再调 stop
      }
    }

    bootstrap()

    // 3. 同时注册即时事件监听（Activity 在前台时）
    const off = onStudyTimerAction((action: StudyTimerAction) => {
      if (action === 'complete') {
        handleCompleteObject()
      } else if (action === 'end') {
        handleEnd()
      }
    })

    return () => {
      cancelled = true
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEnd = () => {
    if (endedRef.current) return
    endedRef.current = true
    // 立即停止计时，把本次计时阶段产生的时长并入累积，冻结本次学习时长
    accumulatedRef.current += Math.floor(
      (Date.now() - resumeAtRef.current) / 1000,
    )
    setElapsed(accumulatedRef.current)
    setPhase('ending')
    // 结束学习时停止常驻通知，并解除会话活跃状态（触发冷却 + 重新调度提醒）
    stopStudyTimer()
    setSessionActive(false)
    // 清除暂停标记（若存在）
    clearPausedState()
  }

  const handlePause = () => {
    if (endedRef.current) return
    // 暂停：把本次计时阶段产生的时长并入累积，停止 Service 与前端定时器
    accumulatedRef.current += Math.floor(
      (Date.now() - resumeAtRef.current) / 1000,
    )
    setElapsed(accumulatedRef.current)
    setPhase('paused')
    stopStudyTimer()
    // 持久化暂停状态：App 被杀后重启可恢复（不重启计时）
    try {
      localStorage.setItem(PAUSED_TASK_KEY, task.id)
      localStorage.setItem(PAUSED_ELAPSED_KEY, String(accumulatedRef.current))
    } catch {
      /* ignore */
    }
    // sessionActive 保持 true：暂停期间仍抑制提醒，避免被打断
  }

  const handleResumeFromPause = () => {
    // 从暂停恢复计时：清除标记，重启 Service
    endedRef.current = false
    clearPausedState()
    resumeAtRef.current = Date.now()
    setPhase('timing')
    startStudyTimer(task.name, obj?.name ?? '', accumulatedRef.current, guard, nodeLabelOf(obj))
  }

  const handleResume = () => {
    // 从进度填写界面返回计时阶段：重新开启计时
    endedRef.current = false
    resumeAtRef.current = Date.now()
    setPhase('timing')
    // 恢复计时，重新启动常驻通知
    startStudyTimer(task.name, obj?.name ?? '', accumulatedRef.current, guard, nodeLabelOf(obj))
  }

  const handleSave = () => {
    if (elapsed < MIN_SAVE_SECONDS) {
      setShortConfirm(true)
      return
    }
    doSave()
  }

  const doSave = () => {
    try {
      const note = noteInput.trim() || undefined
      if (isCount) {
        // 数量型：本次完成数量（增量），如 +20；留空=0，仅记录时长不更新进度
        const delta = Math.max(0, Number(deltaInput) || 0)
        finishStudySession({
          taskId: task.id,
          duration: elapsed,
          startProgress,
          endProgress: '',
          deltaCount: delta,
          note,
        })
      } else {
        // 位置型：填写当前进度文本；留空则保持原进度（等效仅记时长）
        finishStudySession({
          taskId: task.id,
          duration: elapsed,
          startProgress,
          endProgress: endProgress.trim() || startProgress,
          note,
        })
      }
    } catch (e) {
      // 保存异常不阻塞退出；控制台留痕便于排查
      console.error('保存学习记录失败', e)
    } finally {
      // 无论保存结果如何，保存完成后必退出计时页
      clearPausedState()
      onTaskMutated()
      onClose()
    }
  }

  const doCompleteObject = () => {
    completeCurrentObject(task.id)
    onTaskMutated()
    // 完成后任务对象切换，同步新对象名到常驻通知
    const newObj = getCurrentObject(task)
    updateStudyTimer(task.name, newObj?.name ?? '', accumulatedRef.current, nodeLabelOf(newObj))
  }

  const handleCompleteObject = () => {
    setShowCompleteConfirm(true)
  }

  // 退出会话时停止常驻通知（兜底：用户直接关掉 App 的情况由 Service onTaskRemoved 处理）
  useEffect(() => {
    return () => {
      // 仅在 timing 阶段退出时停止（ending 阶段已由 handleEnd 停止）
      // 这里无条件 stop 作为兜底
      stopStudyTimer()
      setSessionActive(false)
      // 兜底清除暂停标记（用户直接退出会话时）
      clearPausedState()
    }
  }, [])

  // 计时器显示：倒计时模式显示剩余时间，正向模式显示已用时间
  const timerDisplay = isCountdown ? formatTimer(remaining) : formatTimer(elapsed)
  const timerLabel = isCountdown ? '剩余时间' : '已用时间'

  return (
    <div className="session-overlay">
      <div className="session-task">{task.name}</div>
      <div className="session-obj">{obj ? obj.name : '（未设置序列）'}</div>
      <div className="session-prog">
        进度：{obj ? formatSequenceProgress(obj) : '尚未记录'}
      </div>

      {/* 固定（标星）：把当前方向/序列固定到每天计划，直到手动取消 */}
      <button
        type="button"
        className={`session-pin ${pinned ? 'on' : ''}`}
        onClick={() => {
          const next = togglePinnedTask(task.id, obj?.id)
          setPinned(
            next.some(
              (p) => p.taskId === task.id && (p.sequenceId ?? undefined) === (obj?.id ?? undefined),
            ),
          )
          scheduleReminders().catch(() => {})
        }}
        title={pinned ? '已固定：每天自动排进计划，点此取消' : '固定：每天自动排进计划'}
      >
        {pinned ? '★ 已固定' : '☆ 固定'}
      </button>

      {/* 允许的应用：点击直接进入（计时照常跑，通知栏可一键回来） */}
      {allowedApps.length > 0 && (
        <div className="session-apps">
          {allowedApps.map((pkg) => {
            const label = appLabelOf(appPool, pkg)
            return (
              <button
                key={pkg}
                type="button"
                className="session-app"
                title={`打开 ${label}`}
                onClick={async () => {
                  const ok = await launchApp(pkg)
                  if (!ok) {
                    setAppErr(`打不开「${label}」，可能已被卸载，或它没有可启动的入口。`)
                  }
                }}
              >
                <AppIcon packageName={pkg} appName={label} size={26} />
                <span className="session-app-name">{label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 暂停/恢复提示卡：只在 timing/paused 阶段且未被用户关闭时显示 */}
      {showResumeHint && phase !== 'ending' && (
        <button
          className="session-hint"
          onClick={() => setShowResumeHint(false)}
          type="button"
        >
          <span className="session-hint-ico">
            {phase === 'paused' ? '暂停' : '继续'}
          </span>
          <span className="session-hint-text">
            {phase === 'paused'
              ? `已暂停 ${formatTimer(elapsed)}，点击继续`
              : `已恢复 ${formatTimer(elapsed)}`}
          </span>
          <span className="session-hint-close">
            关闭
          </span>
        </button>
      )}

      <div className="session-timer-label">{timerLabel}</div>
      <div className={`session-timer ${isCountdown && remaining === 0 ? 'timer-done' : ''}`}>
        {timerDisplay}
      </div>

      {phase === 'timing' ? (
        <div className="session-actions">
          <button className="btn" onClick={handleCompleteObject} disabled={!obj}>
            完成
          </button>
          <button className="btn" onClick={handlePause}>
            暂停
          </button>
          <button className="btn primary" onClick={handleEnd}>
            结束
          </button>
        </div>
      ) : phase === 'paused' ? (
        <div className="session-actions">
          <button className="btn primary" onClick={handleResumeFromPause}>
            继续
          </button>
          <button className="btn" onClick={handleEnd}>
            结束
          </button>
        </div>
      ) : (
        <div className="session-end-form">
          {isCount ? (
            <div className="field">
              <label>
                本次完成
                {prog?.type === 'count' && prog.unit ? `（${prog.unit}）` : ''}
              </label>
              <input
                className="input"
                type="number"
                min={0}
                value={deltaInput}
                onChange={(e) => setDeltaInput(e.target.value)}
              />
              {/* 进度节点快捷跳转：点节点一键把进度补到该刻度 */}
              {obj && obj.progressNodes && obj.progressNodes.length > 0 && prog?.type === 'count' && (
                <div className="node-quick">
                  <span className="faint" style={{ fontSize: 12 }}>快速到节点</span>
                  <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                    {[...obj.progressNodes]
                      .sort((a, b) => a.at - b.at)
                      .map((n) => {
                        const delta = n.at - prog.current
                        const passed = delta <= 0
                        return (
                          <button
                            key={n.at}
                            type="button"
                            className="btn sm"
                            disabled={passed}
                            title={passed ? '已超过该节点' : `本次完成 ${delta}，进度到 ${n.at}`}
                            onClick={() => setDeltaInput(String(delta))}
                          >
                            {n.label} {n.at}
                          </button>
                        )
                      })}
                  </div>
                </div>
              )}
              <div className="hint">
                {prog?.type === 'count'
                  ? (() => {
                      const newCurrent = prog.current + (Number(deltaInput) || 0)
                      const base = `${prog.current} → ${newCurrent} / ${prog.target}${prog.unit ? ' ' + prog.unit : ''}`
                      const curLabel = obj ? getCurrentNodeLabel(obj) : null
                      const newLabel = obj?.progressNodes?.length
                        ? getCurrentNodeLabel({ ...obj, progressModel: { ...prog, current: newCurrent } })
                        : null
                      if (!curLabel && !newLabel) return base
                      if (curLabel === newLabel) return `${base} · ${curLabel}`
                      return `${base}（${curLabel ?? '—'} → ${newLabel ?? '—'}）`
                    })()
                  : null}
              </div>
            </div>
          ) : (
            <div className="field">
              <label>当前位置</label>
              <input
                className="input"
                value={endProgress}
                onChange={(e) => setEndProgress(e.target.value)}
              />
            </div>
          )}
          <div className="field" style={{ marginTop: 2 }}>
            <label className="muted" style={{ fontSize: 12 }}>备注</label>
            <input
              className="input"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
          </div>
          <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
            <button className="btn sm" onClick={handleResume}>
              继续
            </button>
            <button className="btn primary" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      )}

      {appErr && (
        <Modal
          title="无法打开"
          onClose={() => setAppErr(null)}
          footer={
            <button className="btn primary" onClick={() => setAppErr(null)}>
              知道了
            </button>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.6 }}>{appErr}</p>
        </Modal>
      )}

      {shortConfirm && (
        <Modal
          title="计时太短"
          onClose={() => {
            setShortConfirm(false)
            handleResume()
          }}
          footer={
            <>
              <button
                className="btn danger"
                onClick={() => {
                  setShortConfirm(false)
                  onClose()
                }}
              >
                坚持退出
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShortConfirm(false)
                  handleResume()
                }}
              >
                继续计时
              </button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            本次仅 {formatTimer(elapsed)}（不足 5 秒），一般不算有效记录。
          </p>
        </Modal>
      )}

      {showCompleteConfirm && (
        <ConfirmModal
          title="确认完成"
          message={`完成「${obj?.name ?? '当前内容'}」？`}
          onConfirm={() => {
            setShowCompleteConfirm(false)
            doCompleteObject()
          }}
          onCancel={() => setShowCompleteConfirm(false)}
        />
      )}
    </div>
  )
}
