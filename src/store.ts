import { useSyncExternalStore } from 'react'
import type {
  AppData,
  Task,
  TaskType,
  TaskStatus,
  TaskGroup,
  GroupMode,
  LearningObject,
  StudyRecord,
  ReminderConfig,
} from './types'
import { DEFAULT_REMINDER } from './types'

const STORAGE_KEY = 'learning-manager:data:v1'

// ---------- 基础工具 ----------
const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`)

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppData
      parsed.tasks = parsed.tasks.map((t) => {
        // 迁移：任务组模式（旧数据默认顺序接续）
        const group = t.group
          ? {
              ...t.group,
              mode:
                (t.group as TaskGroup & { mode?: GroupMode }).mode ??
                'sequential',
              // 迁移：学习对象 weight（旧数据默认 1）
              // 迁移：学习对象 enabled（旧数据默认 true）
              items: t.group.items.map((i) => ({
                ...i,
                weight:
                  typeof (i as LearningObject & { weight?: number }).weight ===
                  'number'
                    ? (i as LearningObject & { weight?: number }).weight!
                    : 1,
                enabled:
                  typeof (i as LearningObject & { enabled?: boolean }).enabled ===
                  'boolean'
                    ? (i as LearningObject & { enabled?: boolean }).enabled!
                    : true,
              })),
            }
          : t.group
        return {
          ...t,
          randomEnabled:
            typeof (t as Task & { randomEnabled?: boolean }).randomEnabled ===
            'boolean'
              ? (t as Task & { randomEnabled?: boolean }).randomEnabled!
              : true,
          weight:
            typeof (t as Task & { weight?: number }).weight === 'number'
              ? (t as Task & { weight?: number }).weight!
              : 1,
          group,
        }
      })
      return {
        ...parsed,
        // 迁移：旧数据无 reminder 字段时使用默认配置
        // 迁移：旧 reminder 可能有 mode/enabledTypes 字段，已移除
        // 迁移：旧 reminder 可能无 cooldownMinutes 字段，默认 30
        reminder: parsed.reminder
          ? {
              enabled: parsed.reminder.enabled ?? false,
              intervalMinutes: parsed.reminder.intervalMinutes ?? 0,
              cooldownMinutes:
                (parsed.reminder as ReminderConfig & { cooldownMinutes?: number }).cooldownMinutes ?? 30,
              startHour: parsed.reminder.startHour ?? 9,
              endHour: parsed.reminder.endHour ?? 22,
              enabledTaskIds: parsed.reminder.enabledTaskIds ?? [],
            }
          : { ...DEFAULT_REMINDER },
      }
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
  type: TaskType
}): Task {
  const now = Date.now()
  const task: Task = {
    id: uid(),
    name: input.name.trim() || '未命名任务',
    icon: input.icon,
    type: input.type,
    status: 'not_started',
    enabled: true,
    randomEnabled: true,
    weight: 1,
    group: null,
    currentObjectId: null,
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
  input: { name: string; type?: string; progress?: string },
) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.map((t) => {
      if (t.id !== taskId) return t
      const obj: LearningObject = {
        id: uid(),
        name: input.name.trim() || '未命名',
        type: input.type ?? t.type,
        progress: input.progress ?? '',
        completed: false,
        enabled: true,
        weight: 1,
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
          items: t.group.items.map((i) =>
            i.id === objectId ? { ...i, ...patch } : i,
          ),
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
// 结束学习：写入记录、更新当前进度、累计时间
export function finishStudySession(args: {
  taskId: string
  duration: number // 秒
  startProgress: string
  endProgress: string
}) {
  setState((prev) => {
    const task = prev.tasks.find((t) => t.id === args.taskId)
    if (!task) return prev
    const obj = getCurrentObject(task)
    const record: StudyRecord = {
      id: uid(),
      taskId: task.id,
      taskName: task.name,
      objectId: obj?.id ?? '',
      objectName: obj?.name ?? '（无对象）',
      date: Date.now(),
      duration: args.duration,
      startProgress: args.startProgress,
      endProgress: args.endProgress,
    }
    const tasks = prev.tasks.map((t) => {
      if (t.id !== args.taskId) return t
      const totalStudyTime = t.totalStudyTime + args.duration
      const group =
        t.group && t.currentObjectId
          ? {
              ...t.group,
              items: t.group.items.map((i) =>
                i.id === t.currentObjectId
                  ? { ...i, progress: args.endProgress }
                  : i,
              ),
            }
          : t.group
      return {
        ...t,
        group,
        totalStudyTime,
        status: t.status === 'not_started' ? 'in_progress' : t.status,
        updatedAt: Date.now(),
      }
    })
    return { ...prev, tasks, records: [record, ...prev.records] }
  })
}

// ---------- 学习记录查询 ----------
export function getRecordsByTask(records: StudyRecord[], taskId: string) {
  return records.filter((r) => r.taskId === taskId)
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

// 切换提醒模式
// （已移除：统一由 intervalMinutes 控制，0=随机，>0=固定间隔）

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
