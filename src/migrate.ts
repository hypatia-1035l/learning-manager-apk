// 数据迁移与版本管理
//
// 集中处理 localStorage 中 AppData 的结构升级：
// - 通过 SCHEMA_VERSION 标识当前数据结构版本
// - migrateAppData 接收任意旧形态数据，逐版本向上迁移到最新结构
// - progressModel 推导、reminder 兼容、任务组字段补全等迁移逻辑统一收口于此
//
// 设计原则：
// - 迁移只补全/重组字段，不改变核心数据结构语义（Task/Sequence/LearningObject）
// - 旧字段（progress/progressUnit/progressTarget）保留并与 progressModel 双向同步
// - 新写入统一使用 progressModel 为主，旧字段仅作兼容

import type {
  AppData,
  AppEntry,
  Task,
  TaskGroup,
  GroupMode,
  LearningObject,
  ReminderConfig,
  StudyRecord,
  PlanDay,
  PlanItem,
} from './types'
import { DEFAULT_REMINDER } from './types'

// 当前数据结构版本：每次破坏性升级时 +1
// v2（2026-10-28）：越界管控由两态布尔升为三档（guardEnabled → guardLevel），
//   宽限时间改秒（guardGraceMinutes → guardGraceSeconds）；
//   删除 Task.blockedApps（旧值先备份到 BLOCKED_BACKUP_KEY）；
//   新增 AppData.globalAllowedApps（全局白名单，方向级 allowedApps 变为增量）。
export const CURRENT_SCHEMA_VERSION = 2

// 删除 blockedApps 前的整体备份键：不静默丢用户配置，需要时可从这里捞回
export const BLOCKED_BACKUP_KEY = 'learning-manager:data:v1-blocked-backup'
export const SCHEMA_VERSION_KEY = 'learning-manager:schema-version'

// ---------- 进度解析（迁移与学习会话共用） ----------
// 解析进度字符串为数字：支持 "卷五"→5、"第12集"→12、"3.5"→3.5
// 失败返回 NaN
export function parseProgressNumber(s: string): number {
  if (!s) return NaN
  const trimmed = s.trim()
  const direct = Number(trimmed)
  if (!isNaN(direct) && trimmed !== '') return direct
  const m = trimmed.match(/(\d+(?:\.\d+)?)/)
  if (m) return Number(m[1])
  const cnMap: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  }
  if (trimmed.length === 1 && cnMap[trimmed]) return cnMap[trimmed]
  if (trimmed.startsWith('十') && trimmed.length === 2) return 10 + (cnMap[trimmed[1]] ?? 0)
  if (trimmed.startsWith('廿') && trimmed.length === 2) return 20 + (cnMap[trimmed[1]] ?? 0)
  if (trimmed.length === 2 && cnMap[trimmed[0]]) {
    const a = cnMap[trimmed[0]]
    return trimmed[1] === '十' ? a * 10 : NaN
  }
  return NaN
}

// 由旧 LearningObject 字段推导进度模型（迁移用）：
//   - progressTarget 可解析为数字 → count 型
//   - 否则 → position 型（保留原文本）
export function deriveProgressModel(i: {
  progress: string
  progressUnit: string
  progressTarget: string
}): import('./types').SequenceProgress {
  const tgt = parseProgressNumber(i.progressTarget)
  if (i.progressTarget.trim() && !isNaN(tgt)) {
    const cur = parseProgressNumber(i.progress)
    return {
      type: 'count',
      current: isNaN(cur) ? 0 : cur,
      target: tgt,
      unit: i.progressUnit ?? '',
    }
  }
  return { type: 'position', text: i.progress ?? '' }
}

