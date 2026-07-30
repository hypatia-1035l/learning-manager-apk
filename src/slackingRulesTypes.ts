// 摸鱼检测规则模块 - 数据结构
// 独立于任务系统、学习会话、随机工具箱、应用使用统计数据结构
// 本模块只读取统计数据并生成提醒

// 规则类型
export type SlackingRuleType = 'single_app' | 'entertainment_total' | 'continuous'

// 触发情境（用于生成提醒文案）
export type SlackingSituation =
  | 'single_app_too_long' // 单应用时长过长
  | 'entertainment_too_long' // 娱乐总时长过长
  | 'continuous_use' // 连续使用娱乐应用
  | 'no_study_today' // 今日无学习记录
  | 'task_interrupted' // 任务中断未完成

// 单条规则
export interface SlackingRule {
  id: string
  type: SlackingRuleType
  enabled: boolean
  // 单应用规则：指定包名（空表示任意娱乐应用）
  packageName?: string
  appName?: string // 仅用于显示
  // 阈值（毫秒）
  thresholdMs: number
  // 自定义提醒文案（空则用默认）
  message?: string
}

// 规则配置（整体）
export interface SlackingRulesConfig {
  enabled: boolean // 总开关
  rules: SlackingRule[]
  cooldownMs: number // 冷却时间（毫秒）
  lastTriggeredAt?: number // 上次触发时间戳
}

// 评估上下文（由统计数据 + 学习记录构建）
export interface SlackingContext {
  totalMs: number
  entertainmentMs: number
  topEntertainmentApp?: {
    packageName: string
    appName: string
    foregroundMs: number
  }
  hasStudyToday: boolean
  continueTaskId: string | null
}

// 评估结果
export interface SlackingEvaluation {
  shouldTrigger: boolean
  rule?: SlackingRule
  situation: SlackingSituation
  reason: string
  recommendedTaskId: string | null
}

export const RULE_TYPE_LABELS: Record<SlackingRuleType, string> = {
  single_app: '单应用时长',
  entertainment_total: '娱乐总时长',
  continuous: '连续使用',
}

export const RULE_TYPE_DESCRIPTIONS: Record<SlackingRuleType, string> = {
  single_app: '任意娱乐应用前台时长超过阈值时触发',
  entertainment_total: '今日娱乐类应用总时长超过阈值时触发',
  continuous: '单个娱乐应用前台时长超过阈值时触发（近似连续使用）',
}

export const DEFAULT_SLACKING_RULES_CONFIG: SlackingRulesConfig = {
  enabled: false,
  cooldownMs: 30 * 60 * 1000, // 30 分钟
  rules: [
    {
      id: 'default-single',
      type: 'single_app',
      enabled: true,
      thresholdMs: 60 * 60 * 1000, // 1 小时
    },
    {
      id: 'default-entertainment',
      type: 'entertainment_total',
      enabled: true,
      thresholdMs: 2 * 60 * 60 * 1000, // 2 小时
    },
    {
      id: 'default-continuous',
      type: 'continuous',
      enabled: true,
      thresholdMs: 45 * 60 * 1000, // 45 分钟
    },
  ],
}

// 规则预设模板（一键导入常用规则）
export interface SlackingRulePreset {
  label: string
  description: string
  rule: Omit<SlackingRule, 'id'>
}

export const SLACKING_RULE_PRESETS: SlackingRulePreset[] = [
  {
    label: '娱乐超 2h',
    description: '今日娱乐类应用累计超过 2 小时',
    rule: {
      type: 'entertainment_total',
      enabled: true,
      thresholdMs: 2 * 60 * 60 * 1000,
    },
  },
  {
    label: '单应用超 1h',
    description: '任意娱乐应用前台超过 1 小时',
    rule: {
      type: 'single_app',
      enabled: true,
      thresholdMs: 60 * 60 * 1000,
    },
  },
  {
    label: '连续刷 45min',
    description: '单个娱乐应用前台超过 45 分钟',
    rule: {
      type: 'continuous',
      enabled: true,
      thresholdMs: 45 * 60 * 1000,
    },
  },
  {
    label: '娱乐超 3h',
    description: '今日娱乐类应用累计超过 3 小时',
    rule: {
      type: 'entertainment_total',
      enabled: true,
      thresholdMs: 3 * 60 * 60 * 1000,
    },
  },
]
