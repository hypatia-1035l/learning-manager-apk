import { useState } from 'react'
import type { ProgressNode } from '../types'
import { parseProgressNumber } from '../migrate'
import { parseNodesText } from '../seqInput'

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
    </div>
  )
}
