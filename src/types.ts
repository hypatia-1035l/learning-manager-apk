// 核心数据结构定义

// 任务状态
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'paused'

// 越界管控档位（原 guardEnabled 布尔的两态升级为三态）：
//   off  = 不检测
//   warn = 离开放行集合超过宽限时间就提醒
//   pull = 同 warn，并尝试把 App 拉回前台（需悬浮窗权限，未授权自动降级为 warn）
export type GuardLevel = 'off' | 'warn' | 'pull'

// 任务组模式：顺序接续 / 随机选择 / 加权随机（预留）
// 现语义：控制同一学习方向下「多个学习序列」之间如何接续
export type GroupMode = 'sequential' | 'random' | 'weighted_random'

// ===== 学习序列进度模型 =====
// 数量型：350/1000 条、200/500 次
// 位置型：卷八十九、第三章第五节（自由文本，无明确目标）
export interface CountProgress {
  type: 'count'
  current: number
  target: number
  unit: string // 如：条/个/次/卷
}
export interface PositionProgress {
  type: 'position'
  text: string
}
export type SequenceProgress = CountProgress | PositionProgress

// 进度节点：给数量型进度的某个数字绑定显示名（目录名/篇目名等）
// 当 current >= node.at 时，该节点为"当前节点"，在进度文本后追加显示
export interface ProgressNode {
  at: number // 到达该进度数字时触发（>= at）
  label: string // 节点名/目录名/篇目名
}

// 学习对象（存储形态） —— 语义上即「学习序列 Sequence」
// 一个学习方向下的具体学习内容，负责：目标 / 进度 / 完成判定 / 随机权重
// 例：阅读方向 → 左传 / 资治通鉴；绘画方向 → 线条训练 / 透视训练
// 旧字段 progress/progressUnit/progressTarget 保留用于向后兼容与迁移；
// 新代码读写优先使用 progressModel（数量型/位置型）。
export interface LearningObject {
  id: string
  name: string
  progress: string // 旧：当前进度自由文本（向后兼容，系统优先解析为数字）
  progressUnit: string // 旧：进度单位（如：卷、集、章），可选
  progressTarget: string // 旧：完成目标进度（如：10），可选；为空时不自动完成
  completed: boolean
  enabled: boolean // 是否参与随机接续（暂停=关闭）
  weight: number // 预留：加权随机使用
  // 倒计时模式：设置后学习会话从该时长倒计时，到 0 自动结束
  // null/undefined/0 = 正向计时（默认）
  countdownSeconds?: number | null
  // 新增：进度模型。旧数据迁移时由 progress/progressUnit/progressTarget 推导填充。
  // count 型 -> { type:'count', current, target, unit }
  // position 型 -> { type:'position', text }
  progressModel?: SequenceProgress
  // 进度节点：给数量型进度绑定的显示名列表（可选）
  // 有节点时，进度文本后追加当前节点名，如 "350 / 1000 条 · 隐公篇"
  progressNodes?: ProgressNode[]
}

// 学习序列 —— LearningObject 的语义别名（不引入第三层 Node）
export type Sequence = LearningObject

// 任务组 —— 学习方向下「多个学习序列」的容器与接续规则
export interface TaskGroup {
  id: string
  name: string
  mode: GroupMode // 默认顺序接续；控制 items(序列) 间接续
  items: LearningObject[] // 序列列表
}

// 任务（学习方向） —— 一个长期学习方向（如：阅读 / 绘画 / 建模 / 编程）
// 职责：是否启用、随机权重、提醒星期；本身不承担完成目标/进度。
// 完成判定由其下各 Sequence 自行负责（Sequence.completed）。
// status 字段保留用于旧逻辑兼容，但完成态不再以它为唯一依据。
export interface Task {
  id: string
  name: string
  icon: string // 用户选择的图标（emoji），作为学习方向的图标
  status: TaskStatus // 兼容字段；完成态以序列判定为准
  enabled: boolean // 是否启用（任务池入口开关）
  weight: number // 随机权重（加权随机预留；普通随机不使用）
  group: TaskGroup | null // 绑定的内容序列容器（暂保留，避免大范围迁移）
  currentObjectId: string | null // 当前学习序列 ID（指向 group.items）
  totalStudyTime: number // 累计学习时间（秒）
  createdAt: number
  updatedAt: number
  // 提醒星期（0=周日 … 6=周六）：该方向参与「次日计划」的星期；
  // 空数组或 undefined = 每天
  weekdays?: number[]
  // 应用放行（方向级，**增量**）：全局白名单之外的额外放行。
  // 最终放行集合 = 自动放行（本 App / 桌面 / 输入法 / 拨号 / 系统界面）
  //               ∪ AppData.globalAllowedApps ∪ 本字段 —— **只做加法，不做减法**。
  // 不在集合里的应用不提供入口（计时页不显示图标），越界时按 ReminderConfig.guardLevel 处理。
  allowedApps?: string[]
}

