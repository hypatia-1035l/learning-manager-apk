/**
 * 一键小世界：把各模块拼成一张「世界卡」。
 * 移植自 namegen/worldlet.py（Python 为准，本文件是有损快照）。
 *
 * 一致性口径：一张卡只用一个文化体系（西幻八感之一 / 东方四感之一），
 * 国号、君主、都城同源；魔法 / 神话 / 风味是体系中立的部件，直接复用。
 */
import { NAME_STYLES, createNamer, createPersonNamer } from './index'
import { personName } from './compose'
import { mulberry32, subSeed } from './rng'
import * as MG from './magic'
import * as FV from './flavor'
import * as MY from './mythos'

export const CARD_ORDER = ['国号', '君主', '尊号', '都城', '守护神', '镇国神器', '禁咒', '守护龙', '名店'] as const

export interface WorldCard {
  family: string
  slots: Record<string, string>
  months: string[]
}

/** 生成一张世界卡。family 留空则按 seed 随机取一个体系。 */
export function worldlet(family: string | undefined, seed: number): WorldCard {
  const fam =
    family && NAME_STYLES.some((s) => s.id === family)
      ? family
      : NAME_STYLES[Math.floor(mulberry32(subSeed(seed, 'wl-pick'))() * NAME_STYLES.length)].id

  const seen = new Set<string>()
  const namer = createNamer(subSeed(seed, 'wl-place:' + fam), fam)
  const pn = createPersonNamer(subSeed(seed, 'wl-person:' + fam), fam)
  const rng = mulberry32(subSeed(seed, 'wl-misc:' + fam))

  const slots: Record<string, string> = {}
  const put = (k: string, v: string | null) => {
    const s = v ?? '（未出）'
    slots[k] = s
    seen.add(s)
  }

  put('国号', namer.name('state').zh)
  put('君主', personName(pn, 0))
  put('都城', namer.name('city').zh)
  put('尊号', FV.epithet(rng, seen))
  put('守护神', MY.deity(rng, seen))
  put('镇国神器', MG.item(rng, seen))
  put('禁咒', MG.spell(rng, seen))
  put('守护龙', MY.dragon(rng, seen))
  put('名店', FV.tavern(rng, seen))

  const months = FV.calendar(mulberry32(subSeed(seed, 'wl-cal:' + fam))) ?? []
  return { family: fam, slots, months }
}

/** 世界卡 → 纯文本 */
export function cardText(d: WorldCard): string {
  const lines = [`【${d.family}】`]
  for (const k of CARD_ORDER) lines.push(`${k}：${d.slots[k] ?? ''}`)
  lines.push('历法：' + d.months.join(' '))
  return lines.join('\n')
}
