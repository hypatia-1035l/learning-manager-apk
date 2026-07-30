import { useState } from 'react'
import type { Task } from '../types'
import {
  addLearningObject,
  deleteLearningObject,
  moveLearningObject,
  setCurrentObject,
  updateLearningObject,
  setGroupMode,
  completeCurrentObject,
} from '../store'
import { GROUP_MODE_LABELS } from '../types'
import type { GroupMode } from '../types'

interface Props {
  task: Task
  onTaskMutated: () => void
}

export function TaskGroupEditor({ task, onTaskMutated }: Props) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editProg, setEditProg] = useState('')

  // 直接读取任务组（可能为 null，添加首项时自动创建）
  const group = task.group
  const items = group?.items ?? []
  const mode: GroupMode = group?.mode ?? 'sequential'

  const handleAdd = () => {
    if (!newName.trim()) return
    addLearningObject(task.id, { name: newName })
    setNewName('')
    onTaskMutated()
  }

  const startEdit = (id: string, name: string, prog: string) => {
    setEditingId(id)
    setEditName(name)
    setEditProg(prog)
  }

  const saveEdit = () => {
    if (!editingId) return
    updateLearningObject(task.id, editingId, {
      name: editName.trim() || '未命名',
      progress: editProg,
    })
    setEditingId(null)
    onTaskMutated()
  }

  return (
    <div className="section">
      <div className="section-title">
        📑 任务组 · 内容序列
        <span className="count">（{items.length} 项）</span>
      </div>

      {/* 模式选择 */}
      <div className="row" style={{ marginBottom: 14 }}>
        <label className="muted" style={{ fontSize: 13 }}>
          接续模式：
        </label>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={mode}
          onChange={(e) => {
            setGroupMode(task.id, e.target.value as GroupMode)
            onTaskMutated()
          }}
        >
          <option value="sequential">{GROUP_MODE_LABELS.sequential}</option>
          <option value="random">{GROUP_MODE_LABELS.random}</option>
          <option value="weighted_random">
            {GROUP_MODE_LABELS.weighted_random}
          </option>
        </select>
        <span className="faint" style={{ fontSize: 12 }}>
          {mode === 'sequential'
            ? '完成当前项后按列表顺序接续下一项'
            : mode === 'random'
              ? '完成当前项后从未完成对象中随机选一项'
              : '完成当前项后按权重从未完成对象中加权随机'}
        </span>
      </div>

      {/* 添加 */}
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          className="input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="添加学习对象，如：《左传》、Blender 第12课、英语 Unit 5"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn primary" onClick={handleAdd} disabled={!newName.trim()}>
          添加
        </button>
      </div>

      {/* 列表 */}
      {items.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
          尚未添加学习对象。添加后即可开始学习并自动接续。
        </p>
      ) : (
        <div className="obj-list">
          {items.map((item, idx) => {
            const isCurrent = item.id === task.currentObjectId
            return (
              <div
                key={item.id}
                className={`obj-item ${isCurrent ? 'current' : ''} ${item.completed ? 'done' : ''}`}
              >
                <span className="idx">{idx + 1}</span>

                {editingId === item.id ? (
                  <div className="inline-edit" style={{ flex: 1 }}>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 120 }}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="名称"
                      autoFocus
                    />
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 120 }}
                      value={editProg}
                      onChange={(e) => setEditProg(e.target.value)}
                      placeholder="进度，如：卷八十七"
                    />
                    <button className="btn sm primary" onClick={saveEdit}>
                      保存
                    </button>
                    <button className="btn sm" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="name">{item.name}</span>
                    {mode === 'weighted_random' && !item.completed && (
                      <input
                        className="input weight-input"
                        type="number"
                        min={1}
                        value={item.weight}
                        title="随机权重（越大越易被选中）"
                        onChange={(e) => {
                          const w = Math.max(1, Math.floor(Number(e.target.value) || 1))
                          updateLearningObject(task.id, item.id, { weight: w })
                          onTaskMutated()
                        }}
                      />
                    )}
                    <span className="prog" title={item.progress}>
                      {item.completed ? '已完成' : item.progress || '—'}
                    </span>
                    <div className="ops">
                      <button
                        className="icon-btn"
                        title="设为当前"
                        disabled={isCurrent}
                        onClick={() => {
                          setCurrentObject(task.id, item.id)
                          onTaskMutated()
                        }}
                      >
                        ◎
                      </button>
                      <button
                        className="icon-btn"
                        title="上移"
                        onClick={() => {
                          moveLearningObject(task.id, item.id, 'up')
                          onTaskMutated()
                        }}
                      >
                        ↑
                      </button>
                      <button
                        className="icon-btn"
                        title="下移"
                        onClick={() => {
                          moveLearningObject(task.id, item.id, 'down')
                          onTaskMutated()
                        }}
                      >
                        ↓
                      </button>
                      <button
                        className="icon-btn"
                        title="编辑"
                        onClick={() => startEdit(item.id, item.name, item.progress)}
                      >
                        ✎
                      </button>
                      {!item.completed && (
                      <label
                        className="icon-btn"
                        title={item.enabled ? '参与随机接续' : '暂停（不参与随机）'}
                        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                      >
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(e) => {
                            updateLearningObject(task.id, item.id, { enabled: e.target.checked })
                            onTaskMutated()
                          }}
                          style={{ margin: 0 }}
                        />
                        {item.enabled ? '●' : '○'}
                      </label>
                    )}
                    {!item.completed && (
                      <button
                        className="icon-btn"
                        title="标记完成并接续下一项"
                        onClick={() => {
                          setCurrentObject(task.id, item.id)
                          completeCurrentObject(task.id)
                          onTaskMutated()
                        }}
                      >
                        ✓
                      </button>
                    )}
                      <button
                        className="icon-btn danger"
                        title="删除"
                        onClick={() => {
                          if (confirm(`删除「${item.name}」？`)) {
                            deleteLearningObject(task.id, item.id)
                            onTaskMutated()
                          }
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {items.length > 1 && (
        <div className="flow-hint">
          <span className="arrow">→</span>
          {mode === 'sequential'
            ? '顺序接续：完成当前项后切换到下一未完成项'
            : mode === 'random'
              ? '随机接续：完成当前项后从未完成对象中等概率随机选一项'
              : '加权随机：完成当前项后按权重从未完成对象中加权随机选一项'}
        </div>
      )}
    </div>
  )
}
