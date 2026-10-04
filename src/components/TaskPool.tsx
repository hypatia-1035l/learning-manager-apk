import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Swiper, SwiperSlide } from 'swiper/react'
import type { Swiper as SwiperClass } from 'swiper'
import 'swiper/css'
import {
  useAppData,
  getCurrentObject,
  setTaskEnabled,
  reorderTask,
  moveTaskToEdge,
  pickRandomTask,
  getPlanForDate,
  dateKey,
  updatePlanItemStatus,
  rerollPlanItem,
  regeneratePlanDayInStore,
  deletePlanItem,
} from '../store'
import { scheduleReminders } from '../reminderService'
import { weekdaysShort } from './WeekdayPicker'
import { TaskForm } from './TaskForm'
import { PlanForm } from './PlanForm'
import { ReminderSettings } from './ReminderSettings'
import type { PlanItem } from '../types'
import type { Task } from '../types'

interface Props {
  onOpenTask: (task: Task, autoStart?: boolean) => void
  onStartSession?: (task: Task) => void
  defaultTab?: 'plan' | 'tasks'
  onTabChange?: (tab: 'plan' | 'tasks') => void
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function minuteLabel(m: number): string {
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

export function TaskPool({
  onOpenTask,
  onStartSession,
  defaultTab = 'plan',
  onTabChange,
}: Props) {
  const data = useAppData()
  const [showForm, setShowForm] = useState(false)
  const [showReminder, setShowReminder] = useState(false)
  const [showPlanForm, setShowPlanForm] = useState(false)
  // 计划 / 方向 两个内部标签页
  const [poolTab, setPoolTab] = useState<'plan' | 'tasks'>(defaultTab)
  useEffect(() => {
    setPoolTab(defaultTab)
  }, [defaultTab])
  const swiperRef = useRef<SwiperClass | null>(null)
  useEffect(() => {
    const sw = swiperRef.current
    if (sw && !sw.destroyed) sw.slideTo(poolTab === 'plan' ? 0 : 1, 0)
  }, [poolTab])

  const handleRandomStart = () => {
    const picked = pickRandomTask(data.tasks)
    if (picked && onStartSession) onStartSession(picked)
  }

  // ===== 今日计划 =====
  const now = new Date()
  const todayKey = dateKey(now)
  const tomorrowKey = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  const todayPlan = getPlanForDate(data.plans, todayKey)
  const tomorrowPlan = getPlanForDate(data.plans, tomorrowKey)
  const planItems = [...(todayPlan?.items ?? [])].sort((a, b) => a.minuteOfDay - b.minuteOfDay)
  const showPlan = !!todayPlan && planItems.length > 0

  // 计划项开始：交给 App 层打开全屏计时会话（方向被删则忽略）
  const startPlanItem = (item: PlanItem) => {
    const task = data.tasks.find((t) => t.id === item.taskId)
    if (task && onStartSession) onStartSession(task)
  }
  // 换一个：同时刻换方向，然后重调度刷新通知内容
  const handleReroll = (item: PlanItem, dayKey: string) => {
    const updated = rerollPlanItem(dayKey, item.id)
    if (updated && data.reminder?.enabled) {
      scheduleReminders().catch(() => {})
    }
  }
  // 完成或跳过：更新状态并重调度（移除对应通知）
  const handleStatus = (item: PlanItem, dayKey: string, status: PlanItem['status']) => {
    updatePlanItemStatus(dayKey, item.id, status)
    if (data.reminder?.enabled) {
      scheduleReminders().catch(() => {})
    }
  }
  // 删除手动计划项并重调度（移除对应通知）
  const handleDelete = (item: PlanItem, dayKey: string) => {
    deletePlanItem(dayKey, item.id)
    if (data.reminder?.enabled) {
      scheduleReminders().catch(() => {})
    }
  }

  // 计划条目渲染已迁移为模块级 PlanItemRow 组件（见文件末尾）

  return (
    <div className="pool-compact">
      <div className="pool-fixed-header">
        {/* ===== 内部标签切换：计划 / 方向 ===== */}
        <div className="tabs">
          <button
            className={`tab ${poolTab === 'plan' ? 'active' : ''}`}
            onClick={() => {
              setPoolTab('plan')
              onTabChange?.('plan')
              swiperRef.current?.slideTo(0)
            }}
          >
            计划
          </button>
          <button
            className={`tab ${poolTab === 'tasks' ? 'active' : ''}`}
            onClick={() => {
              setPoolTab('tasks')
              onTabChange?.('tasks')
              swiperRef.current?.slideTo(1)
            }}
          >
            方向
          </button>
        </div>

        {poolTab === 'plan' && (
          <div className="pool-toolbar">
            <span className="pool-meta faint">计划操作</span>
            <div className="row" style={{ gap: 8 }}>
              <button
                className={`btn ${data.reminder?.enabled ? 'reminder-on' : ''}`}
                onClick={() => setShowReminder(true)}
              >
                {data.reminder?.enabled ? '提醒已开' : '提醒'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  regeneratePlanDayInStore(todayKey)
                  if (data.reminder?.enabled) {
                    scheduleReminders().catch(() => {})
                  }
                }}
                title="保留已完成项，重排待办项的时刻与方向"
              >
                重排
              </button>
              <button className="btn primary" onClick={() => setShowPlanForm(true)}>
                新建
              </button>
            </div>
          </div>
        )}

        {poolTab === 'tasks' && (
          <div className="pool-toolbar">
            <span className="pool-meta">共 {data.tasks.length} 个</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" onClick={handleRandomStart}>
                随机开始
              </button>
              <button className="btn" onClick={() => setShowForm(true)}>
                + 新建
              </button>
            </div>
          </div>
        )}
      </div>

      <Swiper
        className="inner-tab-swiper"
        onSwiper={(s) => (swiperRef.current = s)}
        onSlideChange={(s) => {
          const next = s.activeIndex === 0 ? 'plan' : 'tasks'
          setPoolTab(next)
          onTabChange?.(next)
        }}
        initialSlide={poolTab === 'plan' ? 0 : 1}
      >
        <SwiperSlide>
          <div className="pool-scroll">
            {showPlan ? (
              <div className="plan-section">
                <div className="plan-list">
                  {planItems.map((it) => (
                    <PlanItemRow
                      key={it.id}
                      item={it}
                      dayKey={todayKey}
                      isToday
                      canStart={!!data.tasks.find((t) => t.id === it.taskId)}
                      onStart={startPlanItem}
                      onReroll={handleReroll}
                      onStatus={handleStatus}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
                {tomorrowPlan && tomorrowPlan.items.length > 0 && (
                  <div className="plan-list tomorrow">
                    <div className="faint" style={{ fontSize: 12, margin: '10px 0 4px' }}>
                      明天已排 {tomorrowPlan.items.length} 项（到点自动提醒）
                    </div>
                    {[...tomorrowPlan.items]
                      .sort((a, b) => a.minuteOfDay - b.minuteOfDay)
                      .map((it) => (
                        <PlanItemRow
                          key={it.id}
                          item={it}
                          dayKey={tomorrowKey}
                          isToday={false}
                          canStart={!!data.tasks.find((t) => t.id === it.taskId)}
                          onStart={startPlanItem}
                          onReroll={handleReroll}
                          onStatus={handleStatus}
                          onDelete={handleDelete}
                        />
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="plan-empty faint">今日暂无计划，开启提醒后会在当天生成。</div>
            )}
          </div>
        </SwiperSlide>

        <SwiperSlide>
          <div className="pool-scroll">
            {data.tasks.length === 0 ? (
              <div className="empty-state compact-empty">
                <p>暂无方向</p>
              </div>
            ) : (
              <div className="task-grid">
                {data.tasks.map((task, idx) => {
                  const obj = getCurrentObject(task)
                  const wd = weekdaysShort(task.weekdays)
                  const isFirst = idx === 0
                  const isLast = idx === data.tasks.length - 1
                  return (
                    <div
                      key={task.id}
                      className={`task-card ${task.enabled ? '' : 'disabled'}`}
                      onClick={() => onOpenTask(task)}
                    >
                      <label
                        className="tc-toggle"
                        title="启用 / 停用"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={task.enabled}
                          onChange={(e) => setTaskEnabled(task.id, e.target.checked)}
                        />
                      </label>

                      <div className="tc-body">
                        <div className="tc-title">
                          <span className="tc-name">{task.name}</span>
                          {wd && (
                            <span
                              className="wd-chip"
                              title={`提醒星期：周${wd.split('').join('周')}`}
                            >
                              周{wd}
                            </span>
                          )}
                        </div>
                        <div className="tc-seq faint">
                          {obj
                            ? obj.name
                            : task.group && task.group.items.length
                              ? '未选择'
                              : '暂无'}
                        </div>
                      </div>

                      <div className="tc-reorder" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="reorder-btn"
                          disabled={isFirst}
                          title="置顶"
                          onClick={() => moveTaskToEdge(task.id, 'top')}
                        >
                          ⤒
                        </button>
                        <button
                          className="reorder-btn"
                          disabled={isFirst}
                          title="上移"
                          onClick={() => reorderTask(task.id, 'up')}
                        >
                          ↑
                        </button>
                        <button
                          className="reorder-btn"
                          disabled={isLast}
                          title="下移"
                          onClick={() => reorderTask(task.id, 'down')}
                        >
                          ↓
                        </button>
                        <button
                          className="reorder-btn"
                          disabled={isLast}
                          title="置底"
                          onClick={() => moveTaskToEdge(task.id, 'bottom')}
                        >
                          ⤓
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </SwiperSlide>
      </Swiper>

      {showForm && <TaskForm onClose={() => setShowForm(false)} />}
      {showPlanForm && (
        <PlanForm
          todayKey={todayKey}
          onClose={() => setShowPlanForm(false)}
          onStartSession={onStartSession}
        />
      )}
      {showReminder && (
        <ReminderSettings
          onClose={() => {
            setShowReminder(false)
            if (data.reminder?.enabled) {
              scheduleReminders().catch(() => {})
            }
          }}
        />
      )}
    </div>
  )
}

// ===== 计划条目：左滑揭示操作，前景只留「开始」（仅提醒项为「完成」） =====
const ACTIONS_W = 150

function PlanItemRow({
  item,
  dayKey,
  isToday,
  canStart,
  onStart,
  onReroll,
  onStatus,
  onDelete,
}: {
  item: PlanItem
  dayKey: string
  isToday: boolean
  canStart: boolean
  onStart: (item: PlanItem) => void
  onReroll: (item: PlanItem, dayKey: string) => void
  onStatus: (item: PlanItem, dayKey: string, status: PlanItem['status']) => void
  onDelete: (item: PlanItem, dayKey: string) => void
}) {
  const now = new Date()
  const nowMinute = now.getHours() * 60 + now.getMinutes()
  const overdue = isToday && item.status === 'pending' && item.minuteOfDay <= nowMinute
  const manual = !!item.manual
  const remindOnly = !!item.remindOnly
  const [offset, setOffset] = useState(0)
  const [anim, setAnim] = useState(false)
  const drag = useRef<{ x: number; start: number } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, start: offset }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setAnim(false)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const delta = e.clientX - drag.current.x
    setOffset(Math.min(0, Math.max(-ACTIONS_W, drag.current.start + delta)))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    setAnim(true)
    setOffset((o) => (o < -ACTIONS_W / 2 ? -ACTIONS_W : 0))
  }
  const close = () => {
    setAnim(true)
    setOffset(0)
  }

  // 已完成 / 已跳过：扁平行，变灰划线，无滑动操作
  if (item.status !== 'pending') {
    return (
      <div className={`plan-item ${item.status}`}>
        <div className="plan-front">
          <span className="plan-time">{minuteLabel(item.minuteOfDay)}</span>
          <div className="plan-main">
            <div className="plan-name">{item.taskName}</div>
            <div className="plan-seq">{item.sequenceName ?? '（未设置序列）'}</div>
          </div>
          <span className="plan-status">
            {item.status === 'done' ? '已完成' : '已跳过'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`plan-item ${overdue ? 'overdue' : ''}`}>
      <div className="plan-actions">
        {!manual && (
          <button
            className="swipe-btn reroll"
            onClick={() => {
              onReroll(item, dayKey)
              close()
            }}
          >
            更换
          </button>
        )}
        <button
          className="swipe-btn skip"
          onClick={() => {
            onStatus(item, dayKey, 'skipped')
            close()
          }}
        >
          跳过
        </button>
        {manual ? (
          <button
            className="swipe-btn done"
            title="从计划中删除"
            onClick={() => {
              onDelete(item, dayKey)
              close()
            }}
          >
            删除
          </button>
        ) : (
          <button
            className="swipe-btn done"
            onClick={() => {
              onStatus(item, dayKey, 'done')
              close()
            }}
          >
            完成
          </button>
        )}
      </div>
      <div
        className={`plan-front ${anim ? 'anim' : ''} ${overdue ? 'overdue' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="plan-time">{minuteLabel(item.minuteOfDay)}</span>
        <div className="plan-main">
          <div className="plan-name">
            {item.taskName}
            {item.carriedFrom && <span className="plan-chip">顺延</span>}
            {item.durationSec ? (
              <span className="plan-chip">{Math.round(item.durationSec / 60)}分钟</span>
            ) : null}
          </div>
          <div className="plan-seq">{item.sequenceName ?? '（未设置序列）'}</div>
        </div>
        {remindOnly ? (
          <button
            className="icon-btn start"
            title="仅提醒：直接标记完成"
            onClick={() => onStatus(item, dayKey, 'done')}
          >
            完成
          </button>
        ) : canStart ? (
          <button className="icon-btn start" onClick={() => onStart(item)}>
            开始
          </button>
        ) : null}
      </div>
    </div>
  )
}
