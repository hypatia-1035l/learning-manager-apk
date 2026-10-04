import { useState } from 'react'
import {
  useRandomData,
  randColorInRange,
  hslToRgb,
  rgbToHex,
  addColorRange,
  updateColorRange,
  deleteColorRange,
  addRandomRecord,
} from '../../randomStore'
import type { ColorMode, ColorRange } from '../../randomTypes'

// 各模式的通道默认值（切换模式时载入）
const MODE_DEFAULTS: Record<ColorMode, { c1: [number, number]; c2: [number, number]; c3: [number, number] }> = {
  rgb: { c1: [0, 255], c2: [0, 255], c3: [0, 255] },
  gray: { c1: [0, 255], c2: [0, 255], c3: [0, 255] },
  hsl: { c1: [0, 360], c2: [0, 100], c3: [30, 85] },
}

const MODE_LABELS: Record<ColorMode, string> = {
  rgb: 'RGB',
  gray: '灰阶',
  hsl: 'HSL',
}

// 各模式三通道的标签与量程（gray 只用 c1）
const CHANNEL_META: Record<ColorMode, { labels: [string, string, string]; max: [number, number, number] }> = {
  rgb: { labels: ['R 红', 'G 绿', 'B 蓝'], max: [255, 255, 255] },
  gray: { labels: ['明度', '', ''], max: [255, 255, 255] },
  hsl: { labels: ['H 色相', 'S 饱和度', 'L 明度'], max: [360, 100, 100] },
}

interface Pick {
  r: number
  g: number
  b: number
  hex: string
}

