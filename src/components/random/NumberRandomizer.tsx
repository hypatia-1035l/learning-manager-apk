import { useState } from 'react'
import {
  useRandomData,
  addRange,
  updateRange,
  deleteRange,
  randNum,
} from '../../randomStore'

const DECIMAL_OPTIONS = [
  { value: 0, label: '整数' },
  { value: 1, label: '1 位小数' },
  { value: 2, label: '2 位小数' },
  { value: 3, label: '3 位小数' },
  { value: 4, label: '4 位小数' },
  { value: 5, label: '5 位小数' },
]

export function NumberRandomizer() {
  const data = useRandomData()
  const [min, setMin] = useState('1')
  const [max, setMax] = useState('100')
  const [decimals, setDecimals] = useState(0)
  const [result, setResult] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const minNum = Number(min)
  const maxNum = Number(max)

  const handleRoll = () => {
    setResult(randNum(minNum, maxNum, decimals))
  }

  const handleLoadRange = (r: typeof data.ranges[0]) => {
    setMin(String(r.min))
    setMax(String(r.max))
    setResult(null)
  }

  const handleSave = () => {
    if (!newName.trim()) return
    addRange({ name: newName, min: minNum, max: maxNum })
    setNewName('')
  }

  return (
    <div className="rt-grid">
      <div className="section">
        <div className="section-title">🔢 数字随机</div>

        <div className="form-stack">
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>最小值</label>
              <input
                type="number"
                className="input"
                value={min}
                onChange={(e) => {
                  setMin(e.target.value)
                  setResult(null)
                }}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>最大值</label>
              <input
                type="number"
                className="input"
                value={max}
                onChange={(e) => {
                  setMax(e.target.value)
                  setResult(null)
                }}
              />
            </div>
          </div>

          <div className="field">
            <label>小数点位数</label>
            <div className="row wrap">
              {DECIMAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`btn sm ${decimals === opt.value ? 'primary' : ''}`}
                  onClick={() => {
                    setDecimals(opt.value)
                    setResult(null)
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rt-result">
            {result !== null ? (
              <span className="rt-number">{result}</span>
            ) : (
              <span className="faint">点击下方按钮开始随机</span>
            )}
          </div>

          <button className="btn primary lg" onClick={handleRoll}>
            🎲 随机
          </button>

          <div className="field">
            <label>保存为常用范围</label>
            <div className="row">
              <input
                className="input"
                placeholder="名称，如：页码 1-300"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
              <button
                className="btn"
                onClick={handleSave}
                disabled={!newName.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          常用范围
          <span className="count">（{data.ranges.length}）</span>
        </div>

        {data.ranges.length === 0 ? (
          <p className="faint" style={{ fontSize: 13 }}>
            尚无保存的范围。
          </p>
        ) : (
          <div className="obj-list">
            {data.ranges.map((r) => (
              <div key={r.id} className="obj-item">
                {editingId === r.id ? (
                  <RangeEditRow
                    range={r}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <span className="idx" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div className="faint" style={{ fontSize: 12 }}>
                        {r.min} – {r.max}
                      </div>
                    </div>
                    <div className="ops">
                      <button
                        className="icon-btn"
                        title="加载到当前"
                        onClick={() => handleLoadRange(r)}
                      >
                        ↺
                      </button>
                      <button
                        className="icon-btn"
                        title="编辑"
                        onClick={() => setEditingId(r.id)}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn danger"
                        title="删除"
                        onClick={() =>
                          confirm(`删除范围「${r.name}」？`) && deleteRange(r.id)
                        }
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RangeEditRow({
  range,
  onDone,
}: {
  range: { id: string; name: string; min: number; max: number }
  onDone: () => void
}) {
  const [name, setName] = useState(range.name)
  const [min, setMin] = useState(String(range.min))
  const [max, setMax] = useState(String(range.max))
  return (
    <div className="inline-edit" style={{ flex: 1 }}>
      <input
        className="input"
        style={{ flex: 1, minWidth: 100 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="名称"
      />
      <input
        type="number"
        className="input"
        style={{ width: 80 }}
        value={min}
        onChange={(e) => setMin(e.target.value)}
      />
      <input
        type="number"
        className="input"
        style={{ width: 80 }}
        value={max}
        onChange={(e) => setMax(e.target.value)}
      />
      <button
        className="btn sm primary"
        onClick={() => {
          updateRange(range.id, {
            name: name.trim() || range.name,
            min: Number(min),
            max: Number(max),
          })
          onDone()
        }}
      >
        保存
      </button>
      <button className="btn sm" onClick={onDone}>
        取消
      </button>
    </div>
  )
}
