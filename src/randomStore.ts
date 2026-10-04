import { useSyncExternalStore } from 'react'
import type {
  RandomData,
  NumberRange,
  ColorRange,
  WordBank,
  WordEntry,
  Preset,
  RandomRecord,
} from './randomTypes'

// 独立的 LocalStorage key，与学习系统完全分离
const STORAGE_KEY = 'learning-manager:random-toolbox:v1'

// 随机记录保留上限：超过自动截断旧记录，避免长期使用无限增长
const MAX_RANDOM_RECORDS = 200

// 内置预设词库标记：首次启动写入一次，用户可自由编辑删除
const SEED_KEY = 'learning-manager:random-seeded:v1'

// ---------- 内置预设词库 ----------
// 首次使用自动填充，用户可自由编辑/删除，不会被重复填充
const SEED_BANKS: Array<{
  name: string
  category: string
  tags: string[]
  words: Array<{ text: string; weight?: number }>
}> = [  {
    name: '今天吃啥',
    category: '日常',
    tags: ['吃货'],
    words: [
      { text: '米饭 + 炒菜' },
      { text: '面条' },
      { text: '饺子' },
      { text: '汉堡' },
      { text: '披萨' },
      { text: '寿司' },
      { text: '麻辣烫' },
      { text: '黄焖鸡' },
      { text: '螺蛳粉' },
      { text: '兰州拉面' },
      { text: '沙县小吃' },
      { text: '盖浇饭' },
      { text: '煎饼果子' },
      { text: '肉夹馍' },
      { text: '凉皮' },
      { text: '炒饭' },
      { text: '冒菜' },
      { text: '炸鸡' },
      { text: '烤肉' },
      { text: '火锅' },
      { text: '便利店饭团' },
      { text: '沙拉' },
      { text: '三明治' },
      { text: '越南粉' },
      { text: '咖喱饭' },
    ],
  },
  {
    name: '这不是迟到这只是',
    category: '摸鱼',
    tags: ['借口'],
    words: [
      { text: '地铁延误了' },
      { text: '闹钟没响' },
      { text: '公交堵车' },
      { text: '肚子不舒服' },
      { text: '电梯坏了，爬楼梯上来的' },
      { text: '手机充一晚电自动关机了' },
      { text: '出门发现钥匙忘带了' },
      { text: '帮你带了早餐，排队等了会儿' },
      { text: '昨天加班太晚，起猛了' },
      { text: '路由器重启了一下' },
      { text: '路上扶老奶奶过马路' },
      { text: '电动车没电了，推过来的' },
    ],
  },
  {
    name: '摸鱼借口',
    category: '摸鱼',
    tags: ['借口'],
    words: [
      { text: '上厕所' },
      { text: '接杯水' },
      { text: '看窗外放松眼睛' },
      { text: '活动颈椎' },
      { text: '找同事对一下需求' },
      { text: '脑子卡了，换个环境想想' },
      { text: '去楼下透透气' },
      { text: '泡杯咖啡' },
      { text: '伸个懒腰' },
      { text: '整理一下桌面' },
      { text: '查个资料' },
      { text: '等编译，趁机摸一把' },
      { text: '去茶水间看看有没有零食' },
      { text: '闭眼冥想五分钟' },
      { text: '盯着屏幕发呆思考人生' },
    ],
  },
]

// ---------- 内置预设颜色范围 ----------
// 首次使用自动填充，用户可自由编辑/删除，不会被重复填充
const SEED_COLOR_RANGES: Array<Omit<ColorRange, 'id'>> = [
  { name: '全彩', mode: 'rgb', c1Min: 0, c1Max: 255, c2Min: 0, c2Max: 255, c3Min: 0, c3Max: 255 },
  { name: '灰阶', mode: 'gray', c1Min: 0, c1Max: 255, c2Min: 0, c2Max: 255, c3Min: 0, c3Max: 255 },
  { name: '暖色', mode: 'rgb', c1Min: 160, c1Max: 255, c2Min: 40, c2Max: 160, c3Min: 20, c3Max: 110 },
  { name: '冷色', mode: 'rgb', c1Min: 20, c1Max: 110, c2Min: 90, c2Max: 190, c3Min: 160, c3Max: 255 },
  { name: '莫兰迪', mode: 'hsl', c1Min: 0, c1Max: 360, c2Min: 15, c2Max: 40, c3Min: 55, c3Max: 80 },
  { name: '鲜艳', mode: 'hsl', c1Min: 0, c1Max: 360, c2Min: 75, c2Max: 100, c3Min: 45, c3Max: 65 },
]

