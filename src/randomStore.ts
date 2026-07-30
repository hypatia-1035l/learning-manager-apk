import { useSyncExternalStore } from 'react'
import type {
  RandomData,
  NumberRange,
  WordBank,
  WordEntry,
  Preset,
} from './randomTypes'

// 独立的 LocalStorage key，与学习系统完全分离
const STORAGE_KEY = 'learning-manager:random-toolbox:v1'

const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// ---------- 旧数据迁移 ----------
interface LegacyData {
  ranges?: NumberRange[]
  textLists?: { id: string; name: string; items: string[]; createdAt: number }[]
  comboTemplates?: {
    id: string
    name: string
    banks: { id: string; name: string; items: string[] }[]
    separator: string
    createdAt: number
  }[]
  wheelTemplates?: {
    id: string
    name: string
    layers: { id: string; name: string; options: string[]; weights: number[] }[]
    createdAt: number
  }[]
  banks?: WordBank[]
  presets?: Preset[]
}

function migrateLegacy(raw: LegacyData): RandomData {
  const ranges = raw.ranges ?? []
  const banks: WordBank[] = []

  // 如果已有 banks 字段（新格式），补全缺失字段
  if (raw.banks && raw.banks.length > 0) {
    banks.push(
      ...raw.banks.map((b) => ({
        id: b.id ?? uid(),
        name: b.name ?? '未命名词库',
        category: b.category ?? '',
        enabled: b.enabled ?? true,
        tags: Array.isArray(b.tags) ? b.tags : [],
        createdAt: b.createdAt ?? Date.now(),
        words: (b.words ?? []).map((w: WordEntry | string) => ({
          text: typeof w === 'string' ? w : (w as WordEntry).text,
          weight: typeof w === 'object' && 'weight' in w ? (w as WordEntry).weight : 1,
        })),
      })),
    )
  }

  // 旧 TextList → WordBank
  if (raw.textLists) {
    for (const tl of raw.textLists) {
      if (banks.find((bk) => bk.id === tl.id)) continue
      banks.push({
        id: tl.id,
        name: tl.name,
        category: '',
        enabled: true,
        tags: [],
        words: tl.items.map((text) => ({ text, weight: 1 })),
        createdAt: tl.createdAt,
      })
    }
  }

  // 旧 ComboTemplate.banks → WordBank
  if (raw.comboTemplates) {
    for (const tpl of raw.comboTemplates) {
      for (const b of tpl.banks) {
        const bankId = `${tpl.id}_${b.id}`
        if (banks.find((bk) => bk.id === bankId)) continue
        banks.push({
          id: bankId,
          name: b.name,
          category: tpl.name,
          enabled: true,
          tags: [],
          words: b.items.map((text) => ({ text, weight: 1 })),
          createdAt: tpl.createdAt,
        })
      }
    }
  }

  // 旧 WheelTemplate.layers → WordBank
  if (raw.wheelTemplates) {
    for (const tpl of raw.wheelTemplates) {
      for (let i = 0; i < tpl.layers.length; i++) {
        const layer = tpl.layers[i]
        const bankId = `${tpl.id}_${layer.id}`
        if (banks.find((bk) => bk.id === bankId)) continue
        banks.push({
          id: bankId,
          name: layer.name || `${tpl.name} 第${i + 1}层`,
          category: tpl.name,
          enabled: true,
          tags: [],
          words: layer.options.map((text, idx) => ({
            text,
            weight: layer.weights?.[idx] ?? 1,
          })),
          createdAt: tpl.createdAt,
        })
      }
    }
  }

  // 预设迁移（如有）
  const presets: Preset[] = []
  if (raw.presets && raw.presets.length > 0) {
    presets.push(
      ...raw.presets.map((p) => ({
        id: p.id ?? uid(),
        name: p.name ?? '未命名预设',
        bankIds: Array.isArray(p.bankIds) ? p.bankIds : [],
        createdAt: p.createdAt ?? Date.now(),
      })),
    )
  }

  return { ranges, banks, presets }
}

function load(): RandomData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LegacyData
      return migrateLegacy(parsed)
    }
  } catch {
    /* ignore */
  }
  return { ranges: [], banks: [], presets: [] }
}

let state: RandomData = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore quota */
  }
}

