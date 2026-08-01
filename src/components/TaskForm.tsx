import { useState } from 'react'
import { Modal } from './Modal'
import { createTask } from '../store'

interface Props {
  onClose: () => void
}

export function TaskForm({ onClose }: Props) {
  const [name, setName] = useState('')
  // 批量预置序列名（可选）：输入逗号/换行分隔的序列名，创建时一次性生成
  const [seqInput, setSeqInput] = useState('')

  const parseSeqs = (raw: string) =>
    raw
      .split(/[\n,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean)

  const submit = () => {
    if (!name.trim()) return
    if (!confirm(`确认创建方向「${name.trim()}」？`)) return
    const seqs = parseSeqs(seqInput)
    createTask({
      name,
      icon: '',
      sequenceNames: seqs.length > 0 ? seqs : undefined,
    })
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

        {/* 批量预置序列名（可选） */}
        <div className="field">
          <label>
            预置序列名 <span className="faint" style={{ fontSize: 12 }}>· 可选，逗号或换行分隔</span>
          </label>
          <textarea
            className="textarea"
            placeholder="如：资治通鉴, 左传, 史记"
            value={seqInput}
            onChange={(e) => setSeqInput(e.target.value)}
            rows={2}
          />
        </div>
      </div>
    </Modal>
  )
}
