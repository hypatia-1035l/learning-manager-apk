import { useState } from 'react'
import { Modal } from './Modal'
import { ICON_CHOICES } from '../constants'
import { createTask } from '../store'
import type { TaskType } from '../types'
import { useTaskTypes } from '../taskTypes'

interface Props {
  onClose: () => void
}

export function TaskForm({ onClose }: Props) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(ICON_CHOICES[0])
  const [type, setType] = useState<TaskType>('reading')
  const types = useTaskTypes()

  const submit = () => {
    if (!name.trim()) return
    createTask({ name, icon, type })
    onClose()
  }

  return (
    <Modal
      title="新建学习方向"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            创建
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
            placeholder="如：历史阅读、Blender 学习"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="field">
          <label>类型</label>
          <div className="row wrap">
            {types.map((t) => (
              <button
                key={t.id}
                className={`btn sm ${type === t.id ? 'primary' : ''}`}
                onClick={() => setType(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>图标</label>
          <div className="emoji-grid">
            {ICON_CHOICES.map((e) => (
              <button
                key={e}
                className={`emoji-cell ${icon === e ? 'active' : ''}`}
                onClick={() => setIcon(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
