import { useRef, useState } from 'react'
import type { Task, ProgressNode } from '../types'
import {
  addLearningObject,
  deleteLearningObject,
  moveLearningObject,
  setCurrentObject,
  updateLearningObject,
  setGroupMode,
  completeCurrentObject,
  uncompleteObject,
  formatSequenceProgress,
} from '../store'
import { GROUP_MODE_LABELS } from '../types'
import type { GroupMode } from '../types'
import { parseSeqBlock, parseCountdownMin } from '../seqInput'
import { SeqGenerator } from './SeqGenerator'
import { ProgressNodesEditor } from './ProgressNodesEditor'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  task: Task
}

export function TaskGroupEditor({ task }: Props) {
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [newCountdown, setNewCountdown] = useState('') // 分钟，空=正向计时
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editProg, setEditProg] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editTarget, setEditTarget] = useState('')
  const [editCountdown, setEditCountdown] = useState('')
  const [editNodesArr, setEditNodesArr] = useState<ProgressNode[]>([])
  // 批量添加（行语法，与新建方向一致）
  const [showBatch, setShowBatch] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchMsg, setBatchMsg] = useState('')
  // 「更多」次行操作展开的序列项（同时只展开一个）
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null)
  // 添加成功后焦点回到序列名输入框，连续添加不用重新点
  const nameRef = useRef<HTMLInputElement | null>(null)

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
      countdownSeconds: parseCountdownMin(newCountdown),
    })
    setNewName('')
    setNewUnit('')
    setNewTarget('')
    setNewCountdown('')
    nameRef.current?.focus()
  }

  const handleBatchAdd = () => {
    const lines = parseSeqBlock(batchInput)
    if (!lines.length) {
      setBatchMsg('没有可识别的行（每行：名称｜目标｜单位｜分钟）')
      return
    }
    for (const p of lines) {
      addLearningObject(task.id, {
        name: p.name,
        // 行内未写的参数，取添加区的默认值
        progressUnit: p.unit ?? newUnit.trim(),
        progressTarget: p.target ?? newTarget.trim(),
        countdownSeconds:
          p.countdownMin !== undefined
            ? parseCountdownMin(p.countdownMin)
            : parseCountdownMin(newCountdown),
      })
    }
    setBatchInput('')
    setBatchMsg(`已添加 ${lines.length} 条序列`)
    nameRef.current?.focus()
  }

  const startEdit = (item: { id: string; name: string; progress: string; progressUnit: string; progressTarget: string; countdownSeconds?: number | null; progressNodes?: ProgressNode[] }) => {
    setEditingId(item.id)
    setEditName(item.name)
    setEditProg(item.progress)
    setEditUnit(item.progressUnit ?? '')
    setEditTarget(item.progressTarget ?? '')
    setEditCountdown(item.countdownSeconds ? String(item.countdownSeconds / 60) : '')
    setEditNodesArr(item.progressNodes ?? [])
  }

  const saveEdit = () => {
    if (!editingId) return
    updateLearningObject(task.id, editingId, {
      name: editName.trim() || '未命名',
      progress: editProg,
      progressUnit: editUnit,
      progressTarget: editTarget,
      countdownSeconds: parseCountdownMin(editCountdown),
      progressNodes: editNodesArr.length > 0 ? editNodesArr : undefined,
    })
    setEditingId(null)
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
        <div className="row" style={{ marginBottom: 8, gap: 8, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
            <label>序列名</label>
            <input
              className="input"
              ref={nameRef}
              placeholder="如：卷三"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button className="btn primary" onClick={handleAdd} disabled={!newName.trim()}>
            添加
          </button>
          <button
            className={`btn ${showBatch ? 'primary' : ''}`}
            onClick={() => {
              setShowBatch((v) => !v)
              setBatchMsg('')
            }}
          >
            批量
          </button>
        </div>

        {showBatch && (
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="faint" style={{ fontSize: 12 }}>
              每行一条：名称｜目标｜单位｜分钟；也可空格分隔，纯名称可用逗号/顿号拆多条
            </label>
            <textarea
              className="textarea"
              rows={4}
              autoFocus
              placeholder={'如：\n卷三｜80｜篇｜25\n卷三 80 篇 25\n卷一，卷二、卷三'}
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleBatchAdd()
              }}
            />
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="btn sm primary" onClick={handleBatchAdd} disabled={!batchInput.trim()}>
                导入
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  setShowBatch(false)
                  setBatchInput('')
                  setBatchMsg('')
                }}
              >
                收起
              </button>
              {batchMsg && <span className="faint" style={{ fontSize: 12 }}>{batchMsg}</span>}
            </div>
            <SeqGenerator
              onGenerate={(lines) => {
                setBatchInput((prev) =>
                  prev.trim() ? prev.replace(/\s+$/, '') + '\n' + lines.join('\n') : lines.join('\n'),
                )
                setBatchMsg('')
              }}
            />
          </div>
        )}

        <div className="grid-3">
          <div className="mini-field">
            <label>单位</label>
            <input
              className="input"
              placeholder="如：篇"
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
            />
          </div>
          <div className="mini-field">
            <label>目标</label>
            <input
              className="input"
              placeholder="如：80"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
            />
          </div>
          <div className="mini-field">
            <label>倒计时·分</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="如：25"
              value={newCountdown}
              onChange={(e) => setNewCountdown(e.target.value)}
            />
          </div>
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
                    <div className="grid-2">
                      <div className="mini-field">
                        <label>序列名</label>
                        <input
                          className="input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="mini-field">
                        <label>进度</label>
                        <input
                          className="input"
                          value={editProg}
                          onChange={(e) => setEditProg(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid-2">
                      <div className="mini-field">
                        <label>单位</label>
                        <input
                          className="input"
                          value={editUnit}
                          onChange={(e) => setEditUnit(e.target.value)}
                        />
                      </div>
                      <div className="mini-field">
                        <label>目标</label>
                        <input
                          className="input"
                          value={editTarget}
                          onChange={(e) => setEditTarget(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="field" style={{ marginTop: 2 }}>
                      <label>时长</label>
                      <div className="row wrap" style={{ gap: 6 }}>
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
                        />
                      </div>
                    </div>
                    <div className="field" style={{ marginTop: 6 }}>
                      <label className="faint" style={{ fontSize: 12 }}>进度节点</label>
                      <ProgressNodesEditor
                        key={editingId}
                        value={editNodesArr}
                        onChange={setEditNodesArr}
                        previewProgress={editProg}
                        unit={editUnit}
                        target={editTarget}
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span className="name">{item.name}</span>
                        <span className="prog">
                          {item.completed ? '已完成' : formatSequenceProgress(item)}
                        </span>
                      </div>
                      <div className="ops" style={{ marginTop: 6 }}>
                        <button
                          className="icon-btn"
                          disabled={isCurrent}
                          onClick={() => {
                            setCurrentObject(task.id, item.id)
                          }}
                        >
                          设为当前
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => {
                            setMoreOpenId(null)
                            startEdit(item)
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className={`icon-btn ${moreOpenId === item.id ? 'primary' : ''}`}
                          onClick={() =>
                            setMoreOpenId(moreOpenId === item.id ? null : item.id)
                          }
                        >
                          {moreOpenId === item.id ? '收起' : '更多'}
                        </button>
                      </div>

                      {moreOpenId === item.id && (
                        <div className="ops ops-sub">
                          <button
                            className="icon-btn"
                            onClick={() => {
                              moveLearningObject(task.id, item.id, 'up')
                            }}
                          >
                            上移
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => {
                              moveLearningObject(task.id, item.id, 'down')
                            }}
                          >
                            下移
                          </button>
                          {!item.completed && (
                            <label
                              className="icon-btn"
                              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <input
                                type="checkbox"
                                checked={item.enabled}
                                onChange={(e) => {
                                  updateLearningObject(task.id, item.id, { enabled: e.target.checked })
                                }}
                                style={{ margin: 0 }}
                              />
                              启用
                            </label>
                          )}
                          {!item.completed && (
                            <button
                              className="icon-btn"
                              onClick={() => {
                                setCurrentObject(task.id, item.id)
                                completeCurrentObject(task.id)
                                setMoreOpenId(null)
                              }}
                            >
                              完成
                            </button>
                          )}
                          {/* 完成必须可回退：手滑点一下就把整卷标记完结、又没有任何入口改回来，
                              用户只能删了重建，进度全丢。这里给一个明确的撤销。 */}
                          {item.completed && (
                            <button
                              className="icon-btn"
                              onClick={() => {
                                uncompleteObject(task.id, item.id)
                                setMoreOpenId(null)
                              }}
                            >
                              撤销完成
                            </button>
                          )}
                          <button
                            className="icon-btn danger"
                            onClick={() => setDeletingItemId(item.id)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {deletingItemId && (
        <ConfirmModal
          title="删除内容"
          message={`删除「${items.find((i) => i.id === deletingItemId)?.name ?? ''}」？此操作不可撤销。`}
          confirmText="删除"
          onConfirm={() => {
            deleteLearningObject(task.id, deletingItemId)
          }}
          onCancel={() => setDeletingItemId(null)}
        />
      )}
    </div>
  )
}
