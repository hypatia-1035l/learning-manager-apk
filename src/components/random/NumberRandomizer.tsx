import { useState } from 'react'
import {
  useRandomData,
  addRange,
  updateRange,
  deleteRange,
  randInt,
  randNum,
  addRandomRecord,
} from '../../randomStore'

// 「不重复」偏好持久化 key
const NUM_UNIQUE_KEY = 'learning-manager:num-unique'
function loadUnique(): boolean {
  try {
    return localStorage.getItem(NUM_UNIQUE_KEY) === '1'
  } catch {
    return false
  }
}

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
  // 不重复：同一批内不出现相同数字（仅整数模式）
  const [uniqueOn, setUniqueOn] = useState(loadUnique)
  // 复制按钮反馈
  const [copied, setCopied] = useState(false)
  // 非法区间的提示（整数模式下区间内没有整数时不再产出空记录）
  const [rollError, setRollError] = useState('')

  const minNum = Number(min)
  const maxNum = Number(max)
  const decimals = Math.min(10, Math.max(0, Math.floor(Number(decimalsInput) || 0)))
  const decimalsLabel = decimals === 0 ? '整数' : `${decimals} 位小数`
  const unique = uniqueOn && decimals === 0
  // 整数模式把区间收拢到合法整数；收拢后为空说明区间内没有整数（如 1.2–1.8）
  const intLo = Math.ceil(minNum)
  const intHi = Math.floor(maxNum)
  const invalidIntegerRange =
    decimals === 0 && !isNaN(minNum) && !isNaN(maxNum) && intLo > intHi
  // 去重时的实际可抽条数（范围内整数不足时自动降）
  const uniqueN = Number.isFinite(minNum) && Number.isFinite(maxNum)
    ? Math.min(drawCount, Math.max(0, intHi - intLo + 1))
    : drawCount

  const toggleUnique = () => {
    const next = !uniqueOn
    setUniqueOn(next)
    setResults([])
    try {
      localStorage.setItem(NUM_UNIQUE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const handleRoll = () => {
    if (isNaN(minNum) || isNaN(maxNum)) return
    if (minNum > maxNum) return
    // 整数模式先收拢到合法整数区间：避免小数边界时抽到范围外的数字，
    // 或「不重复」模式抽 0 个却仍写一条空结果的随机记录。
    const lo = decimals === 0 ? intLo : minNum
    const hi = decimals === 0 ? intHi : maxNum
    if (lo > hi) {
      setResults([])
      setRollError(`当前区间 ${minNum}–${maxNum} 内没有整数，请调整最小/最大值或小数位`)
      return
    }
    setRollError('')
    let picks: number[] = []
    if (unique) {
      // 去重抽取：整批不出现相同数字（实际条数不足时按可抽条数取）
      const n = Math.min(drawCount, hi - lo + 1)
      const s = new Set<number>()
      while (s.size < n) s.add(randInt(lo, hi))
      picks = [...s]
    } else {
      for (let i = 0; i < drawCount; i++) {
        picks.push(randNum(lo, hi, decimals))
      }
    }
    // 兜底：没有抽到任何值时不写记录（避免空结果污染随机记录）
    if (!picks.length) return
    setResults(picks)
    // 写入随机记录
    const resultText = picks.map((n) => formatNumber(n, decimals)).join('、')
    addRandomRecord({
      type: 'number',
      summary: `${minNum}–${maxNum} · ${decimalsLabel}${unique ? ' · 不重复' : ''} ×${picks.length}`,
      result: resultText,
    })
  }

  const handleCopy = () => {
    if (!results.length) return
    const text = results.map((n) => formatNumber(n, decimals)).join('、')
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {})
        ok = true
      }
    } catch {
      /* ignore */
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        /* ignore */
      }
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  // 快捷范围：一键填好常用随机场景
  const QUICK_RANGES: Array<[string, number, number]> = [
    ['硬币 1-2', 1, 2],
    ['骰子 1-6', 1, 6],
    ['1-100', 1, 100],
    ['正负 10', -10, 10],
  ]
  const applyQuick = (lo: number, hi: number) => {
    setMin(String(lo))
    setMax(String(hi))
    setResults([])
    setRollError('')
  }

  const handleLoadRange = (r: typeof data.ranges[0]) => {
    setMin(String(r.min))
    setMax(String(r.max))
    setResults([])
    setRollError('')
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
            <div className="field" style={{ flex: '0 0 auto' }}>
              <label>最小值</label>
              <input
                type="number"
                className="input"
                value={min}
                onChange={(e) => {
                  setMin(e.target.value)
                  setResults([])
                  setRollError('')
                }}
              />
            </div>
            <div className="field" style={{ flex: '0 0 auto' }}>
              <label>最大值</label>
              <input
                type="number"
                className="input"
                value={max}
                onChange={(e) => {
                  setMax(e.target.value)
                  setResults([])
                  setRollError('')
                }}
              />
            </div>
          </div>

          {/* 快捷范围 */}
          <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
            <span className="faint" style={{ fontSize: 12 }}>快捷</span>
            {QUICK_RANGES.map(([label, lo, hi]) => (
              <button
                key={label}
                type="button"
                className="btn sm"
                onClick={() => applyQuick(lo, hi)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="field">
            <label>小数位</label>
            <div className="row">
              <input
                type="number"
                min={0}
                max={10}
                className="input"
                value={decimalsInput}
                onChange={(e) => {
                  setDecimalsInput(e.target.value)
                  setResults([])
                  setRollError('')
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

          {/* 不重复开关（仅整数） */}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <label
              className="row"
              style={{ gap: 6, fontSize: 13, cursor: decimals === 0 ? 'pointer' : 'not-allowed', opacity: decimals === 0 ? 1 : 0.5 }}
              title={decimals === 0 ? '同一批内不出现相同数字' : '不重复仅支持整数（小数位为 0）'}
            >
              <input
                type="checkbox"
                checked={unique}
                disabled={decimals !== 0}
                onChange={toggleUnique}
              />
              不重复（同一批内不出现相同数字）
            </label>
          </div>

          <div className="field">
            <label>抽取数量</label>
              <input
                type="number"
                min={1}
                max={50}
                className="input"
                value={drawCount}
              onChange={(e) =>
                setDrawCount(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))))
              }
            />
          </div>

          <div className="rt-result">
            {results.length ? (
              <>
                <div className="rt-number-list">
                  {results.map((n, i) => (
                    <span key={i} className="rt-number">
                      {formatNumber(n, decimals)}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn sm ghost rt-copy-btn"
                  onClick={handleCopy}
                  title="复制结果"
                >
                  {copied ? '已复制' : '复制结果'}
                </button>
              </>
            ) : (
              <span className="faint">点击下方按钮开始随机</span>
            )}
          </div>

          <button
            className="btn primary lg"
            onClick={handleRoll}
            disabled={isNaN(minNum) || isNaN(maxNum) || minNum > maxNum || invalidIntegerRange}
            title={
              invalidIntegerRange
                ? '当前区间内没有整数，请调整最小/最大值或小数位'
                : unique && uniqueN < drawCount
                  ? '范围内整数不够，实际抽取 ' + uniqueN + ' 个'
                  : undefined
            }
          >
            随机 ×{unique ? Math.max(0, uniqueN) : drawCount}
          </button>

          {(rollError || invalidIntegerRange) && (
            <p className="muted" style={{ color: 'var(--red)', fontSize: 13, margin: 0 }}>
              {rollError || '当前区间内没有整数，请调整最小/最大值或小数位'}
            </p>
          )}

          <div className="field">
            <label>名称</label>
            <div className="row">
              <input
                className="input"
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
      <div className="field" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
        <label>名称</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>最小</label>
        <input
          type="number"
          className="input"
          style={{ width: 80 }}
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>最大</label>
        <input
          type="number"
          className="input"
          style={{ width: 80 }}
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
      </div>
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
