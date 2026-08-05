import { useState } from 'react'
import {
  useAppData,
  getCurrentObject,
  setTaskEnabled,
  setTaskWeight,
  pickRandomTask,
  formatSequenceProgress,
} from '../store'
import { formatDuration } from '../utils'
import { TaskForm } from './TaskForm'
import { LearningSession } from './LearningSession'
import type { Task } from '../types'
import { TASK_STATUS_LABELS } from '../types'

interface Props {
  onOpenTask: (task: Task) => void
}

export function TaskPool({ onOpenTask }: Props) {
  const data = useAppData()
  const [showForm, setShowForm] = useState(false)
  const [sessionTaskId, setSessionTaskId] = useState<string | null>(null)
  // 权重输入缓冲：键为 taskId，允许清空后再输入；失焦或回车时提交数字
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({})

  const commitWeight = (taskId: string, raw: string) => {
    const trimmed = raw.trim()
    const n = Number(trimmed)
    setTaskWeight(taskId, !trimmed || isNaN(n) ? 0 : Math.max(0, Math.floor(n)))
    setWeightDraft((m) => {
      if (!trimmed || isNaN(n)) {
        const { [taskId]: _omit, ...rest } = m
        return rest
      }
      return { ...m, [taskId]: String(Math.max(0, Math.floor(n))) }
    })
  }

  const sessionTask = sessionTaskId
    ? data.tasks.find((t) => t.id === sessionTaskId) ?? null
    : null

  const handleRandomStart = () => {
    const picked = pickRandomTask(data.tasks)
    if (picked) setSessionTaskId(picked.id)
  }

  return (
    <div className="pool-compact">
      {/* ===== 方向列表 ===== */}
      <div className="pool-toolbar">
        <span className="pool-meta">
          共 {data.tasks.length} 个
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" onClick={handleRandomStart}>
            随机开始
          </button>
          <button className="btn" onClick={() => setShowForm(true)}>
            + 新建
          </button>
        </div>
      </div>

      {data.tasks.length === 0 ? (
        <div className="empty-state compact-empty">
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
                  <div className="label">序列</div>
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
                        ? '未选择'
                        : '尚无序列'}
                    </div>
                  )}
                </div>

                <div className="tc-foot">
                  <span
                    className={`status-tag status-${task.status}`}
                  >
                    {TASK_STATUS_LABELS[task.status]}
                  </span>
                  <span>累计 {formatDuration(task.totalStudyTime)}</span>
                </div>

                <div
                  className="tc-controls"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="muted">
                    <input
                      type="checkbox"
                      checked={task.enabled}
                      onChange={(e) => {
                        setTaskEnabled(task.id, e.target.checked)
                      }}
                    />
                    启用
                  </label>
                  <label
                    className="muted weight-ctrl"
                  >
                    权重
                    <input
                      type="number"
                      min={0}
                      className="weight-input"
                      value={
                        task.id in weightDraft
                          ? weightDraft[task.id]
                          : String(task.weight)
                      }
                      onChange={(e) =>
                        setWeightDraft((m) => ({ ...m, [task.id]: e.target.value }))
                      }
                      onBlur={(e) => commitWeight(task.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitWeight(task.id, (e.target as HTMLInputElement).value)
                      }}
                      disabled={!task.enabled}
                    />
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && <TaskForm onClose={() => setShowForm(false)} />}

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
