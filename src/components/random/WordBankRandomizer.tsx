import { useState } from 'react'
import {
  useRandomData,
  addPreset,
  deletePreset,
  pickWeighted,
  addRandomRecord,
} from '../../randomStore'
import type { WordBank, Preset } from '../../randomTypes'

// 单次抽取数量选项
const COUNT_OPTIONS = [1, 3, 5, 10]

// 显示模式持久化 key：记住用户上次选择的抽取格式
const DISPLAY_MODE_KEY = 'learning-manager:wb-display-mode'
type DisplayMode = 'inline' | 'attrs'

function loadDisplayMode(): DisplayMode {
  try {
    const v = localStorage.getItem(DISPLAY_MODE_KEY)
    if (v === 'attrs' || v === 'inline') return v
  } catch {
    /* ignore */
  }
  return 'inline'
}

interface Props {
  selectedIds: string[]
  onSelectChange: (ids: string[]) => void
}

export function WordBankRandomizer({ selectedIds, onSelectChange }: Props) {
  const data = useRandomData()
  const [separator, setSeparator] = useState(' + ')
  const [presetName, setPresetName] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  // 抽取结果显示模式：inline=分隔符拼接；attrs=属性表（词库名：词条 换行）
  // 提到顶层并用 localStorage 记忆，避免每次进入都要重新切换
  const [displayMode, setDisplayModeState] = useState<DisplayMode>(loadDisplayMode)

  const setDisplayMode = (m: DisplayMode) => {
    setDisplayModeState(m)
    try {
      localStorage.setItem(DISPLAY_MODE_KEY, m)
    } catch {
      /* ignore */
    }
  }

  const selectedBanks = data.banks.filter((b) => selectedIds.includes(b.id))

  const toggleSelect = (id: string) => {
    onSelectChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    )
  }

  // 加载预设 → 切换选中词库
  const applyPreset = (pre: Preset) => {
    const valid = pre.bankIds.filter((id) => data.banks.some((b) => b.id === id))
    onSelectChange(valid)
  }

  const handleSavePreset = () => {
    if (!presetName.trim() || selectedIds.length === 0) return
    addPreset({ name: presetName, bankIds: [...selectedIds] })
    setPresetName('')
  }

  return (
    <div className="form-stack" style={{ gap: 16 }}>
      {/* ===== 随机抽取（置顶） ===== */}
      <div className="section">
        {selectedBanks.length === 0 ? (
          <div>
            <div className="section-title">随机抽取</div>
            <p className="faint" style={{ fontSize: 13 }}>
              先从下方选择词库参与随机。选 1 个为单抽，选多个为组合随机。
            </p>
            {/* 保存预设入口 */}
            <div className="row" style={{ gap: 6, marginTop: 12 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="选中词库后，输入预设名保存"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <button
                className="btn"
                onClick={handleSavePreset}
                disabled={!presetName.trim() || selectedIds.length === 0}
              >
                保存预设
              </button>
            </div>
          </div>
        ) : (
          <RandomPanel
            banks={selectedBanks}
            separator={separator}
            onSeparatorChange={setSeparator}
            presetName={presetName}
            onPresetNameChange={setPresetName}
            onSavePreset={handleSavePreset}
            displayMode={displayMode}
            onDisplayModeChange={setDisplayMode}
          />
        )}
      </div>

      {/* ===== 预设快捷调用 ===== */}
      {data.presets.length > 0 && (
        <div className="section">
          <div className="section-title">
            快捷预设
            <span className="count">（{data.presets.length}）</span>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {data.presets.map((pre) => {
              const validCount = pre.bankIds.filter((id) =>
                data.banks.some((b) => b.id === id),
              ).length
              return (
                <div
                  key={pre.id}
                  className="obj-item"
                  style={{ width: 'auto', minWidth: 160, cursor: 'pointer' }}
                  onClick={() => applyPreset(pre)}
                  title={`点击加载，含 ${validCount} 个词库`}
                >
                  <span className="idx">{validCount}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{pre.name}</span>
                  <button
                    className="icon-btn danger"
                    title="删除预设"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`删除预设「${pre.name}」？`)) deletePreset(pre.id)
                    }}
                  >
                    删除
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== 词库选择（折叠，置底） ===== */}
      <div className="section">
        <button
          className="wb-picker-toggle"
          onClick={() => setPickerOpen(!pickerOpen)}
          type="button"
        >
          <span className="wb-picker-label">
            选择词库
            <span className="count">（已选 {selectedIds.length}）</span>
          </span>
          <span className="wb-picker-chev">{pickerOpen ? '收起' : '展开'}</span>
        </button>

        {pickerOpen && (
          <div className="wb-picker-body">
            {/* 全选/清空 */}
            {data.banks.length > 0 && (
              <div className="row" style={{ marginBottom: 8, gap: 6 }}>
                <button
                  className="btn sm"
                  onClick={() => onSelectChange(data.banks.map((b) => b.id))}
                >
                  全选
                </button>
                <button className="btn sm" onClick={() => onSelectChange([])}>
                  清空
                </button>
                <span className="faint" style={{ fontSize: 12 }}>
                  共 {data.banks.length} 个词库
                </span>
              </div>
            )}

            {data.banks.length === 0 ? (
              <p className="faint" style={{ fontSize: 13 }}>
                尚无词库，请到「词库管理」创建。
              </p>
            ) : (
              <div className="wb-bank-list">
                {data.banks.map((b) => {
                  const isSelected = selectedIds.includes(b.id)
                  return (
                    <div
                      key={b.id}
                      className={`obj-item ${isSelected ? 'current' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleSelect(b.id)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        style={{ marginRight: 6, pointerEvents: 'none' }}
                      />
                      <span className="idx">{b.words.length}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{b.name}</span>
                        {b.category && (
                          <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>
                            {b.category}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 随机面板 =====
function RandomPanel({
  banks,
  separator,
  onSeparatorChange,
  presetName,
  onPresetNameChange,
  onSavePreset,
  displayMode,
  onDisplayModeChange,
}: {
  banks: WordBank[]
  separator: string
  onSeparatorChange: (s: string) => void
  presetName: string
  onPresetNameChange: (s: string) => void
  onSavePreset: () => void
  displayMode: DisplayMode
  onDisplayModeChange: (m: DisplayMode) => void
}) {
  const isSingle = banks.length === 1
  const [drawCount, setDrawCount] = useState(1)
  const [results, setResults] = useState<{ bankId: string; bankName: string; text: string }[][]>([])
  // 复制按钮反馈：复制后短暂显示「已复制」
  const [copied, setCopied] = useState(false)
  const allHasItems = banks.every((b) => b.words.length > 0)

  const handleDraw = () => {
    const picks: { bankId: string; bankName: string; text: string }[][] = []
    for (let i = 0; i < drawCount; i++) {
      const row = banks.map((b) => {
        const pick = pickWeighted(b.words)
        return {
          bankId: b.id,
          bankName: b.name,
          text: pick?.text ?? '—',
        }
      })
      picks.push(row)
    }
    setResults(picks)
    // 写入随机记录：按当前显示模式决定输出格式
    const bankNames = banks.map((b) => b.name).join(separator)
    const resultText =
      displayMode === 'attrs'
        ? picks
            .map((row) =>
              row.map((r) => `${r.bankName}：${r.text}`).join('\n'),
            )
            .join('\n\n')
        : picks.map((row) => row.map((r) => r.text).join(separator)).join('\n')
    addRandomRecord({
      type: 'wordbank',
      summary: `${bankNames} ×${drawCount}`,
      result: resultText,
    })
  }

  // 复制当前结果到剪贴板，按当前显示模式格式化
  // 优先用 Clipboard API，不可用时降级到 execCommand 兜底（HTTP 环境或老浏览器）
  const handleCopy = async () => {
    if (!results.length) return
    const text =
      displayMode === 'attrs'
        ? results
            .map((row) =>
              row.map((r) => `${r.bankName}：${r.text}`).join('\n'),
            )
            .join('\n\n')
        : results.map((row) => row.map((r) => r.text).join(separator)).join('\n')
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        ok = true
      }
    } catch {
      /* fallthrough to legacy */
    }
    if (!ok) {
      // 兜底：临时 textarea + execCommand
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

  const bankKey = banks.map((b) => b.id).join(',')

  return (
    <div className="form-stack" key={bankKey}>
      <div className="section-title">
        {isSingle
          ? `单抽：${banks[0].name}`
          : `组合随机（${banks.length} 个词库）`}
      </div>

      {/* 选中词库标签 + 分隔符 + 显示模式切换 */}
      {!isSingle && (
        <>
          <div className="bank-tags">
            {banks.map((b) => (
              <span key={b.id} className="tag">
                {b.name}（{b.words.length}）
              </span>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
            {displayMode === 'inline' && (
              <div className="row" style={{ gap: 6 }}>
                <label className="muted" style={{ fontSize: 13 }}>
                  分隔符：
                </label>
                <input
                  className="input"
                  style={{ width: 100 }}
                  value={separator}
                  onChange={(e) => onSeparatorChange(e.target.value)}
                />
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <label className="muted" style={{ fontSize: 13 }}>
                格式：
              </label>
              <button
                className={`btn sm ${displayMode === 'inline' ? 'primary' : ''}`}
                onClick={() => onDisplayModeChange('inline')}
              >
                拼接
              </button>
              <button
                className={`btn sm ${displayMode === 'attrs' ? 'primary' : ''}`}
                onClick={() => onDisplayModeChange('attrs')}
              >
                属性表
              </button>
            </div>
          </div>
        </>
      )}

      {/* 单次抽取数量 */}
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
              setDrawCount(
                Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))),
              )
            }
          />
        </div>
      </div>

      {/* 结果 */}
      <div className="rt-result">
        {results.length ? (
          <>
            <div className="rt-text-list">
              {results.map((row, i) =>
                displayMode === 'attrs' ? (
                  <div
                    key={i}
                    className="rt-text-row"
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {row.map((r) => `${r.bankName}：${r.text}`).join('\n')}
                  </div>
                ) : (
                  <div key={i} className="rt-text-row">
                    {row.map((r) => r.text).join(separator)}
                  </div>
                ),
              )}
            </div>
            <button
              className="btn sm ghost rt-copy-btn"
              onClick={handleCopy}
              title="复制当前结果到剪贴板"
            >
              {copied ? '已复制' : '复制结果'}
            </button>
          </>
        ) : (
          <span className="faint">
            {allHasItems
              ? isSingle
                ? '点击下方按钮随机抽取'
                : '点击下方按钮组合随机'
              : '选中的词库中有空词库'}
          </span>
        )}
      </div>

      <button
        className="btn primary lg"
        onClick={handleDraw}
        disabled={!allHasItems}
      >
        {isSingle ? '随机抽取' : '组合随机'} ×{drawCount}
      </button>

      {/* 保存预设入口 */}
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="输入预设名保存当前组合，如：插画灵感"
          value={presetName}
          onChange={(e) => onPresetNameChange(e.target.value)}
        />
        <button
          className="btn"
          onClick={onSavePreset}
          disabled={!presetName.trim()}
        >
          保存预设
        </button>
      </div>
    </div>
  )
}
