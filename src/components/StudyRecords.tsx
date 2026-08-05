import { useState } from 'react'
import {
  getRecordsByTask,
  useAppData,
  updateStudyRecordNote,
  deleteStudyRecord,
} from '../store'
import { formatDateTime, formatDuration } from '../utils'

interface Props {
  taskId: string
  totalTime: number
}

export function StudyRecords({ taskId, totalTime }: Props) {
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

  const deleteRecord = (recordId: string) => {
    if (confirm('删除这条记录？此操作不可撤销。')) {
      deleteStudyRecord(recordId)
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        记录
        <span className="count">（{records.length} 条）</span>
        <span className="faint" style={{ fontSize: 12, marginLeft: 'auto' }}>
          累计 {formatDuration(totalTime)}
        </span>
      </div>

      {records.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
          尚无记录，点「开始」开始第一次。
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
                      placeholder="备注（想法、疑问、心得…）"
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
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      className="record-note"
                      style={{ flex: 1 }}
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
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => deleteRecord(r.id)}
                      title="删除这条记录"
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
