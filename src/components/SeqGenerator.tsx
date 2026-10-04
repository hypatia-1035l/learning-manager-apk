import { useState } from 'react'
import { toChineseNumber } from '../seqInput'

interface Props {
  onGenerate: (lines: string[]) => void
}

// 数字序列批量生成：前缀 + 起止数字（+ 后缀）→ 名称行列表
// 生成结果交给调用方追加进批量输入框（如「卷 1-100 → 卷1…卷100」或中文数字「卷一…」）
export function SeqGenerator({ onGenerate }: Props) {
  const [prefix, setPrefix] = useState('')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('10')
  const [suffix, setSuffix] = useState('')
  const [chinese, setChinese] = useState(true)

  const nFrom = Math.max(0, Math.floor(Number(from) || 0))
  const nToRaw = Math.floor(Number(to) || 0)
  const nTo = Math.min(nFrom + 999, nToRaw) // 单次最多 1000 条
  const valid = nToRaw >= nFrom
  const count = valid ? nTo - nFrom + 1 : 0

  const generate = () => {
    if (!valid) return
    const lines: string[] = []
    for (let n = nFrom; n <= nTo; n++) {
      lines.push(`${prefix}${chinese ? toChineseNumber(n) : String(n)}${suffix}`)
    }
    onGenerate(lines)
  }

  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
      <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
        数字序列生成（追加到上方输入框）
      </div>
      <div className="grid-3">
        <div className="mini-field">
          <label>前缀</label>
          <input
            className="input"
            placeholder="如：卷"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </div>
        <div className="mini-field">
          <label>起</label>
          <input
            className="input"
            type="number"
            min={0}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="mini-field">
          <label>止</label>
          <input
            className="input"
            type="number"
            min={0}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'flex-end' }}>
        <div className="mini-field" style={{ flex: 1 }}>
          <label>后缀（可选）</label>
          <input
            className="input"
            placeholder="如：回"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </div>
        <label
          className="muted"
          style={{
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingBottom: 9,
            whiteSpace: 'nowrap',
          }}
        >
          <input
            type="checkbox"
            checked={chinese}
            onChange={(e) => setChinese(e.target.checked)}
          />
          中文数字
        </label>
        <button className="btn sm primary" onClick={generate} disabled={!valid}>
          生成{count > 0 ? ` ${count} 条` : ''}
        </button>
      </div>
    </div>
  )
}
