import { useEffect, useState } from 'react'
import {
  fetchTodayUsage,
  hasUsagePermission,
  requestUsagePermission,
  setAppCategory,
  loadCategoryMap,
  loadSlackingConfig,
  saveSlackingConfig,
  checkSlackingAlert,
} from '../usageStatsService'
import type { AggregatedUsage } from '../usageStatsService'
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from '../usageStatsTypes'
import type { AppCategory } from '../usageStatsTypes'
import { formatDuration } from '../utils'
import { useAppData } from '../store'
import {
  saveTodayReport,
  getRecentReports,
  getWeeklySummary,
} from '../slackingReport'
import type { DailyReport, WeeklySummary } from '../slackingReport'

interface Props {
  onBack: () => void
}

const ALL_CATEGORIES: AppCategory[] = [
  'study',
  'create',
  'entertainment',
  'tool',
  'other',
]

export function TodayStatus({ onBack }: Props) {
  const data = useAppData()
  const [loading, setLoading] = useState(false)
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<AggregatedUsage | null>(null)
  const [, setCustomMap] = useState(loadCategoryMap())
  const [editingPkg, setEditingPkg] = useState<string | null>(null)
  const [slackingCfg, setSlackingCfg] = useState(loadSlackingConfig())
  const [slackingMsg, setSlackingMsg] = useState('')
  const [msg, setMsg] = useState('')
  const [reports, setReports] = useState<DailyReport[]>([])
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null)

  // 计算今日学习时长（秒 → 毫秒）
  const todayStudyMs = (() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    return (
      data.records
        .filter((r) => r.date >= todayStart.getTime())
        .reduce((sum, r) => sum + r.duration, 0) * 1000
    )
  })()

  const refresh = async () => {
    setLoading(true)
    setMsg('')
    const g = await hasUsagePermission()
    setPermGranted(g)
    if (!g) {
      setLoading(false)
      return
    }
    const agg = await fetchTodayUsage()
    setUsage(agg)
    setLoading(false)
    if (agg) {
      // 保存今日快照（供日报历史使用）
      saveTodayReport({
        totalMs: agg.totalMs,
        byCategory: agg.byCategory,
        alertCount: 0, // 触发计数由摸鱼检测模块维护，这里仅占位
        studyMs: todayStudyMs,
        topApps: agg.items.slice(0, 3).map((it) => ({
          packageName: it.packageName,
          appName: it.appName,
          foregroundMs: it.foregroundMs,
          category: it.category,
        })),
        capturedAt: Date.now(),
      })
      // 刷新历史与周报
      setReports(getRecentReports(7))
      setWeekly(getWeeklySummary())

      // 检查摸鱼提醒触发
      const triggered = checkSlackingAlert(agg.byCategory.entertainment)
      if (triggered) {
        const hrs = (agg.byCategory.entertainment / 3600000).toFixed(1)
        setSlackingMsg(`今天已经摸了一会儿鱼（娱乐 ${hrs} 小时），要不要捞一条任务？`)
      }
    }
  }

  useEffect(() => {
    refresh()
    // 初始加载历史
    setReports(getRecentReports(7))
    setWeekly(getWeeklySummary())
  }, [])

  const handleRequestPerm = async () => {
    await requestUsagePermission()
    setMsg('已跳转到系统设置，开启「使用情况访问权限」后返回 App')
  }

  const handleChangeCategory = (pkg: string, cat: AppCategory) => {
    const newMap = setAppCategory(pkg, cat)
    setCustomMap({ ...newMap })
    setEditingPkg(null)
    // 重新分类当前数据
    if (usage) {
      const items = usage.items.map((it) => ({
        ...it,
        category: it.packageName === pkg ? cat : it.category,
      }))
      const byCategory: Record<AppCategory, number> = {
        study: 0,
        create: 0,
        entertainment: 0,
        tool: 0,
        other: 0,
      }
      for (const it of items) byCategory[it.category] += it.foregroundMs
      setUsage({ ...usage, items, byCategory })
    }
  }

  const handleToggleSlacking = (enabled: boolean) => {
    const cfg = { ...slackingCfg, enabled }
    saveSlackingConfig(cfg)
    setSlackingCfg(cfg)
    setMsg(enabled ? '摸鱼提醒已开启' : '摸鱼提醒已关闭')
  }

  const handleChangeThreshold = (hours: number) => {
    const cfg = { ...slackingCfg, thresholdMs: hours * 3600000 }
    saveSlackingConfig(cfg)
    setSlackingCfg(cfg)
  }

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← 返回
      </button>
      <header className="app-header">
        <h1 className="app-title">今日状态</h1>
      </header>
      <p className="app-tagline">
        了解今天手机时间去了哪里 · 不替你做决定
      </p>

      {/* 权限未开启 */}
      {permGranted === false && (
        <section className="section">
          <div className="section-title">需要权限</div>
          <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
            读取应用使用时间需要开启「使用情况访问权限」。该权限由 Android 系统管理，
            我们不会上传任何数据，只在本地统计。
          </p>
          <button className="btn primary" onClick={handleRequestPerm}>
            去开启权限
          </button>
          {msg && (
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              {msg}
            </p>
          )}
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
            提示：路径为 设置 → 应用管理 → 特殊访问权限 → 使用情况访问权限 →
            今天摸啥鱼
          </p>
          <button className="btn" style={{ marginTop: 12 }} onClick={refresh}>
            我已开启，重新检测
          </button>
        </section>
      )}

      {/* 权限已开启 */}
      {permGranted && (
        <>
          <section className="section">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="section-title" style={{ margin: 0 }}>
                今日总使用
              </div>
              <button className="btn sm" onClick={refresh} disabled={loading}>
                {loading ? '刷新中…' : '刷新'}
              </button>
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: 'var(--accent)',
                margin: '8px 0 4px',
              }}
            >
              {usage ? formatDuration(usage.totalMs / 1000) : '—'}
            </div>
            <p className="faint" style={{ fontSize: 12 }}>
              统计自今日 0:00 起，前台活跃时长（不含锁屏）。
            </p>
          </section>

          {/* 分类汇总 */}
          <section className="section">
            <div className="section-title">分类汇总</div>
            {usage ? (
              <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {ALL_CATEGORIES.map((cat) => (
                  <div key={cat} className="stat">
                    <div className="k" style={{ color: CATEGORY_COLORS[cat] }}>
                      {CATEGORY_LABELS[cat]}
                    </div>
                    <div className="v" style={{ fontSize: 14 }}>
                      {usage.byCategory[cat] > 0
                        ? formatDuration(usage.byCategory[cat] / 1000)
                        : '0'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint">暂无数据</p>
            )}

            {/* 摸鱼提醒触发提示 */}
            {slackingMsg && (
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  background: 'var(--amber-bg)',
                  border: '1px solid var(--amber)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--amber)',
                  fontSize: 13,
                }}
              >
                🐟 {slackingMsg}
              </div>
            )}
          </section>

          {/* 摸鱼提醒配置 */}
          <section className="section">
            <div className="section-title">摸鱼提醒（接口预留）</div>
            <label className="muted" style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={slackingCfg.enabled}
                onChange={(e) => handleToggleSlacking(e.target.checked)}
              />
              <strong style={{ marginLeft: 6 }}>启用摸鱼提醒</strong>
            </label>
            <div className="field">
              <label>娱乐类时长超过此值时提示（小时）</label>
              <input
                type="number"
                className="input"
                min={0.5}
                step={0.5}
                value={slackingCfg.thresholdMs / 3600000}
                onChange={(e) =>
                  handleChangeThreshold(
                    Math.max(0.5, Number(e.target.value) || 2),
                  )
                }
                disabled={!slackingCfg.enabled}
              />
              <span className="faint" style={{ fontSize: 12 }}>
                默认 2 小时。每自然日最多触发一次。
              </span>
            </div>
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              注：第一版仅实现触发接口。后续可扩展为推送通知或自动打开学习任务。
            </p>
          </section>

          {/* 应用列表 */}
          <section className="section">
            <div className="section-title">
              应用列表
              <span className="count">
                （{usage?.items.length ?? 0} 个应用，按时长排序）
              </span>
            </div>
            {usage && usage.items.length > 0 ? (
              <div className="obj-list">
                {usage.items.slice(0, 50).map((it) => (
                  <div key={it.packageName} className="obj-item">
                    <span className="idx">·</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name" style={{ fontSize: 14 }}>
                        {it.appName}
                      </div>
                      <div className="faint" style={{ fontSize: 11 }}>
                        {it.packageName}
                      </div>
                    </div>
                    <span
                      className="prog"
                      style={{
                        color: CATEGORY_COLORS[it.category],
                        fontWeight: 600,
                      }}
                    >
                      {CATEGORY_LABELS[it.category]}
                    </span>
                    <span
                      className="prog"
                      style={{ color: 'var(--accent)', fontWeight: 600 }}
                    >
                      {formatDuration(it.foregroundMs / 1000)}
                    </span>
                    <div className="ops">
                      {editingPkg === it.packageName ? (
                        <select
                          className="select sm"
                          value={it.category}
                          onChange={(e) =>
                            handleChangeCategory(
                              it.packageName,
                              e.target.value as AppCategory,
                            )
                          }
                          onBlur={() => setEditingPkg(null)}
                        >
                          {ALL_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          className="icon-btn"
                          title="修改分类"
                          onClick={() => setEditingPkg(it.packageName)}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint">今日暂无应用使用记录</p>
            )}
            <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
              默认分类基于应用名关键字匹配，可点 ✎ 手动修改。修改后会记住你的选择。
            </p>
          </section>

          {/* 摸鱼周报 */}
          {weekly && weekly.days > 0 && (
            <section className="section">
              <div className="section-title">本周概览（{weekly.days} 天）</div>
              <div className="stat-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="stat">
                  <div className="k">总使用</div>
                  <div className="v">{formatDuration(weekly.totalMs / 1000)}</div>
                </div>
                <div className="stat">
                  <div className="k">学习时长</div>
                  <div className="v" style={{ color: 'var(--green)' }}>
                    {formatDuration(weekly.studyMs / 1000)}
                  </div>
                </div>
                <div className="stat">
                  <div className="k">日均娱乐</div>
                  <div className="v" style={{ color: 'var(--red)' }}>
                    {formatDuration(weekly.avgDailyEntertainment / 1000)}
                  </div>
                </div>
                <div className="stat">
                  <div className="k">日均学习</div>
                  <div className="v" style={{ color: 'var(--green)' }}>
                    {formatDuration(weekly.avgDailyStudy / 1000)}
                  </div>
                </div>
              </div>
              {weekly.alertCount > 0 && (
                <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                  本周共触发 {weekly.alertCount} 次摸鱼提醒
                </p>
              )}
              {/* 娱乐/学习比例条 */}
              {weekly.totalMs + weekly.studyMs > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    娱乐 vs 学习 比例
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      height: 8,
                      borderRadius: 4,
                      overflow: 'hidden',
                      background: 'var(--line)',
                    }}
                  >
                    <div
                      style={{
                        width: `${(weekly.byCategory.entertainment / (weekly.totalMs + weekly.studyMs)) * 100}%`,
                        background: 'var(--red)',
                      }}
                    />
                    <div
                      style={{
                        width: `${(weekly.studyMs / (weekly.totalMs + weekly.studyMs)) * 100}%`,
                        background: 'var(--green)',
                      }}
                    />
                  </div>
                  <div className="row" style={{ gap: 12, marginTop: 6, fontSize: 11 }}>
                    <span className="muted">
                      <span style={{ color: 'var(--red)' }}>■</span> 娱乐{' '}
                      {formatDuration(weekly.byCategory.entertainment / 1000)}
                    </span>
                    <span className="muted">
                      <span style={{ color: 'var(--green)' }}>■</span> 学习{' '}
                      {formatDuration(weekly.studyMs / 1000)}
                    </span>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 最近 7 天日报历史 */}
          {reports.length > 0 && (
            <section className="section">
              <div className="section-title">最近 {reports.length} 天日报</div>
              <div className="record-list">
                {[...reports].reverse().map((r) => (
                  <div key={r.date} className="record-item" style={{ flexWrap: 'wrap' }}>
                    <span className="date">{r.date.slice(5)}</span>
                    <span className="obj">
                      总 {formatDuration(r.totalMs / 1000)}
                    </span>
                    <span
                      className="change"
                      style={{ color: 'var(--red)' }}
                    >
                      娱乐 {formatDuration(r.byCategory.entertainment / 1000)}
                    </span>
                    <span
                      className="change"
                      style={{ color: 'var(--green)' }}
                    >
                      学习 {formatDuration(r.studyMs / 1000)}
                    </span>
                    {r.alertCount > 0 && (
                      <span className="faint" style={{ fontSize: 11 }}>
                        🐟 ×{r.alertCount}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
                每次打开「今日状态」会更新今日快照。最多保留 30 天。
              </p>
            </section>
          )}

          {msg && (
            <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>
              {msg}
            </p>
          )}
        </>
      )}
    </div>
  )
}
