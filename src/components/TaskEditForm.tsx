import { useState } from 'react'
import { Modal } from './Modal'
import { ICON_CHOICES } from '../constants'
import { updateTask } from '../store'
import type { Task } from '../types'

interface Props {
  task: Task
  onClose: () => void
}

export function TaskEditForm({ task, onClose }: Props) {
  const [name, setName] = useState(task.name)
  const [icon, setIcon] = useState(task.icon)
  const [randomEnabled, setRandomEnabled] = useState(task.randomEnabled)
  const [weight, setWeight] = useState(task.weight)

  const submit = () => {
    if (!name.trim()) return
    updateTask(task.id, {
      name: name.trim(),
      icon,
      randomEnabled,
      weight: Math.max(0, Math.floor(Number(weight) || 0)),
    })
    onClose()
  }

  return (
    <Modal
      title="编辑学习方向"
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

        <div className="field">
          <label>随机设置</label>
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={randomEnabled}
              onChange={(e) => setRandomEnabled(e.target.checked)}
            />
            参与随机选择
          </label>
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            权重
            <input
              type="number"
              min={0}
              className="input"
              style={{ width: 90 }}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              disabled={!randomEnabled}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              加权随机预留
            </span>
          </label>
        </div>
      </div>
    </Modal>
  )
}
