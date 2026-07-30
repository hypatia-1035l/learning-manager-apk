// 摸鱼检测规则模块 - 服务层
// 只读取统计数据并生成提醒，不修改任务/学习/随机/计时逻辑
import { LocalNotifications } from '@capacitor/local-notifications'
import { getContinueTask } from './store'
import { fetchTodayUsage, hasUsagePermission } from './usageStatsService'
import type { Task, StudyRecord } from './types'
import type {
  SlackingRulesConfig,
  SlackingRule,
  SlackingContext,
  SlackingEvaluation,
} from './slackingRulesTypes'
import { DEFAULT_SLACKING_RULES_CONFIG } from './slackingRulesTypes'

// re-export 类型供外部使用
export type { SlackingEvaluation, SlackingRulesConfig, SlackingRule, SlackingContext }

// 独立存储 key（不污染学习记录、任务数据、应用使用统计数据）
const SLACKING_RULES_KEY = 'learning-manager:slacking-rules:v1'

// 通知 ID 命名空间：1000 起步，避免与 reminderService（1-100）冲突
const NOTIF_ID_SLACKING = 1000

// ---------- 存储 ----------
export function loadSlackingRulesConfig(): SlackingRulesConfig {
  try {
    const raw = localStorage.getItem(SLACKING_RULES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SLACKING_RULES_CONFIG, ...parsed }
    }
  } catch {
    /* ignore */
  }
  return {
    ...DEFAULT_SLACKING_RULES_CONFIG,
    rules: DEFAULT_SLACKING_RULES_CONFIG.rules.map((r) => ({ ...r })),
  }
}

