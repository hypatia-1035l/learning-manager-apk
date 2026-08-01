import { useState, useMemo } from 'react'
import {
  useRandomData,
  clearRandomRecords,
  addPreset,
} from '../../randomStore'
import type { WordBank } from '../../randomTypes'

type Filter = 'all' | 'number' | 'wordbank'
type DateFilter = 'all' | 'today' | 'week'

const FILTER_LABELS: Record<Filter, string> = {
  all: '全部',
  number: '数字',
  wordbank: '词库',
}

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all: '全部时间',
  today: '今天',
  week: '近 7 天',
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

// 日期筛选：返回指定日期过滤的起始时间戳（0 表示不限）
function dateFilterStartTs(df: DateFilter): number {
  if (df === 'all') return 0
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  if (df === 'today') return now.getTime()
  if (df === 'week') return now.getTime() - 6 * 24 * 60 * 60 * 1000
  return 0
}

// 从随机记录的 summary（如「今天吃啥 + 迟到借口 + 摸鱼借口 ×1」）反查匹配的词库 ID
// 用名字边界匹配，避免「借口」误匹配「摸鱼借口」之类的子串
// separator 不一定是「 + 」，所以按所有 banks 的名字做锚点扫描更稳
function matchBanksFromSummary(
  summary: string,
  banks: WordBank[],
): string[] {
  // 去掉末尾「 ×N」（单抽/组合抽取数量标记）
  const body = summary.replace(/\s*×\d+\s*$/, '').trim()
  if (!body) return []
  const ids: string[] = []
  for (const b of banks) {
    if (!b.name) continue
    const escaped = b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 词库名前后必须是分隔符或字符串边界
    const re = new RegExp(`(?:^|[\\s+,，、|｜]+)${escaped}(?=$|[\\s+,，、|｜]+)`)
    if (re.test(body)) ids.push(b.id)
  }
  return ids
}

export function RandomRecords() {
  const data = useRandomData()
  const [filter, setFilter] = useState<Filter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [presetNameInput, setPresetNameInput] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const startTs = dateFilterStartTs(dateFilter)
    return data.records.filter((r) => {
      if (filter !== 'all' && r.type !== filter) return false
      if (startTs > 0 && r.createdAt < startTs) return false
      return true
    })
  }, [data.records, filter, dateFilter])

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

  const startEditPreset = (id: string) => {
    setEditingId(id)
    setPresetNameInput('')
  }

  const cancelEditPreset = () => {
    setEditingId(null)
    setPresetNameInput('')
  }

  const confirmSavePreset = (
    recordId: string,
    bankIds: string[],
  ) => {
    const name = presetNameInput.trim()
    if (!name || bankIds.length === 0) return
    addPreset({ name, bankIds })
    setEditingId(null)
    setPresetNameInput('')
    setSavedId(recordId)
    setTimeout(() => {
      setSavedId((cur) => (cur === recordId ? null : cur))
    }, 2000)
  }

  return (
    <div className="section">
      <div className="section-title">
        随机记录
        <span className="count">（{filtered.length}）</span>
      </div>

      {/* 类型筛选 */}
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
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
          数字 · {counts.number}
        </button>
        <button
          className={`btn sm ${filter === 'wordbank' ? 'primary' : ''}`}
          onClick={() => setFilter('wordbank')}
        >
          词库 · {counts.wordbank}
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

      {/* 日期筛选 */}
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map((df) => (
          <button
            key={df}
            className={`btn sm ghost ${dateFilter === df ? 'primary' : ''}`}
            onClick={() => setDateFilter(df)}
          >
            {DATE_FILTER_LABELS[df]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, padding: '20px 0' }}>
          尚无随机记录。数字随机、词库随机每次抽取后会自动记录在此。
        </p>
      ) : (
        <div className="record-list">
          {filtered.map((r) => {
            // 仅词库类记录可存为预设；从 summary 反查匹配的词库 ID
            const matchedIds =
              r.type === 'wordbank'
                ? matchBanksFromSummary(r.summary, data.banks)
                : []
            const canSaveAsPreset = r.type === 'wordbank' && matchedIds.length > 0
            return (
              <div
                key={r.id}
                className="record-item"
                style={{
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 6,
                }}
              >
                <div className="rec-head">
                  <span className={`rec-type rec-${r.type}`}>
                    {r.type === 'number' ? '数字' : '词库'}
                  </span>
                  <span className="rec-summary">{r.summary}</span>
                  <span className="rec-time">{formatTime(r.createdAt)}</span>
                </div>
                <div
                  className="rec-result"
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {r.result}
                </div>
                {/* 存为预设：仅当 summary 能反查到至少 1 个现有词库时展示 */}
                {canSaveAsPreset && (
                  <div className="rec-preset-action">
                    {editingId === r.id ? (
                      <div className="row" style={{ gap: 6 }}>
                        <input
                          className="input"
                          style={{ flex: 1 }}
                          placeholder={`存为预设（含 ${matchedIds.length} 个词库）`}
                          value={presetNameInput}
                          onChange={(e) => setPresetNameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              confirmSavePreset(r.id, matchedIds)
                            if (e.key === 'Escape') cancelEditPreset()
                          }}
                          autoFocus
                        />
                        <button
                          className="btn sm primary"
                          onClick={() => confirmSavePreset(r.id, matchedIds)}
                          disabled={!presetNameInput.trim()}
                        >
                          保存
                        </button>
                        <button
                          className="btn sm"
                          onClick={cancelEditPreset}
                        >
                          取消
                        </button>
                      </div>
                    ) : savedId === r.id ? (
                      <span
                        className="faint"
                        style={{ fontSize: 12 }}
                      >
                        已保存为预设
                      </span>
                    ) : (
                      <button
                        className="btn sm ghost"
                        onClick={() => startEditPreset(r.id)}
                      >
                        存为预设
                      </button>
                    )}
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
