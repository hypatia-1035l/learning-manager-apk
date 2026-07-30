// 应用使用统计 - 数据结构
// 独立模块，与任务/学习/随机/提醒/悬浮窗系统无关

// 应用分类
export type AppCategory = 'study' | 'create' | 'entertainment' | 'tool' | 'other'

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  study: '学习',
  create: '创作',
  entertainment: '娱乐',
  tool: '工具',
  other: '其他',
}

// 分类颜色（用于今日状态页面）
export const CATEGORY_COLORS: Record<AppCategory, string> = {
  study: '#5b7a4f',
  create: '#8a5a2b',
  entertainment: '#a8443a',
  tool: '#6b6359',
  other: '#9a9186',
}

// 单个应用使用情况
export interface AppUsageItem {
  packageName: string
  appName: string
  foregroundMs: number // 前台时长（毫秒）
}

// 原生插件返回的原始数据
export interface RawUsageResult {
  ok: boolean
  error?: string
  totalForegroundMs?: number
  stats?: AppUsageItem[]
  startMs?: number
  endMs?: number
}

// 应用分类映射（packageName -> category），持久化到 localStorage
export interface AppCategoryMap {
  [packageName: string]: AppCategory
}

// 摸鱼提醒条件配置
export interface SlackingAlertConfig {
  enabled: boolean // 是否启用摸鱼提醒
  thresholdMs: number // 娱乐类累计时长超过此值触发（默认 2 小时 = 7200000）
  lastTriggeredDate?: string // 上次触发日期 YYYY-MM-DD，避免一天触发多次
}
