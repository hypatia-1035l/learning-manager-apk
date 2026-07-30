import { registerPlugin } from '@capacitor/core'
import type {
  RawUsageResult,
  AppUsageItem,
  AppCategory,
  AppCategoryMap,
  SlackingAlertConfig,
} from './usageStatsTypes'

// ---------- 原生插件 ----------
export interface UsageStatsPlugin {
  hasPermission(): Promise<{ granted: boolean }>
  requestPermission(): Promise<{ opened: boolean }>
  queryTodayStats(): Promise<RawUsageResult>
}
export const UsageStats = registerPlugin<UsageStatsPlugin>('UsageStats')

// ---------- 存储 ----------
const CATEGORY_KEY = 'learning-manager:app-category-map:v1'
const SLACKING_KEY = 'learning-manager:slacking-alert:v1'

// 默认分类规则（按包名/应用名关键字匹配）
// 第一版规则可后续调整
const DEFAULT_RULES: Array<{
  pattern: RegExp
  category: AppCategory
}> = [
  // 学习类
  { pattern: /(学习|读书|kindle|mooc|课程|背单词|词典|学|词典)/i, category: 'study' },
  {
    pattern: /(com\.learning\.manager|today\.fish|摸啥鱼)/i,
    category: 'study',
  },
  // 创作类
  { pattern: /(笔记|notion|obsidian|印象|typora|编辑|markdown|代码|github|gitlab|vscode|剪映|pr|ps|画|design|figma|sketch)/i, category: 'create' },
  // 工具类
  { pattern: /(设置|setting|文件|计算器|时钟|日历|天气|地图|输入法|keyboard|launcher|系统|相册|相机|计算|工具)/i, category: 'tool' },
  // 娱乐类
  { pattern: /(抖音|快手|b站|bilibili|哔哩|视频|movie|游戏|game|音乐|music|网易云|qq音乐|酷狗|小说|阅读|直播|live|漫画|追剧|爱奇艺|优酷|腾讯视频|小红书|微博|twitter|instagram|tiktok|youtube|netflix)/i, category: 'entertainment' },
]

// 加载分类映射
export function loadCategoryMap(): AppCategoryMap {
  try {
    const raw = localStorage.getItem(CATEGORY_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return {}
}

// 保存分类映射
export function saveCategoryMap(map: AppCategoryMap): void {
  try {
    localStorage.setItem(CATEGORY_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

// 修改单个应用分类
export function setAppCategory(packageName: string, category: AppCategory): AppCategoryMap {
  const map = loadCategoryMap()
  map[packageName] = category
  saveCategoryMap(map)
  return map
}

// 获取应用分类：优先用户自定义，否则按默认规则，再否则 'other'
export function getAppCategory(
  packageName: string,
  appName: string,
  customMap: AppCategoryMap,
): AppCategory {
  if (customMap[packageName]) return customMap[packageName]
  for (const rule of DEFAULT_RULES) {
    if (rule.pattern.test(appName) || rule.pattern.test(packageName)) {
      return rule.category
    }
  }
  return 'other'
}

// ---------- 摸鱼提醒配置 ----------
export const DEFAULT_SLACKING_CONFIG: SlackingAlertConfig = {
  enabled: false,
  thresholdMs: 2 * 60 * 60 * 1000, // 2 小时
}

export function loadSlackingConfig(): SlackingAlertConfig {
  try {
    const raw = localStorage.getItem(SLACKING_KEY)
    if (raw) return { ...DEFAULT_SLACKING_CONFIG, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SLACKING_CONFIG }
}

export function saveSlackingConfig(cfg: SlackingAlertConfig): void {
  try {
    localStorage.setItem(SLACKING_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

// ---------- 摸鱼提醒触发接口（第一版只暴露接口） ----------
// 当娱乐类应用今日累计时长超过阈值时调用此函数
// 返回是否触发了提醒（首次当天）
export type SlackingAlertHandler = (
  entertainmentMs: number,
  thresholdMs: number,
) => void

let alertHandler: SlackingAlertHandler | null = null

export function onSlackingAlert(handler: SlackingAlertHandler): void {
  alertHandler = handler
}

// 检查是否应触发摸鱼提醒（今日娱乐时长超阈值，且今日未触发过）
// 由 TodayStatus 页面在拉取数据后调用
export function checkSlackingAlert(entertainmentMs: number): boolean {
  const cfg = loadSlackingConfig()
  if (!cfg.enabled) return false
  if (entertainmentMs < cfg.thresholdMs) return false
  const today = new Date().toISOString().slice(0, 10)
  if (cfg.lastTriggeredDate === today) return false
  // 触发
  if (alertHandler) {
    try {
      alertHandler(entertainmentMs, cfg.thresholdMs)
    } catch {
      /* ignore */
    }
  }
  saveSlackingConfig({ ...cfg, lastTriggeredDate: today })
  return true
}

// ---------- 便捷封装 ----------
// 检查使用情况访问权限
export async function hasUsagePermission(): Promise<boolean> {
  try {
    const r = await UsageStats.hasPermission()
    return r.granted
  } catch {
    return false
  }
}

export async function requestUsagePermission(): Promise<void> {
  try {
    await UsageStats.requestPermission()
  } catch {
    /* ignore */
  }
}

// 拉取今日使用统计 + 应用分类
export interface AggregatedUsage {
  totalMs: number
  items: Array<AppUsageItem & { category: AppCategory }>
  byCategory: Record<AppCategory, number>
}

export async function fetchTodayUsage(): Promise<AggregatedUsage | null> {
  let raw: RawUsageResult
  try {
    raw = await UsageStats.queryTodayStats()
  } catch {
    return null
  }
  if (!raw.ok || !raw.stats) return null
  const customMap = loadCategoryMap()
  const items = raw.stats
    .map((s) => ({
      ...s,
      category: getAppCategory(s.packageName, s.appName, customMap),
    }))
    .sort((a, b) => b.foregroundMs - a.foregroundMs)
  const byCategory: Record<AppCategory, number> = {
    study: 0,
    create: 0,
    entertainment: 0,
    tool: 0,
    other: 0,
  }
  for (const it of items) {
    byCategory[it.category] += it.foregroundMs
  }
  return {
    totalMs: raw.totalForegroundMs ?? 0,
    items,
    byCategory,
  }
}
