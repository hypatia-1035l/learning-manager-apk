// 摸鱼日报：按天聚合应用使用统计快照
// 独立存储，不污染学习记录/任务数据/统计数据结构
// 今日数据由 UsageStatsManager 实时读取，历史数据由本模块持久化
import type { AppCategory } from './usageStatsTypes'

const REPORT_KEY = 'learning-manager:slacking-report:v1'
const MAX_DAYS = 30 // 保留最近 30 天

// 单日快照
export interface DailyReport {
  date: string // YYYY-MM-DD
  totalMs: number
  byCategory: Record<AppCategory, number>
  // 摸鱼提醒触发次数（当日）
  alertCount: number
  // 学习时长（来自学习记录，单位 ms）
  studyMs: number
  // Top3 应用
  topApps?: Array<{
    packageName: string
    appName: string
    foregroundMs: number
    category: AppCategory
  }>
  capturedAt: number // 快照时间戳
}

export interface ReportStore {
  reports: DailyReport[]
}

// 空的 byCategory 初始化
export function emptyByCategory(): Record<AppCategory, number> {
  return {
    study: 0,
    create: 0,
    entertainment: 0,
    tool: 0,
    other: 0,
  }
}

// 加载全部报告
export function loadReports(): DailyReport[] {
  try {
    const raw = localStorage.getItem(REPORT_KEY)
    if (raw) {
      const store = JSON.parse(raw) as ReportStore
      return Array.isArray(store.reports) ? store.reports : []
    }
  } catch {
    /* ignore */
  }
  return []
}

function saveReports(reports: DailyReport[]): void {
  try {
    const store: ReportStore = { reports }
    localStorage.setItem(REPORT_KEY, JSON.stringify(store))
  } catch {
    /* ignore */
  }
}

// 今日日期字符串
export function todayStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 保存/更新今日快照
// 若已存在同日数据则覆盖（取最新值）
export function saveTodayReport(report: Omit<DailyReport, 'date'>): void {
  const today = todayStr()
  const reports = loadReports()
  const filtered = reports.filter((r) => r.date !== today)
  filtered.push({ ...report, date: today })
  // 按日期升序
  filtered.sort((a, b) => a.date.localeCompare(b.date))
  // 只保留最近 MAX_DAYS 天
  const trimmed = filtered.slice(-MAX_DAYS)
  saveReports(trimmed)
}

// 获取最近 N 天的日报（含今日）
export function getRecentReports(days: number = 7): DailyReport[] {
  const reports = loadReports()
  return reports.slice(-days)
}

// 获取某日日报
export function getReportByDate(date: string): DailyReport | null {
  const reports = loadReports()
  return reports.find((r) => r.date === date) ?? null
}

// 周报聚合：最近 7 天汇总
export interface WeeklySummary {
  totalMs: number
  byCategory: Record<AppCategory, number>
  studyMs: number
  alertCount: number
  days: number // 实际有数据的天数
  avgDailyEntertainment: number // 日均娱乐时长
  avgDailyStudy: number // 日均学习时长
}

export function getWeeklySummary(): WeeklySummary {
  const reports = getRecentReports(7)
  const byCategory = emptyByCategory()
  let totalMs = 0
  let studyMs = 0
  let alertCount = 0
  for (const r of reports) {
    totalMs += r.totalMs
    studyMs += r.studyMs
    alertCount += r.alertCount
    for (const k of Object.keys(byCategory) as AppCategory[]) {
      byCategory[k] += r.byCategory[k] ?? 0
    }
  }
  const days = reports.length || 1
  return {
    totalMs,
    byCategory,
    studyMs,
    alertCount,
    days,
    avgDailyEntertainment: Math.round(byCategory.entertainment / days),
    avgDailyStudy: Math.round(studyMs / days),
  }
}

// 增加摸鱼提醒触发计数（当日）
export function incrementAlertCount(): void {
  const today = todayStr()
  const reports = loadReports()
  const todayReport = reports.find((r) => r.date === today)
  if (todayReport) {
    todayReport.alertCount += 1
    saveReports(reports)
  }
  // 若今日尚无快照（用户没打开过今日状态页），忽略计数
}
