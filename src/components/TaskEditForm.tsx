import { useState } from 'react'
import { Modal } from './Modal'
import { updateTask } from '../store'
import type { Task } from '../types'

interface Props {
  task: Task
  onClose: () => void
}

export function TaskEditForm({ task, onClose }: Props) {
  const [name, setName] = useState(task.name)

  const submit = () => {
    if (!name.trim()) return
    updateTask(task.id, {
      name: name.trim(),
    })
    onClose()
  }

  return (
    <Modal
      title="编辑方向"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            保存
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field">
          <label>名称</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
      </div>
    </Modal>
  )
}
