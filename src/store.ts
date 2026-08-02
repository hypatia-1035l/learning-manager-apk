import { useSyncExternalStore } from 'react'
import type {
  AppData,
  Task,
  TaskStatus,
  TaskGroup,
  GroupMode,
  LearningObject,
  Sequence,
  SequenceProgress,
  StudyRecord,
  ReminderConfig,
} from './types'
import { DEFAULT_REMINDER } from './types'
import {
  parseProgressNumber,
  deriveProgressModel,
  migrateAppData,
  writeSchemaVersion,
  CURRENT_SCHEMA_VERSION,
} from './migrate'

const STORAGE_KEY = 'learning-manager:data:v1'

// ---------- 基础工具 ----------
const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// ---------- 进度解析（迁移与学习会话共用） ----------
// parseProgressNumber / deriveProgressModel 已迁移至 ./migrate.ts，此处按需 import

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 统一走 migrateAppData：处理字段补全 / progressModel 推导 / reminder 兼容
      const data = migrateAppData(parsed)
      // 标记当前 schema 版本，便于后续升级判定
      writeSchemaVersion(CURRENT_SCHEMA_VERSION)
      return data
    }
  } catch {
    /* ignore */
  }
  return { tasks: [], records: [], reminder: { ...DEFAULT_REMINDER } }
}

// ---------- 响应式 store ----------
let state: AppData = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore quota */
  }
}

function setState(updater: (prev: AppData) => AppData) {
  state = updater(state)
  persist()
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot() {
  return state
}

// 供组件订阅
export function useAppData(): AppData {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// ---------- ID 生成 ----------
export const newId = uid

// ---------- 任务池 / 任务 CRUD ----------
export function createTask(input: {
  name: string
  icon: string
  // 可选：初始学习序列名称列表（从模板创建时用），创建后逐个生成空进度的序列
  sequenceNames?: string[]
}): Task {
  const now = Date.now()
  // 预置序列：空进度、未完成、启用，第一个作为 currentObjectId
  const items: LearningObject[] = (input.sequenceNames ?? []).map((n) => ({
    id: uid(),
    name: n.trim() || '未命名',
    progress: '',
    progressUnit: '',
    progressTarget: '',
    completed: false,
    enabled: true,
    weight: 1,
    countdownSeconds: null,
    progressModel: { type: 'position', text: '' },
  }))
  const group: TaskGroup | null =
    items.length > 0
      ? { id: uid(), name: '默认序列', mode: 'sequential', items }
      : null
  const task: Task = {
    id: uid(),
    name: input.name.trim() || '未命名任务',
    icon: input.icon,
    status: 'not_started',
    enabled: true,
    randomEnabled: true,
    weight: 1,
    group,
    currentObjectId: items[0]?.id ?? null,
    totalStudyTime: 0,
    createdAt: now,
    updatedAt: now,
  }
  setState((prev) => ({ ...prev, tasks: [...prev.tasks, task] }))
  return task
}

export function updateTask(id: string, patch: Partial<Task>) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) =>
      t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
    ),
  }))
}

export function deleteTask(id: string) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.filter((t) => t.id !== id),
    records: prev.records.filter((r) => r.taskId !== id),
  }))
}

export function setTaskEnabled(id: string, enabled: boolean) {
  updateTask(id, { enabled })
}

// 是否参与随机选择
export function setTaskRandomEnabled(id: string, randomEnabled: boolean) {
  updateTask(id, { randomEnabled })
}

// 随机权重（加权随机预留）
export function setTaskWeight(id: string, weight: number) {
  const w = Math.max(0, Math.floor(weight || 0))
  updateTask(id, { weight: w })
}

export function setTaskStatus(id: string, status: TaskStatus) {
  updateTask(id, { status })
}

// ---------- 当前学习对象 ----------
// 取得任务当前的学习对象（若存在）
export function getCurrentObject(task: Task): LearningObject | null {
  if (!task.group || !task.currentObjectId) return null
  return task.group.items.find((i) => i.id === task.currentObjectId) ?? null
}

// 取得任务当前的学习序列（语义别名）
export function getCurrentSequence(task: Task): Sequence | null {
  return getCurrentObject(task)
}

// 读取序列进度模型（缺省时按旧字段推导，保证旧数据可用）
export function getSequenceProgress(obj: LearningObject): SequenceProgress {
  if (obj.progressModel) return obj.progressModel
  return deriveProgressModel(obj)
}

