import { getRecordsByTask, useAppData } from '../store'
import { formatDateTime, formatDuration } from '../utils'

interface Props {
  taskId: string
}

export function StudyRecords({ taskId }: Props) {
  const data = useAppData()
  const records = getRecordsByTask(data.records, taskId)

  return (
    <div className="section">
      <div className="section-title">
        🕒 学习记录
        <span className="count">（{records.length} 条）</span>
      </div>

      {records.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
          还没有学习记录。点击「开始学习」记录第一次进度。
        </p>
      ) : (
        <div className="record-list">
          {records.map((r) => (
            <div key={r.id} className="record-item">
              <span className="date">{formatDateTime(r.date)}</span>
              <span className="obj">{r.objectName}</span>
              <span className="change">
                {r.startProgress || '—'} → {r.endProgress || '—'}
              </span>
              <span className="dur">{formatDuration(r.duration)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
