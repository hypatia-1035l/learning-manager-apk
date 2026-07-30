// 随机工具箱数据结构（与学习系统完全独立、松耦合）

// ===== 数字随机：常用范围（独立，不纳入统一词库） =====
export interface NumberRange {
  id: string
  name: string
  min: number
  max: number
}

// ===== 统一词库系统 =====
// 词条：带权重，默认 1
export interface WordEntry {
  text: string
  weight: number // 默认 1，越大越易被选中
}

// 词库：所有随机功能（单抽/组合）的统一数据源
export interface WordBank {
  id: string
  name: string // 词库名，如「水果」
  category: string // 分类，如「日常生活」，空表示未分类
  enabled: boolean // 是否启用
  tags: string[] // 标签，用于筛选
  words: WordEntry[] // 词条列表
  createdAt: number
}

// 整体数据形态
export interface RandomData {
  ranges: NumberRange[]
  banks: WordBank[] // 统一词库
  presets: Preset[] // 随机预设
}

// 随机预设：保存常用词库组合
export interface Preset {
  id: string
  name: string // 预设名，如「插画灵感」
  bankIds: string[] // 关联的词库 ID 列表
  createdAt: number
}
