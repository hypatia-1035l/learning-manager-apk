import { useEffect, useRef, useState } from 'react'
import type { Task } from '../types'
import {
  getCurrentObject,
  finishStudySession,
  completeCurrentObject,
  getSequenceProgress,
  formatSequenceProgress,
} from '../store'
import { formatTimer } from '../utils'
import {
  startStudyTimer,
  updateStudyTimer,
  stopStudyTimer,
  consumePendingAction,
  getStudyTimerStatus,
  onStudyTimerAction,
} from '../studyTimer'
import { setSessionActive } from '../reminderService'
import type { StudyTimerAction } from '../studyTimer'

// 暂停状态持久化：App 被杀后重启可恢复为 paused（避免误启动新计时）
const PAUSED_TASK_KEY = 'learning-manager:paused-task'
const PAUSED_ELAPSED_KEY = 'learning-manager:paused-elapsed'

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

  const obj = getCurrentObject(task)
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
    // 预填：count 型默认本次完成 0；position 型预填当前进度方便微调
    setDeltaInput('')
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
          startStudyTimer(task.name, obj?.name ?? '', 0)
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
    clearPausedState()
    resumeAtRef.current = Date.now()
    setPhase('timing')
    startStudyTimer(task.name, obj?.name ?? '', accumulatedRef.current)
  }

  const handleResume = () => {
    // 从进度填写界面返回计时阶段：重新开启计时
    resumeAtRef.current = Date.now()
    setPhase('timing')
    // 恢复计时，重新启动常驻通知
    startStudyTimer(task.name, obj?.name ?? '', accumulatedRef.current)
  }

  const handleSave = () => {
    const note = noteInput.trim() || undefined
    if (isCount) {
      // 数量型：本次完成数量（增量），如 +20
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
      // 位置型：填写当前进度文本
      finishStudySession({
        taskId: task.id,
        duration: elapsed,
        startProgress,
        endProgress: endProgress.trim(),
        note,
      })
    }
    clearPausedState()
    onTaskMutated()
    onClose()
  }

  // 仅记录学习时长，不更新进度（倒计时结束或中途退出时的快捷选项）
  const handleSaveDurationOnly = () => {
    const note = noteInput.trim() || undefined
    if (isCount) {
      // 数量型：delta = 0，进度保持不变
      finishStudySession({
        taskId: task.id,
        duration: elapsed,
        startProgress,
        endProgress: '',
        deltaCount: 0,
        note,
      })
    } else {
      // 位置型：endProgress 沿用 startProgress，进度文本不变
      finishStudySession({
        taskId: task.id,
        duration: elapsed,
        startProgress,
        endProgress: startProgress,
        note,
      })
    }
    clearPausedState()
    onTaskMutated()
    onClose()
  }

  const handleCompleteObject = () => {
    if (!confirm(`确认完成「${obj?.name ?? '当前内容'}」？`)) return
    completeCurrentObject(task.id)
    onTaskMutated()
    // 完成后任务对象切换，同步新对象名到常驻通知
    const newObj = getCurrentObject(task)
    updateStudyTimer(task.name, newObj?.name ?? '', accumulatedRef.current)
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
      <div className="session-task">{task.icon} {task.name}</div>
      <div className="session-obj">{obj ? obj.name : '（未设置学习序列）'}</div>
      <div className="session-prog">
        当前进度：{obj ? formatSequenceProgress(obj) : '尚未记录'}
      </div>

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
              ? `已暂停，当前学习 ${formatTimer(elapsed)}，点击继续学习`
              : `已恢复上次未完成计时（${formatTimer(elapsed)}）`}
          </span>
          <span className="session-hint-close" title="关闭提示">
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
            完成当前内容
          </button>
          <button className="btn" onClick={handlePause}>
            暂停
          </button>
          <button className="btn primary" onClick={handleEnd}>
            结束学习
          </button>
        </div>
      ) : phase === 'paused' ? (
        <div className="session-actions">
          <button className="btn primary" onClick={handleResumeFromPause}>
            继续学习
          </button>
          <button className="btn" onClick={handleEnd}>
            结束学习
          </button>
        </div>
      ) : (
        <div className="session-end-form">
          {isCount ? (
            <div className="field">
              <label>
                本次完成数量
                {prog?.type === 'count' && prog.unit ? `（${prog.unit}）` : ''}
              </label>
              <input
                className="input"
                autoFocus
                type="number"
                min={0}
                value={deltaInput}
                onChange={(e) => setDeltaInput(e.target.value)}
                placeholder="如：20"
              />
              <div className="hint">
                {prog?.type === 'count'
                  ? `${prog.current} → ${prog.current + (Number(deltaInput) || 0)} / ${prog.target}${prog.unit ? ' ' + prog.unit : ''}`
                  : '填写本次完成的数量，达到目标后自动完成'}
              </div>
            </div>
          ) : (
            <div className="field">
              <label>记录当前位置</label>
              <input
                className="input"
                autoFocus
                value={endProgress}
                onChange={(e) => setEndProgress(e.target.value)}
                placeholder="如：卷八十九 / 第12集 / 第三卷第五章"
              />
              <div className="hint">
                原：{startProgress || '（空）'} → 填写后更新为当前进度
              </div>
            </div>
          )}
          <div className="field">
            <label className="muted">备注（可选）</label>
            <textarea
              className="textarea"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="记点什么：学习心得、遇到的问题、下次继续的地方…"
              rows={3}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={handleResume}>
              继续学习
            </button>
            <button className="btn" onClick={handleSaveDurationOnly} title="不更新进度，仅记录本次学习时长">
              仅记时长
            </button>
            <button className="btn primary" onClick={handleSave}>
              保存记录
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
