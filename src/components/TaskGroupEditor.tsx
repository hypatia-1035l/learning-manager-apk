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
  const [newUnit, setNewUnit] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editProg, setEditProg] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editTarget, setEditTarget] = useState('')

  // 直接读取任务组（可能为 null，添加首项时自动创建）
  const group = task.group
  const items = group?.items ?? []
  const mode: GroupMode = group?.mode ?? 'sequential'

  const handleAdd = () => {
    if (!newName.trim()) return
    addLearningObject(task.id, {
      name: newName,
      progressUnit: newUnit.trim(),
      progressTarget: newTarget.trim(),
    })
    setNewName('')
    setNewUnit('')
    setNewTarget('')
    onTaskMutated()
  }

  const startEdit = (item: { id: string; name: string; progress: string; progressUnit: string; progressTarget: string }) => {
    setEditingId(item.id)
    setEditName(item.name)
    setEditProg(item.progress)
    setEditUnit(item.progressUnit ?? '')
    setEditTarget(item.progressTarget ?? '')
  }

  const saveEdit = () => {
    if (!editingId) return
    updateLearningObject(task.id, editingId, {
      name: editName.trim() || '未命名',
      progress: editProg,
      progressUnit: editUnit,
      progressTarget: editTarget,
    })
    setEditingId(null)
    onTaskMutated()
  }

  return (
    <div className="section">
      <div className="section-title">
        📑 内容序列
        <span className="count">（{items.length} 个序列）</span>
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
            ? '完成当前序列后按列表顺序接续下一序列'
            : mode === 'random'
              ? '完成当前序列后从未完成序列中随机选一项'
              : '完成当前序列后按权重从未完成序列中加权随机'}
        </span>
      </div>

      {/* 添加 */}
      <div className="field" style={{ marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 120 }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="添加学习序列，如：左传 / 资治通鉴 / 线条训练 / Blender 第12课"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn primary" onClick={handleAdd} disabled={!newName.trim()}>
            添加
          </button>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ width: 120 }}
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            placeholder="进度单位（可选，如：条/卷/集）"
          />
          <input
            className="input"
            style={{ width: 120 }}
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder="目标进度（可选，如：1000）"
          />
          <span className="faint" style={{ fontSize: 12, alignSelf: 'center' }}>
            填写数字目标→数量型序列；留空→位置型序列（自由文本）
          </span>
        </div>
      </div>

      {/* 列表 */}
      {items.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
          尚未添加学习序列。添加后即可开始学习并自动接续。
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
                  <div className="inline-edit" style={{ flex: 1, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <input
                        className="input"
                        style={{ flex: 1, minWidth: 120 }}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="序列名称"
                        autoFocus
                      />
                      <input
                        className="input"
                        style={{ flex: 1, minWidth: 120 }}
                        value={editProg}
                        onChange={(e) => setEditProg(e.target.value)}
                        placeholder="当前进度（数量型填数字，位置型填文本）"
                      />
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <input
                        className="input"
                        style={{ width: 140 }}
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                        placeholder="进度单位（如：条/卷/集）"
                      />
                      <input
                        className="input"
                        style={{ width: 140 }}
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                        placeholder="目标进度（数字；留空=位置型）"
                      />
                      <button className="btn sm primary" onClick={saveEdit}>
                        保存
                      </button>
                      <button className="btn sm" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </div>
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
                      {item.completed
                        ? '已完成'
                        : item.progressTarget
                          ? `${item.progress || '—'}${item.progressUnit ? ' ' + item.progressUnit : ''} / ${item.progressTarget}${item.progressUnit ? ' ' + item.progressUnit : ''}`
                          : (item.progress || '—')}
                    </span>
                    <div className="ops">
                      <button
                        className="icon-btn"
                        title="设为当前序列"
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
                        onClick={() => startEdit(item)}
                      >
                        ✎
                      </button>
                      {!item.completed && (
                      <label
                        className="icon-btn"
                        title={item.enabled ? '参与接续/随机' : '暂停（不参与随机）'}
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
                        title="标记完成并接续下一序列"
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
                          if (confirm(`删除序列「${item.name}」？`)) {
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
            ? '顺序接续：完成当前序列后切换到下一未完成序列'
            : mode === 'random'
              ? '随机接续：完成当前序列后从未完成序列中等概率随机选一项'
              : '加权随机：完成当前序列后按权重从未完成序列中加权随机选一项'}
        </div>
      )}
    </div>
  )
}