// 根据当前进度数字查找匹配的进度节点名（目录名/篇目名）
// 返回 current >= node.at 的最后一个节点（按 at 升序），没有则返回 null
export function getCurrentNodeLabel(obj: LearningObject): string | null {
  if (!obj.progressNodes || obj.progressNodes.length === 0) return null
  const p = getSequenceProgress(obj)
  if (p.type !== 'count') return null
  const sorted = [...obj.progressNodes].sort((a, b) => a.at - b.at)
  let label: string | null = null
  for (const node of sorted) {
    if (p.current >= node.at) label = node.label
    else break
  }
  return label
}

// 把序列进度格式化为展示文本：
//   count 型  -> "350 / 1000 条"（无目标时仅显示当前）；有节点时追加 "· 节点名"
//   position 型 -> 原文本
export function formatSequenceProgress(obj: LearningObject): string {
  const p = getSequenceProgress(obj)
  if (p.type === 'count') {
    const unit = p.unit ? ` ${p.unit}` : ''
    const base = p.target > 0 ? `${p.current} / ${p.target}${unit}` : `${p.current}${unit}`
    const nodeLabel = getCurrentNodeLabel(obj)
    return nodeLabel ? `${base} · ${nodeLabel}` : base
  }
  return p.text || '尚未记录'
}

// 选择任务下要学习/提醒的序列：
//   - 优先返回当前序列（若存在且未完成且启用）
//   - 否则按 group.mode 从未完成序列中选择
//   - 全部完成返回 null
// 复用 pickNextObject 的接续规则，保持原随机算法不变。
export function pickSequence(task: Task): Sequence | null {
  if (!task.group || !task.group.items.length) return null
  const items = task.group.items
  const mode: GroupMode = task.group.mode ?? 'sequential'
  const cur = getCurrentSequence(task)
  if (cur && !cur.completed && cur.enabled) return cur
  const nextId = pickNextObject(items, task.currentObjectId, mode)
  if (!nextId) return null
  return items.find((i) => i.id === nextId) ?? null
}

// ---------- 任务组操作 ----------

export function setGroupMode(taskId: string, mode: GroupMode) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) => {
      if (t.id !== taskId) return t
      const group: TaskGroup = t.group ?? {
        id: uid(),
        name: t.name,
        mode: 'sequential',
        items: [],
      }
      return { ...t, group: { ...group, mode }, updatedAt: Date.now() }
    }),
  }))
}

// 添加学习对象；若任务尚无任务组，则同时创建组
export function addLearningObject(
  taskId: string,
  input: {
    name: string
    progress?: string
    progressUnit?: string
    progressTarget?: string
    countdownSeconds?: number | null
  },
) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) => {
      if (t.id !== taskId) return t
      const obj: LearningObject = {
        id: uid(),
        name: input.name.trim() || '未命名',
        progress: input.progress ?? '',
        progressUnit: input.progressUnit ?? '',
        progressTarget: input.progressTarget ?? '',
        completed: false,
        enabled: true,
        weight: 1,
        countdownSeconds: input.countdownSeconds ?? null,
        // 推导进度模型：有数字目标→count 型；否则 position 型
        progressModel: deriveProgressModel({
          progress: input.progress ?? '',
          progressUnit: input.progressUnit ?? '',
          progressTarget: input.progressTarget ?? '',
        }),
      }
      const group: TaskGroup = t.group ?? {
        id: uid(),
        name: t.name,
        mode: 'sequential',
        items: [],
      }
      const items = [...group.items, obj]
      // 若尚无当前对象，自动设为新增项
      const currentObjectId = t.currentObjectId ?? obj.id
      return {
        ...t,
        group: { ...group, items },
        currentObjectId,
        status: t.status === 'not_started' ? 'in_progress' : t.status,
        updatedAt: Date.now(),
      }
    }),
  }))
}