const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// 创建带稳定 id 的词条（所有词条创建统一经此，保证 id 不缺失）
const mkWord = (text: string, weight = 1): WordEntry => ({
  id: uid(),
  text,
  weight,
})

// 把任意来源的"词条"规整为带 id 的 WordEntry（兼容旧数据字符串/缺 id 对象）
function normalizeWord(w: WordEntry | string): WordEntry {
  if (typeof w === 'string') return mkWord(w, 1)
  return {
    id: typeof w.id === 'string' && w.id ? w.id : uid(),
    text: w.text,
    weight: typeof w.weight === 'number' && w.weight > 0 ? w.weight : 1,
  }
}

// ---------- 旧数据迁移 ----------
interface LegacyData {
  ranges?: NumberRange[]
  colorRanges?: ColorRange[]
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
  const colorRanges = (raw.colorRanges ?? []).map((r) => ({
    ...r,
    id: r.id ?? uid(),
  }))
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
        words: (b.words ?? []).map((w: WordEntry | string) => normalizeWord(w)),
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
        words: tl.items.map((text) => mkWord(text, 1)),
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
          words: b.items.map((text) => mkWord(text, 1)),
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
          words: layer.options.map((text, idx) => mkWord(text, layer.weights?.[idx] ?? 1)),
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

  return { ranges, colorRanges, banks, presets, records: [] }
}

function load(): RandomData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LegacyData & { records?: RandomRecord[] }
      const migrated = migrateLegacy(parsed)
      // 旧数据可能无 records 字段，补默认空数组
      if (!Array.isArray(parsed.records)) {
        migrated.records = []
      } else {
        // 防御性清理：按时间降序排序后截断到上限
        // 旧版本数据可能超过 MAX_RANDOM_RECORDS 或顺序紊乱，这里统一规整
        migrated.records = trimRecords(parsed.records)
      }
      // 首次启动填充内置预设词库
      seedDefaults(migrated)
      return migrated
    }
  } catch {
    /* ignore */
  }
  // 全新用户：填充内置预设词库
  const fresh: RandomData = { ranges: [], colorRanges: [], banks: [], presets: [], records: [] }
  seedDefaults(fresh)
  return fresh
}

// 首次使用时填充内置预设（词库 + 颜色范围，仅执行一次，由 SEED_KEY 标记）
// 用户可自由编辑/删除，不会被重复填充
function seedDefaults(data: RandomData): void {
  try {
    if (localStorage.getItem(SEED_KEY)) return
  } catch {
    return
  }
  const newBanks: WordBank[] = SEED_BANKS.map((s) => ({
    id: uid(),
    name: s.name,
    category: s.category,
    enabled: true,
    tags: s.tags,
    words: s.words.map((w) => mkWord(w.text, w.weight ?? 1)),
    createdAt: Date.now(),
  }))
  data.banks = [...data.banks, ...newBanks]
  data.colorRanges = [...data.colorRanges, ...SEED_COLOR_RANGES.map((s) => ({ ...s, id: uid() }))]
  try {
    localStorage.setItem(SEED_KEY, '1')
  } catch {
    /* ignore */
  }
}

// 按时间降序排序并截断到 MAX_RANDOM_RECORDS，避免长期使用数据无限增长
function trimRecords(records: RandomRecord[]): RandomRecord[] {
  if (!records.length) return []
  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt)
  if (sorted.length <= MAX_RANDOM_RECORDS) return sorted
  sorted.length = MAX_RANDOM_RECORDS
  return sorted
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

// 上次抽到的词条 id（按词库），用于"不连抽"；会话级内存态，不落盘
const lastPickedWordIds = new Map<string, string>()

export function getLastPickedWordId(bankId: string): string | null {
  return lastPickedWordIds.get(bankId) ?? null
}

export function setLastPickedWordId(bankId: string, wordId: string): void {
  lastPickedWordIds.set(bankId, wordId)
}

