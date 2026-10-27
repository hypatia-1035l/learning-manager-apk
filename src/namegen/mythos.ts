/**
 * 神话生物名：神祇 / 龙 / 怪物图鉴。
 * 移植自 namegen/mythos.py（Python 为准，本文件是有损快照）。
 */
import type { Rng } from './rng'
import { zhBlocked } from './filters'
import { transcribe } from './transcribe'
import { latinShapeOk } from './western'

/** 现成龙名（冰火 / 霍比特 / 龙骑士系高频） */
export const FAMOUS_LATIN = new Set([
  'smaug', 'ancalagon', 'glaurung', 'alduin', 'paarthurnax',
  'drogon', 'viserion', 'rhaegal', 'saphira', 'temeraire',
])

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]

function accept(zh: string | null, used: Set<string>, lo: number, hi: number): string | null {
  if (!zh) return null
  if (new Set(zh).size !== [...zh].length) return null
  const len = [...zh].length
  if (len < lo || len > hi) return null
  if (zhBlocked(zh)) return null
  if (used.has(zh)) return null
  used.add(zh)
  return zh
}

// ── 神祇 ──
const D_IMG1 = ['鸦', '蛇', '渊', '月', '霜', '烬', '疫', '门', '眠', '沙', '缚', '晨']
const D_JOB_V = ['掌', '缝', '编', '饲', '数', '守', '织', '掩', '摇', '秤']
const D_JOB_N = ['雾', '线', '烛', '魂', '门', '谷', '铃', '沙', '潮', '灯']
const D_HIGH = ['之主', '之母', '之敌', '之王', '之父', '之女']
const D_HIGHN = ['缚星', '荒原', '群渊', '世界', '烬火', '暮色', '群星', '沉沙']

function deityPlain(rng: Rng): string {
  if (rng() < 0.6) return pick(rng, D_IMG1) + '神·' + pick(rng, D_JOB_V) + pick(rng, D_JOB_N) + '者'
  return pick(rng, D_HIGHN) + pick(rng, D_HIGH)
}

export function deity(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const z = accept(deityPlain(rng), used, 4, 9)
    if (z) return z
  }
  return null
}

// ── 龙 ──
const DR_STEMS = ['vhorag', 'ardyn', 'malgoth', 'skarn', 'uthral', 'zobek', 'morvag', 'ondris', 'kalzoth', 'bruvhar', 'eldraz', 'nyrveth']
const DR_TAILS = ['oth', 'ux', 'ath', 'or', 'ag', 'un']

function dragonName(rng: Rng): string | null {
  let l = pick(rng, DR_STEMS)
  if (rng() < 0.5) l += pick(rng, DR_TAILS)
  if (!latinShapeOk(l) || FAMOUS_LATIN.has(l)) return null
  const zh = transcribe(l)
  const len = [...zh].length
  if (len < 4 || len > 8) return null
  return zh
}

export function dragon(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    let zh = dragonName(rng)
    if (!zh) continue
    if (rng() < 0.6) zh += '·' + pick(rng, D_HIGHN) + pick(rng, D_HIGH)
    const z = accept(zh, used, 4, 12)
    if (z) return z
  }
  return null
}

// ── 怪物图鉴 ──
const M_VERB = ['食', '蚀', '惧', '饮', '织', '逐', '缠', '嗅']
const M_PREY = ['影', '骨', '梦', '火', '铃', '声', '露', '铁']
const M_HAB = ['沼地', '岩缝', '荒坟', '苔下', '沙底', '灰滩', '枯井', '裂岩']
const M_MOVE = ['爬行', '潜行', '巡游', '匍匐', '盘踞', '游荡']
const M_NUM = ['双头', '三目', '独足', '六眼', '九喉', '四臂', '无目']
const M_BASE = ['铃蛙', '蝾螈', '鹭', '蛛', '鳗', '蟹', '鸦', '鼬', '螳', '蛭']

function monsterPlain(rng: Rng): string {
  const r = rng()
  if (r < 0.35) return pick(rng, M_VERB) + pick(rng, M_PREY) + '者'
  if (r < 0.65) return pick(rng, M_HAB) + pick(rng, M_MOVE) + '者'
  return pick(rng, M_NUM) + pick(rng, M_BASE)
}

export function monster(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const z = accept(monsterPlain(rng), used, 3, 7)
    if (z) return z
  }
  return null
}