export function updateLearningObject(
  taskId: string,
  objectId: string,
  patch: Partial<LearningObject>,
) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) => {
      if (t.id !== taskId || !t.group) return t
      return {
        ...t,
        group: {
          ...t.group,
          items: t.group.items.map((i) => {
            if (i.id !== objectId) return i
            const merged: LearningObject = { ...i, ...patch }
            // 当进度相关旧字段被修改时，重新推导 progressModel（保持一致）
            // 注：显式传入 progressModel 时不覆盖
            if (
              'progress' in patch ||
              'progressUnit' in patch ||
              'progressTarget' in patch
            ) {
              if (!('progressModel' in patch)) {
                merged.progressModel = deriveProgressModel(merged)
              }
            }
            // 反向同步：显式传入 progressModel 时，同步推导旧字段
            // 保证 4 个字段（progress/progressUnit/progressTarget/progressModel）始终一致
            if (patch.progressModel) {
              const m = patch.progressModel
              if (m.type === 'count') {
                merged.progress = String(m.current)
                merged.progressUnit = m.unit
                merged.progressTarget = String(m.target)
              } else {
                merged.progress = m.text
                // position 型不强制清空 unit/target（保留旧值兼容旧读取路径）
              }
            }
            return merged
          }),
        },
        updatedAt: Date.now(),
      }
    }),
  }))
}

export function deleteLearningObject(taskId: string, objectId: string) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) => {
      if (t.id !== taskId || !t.group) return t
      const items = t.group.items.filter((i) => i.id !== objectId)
      let currentObjectId = t.currentObjectId
      if (currentObjectId === objectId) {
        currentObjectId = items.length ? items[0].id : null
      }
      return {
        ...t,
        group: { ...t.group, items },
        currentObjectId,
        updatedAt: Date.now(),
      }
    }),
  }))
}

// 调整顺序：将某项上移/下移
export function moveLearningObject(
  taskId: string,
  objectId: string,
  direction: 'up' | 'down',
) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) => {
      if (t.id !== taskId || !t.group) return t
      const items = [...t.group.items]
      const idx = items.findIndex((i) => i.id === objectId)
      if (idx < 0) return t
      const target = direction === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= items.length) return t
      ;[items[idx], items[target]] = [items[target], items[idx]]
      return { ...t, group: { ...t.group, items }, updatedAt: Date.now() }
    }),
  }))
}

// 设为当前学习对象
export function setCurrentObject(taskId: string, objectId: string) {
  updateTask(taskId, { currentObjectId: objectId })
}

// ---------- 选择下一学习对象 ----------
// 根据任务组模式，从「未完成对象」中选择下一项
// - sequential：当前项之后的第一个未完成项；没有则回退到首个未完成项
// - random：等概率随机选一个未完成项
// - weighted_random：按 weight 加权随机（weight<=0 不参与）
// 仅从未完成对象中选；全部完成返回 null
export function pickNextObject(
  items: LearningObject[],
  currentId: string | null,
  mode: GroupMode,
): string | null {
  const remaining = items.filter((i) => !i.completed && i.enabled)
  if (remaining.length === 0) return null

  if (mode === 'random') {
    const idx = Math.floor(Math.random() * remaining.length)
    return remaining[idx].id
  }

  if (mode === 'weighted_random') {
    const weighted = remaining.filter((i) => i.weight > 0)
    // 全部权重为 0：退化为等概率随机
    if (weighted.length === 0) {
      const idx = Math.floor(Math.random() * remaining.length)
      return remaining[idx].id
    }
    const total = weighted.reduce((s, i) => s + i.weight, 0)
    let r = Math.random() * total
    for (const i of weighted) {
      r -= i.weight
      if (r <= 0) return i.id
    }
    return weighted[weighted.length - 1].id
  }

  // sequential（默认）
  if (currentId) {
    const curIdx = items.findIndex((i) => i.id === currentId)
    for (let k = curIdx + 1; k < items.length; k++) {
      if (!items[k].completed) return items[k].id
    }
  }
  // 回退：首个未完成项
  return remaining[0].id
}

// ---------- 完成学习对象 + 自动接续 ----------
// 完成当前对象后，按任务组 mode 选择下一对象：
//   sequential / random / weighted_random
// 不修改任务列表顺序、不删除已完成状态，仅影响下一次接续选择。
export function completeCurrentObject(taskId: string) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) => {
      if (t.id !== taskId || !t.group) return t
      const items = t.group.items.map((i) =>
        i.id === t.currentObjectId ? { ...i, completed: true } : i,
      )
      const mode: GroupMode = t.group.mode ?? 'sequential'
      const nextId = pickNextObject(items, t.currentObjectId, mode)
      const allDone = items.every((i) => i.completed)
      return {
        ...t,
        group: { ...t.group, items },
        currentObjectId: nextId,
        status: allDone ? 'completed' : 'in_progress',
        updatedAt: Date.now(),
      }
    }),
  }))
}

