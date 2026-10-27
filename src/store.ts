import { useSyncExternalStore } from 'react'
import type {
  AppData,
  AppEntry,
  Task,
  TaskStatus,
  TaskGroup,
  GroupMode,
  LearningObject,
  Sequence,
  SequenceProgress,
  StudyRecord,
  ReminderConfig,
  ProgressNode,
  PlanDay,
  PlanItem,
  PinnedTask,
  TimeWindow,
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
const DEFAULT_TASK_SEEDED_KEY = 'learning-manager:default-task-seeded'
// 原文备份键：主数据解析/迁移失败时把原始字符串留在这里，避免被默认数据静默覆盖
const CORRUPT_BACKUP_KEY = 'learning-manager:data:corrupt-backup'

function readSeededFlag(): boolean {
  try {
    return localStorage.getItem(DEFAULT_TASK_SEEDED_KEY) === '1'
  } catch {
    return false
  }
}

function writeSeededFlag() {
  try {
    localStorage.setItem(DEFAULT_TASK_SEEDED_KEY, '1')
  } catch {
    /* ignore */
  }
}

// 学习记录滚动上限：超出后截断最旧记录，避免 localStorage 长期无限增长
const MAX_STUDY_RECORDS = 2000

// ---------- 基础工具 ----------
const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// ---------- 进度解析（迁移与学习会话共用） ----------
// parseProgressNumber / deriveProgressModel 已迁移至 ./migrate.ts，此处按需 import

function createDefaultTask(): Task {
  const now = Date.now()
  return {
    id: uid(),
    name: '即时',
    icon: '',
    status: 'not_started',
    enabled: true,
    weight: 1,
    group: null,
    currentObjectId: null,
    totalStudyTime: 0,
    createdAt: now,
    updatedAt: now,
    weekdays: [],
  }
}

function load(): AppData {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      // 统一走 migrateAppData：处理字段补全 / progressModel 推导 / reminder 兼容
      const data = migrateAppData(parsed)
      // 标记当前 schema 版本，便于后续升级判定
      writeSchemaVersion(CURRENT_SCHEMA_VERSION)

      // 默认「即时」方向：从未种子化且当前没有同名方向时自动补一个，作为垃圾箱/临时计划桶。
      // 种子化标记一旦写入，用户后续删除「即时」方向便不再自动重建，保证可删。
      const seeded = readSeededFlag()
      const hasInstant = data.tasks.some((t) => t.name === '即时')
      if (!seeded && !hasInstant) {
        data.tasks.push(createDefaultTask())
        writeSeededFlag()
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        } catch {
          /* ignore quota */
        }
      } else if (!seeded && hasInstant) {
        // 已有「即时」方向，只需标记种子化，避免重复补
        writeSeededFlag()
      }
      return data
    } catch (e) {
      // 解析/迁移失败：先把原文备份到恢复键，再退回默认数据。
      // 绝不静默丢弃用户数据——原文仍可从 CORRUPT_BACKUP_KEY 中找回。
      try {
        localStorage.setItem(CORRUPT_BACKUP_KEY, raw)
      } catch {
        /* ignore */
      }
      console.error(
        '[learning-manager] 本地数据解析失败，原文已备份到 ' + CORRUPT_BACKUP_KEY,
        e,
      )
    }
  }
  // 首次安装 / 无数据 / 数据损坏：写入默认数据
  const data: AppData = {
    tasks: [createDefaultTask()],
    records: [],
    reminder: { ...DEFAULT_REMINDER },
    plans: [],
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    writeSeededFlag()
  } catch {
    /* ignore quota */
  }
  return data
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
  const next = updater(state)
  // 更新函数可能原样返回 prev（去重写入、无变化的重排等）。这时既不该落盘、
  // 也不该通知订阅者——否则每次无效操作都要把整个 AppData 全量 JSON.stringify
  // 一遍（学习记录上限 2000 条），并触发全体组件重渲染。
  if (next === state) return
  state = next
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

// 非组件场景读取当前数据（供 reminderService 调度使用）
export function getAppData(): AppData {
  return state
}

// ---------- ID 生成 ----------
export const newId = uid

