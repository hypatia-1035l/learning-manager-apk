import { useEffect, useMemo, useState } from 'react'
import { copyText } from '../../utils'
import { useRandomData, writeBankWords } from '../../randomStore'

interface Props {
  selectedBankIds?: string[]
  // 管理页「加工」送来的词库词条（一行一词）
  incoming?: { text: string; bankName: string; ts: number } | null
}

// 转正则安全字符
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 去掉行首尾空白（含全角空格 U+3000）
function trimLine(l: string): string {
  return l.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

// 文本工具：去重 / 排序 / 去空行 / 加前后缀 / 分隔符互转
// 就地处理（按钮直接改写输入框内容），可链式加工后复制走
export function TextTools({ selectedBankIds = [], incoming }: Props) {
  const randomData = useRandomData()
  const [text, setText] = useState('')
  // 存回词库：目标词库 + 结果消息；来自「加工」时默认选原词库
  const [writeBackId, setWriteBackId] = useState('')
  const [writeMsg, setWriteMsg] = useState('')
  const [sourceName, setSourceName] = useState('')

  useEffect(() => {
    if (!incoming) return
    setText(incoming.text)
    setSourceName(incoming.bankName)
    const bank = randomData.banks.find((b) => b.name === incoming.bankName)
    if (bank) setWriteBackId(bank.id)
    setWriteMsg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  // 拆行用的分隔符集合（逐字符生效）
  const [splitChars, setSplitChars] = useState('，,、;；|')
  // 空格也算分隔符（半角/全角空格/Tab）
  const [spaceAsSep, setSpaceAsSep] = useState(false)
  // 去重时忽略大小写
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [joinChar, setJoinChar] = useState('，')
  const [copied, setCopied] = useState(false)
  // 加空格：每隔 N 个字符插一个空格
  const [spaceEvery, setSpaceEvery] = useState('2')

  const lines = useMemo(() => text.split('\n'), [text])
  const nonEmpty = useMemo(() => lines.filter((l) => trimLine(l) !== ''), [lines])
  const totalChars = text.length

  const setLines = (ls: string[]) => setText(ls.join('\n'))
  const apply = (fn: (ls: string[]) => string[]) => {
    const ls = fn(lines)
    setText(ls.join('\n'))
  }

  const dedupe = () => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const l of lines) {
      const t = trimLine(l)
      if (t === '') continue
      const key = ignoreCase ? t.toLowerCase() : t
      if (seen.has(key)) continue
      seen.add(key)
      out.push(l)
    }
    setLines(out)
  }

  const sortBy = (desc = false) => {
    const sorted = [...nonEmpty].sort((a, b) =>
      a.localeCompare(b, 'zh-Hans-CN', { numeric: true }),
    )
    apply(() => (desc ? sorted.reverse() : sorted))
  }

  const addAffix = () => {
    if (!prefix && !suffix) return
    apply((ls) => ls.filter((l) => trimLine(l) !== '').map((l) => prefix + trimLine(l) + suffix))
  }

  const splitToLines = () => {
    const chars = splitChars.split('').concat(spaceAsSep ? [' ', '\u3000', '\t'] : [])
    const uniq = [...new Set(chars)].filter(Boolean)
    if (!uniq.length) return
    const re = new RegExp(uniq.map(escapeRegExp).join('|'))
    const parts = text
      .split(re)
      .map((p) => trimLine(p))
      .filter(Boolean)
    setLines(parts)
  }

  const joinToOne = () => {
    if (nonEmpty.length === 0) return
    setText(nonEmpty.map((l) => trimLine(l)).join(joinChar))
  }

  // 去掉行内所有空白（含全角空格）
  const stripSpaces = (l: string) => l.replace(/[\s\u3000]+/g, '')

  // 每隔 N 个字符插一个空格（先清掉已有空白，按字符计）
  const chunkSpace = () => {
    const n = Math.max(1, Math.floor(Number(spaceEvery) || 0))
    if (!n) return
    apply((ls) =>
      ls.map((raw) => {
        const chars = [...stripSpaces(raw)]
        if (chars.length === 0) return raw
        const out: string[] = []
        chars.forEach((ch, i) => {
          out.push(ch)
          if ((i + 1) % n === 0 && i !== chars.length - 1) out.push(' ')
        })
        return out.join('')
      }),
    )
  }

  // 按词库切词：贪心最长匹配，词间加空格；未命中字符按单字空开（便于看出没识别的部分）
  const dictSpace = () => {
    const dict = new Set<string>()
    let maxLen = 1
    for (const b of randomData.banks) {
      if (!selectedBankIds.includes(b.id)) continue
      for (const w of b.words) {
        const t = w.text.trim()
        if (!t) continue
        dict.add(t)
        maxLen = Math.max(maxLen, [...t].length)
      }
    }
    if (!dict.size) return
    apply((ls) =>
      ls.map((raw) => {
        const chars = [...stripSpaces(raw)]
        if (chars.length === 0) return raw
        const res: string[] = []
        let i = 0
        while (i < chars.length) {
          let hit = ''
          const tryLen = Math.min(maxLen, chars.length - i)
          for (let len = tryLen; len >= 2; len--) {
            const cand = chars.slice(i, i + len).join('')
            if (dict.has(cand)) {
              hit = cand
              break
            }
          }
          if (hit) {
            res.push(hit)
            i += hit.length
          } else {
            res.push(chars[i])
            i++
          }
        }
        return res.join(' ')
      }),
    )
  }

  const handleCopy = () => {
    if (!text) return
    if (copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="section">
      <div className="section-title">文本工具</div>

      <textarea
        className="textarea"
        rows={10}
        placeholder={'每行一条，粘贴或输入后用下方按钮加工，可连续链式处理'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          {lines.length} 行 · {totalChars} 字
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn sm"
          onClick={handleCopy}
          disabled={!text}
          title="复制全部内容"
        >
          {copied ? '已复制' : '复制全部'}
        </button>
        <button
          type="button"
          className="btn sm danger"
          onClick={() => setText('')}
          disabled={!text}
        >
          清空
        </button>
      </div>

      {/* 整理 */}
      <div style={{ marginBottom: 12 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="faint" style={{ fontSize: 12 }}>整理（去掉空行后按行处理）</span>
          <span className="spacer" />
          <label className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
            忽略大小写
          </label>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={dedupe} disabled={!nonEmpty.length}>
            去重
          </button>
          <button type="button" className="btn sm" onClick={() => sortBy(false)} disabled={!nonEmpty.length}>
            排序
          </button>
          <button type="button" className="btn sm" onClick={() => sortBy(true)} disabled={!nonEmpty.length}>
            倒序
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => apply((ls) => ls.filter((l) => trimLine(l) !== ''))}
            disabled={lines.length === nonEmpty.length}
          >
            去空行
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => apply((ls) => ls.map((l) => trimLine(l)))}
            disabled={!nonEmpty.length}
          >
            去首尾空格
          </button>
        </div>
      </div>

      {/* 前后缀 */}
      <div style={{ marginBottom: 12 }}>
        <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
          批量前后缀（每个非空行）
        </div>
        <div className="row wrap" style={{ gap: 6, alignItems: 'flex-end' }}>
          <div className="mini-field" style={{ flex: 1, minWidth: 90 }}>
            <label>前缀</label>
            <input className="input" placeholder="如：第" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
          <div className="mini-field" style={{ flex: 1, minWidth: 90 }}>
            <label>后缀</label>
            <input className="input" placeholder="如：号" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          </div>
          <button type="button" className="btn sm" onClick={addAffix} disabled={!nonEmpty.length || (!prefix && !suffix)}>
            应用
          </button>
        </div>
      </div>

      {/* 分隔符互转 */}
      <div style={{ marginBottom: 12 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="faint" style={{ fontSize: 12 }}>分隔符互转</span>
          <span className="spacer" />
          <label className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={spaceAsSep} onChange={(e) => setSpaceAsSep(e.target.checked)} />
            空格也算分隔符（含全角/Tab）
          </label>
        </div>
        <div className="row wrap" style={{ gap: 6, alignItems: 'flex-end' }}>
          <div className="mini-field" style={{ flex: 1, minWidth: 120 }}>
            <label>拆行分隔符（逐字符）</label>
            <input className="input" value={splitChars} onChange={(e) => setSplitChars(e.target.value)} />
          </div>
          <button type="button" className="btn sm" onClick={splitToLines} disabled={!text || (!splitChars && !spaceAsSep)}>
            拆成行
          </button>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 6, alignItems: 'flex-end' }}>
          <div className="mini-field" style={{ width: 90 }}>
            <label>合并符</label>
            <input className="input" value={joinChar} onChange={(e) => setJoinChar(e.target.value)} />
          </div>
          <button type="button" className="btn sm" onClick={joinToOne} disabled={!nonEmpty.length}>
            合并一行
          </button>
        </div>
      </div>

      {/* 加空格 */}
      <div>
        <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
          加空格（先去掉行内已有空白）
        </div>
        <div className="row wrap" style={{ gap: 6, alignItems: 'flex-end' }}>
          <div className="mini-field" style={{ width: 90 }}>
            <label>每隔几字</label>
            <input
              className="input"
              type="number"
              min={1}
              value={spaceEvery}
              onChange={(e) => setSpaceEvery(e.target.value)}
            />
          </div>
          <button type="button" className="btn sm" onClick={chunkSpace} disabled={!nonEmpty.length}>
            按字数加空格
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={dictSpace}
            disabled={!nonEmpty.length}
            title={
              selectedBankIds.length
                ? '按词库页选中的词库做最长匹配'
                : '先在「词库」页选择词库作为切词字典'
            }
          >
            按词库切词{selectedBankIds.length ? `（${selectedBankIds.length} 库）` : ''}
          </button>
        </div>
      </div>

      {/* 存回词库 */}
      {randomData.banks.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
            存回词库（一行一条 → 词条）{sourceName ? ` · 来自「${sourceName}」` : ''}
          </div>
          <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
            <select
              className="select"
              style={{ flex: 1, minWidth: 120 }}
              value={writeBackId}
              onChange={(e) => setWriteBackId(e.target.value)}
            >
              <option value="">选择词库…</option>
              {randomData.banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}（{b.words.length}）
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn sm"
              disabled={!text.trim() || !writeBackId}
              title="清空原词条后写入（权重归 1，不保留）"
              onClick={() => {
                if (!writeBackId) return
                const target = randomData.banks.find((b) => b.id === writeBackId)
                const targetName = target?.name ?? '目标词库'
                // 覆盖 = 整库替换且权重不保留，属不可撤销的数据清空，必须先确认
                if (
                  !confirm(
                    `覆盖写入「${targetName}」？\n\n会先清空该词库现有全部 ${
                      target?.words.length ?? 0
                    } 条词条（权重不保留），再写入当前文本。\n此操作不可撤销。`,
                  )
                ) {
                  return
                }
                const r = writeBankWords(
                  writeBackId,
                  text.split('\n').map((l) => trimLine(l)),
                  'overwrite',
                )
                setWriteMsg(`已覆盖写入 ${r.written} 条${r.skipped ? `，跳过重复 ${r.skipped} 条` : ''}`)
              }}
            >
              覆盖
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={!text.trim() || !writeBackId}
              title="追加到词库末尾（同名词条跳过）"
              onClick={() => {
                if (!writeBackId) return
                const r = writeBankWords(
                  writeBackId,
                  text.split('\n').map((l) => trimLine(l)),
                  'append',
                )
                setWriteMsg(`已追加 ${r.written} 条${r.skipped ? `，跳过重复 ${r.skipped} 条` : ''}`)
              }}
            >
              追加
            </button>
          </div>
          {writeMsg && (
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{writeMsg}</div>
          )}
        </div>
      )}
    </div>
  )
}
