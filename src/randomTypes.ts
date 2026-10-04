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
  id: string // 稳定唯一标识（用于 React key 与增删改定位，避免按位置漂移）
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

// ===== 颜色随机 =====
// 采样模式：rgb=R/G/B 三通道独立；gray=明度联动（R=G=B）；hsl=色相/饱和度/明度
export type ColorMode = 'rgb' | 'gray' | 'hsl'

// 颜色范围：三通道 min/max，按 mode 解释
//   rgb:  c1=R(0-255)  c2=G(0-255)  c3=B(0-255)
//   gray: c1=明度(0-255)，c2/c3 忽略
//   hsl:  c1=H(0-360)  c2=S(0-100)  c3=L(0-100)
export interface ColorRange {
  id: string
  name: string
  mode: ColorMode
  c1Min: number
  c1Max: number
  c2Min: number
  c2Max: number
  c3Min: number
  c3Max: number
}

// ===== 随机记录：单次点击随机按钮的快照 =====
// type=number: 数字随机；type=wordbank: 词库随机；type=color: 颜色随机
// result 为本次抽取结果的可读文本（多个结果合并展示）
export interface RandomRecord {
  id: string
  type: 'number' | 'wordbank' | 'color'
  summary: string // 简短描述，如「1-100 整数 ×3」「水果+颜色」「全彩 ×3」
  result: string // 完整结果文本（多行用 \n 分隔）
  createdAt: number
}

// 整体数据形态
export interface RandomData {
  ranges: NumberRange[]
  colorRanges: ColorRange[] // 颜色随机常用范围
  banks: WordBank[] // 统一词库
  presets: Preset[] // 随机预设
  records: RandomRecord[] // 随机记录
}

// 随机预设：保存常用词库组合
export interface Preset {
  id: string
  name: string // 预设名，如「插画灵感」
  bankIds: string[] // 关联的词库 ID 列表
  createdAt: number
}
