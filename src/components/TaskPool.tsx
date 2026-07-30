import { useState } from 'react'
import {
  useAppData,
  getCurrentObject,
  setTaskEnabled,
  setTaskRandomEnabled,
  setTaskWeight,
  pickRandomTask,
  getContinueTask,
} from '../store'
import { TASK_STATUS_LABELS } from '../types'
import { getTypeLabel } from '../taskTypes'
import { formatDuration } from '../utils'
import { TaskForm } from './TaskForm'
import { LearningSession } from './LearningSession'
import { RandomResultModal } from './RandomResultModal'
import { TaskTypeManager } from './TaskTypeManager'
import type { Task } from '../types'

interface Props {
  onOpenTask: (task: Task) => void
  onOpenToolbox: () => void
  onOpenReminder: () => void
  onOpenTodayStatus: () => void
  onOpenSlackingRules: () => void
  onOpenBackup: () => void
}

export function TaskPool({ onOpenTask, onOpenToolbox, onOpenReminder, onOpenTodayStatus, onOpenSlackingRules, onOpenBackup }: Props) {
  const data = useAppData()
  const [showForm, setShowForm] = useState(false)
  const [randomTask, setRandomTask] = useState<Task | null>(null)
  const [sessionTaskId, setSessionTaskId] = useState<string | null>(null)

  const enabledCount = data.tasks.filter((t) => t.enabled).length
  const continueTask = getContinueTask(data.tasks, data.records)
  const sessionTask = sessionTaskId
    ? data.tasks.find((t) => t.id === sessionTaskId) ?? null
    : null

  const handleRandomStart = () => {
    const picked = pickRandomTask(data.tasks)
    setRandomTask(picked)
  }

  return (
    <div>
      <header className="app-header">
        <h1 className="app-title">
          学习管理<span className="sub">Learning Manager</span>
        </h1>
      </header>
      <p className="app-tagline">
        管理长期学习方向 · 正向计时 · 自动接续下一项
      </p>

      {/* ===== 顶部：继续学习 ===== */}
      <section className="hero continue-hero">
        <div className="hero-label">继续学习</div>
        {continueTask ? (
          <div
            className="continue-card"
            onClick={() => setSessionTaskId(continueTask.id)}
          >
            <span className="cc-icon">{continueTask.icon}</span>
            <div className="cc-body">
              <div className="cc-name">{continueTask.name}</div>
              <div className="cc-obj">
                当前：《{getCurrentObject(continueTask)?.name ?? '—'}》
              </div>
              <div className="cc-prog">
                位置：
                <b>{getCurrentObject(continueTask)?.progress || '尚未记录'}</b>
              </div>
            </div>
            <div className="cc-action">
              <span className={`status-tag status-${continueTask.status}`}>
                {TASK_STATUS_LABELS[continueTask.status]}
              </span>
              <button className="btn primary sm">▶ 继续</button>
            </div>
          </div>
        ) : (
          <div className="hero-empty">
            暂无可继续的任务。在下方任务池添加学习对象后即可开始。
          </div>
        )}
      </section>

      {/* ===== 中部：随机开始 + 随机工具 + 提醒 + 今日状态 ===== */}
      <section className="hero random-hero">
        <div className="hero-label">不知道学什么？</div>
        <div className="hero-row">
          <button className="btn primary lg" onClick={handleRandomStart}>
            🎲 随机开始
          </button>
          <button className="btn lg" onClick={onOpenToolbox}>
            🧰 随机工具
          </button>
          <button className="btn lg" onClick={onOpenReminder}>
            🔔 提醒设置
          </button>
          <button className="btn lg" onClick={onOpenTodayStatus}>
            📊 今日状态
          </button>
          <button className="btn lg" onClick={onOpenSlackingRules}>
            🐟 摸鱼规则
          </button>
          <button className="btn lg" onClick={onOpenBackup}>
            💾 数据备份
          </button>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          随机开始：选择学习方向 · 随机工具：数字/词库随机 · 提醒：定时提醒摸鱼 · 今日状态：了解手机时间去了哪里 · 摸鱼规则：智能提醒捞鱼 · 数据备份：导出/导入
        </div>
      </section>

      {/* ===== 下方：任务池列表 ===== */}
      <div className="pool-toolbar">
        <span className="pool-meta">
          任务池 · {data.tasks.length} 项 / 启用 {enabledCount} 项
        </span>
        <button className="btn primary" onClick={() => setShowForm(true)}>
          + 新建学习方向
        </button>
      </div>

      {data.tasks.length === 0 ? (
        <div className="empty-state">
          <div className="big">📚</div>
          <p>还没有学习方向。</p>
          <p>点击「新建学习方向」开始管理你的长期学习。</p>
        </div>
      ) : (
        <div className="task-grid">
          {data.tasks.map((task) => {
            const obj = getCurrentObject(task)
            return (
              <div
                key={task.id}
                className={`task-card ${task.enabled ? '' : 'disabled'}`}
                onClick={() => task.enabled && onOpenTask(task)}
              >
                <div className="tc-head">
                  <span className="tc-icon">{task.icon}</span>
                  <span className="tc-name">{task.name}</span>
                  <span className="tc-type">{getTypeLabel(task.type)}</span>
                </div>

                <div className="tc-current">
                  <div className="label">当前学习对象</div>
                  {obj ? (
                    <>
                      <div className="obj">{obj.name}</div>
                      <div className="prog">
                        进度：<b>{obj.progress || '尚未记录'}</b>
                      </div>
                    </>
                  ) : (
                    <div className="obj faint" style={{ fontWeight: 400 }}>
                      {task.group && task.group.items.length
                        ? '未选择对象'
                        : '尚未添加内容'}
                    </div>
                  )}
                </div>

                <div className="tc-foot">
                  <span
                    className={`status-tag status-${task.status}`}
                    title="任务状态"
                  >
                    {TASK_STATUS_LABELS[task.status]}
                  </span>
                  <span>累计 {formatDuration(task.totalStudyTime)}</span>
                </div>

                <div
                  className="tc-controls"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="muted" title="是否启用此方向">
                    <input
                      type="checkbox"
                      checked={task.enabled}
                      onChange={(e) => setTaskEnabled(task.id, e.target.checked)}
                    />
                    启用
                  </label>
                  <label
                    className="muted"
                    title="关闭后不进入随机池"
                  >
                    <input
                      type="checkbox"
                      checked={task.randomEnabled}
                      onChange={(e) =>
                        setTaskRandomEnabled(task.id, e.target.checked)
                      }
                    />
                    参与随机
                  </label>
                  <label
                    className="muted weight-ctrl"
                    title="加权随机预留；普通随机不使用"
                  >
                    权重
                    <input
                      type="number"
                      min={0}
                      className="weight-input"
                      value={task.weight}
                      onChange={(e) =>
                        setTaskWeight(task.id, Number(e.target.value))
                      }
                      disabled={!task.randomEnabled}
                    />
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && <TaskForm onClose={() => setShowForm(false)} />}

      {randomTask && (
        <RandomResultModal
          task={randomTask}
          onClose={() => setRandomTask(null)}
          onReroll={() => {
            const picked = pickRandomTask(data.tasks)
            setRandomTask(picked)
          }}
          onStart={() => {
            setSessionTaskId(randomTask.id)
            setRandomTask(null)
          }}
          onOpenTask={() => {
            onOpenTask(randomTask)
            setRandomTask(null)
          }}
        />
      )}

      {sessionTask && (
        <LearningSession
          task={sessionTask}
          onClose={() => setSessionTaskId(null)}
          onTaskMutated={() => {}}
        />
      )}

      {/* 类型管理（增删自定义任务类型） */}
      <TaskTypeManager />
    </div>
  )
}