// ---------- 迁移：单个学习对象 ----------
function migrateLearningObject(i: LearningObject): LearningObject {
  const merged: LearningObject = {
    ...i,
    // 迁移：学习对象 weight（旧数据默认 1）
    weight:
      typeof (i as LearningObject & { weight?: number }).weight === 'number'
        ? (i as LearningObject & { weight?: number }).weight!
        : 1,
    // 迁移：学习对象 enabled（旧数据默认 true）
    enabled:
      typeof (i as LearningObject & { enabled?: boolean }).enabled === 'boolean'
        ? (i as LearningObject & { enabled?: boolean }).enabled!
        : true,
    // 迁移：进度目标和单位（旧数据无，默认空字符串）
    progressUnit:
      typeof (i as LearningObject & { progressUnit?: string }).progressUnit === 'string'
        ? (i as LearningObject & { progressUnit?: string }).progressUnit!
        : '',
    progressTarget:
      typeof (i as LearningObject & { progressTarget?: string }).progressTarget === 'string'
        ? (i as LearningObject & { progressTarget?: string }).progressTarget!
        : '',
  }
  // 迁移：推导进度模型 progressModel（数量型/位置型）
  // 已有 progressModel 的（新版本写入）保持不变
  if (!merged.progressModel) {
    merged.progressModel = deriveProgressModel(merged)
  }
  return merged
}

// ---------- 迁移：包名列表（方向应用名单） ----------
// 清洗为去重、去空白、去非字符串的 packageName 数组。
// 空数组与 undefined 语义相同：该方向没有允许的应用 → 默认全部禁止。
function sanitizePackageList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    const s = x.trim()
    if (!s || out.includes(s)) continue
    out.push(s)
  }
  return out
}

// ---------- 迁移：单个任务 ----------
function migrateTask(t: Task): Task {
  // 迁移：任务组模式（旧数据默认顺序接续）
  const group = t.group
    ? ({
        ...t.group,
        mode:
          (t.group as TaskGroup & { mode?: GroupMode }).mode ?? 'sequential',
        items: t.group.items.map(migrateLearningObject),
      } as TaskGroup)
    : t.group
  const next: Task & { blockedApps?: unknown } = {
    ...t,
    weight:
      typeof (t as Task & { weight?: number }).weight === 'number'
        ? (t as Task & { weight?: number }).weight!
        : 1,
    // 迁移：提醒星期（方向自带星期，空数组=每天）
    weekdays: Array.isArray(
      (t as Task & { weekdays?: number[] }).weekdays,
    )
      ? (t as Task & { weekdays?: number[] }).weekdays!.filter(
          (d) => typeof d === 'number' && d >= 0 && d <= 6,
        )
      : [],
    // 迁移：方向应用放行（增量，全局白名单之外额外放行的那部分）。旧数据无此字段 → 空数组。
    // 空数组 = 只用全局白名单；连全局也空 = 只有自动放行（本 App/桌面/输入法/拨号/系统界面）。
    allowedApps: sanitizePackageList((t as Task & { allowedApps?: unknown }).allowedApps),
    group,
  }
  // v2：blockedApps 已废弃，从内存对象里抹掉（原始值已在 migrateAppData 里备份）
  delete next.blockedApps
  return next
}

