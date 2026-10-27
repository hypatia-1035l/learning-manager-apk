/**
 * RPG 风味名：称号 / 酒馆 / 街区 / 菜单 / 舰船 / 历法。
 * 移植自 namegen/flavor.py（Python 为准，本文件是有损快照）。
 */
import type { Rng } from './rng'
import { zhBlocked } from './filters'

/** 现成名：悦来客栈（话本 stocked inn）、无畏号（HMS Dreadnought） */
export const FAMOUS_ZH = new Set(['悦来客栈', '无畏号'])

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]

function accept(zh: string | null, used: Set<string>, lo: number, hi: number): string | null {
  if (!zh) return null
  if (new Set(zh).size !== [...zh].length) return null
  const len = [...zh].length
  if (len < lo || len > hi) return null
  if (FAMOUS_ZH.has(zh)) return null
  if (zhBlocked(zh)) return null
  if (used.has(zh)) return null
  used.add(zh)
  return zh
}

// ── 称号 ──
const E_VERB = ['焚', '断', '屠', '饮', '盗', '缚', '碎', '灭', '镇', '吞', '裂', '窃', '掘', '埋', '拆', '驯']
const E_NOUN = ['桥', '誓', '龙', '霜', '日', '星', '锋', '烛', '海', '渊', '门', '王', '神', '鸦', '月', '旗', '冠', '冢', '灯', '索']
const E_ADJ = ['灰烬', '荒原', '无面', '铁喉', '断翅', '缄默', '寒鸦', '赤手', '孤星', '白骨', '逆命', '空冕']
const E_RANK = ['公爵', '侯爵', '伯爵', '男爵', '子爵', '大公', '主教', '元帅', '将军', '法师', '贤者']
const E_OLD = ['老鸦', '老鲛', '老蝎', '老犬']
const E_NICK = ['半截眉', '铁算盘', '哑炮', '断弦']

function epithetPlain(rng: Rng): string {
  const r = rng()
  if (r < 0.5) return pick(rng, E_VERB) + pick(rng, E_NOUN) + '者'
  if (r < 0.85) return pick(rng, E_ADJ) + pick(rng, E_RANK)
  if (r < 0.93) return pick(rng, E_OLD)
  return pick(rng, E_NICK)
}

export function epithet(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const z = accept(epithetPlain(rng), used, 3, 5)
    if (z) return z
  }
  return null
}

// ── 酒馆 / 店铺 ──
const T_MOD = ['醉龙', '悬灯', '缺月', '破釜', '金驼', '老鲛', '断头']
const T_SHOP = ['酒馆', '客栈', '酒肆', '旅店', '酒家', '赌坊', '当铺', '茶楼']
const T_N1 = ['断桨', '铁锚', '白鹿', '金鹅', '盐', '火', '烤饼', '沉钟', '断剑', '咸鱼']
const T_N2 = ['美人', '醉汉', '猫', '玫瑰', '水手', '寡妇', '诗人', '山羊', '骡子', '修士']
const T_STATE = ['沉睡', '无声', '醉酒', '跛脚', '空心']
const T_ANIMAL = ['鲟鱼', '山羊', '天鹅', '渡鸦', '骡子', '鹈鹕', '野猪']

function tavernPlain(rng: Rng): string {
  const r = rng()
  if (r < 0.45) return pick(rng, T_MOD) + pick(rng, T_SHOP)
  if (r < 0.75) return pick(rng, T_N1) + '与' + pick(rng, T_N2)
  return pick(rng, T_STATE) + pick(rng, T_ANIMAL)
}

export function tavern(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const z = accept(tavernPlain(rng), used, 3, 6)
    if (z) return z
  }
  return null
}

// ── 街区 ──
const S_MOD = ['银匠', '烂泥', '屠户', '面粉', '铜锅', '熏鱼', '旧书', '皮革', '灰泥', '断头', '染坊', '磨坊', '铁匠', '陶匠', '盐仓', '蜡烛', '马厩', '绞架']
const S_GEN = ['巷', '街', '桥', '市', '坊', '弄', '道', '坡']

export function street(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const z = accept(pick(rng, S_MOD) + pick(rng, S_GEN), used, 3, 4)
    if (z) return z
  }
  return null
}

// ── 菜单 ──
const M_IMG = ['龙息', '沼泽', '缄默', '水手', '矿工', '渔夫', '盗贼', '苔根', '烟囱', '断桨', '旅人', '老巫', '海盐', '烟熏', '蜂蜜']
const M_DISH = ['炖菜', '烈酒', '麦酒', '派', '香肠', '浓汤', '串', '焦饼', '奶酪', '腌菜', '鱼干']

export function menu(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const z = accept(pick(rng, M_IMG) + pick(rng, M_DISH), used, 4, 5)
    if (z) return z
  }
  return null
}

// ── 舰船 ──
const SH_ADJ = ['不挠', '破晓', '缄默', '永恒', '怒涛', '断浪', '曙光', '孤星', '归乡', '燃霜', '长夜', '逐风', '载雪', '安魂', '破雾', '守誓']
const SH_IMG = ['晨星', '血月', '永夜', '灰烬', '苍雷', '静默', '沉钟', '白垩', '幽荧', '蚀月']
const SH_OF = ['之翼', '之帆', '之牙', '之旗']

function shipPlain(rng: Rng): string {
  if (rng() < 0.7) return pick(rng, SH_ADJ) + '号'
  return pick(rng, SH_IMG) + pick(rng, SH_OF) + '号'
}

export function ship(rng: Rng, used: Set<string> = new Set(), tries = 60): string | null {
  for (let i = 0; i < tries; i++) {
    const z = accept(shipPlain(rng), used, 3, 6)
    if (z) return z
  }
  return null
}

// ── 历法（成套 12 个月） ──
const C_PRE = ['霜', '烬', '血', '灰', '芽', '风', '露', '雪', '星', '雨', '雾', '雷', '蝉', '穗', '焰', '冰']
const C_MOD = ['长夜', '双母', '沉星', '破晓', '落穗', '归雁']

export function calendar(rng: Rng, tries = 200): string[] | null {
  const out: string[] = []
  const used = new Set<string>()
  for (let i = 0; i < tries && out.length < 12; i++) {
    const zh = (rng() < 0.7 ? pick(rng, C_PRE) : pick(rng, C_MOD)) + '月'
    if (new Set(zh).size !== [...zh].length || used.has(zh) || zhBlocked(zh)) continue
    used.add(zh)
    out.push(zh)
  }
  return out.length === 12 ? out : null
}
