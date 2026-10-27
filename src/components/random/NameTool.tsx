import { useMemo, useState } from 'react'
import { copyText } from '../../utils'
import {
  NAME_STYLES,
  NAME_KINDS,
  createNamer,
  createPersonNamer,
  hasPersonStyle,
} from '../../namegen'
import type { NameKind } from '../../namegen'
import * as MG from '../../namegen/magic'
import * as FV from '../../namegen/flavor'
import * as MY from '../../namegen/mythos'
import { worldlet, cardText } from '../../namegen/worldlet'
import { personName } from '../../namegen/compose'
import { mulberry32 } from '../../namegen/rng'
import type { Rng } from '../../namegen/rng'

/** 地名六类的显示名 */
const KIND_LABEL: Record<NameKind, string> = {
  state: '国名',
  city: '城',
  mountain: '山脉',
  sea: '海',
  river: '河',
  region: '地区',
}

type Group = 'person' | 'place' | 'magic' | 'flavor' | 'mythos' | 'worldlet'

const GROUPS: [Group, string][] = [
  ['person', '人名'],
  ['place', '地名'],
  ['magic', '魔法'],
  ['flavor', '风味'],
  ['mythos', '神话'],
  ['worldlet', '世界卡'],
]

/** 魔法 / 风味 / 神话的子项 */
const SUBS: Record<'magic' | 'flavor' | 'mythos', [string, string][]> = {
  magic: [
    ['spell', '咒语'],
    ['place', '魔法场所'],
    ['item', '法器'],
    ['potion', '魔药'],
    ['dungeon', '地牢'],
    ['tome', '典籍'],
  ],
  flavor: [
    ['epithet', '称号'],
    ['tavern', '酒馆'],
    ['street', '街区'],
    ['menu', '菜单'],
    ['ship', '舰船'],
    ['calendar', '历法'],
  ],
  mythos: [
    ['deity', '神祇'],
    ['dragon', '龙'],
    ['monster', '怪物图鉴'],
  ],
}

/** 子项 → 生成函数（签名统一为 (rng, used) => string | null） */
const FN: Record<string, (rng: Rng, used: Set<string>) => string | null> = {
  'magic.spell': MG.spell,
  'magic.place': MG.place,
  'magic.item': MG.item,
  'magic.potion': MG.potion,
  'magic.dungeon': MG.dungeon,
  'magic.tome': MG.tome,
  'flavor.epithet': FV.epithet,
  'flavor.tavern': FV.tavern,
  'flavor.street': FV.street,
  'flavor.menu': FV.menu,
  'flavor.ship': FV.ship,
  'mythos.deity': MY.deity,
  'mythos.dragon': MY.dragon,
  'mythos.monster': MY.monster,
}

/**
 * 起名工具：人名 / 地名 / 魔法 / 风味 / 神话 / 世界卡。
 * 词库与构词移植自 civ-atlas 与 namegen（见 src/namegen/*）。
 */
export function NameTool() {
  const [group, setGroup] = useState<Group>('person')
  const [styleId, setStyleId] = useState('imperial')
  const [kind, setKind] = useState<NameKind>('city')
  const [sub, setSub] = useState('spell')
  const [n, setN] = useState(12)
  const [list, setList] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  const isPersonLike = group === 'person' || group === 'place'
  const isWorldlet = group === 'worldlet'
  const styleOptions = useMemo(
    () => (group === 'person' ? NAME_STYLES.filter((s) => hasPersonStyle(s.id)) : NAME_STYLES),
    [group],
  )
  const style = useMemo(() => NAME_STYLES.find((s) => s.id === styleId), [styleId])
  const subOptions = group === 'magic' || group === 'flavor' || group === 'mythos' ? SUBS[group] : null

  const switchGroup = (g: Group) => {
    setGroup(g)
    setList([])
    if (g === 'magic') setSub('spell')
    else if (g === 'flavor') setSub('epithet')
    else if (g === 'mythos') setSub('deity')
    if (g === 'person' && !hasPersonStyle(styleId)) setStyleId('imperial')
  }

  const roll = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
    const count = isWorldlet ? Math.min(n, 10) : n
    const out: string[] = []

    if (isWorldlet) {
      for (let i = 0; i < count; i++) out.push(cardText(worldlet(styleId, seed + i)))
    } else if (isPersonLike) {
      if (group === 'person') {
        const pn = createPersonNamer(seed, styleId)
        for (let i = 0; i < count; i++) out.push(personName(pn, i))
      } else {
        const namer = createNamer(seed, styleId)
        for (let i = 0; i < count; i++) out.push(namer.name(kind).zh)
      }
    } else {
      const rng = mulberry32(seed)
      const used = new Set<string>()
      if (group === 'flavor' && sub === 'calendar') {
        for (let i = 0; i < count; i++) out.push(FV.calendar(rng)?.join(' ') ?? '（没凑齐 12 个月）')
      } else {
        const fn = FN[`${group}.${sub}`]
        for (let i = 0; i < count; i++) {
          const v = fn(rng, used)
          if (v) out.push(v)
        }
      }
    }
    setList(out)
    setCopied(false)
  }

  const copyAll = () => {
    if (!list.length) return
    if (copyText(list.join(isWorldlet ? '\n\n' : '、'))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="rt-grid">
      <div className="section">
        <div className="section-title">起名</div>

        <div className="form-stack">
          <div className="row wrap">
            <div className="field">
              <label>类型</label>
              <select className="input" value={group} onChange={(e) => switchGroup(e.target.value as Group)}>
                {GROUPS.map(([g, label]) => (
                  <option key={g} value={g}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {subOptions && (
              <div className="field">
                <label>子项</label>
                <select
                  className="input"
                  value={sub}
                  onChange={(e) => {
                    setSub(e.target.value)
                    setList([])
                  }}
                >
                  {subOptions.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isPersonLike && (
              <div className="field">
                <label>语感</label>
                <select
                  className="input"
                  value={styleId}
                  onChange={(e) => {
                    setStyleId(e.target.value)
                    setList([])
                  }}
                >
                  {styleOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {group === 'place' && (
              <div className="field">
                <label>类型</label>
                <select
                  className="input"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as NameKind)
                    setList([])
                  }}
                >
                  {NAME_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label>{isWorldlet ? '套数' : '数量'}</label>
              <input
                type="number"
                min={1}
                max={isWorldlet ? 10 : 50}
                className="input"
                value={n}
                onChange={(e) => setN(Math.max(1, Math.min(isWorldlet ? 10 : 50, Math.floor(Number(e.target.value) || 1))))}
              />
            </div>
          </div>

          {isPersonLike && style?.desc && <div className="faint">{style.desc}</div>}
          {isWorldlet && <div className="faint">选语感 = 指定世界体系；一张卡内国号/君主/都城同源</div>}

          <div className="rt-result">
            {list.length ? (
              <>
                <div className="rt-number-list">
                  {list.map((s, i) => (
                    <span
                      key={i}
                      className="rt-number"
                      title="点击复制"
                      style={isWorldlet ? { whiteSpace: 'pre-line', textAlign: 'left', display: 'block' } : undefined}
                      onClick={() => copyText(s)}
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <button type="button" className="btn sm ghost rt-copy-btn" onClick={copyAll}>
                  {copied ? '已复制' : '复制结果'}
                </button>
              </>
            ) : (
              <span className="faint">点击下方按钮开始起名</span>
            )}
          </div>

          <button className="btn primary lg" onClick={roll}>
            起一批
          </button>
        </div>
      </div>
    </div>
  )
}
