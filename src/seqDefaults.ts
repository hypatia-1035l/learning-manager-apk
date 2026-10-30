// 序列录入的「上次用过的值」
//
// 目的：新建序列时单位（章/页/回）和时长基本是同一套，每次从零敲一遍纯属浪费。
// 记在 localStorage 而不是 AppData：这是输入习惯，不是学习数据，不进备份、不进迁移。
const KEY = 'learning-manager:last-seq-defaults'

export interface SeqDefaults {
  unit: string
  /** 分钟，保留字符串形态（空 = 正向计时） */
  countdownMin: string
}

export function readSeqDefaults(): SeqDefaults {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { unit: '', countdownMin: '' }
    const o = JSON.parse(raw) as Partial<SeqDefaults>
    return {
      unit: typeof o.unit === 'string' ? o.unit : '',
      countdownMin: typeof o.countdownMin === 'string' ? o.countdownMin : '',
    }
  } catch {
    return { unit: '', countdownMin: '' }
  }
}

/** 只更新传进来的字段，其余保持原值；空字符串也算有效值（用户主动清空） */
export function writeSeqDefaults(patch: Partial<SeqDefaults>): void {
  try {
    const cur = readSeqDefaults()
    const next: SeqDefaults = { ...cur, ...patch }
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore：记不住不影响使用 */
  }
}