// ---------- 任务池 / 任务 CRUD ----------
export function createTask(input: {
  name: string
  icon: string
  // 可选：插入位置（默认顶部=最高权重；bottom=追加到末尾）
  insertAt?: 'top' | 'bottom'
  // 可选：提醒星期（0=周日…6=周六，空=每天）
  weekdays?: number[]
  // 可选：初始学习序列名称列表（从模板创建时用），创建后逐个生成空进度的序列
  sequenceNames?: string[]
  // 可选：每个序列名对应的进阶字段（长度与 sequenceNames 对齐则一一对应，空时用 templateDefault）
  sequenceTemplates?: Array<{
    progress?: string
    progressUnit?: string
    progressTarget?: string
    countdownSeconds?: number | null
    progressNodes?: ProgressNode[]
  } | null | undefined>
  // 可选：所有序列共用的默认模板（单独字段未覆盖时用）
  templateDefault?: {
    progressUnit?: string
    progressTarget?: string
    countdownSeconds?: number | null
  }
}): Task {
  const now = Date.now()
  const templ = input.templateDefault
  // 预置序列：空进度、未完成、启用，第一个作为 currentObjectId
  const items: LearningObject[] = (input.sequenceNames ?? []).map((n, idx) => {
    const per = input.sequenceTemplates?.[idx]
    const unit = per?.progressUnit ?? templ?.progressUnit ?? ''
    const target = per?.progressTarget ?? templ?.progressTarget ?? ''
    const countdown =
      typeof per?.countdownSeconds === 'number'
        ? per.countdownSeconds
        : typeof templ?.countdownSeconds === 'number'
          ? templ.countdownSeconds
          : null
    const progressRaw = per?.progress ?? (target ? '0' : '')
    const obj: LearningObject = {
      id: uid(),
      name: n.trim() || '未命名',
      progress: progressRaw,
      progressUnit: unit,
      progressTarget: target,
      completed: false,
      enabled: true,
      weight: 1,
      countdownSeconds: countdown,
      progressNodes: per?.progressNodes && per.progressNodes.length > 0 ? per.progressNodes : undefined,
      progressModel: { type: 'position', text: '' },
    }
    obj.progressModel = deriveProgressModel(obj)
    return obj
  })
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
    weight: 1,
    group,
    currentObjectId: items[0]?.id ?? null,
    totalStudyTime: 0,
    createdAt: now,
    updatedAt: now,
    weekdays: input.weekdays ?? [],
  }
  setState((prev) => {
    const arr =
      input.insertAt === 'bottom' ? [...prev.tasks, task] : [task, ...prev.tasks]
    // 顺序即权重（reorderTask / moveTaskToEdge 同口径）：插入后必须重排 weight，
    // 否则「新建到顶部」的任务仍是 weight=1，会被加权随机当成最低优先级。
    return {
      ...prev,
      tasks: arr.map((t, idx) => ({ ...t, weight: arr.length - idx })),
    }
  })
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

// ---------- 应用池（纯元数据缓存，不带策略立场） ----------
// 策略只有一个维度：**放行**。全局白名单存在 AppData.globalAllowedApps，
// 方向级 Task.allowedApps 是它的增量。黑名单已废弃（v2），不再有第二个名单。

/** 把选中的应用写入池子（按包名去重）；无变化时不做任何写入 */
export function addAppsToPool(entries: AppEntry[]) {
  if (!entries || entries.length === 0) return
  setState((prev) => {
    const pool = prev.appPool ?? []
    const seen = new Set(pool.map((e) => e.packageName))
    const next = [...pool]
    for (const e of entries) {
      const pkg = e?.packageName?.trim()
      if (!pkg || seen.has(pkg)) continue
      seen.add(pkg)
      next.push({ packageName: pkg, appName: (e.appName || '').trim() || pkg })
    }
    return next.length === pool.length ? prev : { ...prev, appPool: next }
  })
}

/** 从池中移除应用，并同步清理全局白名单与所有方向里的引用（避免留下死引用） */
export function removeAppFromPool(packageName: string) {
  if (!packageName) return
  setState((prev) => ({
    ...prev,
    appPool: (prev.appPool ?? []).filter((e) => e.packageName !== packageName),
    globalAllowedApps: (prev.globalAllowedApps ?? []).filter((p) => p !== packageName),
    tasks: prev.tasks.map((t) => {
      const a = t.allowedApps ?? []
      if (!a.includes(packageName)) return t
      return {
        ...t,
        allowedApps: a.filter((p) => p !== packageName),
        updatedAt: Date.now(),
      }
    }),
  }))
}

/** 包名 → 显示名（池子里查不到时回退包名本身） */
export function appLabelOf(pool: AppEntry[] | undefined, packageName: string): string {
  const hit = (pool ?? []).find((e) => e.packageName === packageName)
  return hit?.appName || packageName
}

// ---------- 放行集合：唯一的策略判定入口 ----------
// 全 App 只有这一处计算「某方向能进哪些应用」，其他组件一律调它，不再各自读 task.allowedApps。
// 规则：全局白名单 ∪ 方向额外放行，**只做加法不做减法**
//      （自动放行项 本App/桌面/输入法/拨号/系统界面 由原生侧统一叠加，见 StudyTimerService）。
export function resolveAllowedApps(
  task: Pick<Task, 'allowedApps'>,
  globalAllowedApps: string[] | undefined,
): { inherited: string[]; extra: string[]; all: string[] } {
  const inherited = [...new Set(globalAllowedApps ?? [])]
  const extra = (task.allowedApps ?? []).filter((p) => !inherited.includes(p))
  return { inherited, extra, all: [...inherited, ...extra] }
}

/** 某应用在某方向下的身份。黑名单已废弃，只剩「放行」与「不在集合」两种。 */
export function classifyAppForTask(
  task: Pick<Task, 'allowedApps'>,
  globalAllowedApps: string[] | undefined,
  packageName: string,
): 'allow' | 'none' {
  return resolveAllowedApps(task, globalAllowedApps).all.includes(packageName)
    ? 'allow'
    : 'none'
}

/** 覆盖全局白名单（去重、去空白；顺序变化也算变化） */
export function setGlobalAllowedApps(pkgs: string[]) {
  const next = [...new Set(pkgs.map((p) => p.trim()).filter(Boolean))]
  setState((prev) => {
    const cur = prev.globalAllowedApps ?? []
    if (cur.length === next.length && cur.every((p, i) => p === next[i])) return prev
    return { ...prev, globalAllowedApps: next }
  })
}