// 复制文本到剪贴板；Clipboard API 不可用时回退 execCommand
function copyText(text: string): boolean {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {})
      return true
    }
  } catch { /* ignore */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// 范围中点色：常用列表的稳定预览色（不随机，避免每次渲染抖动）
function previewColor(r: ColorRange): string {
  if (r.mode === 'hsl') {
    const [rr, gg, bb] = hslToRgb(
      Math.round((r.c1Min + r.c1Max) / 2),
      Math.round((r.c2Min + r.c2Max) / 2),
      Math.round((r.c3Min + r.c3Max) / 2),
    )
    return rgbToHex(rr, gg, bb)
  }
  const mid = (a: number, b: number) => Math.round((a + b) / 2)
  const c2 = r.mode === 'gray' ? mid(r.c1Min, r.c1Max) : mid(r.c2Min, r.c2Max)
  const c3 = r.mode === 'gray' ? mid(r.c1Min, r.c1Max) : mid(r.c3Min, r.c3Max)
  return rgbToHex(mid(r.c1Min, r.c1Max), c2, c3)
}

interface ChannelState {
  c1Min: string; c1Max: string
  c2Min: string; c2Max: string
  c3Min: string; c3Max: string
}

function loadDefaults(mode: ColorMode): ChannelState {
  const d = MODE_DEFAULTS[mode]
  return {
    c1Min: String(d.c1[0]), c1Max: String(d.c1[1]),
    c2Min: String(d.c2[0]), c2Max: String(d.c2[1]),
    c3Min: String(d.c3[0]), c3Max: String(d.c3[1]),
  }
}

function rangeFromState(mode: ColorMode, s: ChannelState): Omit<ColorRange, 'id' | 'name'> {
  return {
    mode,
    c1Min: Number(s.c1Min) || 0, c1Max: Number(s.c1Max) || 0,
    c2Min: Number(s.c2Min) || 0, c2Max: Number(s.c2Max) || 0,
    c3Min: Number(s.c3Min) || 0, c3Max: Number(s.c3Max) || 0,
  }
}

// 范围描述文本（记录 summary / 常用列表副标题共用）
function rangeDesc(mode: ColorMode, s: ChannelState): string {
  const m = CHANNEL_META[mode]
  const part = (label: string, min: string, max: string) => `${label} ${min}-${max}`
  if (mode === 'gray') return part('明度', s.c1Min, s.c1Max)
  return `${part(m.labels[0], s.c1Min, s.c1Max)} · ${part(m.labels[1], s.c2Min, s.c2Max)} · ${part(m.labels[2], s.c3Min, s.c3Max)}`
}

export function ColorRandomizer() {
  const data = useRandomData()
  const [mode, setMode] = useState<ColorMode>('rgb')
  const [channels, setChannels] = useState<ChannelState>(() => loadDefaults('rgb'))
  const [drawCount, setDrawCount] = useState(3)
  const [results, setResults] = useState<Pick[]>([])
  const [newName, setNewName] = useState('')
  const [copied, setCopied] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const meta = CHANNEL_META[mode]
  const range = rangeFromState(mode, channels)

  const setCh = (k: keyof ChannelState, v: string) =>
    setChannels((c) => ({ ...c, [k]: v }))

  const handleModeChange = (m: ColorMode) => {
    setMode(m)
    setChannels(loadDefaults(m))
    setResults([])
  }

  const handleRoll = () => {
    const picks: Pick[] = []
    for (let i = 0; i < drawCount; i++) {
      picks.push(randColorInRange(range))
    }
    setResults(picks)
    addRandomRecord({
      type: 'color',
      summary: `${MODE_LABELS[mode]} · ${rangeDesc(mode, channels)} ×${drawCount}`,
      result: picks.map((p) => p.hex).join('\n'),
    })
  }

  const handleSave = () => {
    if (!newName.trim()) return
    addColorRange({ name: newName.trim(), ...range })
    setNewName('')
  }

  const handleCopy = (text: string, tag: string) => {
    if (copyText(text)) {
      setCopied(tag)
      setTimeout(() => setCopied((cur) => (cur === tag ? '' : cur)), 1500)
    }
  }

  const handleLoadRange = (r: ColorRange) => {
    setMode(r.mode)
    setChannels({
      c1Min: String(r.c1Min), c1Max: String(r.c1Max),
      c2Min: String(r.c2Min), c2Max: String(r.c2Max),
      c3Min: String(r.c3Min), c3Max: String(r.c3Max),
    })
    setResults([])
  }

  const copyAllHex = results.map((p) => p.hex).join('\n')
  const copyAllRgb = results.map((p) => `${p.r}, ${p.g}, ${p.b}`).join('\n')

  // 单通道输入行
  const channelRow = (idx: 1 | 2 | 3) => {
    const label = meta.labels[idx - 1]
    if (!label) return null
    const minKey = (`c${idx}Min` as keyof ChannelState)
    const maxKey = (`c${idx}Max` as keyof ChannelState)
    return (
      <div className="row" key={idx}>
        <span className="cr-channel-label">{label}</span>
        <input
          type="number" className="input" placeholder="最小"
          value={channels[minKey]}
          onChange={(e) => { setCh(minKey, e.target.value); setResults([]) }}
        />
        <span className="faint">–</span>
        <input
          type="number" className="input" placeholder="最大"
          value={channels[maxKey]}
          onChange={(e) => { setCh(maxKey, e.target.value); setResults([]) }}
        />
      </div>
    )
  }

  return (
    <div className="rt-grid">
      <div className="section">
        <div className="section-title">颜色随机</div>

        <div className="form-stack">
          {/* 模式切换 */}
          <div className="field">
            <label>采样模式</label>
            <div className="row" style={{ gap: 6 }}>
              {(Object.keys(MODE_LABELS) as ColorMode[]).map((m) => (
                <button
                  key={m}
                  className={`btn sm ${mode === m ? 'primary' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => handleModeChange(m)}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* 通道范围 */}
          <div className="field">
            <label>{mode === 'gray' ? '明度范围' : '通道范围'}</label>
            <div className="cr-channels">
              {channelRow(1)}
              {mode !== 'gray' && channelRow(2)}
              {mode !== 'gray' && channelRow(3)}
            </div>
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

          {/* 结果色块 */}
          <div className="rt-result" style={{ flexDirection: 'column', gap: 10 }}>
            {results.length ? (
              <>
                <div className="color-grid">
                  {results.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className="color-swatch"
                      title={`点击复制 ${p.hex}`}
                      onClick={() => handleCopy(p.hex, `s${i}`)}
                    >
                      <span className="color-block" style={{ background: p.hex }} />
                      <span className="color-hex">{p.hex}</span>
                      {copied === `s${i}` && <span className="color-copied">已复制</span>}
                    </button>
                  ))}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => handleCopy(copyAllHex, 'hex')}>
                    {copied === 'hex' ? '已复制' : '复制全部 HEX'}
                  </button>
                  <button className="btn sm" onClick={() => handleCopy(copyAllRgb, 'rgb')}>
                    {copied === 'rgb' ? '已复制' : '复制全部 RGB'}
                  </button>
                </div>
              </>
            ) : (
              <span className="faint">点击下方按钮开始随机</span>
            )}
          </div>

          <button className="btn primary lg" onClick={handleRoll}>
            随机 ×{drawCount}
          </button>

          <div className="field">
            <label>名称</label>
            <div className="row">
              <input
                className="input"
                placeholder="保存当前范围为常用"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
              <button className="btn" onClick={handleSave} disabled={!newName.trim()}>
                保存
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          常用范围
          <span className="count">（{data.colorRanges.length}）</span>
        </div>

        {data.colorRanges.length === 0 ? (
          <p className="faint" style={{ fontSize: 13 }}>
            尚无保存的范围。
          </p>
        ) : (
          <div className="obj-list">
            {data.colorRanges.map((r) => (
              <div key={r.id} className="obj-item">
                {editingId === r.id ? (
                  <ColorRangeEditRow
                    range={r}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <span
                      className="color-mini"
                      style={{ background: previewColor(r) }}
                      aria-hidden
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {r.name}
                        <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>
                          {MODE_LABELS[r.mode]}
                        </span>
                      </div>
                      <div className="faint" style={{ fontSize: 12 }}>
                        {rangeDesc(r.mode, {
                          c1Min: String(r.c1Min), c1Max: String(r.c1Max),
                          c2Min: String(r.c2Min), c2Max: String(r.c2Max),
                          c3Min: String(r.c3Min), c3Max: String(r.c3Max),
                        })}
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
                          confirm(`删除范围「${r.name}」？`) && deleteColorRange(r.id)
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

// 常用范围行内编辑：名称 + 按当前模式的通道范围
function ColorRangeEditRow({ range, onDone }: { range: ColorRange; onDone: () => void }) {
  const [name, setName] = useState(range.name)
  const [st, setSt] = useState<ChannelState>({
    c1Min: String(range.c1Min), c1Max: String(range.c1Max),
    c2Min: String(range.c2Min), c2Max: String(range.c2Max),
    c3Min: String(range.c3Min), c3Max: String(range.c3Max),
  })
  const meta = CHANNEL_META[range.mode]

  const num = (v: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)))

  const save = () => {
    updateColorRange(range.id, {
      name: name.trim() || range.name,
      c1Min: num(st.c1Min, meta.max[0]), c1Max: num(st.c1Max, meta.max[0]),
      c2Min: num(st.c2Min, meta.max[1]), c2Max: num(st.c2Max, meta.max[1]),
      c3Min: num(st.c3Min, meta.max[2]), c3Max: num(st.c3Max, meta.max[2]),
    })
    onDone()
  }

  const pair = (idx: 1 | 2 | 3) => {
    const label = meta.labels[idx - 1]
    if (!label) return null
    const minKey = (`c${idx}Min` as keyof ChannelState)
    const maxKey = (`c${idx}Max` as keyof ChannelState)
    return (
      <div className="row" key={idx} style={{ gap: 6 }}>
        <span className="faint" style={{ fontSize: 12, width: 56 }}>{label}</span>
        <input
          type="number" className="input" style={{ flex: 1 }}
          value={st[minKey]}
          onChange={(e) => setSt((s) => ({ ...s, [minKey]: e.target.value }))}
        />
        <input
          type="number" className="input" style={{ flex: 1 }}
          value={st[maxKey]}
          onChange={(e) => setSt((s) => ({ ...s, [maxKey]: e.target.value }))}
        />
      </div>
    )
  }

  return (
    <div className="inline-edit" style={{ flex: 1, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>名称</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      {pair(1)}
      {range.mode !== 'gray' && pair(2)}
      {range.mode !== 'gray' && pair(3)}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm primary" onClick={save}>保存</button>
        <button className="btn sm" onClick={onDone}>取消</button>
      </div>
    </div>
  )
}
