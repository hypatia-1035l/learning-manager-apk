import { useState } from 'react'
import type { ProgressNode } from '../types'
import { parseProgressNumber } from '../migrate'
import { parseNodesText, toChineseNumber } from '../seqInput'

interface Props {
  value: ProgressNode[]
  onChange: (nodes: ProgressNode[]) => void
  // 预览上下文：示例进度数字（原始进度文本）、单位、目标（可选）
  previewProgress?: string
  unit?: string
  target?: string
}

// 进度节点批量编辑器：每行「数字 名称」，分隔符空格/逗号/竖线/顿号均可。
// 自动按数字升序输出合法节点；格式不识别的行忽略并在下方提示。
// 解析复用 seqInput.parseNodesText，与粘贴导入保持同一套语法。
// 需要在每次打开编辑时重置内容的场景，用 key 重新挂载。
export function ProgressNodesEditor({ value, onChange, previewProgress, unit, target }: Props) {
  const [text, setText] = useState(() =>
    [...value]
      .sort((a, b) => a.at - b.at)
      .map((n) => `${n.at} ${n.label}`)
      .join('\n'),
  )
  // 自动生成器：按步长铺节点（如每 10 章一个刻度），省得手敲几十行
  const [genOpen, setGenOpen] = useState(false)
  const [step, setStep] = useState('10')
  const [limit, setLimit] = useState('')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [cn, setCn] = useState(true)

  const handleChange = (t: string) => {
    setText(t)
    onChange(parseNodesText(t))
  }

  const sorted = parseNodesText(text)
  // 未识别行数：非空行里没被解析成节点的部分
  const nonEmpty = text.split('\n').filter((l) => l.trim() !== '').length
  const ignored = Math.max(0, nonEmpty - sorted.length)

  // 预览：示例进度优先用传入值，否则用第一个节点
  const example = parseProgressNumber(previewProgress ?? '')
  const ex = Number.isFinite(example) ? example : (sorted[0]?.at ?? 0)
  const hit = [...sorted].reverse().find((n) => ex >= n.at) ?? null
  const previewText = `${ex}${target ? ` / ${target}` : ''}${unit ? ` ${unit}` : ''}${hit ? ` · ${hit.label}` : ''}`

  // 生成：从 step 开始，每 step 一个，到 limit 为止（最多 100 条，避免塞几千行进存储）
  const generate = () => {
    const st = Math.max(1, Math.floor(Number(step) || 10))
    const tgtNum = Number(target)
    const fallback = Number.isFinite(tgtNum) && tgtNum > 0 ? tgtNum : 100
    const lim = Math.max(st, Math.floor(Number(limit) || fallback))
    const out: string[] = []
    for (let at = st; at <= lim && out.length < 100; at += st) {
      out.push(`${at} ${prefix}${cn ? toChineseNumber(at) : String(at)}${suffix}`)
    }
    if (!out.length) return
    const merged = text.trim()
      ? text.replace(/\s+$/, '') + '\n' + out.join('\n')
      : out.join('\n')
    handleChange(merged)
  }

  return (
    <div>
      <textarea
        className="textarea"
        rows={3}
        placeholder={'每行一条：数字 名称\n如：\n0 入门\n100 卷一\n200 卷二'}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
      />

      <div className="pn-preview" style={{ marginTop: 8 }}>
        {sorted.length === 0
          ? '未设置节点时，进度只显示数字。'
          : `进度到 ${ex} 时显示：${previewText}`}
      </div>

      {ignored > 0 && (
        <div className="faint" style={{ fontSize: 12, marginTop: 4, color: 'var(--amber, #c47f00)' }}>
          有 {ignored} 行未识别（需以数字开头，如「0 入门」），已忽略。
        </div>
      )}

      {/* 自动生成器：按步长铺刻度，省得手敲「10 一 / 20 二 / …」几十行 */}
      <div className="row" style={{ gap: 6, marginTop: 6, alignItems: 'center' }}>
        <button
          type="button"
          className={`btn sm ${genOpen ? 'primary' : ''}`}
          onClick={() => setGenOpen((v) => !v)}
        >
          {genOpen ? '收起生成器' : '自动生成'}
        </button>
        <span className="faint" style={{ fontSize: 11 }}>
          按步长批量铺节点，不用手敲
        </span>
      </div>

      {genOpen && (
        <div style={{ marginTop: 8, borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
          <div className="grid-3">
            <div className="mini-field">
              <label>步长</label>
              <input
                className="input"
                type="number"
                min={1}
                value={step}
                onChange={(e) => setStep(e.target.value)}
              />
            </div>
            <div className="mini-field">
              <label>到（默认取目标）</label>
              <input
                className="input"
                type="number"
                min={1}
                placeholder={target || '100'}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
            <div className="mini-field">
              <label>后缀（可选）</label>
              <input
                className="input"
                placeholder={unit ? `如：${unit}` : '如：章'}
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
              />
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'flex-end' }}>
            <div className="mini-field" style={{ flex: 1 }}>
              <label>前缀（可选）</label>
              <input
                className="input"
                placeholder="如：第"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
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
              <input type="checkbox" checked={cn} onChange={(e) => setCn(e.target.checked)} />
              中文数字
            </label>
            <button type="button" className="btn sm primary" onClick={generate}>
              追加
            </button>
          </div>
          <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            例：步长 10、前缀「第」、后缀「章」→ 生成「10 第十章 / 20 第二十章 …」。
            最多 100 条；要每章一个刻度就把步长设成 1。
          </p>
        </div>
      )}
    </div>
  )
}
