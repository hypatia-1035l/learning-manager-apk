import { useEffect, useState } from 'react'
import {
  useAppData,
  getCurrentObject,
  deleteTask,
  formatSequenceProgress,
} from '../store'
import { LearningSession } from './LearningSession'
import { TaskGroupEditor } from './TaskGroupEditor'
import { StudyRecords } from './StudyRecords'
import { TaskEditForm } from './TaskEditForm'


interface Props {
  taskId: string
  onBack: () => void
  autoStartSession?: boolean
}

export function TaskDetail({ taskId, onBack, autoStartSession = false }: Props) {
  const data = useAppData()
  const [sessionOpen, setSessionOpen] = useState(false)

  // 从提醒通知进入时，自动打开 LearningSession 开始计时
  useEffect(() => {
    if (!autoStartSession) return
    setSessionOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
          返回
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
        ← 返回
      </button>

      <div className="detail-head">
        <span className="icon">{task.icon}</span>
        <div style={{ flex: 1 }}>
          <h2>{task.name}</h2>
        </div>
        <button className="btn sm" onClick={() => setEditing(true)}>
          编辑
        </button>
        <button
          className="btn sm danger"
          onClick={() => {
            if (confirm(`删除「${task.name}」及其所有记录？`)) {
              deleteTask(task.id)
              onBack()
            }
          }}
        >
          删除
        </button>
      </div>

      {/* 当前序列面板 */}
      <div className="current-panel">
        <div className="label">序列</div>
        <div className="obj-name">{obj ? obj.name : '尚未设置'}</div>
        <div className="prog-row">
          <span>
            进度：<span className="val">{obj ? formatSequenceProgress(obj) : '—'}</span>
          </span>
          {items.length > 0 && (
            <span className="faint">
              {doneCount}/{items.length} 完成
            </span>
          )}
        </div>
        <div className="actions">
          <button
            className="btn primary"
            onClick={() => setSessionOpen(true)}
            disabled={!canStart}
          >
            开始
          </button>
        </div>
        {!canStart && (
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
            添加序列后即可开始。
          </p>
        )}
      </div>

      {/* tabs */}
      <div className="tabs">
        <button
          className={`tab ${tab === 'group' ? 'active' : ''}`}
          onClick={() => setTab('group')}
        >
          内容序列
        </button>
        <button
          className={`tab ${tab === 'records' ? 'active' : ''}`}
          onClick={() => setTab('records')}
        >
          记录
        </button>
      </div>

      {tab === 'group' ? (
        <TaskGroupEditor task={task} onTaskMutated={() => {}} />
      ) : (
        <StudyRecords taskId={task.id} totalTime={task.totalStudyTime} />
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
