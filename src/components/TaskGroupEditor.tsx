import { useRef, useState } from 'react'
import type { LearningObject, Task } from '../types'
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
import { SequenceSheet } from './SequenceSheet'
import { ConfirmModal } from './ConfirmModal'
import { readSeqDefaults } from '../seqDefaults'

interface Props {
  task: Task
}

// 内容序列：列表 + 批量导入 + 编辑弹层。
//
// 结构变了（0.9.0）：新增与编辑都收进 SequenceSheet，列表里只留「＋ 新建序列」与「批量」两个入口。
// 之前新增区常驻在列表上方、编辑区又内联在行内，两块长得一模一样、上下堆叠，
// 用户分不清「现在改的是哪一个」；内联还把行撑高，序号被垂直居中，看着像飘在表单外面。
export function TaskGroupEditor({ task }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<LearningObject | null>(null)
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  // 批量添加（行语法，一行一条）
  const [showBatch, setShowBatch] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchMsg, setBatchMsg] = useState('')
  // 「更多」次行操作展开的序列项（同时只展开一个）
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null)
  const batchRef = useRef<HTMLTextAreaElement | null>(null)

  const group = task.group
  const items = group?.items ?? []
  const mode: GroupMode = group?.mode ?? 'sequential'

  const handleBatchAdd = () => {
    const lines = parseSeqBlock(batchInput)
    if (!lines.length) {
      setBatchMsg('没有可识别的行（每行：名称｜目标｜单位｜分钟）')
      return
    }
    // 行内没写的参数，取「上次用过的单位/时长」——和弹层里记住的是同一份
    const dflt = readSeqDefaults()
    for (const p of lines) {
      addLearningObject(task.id, {
        name: p.name,
        progressUnit: p.unit ?? dflt.unit,
        progressTarget: p.target ?? '',
        countdownSeconds:
          p.countdownMin !== undefined
            ? parseCountdownMin(p.countdownMin)
            : parseCountdownMin(dflt.countdownMin),
        progress: p.target ? '0' : undefined,
      })
    }
    setBatchInput('')
    setBatchMsg(`已添加 ${lines.length} 条序列`)
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
          <option value="weighted_random">{GROUP_MODE_LABELS.weighted_random}</option>
        </select>
      </div>

      {/* 入口：新建 / 批量。新增表单不再常驻列表 */}
      <div className="row" style={{ marginBottom: 14, gap: 8 }}>
        <button className="btn primary" onClick={() => setSheetOpen(true)}>
          ＋ 新建序列
        </button>
        <button
          className={`btn ${showBatch ? 'primary' : ''}`}
          onClick={() => {
            const next = !showBatch
            setShowBatch(next)
            setBatchMsg('')
            // 展开后直接聚焦，省一次点击
            if (next) setTimeout(() => batchRef.current?.focus(), 0)
          }}
        >
          批量
        </button>
      </div>

      {showBatch && (
        <div className="field" style={{ marginBottom: 14 }}>
          <label className="faint" style={{ fontSize: 12 }}>
            每行一条：名称｜目标｜单位｜分钟；也可空格分隔，纯名称可用逗号/顿号拆多条
          </label>
          <textarea
            className="textarea"
            rows={4}
            ref={batchRef}
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

      {/* 列表 */}
      {items.length === 0 ? (
        <div className="empty-state compact-empty">
          <p>还没有序列</p>
          <button className="btn primary" onClick={() => setSheetOpen(true)}>
            ＋ 添加第一个序列
          </button>
          <p className="faint" style={{ fontSize: 12 }}>
            一个序列 = 一个可学习的单位（卷三 / 第 5 章）
          </p>
        </div>
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
                      onClick={() => setCurrentObject(task.id, item.id)}
                    >
                      设为当前
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setMoreOpenId(null)
                        setEditingItem(item)
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className={`icon-btn ${moreOpenId === item.id ? 'primary' : ''}`}
                      onClick={() => setMoreOpenId(moreOpenId === item.id ? null : item.id)}
                    >
                      {moreOpenId === item.id ? '收起' : '更多'}
                    </button>
                  </div>

                  {moreOpenId === item.id && (
                    <div className="ops ops-sub">
                      <button
                        className="icon-btn"
                        onClick={() => moveLearningObject(task.id, item.id, 'up')}
                      >
                        上移
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => moveLearningObject(task.id, item.id, 'down')}
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
              </div>
            )
          })}
        </div>
      )}

      {(sheetOpen || editingItem) && (
        <SequenceSheet
          task={task}
          item={editingItem ?? undefined}
          onClose={() => {
            setSheetOpen(false)
            setEditingItem(null)
          }}
        />
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
