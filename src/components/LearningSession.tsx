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
  getAppData,
  appLabelOf,
  resolveAllowedApps,
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

// 只清理「本方向」的暂停标记：暂停标记是全局单槽（同一时刻只可能有一个方向处于暂停），
// 别的方向结束会话时不能把这条记录清掉，否则用户回到原方向继续学习时已暂停的时长会丢。
function clearPausedState(taskId?: string) {
  try {
    if (taskId) {
      const stored = localStorage.getItem(PAUSED_TASK_KEY)
      if (stored && stored !== taskId) return
    }
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
}

export function LearningSession({ task, onClose }: Props) {
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
  // 结束表单的预填只做一次（会话开始时的当前序列）。
  // 「完成当前项」会自动把 currentObjectId 切到下一条，若此时再预填数量型增量 1，
  // 用户直接点保存就会把 +1 记到还没学的新序列上。
  const prefillDoneRef = useRef(false)
  // 固定（标星）状态：当前方向/序列是否被固定到每日计划
  const [pinned, setPinned] = useState(false)
  // 应用启动失败提示（null = 不显示）
  const [appErr, setAppErr] = useState<string | null>(null)
  // 紧急退出：长按「结束」→ 二次确认 → 放弃本次计时（不写记录）。
  // 严格模式下万一桌面/输入法被漏放行把人困住，这是唯一的逃生门。
  const [abandonOpen, setAbandonOpen] = useState(false)
  const longPressTimer = useRef<number | null>(null)

  // 应用池：只是包名 → 应用名的缓存，供图标行显示名字
  const data = useAppData()
  const appPool = data.appPool ?? []
  // 本方向的最终放行集合：全局白名单 ∪ 方向额外放行（单点解析，见 store.resolveAllowedApps）。
  // 自动放行项（本 App / 桌面 / 输入法 / 拨号 / 系统界面）JS 拿不到包名，由原生侧自行叠加。
  const allowedApps = resolveAllowedApps(task, data.globalAllowedApps).all
  // 越界管控档位：仅在计时启动时随 start 一起传给原生前台服务
  const guardLevel = data.reminder?.guardLevel ?? 'off'
  const guardGraceSeconds = data.reminder?.guardGraceSeconds ?? 5
  const guard: StudyTimerGuard | undefined =
    guardLevel === 'off'
      ? undefined
      : { level: guardLevel, graceSeconds: guardGraceSeconds, allowedApps }

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
    if (prefillDoneRef.current) {
      // 序列已被「完成当前项」自动切走：只清空输入，不预填增量，避免把 +1 记到新序列
      setDeltaInput('')
      setEndProgress(isCount ? '' : startProgress)
      return
    }
    prefillDoneRef.current = true
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
      // 倒计时模式：显示与记录都不允许超过设定时长。
      // JS 定时器在锁屏/切后台时会被冻结，回前台第一次 tick 可能已远超 countdown，
      // 若把整段墙钟时间写进记录，25 分钟倒计时会记成几小时。
      setElapsed(isCountdown ? Math.min(newElapsed, countdownSec) : newElapsed)
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
      // 1. 先消费 pending action：通知栏「完成/结束」是一次性动作，原生 Receiver 写入、
      //    只有这里读取并清除。必须在启动计时之前判定——否则进程被杀后点「结束」，
      //    冷启动会先重新起一个计时器，把旧动作当成新会话。
      const pending = await consumePendingAction()
      if (cancelled) return
      // 丢弃过期 / 不属于本方向的动作，避免把别的会话的旧动作重放到这次会话上
      const pendingValid =
        !!pending &&
        (!pending.taskName || pending.taskName === task.name) &&
        (!pending.savedAt || Date.now() - pending.savedAt < 10 * 60 * 1000)

      if (pendingValid && pending!.action === 'end') {
        // 倒计时模式同样封顶，避免后台跨过的墙钟时间进入记录
        const sec = isCountdown
          ? Math.min(pending!.elapsedSeconds, countdownSec)
          : pending!.elapsedSeconds
        accumulatedRef.current = sec
        resumeAtRef.current = Date.now()
        setElapsed(sec)
        setPhase('ending')
        endedRef.current = true
        // Receiver 只写 pending 并拉起 Activity，并不停 Service，这里补停
        stopStudyTimer()
        setSessionActive(false).catch(() => {})
        clearPausedState(task.id)
        return
      }

      // 2. 查询 Service 是否在运行（WebView 被杀后冷启动恢复）
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

      // 3. pending=complete：会话继续，只弹「确认完成」
      if (pendingValid && pending!.action === 'complete') {
        if (!status?.isRunning && !sessionFlaggedRef.current) {
          // 计时已停（进程被回收后点了「完成」）：同步时长并等待用户确认，不重新开始计时
          accumulatedRef.current = pending!.elapsedSeconds
          resumeAtRef.current = Date.now()
          setElapsed(pending!.elapsedSeconds)
          setPhase('paused')
          setSessionActive(true)
        }
        handleCompleteObject()
      }
    }

    bootstrap()

    // 3. 同时注册即时事件监听（Activity 在前台时）
    const off = onStudyTimerAction((action: StudyTimerAction) => {
      // 即时路径也要消费一次 pending：否则原生暂存的动作会残留，
      // 下次打开任意会话时被 bootstrap 重放（凭空多一条记录 / 误弹完成确认）
      consumePendingAction().catch(() => {})
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
    // 只并入「计时阶段」产生的时长：暂停时已并入过一次，且暂停期间的时间本就不算学习。
    // （此前暂停后再点「结束」会把暂停前的整段时长再加一遍，记录时长翻倍）
    if (phase === 'timing') {
      accumulatedRef.current += Math.floor(
        (Date.now() - resumeAtRef.current) / 1000,
      )
    }
    // 倒计时模式：记录时长封顶在设定时长内（后台/休眠跨过的时间不算学习）
    if (isCountdown) {
      accumulatedRef.current = Math.min(accumulatedRef.current, countdownSec)
    }
    setElapsed(accumulatedRef.current)
    setPhase('ending')
    // 结束学习时停止常驻通知，并解除会话活跃状态（触发冷却 + 重新调度提醒）
    stopStudyTimer()
    setSessionActive(false)
    // 清除暂停标记（若存在；只清本方向的）
    clearPausedState(task.id)
  }

  // 紧急退出：不写记录、不计本次时长，直接停表退出。
  // 与 handleEnd 的区别：不进结束页、不落记录，纯粹"放我出去"。
  const handleAbandon = () => {
    endedRef.current = true
    stopStudyTimer()
    setSessionActive(false)
    clearPausedState(task.id)
    setAbandonOpen(false)
    onClose()
  }

  // 长按「结束」= 紧急退出入口（700ms）。触摸离开/取消都要清掉定时器，
  // 否则一次轻点会被误判成长按。
  const longPressCancel = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }
  const longPressStart = () => {
    longPressCancel()
    longPressTimer.current = window.setTimeout(() => setAbandonOpen(true), 700)
  }

  const handlePause = () => {
    if (endedRef.current) return
    // 暂停：把本次计时阶段产生的时长并入累积，停止 Service 与前端定时器
    accumulatedRef.current += Math.floor(
      (Date.now() - resumeAtRef.current) / 1000,
    )
    // 重置计时起点：暂停期间不应计入，也让后续「结束」不会重复累加这一段
    resumeAtRef.current = Date.now()
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
    clearPausedState(task.id)
    resumeAtRef.current = Date.now()
    setPhase('timing')
    startStudyTimer(task.name, obj?.name ?? '', accumulatedRef.current, guard, nodeLabelOf(obj))
  }

  const handleResume = () => {
    // 倒计时已经走完：继续也没有意义，下一个 tick 会立刻再次自动结束
    if (isCountdown && elapsed >= countdownSec) return
    // 从进度填写界面返回计时阶段：重新开启计时
    endedRef.current = false
    resumeAtRef.current = Date.now()
    setPhase('timing')
    // 「结束 → 继续」= 会话重新活跃：否则这段时间提醒不会被抑制，
    // 冷却/学习后跳过也会按第一次「结束」的时刻起算
    setSessionActive(true).catch(() => {})
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
      clearPausedState(task.id)
      onClose()
    }
  }

  const doCompleteObject = () => {
    completeCurrentObject(task.id)
    // 完成后任务对象切换，同步新对象名到常驻通知。
    // 注意：必须从 store 重新读最新任务——本次渲染闭包里的 task 仍是旧快照，
    // 用它取 currentObjectId 拿到的还是刚完成的那一条，常驻通知会停在旧序列。
    const fresh = getAppData().tasks.find((t) => t.id === task.id)
    const newObj = fresh ? getCurrentObject(fresh) : null
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
      // 兜底清除暂停标记（只清本方向的，别把别的方向暂停中的时长抹掉）
      clearPausedState(task.id)
    }
  }, [])

  // 计时器显示：倒计时模式显示剩余时间，正向模式显示已用时间
  const timerDisplay = isCountdown ? formatTimer(remaining) : formatTimer(elapsed)
  const timerLabel = isCountdown ? '剩余时间' : '已用时间'
  // 倒计时已用完：结束页不再提供「继续」，否则下一个 tick 会立刻再次自动结束
  const countdownExhausted = isCountdown && elapsed >= countdownSec

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
          <button
            className="btn primary"
            onClick={handleEnd}
            title="轻点结束并保存；长按可紧急退出（不记录本次时长）"
            onPointerDown={longPressStart}
            onPointerUp={longPressCancel}
            onPointerLeave={longPressCancel}
            onPointerCancel={longPressCancel}
            onContextMenu={(e) => e.preventDefault()}
          >
            结束
          </button>
        </div>
      ) : phase === 'paused' ? (
        <div className="session-actions">
          <button className="btn primary" onClick={handleResumeFromPause}>
            继续
          </button>
          <button
            className="btn"
            onClick={handleEnd}
            title="轻点结束并保存；长按可紧急退出（不记录本次时长）"
            onPointerDown={longPressStart}
            onPointerUp={longPressCancel}
            onPointerLeave={longPressCancel}
            onPointerCancel={longPressCancel}
            onContextMenu={(e) => e.preventDefault()}
          >
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
            {!countdownExhausted && (
              <button className="btn sm" onClick={handleResume}>
                继续
              </button>
            )}
            <button className="btn primary" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      )}

      {abandonOpen && (
        <ConfirmModal
          title="放弃本次计时"
          message={
            '本次计时不会保存，也不会计入学习时长。\n\n' +
            '这是「紧急退出」——如果你只是正常结束，请点「取消」再轻点「结束」。'
          }
          confirmText="放弃并退出"
          onConfirm={handleAbandon}
          onCancel={() => setAbandonOpen(false)}
        />
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
              {!countdownExhausted && (
                <button
                  className="btn"
                  onClick={() => {
                    setShortConfirm(false)
                    handleResume()
                  }}
                >
                  继续计时
                </button>
              )}
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