// ---------- 学习会话：计时 + 记录 ----------
// 注：parseProgressNumber 已提升至文件顶部并导出（迁移与学习会话共用）

// 判断进度是否达成目标
function isProgressReached(current: string, target: string): boolean {
  if (!target.trim()) return false
  const cur = parseProgressNumber(current)
  const tgt = parseProgressNumber(target)
  if (isNaN(cur) || isNaN(tgt)) return false
  return cur >= tgt
}

// 结束学习：写入记录、更新当前进度、累计时间
// 进度更新支持两类序列：
//   - count 型（数量型）：传 deltaCount，新进度 = 当前 + 增量；达到 target 自动完成
//   - position 型（位置型）：传 endProgress 文本；不自动完成（无数字目标）
//   - 兼容旧调用：未传 deltaCount 时退化为按 endProgress 文本覆盖，并保留旧的 target 自动完成判定
export function finishStudySession(args: {
  taskId: string
  duration: number // 秒
  startProgress: string
  endProgress: string
  // 数量型序列本次完成数量（增量），如 +20；位置型不传
  deltaCount?: number
  // 学习备注（可选）
  note?: string
}) {
  setState((prev) => {
    const task = prev.tasks.find((t) => t.id === args.taskId)
    if (!task) return prev
    const obj = getCurrentObject(task)
    // 记录默认值；count 型会在下方按累加结果回填 start/end/delta
    const record: StudyRecord = {
      id: uid(),
      taskId: task.id,
      taskName: task.name,
      objectId: obj?.id ?? '',
      objectName: obj?.name ?? '（无序列）',
      // 新增：序列字段（与 objectId/objectName 同值，便于按序列语义展示）
      sequenceId: obj?.id,
      sequenceName: obj?.name,
      date: Date.now(),
      duration: args.duration,
      startProgress: args.startProgress,
      endProgress: args.endProgress,
      deltaCount: args.deltaCount,
      // 学习备注（可选；不填则 undefined，不写空字符串）
      note: args.note?.trim() || undefined,
    }
    const tasks = prev.tasks.map((t) => {
      if (t.id !== args.taskId) return t
      const totalStudyTime = t.totalStudyTime + args.duration
      if (!t.group || !t.currentObjectId) {
        return { ...t, totalStudyTime, status: t.status === 'not_started' ? 'in_progress' : t.status, updatedAt: Date.now() }
      }
      const curObj = t.group.items.find((i) => i.id === t.currentObjectId)
      if (!curObj) {
        return { ...t, totalStudyTime, status: t.status === 'not_started' ? 'in_progress' : t.status, updatedAt: Date.now() }
      }
      const prog = getSequenceProgress(curObj)
      // 计算新进度文本与 progressModel
      let newProgressText = args.endProgress
      let newModel: SequenceProgress = prog
      let autoComplete = false
      if (prog.type === 'count') {
        // 数量型：按 delta 累加（缺省 delta 时尝试解析 endProgress 为绝对值）
        const delta = typeof args.deltaCount === 'number' ? args.deltaCount : 0
        const baseCurrent = prog.current
        const newCurrent = delta !== 0
          ? baseCurrent + delta
          : (isNaN(parseProgressNumber(args.endProgress)) ? baseCurrent : parseProgressNumber(args.endProgress))
        newProgressText = String(newCurrent)
        newModel = { ...prog, current: newCurrent }
        // 回填记录为本次实际变化
        record.startProgress = String(baseCurrent)
        record.endProgress = newProgressText
        record.deltaCount = newCurrent - baseCurrent
        // 达到目标自动完成
        if (prog.target > 0 && newCurrent >= prog.target) {
          autoComplete = true
        }
      } else {
        // 位置型：用 endProgress 文本覆盖；无数字目标，不自动完成
        newProgressText = args.endProgress
        newModel = { ...prog, text: args.endProgress }
      }
      // 更新当前序列进度（同步旧字段与 progressModel）
      let items = t.group.items.map((i) =>
        i.id === t.currentObjectId
          ? {
              ...i,
              progress: newProgressText,
              progressModel: newModel,
              // 旧字段同步（兼容旧读取路径）
              progressUnit: newModel.type === 'count' ? newModel.unit : i.progressUnit,
              progressTarget: newModel.type === 'count' ? String(newModel.target) : i.progressTarget,
            }
          : i,
      )
      let currentObjectId = t.currentObjectId
      let status: Task['status'] = t.status === 'not_started' ? 'in_progress' : t.status
      // 自动完成判定：
      //   count 型由上面 autoComplete 决定；
      //   旧路径（无 progressModel 的 position 型仍带数字 progressTarget）保留原判定
      const updatedCur = items.find((i) => i.id === t.currentObjectId)!
      const shouldComplete =
        autoComplete ||
        (!updatedCur.completed &&
          isProgressReached(updatedCur.progress, updatedCur.progressTarget))
      if (shouldComplete) {
        items = items.map((i) =>
          i.id === t.currentObjectId ? { ...i, completed: true } : i,
        )
        const mode: GroupMode = t.group.mode ?? 'sequential'
        const nextId = pickNextObject(items, t.currentObjectId, mode)
        const allDone = items.every((i) => i.completed)
        currentObjectId = nextId ?? currentObjectId
        status = allDone ? 'completed' : 'in_progress'
      }
      return {
        ...t,
        group: { ...t.group, items },
        currentObjectId,
        totalStudyTime,
        status,
        updatedAt: Date.now(),
      }
    })
    return { ...prev, tasks, records: [record, ...prev.records] }
  })
}