export function clearLastPickedWordIds(): void {
  lastPickedWordIds.clear()
}

// 加权随机；exclude 为要排除的词条 id 集合（用于"不连抽"）
export function pickWeighted(
  entries: WordEntry[],
  exclude?: Set<string> | null,
): WordEntry | null {
  if (!entries.length) return null
  let pool = entries.filter(
    (e) => e.weight > 0 && !(exclude && exclude.has(e.id)),
  )
  if (pool.length === 0) {
    // 排除后池子空了（如仅 1 个词条），回退到不排除，保证总能抽到
    pool = entries.filter((e) => e.weight > 0)
  }
  if (pool.length === 0) {
    return entries[Math.floor(Math.random() * entries.length)]
  }
  const total = pool.reduce((s, e) => s + e.weight, 0)
  let r = Math.random() * total
  for (const e of pool) {
    r -= e.weight
    if (r <= 0) return e
  }
  return pool[pool.length - 1]
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

// ---------- 颜色随机 ----------
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

// HSL → RGB（h 0-360，s/l 0-100），返回 0-255 整数三元组
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const S = Math.max(0, Math.min(100, s)) / 100
  const L = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * L - 1)) * S
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) { r = c; g = x }
  else if (hp < 2) { r = x; g = c }
  else if (hp < 3) { g = c; b = x }
  else if (hp < 4) { g = x; b = c }
  else if (hp < 5) { r = x; b = c }
  else { r = c; b = x }
  const m = L - c / 2
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)]
}

// RGB → 十六进制色码（大写，如 #A3F2C1）
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp255(v).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

// 在颜色范围内随机一色：按 mode 解释三通道；gray 模式三通道联动
export function randColorInRange(
  range: Omit<ColorRange, 'id' | 'name'>,
): { r: number; g: number; b: number; hex: string } {
  if (range.mode === 'gray') {
    const v = randInt(clamp255(range.c1Min), clamp255(range.c1Max))
    return { r: v, g: v, b: v, hex: rgbToHex(v, v, v) }
  }
  if (range.mode === 'hsl') {
    const h = randInt(
      Math.max(0, Math.min(360, range.c1Min)),
      Math.max(0, Math.min(360, range.c1Max)),
    )
    const s = randInt(Math.max(0, Math.min(100, range.c2Min)), Math.max(0, Math.min(100, range.c2Max)))
    const l = randInt(Math.max(0, Math.min(100, range.c3Min)), Math.max(0, Math.min(100, range.c3Max)))
    const [r, g, b] = hslToRgb(h, s, l)
    return { r, g, b, hex: rgbToHex(r, g, b) }
  }
  const r = randInt(clamp255(range.c1Min), clamp255(range.c1Max))
  const g = randInt(clamp255(range.c2Min), clamp255(range.c2Max))
  const b = randInt(clamp255(range.c3Min), clamp255(range.c3Max))
  return { r, g, b, hex: rgbToHex(r, g, b) }
}

// ---------- 颜色范围 CRUD ----------
export function addColorRange(input: Omit<ColorRange, 'id'>): ColorRange {
  const r: ColorRange = { ...input, id: uid(), name: input.name.trim() || '未命名范围' }
  setState((p) => ({ ...p, colorRanges: [...p.colorRanges, r] }))
  return r
}

export function updateColorRange(id: string, patch: Partial<Omit<ColorRange, 'id'>>) {
  setState((p) => ({
    ...p,
    colorRanges: p.colorRanges.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }))
}

export function deleteColorRange(id: string) {
  setState((p) => ({ ...p, colorRanges: p.colorRanges.filter((r) => r.id !== id) }))
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
// 用文本行批量覆写/追加词库词条（文本工具「存回词库」用）
// 追加模式跳过与现有词条同名的行；覆写模式整库替换（权重归 1，不保留）
export function writeBankWords(
  bankId: string,
  texts: string[],
  mode: 'overwrite' | 'append',
): { written: number; skipped: number } {
  const bank = state.banks.find((b) => b.id === bankId)
  if (!bank) return { written: 0, skipped: 0 }
  const existing = new Set(mode === 'append' ? bank.words.map((w) => w.text) : [])
  const out = mode === 'append' ? [...bank.words] : []
  let written = 0
  let skipped = 0
  for (const t of texts) {
    const text = t.trim()
    if (!text) continue
    if (existing.has(text)) {
      skipped++
      continue
    }
    existing.add(text)
    out.push(mkWord(text, 1))
    written++
  }
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) => (b.id === bankId ? { ...b, words: out } : b)),
  }))
  return { written, skipped }
}

