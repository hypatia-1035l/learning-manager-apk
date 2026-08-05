import { useState } from 'react'
import type { Task, ProgressNode } from '../types'
import {
  addLearningObject,
  deleteLearningObject,
  moveLearningObject,
  setCurrentObject,
  updateLearningObject,
  setGroupMode,
  completeCurrentObject,
  formatSequenceProgress,
} from '../store'
import { GROUP_MODE_LABELS } from '../types'
import type { GroupMode } from '../types'

// 进度节点文本 <-> ProgressNode[] 互转
// 文本格式：每行一个，"数字 名称"（空格/逗号/竖线分隔）
function parseNodesText(text: string): ProgressNode[] {
  const lines = text.split('\n')
  const nodes: ProgressNode[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*[,，\s|、]\s*(.+)$/)
    if (m) nodes.push({ at: Math.floor(Number(m[1])), label: m[2].trim() })
  }
  return nodes.sort((a, b) => a.at - b.at)
}
function nodesToText(nodes?: ProgressNode[]): string {
  if (!nodes || nodes.length === 0) return ''
  return [...nodes].sort((a, b) => a.at - b.at).map((n) => `${n.at} ${n.label}`).join('\n')
}

interface Props {
  task: Task
  onTaskMutated: () => void
}

export function TaskGroupEditor({ task, onTaskMutated }: Props) {
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [newCountdown, setNewCountdown] = useState('') // 分钟，空=正向计时
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editProg, setEditProg] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editTarget, setEditTarget] = useState('')
  const [editCountdown, setEditCountdown] = useState('')
  const [editNodes, setEditNodes] = useState('')

  // 直接读取任务组（可能为 null，添加首项时自动创建）
  const group = task.group
  const items = group?.items ?? []
  const mode: GroupMode = group?.mode ?? 'sequential'

  // 分钟字符串 → 秒数（空或 0 → null = 正向计时）
  const parseCountdown = (s: string): number | null => {
    const n = Number(s)
    if (!s.trim() || isNaN(n) || n <= 0) return null
    return Math.floor(n * 60)
  }

  const handleAdd = () => {
    if (!newName.trim()) return
    addLearningObject(task.id, {
      name: newName,
      progressUnit: newUnit.trim(),
      progressTarget: newTarget.trim(),
      countdownSeconds: parseCountdown(newCountdown),
    })
    setNewName('')
    setNewUnit('')
    setNewTarget('')
    setNewCountdown('')
    onTaskMutated()
  }

  const startEdit = (item: { id: string; name: string; progress: string; progressUnit: string; progressTarget: string; countdownSeconds?: number | null; progressNodes?: ProgressNode[] }) => {
    setEditingId(item.id)
    setEditName(item.name)
    setEditProg(item.progress)
    setEditUnit(item.progressUnit ?? '')
    setEditTarget(item.progressTarget ?? '')
    setEditCountdown(item.countdownSeconds ? String(item.countdownSeconds / 60) : '')
    setEditNodes(nodesToText(item.progressNodes))
  }

  const saveEdit = () => {
    if (!editingId) return
    const parsedNodes = parseNodesText(editNodes)
    updateLearningObject(task.id, editingId, {
      name: editName.trim() || '未命名',
      progress: editProg,
      progressUnit: editUnit,
      progressTarget: editTarget,
      countdownSeconds: parseCountdown(editCountdown),
      progressNodes: parsedNodes.length > 0 ? parsedNodes : undefined,
    })
    setEditingId(null)
    onTaskMutated()
  }

  return (
    <div className="section">
      <div className="section-title">
        内容序列
        <span className="count">（{items.length} 个序列）</span>
      </div>

      {/* 模式选择 */}
      <div className="row" style={{ marginBottom: 14 }}>
        <label className="muted" style={{ fontSize: 13 }}>
          接续：
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
      </div>

      {/* 添加 */}
      <div className="field" style={{ marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 120 }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="序列名"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn primary" onClick={handleAdd} disabled={!newName.trim()}>
            添加
          </button>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ flex: '1 1 140px', minWidth: 120 }}
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            placeholder="单位，如：条/卷/集"
          />
          <input
            className="input"
            style={{ flex: '1 1 140px', minWidth: 120 }}
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder="目标，如：1000"
          />
          <input
            className="input"
            type="number"
            min={0}
            style={{ width: 100 }}
            value={newCountdown}
            onChange={(e) => setNewCountdown(e.target.value)}
            placeholder="倒计时(分)"
          />
        </div>
      </div>

      {/* 列表 */}
      {items.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
          尚无序列。
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
                        placeholder="当前进度"
                      />
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <input
                        className="input"
                        style={{ flex: '1 1 140px', minWidth: 120 }}
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                        placeholder="单位，如：条/卷/集"
                      />
                      <input
                        className="input"
                        style={{ flex: '1 1 140px', minWidth: 120 }}
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                        placeholder="目标，如：1000"
                      />
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span className="faint" style={{ fontSize: 12 }}>时长：</span>
                      {[5, 15, 25, 45].map((m) => (
                        <button
                          key={m}
                          className={`btn sm ${editCountdown === String(m) ? 'primary' : ''}`}
                          onClick={() => setEditCountdown(editCountdown === String(m) ? '' : String(m))}
                        >
                          {m}分
                        </button>
                      ))}
                      <input
                        className="input"
                        type="number"
                        min={0}
                        style={{ width: 80 }}
                        value={editCountdown}
                        onChange={(e) => setEditCountdown(e.target.value)}
                        placeholder="分钟"
                      />
                    </div>
                    <div className="field" style={{ marginTop: 6 }}>
                      <label className="faint" style={{ fontSize: 12 }}>
                        进度节点（每行 <code style={{ fontSize: 11 }}>数字 名称</code>）
                      </label>
                      <textarea
                        className="input"
                        rows={3}
                        value={editNodes}
                        onChange={(e) => setEditNodes(e.target.value)}
                        placeholder={'0 隐公\n100 桓公\n200 庄公'}
                        style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
                      />
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
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
                        onChange={(e) => {
                          const w = Math.max(1, Math.floor(Number(e.target.value) || 1))
                          updateLearningObject(task.id, item.id, { weight: w })
                          onTaskMutated()
                        }}
                      />
                    )}
                    <span className="prog">
                      {item.completed ? '已完成' : formatSequenceProgress(item)}
                    </span>
                    <div className="ops">
                      <button
                        className="icon-btn"
                        disabled={isCurrent}
                        onClick={() => {
                          setCurrentObject(task.id, item.id)
                          onTaskMutated()
                        }}
                      >
                        设为当前
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => {
                          moveLearningObject(task.id, item.id, 'up')
                          onTaskMutated()
                        }}
                      >
                        上移
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => {
                          moveLearningObject(task.id, item.id, 'down')
                          onTaskMutated()
                        }}
                      >
                        下移
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => startEdit(item)}
                      >
                        编辑
                      </button>
                      {!item.completed && (
                      <label
                        className="icon-btn"
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
                        onClick={() => {
                          setCurrentObject(task.id, item.id)
                          completeCurrentObject(task.id)
                          onTaskMutated()
                        }}
                      >
                        完成
                      </button>
                    )}
                      <button
                        className="icon-btn danger"
                        onClick={() => {
                          if (confirm(`删除「${item.name}」？`)) {
                            deleteLearningObject(task.id, item.id)
                            onTaskMutated()
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
