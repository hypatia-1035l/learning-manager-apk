import { useState } from 'react'
import {
  getRecordsByTask,
  useAppData,
  updateStudyRecordNote,
} from '../store'
import { formatDateTime, formatDuration } from '../utils'

interface Props {
  taskId: string
}

export function StudyRecords({ taskId }: Props) {
  const data = useAppData()
  const records = getRecordsByTask(data.records, taskId)
  // 正在编辑备注的 recordId；null 表示未在编辑
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (recordId: string, currentNote?: string) => {
    setEditingId(recordId)
    setEditValue(currentNote ?? '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const commitEdit = (recordId: string) => {
    updateStudyRecordNote(recordId, editValue || undefined)
    setEditingId(null)
    setEditValue('')
  }

  return (
    <div className="section">
      <div className="section-title">
        学习记录
        <span className="count">（{records.length} 条）</span>
      </div>

      {records.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
          还没有学习记录。点击「开始学习」记录第一次进度。
        </p>
      ) : (
        <div className="record-list">
          {records.map((r) => {
            const isEditing = editingId === r.id
            return (
              <div key={r.id} className="record-item record-item-stack">
                <div className="record-row">
                  <span className="date">{formatDateTime(r.date)}</span>
                  <span className="obj">
                    {r.sequenceName ?? r.objectName}
                  </span>
                  <span className="change">
                    {r.startProgress || '—'} → {r.endProgress || '—'}
                    {typeof r.deltaCount === 'number' && r.deltaCount !== 0
                      ? `（+${r.deltaCount}）`
                      : ''}
                  </span>
                  <span className="dur">{formatDuration(r.duration)}</span>
                </div>

                {/* 备注区：展示 + 内联编辑 */}
                {isEditing ? (
                  <div className="record-note-edit">
                    <textarea
                      className="textarea"
                      autoFocus
                      rows={2}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder="学习备注（想法、疑问、心得…）"
                    />
                    <div className="record-note-ops">
                      <button
                        className="btn sm ghost"
                        onClick={cancelEdit}
                      >
                        取消
                      </button>
                      <button
                        className="btn sm primary"
                        onClick={() => commitEdit(r.id)}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="record-note"
                    onClick={() => startEdit(r.id, r.note)}
                    title="点击编辑备注"
                  >
                    {r.note ? (
                      <span className="record-note-text">{r.note}</span>
                    ) : (
                      <span className="record-note-placeholder">
                        + 添加备注
                      </span>
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
