import { useEffect, useRef, useState } from 'react'
import { TaskPool } from './components/TaskPool'
import { TaskDetail } from './components/TaskDetail'
import { RandomToolbox } from './components/RandomToolbox'
import { Settings } from './components/Settings'
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

// 三个平级工作区（主导航）
type Tab = 'todos' | 'tools' | 'settings'

// 子页面视图（叠加在当前工作区之上，返回时回到对应工作区）
type View =
  | { name: 'task'; taskId: string }
  | { name: 'reminder' }
  | { name: 'today' }
  | { name: 'slacking' }
  | { name: 'backup' }

const GUIDE_KEY = 'learning-manager:vivo-guide-shown:v1'

export default function App() {
  // 当前工作区，默认进入「待办」
  const [tab, setTab] = useState<Tab>('todos')
  // 子页面视图：null 时显示工作区主导航 + 当前 tab 内容
  const [view, setView] = useState<View | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [pendingEvaluation, setPendingEvaluation] =
    useState<SlackingEvaluation | null>(null)
  const data = useAppData()
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

  // 提醒调度：启动时 + 切回前台时自动补充当天提醒
  useEffect(() => {
    if (!data.reminder?.enabled) return

    const checkAndSchedule = () => {
      try {
        const lastDate = localStorage.getItem('learning-manager:last-scheduled-date')
        const today = new Date().toISOString().slice(0, 10)
        if (lastDate !== today) {
          scheduleReminders(data.tasks, data.reminder!).catch(() => {})
          localStorage.setItem('learning-manager:last-scheduled-date', today)
        }
      } catch {
        /* ignore */
      }
    }

    // 启动时检查
    checkAndSchedule()

    // 切回前台时检查（用户可能隔夜后切回）
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkAndSchedule()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [data.tasks, data.reminder?.enabled])

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
      // 普通提醒：跳转任务详情，或回到待办工作区
      if (action.taskId) {
        setView({ name: 'task', taskId: action.taskId })
      } else {
        setTab('todos')
        setView(null)
      }
    })
    return off
  }, [])

  // ===== 子页面（全屏，叠加在工作区之上）=====
  // 返回时回到对应工作区 tab
  if (view) {
    // 待办工作区的子页面
    if (view.name === 'task') {
      return (
        <div className="app">
          <TaskDetail
            taskId={view.taskId}
            onBack={() => {
              setTab('todos')
              setView(null)
            }}
          />
        </div>
      )
    }
    if (view.name === 'today') {
      return (
        <div className="app">
          <TodayStatus
            onBack={() => {
              setTab('todos')
              setView(null)
            }}
          />
        </div>
      )
    }
    // 设置工作区的子页面
    if (view.name === 'reminder') {
      return (
        <div className="app">
          <ReminderSettings
            onBack={() => {
              setTab('settings')
              setView(null)
            }}
          />
        </div>
      )
    }
    if (view.name === 'slacking') {
      return (
        <div className="app">
          <SlackingRules
            onBack={() => {
              setPendingEvaluation(null)
              setTab('settings')
              setView(null)
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
          <DataBackup
            onBack={() => {
              setTab('settings')
              setView(null)
            }}
          />
        </div>
      )
    }
  }

  // ===== 工作区 Shell：顶部标题 + 内容区 + 底部 TabBar =====
  return (
    <div className="app app-shell">
      <header className="shell-header">
        <h1 className="app-title">今天摸啥鱼</h1>
      </header>

      <main className="shell-main">
        {tab === 'todos' && (
          <TaskPool
            onOpenTask={(task: Task) => setView({ name: 'task', taskId: task.id })}
            onOpenTodayStatus={() => setView({ name: 'today' })}
          />
        )}
        {tab === 'tools' && <RandomToolbox />}
        {tab === 'settings' && (
          <Settings
            onOpenReminder={() => setView({ name: 'reminder' })}
            onOpenSlackingRules={() => setView({ name: 'slacking' })}
            onOpenBackup={() => setView({ name: 'backup' })}
          />
        )}
      </main>

      <nav className="tabbar">
        <button
          className={`tabbar-item ${tab === 'todos' ? 'active' : ''}`}
          onClick={() => setTab('todos')}
        >
          <span className="tb-icon">📋</span>
          <span className="tb-name">待办</span>
        </button>
        <button
          className={`tabbar-item ${tab === 'tools' ? 'active' : ''}`}
          onClick={() => setTab('tools')}
        >
          <span className="tb-icon">🧰</span>
          <span className="tb-name">工具</span>
        </button>
        <button
          className={`tabbar-item ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <span className="tb-icon">⚙️</span>
          <span className="tb-name">设置</span>
        </button>
      </nav>

      {showGuide && <VivoPermissionGuide onClose={closeGuide} />}
    </div>
  )
}
