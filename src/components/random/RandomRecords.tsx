import { useState, useMemo } from 'react'
import { useRandomData, clearRandomRecords } from '../../randomStore'

type Filter = 'all' | 'number' | 'wordbank'

const FILTER_LABELS: Record<Filter, string> = {
  all: '全部',
  number: '🔢 数字',
  wordbank: '📝 词库',
}

// 格式化时间为可读短文本
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (isToday) return `今天 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

export function RandomRecords() {
  const data = useRandomData()
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return data.records
    return data.records.filter((r) => r.type === filter)
  }, [data.records, filter])

  const counts = useMemo(() => {
    return {
      number: data.records.filter((r) => r.type === 'number').length,
      wordbank: data.records.filter((r) => r.type === 'wordbank').length,
    }
  }, [data.records])

  const handleClear = () => {
    const target = filter === 'all' ? '全部' : FILTER_LABELS[filter]
    if (confirm(`确认清空${target}随机记录？此操作不可撤销。`)) {
      clearRandomRecords(filter === 'all' ? undefined : filter)
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        📜 随机记录
        <span className="count">（{filtered.length}）</span>
      </div>

      {/* 类型筛选 */}
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        <button
          className={`btn sm ${filter === 'all' ? 'primary' : ''}`}
          onClick={() => setFilter('all')}
        >
          全部 · {data.records.length}
        </button>
        <button
          className={`btn sm ${filter === 'number' ? 'primary' : ''}`}
          onClick={() => setFilter('number')}
        >
          🔢 数字 · {counts.number}
        </button>
        <button
          className={`btn sm ${filter === 'wordbank' ? 'primary' : ''}`}
          onClick={() => setFilter('wordbank')}
        >
          📝 词库 · {counts.wordbank}
        </button>
        <span className="spacer" />
        <button
          className="btn sm danger"
          onClick={handleClear}
          disabled={filtered.length === 0}
        >
          清空
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '20px 0' }}>
          尚无随机记录。数字随机、词库随机每次抽取后会自动记录在此。
        </p>
      ) : (
        <div className="record-list">
          {filtered.map((r) => (
            <div key={r.id} className="record-item">
              <div className="rec-head">
                <span className={`rec-type rec-${r.type}`}>
                  {r.type === 'number' ? '🔢' : '📝'}
                </span>
                <span className="rec-summary">{r.summary}</span>
                <span className="rec-time">{formatTime(r.createdAt)}</span>
              </div>
              <div className="rec-result">
                {r.result.split('\n').map((line, i) => (
                  <div key={i} className="rec-line">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
