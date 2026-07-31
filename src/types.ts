// 核心数据结构定义

// 任务状态
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'paused'

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
// 职责：是否启用、是否参与随机、随机权重；本身不承担完成目标/进度。
// 完成判定由其下各 Sequence 自行负责（Sequence.completed）。
// status 字段保留用于旧逻辑兼容，但完成态不再以它为唯一依据。
export interface Task {
  id: string
  name: string
  icon: string // 用户选择的图标（emoji），作为学习方向的图标
  status: TaskStatus // 兼容字段；完成态以序列判定为准
  enabled: boolean // 是否启用（任务池入口开关）
  randomEnabled: boolean // 是否参与随机选择
  weight: number // 随机权重（加权随机预留；普通随机不使用）
  group: TaskGroup | null // 绑定的内容序列容器（暂保留，避免大范围迁移）
  currentObjectId: string | null // 当前学习序列 ID（指向 group.items）
  totalStudyTime: number // 累计学习时间（秒）
  createdAt: number
  updatedAt: number
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
}

// ===== 提醒功能 =====
// 提醒配置（独立存储，不影响任务/随机/计时逻辑）
// 间隔为 0 时按随机时机提醒，>0 时按固定间隔提醒
export interface ReminderConfig {
  enabled: boolean // 总开关
  intervalMinutes: number // 0=随机提醒；>0=固定间隔提醒（分钟）
  cooldownMinutes: number // 冷却时间，避免频繁打扰
  // 提醒时间窗（分钟精度，避免深夜打扰），0-1439
  startMinute: number // 如 540 = 9:00
  endMinute: number // 如 1320 = 22:00
  // 参与提醒的具体任务 ID 白名单（空表示所有启用任务都参与）
  enabledTaskIds: string[]
}

export const DEFAULT_REMINDER: ReminderConfig = {
  enabled: false,
  intervalMinutes: 0,
  cooldownMinutes: 30,
  startMinute: 9 * 60, // 540 = 9:00
  endMinute: 22 * 60, // 1320 = 22:00
  enabledTaskIds: [],
}

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
