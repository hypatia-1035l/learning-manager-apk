import {
  useAppData,
  getTodayStudyDuration,
  getTotalStudyDuration,
  getStatsByTask,
  getRecentRecords,
  getDailyDurations,
  getStreakDays,
} from '../store'
import { useMemo, useState } from 'react'
import { formatDateTime, formatDuration } from '../utils'

// 短日期 MM/DD
function fmtShort(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 手绘 SVG 柱状图（不引外部图表库）
function TrendChart({
  data,
}: {
  data: Array<{ date: number; duration: number }>
}) {
  const W = 320
  const H = 112
  const padX = 4
  const padTop = 16
  const padBottom = 16
  const innerW = W - padX * 2
  const innerH = H - padTop - padBottom
  const maxDur = Math.max(1, ...data.map((d) => d.duration))
  const n = data.length
  const slot = innerW / n
  const barW = Math.max(2, slot * 0.62)
  const todayMs = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="每日学习时长趋势"
    >
      <line
        x1={padX}
        y1={padTop + innerH}
        x2={W - padX}
        y2={padTop + innerH}
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      <text x={padX} y={11} fontSize={10} fill="#94a3b8">
        峰值 {formatDuration(maxDur)}
      </text>
      {data.map((d, i) => {
        const h = (d.duration / maxDur) * innerH
        const x = padX + i * slot + (slot - barW) / 2
        const y = padTop + innerH - h
        const isToday = d.date === todayMs
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={Math.max(0, h)}
            rx={1.5}
            fill={isToday ? '#3b82f6' : '#cbd5e1'}
          >
            <title>
              {fmtShort(d.date)} · {formatDuration(d.duration)}
            </title>
          </rect>
        )
      })}
    </svg>
  )
}

interface Props {
  onOpenTask: (taskId: string) => void
}