// 学习记录 —— 每次学习的快照
// 记录实际执行的 Sequence（学习序列），而非仅记录 Task（学习方向）
export interface StudyRecord {
  id: string
  taskId: string
  taskName: string
  // 旧字段保留（向后兼容）：与 sequenceId/sequenceName 同值
  objectId: string
  objectName: string
  // 新增：序列字段（记录实际执行的 Sequence）
  sequenceId?: string
  sequenceName?: string
  date: number // 时间戳
  duration: number // 学习时长（秒）
  startProgress: string // 数量型: "350"；位置型: "卷八十"
  endProgress: string // 数量型: "370"；位置型: "卷八十九"
  // 新增：本次完成数量（仅数量型序列有值，位置型为 undefined）
  deltaCount?: number
  // 新增：学习备注（可选，用户自由填写的备注/想法/总结）
  note?: string
}

// 整体数据形态
export interface AppData {
  tasks: Task[]
  records: StudyRecord[]
  reminder?: ReminderConfig
  // 次日计划（按日期存最近几天 + 明天），见 PlanDay
  plans?: PlanDay[]
  // 固定任务：被用户标星固定的方向/序列，每天自动进入计划，直到手动取消
  pinnedTasks?: PinnedTask[]
  // 应用池：曾选入过名单的应用元数据缓存（包名 → 应用名）。
  // 注意：这里只存元数据，**不带策略立场**——放行集合全部由方向级的 allowedApps
  // 与全局 globalAllowedApps 决定（v2 起没有黑名单，见 store.resolveAllowedApps）。
  // 避免「池里有立场、方向里也有立场」的双份真相。
  appPool?: AppEntry[]
  // 全局白名单：所有方向共用的放行应用（词典、识日这类「哪个方向都要用」的）。
  // 方向级 Task.allowedApps 是它的**增量**：两者取并集，**不做减法**
  // （一旦允许「方向级排除全局项」，就又出现「全局一份、方向一份」的双份真相）。
  globalAllowedApps?: string[]
}

// 应用元数据（包名唯一）
export interface AppEntry {
  packageName: string
  appName: string // 冗余存名：应用卸载后仍可显示
}

// 固定任务：某方向（可选绑定序列）被标星后，每天自动排进计划
export interface PinnedTask {
  taskId: string
  sequenceId?: string
}

// ===== 次日计划 =====
// 单个计划项：某天某时刻提醒某个方向（可选绑定序列与时长）
export interface PlanItem {
  id: string
  minuteOfDay: number // 计划时刻（当天 0-1439 分钟）
  taskId: string
  taskName: string // 冗余存储，方向改名/删除后仍可显示
  sequenceId?: string
  sequenceName?: string
  // 序列自带倒计时时记录时长（秒）；正向计时的序列不绑时长
  durationSec?: number | null
  status: 'pending' | 'done' | 'skipped'
  // 冲突延迟补发的目标触发时刻（ms）；由会话结束时写入，scheduleReminders 据此重排
  // 仅当大于原定时刻时生效；为空/过期则按原定逻辑处理。
  deferredAtMs?: number
  // 手动创建的计划页条目：每天顺延到当天列表，直到完成/跳过/删除
  manual?: boolean
  // 由过去某日顺延而来时，记录原日期（仅展示用）
  carriedFrom?: string
  // 仅提醒：不进计时会话，在计划页直接标记完成
  remindOnly?: boolean
  // 固定任务：被用户「标星固定」后每天自动进入计划，直到手动取消固定
  pinned?: boolean
}

