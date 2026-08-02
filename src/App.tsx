import { useEffect, useRef, useState } from 'react'
import { TaskPool } from './components/TaskPool'
import { TaskDetail } from './components/TaskDetail'
import { RandomToolbox } from './components/RandomToolbox'
import { Settings } from './components/Settings'
import { ReminderSettings } from './components/ReminderSettings'
import { DataBackup } from './components/DataBackup'
import { ReminderActionModal } from './components/ReminderActionModal'
import { StatsView } from './components/StatsView'
import { useAppData, pickRandomTask, getRandomPool } from './store'
import {
  scheduleReminders,
  onNotificationClick,
  registerSessionEndCallback,
  endSessionAndReschedule,
  isSessionActive,
  setSessionActive,
  requestNotificationPermission,
} from './reminderService'
import {
  getStudyTimerStatus,
} from './studyTimer'
import type { Task } from './types'

// 四个平级工作区（主导航）
type Tab = 'todos' | 'tools' | 'stats' | 'settings'

// 子页面视图（叠加在当前工作区之上，返回时回到对应工作区）
type View =
  | { name: 'task'; taskId: string }
  | { name: 'reminder' }
  | { name: 'backup' }

const PERM_REQUESTED_KEY = 'learning-manager:notif-perm-requested'

export default function App() {
  // 当前工作区，默认进入「待办」
  const [tab, setTab] = useState<Tab>('todos')
  // 子页面视图：null 时显示工作区主导航 + 当前 tab 内容
  const [view, setView] = useState<View | null>(null)
  // 提醒通知点击后的操作弹窗
  const [reminderAction, setReminderAction] = useState<Task | null>(null)
  const data = useAppData()
  const studyTimerCheckedRef = useRef(false)

  // 首次启动：直接请求通知权限（Android 13+ 需运行时申请）
  useEffect(() => {
    try {
      const requested = localStorage.getItem(PERM_REQUESTED_KEY)
      if (!requested) {
        requestNotificationPermission().finally(() => {
          localStorage.setItem(PERM_REQUESTED_KEY, '1')
        })
      }
    } catch {
      /* ignore */
    }
  }, [])

  // 注册会话结束回调：学习会话结束时设置冷却并重新调度提醒
  useEffect(() => {
    const off = registerSessionEndCallback(() => {
      // 记录学习会话结束时间，用于「学习后 N 分钟不提醒」跳过逻辑
      try {
        const key = 'learning-manager:last-session-end'
        localStorage.setItem(key, String(Date.now()))
      } catch { /* ignore */ }
      if (data.reminder?.enabled) {
        endSessionAndReschedule(data.tasks, data.reminder).catch(() => {})
      }
    })
    return off
  }, [data.tasks, data.reminder])

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

  // 启动时检查 StudyTimer Service 状态 + 消费 pending action
  useEffect(() => {
    if (studyTimerCheckedRef.current) return
    studyTimerCheckedRef.current = true
    ;(async () => {
      const status = await getStudyTimerStatus()
      if (!status?.isRunning) {
        // Service 未在跑但 sessionActive 标志残留（App 被杀后重启）：清理脏状态
        if (isSessionActive()) {
          await setSessionActive(false)
        }
        return
      }
      const taskName = status.taskName
      if (!taskName) return
      const matchedTask = data.tasks.find((t) => t.name === taskName)
      if (!matchedTask) return
      // 跳转到任务详情页；LearningSession 会从 Service 状态恢复计时 + 消费 pending action
      setView({ name: 'task', taskId: matchedTask.id })
    })().catch(() => {
      /* ignore */
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks])

  // 监听通知点击：弹出操作选择弹窗（开始/换一个/延迟/忽略）
  useEffect(() => {
    const off = onNotificationClick((action) => {
      if (action.taskId) {
        const matchedTask = data.tasks.find((t) => t.id === action.taskId)
        if (matchedTask) {
          setReminderAction(matchedTask)
        }
      } else {
        setTab('todos')
        setView(null)
      }
    })
    return off
  }, [data.tasks])

  // 提醒操作弹窗回调
  const handleReminderStart = (task: Task) => {
    setReminderAction(null)
    setView({ name: 'task', taskId: task.id })
    // TaskDetail 中的 LearningSession 会自动启动计时并标记会话活跃
  }

  const handleReminderReroll = () => {
    const picked = pickRandomTask(data.tasks)
    if (picked) {
      setReminderAction(picked)
    }
  }

  // ===== 子页面（全屏，叠加在工作区之上）=====
  if (view) {
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
          />
        )}
        {tab === 'tools' && <RandomToolbox />}
        {tab === 'stats' && (
          <StatsView
            onOpenTask={(taskId: string) =>
              setView({ name: 'task', taskId })
            }
          />
        )}
        {tab === 'settings' && (
          <Settings
            onOpenReminder={() => setView({ name: 'reminder' })}
            onOpenBackup={() => setView({ name: 'backup' })}
          />
        )}
      </main>

      <nav className="tabbar">
        <button
          className={`tabbar-item ${tab === 'todos' ? 'active' : ''}`}
          onClick={() => setTab('todos')}
        >
          <span className="tb-name">待办</span>
        </button>
        <button
          className={`tabbar-item ${tab === 'tools' ? 'active' : ''}`}
          onClick={() => setTab('tools')}
        >
          <span className="tb-name">工具</span>
        </button>
        <button
          className={`tabbar-item ${tab === 'stats' ? 'active' : ''}`}
          onClick={() => setTab('stats')}
        >
          <span className="tb-name">统计</span>
        </button>
        <button
          className={`tabbar-item ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <span className="tb-name">设置</span>
        </button>
      </nav>

      {reminderAction && data.reminder && (
        <ReminderActionModal
          task={reminderAction}
          cooldownMinutes={data.reminder.cooldownMinutes}
          randomPoolSize={getRandomPool(data.tasks).length}
          onStart={handleReminderStart}
          onReroll={handleReminderReroll}
          onClose={() => setReminderAction(null)}
        />
      )}
    </div>
  )
}
