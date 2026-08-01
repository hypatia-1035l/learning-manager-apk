import { useState } from 'react'
import { NumberRandomizer } from './random/NumberRandomizer'
import { WordBankRandomizer } from './random/WordBankRandomizer'
import { BankManager } from './random/BankManager'
import { RandomRecords } from './random/RandomRecords'

type Tool = 'number' | 'wordbank' | 'banks' | 'records'

const TABS: { id: Tool; label: string }[] = [
  { id: 'number', label: '数字随机' },
  { id: 'wordbank', label: '词库随机' },
  { id: 'banks', label: '词库管理' },
  { id: 'records', label: '随机记录' },
]

export function RandomToolbox() {
  const [tool, setTool] = useState<Tool>('number')
  // 选中的词库 ID（词库随机 / 词库管理 共享）
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([])

  return (
    <div className="pool-compact">
      <div className="tabs rt-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tool === t.id ? 'active' : ''}`}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tool === 'number' && <NumberRandomizer />}
        {tool === 'wordbank' && (
          <WordBankRandomizer
            selectedIds={selectedBankIds}
            onSelectChange={setSelectedBankIds}
          />
        )}
        {tool === 'banks' && (
          <BankManager
            selectedIds={selectedBankIds}
            onSelectChange={setSelectedBankIds}
          />
        )}
        {tool === 'records' && <RandomRecords />}
      </div>
    </div>
  )
}