// 更新学习记录备注（记录详情页内联编辑）
export function updateStudyRecordNote(recordId: string, note: string | undefined) {
  setState((prev) => {
    const finalNote = note?.trim() || undefined
    return {
      ...prev,
      records: prev.records.map((r) =>
        r.id === recordId ? { ...r, note: finalNote } : r,
      ),
    }
  })
}

// ---------- 学习记录查询 ----------
export function getRecordsByTask(records: StudyRecord[], taskId: string) {
  return records.filter((r) => r.taskId === taskId)
}

// 获取今天 0 点时间戳（本地时区）
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ---------- 统计：总学习时长（秒） ----------
export function getTotalStudyDuration(records: StudyRecord[]): number {
  return records.reduce((s, r) => s + (r.duration || 0), 0)
}

// ---------- 统计：今日学习时长（秒） ----------
export function getTodayStudyDuration(records: StudyRecord[]): number {
  const todayStart = startOfToday()
  return records
    .filter((r) => r.date >= todayStart)
    .reduce((s, r) => s + (r.duration || 0), 0)
}

// ---------- 统计：按方向汇总学习时长 ----------
// 返回 [{ taskId, taskName, totalDuration, recordCount }] 按时长降序
export function getStatsByTask(records: StudyRecord[]): Array<{
  taskId: string
  taskName: string
  totalDuration: number
  recordCount: number
}> {
  const map = new Map<string, {
    taskId: string
    taskName: string
    totalDuration: number
    recordCount: number
  }>()
  for (const r of records) {
    if (!r.taskId) continue
    const cur = map.get(r.taskId)
    if (cur) {
      cur.totalDuration += r.duration || 0
      cur.recordCount += 1
    } else {
      map.set(r.taskId, {
        taskId: r.taskId,
        taskName: r.taskName || '（未知方向）',
        totalDuration: r.duration || 0,
        recordCount: 1,
      })
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.totalDuration - a.totalDuration,
  )
}

// ---------- 统计：最近 N 条学习记录（全任务合并） ----------
export function getRecentRecords(
  records: StudyRecord[],
  limit = 10,
): StudyRecord[] {
  return [...records]
    .sort((a, b) => b.date - a.date)
    .slice(0, limit)
}

// ---------- 任务选择系统 ----------

// 判断任务是否存在可学习内容（有未完成且启用的学习对象）
export function hasLearnableContent(task: Task): boolean {
  if (!task.group || !task.group.items.length) return false
  return task.group.items.some((i) => !i.completed && i.enabled)
}

// 随机候选池：启用 + 参与随机 + 未完成 + 未暂停 + 权重>0 + 有可学内容
export function getRandomPool(tasks: Task[]): Task[] {
  return tasks.filter(
    (t) =>
      t.enabled &&
      t.randomEnabled &&
      t.status !== 'completed' &&
      t.status !== 'paused' &&
      t.weight > 0 &&
      hasLearnableContent(t),
  )
}

// 加权随机：从候选池中按 weight 加权随机选择一个
// weight 默认 1，weight <= 0 的任务已在候选池阶段排除
export function pickRandomTask(tasks: Task[]): Task | null {
  const pool = getRandomPool(tasks)
  if (!pool.length) return null
  const total = pool.reduce((s, t) => s + t.weight, 0)
  let r = Math.random() * total
  for (const t of pool) {
    r -= t.weight
    if (r <= 0) return t
  }
  return pool[pool.length - 1]
}

// 继续学习：优先 in_progress 且有当前对象的任务，回退到最近学习过的任务
export function getContinueTask(
  tasks: Task[],
  records: StudyRecord[],
): Task | null {
  const candidates = tasks.filter(
    (t) => t.enabled && getCurrentObject(t) !== null,
  )
  if (!candidates.length) return null
  const inProgress = candidates.filter((t) => t.status === 'in_progress')
  const pool = inProgress.length ? inProgress : candidates
  let best = pool[0]
  let bestTs = 0
  for (const t of pool) {
    const recs = records.filter((r) => r.taskId === t.id)
    const ts = recs.length ? Math.max(...recs.map((r) => r.date)) : t.updatedAt
    if (ts > bestTs) {
      bestTs = ts
      best = t
    }
  }
  return best
}

// ---------- 提醒配置 ----------
// 全量更新提醒配置（设置页保存时调用）
export function updateReminder(patch: Partial<ReminderConfig>) {
  setState((prev) => ({
    ...prev,
    reminder: { ...DEFAULT_REMINDER, ...prev.reminder, ...patch },
  }))
}

// ---------- 提醒池筛选 ----------
// 取参与提醒的任务：
//   - enabled=true
//   - id 在 enabledTaskIds 白名单内（白名单空=不限任务）
export function getReminderPool(
  tasks: Task[],
  reminder: ReminderConfig | undefined,
): Task[] {
  if (!reminder) return []
  return tasks.filter((t) => {
    if (!t.enabled) return false
    if (
      reminder.enabledTaskIds.length &&
      !reminder.enabledTaskIds.includes(t.id)
    ) {
      return false
    }
    return true
  })
}

// ---------- 时间窗工具 ----------
// 单个窗口：start <= end 正常区间；start > end 跨午夜
export function isMinuteInWindow(
  minuteOfDay: number,
  startMinute: number,
  endMinute: number,
): boolean {
  if (startMinute <= endMinute) return minuteOfDay >= startMinute && minuteOfDay < endMinute
  return minuteOfDay >= startMinute || minuteOfDay < endMinute
}

// 多窗口中命中任一即可
export function isMinuteInAnyWindow(
  minuteOfDay: number,
  windows: { startMinute: number; endMinute: number }[],
): boolean {
  if (!windows?.length) return false
  return windows.some((w) => isMinuteInWindow(minuteOfDay, w.startMinute, w.endMinute))
}

// 星期判断：enabledWeekdays 空=每天
export function isWeekdayEnabled(dow06: number, enabledWeekdays: number[]): boolean {
  if (!enabledWeekdays?.length) return true
  return enabledWeekdays.includes(dow06)
}

// ---------- 今日提醒次数（跨天自动清零）----------
const REMINDER_FIRED_KEY = 'learning-manager:reminder-fired'
export function getReminderFiredToday(): { date: string; count: number } {
  try {
    const raw = localStorage.getItem(REMINDER_FIRED_KEY)
    if (!raw) return { date: todayKey(), count: 0 }
    const obj = JSON.parse(raw) as { date: string; count: number }
    if (obj.date !== todayKey()) return { date: todayKey(), count: 0 }
    return obj
  } catch {
    return { date: todayKey(), count: 0 }
  }
}
export function incrementReminderFiredToday(): number {
  const cur = getReminderFiredToday()
  const next = { date: todayKey(), count: cur.count + 1 }
  try { localStorage.setItem(REMINDER_FIRED_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next.count
}
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 最近学习会话结束时间（用于"学习后跳过"）----------
const LAST_SESSION_END_KEY = 'learning-manager:last-session-end'
export function markSessionEndedNow(): void {
  try { localStorage.setItem(LAST_SESSION_END_KEY, String(Date.now())) } catch { /* ignore */ }
}
export function getLastSessionEnd(): number {
  try {
    const ts = Number(localStorage.getItem(LAST_SESSION_END_KEY))
    return isNaN(ts) ? 0 : ts
  } catch { return 0 }
}