// 一天的计划
export interface PlanDay {
  date: string // YYYY-MM-DD（本地时区）
  items: PlanItem[]
  generatedAt: number
}

// ===== 提醒功能 =====
// 唯一范式：次日计划。打开 App 时自动补齐今天剩余项 + 预生成明天。
// 参与与否由 Task.weekdays（方向自带星期）+ Task.enabled 决定。
export type PlanTiming = 'random' | 'interval'

// 单个时间窗口（分钟数 0-1439），支持跨夜（start > end，生成时按当日裁剪）
export interface TimeWindow {
  startMinute: number
  endMinute: number
}

export type NotificationIntensity = 'strong' | 'weak' | 'silent'

export interface ReminderConfig {
  enabled: boolean // 总开关
  // ---- 计划规模 ----
  planSessions: number // 每日方向数（每天随机排几个方向），1-12
  // ---- 时刻分布 ----
  planTiming: PlanTiming // random=窗口内随机时刻；interval=从窗口开始按固定间隔顺排
  intervalMinutes: number // 仅 interval 有效：相邻计划项间隔（分钟）
  cooldownMinutes: number // 仅 random 有效：相邻计划项最小间隔；也用作通知冷却
  // ---- 时间窗口（可多个，纯开始/结束）----
  windows: TimeWindow[] // 至少 1 个，最多 4 个
  // ---- 智能跳过 ----
  skipAfterSessionMinutes: number // 学习会话结束后 N 分钟内不提醒，0=关闭
  // ---- 冲突延迟 ----
  // 会话进行中、原定计划项到点时，延迟到本次会话结束后再补发（分钟）；
  // 0 = 不延迟（会话期间到点的项直接丢弃，旧行为）。补发时按"原顺序 + 每项错开 1 分钟"。
  deferMinutes: number
  // ---- 回归提醒（跨天留存）----
  // 连续 N 天未打开 App 时，系统推送一条"回来摸鱼"提醒；0 = 关闭
  reengageDays: number
  // ---- 计划提醒提前排程天数 ----
  // 排程窗口从「今天 + 明天」扩到「今天 + 未来 N 天」，使真实计划提醒能跨天触发（即便 App 多日未打开）
  planLookaheadDays: number
  // ---- 提醒强度 ----
  intensity: NotificationIntensity // strong=声音+震动；weak=静默响铃；silent=仅通知栏
  // ---- 越界管控（三档，默认关）----
  // 仅在学习计时进行中、本 App 在后台时，由原生前台服务轮询检测（见 StudyTimerService）。
  //   off  = 不检测（零轮询、零耗电）
  //   warn = 离开放行集合超过 guardGraceSeconds 就提醒
  //   pull = 同 warn，并尝试把 App 拉回前台（需悬浮窗权限；未授权时降级为 warn）
  // 放行集合 = 自动放行 ∪ 全局白名单 ∪ 方向额外放行（见 store.resolveAllowedApps）
  guardLevel?: GuardLevel
  // 宽限时间（秒）。用秒而不是分钟，是因为「离开 5 秒内不算」这种需求按分钟表达不了
  guardGraceSeconds?: number
}

export const DEFAULT_REMINDER: ReminderConfig = {
  enabled: false,
  planSessions: 4,
  planTiming: 'random',
  intervalMinutes: 90,
  cooldownMinutes: 30,
  windows: [{ startMinute: 9 * 60, endMinute: 22 * 60 }],
  skipAfterSessionMinutes: 60,
  deferMinutes: 2,
  reengageDays: 2,
  planLookaheadDays: 3,
  intensity: 'weak',
  guardLevel: 'off',
  guardGraceSeconds: 5,
}

// 星期标签（0=周日 … 6=周六），供 UI 与计划池筛选共用
export const WEEKDAY_LABELS: { label: string; value: number }[] = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 0 },
]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  paused: '暂停',
}

export const GROUP_MODE_LABELS: Record<GroupMode, string> = {
  sequential: '顺序接续',
  random: '随机选择',
  weighted_random: '加权随机',
}

export const GUARD_LEVEL_LABELS: Record<GuardLevel, string> = {
  off: '关闭',
  warn: '离开就提醒',
  pull: '离开就拉回',
}
