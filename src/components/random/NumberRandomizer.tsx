import { useState } from 'react'
import {
  useRandomData,
  addRange,
  updateRange,
  deleteRange,
  randNum,
  addRandomRecord,
} from '../../randomStore'

// 单次抽取数量选项
const COUNT_OPTIONS = [1, 3, 5, 10]

export function NumberRandomizer() {
  const data = useRandomData()
  const [min, setMin] = useState('1')
  const [max, setMax] = useState('100')
  // 小数点位数：用字符串缓冲，允许清空输入；提交时再转数字
  const [decimalsInput, setDecimalsInput] = useState('0')
  const [drawCount, setDrawCount] = useState(1)
  const [results, setResults] = useState<number[]>([])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const minNum = Number(min)
  const maxNum = Number(max)
  const decimals = Math.min(10, Math.max(0, Math.floor(Number(decimalsInput) || 0)))
  const decimalsLabel = decimals === 0 ? '整数' : `${decimals} 位小数`

  const handleRoll = () => {
    if (isNaN(minNum) || isNaN(maxNum)) return
    if (minNum > maxNum) return
    const picks: number[] = []
    for (let i = 0; i < drawCount; i++) {
      picks.push(randNum(minNum, maxNum, decimals))
    }
    setResults(picks)
    // 写入随机记录
    const resultText = picks.map((n) => formatNumber(n, decimals)).join('、')
    addRandomRecord({
      type: 'number',
      summary: `${minNum}–${maxNum} · ${decimalsLabel} ×${drawCount}`,
      result: resultText,
    })
  }

  const handleLoadRange = (r: typeof data.ranges[0]) => {
    setMin(String(r.min))
    setMax(String(r.max))
    setResults([])
  }

  const handleSave = () => {
    if (!newName.trim()) return
    if (isNaN(minNum) || isNaN(maxNum) || minNum > maxNum) return
    addRange({ name: newName, min: minNum, max: maxNum })
    setNewName('')
  }

  return (
    <div className="rt-grid">
      <div className="section">
        <div className="section-title">数字随机</div>

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
                  setResults([])
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
                  setResults([])
                }}
              />
            </div>
          </div>

          <div className="field">
            <label>小数点位数（0 = 整数，最大 10）</label>
            <div className="row">
              <input
                type="number"
                min={0}
                max={10}
                className="input"
                style={{ width: 100 }}
                value={decimalsInput}
                onChange={(e) => {
                  setDecimalsInput(e.target.value)
                  setResults([])
                }}
                onBlur={() => {
                  // 失焦时规整：清空或非法回退为 0；超过 10 截到 10
                  const n = Math.min(10, Math.max(0, Math.floor(Number(decimalsInput) || 0)))
                  setDecimalsInput(String(n))
                }}
              />
              <span className="faint" style={{ fontSize: 13 }}>
                {decimalsLabel}
              </span>
            </div>
          </div>

          <div className="field">
            <label>单次抽取数量</label>
            <div className="row wrap">
              {COUNT_OPTIONS.map((n) => (
                <button
                  key={n}
                  className={`btn sm ${drawCount === n ? 'primary' : ''}`}
                  onClick={() => setDrawCount(n)}
                >
                  ×{n}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={50}
                className="input"
                style={{ width: 80 }}
                value={drawCount}
                onChange={(e) =>
                  setDrawCount(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))))
                }
              />
            </div>
          </div>

          <div className="rt-result">
            {results.length ? (
              <div className="rt-number-list">
                {results.map((n, i) => (
                  <span key={i} className="rt-number">
                    {formatNumber(n, decimals)}
                  </span>
                ))}
              </div>
            ) : (
              <span className="faint">点击下方按钮开始随机</span>
            )}
          </div>

          <button
            className="btn primary lg"
            onClick={handleRoll}
            disabled={isNaN(minNum) || isNaN(maxNum) || minNum > maxNum}
          >
            随机 ×{drawCount}
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
                disabled={!newName.trim() || isNaN(minNum) || isNaN(maxNum) || minNum > maxNum}
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
                        加载
                      </button>
                      <button
                        className="icon-btn"
                        title="编辑"
                        onClick={() => setEditingId(r.id)}
                      >
                        编辑
                      </button>
                      <button
                        className="icon-btn danger"
                        title="删除"
                        onClick={() =>
                          confirm(`删除范围「${r.name}」？`) && deleteRange(r.id)
                        }
                      >
                        删除
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

// 数字格式化：decimals=0 时显示整数；否则保留指定小数位
function formatNumber(n: number, decimals: number): string {
  if (decimals <= 0) return String(Math.floor(n))
  return n.toFixed(decimals)
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
