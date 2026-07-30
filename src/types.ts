// 核心数据结构定义

// 任务类型：动态类型 ID（string）
// 内置类型 ID 固定，用户可新增自定义类型；删除类型时已用该类型的任务回退为 'custom'
export type TaskType = string

// 内置类型 ID（不可删除）
export const BUILTIN_TYPE_IDS = ['reading', 'video', 'practice', 'custom'] as const
export type BuiltinTypeId = (typeof BUILTIN_TYPE_IDS)[number]

// 任务状态
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'paused'

// 任务组模式：顺序接续 / 随机选择 / 加权随机（预留）
export type GroupMode = 'sequential' | 'random' | 'weighted_random'

// 学习对象 —— 任务组中的具体内容（如《左传》、Blender 第12课）
export interface LearningObject {
  id: string
  name: string
  type: string // 类型（自由文本，默认继承任务类型）
  progress: string // 当前进度，自由文本，系统不解析
  completed: boolean
  enabled: boolean // 是否参与随机接续（暂停=关闭）
  weight: number // 预留：加权随机使用
}

// 任务组 —— 管理具有前后关系的内容序列
export interface TaskGroup {
  id: string
  name: string
  mode: GroupMode // 默认顺序接续
  items: LearningObject[]
}

// 任务 —— 一个具体学习方向（如：历史阅读）
export interface Task {
  id: string
  name: string
  icon: string // 用户选择的图标（emoji）
  type: TaskType
  status: TaskStatus
  enabled: boolean // 是否启用（任务池入口开关）
  randomEnabled: boolean // 是否参与随机选择
  weight: number // 随机权重（加权随机预留；普通随机不使用）
  group: TaskGroup | null // 绑定的任务组
  currentObjectId: string | null // 当前学习对象（指向 group.items）
  totalStudyTime: number // 累计学习时间（秒）
  createdAt: number
  updatedAt: number
}

// 学习记录 —— 每次学习的快照
export interface StudyRecord {
  id: string
  taskId: string
  taskName: string
  objectId: string
  objectName: string
  date: number // 时间戳
  duration: number // 学习时长（秒）
  startProgress: string
  endProgress: string
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
  // 提醒时间窗（避免深夜打扰），24h 制
  startHour: number // 0-23
  endHour: number // 0-23
  // 参与提醒的具体任务 ID 白名单（空表示所有启用任务都参与）
  enabledTaskIds: string[]
}

export const DEFAULT_REMINDER: ReminderConfig = {
  enabled: false,
  intervalMinutes: 0,
  cooldownMinutes: 30,
  startHour: 9,
  endHour: 22,
  enabledTaskIds: [],
}

// 内置类型标签（动态类型的 fallback）
export const TASK_TYPE_LABELS: Record<string, string> = {
  reading: '阅读',
  video: '视频',
  practice: '练习',
  custom: '自定义',
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
