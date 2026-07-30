import { useEffect, useRef, useState } from 'react'
import { TaskPool } from './components/TaskPool'
import { TaskDetail } from './components/TaskDetail'
import { RandomToolbox } from './components/RandomToolbox'
import { ReminderSettings } from './components/ReminderSettings'
import { TodayStatus } from './components/TodayStatus'
import { SlackingRules } from './components/SlackingRules'
import { DataBackup } from './components/DataBackup'
import { VivoPermissionGuide } from './components/VivoPermissionGuide'
import { useAppData } from './store'
import {
  scheduleReminders,
  onNotificationClick,
} from './reminderService'
import { runSlackingDetection } from './slackingRulesService'
import type { SlackingEvaluation } from './slackingRulesService'
import {
  getStudyTimerStatus,
} from './studyTimer'
import type { Task } from './types'

type View =
  | { name: 'pool' }
  | { name: 'task'; taskId: string }
  | { name: 'toolbox' }
  | { name: 'reminder' }
  | { name: 'today' }
  | { name: 'slacking' }
  | { name: 'backup' }

const GUIDE_KEY = 'learning-manager:vivo-guide-shown:v1'

export default function App() {
  const [view, setView] = useState<View>({ name: 'pool' })
  const [showGuide, setShowGuide] = useState(false)
  const [pendingEvaluation, setPendingEvaluation] =
    useState<SlackingEvaluation | null>(null)
  const data = useAppData()
  const scheduledRef = useRef(false)
  const slackingCheckedRef = useRef(false)
  const studyTimerCheckedRef = useRef(false)

  // 首次启动显示 vivo 权限引导
  useEffect(() => {
    try {
      const shown = localStorage.getItem(GUIDE_KEY)
      if (!shown) setShowGuide(true)
    } catch {
      /* ignore */
    }
  }, [])

  const closeGuide = () => {
    setShowGuide(false)
    try {
      localStorage.setItem(GUIDE_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  // 启动时根据提醒配置调度通知（仅一次）
  useEffect(() => {
    if (scheduledRef.current) return
    scheduledRef.current = true
    if (data.reminder?.enabled) {
      scheduleReminders(data.tasks, data.reminder).catch(() => {})
    }
  }, [data.reminder?.enabled])

  // 启动时检测摸鱼规则（仅一次，静默失败）
  useEffect(() => {
    if (slackingCheckedRef.current) return
    slackingCheckedRef.current = true
    runSlackingDetection(data.tasks, data.records)
      .then((evaluation) => {
        if (evaluation && evaluation.shouldTrigger) {
          setPendingEvaluation(evaluation)
        }
      })
      .catch(() => {
        /* ignore */
      })
  }, [data.tasks, data.records])

  // 启动时检查 StudyTimer Service 状态 + 消费 pending action
  // - 若 Service 在运行（学习被中断）或有 pending action=end，
  //   根据 taskName 跳转到对应任务详情，让 LearningSession 接管恢复
  // - 注意：consumePendingAction 仅消费一次；LearningSession 挂载后内部会再消费一次，
  //   因此这里用一个新的"peek"读取（getStatus 即可，pending action 交由 LearningSession 消费）
  useEffect(() => {
    if (studyTimerCheckedRef.current) return
    studyTimerCheckedRef.current = true
    ;(async () => {
      const status = await getStudyTimerStatus()
      if (!status?.isRunning) return
      const taskName = status.taskName
      if (!taskName) return
      const matchedTask = data.tasks.find((t) => t.name === taskName)
      if (!matchedTask) return
      // 跳转到任务详情页；LearningSession 会从 Service 状态恢复计时 + 消费 pending action
      setView({ name: 'task', taskId: matchedTask.id })
    })().catch(() => {
      /* ignore */
    })
  }, [data.tasks])

  // 前台轮询 + 切回前台检测
  // 每 10 分钟轮询一次；从其他应用切回时立即检测（silent：只显示卡片，不发通知）
  useEffect(() => {
    let cancelled = false

    const detect = () => {
      if (cancelled) return
      runSlackingDetection(data.tasks, data.records, true)
        .then((evaluation) => {
          if (evaluation && evaluation.shouldTrigger && !cancelled) {
            setPendingEvaluation(evaluation)
          }
        })
        .catch(() => {
          /* ignore */
        })
    }

    // 定时轮询：每 10 分钟
    const intervalId = window.setInterval(detect, 10 * 60 * 1000)

    // 切回前台时检测（WebView 重新可见）
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        detect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [data.tasks, data.records])

  // 监听通知点击，区分普通提醒和摸鱼提醒
  useEffect(() => {
    const off = onNotificationClick((action) => {
      if (action.action === 'slacking') {
        // 摸鱼通知点击：跳转到摸鱼规则页面，显示提醒卡片
        setPendingEvaluation({
          shouldTrigger: true,
          situation: 'entertainment_too_long',
          reason: '点击通知查看',
          recommendedTaskId: action.taskId,
        })
        setView({ name: 'slacking' })
        return
      }
      // 普通提醒：跳转任务详情或首页
      if (action.taskId) {
        setView({ name: 'task', taskId: action.taskId })
      } else {
        setView({ name: 'pool' })
      }
    })
    return off
  }, [])

  if (view.name === 'task') {
    return (
      <div className="app">
        <TaskDetail
          taskId={view.taskId}
          onBack={() => setView({ name: 'pool' })}
        />
      </div>
    )
  }

  if (view.name === 'toolbox') {
    return (
      <div className="app">
        <RandomToolbox onBack={() => setView({ name: 'pool' })} />
      </div>
    )
  }

  if (view.name === 'reminder') {
    return (
      <div className="app">
        <ReminderSettings onBack={() => setView({ name: 'pool' })} />
      </div>
    )
  }

  if (view.name === 'today') {
    return (
      <div className="app">
        <TodayStatus onBack={() => setView({ name: 'pool' })} />
      </div>
    )
  }

  if (view.name === 'slacking') {
    return (
      <div className="app">
        <SlackingRules
          onBack={() => {
            setPendingEvaluation(null)
            setView({ name: 'pool' })
          }}
          onOpenTask={(task: Task) => {
            setPendingEvaluation(null)
            setView({ name: 'task', taskId: task.id })
          }}
          pendingEvaluation={pendingEvaluation}
          onDismissEvaluation={() => setPendingEvaluation(null)}
        />
      </div>
    )
  }

  if (view.name === 'backup') {
    return (
      <div className="app">
        <DataBackup onBack={() => setView({ name: 'pool' })} />
      </div>
    )
  }

  return (
    <div className="app">
      <TaskPool
        onOpenTask={(task: Task) => setView({ name: 'task', taskId: task.id })}
        onOpenToolbox={() => setView({ name: 'toolbox' })}
        onOpenReminder={() => setView({ name: 'reminder' })}
        onOpenTodayStatus={() => setView({ name: 'today' })}
        onOpenSlackingRules={() => setView({ name: 'slacking' })}
        onOpenBackup={() => setView({ name: 'backup' })}
      />
      {showGuide && <VivoPermissionGuide onClose={closeGuide} />}
    </div>
  )
}
