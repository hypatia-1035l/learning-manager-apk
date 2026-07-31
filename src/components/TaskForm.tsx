import { useState } from 'react'
import { Modal } from './Modal'
import { ICON_CHOICES } from '../constants'
import { createTask } from '../store'

interface Props {
  onClose: () => void
}

export function TaskForm({ onClose }: Props) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(ICON_CHOICES[0])

  const submit = () => {
    if (!name.trim()) return
    createTask({ name, icon })
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
