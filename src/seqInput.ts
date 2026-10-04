// 序列行语法解析：TaskForm（新建方向）与 TaskGroupEditor（批量添加）共用
// 行格式：名称｜目标｜单位｜分钟（竖线用 | 或 ｜，后面的参数可省略）
import type { ProgressNode } from './types'

export interface SeqLine {
  name: string
  target?: string
  unit?: string
  countdownMin?: string
}

export function parseSeqLine(line: string): SeqLine {
  const parts = line.split(/[|｜]/).map((p) => p.trim())
  const [name, target, unit, countdownMin] = parts
  return { name: name || '', target, unit, countdownMin }
}

// 分钟字符串 → 秒数（空或非法/<=0 → null = 正向计时）
export function parseCountdownMin(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n * 60)
}

// 进度节点文本：每行「数字 名称」，按 at 升序。
// 数字与名称之间可用空格/逗号/竖线（半角 | 或全角 ｜）/顿号分隔，也可不写分隔符（如「0入门」）。
// 约束：数字后不能再接数字（(?!\d) 防回溯把数字切分），名称首字符不能是分隔符/空白，
// 因此「100」「0、」这类只有数字或只有分隔符的行会被忽略。
export function parseNodesText(text: string): ProgressNode[] {
  const lines = text.split('\n')
  const nodes: ProgressNode[] = []
  for (const l of lines) {
    const t = l.trim()
    if (!t) continue
    const m = t.match(/^(\d+(?:\.\d+)?)(?!\d)\s*[,，|｜、]?\s*([^,，|｜、\s].*)$/)
    if (m) nodes.push({ at: Math.floor(Number(m[1])), label: m[2].trim() })
  }
  return nodes.sort((a, b) => a.at - b.at)
}

// ---------- 宽松批量解析 ----------
// 整段批量文本 → SeqLine[]。规则：
//   1. 带竖线：按 名称｜目标｜单位｜分钟 解析（原语法）
//   2. 无竖线：按逗号/顿号拆成多个片段；每个片段再按空格解析为
//      名称 目标 [单位] [分钟]（第二段必须是数字才认，否则整段算一个名称）
//   例：「卷三 80 篇 25」「卷一，卷二、卷三」「资治通鉴 第三册」（单个名称）
function parseLooseFragment(frag: string): SeqLine {
  const parts = frag.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return { name: parts[0] }
  if (!/^\d+(\.\d+)?$/.test(parts[1])) return { name: parts.join(' ') }
  const name = parts[0]
  const target = parts[1]
  let unit: string | undefined
  let countdownMin: string | undefined
  const rest = parts.slice(2)
  if (rest.length >= 2) {
    unit = rest[0]
    countdownMin = rest[1]
  } else if (rest.length === 1) {
    // 只有三个词：纯数字视为倒计时（无单位），否则视为单位
    if (/^\d+(\.\d+)?$/.test(rest[0])) countdownMin = rest[0]
    else unit = rest[0]
  }
  return { name, target, unit, countdownMin }
}

export function parseSeqBlock(text: string): SeqLine[] {
  const out: SeqLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/[|｜]/.test(line)) {
      const p = parseSeqLine(line)
      if (p.name) out.push(p)
      continue
    }
    for (const frag of line.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean)) {
      const p = parseLooseFragment(frag)
      if (p.name) out.push(p)
    }
  }
  return out
}

// ---------- 数字 → 中文数字（1–9999） ----------
export function toChineseNumber(n: number): string {
  const d = '零一二三四五六七八九'
  if (!Number.isFinite(n) || n <= 0 || n >= 10000) return String(n)
  if (n < 10) return d[n]
  if (n < 20) return '十' + (n % 10 === 0 ? '' : d[n % 10])
  if (n < 100) {
    const t = Math.floor(n / 10)
    const o = n % 10
    return d[t] + '十' + (o === 0 ? '' : d[o])
  }
  if (n < 1000) {
    const h = Math.floor(n / 100)
    const r = n % 100
    if (r === 0) return d[h] + '百'
    if (r < 10) return d[h] + '百零' + d[r]
    return d[h] + '百' + toChineseNumber(r)
  }
  const t = Math.floor(n / 1000)
  const r = n % 1000
  if (r === 0) return d[t] + '千'
  if (r < 100) return d[t] + '千零' + toChineseNumber(r)
  return d[t] + '千' + toChineseNumber(r)
}
