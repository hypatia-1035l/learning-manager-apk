import { useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { TaskPool } from './components/TaskPool'
import { TaskDetail } from './components/TaskDetail'
import { RandomToolbox } from './components/RandomToolbox'
import { Settings } from './components/Settings'
import { DataBackup } from './components/DataBackup'
import { LearningSession } from './components/LearningSession'
import { StatsView } from './components/StatsView'
import { useAppData, pickRandomTask, carryOverManualPlanItems, dateKey, ensurePlansInStore } from './store'
import { setCanExitAppNative } from './backNavigation'
import {
  scheduleReminders,
  scheduleReengageNudge,
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
import { consumePendingNotifAction } from './studyNotifications'
import type { Task } from './types'

// 四个平级工作区（主导航）
type Tab = 'todos' | 'tools' | 'stats' | 'settings'

// 子页面视图（叠加在当前工作区之上，返回时回到对应工作区）
type View =
  | { name: 'task'; taskId: string; autoStartSession?: boolean }
  | { name: 'backup' }

const PERM_REQUESTED_KEY = 'learning-manager:notif-perm-requested'

export default function App() {
  // 当前工作区，默认进入「待办」
  const [tab, setTab] = useState<Tab>('todos')
  // 待办页内标签：plan / tasks，返回时保持
  const [todosTab, setTodosTab] = useState<'plan' | 'tasks'>('plan')
  // 子页面视图：null 时显示工作区主导航 + 当前 tab 内容
  const [view, setView] = useState<View | null>(null)
  // 通知动作「开始/换一个」直接进入的全屏计时会话
  const [sessionTask, setSessionTask] = useState<Task | null>(null)
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

  // 手动计划顺延：打开/切回前台时把过去日期仍待办的手动项并入今天（与提醒开关无关）。
  // 声明在提醒调度 effect 之前，保证调度时已包含顺延项。
  useEffect(() => {
    const carry = () => {
      try {
        carryOverManualPlanItems()
      } catch {
        /* ignore */
      }
    }
    carry()
    const onVis = () => {
      if (document.visibilityState === 'visible') carry()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // 注册会话结束回调：学习会话结束时记录结束时间并重新调度提醒
  useEffect(() => {
    const off = registerSessionEndCallback(() => {
      // 记录学习会话结束时间，用于「学习后 N 分钟不提醒」跳过逻辑
      try {
        const key = 'learning-manager:last-session-end'
        localStorage.setItem(key, String(Date.now()))
      } catch { /* ignore */ }
      if (data.reminder?.enabled) {
        endSessionAndReschedule().catch(() => {})
        // 会话结束 = 最近活跃，回归提醒续命
        scheduleReengageNudge().catch(() => {})
      }
    })
    return off
  }, [data.reminder?.enabled])

  // 提醒调度：启动时 + 切回前台时自动补齐当天/次日计划
  // 提醒开启，或存在固定任务时都运行（固定任务需进入每日计划）
  useEffect(() => {
    if (!data.reminder?.enabled && !(data.pinnedTasks?.length)) return

    const refresh = () => {
      try {
        // 保证计划存在（含固定任务注入），即便提醒关闭
        ensurePlansInStore()
      } catch {
        /* ignore */
      }
      scheduleReminders().catch(() => {})
      // 回归提醒：每次打开/切回前台都续命（不受每日守卫限制，日常打开永不触发）
      scheduleReengageNudge().catch(() => {})
    }

    // 启动时检查
    refresh()

    // 切回前台时检查（用户可能隔夜后切回）
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [data.reminder?.enabled, data.pinnedTasks?.length])

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

  // 消费原生通知动作（开始/换一个）：
  //   - 冷启动：MainActivity.onCreate 已把 notif_action 写入插件，启动时读取
  //   - 热启动：onNewIntent 写入，切回前台（visibilitychange）时读取
  useEffect(() => {
    let cancelled = false
    const drain = () => {
      ;(async () => {
        const pending = await consumePendingNotifAction()
        if (cancelled || !pending) return
        if (pending.action === 'reroll') {
          handleNotifAction({ taskId: pending.taskId || null, reroll: true })
        } else if (pending.action === 'start') {
          handleNotifAction({ taskId: pending.taskId || null })
        }
      })().catch(() => { /* ignore */ })
    }
    // 启动时尝试一次
    drain()
    // 切回前台时再尝试一次（热启动场景）
    const onVisibility = () => {
      if (document.visibilityState === 'visible') drain()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks])

  // 统一处理通知动作（开始/换一个/取消），供 JS 监听与原生 pending 两条路径复用
  const handleNotifAction = (action: {
    taskId: string | null
    reroll?: boolean
    cancelled?: boolean
  }) => {
    // 取消：不打开会话，停留在待办
    if (action.cancelled) {
      setTab('todos')
      setView(null)
      return
    }
    // 开始 / 换一个 / 点击通知本体
    // 仅提醒（或手动）项：不进计时/不换内容，只回到计划页处理
    const todayStr = dateKey(new Date())
    const today = (data.plans ?? []).find((p) => p.date === todayStr)
    const planItem = action.taskId
      ? today?.items
          .filter((it) => it.status === 'pending' && it.taskId === action.taskId)
          .sort((a, b) => a.minuteOfDay - b.minuteOfDay)[0] ?? null
      : null
    if (planItem?.manual && (action.reroll || !planItem.remindOnly)) {
      // 手动项：换一个无意义（内容是自输的）；计时型手动项正常进计时
      if (action.reroll) {
        setTab('todos')
        setView(null)
        return
      }
    }
    if (planItem?.remindOnly) {
      setTab('todos')
      setView(null)
      return
    }
    let target = action.taskId
      ? data.tasks.find((t) => t.id === action.taskId)
      : null
    // reroll 或通知本体无 taskId 时，随机抽一个
    if (!target) {
      target = pickRandomTask(data.tasks)
    }
    if (target) {
      setSessionTask(target)
    } else {
      setTab('todos')
      setView(null)
    }
  }

  // 监听通知点击：弹出操作选择弹窗（开始/换一个/取消）
  useEffect(() => {
    const off = onNotificationClick(handleNotifAction)
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks])

  // 同步「是否允许退桌面」标志位给原生层：
  //   - 子页面或有计时会话 → false，原生层不得 moveTaskToBack
  //   - 顶层 Tab            → true，原生层可把 App 退到桌面
  useEffect(() => {
    const canExitApp = !view && !sessionTask
    setCanExitAppNative(canExitApp).catch(() => { /* ignore */ })
  }, [view, sessionTask])

  // 监听系统返回键/边缘滑动返回（Android 手势导航）：
  //   有子页面（任务详情/提醒设置/备份）或弹窗时先回上一层，不直接退出应用
  useEffect(() => {
    let listener: { remove: () => Promise<void> } | null = null
    let cancelled = false
    ;(async () => {
      try {
        const l = await CapApp.addListener('backButton', ({ canGoBack }) => {
          // 子页面回到对应 tab 顶层
          if (view) {
            if (view.name === 'task') setTab('todos')
            else setTab('settings')
            setView(null)
            return
          }
          // 计时会话中：返回交给页面内的按钮，系统返回不响应
          // （原生侧此时同样禁用了 moveTaskToBack，返回键不会退桌面）
          if (sessionTask) return
          // 到了顶层 Tab：交给原生 finish / moveTaskToBack
          if (!canGoBack) {
            CapApp.exitApp().catch(() => { /* ignore */ })
          }
        })
        if (cancelled) { l.remove(); return }
        listener = l
      } catch {
        /* Web 端无此事件，忽略 */
      }
    })()
    return () => {
      cancelled = true
      if (listener) listener.remove().catch(() => {})
    }
  }, [view, sessionTask])

  // ===== 子页面（全屏，叠加在工作区之上）=====
  if (view) {
    if (view.name === 'task') {
      return (
        <div className="app">
          <TaskDetail
            taskId={view.taskId}
            autoStartSession={view.autoStartSession ?? false}
            onBack={() => {
              setTab('todos')
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
      <main className="shell-main">
        {tab === 'todos' && (
          <TaskPool
            defaultTab={todosTab}
            onTabChange={setTodosTab}
            onOpenTask={(task: Task, autoStart?: boolean) =>
              setView({ name: 'task', taskId: task.id, autoStartSession: autoStart })
            }
            onStartSession={(task: Task) => {
              setSessionTask(task)
            }}
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

      {sessionTask && (
        <LearningSession
          task={sessionTask}
          onClose={() => setSessionTask(null)}
          onTaskMutated={() => {}}
        />
      )}
    </div>
  )
}