// ---------- 迁移：提醒配置 ----------
// 旧形态（dailyMode: interval/random/dailyCount + 全局星期/任务白名单 + 窗口独立绑定）
// → 新形态（唯一次日计划：planSessions + planTiming，星期由方向自带）
function migrateReminder(r: unknown): ReminderConfig {
  const rem = (r ?? {}) as Partial<ReminderConfig> & {
    // 旧字段
    dailyMode?: string
    dailyCount?: unknown
    enabledWeekdays?: unknown
    enabledTaskIds?: unknown
    intervalMinutes?: unknown
    cooldownMinutes?: unknown
    skipAfterSessionMinutes?: unknown
    planSessions?: unknown
    planTiming?: string
    windows?: Array<{
      startMinute?: unknown
      endMinute?: unknown
      taskIds?: unknown
      weekdays?: unknown
    }>
    startMinute?: number
    endMinute?: number
    startHour?: number
    endHour?: number
  }

  // 窗口：兼容旧数据（含每段 taskIds/weekdays，新形态直接丢弃）
  let windows: ReminderConfig['windows']
  if (Array.isArray(rem.windows) && rem.windows.length > 0) {
    windows = rem.windows
      .map((w) => ({
        startMinute: Math.min(1439, Math.max(0, Number(w.startMinute ?? 0) || 0)),
        endMinute: Math.min(1439, Math.max(0, Number(w.endMinute ?? 1439) || 0)),
      }))
      .slice(0, 4)
  } else {
    let startMinute = 9 * 60
    let endMinute = 22 * 60
    if (typeof rem.startMinute === 'number' && typeof rem.endMinute === 'number') {
      startMinute = rem.startMinute
      endMinute = rem.endMinute
    } else {
      if (typeof rem.startHour === 'number') startMinute = rem.startHour * 60
      if (typeof rem.endHour === 'number') endMinute = rem.endHour * 60
    }
    windows = [{ startMinute, endMinute }]
  }

  // 时刻分布：旧 interval 模式 → interval；random/dailyCount → random
  let planTiming: ReminderConfig['planTiming'] = 'random'
  if (rem.planTiming === 'interval' || rem.planTiming === 'random') {
    planTiming = rem.planTiming
  } else if (rem.dailyMode === 'interval') {
    planTiming = 'interval'
  }

  // 每日方向数：新字段优先，回退旧 dailyCount，再回退默认 4
  let planSessions = DEFAULT_REMINDER.planSessions
  if (typeof rem.planSessions === 'number') {
    planSessions = rem.planSessions
  } else if (typeof rem.dailyCount === 'number') {
    planSessions = rem.dailyCount
  }
  planSessions = Math.min(12, Math.max(1, Math.floor(planSessions) || 1))

  return {
    enabled: rem.enabled ?? false,
    planSessions,
    planTiming,
    intervalMinutes:
      typeof rem.intervalMinutes === 'number' && rem.intervalMinutes > 0
        ? Math.min(1440, Math.max(5, Math.floor(rem.intervalMinutes)))
        : DEFAULT_REMINDER.intervalMinutes,
    cooldownMinutes:
      typeof rem.cooldownMinutes === 'number' && rem.cooldownMinutes > 0
        ? Math.min(720, Math.max(1, Math.floor(rem.cooldownMinutes)))
        : DEFAULT_REMINDER.cooldownMinutes,
    windows,
    skipAfterSessionMinutes:
      typeof rem.skipAfterSessionMinutes === 'number'
        ? Math.min(720, Math.max(0, rem.skipAfterSessionMinutes))
        : DEFAULT_REMINDER.skipAfterSessionMinutes,
    deferMinutes:
      typeof rem.deferMinutes === 'number'
        ? Math.min(120, Math.max(0, Math.floor(rem.deferMinutes)))
        : DEFAULT_REMINDER.deferMinutes,
    // 回归提醒天数：0 = 关闭
    reengageDays:
      typeof rem.reengageDays === 'number'
        ? Math.min(14, Math.max(0, Math.floor(rem.reengageDays)))
        : DEFAULT_REMINDER.reengageDays,
    // 计划提前排程天数：1-7
    planLookaheadDays:
      typeof rem.planLookaheadDays === 'number'
        ? Math.min(7, Math.max(1, Math.floor(rem.planLookaheadDays)))
        : DEFAULT_REMINDER.planLookaheadDays,
    intensity:
      rem.intensity === 'strong' || rem.intensity === 'weak' || rem.intensity === 'silent'
        ? rem.intensity
        : DEFAULT_REMINDER.intensity,
    // 越界管控（三档，默认关）：旧数据只有 guardEnabled 布尔 →
    //   true = 'warn'（旧版本来就只提醒，不能擅自升级成会拉回的 'pull'）
    //   false/缺省 = 'off'
    guardLevel: migrateGuardLevel(rem),
    // 宽限时间：旧字段是分钟，×60 换成秒；旧值 5 分钟 = 300 秒，语义不变
    guardGraceSeconds: migrateGuardGraceSeconds(rem),
  }
}

// 旧 guardEnabled（布尔）→ 新 guardLevel（三档）。新字段优先。
function migrateGuardLevel(
  rem: Partial<ReminderConfig> & { guardEnabled?: unknown },
): ReminderConfig['guardLevel'] {
  const lv = rem.guardLevel
  if (lv === 'off' || lv === 'warn' || lv === 'pull') return lv
  return rem.guardEnabled === true ? 'warn' : 'off'
}