function setState(updater: (prev: RandomData) => RandomData) {
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

export function useRandomData(): RandomData {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// ---------- 纯随机工具函数 ----------
export function randInt(min: number, max: number): number {
  if (max < min) [min, max] = [max, min]
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function randNum(min: number, max: number, decimals: number): number {
  if (max < min) [min, max] = [max, min]
  const v = Math.random() * (max - min) + min
  if (decimals <= 0) return Math.floor(v)
  const factor = Math.pow(10, decimals)
  return Math.round(v * factor) / factor
}

export function pickOne<T>(arr: T[]): T | null {
  if (!arr.length) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

export function pickWeighted(entries: WordEntry[]): WordEntry | null {
  if (!entries.length) return null
  const weighted = entries.filter((e) => e.weight > 0)
  if (weighted.length === 0) {
    return entries[Math.floor(Math.random() * entries.length)]
  }
  const total = weighted.reduce((s, e) => s + e.weight, 0)
  let r = Math.random() * total
  for (const e of weighted) {
    r -= e.weight
    if (r <= 0) return e
  }
  return weighted[weighted.length - 1]
}

// ---------- 数字范围 CRUD ----------
export function addRange(input: { name: string; min: number; max: number }) {
  const r: NumberRange = {
    id: uid(),
    name: input.name.trim() || '未命名范围',
    min: input.min,
    max: input.max,
  }
  setState((p) => ({ ...p, ranges: [...p.ranges, r] }))
  return r
}

export function updateRange(id: string, patch: Partial<NumberRange>) {
  setState((p) => ({
    ...p,
    ranges: p.ranges.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }))
}

export function deleteRange(id: string) {
  setState((p) => ({ ...p, ranges: p.ranges.filter((r) => r.id !== id) }))
}

// ---------- 词库 CRUD ----------
export function addBank(input: {
  name: string
  category?: string
  tags?: string[]
}): WordBank {
  const b: WordBank = {
    id: uid(),
    name: input.name.trim() || '未命名词库',
    category: input.category?.trim() ?? '',
    enabled: true,
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => t.trim()) : [],
    words: [],
    createdAt: Date.now(),
  }
  setState((p) => ({ ...p, banks: [...p.banks, b] }))
  return b
}

export function updateBank(id: string, patch: Partial<WordBank>) {
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  }))
}

export function deleteBank(id: string) {
  setState((p) => {
    // 删除词库时，同步清除预设中对该词库的引用
    const newPresets = p.presets.map((pre) => ({
      ...pre,
      bankIds: pre.bankIds.filter((bid) => bid !== id),
    }))
    return {
      ...p,
      banks: p.banks.filter((b) => b.id !== id),
      presets: newPresets,
    }
  })
}

// ---------- 词条 CRUD ----------
export function addWord(bankId: string, text: string, weight = 1) {
  if (!text.trim()) return
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) =>
      b.id === bankId
        ? { ...b, words: [...b.words, { text: text.trim(), weight }] }
        : b,
    ),
  }))
}

export function updateWord(
  bankId: string,
  index: number,
  patch: Partial<WordEntry>,
) {
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) =>
      b.id === bankId
        ? {
            ...b,
            words: b.words.map((w, i) =>
              i === index ? { ...w, ...patch } : w,
            ),
          }
        : b,
    ),
  }))
}

export function deleteWord(bankId: string, index: number) {
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) =>
      b.id === bankId
        ? { ...b, words: b.words.filter((_, i) => i !== index) }
        : b,
    ),
  }))
}

// ---------- 批量导入解析 ----------
export interface ImportPreview {
  entries: WordEntry[]
  duplicates: number
}

export function parseImportText(
  text: string,
  existingTexts: string[] = [],
): ImportPreview {
  const seen = new Set(existingTexts.map((t) => t.trim()))
  const entries: WordEntry[] = []
  let duplicates = 0

  const lines = text.split('\n').map((l) => l.trim())

  for (const line of lines) {
    if (!line) continue

    const pipeIdx = line.search(/[|｜]/)
    let textPart = line
    let weight = 1

    if (pipeIdx > 0) {
      textPart = line.slice(0, pipeIdx).trim()
      const weightStr = line.slice(pipeIdx + 1).trim()
      const parsed = parseInt(weightStr, 10)
      if (!isNaN(parsed) && parsed > 0) weight = parsed
    }

    if (pipeIdx < 0) {
      const subParts = textPart.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean)
      if (subParts.length > 1) {
        for (const part of subParts) {
          if (seen.has(part)) {
            duplicates++
            continue
          }
          seen.add(part)
          entries.push({ text: part, weight: 1 })
        }
        continue
      }
    }

    if (!textPart) continue
    if (seen.has(textPart)) {
      duplicates++
      continue
    }
    seen.add(textPart)
    entries.push({ text: textPart, weight })
  }

  return { entries, duplicates }
}

