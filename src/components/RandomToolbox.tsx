import { useState } from 'react'
import { NumberRandomizer } from './random/NumberRandomizer'
import { WordBankRandomizer } from './random/WordBankRandomizer'

type Tool = 'number' | 'wordbank'

const TOOLS: { id: Tool; label: string; icon: string; desc: string }[] = [
  { id: 'number', label: '数字随机', icon: '🔢', desc: '设置范围抽数字' },
  { id: 'wordbank', label: '词库随机', icon: '📝', desc: '统一词库 · 单抽/组合 · 权重' },
]

interface Props {}

export function RandomToolbox({}: Props = {}) {
  const [tool, setTool] = useState<Tool>('number')

  return (
    <div>
      <header className="app-header">
        <h1 className="app-title">🧰 工具</h1>
      </header>
      <p className="app-tagline">
        数字随机 · 词库随机 · 结果仅提供选择参考
      </p>

      {/* 工具选择卡 */}
      <div className="tool-cards">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-card ${tool === t.id ? 'active' : ''}`}
            onClick={() => setTool(t.id)}
          >
            <span className="tc2-icon">{t.icon}</span>
            <span className="tc2-name">{t.label}</span>
            <span className="tc2-desc">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* 工具内容 */}
      <div style={{ marginTop: 16 }}>
        {tool === 'number' && <NumberRandomizer />}
        {tool === 'wordbank' && <WordBankRandomizer />}
      </div>
    </div>
  )
}
