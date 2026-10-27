/**
 * 魔法风：咒语 / 魔法场所 / 法器 / 魔药 / 地牢 / 典籍。
 * 移植自 namegen/magic.py（Python 为准，本文件是有损快照）。
 *
 * 口径：不抄现有作品——famous 拉丁 + 中文双层黑名单建库即挂；咒语意译为主、音译为辅。
 */
import type { Rng } from './rng'
import { zhBlocked } from './filters'
import { transcribe } from './transcribe'
import { latinShapeOk } from './western'

// ── 黑名单 ──
export const FAMOUS_LATIN = new Set(
  (
    'avada kedavra imperio crucio expecto patronum expelliarmus obliviate ' +
    'leviosa wingardium sectumsempra lumos nox accio alohomora riddikulus ' +
    'silencio engorgio reducio impedimenta legilimens incendio mobiliarbus ' +
    'morsmordre finite incantatem'
  ).split(' '),
)

export const FAMOUS_ZH = new Set([
  '火球术', '寒冰箭', '烈焰风暴', '奥术飞弹', '炎爆术', '寒冰屏障', '寒冰箭雨',
  '变形术', '暗影箭', '灵魂虹吸', '生命吸取', '闪电链', '连锁闪电', '暴风雪',
  '末日审判', '神圣新星', '心灵尖啸', '法力燃烧', '陨石术', '治疗波', '恢复术',
  '阿瓦达索命', '阿瓦达', '钻心剜骨', '夺魂咒', '除你武器', '荧光闪烁',
  '呼神护卫', '速速禁锢', '昏昏倒地', '一忘皆空', '幻影移形',
  '贤者之石', '点金术', '复方汤剂', '福灵剂', '吐真剂', '死亡圣器',
])

// ── 工具 ──
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]

function wpick(rng: Rng, d: Record<string, number>): string {
  const ks = Object.keys(d)
  const total = ks.reduce((a, k) => a + d[k], 0)
  let r = rng() * total
  for (const k of ks) {
    r -= d[k]
    if (r < 0) return k
  }
  return ks[ks.length - 1]
}

/** 公共收尾：重字 / 长度 / 黑名单 / 屏蔽 / 去重 */
function accept(
  zh: string | null,
  used: Set<string>,
  lo: number,
  hi: number,
  famous?: Set<string>,
): string | null {
  if (!zh) return null
  if (new Set(zh).size !== [...zh].length) return null
  const len = [...zh].length
  if (len < lo || len > hi) return null
  if (famous && famous.has(zh)) return null
  if (zhBlocked(zh)) return null
  if (used.has(zh)) return null
  used.add(zh)
  return zh
}

// ── 咒语 ──
const IMG = [
  '烈焰', '寒霜', '暗影', '群星', '晨曦', '风暴', '缄默', '低语', '虚空', '苍雷',
  '晨星', '血月', '荒芜', '圣辉', '永夜', '幽荧', '翡翠', '焦土', '深渊', '静默',
  '回响', '荆棘', '蚀月', '坠阳', '星屑', '灰烬', '雾瘴', '磐音', '鎏金', '空鸣',
]
const TOOL = ['之手', '之箭', '之瞳', '之痕', '之唤', '之吻', '之环', '之盾', '之殇', '之缚', '之低语']
const VERB = ['坠落', '缠身', '燎原', '呼唤', '降临', '撕裂', '凝滞', '燃尽', '倾覆', '荡涤']
const FIELD = ['护盾', '领域', '结界', '屏障', '之幕', '之庭']

const S_STEMS = [
  'arcan', 'veth', 'zir', 'umbr', 'astron', 'nyx', 'caldr', 'morv', 'sylv', 'ithr',
  'vhal', 'qir', 'ozym', 'eldr', 'tembr', 'suvri', 'yrth', 'khael', 'phosr', 'nyss',
]
const S_MIDS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'oe']
const S_ENDS = ['us', 'um', 'ax', 'ys', 'iel', 'aan', 'or', 'eth', 'ir', 'is']

const VOW = new Set([...'aeiouy'])

/** 两段拼接：元音相撞去尾元，辅音挤成一团插链接元音（与 Python _join_pair 同逻辑） */
function joinPair(a: string, b: string, link: string): string {
  if (!b) return a
  const ae = a.slice(-1)
  const bs = b.slice(0, 1)
  if (VOW.has(ae) && VOW.has(bs)) return a.slice(0, -1) + b
  const tail = (a.match(/[^aeiouy]*$/) ?? [''])[0]
  const head = (b.match(/^[^aeiouy]*/) ?? [''])[0]
  if (tail.length + head.length >= 3) return a + link + b
  return a + b
}

function spellPlain(rng: Rng): string {
  const r = rng()
  if (r < 0.5) return pick(rng, IMG) + pick(rng, TOOL)
  if (r < 0.8) return pick(rng, IMG) + pick(rng, VERB)
  return pick(rng, IMG) + pick(rng, FIELD)
}