export function batchImportWords(
  bankId: string,
  text: string,
): ImportPreview {
  const bank = state.banks.find((b) => b.id === bankId)
  const existingTexts = bank?.words.map((w) => w.text) ?? []
  const preview = parseImportText(text, existingTexts)

  if (preview.entries.length > 0) {
    setState((p) => ({
      ...p,
      banks: p.banks.map((b) =>
        b.id === bankId
          ? { ...b, words: [...b.words, ...preview.entries] }
          : b,
      ),
    }))
  }

  return preview
}

// ---------- 预设 CRUD ----------
export function addPreset(input: {
  name: string
  bankIds: string[]
}): Preset {
  const p: Preset = {
    id: uid(),
    name: input.name.trim() || '未命名预设',
    bankIds: Array.isArray(input.bankIds) ? input.bankIds : [],
    createdAt: Date.now(),
  }
  setState((prev) => ({ ...prev, presets: [...prev.presets, p] }))
  return p
}

export function updatePreset(id: string, patch: Partial<Preset>) {
  setState((p) => ({
    ...p,
    presets: p.presets.map((pre) =>
      pre.id === id ? { ...pre, ...patch } : pre,
    ),
  }))
}

export function deletePreset(id: string) {
  setState((p) => ({
    ...p,
    presets: p.presets.filter((pre) => pre.id !== id),
  }))
}

// ---------- 辅助查询 ----------
export function getAllCategories(banks: WordBank[]): string[] {
  const set = new Set<string>()
  for (const b of banks) if (b.category) set.add(b.category)
  return Array.from(set).sort()
}

export function getAllTags(banks: WordBank[]): string[] {
  const set = new Set<string>()
  for (const b of banks) for (const t of b.tags) if (t.trim()) set.add(t.trim())
  return Array.from(set).sort()
}

export function filterBanksByCategory(
  banks: WordBank[],
  category: string,
): WordBank[] {
  if (!category) return banks
  return banks.filter((b) => b.category === category)
}

export function filterBanksByTag(
  banks: WordBank[],
  tag: string,
): WordBank[] {
  if (!tag) return banks
  return banks.filter((b) => b.tags.some((t) => t.trim() === tag.trim()))
}

// ---------- 导入 / 导出 ----------
// 单个词库导出格式
export interface ExportedBank {
  name: string
  category: string
  tags?: string[]
  words: { text: string; weight: number }[]
}

// 全量导出格式
export interface ExportedAll {
  ranges: NumberRange[]
  banks: ExportedBank[]
  presets: { name: string; bankIds: string[] }[]
}

// 导出单个词库 → JSON 字符串（含名称、分类、标签、词条+权重，不含 id）
export function exportBank(bankId: string): string | null {
  const b = state.banks.find((x) => x.id === bankId)
  if (!b) return null
  const data: ExportedBank = {
    name: b.name,
    category: b.category,
    tags: b.tags,
    words: b.words.map((w) => ({ text: w.text, weight: w.weight })),
  }
  return JSON.stringify(data, null, 2)
}

// 导出全部 → JSON 字符串
export function exportAll(): string {
  const data: ExportedAll = {
    ranges: state.ranges,
    banks: state.banks.map((b) => ({
      name: b.name,
      category: b.category,
      tags: b.tags,
      words: b.words.map((w) => ({ text: w.text, weight: w.weight })),
    })),
    presets: state.presets.map((p) => ({
      name: p.name,
      bankIds: p.bankIds,
    })),
  }
  return JSON.stringify(data, null, 2)
}

// 解析传入的 JSON，判断是单库还是全量格式
export type ImportedFormat =
  | { type: 'bank'; data: ExportedBank }
  | { type: 'all'; data: ExportedAll }
  | { type: 'invalid'; error: string }

export function detectImportFormat(raw: string): ImportedFormat {
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') {
      return { type: 'invalid', error: '不是有效的 JSON 对象' }
    }
    if ('banks' in obj && Array.isArray(obj.banks)) {
      // 全量备份
      const d = obj as ExportedAll
      return { type: 'all', data: d }
    }
    if ('words' in obj && Array.isArray(obj.words)) {
      // 单词库
      const d = obj as ExportedBank
      return { type: 'bank', data: d }
    }
    return { type: 'invalid', error: '未识别的 JSON 格式：缺少 banks 或 words 字段' }
  } catch (e) {
    return { type: 'invalid', error: 'JSON 解析失败：' + (e as Error).message }
  }
}