export function StatsView({ onOpenTask }: Props) {
  const data = useAppData()

  // 派生统计：仅在 records 变化时重算，避免每次渲染全量扫描 records
  const { todaySec, totalSec, byTask, recent, totalDays, daily7, daily30, streak } =
    useMemo(() => {
      const todaySec = getTodayStudyDuration(data.records)
      const totalSec = getTotalStudyDuration(data.records)
      const byTask = getStatsByTask(data.records)
      const recent = getRecentRecords(data.records, 15)
      const daily7 = getDailyDurations(data.records, 7)
      const daily30 = getDailyDurations(data.records, 30)
      const streak = getStreakDays(data.records)
      const totalDays = data.records.length
        ? Math.round(
            (Date.now() - data.records[data.records.length - 1].date) /
              (1000 * 60 * 60 * 24),
          ) + 1
        : 0
      return {
        todaySec,
        totalSec,
        byTask,
        recent,
        totalDays,
        daily7,
        daily30,
        streak,
      }
    }, [data.records])

  // 趋势图时间范围：7 天 / 30 天
  const [range, setRange] = useState(7)

  // taskId → Task 查找表，避免 map 内 O(n) 的 find
  const taskMap = useMemo(
    () => new Map(data.tasks.map((t) => [t.id, t])),
    [data.tasks],
  )

  // 今日进度条：以 4 小时为"满格"参考，超出也显示满
  const REF_DAILY = 4 * 60 * 60
  const todayPct = Math.min(100, Math.round((todaySec / REF_DAILY) * 100))

  return (
    <div className="stats-view">
      {/* ===== 汇总卡片 ===== */}
      <section className="stats-overview">
        <div className="stats-summary-card">
          <div className="s-row-2">
            <div className="s-stat today">
              <div className="s-label">今日时长</div>
              <div className="s-value">{formatDuration(todaySec)}</div>
              <div className="s-bar">
                <div className="s-bar-fill" style={{ width: todayPct + '%' }} />
              </div>
              <div className="s-sub muted">
                目标参考 {formatDuration(REF_DAILY)} · 完成 {todayPct}%
              </div>
            </div>
            <div className="s-stat">
              <div className="s-label">累计时长</div>
              <div className="s-value">{formatDuration(totalSec)}</div>
              <div className="s-sub muted">
                {totalDays > 0 ? `共 ${totalDays} 天` : '尚无记录'}
              </div>
            </div>
          </div>
          <div className="s-row-3">
            <div className="s-mini">
              <div className="s-mini-v">{byTask.length}</div>
              <div className="s-mini-k">方向</div>
            </div>
            <div className="s-mini">
              <div className="s-mini-v">{data.records.length}</div>
              <div className="s-mini-k">次数</div>
            </div>
            <div className="s-mini">
              <div className="s-mini-v">
                {data.records.length
                  ? (
                      data.records.reduce(
                        (s, r) => s + (r.duration || 0),
                        0,
                      ) / data.records.length / 60
                    ).toFixed(0)
                  : 0}
                <span className="s-mini-unit">分</span>
              </div>
              <div className="s-mini-k">平均时长</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 学习趋势 ===== */}
      <section className="section">
        <div className="section-title">
          学习趋势
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              color: '#16a34a',
              fontWeight: 600,
            }}
          >
            连续 {streak} 天
          </span>
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              gap: 4,
            }}
          >
            <button
              type="button"
              className="btn sm"
              onClick={() => setRange(7)}
              style={
                range === 7
                  ? { background: '#3b82f6', color: '#fff', borderColor: '#3b82f6' }
                  : {}
              }
            >
              7天
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => setRange(30)}
              style={
                range === 30
                  ? { background: '#3b82f6', color: '#fff', borderColor: '#3b82f6' }
                  : {}
              }
            >
              30天
            </button>
          </span>
        </div>
        {totalSec === 0 ? (
          <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
            尚无记录。
          </p>
        ) : (
          <TrendChart data={range === 7 ? daily7 : daily30} />
        )}
      </section>

      {/* ===== 按方向汇总 ===== */}
      <section className="section">
        <div className="section-title">
          按方向统计
          <span className="count">（{byTask.length} 个）</span>
        </div>
        {byTask.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
            尚无记录。
          </p>
        ) : (
          <div className="by-task-list">
            {(() => {
              const max = byTask[0]?.totalDuration || 1
              return byTask.map((item) => {
                const task = taskMap.get(item.taskId)
                const icon = task?.icon ?? ''
                const pct = Math.round((item.totalDuration / max) * 100)
                return (
                  <button
                    key={item.taskId}
                    className="by-task-item"
                    onClick={() => onOpenTask(item.taskId)}
                    type="button"
                  >
                    <div className="bt-head">
                      <span className="bt-icon">{icon}</span>
                      <span className="bt-name">{item.taskName}</span>
                      <span className="bt-dur">
                        {formatDuration(item.totalDuration)}
                      </span>
                    </div>
                    <div className="bt-foot">
                      <div className="bt-bar">
                        <div
                          className="bt-bar-fill"
                          style={{ width: pct + '%' }}
                        />
                      </div>
                      <span className="bt-count muted">
                        {item.recordCount} 次
                      </span>
                    </div>
                  </button>
                )
              })
            })()}
          </div>
        )}
      </section>

      {/* ===== 最近记录 ===== */}
      <section className="section">
        <div className="section-title">
          近期记录
          <span className="count">（最多 {recent.length} 条）</span>
        </div>
        {recent.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
            尚无记录。
          </p>
        ) : (
          <div className="record-list">
            {recent.map((r) => {
              const task = taskMap.get(r.taskId)
              const icon = task?.icon ?? ''
              return (
                <div
                  key={r.id}
                  className="record-item record-item-stack"
                >
                  <div className="record-row">
                    <span className="bt-icon">{icon}</span>
                    <span className="obj">{r.taskName}</span>
                    <span className="change">
                      {r.sequenceName ?? r.objectName}
                    </span>
                    <span className="dur">{formatDuration(r.duration)}</span>
                  </div>
                  <div className="s-record-meta muted">
                    <span>{formatDateTime(r.date)}</span>
                    <span className="s-record-prog">
                      进度：{r.startProgress || '—'} → {r.endProgress || '—'}
                      {typeof r.deltaCount === 'number' && r.deltaCount !== 0
                        ? `（+${r.deltaCount}）`
                        : ''}
                    </span>
                  </div>
                  {r.note && (
                    <div className="s-record-note">{r.note}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
