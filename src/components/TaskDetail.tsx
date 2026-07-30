import { useState } from 'react'
import {
  useAppData,
  getCurrentObject,
  completeCurrentObject,
  deleteTask,
} from '../store'
import { LearningSession } from './LearningSession'
import { TaskGroupEditor } from './TaskGroupEditor'
import { StudyRecords } from './StudyRecords'
import { TaskEditForm } from './TaskEditForm'
import { TASK_STATUS_LABELS } from '../types'
import { getTypeLabel } from '../taskTypes'
import { formatDuration, formatDate } from '../utils'

interface Props {
  taskId: string
  onBack: () => void
}

export function TaskDetail({ taskId, onBack }: Props) {
  const data = useAppData()
  const [sessionOpen, setSessionOpen] = useState(false)
  const [tab, setTab] = useState<'group' | 'records'>('group')
  const [editing, setEditing] = useState(false)
  // bump key to force TaskGroupEditor re-read after mutations via its own subscribe is enough;
  // but to be safe we re-render through useAppData already.

  const task = data.tasks.find((t) => t.id === taskId)

  if (!task) {
    return (
      <div className="empty-state">
        <p>任务不存在或已删除。</p>
        <button className="btn" onClick={onBack}>
          返回任务池
        </button>
      </div>
    )
  }

  const obj = getCurrentObject(task)
  const group = task.group
  const items = group?.items ?? []
  const doneCount = items.filter((i) => i.completed).length
  const canStart = !!obj

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← 返回任务池
      </button>

      <div className="detail-head">
        <span className="icon">{task.icon}</span>
        <div style={{ flex: 1 }}>
          <h2>{task.name}</h2>
          <div className="meta">
            {getTypeLabel(task.type)} · {TASK_STATUS_LABELS[task.status]} ·
            创建于 {formatDate(task.createdAt)}
          </div>
        </div>
        <button className="btn sm" onClick={() => setEditing(true)}>
          编辑
        </button>
        <button
          className="btn sm danger"
          onClick={() => {
            if (confirm(`删除学习方向「${task.name}」及其所有记录？`)) {
              deleteTask(task.id)
              onBack()
            }
          }}
        >
          删除
        </button>
      </div>

      {/* 当前学习对象面板 */}
      <div className="current-panel">
        <div className="label">当前学习对象</div>
        <div className="obj-name">{obj ? obj.name : '尚未设置'}</div>
        <div className="prog-row">
          <span>
            当前进度：<span className="val">{obj ? obj.progress || '尚未记录' : '—'}</span>
          </span>
          {items.length > 0 && (
            <span className="faint">
              {doneCount}/{items.length} 项完成
            </span>
          )}
        </div>
        <div className="actions">
          <button
            className="btn primary"
            onClick={() => setSessionOpen(true)}
            disabled={!canStart}
            title={canStart ? '开始正向计时学习' : '请先在下方添加学习对象'}
          >
            ▶ 开始学习
          </button>
          <button
            className="btn"
            onClick={() => {
              completeCurrentObject(task.id)
            }}
            disabled={!canStart}
          >
            完成当前内容
          </button>
        </div>
        {!canStart && (
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
            在下方「任务组」中添加学习对象后即可开始学习。
          </p>
        )}
      </div>

      {/* 统计 */}
      <div className="stat-row">
        <div className="stat">
          <div className="k">累计学习时间</div>
          <div className="v">{formatDuration(task.totalStudyTime)}</div>
        </div>
        <div className="stat">
          <div className="k">学习对象</div>
          <div className="v">{items.length}</div>
        </div>
        <div className="stat">
          <div className="k">已完成</div>
          <div className="v">{doneCount}</div>
        </div>
      </div>

      {/* tabs */}
      <div className="tabs">
        <button
          className={`tab ${tab === 'group' ? 'active' : ''}`}
          onClick={() => setTab('group')}
        >
          任务组 · 内容序列
        </button>
        <button
          className={`tab ${tab === 'records' ? 'active' : ''}`}
          onClick={() => setTab('records')}
        >
          学习记录
        </button>
      </div>

      {tab === 'group' ? (
        <TaskGroupEditor task={task} onTaskMutated={() => {}} />
      ) : (
        <StudyRecords taskId={task.id} />
      )}

      {sessionOpen && (
        <LearningSession
          task={task}
          onClose={() => setSessionOpen(false)}
          onTaskMutated={() => {}}
        />
      )}

      {editing && <TaskEditForm task={task} onClose={() => setEditing(false)} />}
    </div>
  )
}