// 宽限时间：新字段（秒）优先；旧字段（分钟）×60；都没有则用默认值
function migrateGuardGraceSeconds(
  rem: Partial<ReminderConfig> & { guardGraceMinutes?: unknown },
): number {
  if (typeof rem.guardGraceSeconds === 'number' && Number.isFinite(rem.guardGraceSeconds)) {
    // 上限 10 分钟：再长就不叫「宽限」了，等于关掉
    return Math.min(600, Math.max(0, Math.floor(rem.guardGraceSeconds)))
  }
  if (typeof rem.guardGraceMinutes === 'number' && Number.isFinite(rem.guardGraceMinutes)) {
    return Math.min(600, Math.max(0, Math.floor(rem.guardGraceMinutes * 60)))
  }
  return DEFAULT_REMINDER.guardGraceSeconds ?? 5
}

// ---------- 迁移：单条学习记录 ----------
// 补全可选字段默认值，保证旧数据无 note 时读取安全（undefined 天然兼容）
function migrateRecord(r: unknown): StudyRecord {
  const rec = (r ?? {}) as Partial<StudyRecord> & {
    objectId?: string
    objectName?: string
  }
  return {
    id: rec.id ?? '',
    taskId: rec.taskId ?? '',
    taskName: rec.taskName ?? '',
    // 旧数据兼容：objectId/objectName 与 sequenceId/sequenceName 同值
    objectId: rec.objectId ?? rec.sequenceId ?? '',
    objectName: rec.objectName ?? rec.sequenceName ?? '',
    sequenceId: rec.sequenceId ?? rec.objectId,
    sequenceName: rec.sequenceName ?? rec.objectName,
    date: typeof rec.date === 'number' ? rec.date : 0,
    duration: typeof rec.duration === 'number' ? rec.duration : 0,
    startProgress: rec.startProgress ?? '',
    endProgress: rec.endProgress ?? '',
    deltaCount: rec.deltaCount,
    // 迁移：学习备注（旧数据无此字段），默认 undefined（不强制填空字符串）
    note: rec.note,
  }
}

// ---------- 迁移：单日计划 ----------
// 防御性规整字段；非法项丢弃
function migratePlanDay(p: unknown): PlanDay | null {
  const day = (p ?? {}) as Partial<PlanDay>
  if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return null
  const items: PlanItem[] = []
  if (Array.isArray(day.items)) {
    for (const it of day.items) {
      const item = (it ?? {}) as Partial<PlanItem>
      if (typeof item.id !== 'string' || typeof item.taskId !== 'string') continue
      const minute = Number(item.minuteOfDay)
      items.push({
        id: item.id,
        minuteOfDay: Number.isFinite(minute)
          ? Math.min(1439, Math.max(0, Math.floor(minute)))
          : 0,
        taskId: item.taskId,
        taskName: typeof item.taskName === 'string' ? item.taskName : '',
        sequenceId: typeof item.sequenceId === 'string' ? item.sequenceId : undefined,
        sequenceName: typeof item.sequenceName === 'string' ? item.sequenceName : undefined,
        durationSec:
          typeof item.durationSec === 'number' && item.durationSec > 0
            ? Math.floor(item.durationSec)
            : null,
        status: item.status === 'done' || item.status === 'skipped' ? item.status : 'pending',
        deferredAtMs:
          typeof item.deferredAtMs === 'number' && Number.isFinite(item.deferredAtMs)
            ? item.deferredAtMs
            : undefined,
        manual: item.manual === true ? true : undefined,
        carriedFrom: typeof item.carriedFrom === 'string' ? item.carriedFrom : undefined,
        remindOnly: item.remindOnly === true ? true : undefined,
        // 固定任务标记：漏掉它会导致每次启动后 removePinnedItems 匹配不到固定项，
        // 取消固定时残留「已固定」的计划条目。
        pinned: item.pinned === true ? true : undefined,
      })
    }
  }
  return {
    date: day.date,
    items,
    generatedAt: typeof day.generatedAt === 'number' ? day.generatedAt : Date.now(),
  }
}