/** 往全局白名单加一个应用；顺带补进池子，保证显示名有处可查 */
export function addAppToGlobalAllowed(packageName: string, appName?: string) {
  const pkg = packageName?.trim()
  if (!pkg) return
  setState((prev) => {
    const cur = prev.globalAllowedApps ?? []
    if (cur.includes(pkg)) return prev
    return { ...prev, globalAllowedApps: [...cur, pkg] }
  })
  if (appName) addAppsToPool([{ packageName: pkg, appName }])
}

/** 从全局白名单移除一个应用（方向级引用不动：那是各方向的额外放行） */
export function removeAppFromGlobalAllowed(packageName: string) {
  setState((prev) => {
    const cur = prev.globalAllowedApps ?? []
    if (!cur.includes(packageName)) return prev
    return { ...prev, globalAllowedApps: cur.filter((p) => p !== packageName) }
  })
}

export function deleteTask(id: string) {
  setState((prev) => ({
    ...prev,
    tasks: prev.tasks.filter((t) => t.id !== id),
    records: prev.records.filter((r) => r.taskId !== id),
    // 同步清理固定引用：残留的 pinnedTasks 会让 App 误判「还有固定任务」，
    // 从而在提醒关闭时继续生成计划/调度「下一项」通知。
    pinnedTasks: (prev.pinnedTasks ?? []).filter((p) => p.taskId !== id),
  }))
}

export function setTaskEnabled(id: string, enabled: boolean) {
  updateTask(id, { enabled })
}

// 手动调整方向顺序：上移 / 下移，并重排权重（自上而下权重递减，顺序即权重）
export function reorderTask(id: string, dir: 'up' | 'down') {
  setState((prev) => {
    const arr = [...prev.tasks]
    const i = arr.findIndex((t) => t.id === id)
    if (i < 0) return prev
    const j = dir === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= arr.length) return prev
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    const reindexed = arr.map((t, idx) => ({ ...t, weight: arr.length - idx }))
    return { ...prev, tasks: reindexed }
  })
}

