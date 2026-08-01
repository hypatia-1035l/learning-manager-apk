import { useState } from 'react'
import { Modal } from './Modal'
import { ICON_CHOICES, TASK_TEMPLATES } from '../constants'
import type { TaskTemplate } from '../constants'
import {
  createTask,
  useAppData,
  saveTaskTemplate,
  deleteTaskTemplate,
} from '../store'

interface Props {
  onClose: () => void
}

export function TaskForm({ onClose }: Props) {
  const data = useAppData()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(ICON_CHOICES[0])
  // 选中的模板序列名（仅从模板加载时填入，作为创建时的初始序列）
  const [templateSeqs, setTemplateSeqs] = useState<string[]>([])
  // 保存为模板的输入框
  const [showSaveTpl, setShowSaveTpl] = useState(false)
  const [tplSeqInput, setTplSeqInput] = useState('')

  const userTemplates = data.taskTemplates ?? []

  // 统一适配内置模板和用户模板
  const applyTemplate = (t: TaskTemplate | { name: string; icon: string; sequences: string[] }) => {
    setName(t.name)
    setIcon(t.icon)
    setTemplateSeqs(t.sequences)
  }

  const clearTemplate = () => {
    setTemplateSeqs([])
  }

  const submit = () => {
    if (!name.trim()) return
    if (!confirm(`确认创建方向「${name.trim()}」？`)) return
    createTask({
      name,
      icon,
      sequenceNames: templateSeqs.length > 0 ? templateSeqs : undefined,
    })
    onClose()
  }

  // 保存为用户模板：用当前 name/icon + 输入的序列名列表
  const handleSaveTpl = () => {
    const seqs = tplSeqInput
      .split(/[\n,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!name.trim() || seqs.length === 0) return
    saveTaskTemplate({ name, icon, sequences: seqs })
    setShowSaveTpl(false)
    setTplSeqInput('')
    // 套用到当前表单
    setTemplateSeqs(seqs)
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
        {/* 从模板创建 */}
        <div className="field">
          <label>从模板创建（可选）</label>
          <div className="template-grid">
            {TASK_TEMPLATES.map((t) => (
              <button
                key={t.name}
                className="template-cell"
                onClick={() => applyTemplate(t)}
                title={`套用内置模板：${t.name}（含 ${t.sequences.length} 个序列）`}
              >
                <span className="tc-icon">{t.icon}</span>
                <span className="tc-name">{t.name}</span>
                <span className="tc-seq-count">{t.sequences.length} 序列</span>
              </button>
            ))}
            {userTemplates.map((t) => (
              <div
                key={t.id}
                className="template-cell template-cell-user"
                onClick={() => applyTemplate(t)}
                title={`套用自定义模板：${t.name}（含 ${t.sequences.length} 个序列）`}
              >
                <span className="tc-icon">{t.icon}</span>
                <span className="tc-name">{t.name}</span>
                <span className="tc-seq-count">{t.sequences.length} 序列</span>
                <button
                  className="icon-btn danger tpl-delete-btn"
                  title="删除自定义模板"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`删除自定义模板「${t.name}」？`)) deleteTaskTemplate(t.id)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {templateSeqs.length > 0 && (
            <div className="template-applied">
              <span className="faint" style={{ fontSize: 12 }}>
                已套用模板，将预置 {templateSeqs.length} 个序列：
              </span>
              <div className="template-seqs">
                {templateSeqs.map((s, i) => (
                  <span key={i} className="tag">
                    {s}
                  </span>
                ))}
              </div>
              <button className="btn sm ghost" onClick={clearTemplate}>
                清除模板
              </button>
            </div>
          )}
        </div>

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

        {/* 保存为自定义模板 */}
        <div className="field">
          {!showSaveTpl ? (
            <button
              className="btn sm ghost"
              onClick={() => setShowSaveTpl(true)}
              disabled={!name.trim()}
            >
              💾 保存为自定义模板
            </button>
          ) : (
            <div className="template-save-form">
              <label>将当前方向存为模板（序列名用逗号或换行分隔）</label>
              <textarea
                className="textarea"
                placeholder="如：资治通鉴, 左传, 史记"
                value={tplSeqInput}
                onChange={(e) => setTplSeqInput(e.target.value)}
                rows={2}
              />
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn primary sm"
                  onClick={handleSaveTpl}
                  disabled={!name.trim() || !tplSeqInput.trim()}
                >
                  保存模板
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    setShowSaveTpl(false)
                    setTplSeqInput('')
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
