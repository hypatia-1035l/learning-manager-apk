import { useEffect, useState } from 'react'
import {
  useAppData,
  getCurrentObject,
  deleteTask,
  appLabelOf,
} from '../store'
import { useSwipeBack } from '../useSwipeBack'
import { LearningSession } from './LearningSession'
import { TaskGroupEditor } from './TaskGroupEditor'
import { StudyRecords } from './StudyRecords'
import { TaskEditForm } from './TaskEditForm'
import { ConfirmModal } from './ConfirmModal'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'
import { launchApp } from '../appList'


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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // 应用启动失败提示
  const [appErr, setAppErr] = useState<string | null>(null)

  // 右滑返回方向页（任意位置右滑，水平为主；学习会话/编辑/删除确认弹窗打开时禁用）
  useSwipeBack(onBack, {
    enabled: !sessionOpen && !editing && !showDeleteConfirm,
  })
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

  const canStart = !!getCurrentObject(task)

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← 返回
      </button>

      <div className="detail-head">
        <div style={{ flex: 1 }}>
          <h2>{task.name}</h2>
        </div>
        <button
          className="btn sm primary"
          onClick={() => setSessionOpen(true)}
          disabled={!canStart}
        >
          开始
        </button>
        <button className="btn sm" onClick={() => setEditing(true)}>
          编辑
        </button>
        <button
          className="btn sm danger"
          onClick={() => setShowDeleteConfirm(true)}
        >
          删除
        </button>
      </div>

      {/* 本方向允许的应用：点一下直接进入（与计时页同一份名单） */}
      {(task.allowedApps ?? []).length > 0 && (
        <div className="app-chips" style={{ marginBottom: 14 }}>
          {(task.allowedApps ?? []).map((pkg) => {
            const label = appLabelOf(data.appPool, pkg)
            return (
              <button
                key={pkg}
                type="button"
                className="app-chip"
                title={`打开 ${label}`}
                onClick={async () => {
                  const ok = await launchApp(pkg)
                  if (!ok) {
                    setAppErr(`打不开「${label}」，可能已被卸载，或它没有可启动的入口。`)
                  }
                }}
              >
                <AppIcon packageName={pkg} appName={label} size={18} />
                <span className="app-chip-name">{label}</span>
              </button>
            )
          })}
        </div>
      )}
      {(task.blockedApps ?? []).length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 14 }}>
          分心：
          {(task.blockedApps ?? []).map((pkg) => appLabelOf(data.appPool, pkg)).join('、')}
        </p>
      )}

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
        <TaskGroupEditor task={task} />
      ) : (
        <StudyRecords taskId={task.id} totalTime={task.totalStudyTime} />
      )}

      {appErr && (
        <Modal
          title="无法打开"
          onClose={() => setAppErr(null)}
          footer={
            <button className="btn primary" onClick={() => setAppErr(null)}>
              知道了
            </button>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.6 }}>{appErr}</p>
        </Modal>
      )}

      {sessionOpen && (
        <LearningSession task={task} onClose={() => setSessionOpen(false)} />
      )}

      {editing && <TaskEditForm task={task} onClose={() => setEditing(false)} />}

      {showDeleteConfirm && (
        <ConfirmModal
          title="删除方向"
          message={`删除「${task.name}」及其所有记录？此操作不可撤销。`}
          confirmText="删除"
          onConfirm={() => {
            deleteTask(task.id)
            onBack()
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