function spellLatin(rng: Rng): string | null {
  let l = pick(rng, S_STEMS)
  if (rng() < 0.45) l = joinPair(l, pick(rng, S_MIDS), 'a')
  l = joinPair(l, pick(rng, S_ENDS), 'a')
  if (!latinShapeOk(l) || FAMOUS_LATIN.has(l)) return null
  const zh = transcribe(l)
  if ([...zh].length < 3 || [...zh].length > 8) return null
  return zh
}

export function spell(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const zh = rng() < 0.75 ? spellPlain(rng) : spellLatin(rng)
    const z = accept(zh, used, 3, 8, FAMOUS_ZH)
    if (z) return z
  }
  return null
}

// ── 魔法场所 ──
const P_IMG = [
  '虚境', '低语', '永夜', '晨星', '倒悬', '缄默', '幽邃', '苍白', '琥珀', '灰烬',
  '星坠', '湮雾', '荒寂', '溯洄', '蚀空', '悬星', '白垩', '沉辉', '雾隐', '静渊',
]
const GEN_A: Record<string, number> = {
  塔: 3, 秘境: 2, 回廊: 2, 圣所: 2, 穹顶: 1.5, 裂隙: 1.5, 环廊: 1, 位面: 1, 尖顶: 1,
}
const GEN_B = ['之塔', '之井', '之门', '之环', '之阶', '之厅']
const P_PREF = ['倒悬', '永陷', '深藏', '半掩', '幽闭']

export function place(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const r = rng()
    let zh: string
    if (r < 0.55) zh = pick(rng, P_IMG) + wpick(rng, GEN_A)
    else if (r < 0.85) zh = pick(rng, P_IMG) + pick(rng, GEN_B)
    else zh = pick(rng, P_PREF) + pick(rng, P_IMG) + wpick(rng, GEN_A)
    const z = accept(zh, used, 3, 6)
    if (z) return z
  }
  return null
}

// ── 法器 ──
const A_TOOL = ['棱镜', '怀表', '罗盘', '水晶', '坠饰', '面具', '烛台', '铃', '匣', '镜', '沙漏', '钥匙']
const A_OF = ['之泪', '之低语', '之余烬', '之铃', '之钥', '之镜']
const A_STATE = ['沉睡', '倒转', '失语', '缄默', '碎裂', '无声', '半醒', '长眠']

export function item(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const r = rng()
    let zh: string
    if (r < 0.45) zh = pick(rng, P_IMG) + pick(rng, A_OF)
    else if (r < 0.75) zh = pick(rng, P_IMG) + pick(rng, A_TOOL)
    else zh = pick(rng, A_STATE) + '的' + pick(rng, A_TOOL)
    const z = accept(zh, used, 4, 6, FAMOUS_ZH)
    if (z) return z
  }
  return null
}

// ── 魔药 ──
const E_FX = ['沉睡', '安眠', '遗忘', '勇气', '狂喜', '净化', '通灵', '蛊惑', '回春', '幻听', '明目', '醒神']
const P_GEN = ['药剂', '露', '合剂', '香膏', '油', '酿']

export function potion(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const zh = rng() < 0.65 ? pick(rng, E_FX) + pick(rng, P_GEN) : pick(rng, P_IMG) + pick(rng, E_FX) + pick(rng, P_GEN)
    const z = accept(zh, used, 3, 6, FAMOUS_ZH)
    if (z) return z
  }
  return null
}

// ── 地牢 ──
const D_GEN: Record<string, number> = {
  墓穴: 3, 巢穴: 2.5, 监牢: 2, 深坑: 2, 裂谷: 2, 回廊: 1.5, 囚笼: 1.5, 地窟: 1.5, 古冢: 1, 墓道: 1,
}
const D_OF = ['之底', '之渊', '之喉', '之腹']

export function dungeon(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const r = rng()
    let zh: string
    if (r < 0.6) zh = pick(rng, P_IMG) + wpick(rng, D_GEN)
    else if (r < 0.85) zh = pick(rng, P_IMG) + pick(rng, D_OF)
    else zh = pick(rng, P_PREF) + wpick(rng, D_GEN)
    const z = accept(zh, used, 3, 6)
    if (z) return z
  }
  return null
}

// ── 典籍 ──
const T_GEN: Record<string, number> = {
  法典: 2.5, 之书: 2.5, 卷轴: 1.5, 典籍: 1.5, 手札: 1, 名录: 1, 秘典: 1, 札记: 1, 残卷: 1, 抄本: 1,
}

export function tome(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const zh = pick(rng, P_IMG) + wpick(rng, T_GEN)
    const z = accept(zh, used, 4, 6)
    if (z) return z
  }
  return null
}
