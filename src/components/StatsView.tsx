import {
  useAppData,
  getTodayStudyDuration,
  getTotalStudyDuration,
  getStatsByTask,
  getRecentRecords,
} from '../store'
import { formatDateTime, formatDuration } from '../utils'

interface Props {
  onOpenTask: (taskId: string) => void
}

export function StatsView({ onOpenTask }: Props) {
  const data = useAppData()

  const todaySec = getTodayStudyDuration(data.records)
  const totalSec = getTotalStudyDuration(data.records)
  const byTask = getStatsByTask(data.records)
  const recent = getRecentRecords(data.records, 15)

  // 今日进度条：以 4 小时为"满格"参考，超出也显示满
  const REF_DAILY = 4 * 60 * 60
  const todayPct = Math.min(100, Math.round((todaySec / REF_DAILY) * 100))
  const totalDays = data.records.length
    ? Math.round(
        (Date.now() - data.records[data.records.length - 1].date) /
          (1000 * 60 * 60 * 24),
      ) + 1
    : 0

  return (
    <div className="stats-view">
      {/* ===== 汇总卡片 ===== */}
      <section className="stats-overview">
        <div className="stats-summary-card">
          <div className="s-row-2">
            <div className="s-stat today">
              <div className="s-label">今日学习</div>
              <div className="s-value">{formatDuration(todaySec)}</div>
              <div className="s-bar">
                <div className="s-bar-fill" style={{ width: todayPct + '%' }} />
              </div>
              <div className="s-sub muted">
                目标参考 {formatDuration(REF_DAILY)} · 完成 {todayPct}%
              </div>
            </div>
            <div className="s-stat">
              <div className="s-label">累计学习</div>
              <div className="s-value">{formatDuration(totalSec)}</div>
              <div className="s-sub muted">
                {totalDays > 0 ? `共 ${totalDays} 天` : '还没有学习记录'}
              </div>
            </div>
          </div>
          <div className="s-row-3">
            <div className="s-mini">
              <div className="s-mini-v">{byTask.length}</div>
              <div className="s-mini-k">学习方向</div>
            </div>
            <div className="s-mini">
              <div className="s-mini-v">{data.records.length}</div>
              <div className="s-mini-k">学习次数</div>
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

      {/* ===== 按方向汇总 ===== */}
      <section className="section">
        <div className="section-title">
          📊 按方向统计
          <span className="count">（{byTask.length} 个）</span>
        </div>
        {byTask.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
            还没有学习记录。先去开始一次学习吧～
          </p>
        ) : (
          <div className="by-task-list">
            {(() => {
              const max = byTask[0]?.totalDuration || 1
              return byTask.map((item) => {
                const task = data.tasks.find((t) => t.id === item.taskId)
                const icon = task?.icon ?? '📚'
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
          🕒 最近学习
          <span className="count">（最多 {recent.length} 条）</span>
        </div>
        {recent.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
            还没有学习记录。
          </p>
        ) : (
          <div className="record-list">
            {recent.map((r) => {
              const task = data.tasks.find((t) => t.id === r.taskId)
              const icon = task?.icon ?? '📚'
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