// 导入单个词库（按名称去重，同名称不覆盖，创建新库）
export function importBank(data: ExportedBank): WordBank {
  const newName = data.name?.trim() || '导入的词库'
  const category = data.category?.trim() ?? ''
  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t).trim()).filter(Boolean)
    : []
  const words: WordEntry[] = Array.isArray(data.words)
    ? data.words
        .map((w) => ({
          text: String(w?.text ?? '').trim(),
          weight: typeof w?.weight === 'number' && w.weight > 0 ? w.weight : 1,
        }))
        .filter((w) => w.text)
    : []
  const b: WordBank = {
    id: uid(),
    name: newName,
    category,
    enabled: true,
    tags,
    words,
    createdAt: Date.now(),
  }
  setState((p) => ({ ...p, banks: [...p.banks, b] }))
  return b
}

// 导入全量备份（词库按名称去重不覆盖；预设如果引用到导入的词库则按名称匹配）
export interface ImportAllResult {
  addedBanks: number
  skippedBanks: number
  addedPresets: number
  skippedPresets: number
  addedRanges: number
  skippedRanges: number
  bankIds: string[] // 新增的词库 id（供后续勾选）
}

export function importAll(data: ExportedAll): ImportAllResult {
  const result: ImportAllResult = {
    addedBanks: 0,
    skippedBanks: 0,
    addedPresets: 0,
    skippedPresets: 0,
    addedRanges: 0,
    skippedRanges: 0,
    bankIds: [],
  }

  const existingBankNames = new Set(state.banks.map((b) => b.name))
  const existingRangeKeys = new Set(
    state.ranges.map((r) => `${r.name}|${r.min}|${r.max}`),
  )

  // 1. 导入词库（名称去重，记录名→新 id 映射）
  const nameToId = new Map<string, string>()
  const newBanks: WordBank[] = []
  if (Array.isArray(data.banks)) {
    for (const bk of data.banks) {
      const name = bk.name?.trim() || '导入的词库'
      if (existingBankNames.has(name)) {
        result.skippedBanks++
        // 仍然记录现有库的 id 用于预设映射
        const exist = state.banks.find((x) => x.name === name)
        if (exist) nameToId.set(name, exist.id)
        continue
      }
      const category = bk.category?.trim() ?? ''
      const tags = Array.isArray(bk.tags)
        ? bk.tags.map((t) => String(t).trim()).filter(Boolean)
        : []
      const words: WordEntry[] = Array.isArray(bk.words)
        ? bk.words
            .map((w) => ({
              text: String(w?.text ?? '').trim(),
              weight:
                typeof w?.weight === 'number' && w.weight > 0 ? w.weight : 1,
            }))
            .filter((w) => w.text)
        : []
      const newId = uid()
      nameToId.set(name, newId)
      newBanks.push({
        id: newId,
        name,
        category,
        enabled: true,
        tags,
        words,
        createdAt: Date.now(),
      })
      result.addedBanks++
      result.bankIds.push(newId)
    }
  }

  // 2. 导入 ranges（按 name+min+max 去重）
  const newRanges: NumberRange[] = []
  if (Array.isArray(data.ranges)) {
    for (const r of data.ranges) {
      const key = `${r.name?.trim() || '未命名范围'}|${r.min}|${r.max}`
      if (existingRangeKeys.has(key)) {
        result.skippedRanges++
        continue
      }
      newRanges.push({
        id: uid(),
        name: r.name?.trim() || '未命名范围',
        min: r.min,
        max: r.max,
      })
      result.addedRanges++
    }
  }

  // 3. 导入 presets（按名称去重，bankIds 通过名称→新id 映射）
  const existingPresetNames = new Set(state.presets.map((p) => p.name))
  const newPresets: Preset[] = []
  if (Array.isArray(data.presets)) {
    for (const pre of data.presets) {
      const name = pre.name?.trim() || '导入的预设'
      if (existingPresetNames.has(name)) {
        result.skippedPresets++
        continue
      }
      const bankIds: string[] = []
      if (Array.isArray(pre.bankIds)) {
        for (const bidOrName of pre.bankIds) {
          // 先按 id 查，再按名称映射
          const existing = state.banks.find((x) => x.id === bidOrName)
          if (existing) {
            bankIds.push(existing.id)
            continue
          }
          const mapped = nameToId.get(bidOrName)
          if (mapped) {
            bankIds.push(mapped)
            continue
          }
          const byName = state.banks.find((x) => x.name === bidOrName)
          if (byName) bankIds.push(byName.id)
        }
      }
      newPresets.push({
        id: uid(),
        name,
        bankIds,
        createdAt: Date.now(),
      })
      result.addedPresets++
    }
  }

  // 4. 应用变更
  setState((p) => ({
    ranges: [...p.ranges, ...newRanges],
    banks: [...p.banks, ...newBanks],
    presets: [...p.presets, ...newPresets],
  }))

  return result
}
