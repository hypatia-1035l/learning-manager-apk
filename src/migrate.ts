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
  Task,
  TaskGroup,
  GroupMode,
  LearningObject,
  ReminderConfig,
  StudyRecord,
} from './types'
import { DEFAULT_REMINDER } from './types'

// 当前数据结构版本：每次破坏性升级时 +1
export const CURRENT_SCHEMA_VERSION = 1
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
  return {
    ...t,
    randomEnabled:
      typeof (t as Task & { randomEnabled?: boolean }).randomEnabled === 'boolean'
        ? (t as Task & { randomEnabled?: boolean }).randomEnabled!
        : true,
    weight:
      typeof (t as Task & { weight?: number }).weight === 'number'
        ? (t as Task & { weight?: number }).weight!
        : 1,
    group,
  }
}

// ---------- 迁移：提醒配置 ----------
// 时间窗兼容：旧数据仅有 startHour/endHour（小时精度），迁移为分钟精度
function migrateReminder(r: unknown): ReminderConfig {
  const rem = (r ?? {}) as Partial<ReminderConfig> & {
    cooldownMinutes?: number
    startHour?: number
    endHour?: number
  }
  // 分钟精度：优先用新字段，回退到旧 startHour/endHour*60，再回退到默认
  const startMinute =
    typeof rem.startMinute === 'number'
      ? rem.startMinute
      : typeof rem.startHour === 'number'
        ? rem.startHour * 60
        : 9 * 60
  const endMinute =
    typeof rem.endMinute === 'number'
      ? rem.endMinute
      : typeof rem.endHour === 'number'
        ? rem.endHour * 60
        : 22 * 60
  return {
    enabled: rem.enabled ?? false,
    intervalMinutes: rem.intervalMinutes ?? 0,
    // 迁移：旧 reminder 可能无 cooldownMinutes 字段，默认 30
    cooldownMinutes: rem.cooldownMinutes ?? 30,
    startMinute: Math.min(1439, Math.max(0, startMinute)),
    endMinute: Math.min(1439, Math.max(0, endMinute)),
    enabledTaskIds: rem.enabledTaskIds ?? [],
  }
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

// ---------- 主迁移入口 ----------
// 接收从 localStorage 读出的原始数据（形态未知），迁移为最新 AppData 结构
export function migrateAppData(raw: unknown): AppData {
  const parsed = (raw ?? {}) as Partial<AppData>
  const tasks = (parsed.tasks ?? []).map(migrateTask)
  const records = (parsed.records ?? []).map(migrateRecord)
  const reminder = parsed.reminder
    ? migrateReminder(parsed.reminder)
    : { ...DEFAULT_REMINDER }
  return { tasks, records, reminder }
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