// 一次移到顶部 / 底部（方向多时省去连点上移），同样重排权重
export function moveTaskToEdge(id: string, edge: 'top' | 'bottom') {
  setState((prev) => {
    const target = prev.tasks.find((t) => t.id === id)
    if (!target) return prev
    const rest = prev.tasks.filter((t) => t.id !== id)
    const arr = edge === 'top' ? [target, ...rest] : [...rest, target]
    const reindexed = arr.map((t, idx) => ({ ...t, weight: arr.length - idx }))
    return { ...prev, tasks: reindexed }
  })
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
        // 已完成的方向新增序列后必须回到进行中：getRandomPool 会排除 status=completed
        // 的方向，不恢复的话新序列永远不会进入每日计划/随机开始。
        status:
          t.status === 'completed' || t.status === 'not_started'
            ? 'in_progress'
            : t.status,
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
    // 按列表顺序把排序视作权重：从上往下依次降低（首项最高，末项最低）
    // 不依赖手动填写的 item.weight，避免与「手动排序」语义冲突
    const n = remaining.length
    const total = (n * (n + 1)) / 2 // 权重和 = n + (n-1) + ... + 1
    let r = Math.random() * total
    for (let k = 0; k < n; k++) {
      r -= n - k // 第 k 项（从上往下）权重 = n - k
      if (r <= 0) return remaining[k].id
    }
    return remaining[n - 1].id
  }

  // sequential（默认）
  if (currentId) {
    const curIdx = items.findIndex((i) => i.id === currentId)
    for (let k = curIdx + 1; k < items.length; k++) {
      // 与上方 remaining 过滤保持一致：停用（暂停）的序列不参与接续，
      // 否则完成当前项会跳到用户明确关闭的序列上。
      if (!items[k].completed && items[k].enabled) return items[k].id
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
  // tgt > 0：目标写成 "0" 时 0 >= 0 恒成立，会导致首次保存即自动完成。
  if (isNaN(cur) || isNaN(tgt) || tgt <= 0) return false
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
    const nextRecords = [record, ...prev.records]
    // 滚动上限：超出截断最旧记录，避免 localStorage 无限增长
    if (nextRecords.length > MAX_STUDY_RECORDS) {
      nextRecords.length = MAX_STUDY_RECORDS
    }

    // 自动标记计划项：今天 pending、方向匹配的最早一项 → done
    // （覆盖 App 内「开始」与通知「开始」两条路径，无需界面层传参）
    // 仅当本次时长达到 60 秒：防误触的一两秒会话把计划项错误标完成
    const todayStr = dateKey(new Date())
    const today = prev.plans?.find((p) => p.date === todayStr)
    let plans = prev.plans
    if (today && args.duration >= 60) {
      const target = today.items
        .filter((it) => it.status === 'pending' && it.taskId === args.taskId)
        .sort((a, b) => a.minuteOfDay - b.minuteOfDay)[0]
      if (target) {
        plans = plans!.map((d) =>
          d.date === todayStr
            ? {
                ...d,
                items: d.items.map((it) =>
                  it.id === target.id ? { ...it, status: 'done' as const } : it,
                ),
              }
            : d,
        )
      }
    }

    return { ...prev, tasks, records: nextRecords, plans }
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

// 删除单条学习记录（按该条 duration 扣减关联方向的累计时长）
export function deleteStudyRecord(recordId: string) {
  setState((prev) => {
    const target = prev.records.find((r) => r.id === recordId)
    if (!target) return prev
    const records = prev.records.filter((r) => r.id !== recordId)
    const tasks = prev.tasks.map((t) =>
      t.id === target.taskId
        ? {
            ...t,
            // 只扣减这一条的时长，不从 records 反推：records 有 2000 条滚动上限，
            // 求和会丢掉更早的历史（表现为删一条记录累计时长暴跌）。
            totalStudyTime: Math.max(
              0,
              (t.totalStudyTime || 0) - (target.duration || 0),
            ),
          }
        : t,
    )
    return { ...prev, tasks, records }
  })
}

// ---------- 学习记录查询 ----------
export function getRecordsByTask(records: StudyRecord[], taskId: string) {
  return records.filter((r) => r.taskId === taskId)
}

// 获取今天 0 点时间戳（本地时区）
function startOfToday(): number {
  return startOfDayOffset(0)
}

// 获取「N 天前」的本地 0 点时间戳。
// 用 setDate 做日期运算、而不是减 86400000：夏令时切换那天只有 23/25 小时，
// 固定毫秒步进会让边界整体偏移一小时，0 点附近的记录会落进相邻那天。
// daysAgo 允许为负（取未来某天 0 点），用于算当天桶的开区间上界。
function startOfDayOffset(daysAgo: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
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

// ---------- 统计：最近 N 天每日时长（含 0 天），从旧到新 ----------
export function getDailyDurations(
  records: StudyRecord[],
  days = 30,
): Array<{ date: number; duration: number }> {
  const out: Array<{ date: number; duration: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    // 桶边界取「本地 0 点」，跨夏令时切换也保持对齐
    const dayStart = startOfDayOffset(i)
    const dayEnd = startOfDayOffset(i - 1)
    const dur = records
      .filter((r) => r.date >= dayStart && r.date < dayEnd)
      .reduce((s, r) => s + (r.duration || 0), 0)
    out.push({ date: dayStart, duration: dur })
  }
  return out
}

// ---------- 统计：连续学习天数（截至今天；今天无记录则从昨天起算） ----------
export function getStreakDays(records: StudyRecord[]): number {
  if (records.length === 0) return 0
  const daySet = new Set<number>()
  for (const r of records) {
    const d = new Date(r.date)
    d.setHours(0, 0, 0, 0)
    daySet.add(d.getTime())
  }
  // 同样按本地日期回退，避免夏令时那天把连续记录误判成断档
  let streak = 0
  let offset = 0
  if (!daySet.has(startOfDayOffset(0))) {
    if (!daySet.has(startOfDayOffset(1))) return 0
    offset = 1
  }
  while (daySet.has(startOfDayOffset(offset))) {
    streak++
    offset++
  }
  return streak
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
      t.status !== 'completed' &&
      t.status !== 'paused' &&
      t.weight > 0 &&
      hasLearnableContent(t),
  )
}

// 加权随机：从给定池中按 weight 加权随机选一个（池已过滤，weight<=0 的按 1 处理）
export function pickWeightedFrom(pool: Task[]): Task | null {
  if (!pool.length) return null
  const weighted = pool.filter((t) => t.weight > 0)
  const use = weighted.length ? weighted : pool
  const total = use.reduce((s, t) => s + Math.max(t.weight, 1), 0)
  let r = Math.random() * total
  for (const t of use) {
    r -= Math.max(t.weight, 1)
    if (r <= 0) return t
  }
  return use[use.length - 1]
}

// 加权随机：从候选池中按 weight 加权随机选择一个
// weight 默认 1，weight <= 0 的任务已在候选池阶段排除
export function pickRandomTask(tasks: Task[]): Task | null {
  return pickWeightedFrom(getRandomPool(tasks))
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

// ---------- 次日计划系统 ----------

// 日期 → 'YYYY-MM-DD'（本地时区）
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 方向在某星期是否参与计划（weekdays 空 = 每天）
export function isTaskActiveOnWeekday(t: Task, dow: number): boolean {
  if (!t.weekdays || t.weekdays.length === 0) return true
  return t.weekdays.includes(dow)
}

// 某日的计划池：随机候选池 + 星期匹配
export function getPlanPoolForDate(tasks: Task[], dow: number): Task[] {
  return getRandomPool(tasks).filter((t) => isTaskActiveOnWeekday(t, dow))
}

// 窗口按当日有效区间展开：
//   start < end → 正常区间
//   start > end → 跨夜：当日同时拥有 [start,1439]（当晚段）与 [0,end]（凌晨段）
//   start = end → 无效，跳过
function effectiveSpans(windows: TimeWindow[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  for (const w of windows) {
    if (w.startMinute < w.endMinute) {
      spans.push({ start: w.startMinute, end: w.endMinute })
    } else if (w.startMinute > w.endMinute) {
      spans.push({ start: w.startMinute, end: 1439 })
      spans.push({ start: 0, end: w.endMinute })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

// 生成某日计划：N 个时刻 × 随机方向（避免同方向连续），序列取当前序列
// opts.fromMinute：今日补齐时只排该分钟之后；跨夜凌晨段视为"当日开头"，不受影响
export function generatePlanDay(
  tasks: Task[],
  reminder: ReminderConfig,
  date: Date,
  opts?: { fromMinute?: number },
): PlanDay | null {
  const dow = date.getDay()
  const pool = getPlanPoolForDate(tasks, dow)
  if (!pool.length) return null

  const from = opts?.fromMinute ?? 0
  const usable = effectiveSpans(reminder.windows)
    .map((s) => ({ start: Math.max(s.start, from), end: s.end }))
    .filter((s) => s.end - s.start >= 5) // 裁剪后至少留 5 分钟
  if (!usable.length) return null

  const n = Math.min(12, Math.max(1, reminder.planSessions))
  const picked: number[] = []

  if (reminder.planTiming === 'interval') {
    // 固定间隔：从首段开始顺排，跨段时跳过关闭时段保持节奏
    const step = Math.min(1440, Math.max(5, reminder.intervalMinutes))
    let cursor: number | null = null
    for (const span of usable) {
      let t: number = cursor === null ? span.start : Math.max(span.start, cursor)
      while (t <= span.end && picked.length < n) {
        picked.push(t)
        t += step
      }
      cursor = t
      if (picked.length >= n) break
    }
  } else {
    // 随机：分层随机 —— 把可用总时长按 n 等分，每份内随机取一点
    // 保证总能排满 n 项，且时刻既随机又大致分散（不会扎堆挤掉后面的项）
    const gap = Math.min(720, Math.max(reminder.cooldownMinutes, 15))
    const totalLen = usable.reduce((s, u) => s + (u.end - u.start), 0)
    const segLen = totalLen / n
    for (let k = 0; k < n; k++) {
      const r = k * segLen + Math.random() * segLen
      // 线性位置 → 映射回具体窗口的分钟
      let m = -1
      let base = 0
      for (let i = 0; i < usable.length; i++) {
        const u = usable[i]
        const len = u.end - u.start
        if (r < base + len) { m = u.start + Math.floor(r - base); break }
        base += len
      }
      if (m < 0) m = usable[usable.length - 1].end
      // 防御：与上一项至少隔 min(gap, 段长)（分层后一般天然满足）
      const minGap = Math.min(gap, Math.floor(segLen * 0.9))
      if (picked.length && m - picked[picked.length - 1] < minGap) {
        m = Math.min(picked[picked.length - 1] + minGap, usable[usable.length - 1].end)
      }
      picked.push(m)
    }
  }

  if (!picked.length) return null

  // 方向分配：加权随机，避免同方向连续两项
  const items: PlanItem[] = []
  let prevTaskId: string | null = null
  for (const m of picked) {
    const candidates = pool.length < 2 ? pool : pool.filter((t) => t.id !== prevTaskId)
    const task = pickWeightedFrom(candidates.length ? candidates : pool)
    if (!task) break
    const seq = pickSequence(task)
    items.push({
      id: uid(),
      minuteOfDay: m,
      taskId: task.id,
      taskName: task.name,
      sequenceId: seq?.id,
      sequenceName: seq?.name,
      durationSec: seq?.countdownSeconds ?? null,
      status: 'pending',
    })
    prevTaskId = task.id
  }

  // 固定任务注入：被用户标星固定的方向/序列，每天自动进入计划（直到手动取消固定）。
  // 用 some() 去重，避免与随机抽到的同任务/序列重复。
  const pinned = state.pinnedTasks ?? []
  if (pinned.length) {
    const firstStart = usable.length ? usable[0].start : (opts?.fromMinute ?? 0)
    for (const p of pinned) {
      if (
        items.some(
          (it) =>
            it.taskId === p.taskId &&
            (it.sequenceId ?? undefined) === (p.sequenceId ?? undefined),
        )
      ) {
        continue
      }
      const t = tasks.find((x) => x.id === p.taskId)
      if (!t || t.enabled === false) continue
      const seq = p.sequenceId
        ? t.group?.items.find((s) => s.id === p.sequenceId)
        : pickSequence(t)
      items.push({
        id: uid(),
        minuteOfDay: Math.max(firstStart, opts?.fromMinute ?? 0),
        taskId: t.id,
        taskName: t.name,
        sequenceId: seq?.id,
        sequenceName: seq?.name,
        durationSec: seq?.countdownSeconds ?? null,
        status: 'pending',
        pinned: true,
      })
    }
  }

  return { date: dateKey(date), items, generatedAt: Date.now() }
}

// 保留近 7 天 + 明天，更早的丢弃
function trimPlans(plans: PlanDay[], now: Date): PlanDay[] {
  const minKey = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  return plans.filter((p) => p.date >= minKey)
}

// 确保今天/明天的计划存在（纯函数：不变时返回原引用）
//   - 今天缺：从当前时间起生成剩余项（用于打开 App 补齐）
//   - 明天缺：预生成全天计划
export function ensurePlans(
  tasks: Task[],
  reminder: ReminderConfig,
  plans: PlanDay[],
): PlanDay[] {
  const now = new Date()
  const todayStr = dateKey(now)
  const lookahead = Math.min(7, Math.max(1, reminder.planLookaheadDays || 3))
  const next = [...plans]
  let changed = false

  for (let d = 0; d <= lookahead; d++) {
    const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d)
    const dayStr = dateKey(dayDate)
    const existingIdx = next.findIndex((p) => p.date === dayStr)
    const existing = existingIdx >= 0 ? next[existingIdx] : undefined
    // 已存在的日期默认不重排；例外：当天只有用户手动项。手动项会把这一天留在 plans 里
    // （例如提醒关着时先手动建了一条），但自动项/固定项其实从未生成过，需要补上。
    const onlyManual =
      !!existing &&
      existing.items.length > 0 &&
      existing.items.every((it) => it.manual === true)
    if (existing && !onlyManual) continue
    let generated: PlanDay | null = null
    if (d === 0) {
      // 今日补齐：从 max(now+5, 学习后跳过结束点) 起排剩余项
      let fromMinute = now.getHours() * 60 + now.getMinutes() + 5
      if (reminder.skipAfterSessionMinutes > 0) {
        const lastEnd = getLastSessionEnd()
        if (lastEnd > 0) {
          const skipUntilMin =
            Math.ceil((lastEnd + reminder.skipAfterSessionMinutes * 60 * 1000 - now.getTime()) / 60000)
          if (skipUntilMin > fromMinute) fromMinute = skipUntilMin
        }
      }
      generated = generatePlanDay(tasks, reminder, dayDate, { fromMinute })
    } else {
      // 未来天：整窗排程（不受 fromMinute 约束）
      generated = generatePlanDay(tasks, reminder, dayDate)
    }
    // 生成结果为空时不落空日（保持原行为：没有可排项就留空）
    if (!generated || generated.items.length === 0) continue
    if (existing && existingIdx >= 0) {
      const have = new Set(existing.items.map((it) => it.id))
      next[existingIdx] = {
        ...existing,
        items: [...existing.items, ...generated.items.filter((it) => !have.has(it.id))],
        generatedAt: generated.generatedAt,
      }
    } else {
      next.push(generated)
    }
    changed = true
  }

  // 手动计划顺延：过去日期仍待办的手动项并入今天
  if (carryManualIntoToday(next, todayStr)) changed = true

  const trimmed = trimPlans(next.sort((a, b) => (a.date < b.date ? -1 : 1)), now)
  if (trimmed.length !== next.length) changed = true
  return changed ? trimmed : plans
}

// 把过去日期仍 pending 的手动计划项并入今天（持续保留直到完成/跳过/删除）。
// 就地修改传入数组（触碰到的日期会拷贝替换）；有顺延时返回 true。
// 自动生成的项不顺延——到点没做按既有规则处理。
function carryManualIntoToday(days: PlanDay[], todayStr: string): boolean {
  const carry: PlanItem[] = []
  for (const d of days) {
    if (d.date >= todayStr) continue
    for (const it of d.items) {
      if (it.manual && it.status === 'pending') {
        carry.push({ ...it, deferredAtMs: undefined, carriedFrom: d.date })
      }
    }
  }
  if (!carry.length) return false
  const ti = days.findIndex((d) => d.date === todayStr)
  if (ti === -1) {
    days.push({ date: todayStr, items: carry, generatedAt: Date.now() })
  } else {
    const day = days[ti]
    const have = new Set(day.items.map((i) => i.id))
    days[ti] = { ...day, items: [...day.items, ...carry.filter((c) => !have.has(c.id))] }
  }
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]
    if (d.date >= todayStr) continue
    if (!d.items.some((it) => it.manual && it.status === 'pending')) continue
    const rest = d.items.filter((it) => !(it.manual && it.status === 'pending'))
    if (rest.length > 0) days[i] = { ...d, items: rest }
    else days.splice(i, 1)
  }
  return true
}

// 在 store 内确保计划存在（供 reminderService 调度前调用），返回最新 plans
export function ensurePlansInStore(): PlanDay[] {
  const next = ensurePlans(state.tasks, state.reminder ?? DEFAULT_REMINDER, state.plans ?? [])
  if (next !== state.plans) {
    setState((prev) => ({ ...prev, plans: next }))
  }
  return next
}

// 顺延手动计划项到今天（供打开/切回前台时调用，与提醒开关无关）
export function carryOverManualPlanItems(): boolean {
  const todayStr = dateKey(new Date())
  const plans = [...(state.plans ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))
  if (!carryManualIntoToday(plans, todayStr)) return false
  setState((prev) => ({ ...prev, plans }))
  return true
}

// 丢弃某日计划（如设置变更后让调度器按新参数重排明天）。
// 仍待办的手动项保留在该日（不受重排影响，由顺延机制跟进）。
export function dropPlanForDate(dateStr: string): void {
  setState((prev) => ({
    ...prev,
    plans: (prev.plans ?? [])
      .map((p) =>
        p.date === dateStr
          ? { ...p, items: p.items.filter((it) => it.manual && it.status === 'pending') }
          : p,
      )
      .filter((p) => p.items.length > 0),
  }))
}

// 查询某日计划
export function getPlanForDate(plans: PlanDay[] | undefined, key: string): PlanDay | undefined {
  return plans?.find((p) => p.date === key)
}

// 更新计划项状态（完成/跳过/恢复待办）
export function updatePlanItemStatus(dateStr: string, itemId: string, status: PlanItem['status']) {
  setState((prev) => ({
    ...prev,
    plans: (prev.plans ?? []).map((d) =>
      d.date === dateStr
        ? { ...d, items: d.items.map((it) => (it.id === itemId ? { ...it, status } : it)) }
        : d,
    ),
  }))
}

// ============ 固定任务（标星）============
// 被固定的方向/序列每天自动进入计划，直到手动取消固定。

// 判断某方向/序列当前是否被固定
export function isTaskPinned(taskId: string, sequenceId?: string): boolean {
  return (state.pinnedTasks ?? []).some(
    (p) =>
      p.taskId === taskId && (p.sequenceId ?? undefined) === (sequenceId ?? undefined),
  )
}

// 切换固定状态。固定时立即注入到今天~未来 lookahead 天的计划；取消时移除这些天里
// 仍处于 pending 的固定项（已完成的不动，保留历史）。返回最新固定列表。
export function togglePinnedTask(taskId: string, sequenceId?: string): PinnedTask[] {
  const cur = state.pinnedTasks ?? []
  const exists = cur.some(
    (p) =>
      p.taskId === taskId && (p.sequenceId ?? undefined) === (sequenceId ?? undefined),
  )
  let nextPinned: PinnedTask[]
  if (exists) {
    nextPinned = cur.filter(
      (p) =>
        !(p.taskId === taskId && (p.sequenceId ?? undefined) === (sequenceId ?? undefined)),
    )
    removePinnedItems(taskId, sequenceId)
  } else {
    nextPinned = [...cur, { taskId, sequenceId }]
    // 必须传入「新的」固定列表：此刻 state.pinnedTasks 尚未更新，
    // 读全局态会让刚固定的项当天不生效
    injectPinnedIntoExistingPlans(nextPinned)
  }
  setState((prev) => ({ ...prev, pinnedTasks: nextPinned }))
  // 重新补齐计划（确保未来缺失的天也含固定项；生成逻辑已注入固定任务）
  ensurePlansInStore()
  return nextPinned
}

// 移除所有计划日中仍处于 pending 的固定项（取消固定时调用）
export function removePinnedItems(taskId: string, sequenceId?: string): void {
  const plans = state.plans ?? []
  let changed = false
  const next = plans.map((d) => {
    const idx = d.items.findIndex(
      (it) =>
        it.pinned &&
        it.taskId === taskId &&
        (it.sequenceId ?? undefined) === (sequenceId ?? undefined) &&
        it.status === 'pending',
    )
    if (idx === -1) return d
    changed = true
    return { ...d, items: d.items.filter((_, i) => i !== idx) }
  })
  if (changed) setState((prev) => ({ ...prev, plans: next }))
}

// 把当前固定任务立即注入到今天~未来 lookahead 天已存在的计划日中（固定当天即生效）。
// 与 generatePlanDay 的注入互补：generatePlanDay 覆盖「未来重新生成的天」，本函数覆盖
// 「已经存在、本次不会重排的天」（如今天）。
function injectPinnedIntoExistingPlans(pinnedList?: PinnedTask[]): void {
  const { reminder } = getAppData()
  if (!reminder) return
  const pinned = pinnedList ?? state.pinnedTasks ?? []
  if (!pinned.length) return
  const now = new Date()
  const lookahead = Math.min(7, Math.max(1, reminder.planLookaheadDays || 3))
  const spans = effectiveSpans(reminder.windows)
  const firstStart = spans.length ? spans[0].start : 9 * 60
  const plans = state.plans ?? []
  let changed = false
  const next = plans.map((d) => {
    // 用「本地年月日」构造日期再算天数差：new Date('YYYY-MM-DD') 会按 UTC 解析，
    // 在 UTC+12:30 以东时区会被四舍五入成 1，把今天误判成未来日（注入时刻错位）。
    const [dy, dm, dd] = d.date.split('-').map(Number)
    const dIdx = Math.round(
      (new Date(dy, dm - 1, dd).getTime() -
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
        86400000,
    )
    if (dIdx < 0 || dIdx > lookahead) return d
    const fromMinute = dIdx === 0 ? now.getHours() * 60 + now.getMinutes() + 5 : 0
    const minute = Math.max(firstStart, fromMinute)
    let items = d.items
    let dayChanged = false
    for (const p of pinned) {
      if (
        items.some(
          (it) =>
            it.taskId === p.taskId &&
            (it.sequenceId ?? undefined) === (p.sequenceId ?? undefined),
        )
      ) {
        continue
      }
      const t = state.tasks.find((x) => x.id === p.taskId)
      if (!t || t.enabled === false) continue
      const seq = p.sequenceId
        ? t.group?.items.find((s) => s.id === p.sequenceId)
        : pickSequence(t)
      items = [
        ...items,
        {
          id: uid(),
          minuteOfDay: minute,
          taskId: t.id,
          taskName: t.name,
          sequenceId: seq?.id,
          sequenceName: seq?.name,
          durationSec: seq?.countdownSeconds ?? null,
          status: 'pending' as const,
          pinned: true,
        },
      ]
      dayChanged = true
    }
    if (dayChanged) {
      changed = true
      return { ...d, items }
    }
    return d
  })
  if (changed) setState((prev) => ({ ...prev, plans: next }))
}

// 写入冲突延迟补发的目标时刻（deferredAtMs），供 scheduleReminders 据此重排
// 仅修改匹配 id 的项；其他项不变。跨多次 reschedule 也能存活（持久化在 plan 内）。
export function setPlanItemsDeferred(
  dateStr: string,
  updates: { id: string; at: number }[],
): void {
  if (!updates.length) return
  const map = new Map(updates.map((u) => [u.id, u.at]))
  setState((prev) => ({
    ...prev,
    plans: (prev.plans ?? []).map((d) =>
      d.date === dateStr
        ? {
            ...d,
            items: d.items.map((it) =>
              map.has(it.id) ? { ...it, deferredAtMs: map.get(it.id) } : it,
            ),
          }
        : d,
    ),
  }))
}

// 手动插入一条计划项（新建计划）：直接追加到指定日期的计划，可立即开始 / 等提醒
// minuteOfDay 由调用方给定（可指定时刻或随机插入当日未来时刻）
export function addPlanItem(
  dateStr: string,
  input: {
    taskId: string
    taskName: string
    minuteOfDay: number
    sequenceId?: string
    sequenceName?: string
    durationSec?: number | null
    manual?: boolean
    remindOnly?: boolean
  },
): PlanItem {
  const item: PlanItem = {
    id: uid(),
    minuteOfDay: input.minuteOfDay,
    taskId: input.taskId,
    taskName: input.taskName,
    sequenceId: input.sequenceId,
    sequenceName: input.sequenceName,
    durationSec: input.durationSec ?? null,
    status: 'pending',
    manual: input.manual,
    remindOnly: input.remindOnly,
  }
  setState((prev) => {
    const plans = prev.plans ?? []
    const idx = plans.findIndex((p) => p.date === dateStr)
    if (idx === -1) {
      return {
        ...prev,
        plans: [...plans, { date: dateStr, items: [item], generatedAt: Date.now() }],
      }
    }
    return {
      ...prev,
      plans: plans.map((p, i) => (i === idx ? { ...p, items: [...p.items, item] } : p)),
    }
  })
  return item
}

// 删除单条计划项（手动项的「删除」操作）；删空的日期一并移除
export function deletePlanItem(dateStr: string, itemId: string): void {
  setState((prev) => ({
    ...prev,
    plans: (prev.plans ?? [])
      .map((d) =>
        d.date === dateStr ? { ...d, items: d.items.filter((it) => it.id !== itemId) } : d,
      )
      .filter((d) => d.items.length > 0),
  }))
}

// 计划项「换一个」：同一时刻换一个方向（池中无可换项时返回 null）
export function rerollPlanItem(dateStr: string, itemId: string): PlanItem | null {
  const day = state.plans?.find((d) => d.date === dateStr)
  const item = day?.items.find((i) => i.id === itemId)
  if (!day || !item) return null
  const d = new Date(`${dateStr}T00:00:00`)
  const pool = getPlanPoolForDate(state.tasks, d.getDay()).filter((t) => t.id !== item.taskId)
  const alt = pickWeightedFrom(pool)
  if (!alt) return null
  const seq = pickSequence(alt)
  const updated: PlanItem = {
    ...item,
    taskId: alt.id,
    taskName: alt.name,
    sequenceId: seq?.id,
    sequenceName: seq?.name,
    durationSec: seq?.countdownSeconds ?? null,
    status: 'pending',
  }
  setState((prev) => ({
    ...prev,
    plans: (prev.plans ?? []).map((dd) =>
      dd.date === dateStr
        ? { ...dd, items: dd.items.map((it) => (it.id === itemId ? updated : it)) }
        : dd,
    ),
  }))
  return updated
}

// 重新生成某日全部计划（保留已完成项，只重排 pending 项的时刻与方向）
// 用于用户手动「重新排今天剩余」
export function regeneratePlanDayInStore(dateStr: string): void {
  const reminder = state.reminder ?? DEFAULT_REMINDER
  const day = state.plans?.find((p) => p.date === dateStr)
  if (!day) return
  const d = new Date(`${dateStr}T00:00:00`)
  const keep = day.items.filter((it) => it.status === 'pending')
  if (!keep.length) return
  // 手动项（manual）的内容是用户自己填的，generatePlanDay 无法重建；重排时若把它
  // 当作「待办项」整体替换掉，等于静默删除用户数据。这里把它原样保留。
  const manualPending = keep.filter((it) => it.manual)
  const now = new Date()
  const fromMinute =
    dateStr === dateKey(now) ? now.getHours() * 60 + now.getMinutes() + 5 : 0
  const fresh = generatePlanDay(state.tasks, reminder, d, { fromMinute })
  if (!fresh || !fresh.items.length) return
  const done = day.items.filter((it) => it.status !== 'pending')
  // 防御性去重：保留项与新生项理论上 id 不同；同一方向同一时刻已有手动项时
  // 也不再补自动项（用户已显式指定那一刻）。
  const haveIds = new Set([...done, ...manualPending].map((it) => it.id))
  const manualKeys = new Set(manualPending.map((it) => `${it.taskId}|${it.minuteOfDay}`))
  const freshItems = fresh.items.filter(
    (it) => !haveIds.has(it.id) && !manualKeys.has(`${it.taskId}|${it.minuteOfDay}`),
  )
  setState((prev) => ({
    ...prev,
    plans: (prev.plans ?? []).map((p) =>
      p.date === dateStr
        ? {
            ...p,
            items: [...done, ...manualPending, ...freshItems],
            generatedAt: Date.now(),
          }
        : p,
    ),
  }))
}

// ---------- 最近学习会话结束时间（用于"学习后跳过"）----------
const LAST_SESSION_END_KEY = 'learning-manager:last-session-end'
export function getLastSessionEnd(): number {
  try {
    const ts = Number(localStorage.getItem(LAST_SESSION_END_KEY))
    return isNaN(ts) ? 0 : ts
  } catch { return 0 }
}
