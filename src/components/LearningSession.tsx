import { useEffect, useRef, useState } from 'react'
import type { Task } from '../types'
import { getCurrentObject, finishStudySession, completeCurrentObject } from '../store'
import { formatTimer } from '../utils'
import {
  startStudyTimer,
  updateStudyTimer,
  stopStudyTimer,
  consumePendingAction,
  getStudyTimerStatus,
  onStudyTimerAction,
} from '../studyTimer'
import type { StudyTimerAction } from '../studyTimer'

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
  const [phase, setPhase] = useState<'timing' | 'ending'>('timing')
  const [endProgress, setEndProgress] = useState('')

  const obj = getCurrentObject(task)
  const startProgress = obj?.progress ?? ''

  useEffect(() => {
    // 预填结束进度为当前进度，方便微调
    setEndProgress(startProgress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.currentObjectId])

  // 仅在计时阶段运行定时器；进入 ending 阶段后立即停止
  useEffect(() => {
    if (phase !== 'timing') return
    const timer = setInterval(() => {
      setElapsed(
        accumulatedRef.current +
          Math.floor((Date.now() - resumeAtRef.current) / 1000),
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  // 挂载时：检查 Native Service 状态，恢复计时 + 消费 pending action
  useEffect(() => {
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
      } else {
        // Service 不在运行，启动常驻通知
        startStudyTimer(task.name, obj?.name ?? '', 0)
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
    // 结束学习时停止常驻通知
    stopStudyTimer()
  }

  const handleResume = () => {
    // 从进度填写界面返回计时阶段：重新开启计时
    resumeAtRef.current = Date.now()
    setPhase('timing')
    // 恢复计时，重新启动常驻通知
    startStudyTimer(task.name, obj?.name ?? '', accumulatedRef.current)
  }

  const handleSave = () => {
    finishStudySession({
      taskId: task.id,
      duration: elapsed,
      startProgress,
      endProgress: endProgress.trim(),
    })
    onTaskMutated()
    onClose()
  }

  const handleCompleteObject = () => {
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
    }
  }, [])

  return (
    <div className="session-overlay">
      <div className="session-task">{task.icon} {task.name}</div>
      <div className="session-obj">{obj ? obj.name : '（未设置学习对象）'}</div>
      <div className="session-prog">
        起始进度：{startProgress || '尚未记录'}
      </div>

      <div className="session-timer">{formatTimer(elapsed)}</div>

      {phase === 'timing' ? (
        <div className="session-actions">
          <button className="btn" onClick={handleCompleteObject} disabled={!obj}>
            完成当前内容
          </button>
          <button className="btn primary" onClick={handleEnd}>
            结束学习
          </button>
        </div>
      ) : (
        <div className="session-end-form">
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
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={handleResume}>
              继续学习
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