// v2：删除 Task.blockedApps 前，把旧值整体 dump 到备份键。
// 只写一次（已有备份则不覆盖），保证「最早那份用户配置」不会被后续启动冲掉。
function backupBlockedApps(rawTasks: unknown): void {
  try {
    const out: Array<{ taskId: string; taskName: string; blockedApps: string[] }> = []
    if (Array.isArray(rawTasks)) {
      for (const raw of rawTasks) {
        const t = (raw ?? {}) as { id?: unknown; name?: unknown; blockedApps?: unknown }
        const list = sanitizePackageList(t.blockedApps)
        if (!list.length) continue
        out.push({
          taskId: typeof t.id === 'string' ? t.id : '',
          taskName: typeof t.name === 'string' ? t.name : '',
          blockedApps: list,
        })
      }
    }
    if (!out.length) return
    if (localStorage.getItem(BLOCKED_BACKUP_KEY)) return
    localStorage.setItem(
      BLOCKED_BACKUP_KEY,
      JSON.stringify({ savedAt: Date.now(), fromSchema: 1, tasks: out }),
    )
  } catch {
    /* ignore：备份失败不阻断迁移 */
  }
}

// ---------- 主迁移入口 ----------
// 接收从 localStorage 读出的原始数据（形态未知），迁移为最新 AppData 结构
export function migrateAppData(raw: unknown): AppData {
  const parsed = (raw ?? {}) as Partial<AppData>
  // v2：先把旧的 blockedApps 备份走，再让 migrateTask 把它抹掉
  backupBlockedApps(parsed.tasks)
  const tasks = (parsed.tasks ?? []).map(migrateTask)
  const records = (parsed.records ?? []).map(migrateRecord)
  const reminder = parsed.reminder
    ? migrateReminder(parsed.reminder)
    : { ...DEFAULT_REMINDER }
  const plans = (parsed.plans ?? [])
    .map(migratePlanDay)
    .filter((p): p is PlanDay => p !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const pinnedTasks = Array.isArray(parsed.pinnedTasks)
    ? parsed.pinnedTasks
        .filter(
          (p): p is { taskId: string; sequenceId?: string } =>
            !!p &&
            typeof p.taskId === 'string' &&
            (p.sequenceId === undefined || typeof p.sequenceId === 'string'),
        )
        .map((p) => ({ taskId: p.taskId, sequenceId: p.sequenceId }))
    : []
  // 应用池：按包名去重，清洗非法条目（只存元数据，不带策略立场）
  const poolSeen = new Set<string>()
  const appPool: AppEntry[] = []
  if (Array.isArray(parsed.appPool)) {
    for (const raw of parsed.appPool) {
      const e = (raw ?? {}) as Partial<AppEntry>
      if (typeof e.packageName !== 'string') continue
      const pkg = e.packageName.trim()
      if (!pkg || poolSeen.has(pkg)) continue
      poolSeen.add(pkg)
      appPool.push({
        packageName: pkg,
        appName: typeof e.appName === 'string' && e.appName.trim() ? e.appName : pkg,
      })
    }
  }
  // 兼容修复：旧版本的 migratePlanDay 会丢弃 PlanItem.pinned，已存在的固定项因此
  // 失去标记（表现为取消固定后计划里残留该条目）。这里按 pinnedTasks 反向补回标记。
  if (pinnedTasks.length > 0) {
    const keyOf = (taskId: string, seqId?: string) => `${taskId}|${seqId ?? ''}`
    const pinnedKeys = new Set(
      pinnedTasks.map((p) => keyOf(p.taskId, p.sequenceId)),
    )
    for (const day of plans) {
      let touched = false
      const items = day.items.map((it) => {
        if (it.pinned || it.status !== 'pending') return it
        if (!pinnedKeys.has(keyOf(it.taskId, it.sequenceId))) return it
        touched = true
        return { ...it, pinned: true }
      })
      if (touched) day.items = items
    }
  }
  return {
    tasks,
    records,
    reminder,
    plans,
    pinnedTasks,
    appPool,
    // v2：全局白名单（旧数据没有 → 空数组，等价于只用自动放行）
    globalAllowedApps: sanitizePackageList(parsed.globalAllowedApps),
  }
}

// 读取并标记当前 schema 版本（持久化最新版本号，便于后续升级判定）
export function readSchemaVersion(): number {
  try {
    const v = Number(localStorage.getItem(SCHEMA_VERSION_KEY))
    return isNaN(v) || v < 0 ? 0 : v
  } catch {
    return 0
  }
}

export function writeSchemaVersion(v: number = CURRENT_SCHEMA_VERSION): void {
  try {
    localStorage.setItem(SCHEMA_VERSION_KEY, String(v))
  } catch {
    /* ignore */
  }
}