export function saveSlackingRulesConfig(cfg: SlackingRulesConfig): void {
  try {
    localStorage.setItem(SLACKING_RULES_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

// ---------- 规则 CRUD ----------
export function addRule(
  cfg: SlackingRulesConfig,
  rule: SlackingRule,
): SlackingRulesConfig {
  const newCfg = { ...cfg, rules: [...cfg.rules, rule] }
  saveSlackingRulesConfig(newCfg)
  return newCfg
}

export function updateRule(
  cfg: SlackingRulesConfig,
  rule: SlackingRule,
): SlackingRulesConfig {
  const newCfg = {
    ...cfg,
    rules: cfg.rules.map((r) => (r.id === rule.id ? rule : r)),
  }
  saveSlackingRulesConfig(newCfg)
  return newCfg
}

export function removeRule(
  cfg: SlackingRulesConfig,
  ruleId: string,
): SlackingRulesConfig {
  const newCfg = {
    ...cfg,
    rules: cfg.rules.filter((r) => r.id !== ruleId),
  }
  saveSlackingRulesConfig(newCfg)
  return newCfg
}

// ---------- 评估上下文构建 ----------
// 读取今日使用统计 + 学习记录，构建评估上下文
export async function buildContext(
  tasks: Task[],
  records: StudyRecord[],
): Promise<SlackingContext | null> {
  const hasPerm = await hasUsagePermission()
  if (!hasPerm) return null
  const usage = await fetchTodayUsage()
  if (!usage) return null

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const hasStudyToday = records.some((r) => r.date >= todayStart.getTime())

  const continueTask = getContinueTask(tasks, records)

  // 找娱乐类应用中时长最长的
  const entApps = usage.items.filter((it) => it.category === 'entertainment')
  const topEnt = entApps.length > 0 ? entApps[0] : undefined

  return {
    totalMs: usage.totalMs,
    entertainmentMs: usage.byCategory.entertainment,
    topEntertainmentApp: topEnt
      ? {
          packageName: topEnt.packageName,
          appName: topEnt.appName,
          foregroundMs: topEnt.foregroundMs,
        }
      : undefined,
    hasStudyToday,
    continueTaskId: continueTask?.id ?? null,
  }
}

// ---------- 规则评估 ----------
// 评估所有规则，返回是否触发及触发原因
export function evaluateRules(
  cfg: SlackingRulesConfig,
  ctx: SlackingContext,
): SlackingEvaluation {
  const noTrigger: SlackingEvaluation = {
    shouldTrigger: false,
    situation: 'entertainment_too_long',
    reason: '',
    recommendedTaskId: null,
  }

  if (!cfg.enabled) return noTrigger

  // 冷却检查：冷却期内不重复提醒
  if (cfg.lastTriggeredAt) {
    const elapsed = Date.now() - cfg.lastTriggeredAt
    if (elapsed < cfg.cooldownMs) return noTrigger
  }

  // 按规则类型逐条评估
  for (const rule of cfg.rules) {
    if (!rule.enabled) continue
    const result = evaluateRule(rule, ctx)
    if (result.shouldTrigger) return result
  }

  // 附加情境：今日无学习记录（仅在娱乐时长有一定量时才提醒，避免刚开手机就提醒）
  if (!ctx.hasStudyToday && ctx.entertainmentMs > 30 * 60 * 1000) {
    return {
      shouldTrigger: true,
      situation: 'no_study_today',
      reason: '今天还没有学习记录',
      recommendedTaskId: ctx.continueTaskId,
    }
  }

  // 附加情境：任务中断（有进行中任务但今日无学习记录）
  if (ctx.continueTaskId && !ctx.hasStudyToday && ctx.entertainmentMs > 0) {
    return {
      shouldTrigger: true,
      situation: 'task_interrupted',
      reason: '上次任务还没完成',
      recommendedTaskId: ctx.continueTaskId,
    }
  }

  return noTrigger
}

// 评估单条规则
function evaluateRule(
  rule: SlackingRule,
  ctx: SlackingContext,
): SlackingEvaluation {
  const noTrigger: SlackingEvaluation = {
    shouldTrigger: false,
    situation: 'entertainment_too_long',
    reason: '',
    recommendedTaskId: null,
  }

  switch (rule.type) {
    case 'single_app': {
      // 单应用时长规则
      if (rule.packageName) {
        // 指定包名：与 topEntertainmentApp 匹配
        if (
          ctx.topEntertainmentApp?.packageName === rule.packageName &&
          ctx.topEntertainmentApp.foregroundMs >= rule.thresholdMs
        ) {
          return {
            shouldTrigger: true,
            rule,
            situation: 'single_app_too_long',
            reason: `${ctx.topEntertainmentApp.appName} 已使用 ${formatMs(ctx.topEntertainmentApp.foregroundMs)}`,
            recommendedTaskId: ctx.continueTaskId,
          }
        }
      } else {
        // 任意娱乐应用
        if (
          ctx.topEntertainmentApp &&
          ctx.topEntertainmentApp.foregroundMs >= rule.thresholdMs
        ) {
          return {
            shouldTrigger: true,
            rule,
            situation: 'single_app_too_long',
            reason: `${ctx.topEntertainmentApp.appName} 已使用 ${formatMs(ctx.topEntertainmentApp.foregroundMs)}`,
            recommendedTaskId: ctx.continueTaskId,
          }
        }
      }
      return noTrigger
    }

    case 'entertainment_total': {
      if (ctx.entertainmentMs >= rule.thresholdMs) {
        return {
          shouldTrigger: true,
          rule,
          situation: 'entertainment_too_long',
          reason: `今日娱乐累计 ${formatMs(ctx.entertainmentMs)}`,
          recommendedTaskId: ctx.continueTaskId,
        }
      }
      return noTrigger
    }

    case 'continuous': {
      // 连续使用规则：近似为单个娱乐应用前台时长超过阈值
      // 原生 UsageStatsManager 只提供总时长，不提供事件序列，故用总时长近似
      if (
        ctx.topEntertainmentApp &&
        ctx.topEntertainmentApp.foregroundMs >= rule.thresholdMs
      ) {
        return {
          shouldTrigger: true,
          rule,
          situation: 'continuous_use',
          reason: `连续使用 ${ctx.topEntertainmentApp.appName} 约 ${formatMs(ctx.topEntertainmentApp.foregroundMs)}`,
          recommendedTaskId: ctx.continueTaskId,
        }
      }
      return noTrigger
    }

    default:
      return noTrigger
  }
}

// ---------- 提醒文案 ----------
export function buildSlackingMessage(evaluation: SlackingEvaluation): string {
  const { situation, reason } = evaluation
  switch (situation) {
    case 'single_app_too_long':
      return `已经摸了一会儿鱼（${reason}），要不要捞一条任务？`
    case 'entertainment_too_long':
      return `${reason}，要不要开始一个任务？`
    case 'continuous_use':
      return `${reason}，要不要换换脑子捞条鱼？`
    case 'no_study_today':
      return '今天还没有开始，随机捞一个？'
    case 'task_interrupted':
      return '上次任务还没完成，要继续吗？'
    default:
      return '要不要捞一条鱼？'
  }
}

// ---------- 触发提醒（发送通知） ----------
export async function triggerSlackingReminder(
  evaluation: SlackingEvaluation,
): Promise<void> {
  const body = buildSlackingMessage(evaluation)
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIF_ID_SLACKING,
          title: '今天摸啥鱼',
          body,
          schedule: { at: new Date(Date.now() + 1000) }, // 1 秒后触发
          extra: {
            action: 'slacking', // 标识摸鱼通知
            taskId: evaluation.recommendedTaskId,
            randomStart: !evaluation.recommendedTaskId, // 无推荐任务时触发随机
          },
        },
      ],
    })
  } catch {
    /* ignore */
  }
}

// ---------- 检测入口 ----------
// 组合：拉取数据 → 评估 → 发送通知
// silent=true：前台轮询/切回时用，只评估不发通知，由调用方显示提醒卡片
export async function runSlackingDetection(
  tasks: Task[],
  records: StudyRecord[],
  silent: boolean = false,
): Promise<SlackingEvaluation | null> {
  const cfg = loadSlackingRulesConfig()
  if (!cfg.enabled) return null

  const ctx = await buildContext(tasks, records)
  if (!ctx) return null

  const evaluation = evaluateRules(cfg, ctx)
  if (!evaluation.shouldTrigger) return null

  // 更新最后触发时间（冷却计时起点）
  saveSlackingRulesConfig({
    ...cfg,
    lastTriggeredAt: Date.now(),
  })

  // silent 模式不发通知，由调用方自行显示提醒卡片
  if (!silent) {
    await triggerSlackingReminder(evaluation)
  }

  return evaluation
}

// 取消摸鱼通知
export async function cancelSlackingNotification(): Promise<void> {
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: NOTIF_ID_SLACKING }],
    })
  } catch {
    /* ignore */
  }
}

// ---------- 工具 ----------
// 毫秒 → "1小时20分钟" / "45分钟"
function formatMs(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}小时${m > 0 ? `${m}分钟` : ''}`
  return `${m}分钟`
}
