import { useState } from 'react'
import {
  useRandomData,
  addPreset,
  deletePreset,
  pickWeighted,
  addRandomRecord,
  getLastPickedWordId,
  setLastPickedWordId,
  clearLastPickedWordIds,
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

// 排除模式持久化 key：off=不排除；norepeat=不连抽（排除上一次抽到的词）；noreturn=不放回（抽出即排除）
const EXCLUDE_MODE_KEY = 'learning-manager:wb-exclude-mode'
type ExcludeMode = 'off' | 'norepeat' | 'noreturn'

function loadExcludeMode(): ExcludeMode {
  try {
    const v = localStorage.getItem(EXCLUDE_MODE_KEY)
    if (v === 'off' || v === 'norepeat' || v === 'noreturn') return v
    // 旧偏好迁移：不连抽开关
    if (localStorage.getItem('learning-manager:wb-no-repeat') === '1') return 'norepeat'
  } catch {
    /* ignore */
  }
  return 'off'
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
            {/* 保存预设入口 */}
            <div className="row wrap" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
                <label>预设名</label>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
              </div>
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

  // 排除模式：off=不排除；norepeat=不连抽；noreturn=不放回（抽出即排除，抽完需重置）
  const [mode, setMode] = useState<ExcludeMode>(loadExcludeMode)
  // 不放回模式的会话级排除集合（按词库，内存态不落盘）
  const [excluded, setExcluded] = useState<Map<string, Set<string>>>(new Map())

  const setModeAndClear = (m: ExcludeMode) => {
    setMode(m)
    clearLastPickedWordIds()
    setExcluded(new Map())
    try {
      localStorage.setItem(EXCLUDE_MODE_KEY, m)
    } catch {
      /* ignore */
    }
  }

  const resetExcluded = () => setExcluded(new Map())

  // 不放回：已抽 / 总数
  const totalWords = banks.reduce((s, b) => s + b.words.length, 0)
  const drawnWords = banks.reduce((s, b) => s + (excluded.get(b.id)?.size ?? 0), 0)
  const exhausted = mode === 'noreturn' && totalWords > 0 && drawnWords >= totalWords

  const handleDraw = () => {
    const picks: { bankId: string; bankName: string; text: string }[][] = []
    // 不连抽：排除上一次抽到的 + 本批次已抽到的
    const batchExcluded = new Map<string, Set<string>>()
    if (mode === 'norepeat') {
      for (const b of banks) {
        const last = getLastPickedWordId(b.id)
        if (last) batchExcluded.set(b.id, new Set([last]))
      }
    }
    // 不放回：本批新增的排除（结束一次写入）
    const newExcluded = new Map(excluded)
    for (let i = 0; i < drawCount; i++) {
      const row = banks.map((b) => {
        let pick: { id: string; text: string } | null = null
        if (mode === 'noreturn') {
          const excl = newExcluded.get(b.id)
          const remaining = b.words.filter((w) => !excl?.has(w.id))
          if (remaining.length > 0) pick = pickWeighted(b.words, excl)
        } else {
          const excl = mode === 'norepeat' ? batchExcluded.get(b.id) : undefined
          pick = pickWeighted(b.words, excl)
        }
        if (pick) {
          if (mode === 'norepeat') {
            let s = batchExcluded.get(b.id)
            if (!s) {
              s = new Set()
              batchExcluded.set(b.id, s)
            }
            s.add(pick.id)
            setLastPickedWordId(b.id, pick.id)
          } else if (mode === 'noreturn') {
            let s = newExcluded.get(b.id)
            if (!s) {
              s = new Set()
              newExcluded.set(b.id, s)
            }
            s.add(pick.id)
          }
        }
        return {
          bankId: b.id,
          bankName: b.name,
          text: pick?.text ?? '—',
        }
      })
      picks.push(row)
    }
    if (mode === 'noreturn') setExcluded(newExcluded)
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

      {/* 排除模式 */}
      <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 13 }}>排除：</span>
        {(
          [
            ['off', '无'],
            ['norepeat', '不连抽'],
            ['noreturn', '不放回'],
          ] as Array<[ExcludeMode, string]>
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={`btn sm ${mode === m ? 'primary' : ''}`}
            title={
              m === 'norepeat'
                ? '排除上一次抽到的词'
                : m === 'noreturn'
                  ? '抽出即排除，抽完需重置'
                  : undefined
            }
            onClick={() => setModeAndClear(m)}
          >
            {label}
          </button>
        ))}
        {mode === 'noreturn' && (
          <>
            <span className="faint" style={{ fontSize: 12 }}>
              已抽 {drawnWords}/{totalWords}
            </span>
            <button
              type="button"
              className="btn sm"
              onClick={resetExcluded}
              disabled={drawnWords === 0}
            >
              重置
            </button>
          </>
        )}
      </div>

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
        disabled={!allHasItems || exhausted}
        title={exhausted ? '词库已抽完，点「重置」后再抽' : undefined}
      >
        {isSingle ? '随机抽取' : '组合随机'} ×{drawCount}
      </button>

      {/* 保存预设入口 */}
      <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
          <label>预设名</label>
          <input
            className="input"
            style={{ flex: 1 }}
            value={presetName}
            onChange={(e) => onPresetNameChange(e.target.value)}
          />
        </div>
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
