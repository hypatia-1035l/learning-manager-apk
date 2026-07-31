import { useState } from 'react'
import { NumberRandomizer } from './random/NumberRandomizer'
import { WordBankRandomizer } from './random/WordBankRandomizer'
import { RandomRecords } from './random/RandomRecords'

type Tool = 'number' | 'wordbank' | 'records'

const TABS: { id: Tool; label: string; icon: string }[] = [
  { id: 'number', label: '数字随机', icon: '🔢' },
  { id: 'wordbank', label: '词库随机', icon: '📝' },
  { id: 'records', label: '随机记录', icon: '📜' },
]

export function RandomToolbox() {
  const [tool, setTool] = useState<Tool>('number')

  return (
    <div className="pool-compact">
      <div className="tabs rt-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tool === t.id ? 'active' : ''}`}
            onClick={() => setTool(t.id)}
          >
            <span style={{ marginRight: 4 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tool === 'number' && <NumberRandomizer />}
        {tool === 'wordbank' && <WordBankRandomizer />}
        {tool === 'records' && <RandomRecords />}
      </div>
    </div>
  )
}
