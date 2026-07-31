import { useState } from 'react'
import {
  useAppData,
  getCurrentObject,
  setTaskEnabled,
  setTaskRandomEnabled,
  setTaskWeight,
  pickRandomTask,
  getRandomPool,
  getContinueTask,
  formatSequenceProgress,
} from '../store'
import { TASK_STATUS_LABELS } from '../types'
import { formatDuration } from '../utils'
import { TaskForm } from './TaskForm'
import { LearningSession } from './LearningSession'
import { RandomResultModal } from './RandomResultModal'
import type { Task } from '../types'

interface Props {
  onOpenTask: (task: Task) => void
}

export function TaskPool({ onOpenTask }: Props) {
  const data = useAppData()
  const [showForm, setShowForm] = useState(false)
  const [randomTask, setRandomTask] = useState<Task | null>(null)
  const [sessionTaskId, setSessionTaskId] = useState<string | null>(null)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

  const continueTask = getContinueTask(data.tasks, data.records)
  const sessionTask = sessionTaskId
    ? data.tasks.find((t) => t.id === sessionTaskId) ?? null
    : null

  const handleRandomStart = () => {
    const picked = pickRandomTask(data.tasks)
    setRandomTask(picked)
  }

  return (
    <div className="pool-compact">
      {/* ===== 当前状态 ===== */}
      <section className="now-card">
        {continueTask ? (
          <div
            className="now-active"
            onClick={() => setSessionTaskId(continueTask.id)}
          >
            <div className="now-top">
              <span className="now-icon">{continueTask.icon}</span>
              <span className="now-name">{continueTask.name}</span>
            </div>
            <div className="now-seq">
              {getCurrentObject(continueTask)?.name ?? '—'}
            </div>
            <div className="now-prog">
              {(() => {
                const o = getCurrentObject(continueTask)
                return o ? formatSequenceProgress(o) : '尚未记录'
              })()}
            </div>
            <button className="btn primary now-start">开始</button>
          </div>
        ) : (
          <div className="now-empty">
            <div className="now-empty-title">还没开始摸鱼 🐟</div>
            <div className="now-empty-hint">随机抽一个方向开始吧</div>
            <button
              className="btn primary"
              onClick={(e) => {
                e.stopPropagation()
                handleRandomStart()
              }}
            >
              🎲 随机开始
            </button>
          </div>
        )}
      </section>

      {/* ===== 快速操作 ===== */}
      <div className="quick-actions">
        <button className="btn primary lg" onClick={handleRandomStart}>
          🎲 随机开始
        </button>
      </div>

      {/* ===== 方向列表 ===== */}
      <div className="pool-toolbar">
        <span className="pool-meta">
          方向 · {data.tasks.length} 个
        </span>
        <button className="btn primary" onClick={() => setShowForm(true)}>
          + 新建方向
        </button>
      </div>

      {data.tasks.length === 0 ? (
        <div className="empty-state compact-empty">
          <div className="big">📚</div>
          <p>暂无方向</p>
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
                </div>

                <div className="tc-current">
                  <div className="label">当前学习序列</div>
                  {obj ? (
                    <>
                      <div className="obj">{obj.name}</div>
                      <div className="prog">
                        进度：<b>{formatSequenceProgress(obj)}</b>
                      </div>
                    </>
                  ) : (
                    <div className="obj faint" style={{ fontWeight: 400 }}>
                      {task.group && task.group.items.length
                        ? '未选择序列'
                        : '尚未添加序列'}
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
                  <button
                    className="btn sm ghost tc-more-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedTaskId(expandedTaskId === task.id ? null : task.id)
                    }}
                  >
                    {expandedTaskId === task.id ? '收起' : '更多'}
                  </button>
                </div>

                {expandedTaskId === task.id && (
                  <div
                    className="tc-advanced"
                    onClick={(e) => e.stopPropagation()}
                  >
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
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && <TaskForm onClose={() => setShowForm(false)} />}

      {randomTask && (
        <RandomResultModal
          task={randomTask}
          randomPoolSize={getRandomPool(data.tasks).length}
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
    </div>
  )
}