export function addWord(bankId: string, text: string, weight = 1) {
  if (!text.trim()) return
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) =>
      b.id === bankId
        ? { ...b, words: [...b.words, mkWord(text.trim(), weight)] }
        : b,
    ),
  }))
}

export function updateWord(
  bankId: string,
  wordId: string,
  patch: Partial<WordEntry>,
) {
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) =>
      b.id === bankId
        ? {
            ...b,
            words: b.words.map((w) =>
              w.id === wordId ? { ...w, ...patch } : w,
            ),
          }
        : b,
    ),
  }))
}

export function deleteWord(bankId: string, wordId: string) {
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) =>
      b.id === bankId
        ? { ...b, words: b.words.filter((w) => w.id !== wordId) }
        : b,
    ),
  }))
}

// 批量删除词条（一次落盘，避免逐个 deleteWord 造成 N 次持久化）
export function deleteWords(bankId: string, wordIds: string[]) {
  if (!wordIds.length) return
  const del = new Set(wordIds)
  setState((p) => ({
    ...p,
    banks: p.banks.map((b) =>
      b.id === bankId ? { ...b, words: b.words.filter((w) => !del.has(w.id)) } : b,
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
          entries.push(mkWord(part, 1))
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
    entries.push(mkWord(textPart, weight))
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

// ---------- 随机记录 CRUD ----------
// 新增随机记录；默认只保留最近 MAX_RANDOM_RECORDS 条，超出自动截断
export function addRandomRecord(input: {
  type: 'number' | 'wordbank' | 'color'
  summary: string
  result: string
}): RandomRecord {
  const rec: RandomRecord = {
    id: uid(),
    type: input.type,
    summary: input.summary,
    result: input.result,
    createdAt: Date.now(),
  }
  setState((p) => {
    // 复用 trimRecords：统一排序 + 截断到 MAX_RANDOM_RECORDS，与 load 路径行为一致
    const next = trimRecords([rec, ...p.records])
    return { ...p, records: next }
  })
  return rec
}

// 清空记录；type 为空时清空全部
export function clearRandomRecords(type?: 'number' | 'wordbank' | 'color') {
  setState((p) => ({
    ...p,
    records: type ? p.records.filter((r) => r.type !== type) : [],
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
  // bankNames：导出时附带词库名，导入端据此跨环境解析。
  // bankIds 是本地 id，仅在原设备有效，保留以兼容旧导出文件。
  presets: { name: string; bankIds: string[]; bankNames?: string[] }[]
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
      // 只导 id 的话，换环境导入后预设的 bankIds 会静默丢空
      bankNames: p.bankIds
        .map((id) => state.banks.find((b) => b.id === id)?.name)
        .filter((n): n is string => !!n),
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
          id: typeof (w as WordEntry)?.id === 'string' && (w as WordEntry).id ? (w as WordEntry).id : uid(),
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
              id: typeof (w as WordEntry)?.id === 'string' && (w as WordEntry).id ? (w as WordEntry).id : uid(),
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
      // 优先 bankNames（跨环境可靠）；旧文件只有 bankIds，按 id→名称 顺序兜底
      const keys: string[] =
        Array.isArray(pre.bankNames) && pre.bankNames.length
          ? pre.bankNames
          : Array.isArray(pre.bankIds)
            ? pre.bankIds
            : []
      for (const key of keys) {
        const resolved =
          nameToId.get(key) ??
          state.banks.find((x) => x.id === key)?.id ??
          state.banks.find((x) => x.name === key)?.id
        if (resolved && !bankIds.includes(resolved)) bankIds.push(resolved)
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
    ...p,
    ranges: [...p.ranges, ...newRanges],
    banks: [...p.banks, ...newBanks],
    presets: [...p.presets, ...newPresets],
  }))

  return result
}
