import { useState, useMemo } from 'react'
import {
  useRandomData,
  addBank,
  updateBank,
  deleteBank,
  addWord,
  updateWord,
  deleteWord,
  parseImportText,
  batchImportWords,
  pickWeighted,
  getAllCategories,
  getAllTags,
  filterBanksByTag,
  addPreset,
  deletePreset,
  exportBank,
  exportAll,
  detectImportFormat,
  importBank,
  importAll,
  addRandomRecord,
  type ImportedFormat,
} from '../../randomStore'
import type { WordBank, WordEntry, Preset } from '../../randomTypes'

// 单次抽取数量选项
const COUNT_OPTIONS = [1, 3, 5, 10]

// 解析标签输入（逗号/空格/中文逗号分隔）
function parseTagInput(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// 触发下载
function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function WordBankRandomizer() {
  const data = useRandomData()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newTags, setNewTags] = useState('')
  const [separator, setSeparator] = useState(' + ')
  // 预设
  const [presetName, setPresetName] = useState('')
  // 通用导入导出
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<ImportedFormat | null>(null)

  const categories = useMemo(() => getAllCategories(data.banks), [data.banks])
  const allTags = useMemo(() => getAllTags(data.banks), [data.banks])

  // 分类 + 标签双重筛选
  const filteredBanks = useMemo(() => {
    let list = data.banks
    if (filterCategory) list = list.filter((b) => b.category === filterCategory)
    if (filterTag) list = filterBanksByTag(list, filterTag)
    return list
  }, [data.banks, filterCategory, filterTag])

  const selectedBanks = data.banks.filter((b) => selectedIds.includes(b.id))
  const editingBank = data.banks.find((b) => b.id === editingId) ?? null

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleCreate = () => {
    if (!newName.trim()) return
    const tags = parseTagInput(newTags)
    const b = addBank({ name: newName, category: newCategory, tags })
    setSelectedIds((prev) => [...prev, b.id])
    setNewName('')
    setNewCategory('')
    setNewTags('')
  }

  // 加载预设 → 切换选中词库
  const applyPreset = (pre: Preset) => {
    const valid = pre.bankIds.filter((id) => data.banks.some((b) => b.id === id))
    setSelectedIds(valid)
  }

  const handleSavePreset = () => {
    if (!presetName.trim() || selectedIds.length === 0) return
    addPreset({ name: presetName, bankIds: [...selectedIds] })
    setPresetName('')
  }

  // 导入预览
  const handlePreviewImport = (text: string) => {
    setImportText(text)
    if (!text.trim()) {
      setImportPreview(null)
      return
    }
    setImportPreview(detectImportFormat(text))
  }

  const handleConfirmImport = () => {
    if (!importPreview || importPreview.type === 'invalid') return
    if (importPreview.type === 'bank') {
      const b = importBank(importPreview.data)
      setSelectedIds((prev) => [...prev, b.id])
    } else {
      const res = importAll(importPreview.data)
      if (res.bankIds.length > 0) {
        setSelectedIds((prev) => [...new Set([...prev, ...res.bankIds])])
      }
      const parts: string[] = []
      if (res.addedBanks) parts.push(`词库 +${res.addedBanks}`)
      if (res.skippedBanks) parts.push(`词库跳过 ${res.skippedBanks}`)
      if (res.addedPresets) parts.push(`预设 +${res.addedPresets}`)
      if (res.skippedPresets) parts.push(`预设跳过 ${res.skippedPresets}`)
      if (res.addedRanges) parts.push(`范围 +${res.addedRanges}`)
      if (res.skippedRanges) parts.push(`范围跳过 ${res.skippedRanges}`)
      if (parts.length) alert('导入完成：' + parts.join('，'))
    }
    setImportText('')
    setImportPreview(null)
    setShowImport(false)
  }

  // 编辑模式 → 全屏编辑器
  if (editingBank) {
    return (
      <div>
        <BankEditor
          bank={editingBank}
          onBack={() => setEditingId(null)}
        />
      </div>
    )
  }

  return (
    <div className="form-stack" style={{ gap: 16 }}>
      {/* ===== 预设快捷调用 ===== */}
      {data.presets.length > 0 && (
        <div className="section">
          <div className="section-title">
            ⚡ 快捷预设
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
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rt-grid">
        {/* ===== 左侧：词库池管理 ===== */}
        <div className="section">
          <div className="section-title">
            📝 词库池
            <span className="count">（{data.banks.length}）</span>
          </div>

          {/* 新建词库：名称 + 分类 + 标签 */}
          <div style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              <input
                className="input"
                style={{ flex: 2 }}
                placeholder="词库名，如：水果"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="分类（可选）"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="标签（逗号/空格分隔，如 食物,自然）"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <button
              className="btn primary"
              onClick={handleCreate}
              disabled={!newName.trim()}
              style={{ width: '100%' }}
            >
              + 新建词库
            </button>
          </div>

          {/* 导入 / 导出按钮 */}
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            <button className="btn sm" onClick={() => setShowImport(!showImport)}>
              📥 导入
            </button>
            <button
              className="btn sm"
              onClick={() => downloadJson('banks.json', exportAll())}
            >
              📤 导出全部
            </button>
          </div>

          {/* 导入面板 */}
          {showImport && (
            <div className="import-box" style={{ marginBottom: 10 }}>
              <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
                粘贴 JSON：支持单词库格式（{"{"}name,category,tags,words{"}"}）或全量备份格式（{"{"}ranges,banks,presets{"}"}）
              </div>
              <textarea
                className="input"
                style={{ minHeight: 100, resize: 'vertical' }}
                placeholder={'单词库示例：\n{\n  "name":"水果",\n  "category":"食物",\n  "tags":["自然"],\n  "words":[{"text":"苹果","weight":1}]\n}'}
                value={importText}
                onChange={(e) => handlePreviewImport(e.target.value)}
              />
              {importPreview && (
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 6,
                    padding: '6px 8px',
                    borderRadius: 4,
                    background:
                      importPreview.type === 'invalid'
                        ? 'rgba(200,60,60,0.1)'
                        : 'rgba(100,160,80,0.1)',
                  }}
                >
                  {importPreview.type === 'invalid' ? (
                    <span style={{ color: 'var(--red)' }}>
                      ⚠ {importPreview.error}
                    </span>
                  ) : importPreview.type === 'bank' ? (
                    <span>
                      ✅ 单词库：{importPreview.data.name}（
                      {importPreview.data.words?.length ?? 0} 词条
                      {Array.isArray(importPreview.data.tags) && importPreview.data.tags.length
                        ? `，${importPreview.data.tags.length} 标签`
                        : ''}
                      ）
                    </span>
                  ) : (
                    <span>
                      ✅ 全量备份：{importPreview.data.banks?.length ?? 0} 词库，
                      {importPreview.data.ranges?.length ?? 0} 范围，
                      {importPreview.data.presets?.length ?? 0} 预设
                      <br />
                      <span className="faint">导入时按名称去重，不覆盖已有数据</span>
                    </span>
                  )}
                </div>
              )}
              <button
                className="btn primary"
                style={{ marginTop: 8 }}
                disabled={!importPreview || importPreview.type === 'invalid'}
                onClick={handleConfirmImport}
              >
                确认导入
              </button>
            </div>
          )}

          {/* 分类筛选 */}
          {categories.length > 0 && (
            <div className="row wrap" style={{ marginBottom: 8, gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>分类：</span>
              <button
                className={`btn sm ${filterCategory === '' ? 'primary' : ''}`}
                onClick={() => setFilterCategory('')}
              >
                全部
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`btn sm ${filterCategory === cat ? 'primary' : ''}`}
                  onClick={() => setFilterCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* 标签筛选 */}
          {allTags.length > 0 && (
            <div className="row wrap" style={{ marginBottom: 8, gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>标签：</span>
              <button
                className={`btn sm ${filterTag === '' ? 'primary' : ''}`}
                onClick={() => setFilterTag('')}
              >
                全部
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  className={`btn sm ${filterTag === t ? 'primary' : ''}`}
                  onClick={() => setFilterTag(t)}
                  style={{ borderRadius: 999 }}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          {/* 全选/清空 */}
          {filteredBanks.length > 0 && (
            <div className="row" style={{ marginBottom: 8, gap: 6 }}>
              <button
                className="btn sm"
                onClick={() => setSelectedIds(filteredBanks.map((b) => b.id))}
              >
                全选筛选结果
              </button>
              <button className="btn sm" onClick={() => setSelectedIds([])}>
                清空选择
              </button>
              <span className="faint" style={{ fontSize: 12 }}>
                已选 {selectedIds.length} 个
              </span>
            </div>
          )}

          {/* 词库列表 */}
          {filteredBanks.length === 0 ? (
            <p className="faint" style={{ fontSize: 13 }}>尚无词库。</p>
          ) : (
            <div className="obj-list">
              {filteredBanks.map((b) => {
                const isSelected = selectedIds.includes(b.id)
                return (
                  <div
                    key={b.id}
                    className={`obj-item ${isSelected ? 'current' : ''}`}
                    style={{ cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(b.id)}
                      style={{ marginRight: 6 }}
                    />
                    <span className="idx">{b.words.length}</span>
                    <div
                      style={{ flex: 1, minWidth: 0 }}
                      onClick={() => toggleSelect(b.id)}
                    >
                      <div style={{ fontWeight: 600 }}>{b.name}</div>
                      <div className="faint" style={{ fontSize: 11 }}>
                        {b.category || '未分类'}
                        {b.tags.length > 0 && (
                          <span style={{ marginLeft: 6 }}>
                            {' '}
                            {b.tags.map((t) => (
                              <span
                                key={t}
                                style={{
                                  display: 'inline-block',
                                  padding: '0 6px',
                                  margin: '0 2px',
                                  borderRadius: 999,
                                  background: 'var(--bg-soft)',
                                  fontSize: 10,
                                }}
                              >
                                #{t}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      className="icon-btn"
                      title="导出此词库"
                      onClick={(e) => {
                        e.stopPropagation()
                        const json = exportBank(b.id)
                        if (json) downloadJson(`${b.name}.json`, json)
                      }}
                    >
                      ⇩
                    </button>
                    <button
                      className="icon-btn"
                      title="编辑词库"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(b.id)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="icon-btn danger"
                      title="删除词库"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`删除词库「${b.name}」？`)) {
                          deleteBank(b.id)
                          setSelectedIds((prev) => prev.filter((x) => x !== b.id))
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ===== 右侧：随机抽取 ===== */}
        <div className="section">
          {selectedBanks.length === 0 ? (
            <div>
              <div className="section-title">🎲 随机抽取</div>
              <p className="faint" style={{ fontSize: 13 }}>
                从左侧勾选词库参与随机。选 1 个为单抽，选多个为组合随机。
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
                  💾 保存预设
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
            />
          )}
        </div>
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
}: {
  banks: WordBank[]
  separator: string
  onSeparatorChange: (s: string) => void
  presetName: string
  onPresetNameChange: (s: string) => void
  onSavePreset: () => void
}) {
  const isSingle = banks.length === 1
  const [drawCount, setDrawCount] = useState(1)
  const [results, setResults] = useState<string[][]>([])
  const allHasItems = banks.every((b) => b.words.length > 0)

  const handleDraw = () => {
    const picks: string[][] = []
    for (let i = 0; i < drawCount; i++) {
      const row = banks.map((b) => {
        const pick = pickWeighted(b.words)
        return pick?.text ?? '—'
      })
      picks.push(row)
    }
    setResults(picks)
    // 写入随机记录
    const bankNames = banks.map((b) => b.name).join(separator)
    const resultText = picks
      .map((row) => row.join(separator))
      .join('\n')
    addRandomRecord({
      type: 'wordbank',
      summary: `${bankNames} ×${drawCount}`,
      result: resultText,
    })
  }

  const bankKey = banks.map((b) => b.id).join(',')

  return (
    <div className="form-stack" key={bankKey}>
      <div className="section-title">
        {isSingle
          ? `单抽：${banks[0].name}`
          : `组合随机（${banks.length} 个词库）`}
      </div>

      {/* 选中词库标签 + 分隔符 */}
      {!isSingle && (
        <>
          <div className="bank-tags">
            {banks.map((b) => (
              <span key={b.id} className="tag">
                {b.name}（{b.words.length}）
              </span>
            ))}
          </div>
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
          <div className="rt-text-list">
            {results.map((row, i) => (
              <div key={i} className="rt-text-row">
                {row.join(separator)}
              </div>
            ))}
          </div>
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
        🎲 {isSingle ? '随机抽取' : '组合随机'} ×{drawCount}
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
          💾 保存预设
        </button>
      </div>
    </div>
  )
}

// ===== 词库编辑器 =====
function BankEditor({ bank, onBack }: { bank: WordBank; onBack: () => void }) {
  const [newWord, setNewWord] = useState('')
  const [newWeight, setNewWeight] = useState(1)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<{
    entries: WordEntry[]
    duplicates: number
  } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(bank.name)
  const [categoryVal, setCategoryVal] = useState(bank.category)
  const [tagsVal, setTagsVal] = useState(bank.tags.join(', '))

  const handlePreviewImport = (text: string) => {
    setImportText(text)
    if (!text.trim()) {
      setImportPreview(null)
      return
    }
    const existingTexts = bank.words.map((w) => w.text)
    setImportPreview(parseImportText(text, existingTexts))
  }

  const handleConfirmImport = () => {
    if (!importText.trim()) return
    const preview = batchImportWords(bank.id, importText)
    if (preview.duplicates > 0) {
      alert(`已导入 ${preview.entries.length} 条，跳过 ${preview.duplicates} 条重复`)
    }
    setImportText('')
    setImportPreview(null)
    setShowImport(false)
  }

  return (
    <div className="form-stack">
      <button className="back-link" onClick={onBack}>
        ← 返回词库池
      </button>

      <div className="section-title">
        📝 编辑词库：{bank.name}
        <span className="count">（{bank.words.length} 词条）</span>
      </div>

      {/* 重命名 + 分类 + 标签 */}
      {editingName ? (
        <div className="form-stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input"
              style={{ flex: 2 }}
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              autoFocus
              placeholder="词库名"
            />
            <input
              className="input"
              style={{ flex: 1 }}
              value={categoryVal}
              onChange={(e) => setCategoryVal(e.target.value)}
              placeholder="分类"
            />
          </div>
          <input
            className="input"
            value={tagsVal}
            onChange={(e) => setTagsVal(e.target.value)}
            placeholder="标签（逗号/空格分隔）"
          />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn sm primary"
              onClick={() => {
                updateBank(bank.id, {
                  name: nameVal.trim() || bank.name,
                  category: categoryVal.trim(),
                  tags: parseTagInput(tagsVal),
                })
                setEditingName(false)
              }}
            >
              保存
            </button>
            <button
              className="btn sm"
              onClick={() => {
                setNameVal(bank.name)
                setCategoryVal(bank.category)
                setTagsVal(bank.tags.join(', '))
                setEditingName(false)
              }}
            >
              取消
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                const json = exportBank(bank.id)
                if (json) downloadJson(`${bank.name}.json`, json)
              }}
            >
              📤 导出此词库
            </button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm ghost" onClick={() => setEditingName(true)}>
            ✎ 重命名 / 分类 / 标签
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              const json = exportBank(bank.id)
              if (json) downloadJson(`${bank.name}.json`, json)
            }}
          >
            📤 导出此词库
          </button>
          {bank.tags.length > 0 && (
            <div className="row wrap" style={{ gap: 4, flex: 1 }}>
              {bank.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    padding: '1px 8px',
                    borderRadius: 999,
                    background: 'var(--bg-soft)',
                    fontSize: 11,
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 提示区 */}
      <div className="rt-result">
        {bank.words.length ? (
          <span className="faint" style={{ fontSize: 13 }}>
            共 {bank.words.length} 词条，去词库池勾选后随机抽取
          </span>
        ) : (
          <span className="faint">先添加词条</span>
        )}
      </div>

      {/* 添加词条 */}
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="词条文本"
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newWord.trim()) {
              addWord(bank.id, newWord, newWeight)
              setNewWord('')
              setNewWeight(1)
            }
          }}
        />
        <input
          className="input weight-input"
          type="number"
          min={1}
          value={newWeight}
          onChange={(e) => setNewWeight(Math.max(1, Number(e.target.value) || 1))}
          title="权重"
          style={{ width: 60 }}
        />
        <button
          className="btn sm"
          onClick={() => {
            if (newWord.trim()) {
              addWord(bank.id, newWord, newWeight)
              setNewWord('')
              setNewWeight(1)
            }
          }}
        >
          + 添加
        </button>
        <button className="btn sm" onClick={() => setShowImport(!showImport)}>
          📋 导入
        </button>
      </div>

      {/* 批量导入 */}
      {showImport && (
        <div className="import-box">
          <textarea
            className="input"
            style={{ minHeight: 100, resize: 'vertical' }}
            placeholder={
              '支持格式：\n苹果\n梨\n（空行自动忽略）\n\n或逗号分隔：\n苹果,梨,草莓\n\n带权重：\n苹果|5\n梨|2'
            }
            value={importText}
            onChange={(e) => handlePreviewImport(e.target.value)}
          />
          {importPreview && (
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              预览：新增 {importPreview.entries.length} 条
              {importPreview.duplicates > 0 &&
                `，重复跳过 ${importPreview.duplicates} 条`}
              {importPreview.entries.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {importPreview.entries.slice(0, 10).map((e, i) => (
                    <span key={i} style={{ marginRight: 8 }}>
                      {e.text}
                      {e.weight > 1 ? `(${e.weight})` : ''}
                    </span>
                  ))}
                  {importPreview.entries.length > 10 && ' …'}
                </div>
              )}
            </div>
          )}
          <button
            className="btn primary"
            style={{ marginTop: 8 }}
            disabled={!importPreview?.entries.length}
            onClick={handleConfirmImport}
          >
            确认导入
          </button>
        </div>
      )}

      {/* 词条列表 */}
      <div className="obj-list">
        {bank.words.map((w, idx) => (
          <WordRow key={idx} word={w} index={idx} bankId={bank.id} />
        ))}
      </div>
    </div>
  )
}

// ===== 词条行 =====
function WordRow({
  word,
  index,
  bankId,
}: {
  word: WordEntry
  index: number
  bankId: string
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(word.text)
  const [weight, setWeight] = useState(word.weight)

  if (editing) {
    return (
      <div className="obj-item" style={{ gap: 6 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <input
          className="input weight-input"
          type="number"
          min={1}
          value={weight}
          onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 60 }}
          title="权重"
        />
        <button
          className="btn sm primary"
          onClick={() => {
            updateWord(bankId, index, {
              text: text.trim() || word.text,
              weight,
            })
            setEditing(false)
          }}
        >
          保存
        </button>
        <button
          className="btn sm"
          onClick={() => {
            setText(word.text)
            setWeight(word.weight)
            setEditing(false)
          }}
        >
          取消
        </button>
      </div>
    )
  }

  return (
    <div className="obj-item">
      <span className="idx">{index + 1}</span>
      <span style={{ flex: 1 }}>{word.text}</span>
      {word.weight > 1 && (
        <span
          className="faint"
          style={{
            fontSize: 11,
            background: 'var(--bg-soft)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          ×{word.weight}
        </span>
      )}
      <div className="ops">
        <button className="icon-btn" title="编辑" onClick={() => setEditing(true)}>
          ✎
        </button>
        <button
          className="icon-btn danger"
          title="删除"
          onClick={() => deleteWord(bankId, index)}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
