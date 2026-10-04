import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  useRandomData,
  addBank,
  updateBank,
  deleteBank,
  addWord,
  updateWord,
  deleteWord,
  deleteWords,
  parseImportText,
  batchImportWords,
  getAllCategories,
  getAllTags,
  filterBanksByTag,
  exportBank,
  exportAll,
  detectImportFormat,
  importBank,
  importAll,
  type ImportedFormat,
} from '../../randomStore'
import type { WordBank, WordEntry } from '../../randomTypes'
import { readFileAsText } from '../../dataBackup'

// 词条列表单页渲染条数（大字库分页）
const PAGE_SIZE = 100

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

interface Props {
  selectedIds: string[]
  onSelectChange: (ids: string[]) => void
  // 把词库词条（一行一词）送进文本工具加工
  onOpenInTextTools?: (bank: WordBank) => void
}

export function BankManager({ selectedIds, onSelectChange, onOpenInTextTools }: Props) {
  const data = useRandomData()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newTags, setNewTags] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<ImportedFormat | null>(null)
  // 词库文件选择：把 JSON 文件直接读进来，省去手动粘贴长文本
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [readingFile, setReadingFile] = useState(false)

  // 分类候选受当前标签筛选影响（「用标签筛分类」：标签在上，分类在下）
  const categories = useMemo(() => {
    const base = filterTag ? filterBanksByTag(data.banks, filterTag) : data.banks
    return getAllCategories(base)
  }, [data.banks, filterTag])
  const allTags = useMemo(() => getAllTags(data.banks), [data.banks])

  // 切换标签后，若当前选中的分类在新标签下已不存在，自动清空分类选择
  useEffect(() => {
    if (filterCategory && !categories.includes(filterCategory)) {
      setFilterCategory('')
    }
  }, [categories, filterCategory])

  const filteredBanks = useMemo(() => {
    let list = data.banks
    if (filterCategory) list = list.filter((b) => b.category === filterCategory)
    if (filterTag) list = filterBanksByTag(list, filterTag)
    return list
  }, [data.banks, filterCategory, filterTag])

  const editingBank = data.banks.find((b) => b.id === editingId) ?? null

  const toggleSelect = (id: string) => {
    onSelectChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    )
  }

  const handleCreate = () => {
    if (!newName.trim()) return
    const tags = parseTagInput(newTags)
    const b = addBank({ name: newName, category: newCategory, tags })
    onSelectChange([...selectedIds, b.id])
    setNewName('')
    setNewCategory('')
    setNewTags('')
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

  // 从文件读取词库 JSON（复用数据备份模块的读取工具）
  const handlePickFile = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 清空 input，便于重复选择同一文件
    e.target.value = ''
    if (!file) return
    setReadingFile(true)
    try {
      const text = await readFileAsText(file)
      handlePreviewImport(text)
    } catch {
      setImportPreview({ type: 'invalid', error: '读取文件失败' })
    }
    setReadingFile(false)
  }

  // 批量删除当前筛选结果：例如按标签筛出旧导入的词库，一键清掉后再导新包
  const handleDeleteFiltered = () => {
    if (filteredBanks.length === 0) return
    const ok = confirm(
      `删除当前筛选出的 ${filteredBanks.length} 个词库？\n\n此操作不可撤销；只影响词库，不动随机记录与其他数据。`,
    )
    if (!ok) return
    const delIds = new Set(filteredBanks.map((b) => b.id))
    for (const b of filteredBanks) deleteBank(b.id)
    onSelectChange(selectedIds.filter((id) => !delIds.has(id)))
  }

  const handleConfirmImport = () => {
    if (!importPreview || importPreview.type === 'invalid') return
    if (importPreview.type === 'bank') {
      const b = importBank(importPreview.data)
      onSelectChange([...selectedIds, b.id])
    } else {
      const res = importAll(importPreview.data)
      if (res.bankIds.length > 0) {
        onSelectChange([...new Set([...selectedIds, ...res.bankIds])])
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
    <div className="section">
      <div className="section-title">
        词库池
        <span className="count">（{data.banks.length}）</span>
      </div>

      {/* 新建词库 */}
      <div style={{ marginBottom: 10 }}>
        <div className="field" style={{ marginBottom: 6 }}>
          <label>词库名</label>
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <div className="field" style={{ marginBottom: 6 }}>
          <label>分类</label>
          <input
            className="input"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label>标签</label>
          <input
            className="input"
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
          导入
        </button>
        <button
          className="btn sm"
          onClick={() => downloadJson('banks.json', exportAll())}
        >
          导出全部
        </button>
      </div>

      {/* 导入面板 */}
      {showImport && (
        <div className="import-box" style={{ marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label className="faint" style={{ fontSize: 12, display: 'block', marginBottom: 0 }}>
              JSON（粘贴，或选择文件）
            </label>
            <button className="btn sm" onClick={handlePickFile} disabled={readingFile}>
              {readingFile ? '读取中…' : '选择文件'}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json,text/plain"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <textarea
            className="input"
            style={{ minHeight: 100, resize: 'vertical' }}
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
                  {importPreview.error}
                </span>
              ) : importPreview.type === 'bank' ? (
                <span>
                  单词库：{importPreview.data.name}（
                  {importPreview.data.words?.length ?? 0} 词条
                  {Array.isArray(importPreview.data.tags) && importPreview.data.tags.length
                    ? `，${importPreview.data.tags.length} 标签`
                    : ''}
                  ）
                </span>
              ) : (
                <span>
                  全量备份：{importPreview.data.banks?.length ?? 0} 词库，
                  {importPreview.data.ranges?.length ?? 0} 范围，
                  {importPreview.data.presets?.length ?? 0} 预设
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

      {/* 标签筛选（上层：决定下面的分类有哪些） */}
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

      {/* 分类筛选（下层：只列出当前标签下存在的分类） */}
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

      {/* 全选/清空 */}
      {filteredBanks.length > 0 && (
        <div className="row" style={{ marginBottom: 8, gap: 6 }}>
          <button
            className="btn sm"
            onClick={() => onSelectChange(filteredBanks.map((b) => b.id))}
          >
            全选筛选结果
          </button>
          <button className="btn sm" onClick={() => onSelectChange([])}>
            清空选择
          </button>
          <button className="btn sm danger" onClick={handleDeleteFiltered}>
            删除筛选结果
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
        <div className="obj-list bm-bank-list">
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
                <div
                  className="bm-bank-info"
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
                  onClick={() => toggleSelect(b.id)}
                >
                  <div className="bm-bank-name">
                    {b.name}
                  </div>
                  <div className="bm-bank-meta">
                    {b.category || '未分类'} · {b.words.length} 词条
                  </div>
                  {b.tags.length > 0 && (
                    <div className="bm-bank-tags">
                      {b.tags.map((t) => (
                        <span key={t} className="bm-tag">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bm-bank-ops">
                  {onOpenInTextTools && (
                    <button
                      className="icon-btn"
                      title="把词条送进文本工具批量加工"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenInTextTools(b)
                      }}
                    >
                      加工
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title="导出此词库"
                    onClick={(e) => {
                      e.stopPropagation()
                      const json = exportBank(b.id)
                      if (json) downloadJson(`${b.name}.json`, json)
                    }}
                  >
                    导出
                  </button>
                  <button
                    className="icon-btn"
                    title="编辑词库"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingId(b.id)
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="icon-btn danger"
                    title="删除词库"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`删除词库「${b.name}」？`)) {
                        deleteBank(b.id)
                        onSelectChange(selectedIds.filter((x) => x !== b.id))
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ===== 词库编辑器 =====
function BankEditor({ bank, onBack }: { bank: WordBank; onBack: () => void }) {
  // 词条列表搜索 + 分页（大字库友好：默认只渲染前 100 条）
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const filteredWords = useMemo(() => {
    const q = search.trim().toLowerCase()
    const withIdx = bank.words.map((w, idx) => ({ w, idx }))
    if (!q) return withIdx
    return withIdx.filter(({ w }) => w.text.toLowerCase().includes(q))
  }, [bank.words, search])
  const visibleWords = filteredWords.slice(0, visibleCount)
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

  // 批量删除词条：按当前搜索筛选删（搜索为空则清空整库）
  const handleDeleteFiltered = () => {
    if (filteredWords.length === 0) return
    const q = search.trim()
    const n = filteredWords.length
    const head = q
      ? `删除筛选出的 ${n} 条词条？（匹配「${q}」）`
      : `清空该词库全部 ${n} 条词条？`
    if (!confirm(`${head}\n\n此操作不可撤销。`)) return
    deleteWords(bank.id, filteredWords.map(({ w }) => w.id))
    setSearch('')
    setVisibleCount(PAGE_SIZE)
  }

  return (
    <div className="form-stack">
      <button className="back-link" onClick={onBack}>
        ← 返回词库池
      </button>

      <div className="section-title">
        编辑词库：{bank.name}
        <span className="count">（{bank.words.length} 词条）</span>
      </div>

      {/* 重命名 + 分类 + 标签 */}
      {editingName ? (
          <div className="form-stack" style={{ gap: 6 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>词库名</label>
              <input
                className="input"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                autoFocus
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>分类</label>
              <input
                className="input"
                value={categoryVal}
                onChange={(e) => setCategoryVal(e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>标签</label>
              <input
                className="input"
                value={tagsVal}
                onChange={(e) => setTagsVal(e.target.value)}
              />
            </div>
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
              导出此词库
            </button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm ghost" onClick={() => setEditingName(true)}>
            重命名 / 分类 / 标签
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              const json = exportBank(bank.id)
              if (json) downloadJson(`${bank.name}.json`, json)
            }}
          >
            导出此词库
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
            共 {bank.words.length} 词条
          </span>
        ) : (
          <span className="faint">先添加词条</span>
        )}
      </div>

      {/* 添加词条 */}
      <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 2, minWidth: 120, marginBottom: 0 }}>
          <label>词条</label>
          <input
            className="input"
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
        </div>
        <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
          <label>权重</label>
          <input
            className="input weight-input"
            type="number"
            min={1}
            value={newWeight}
            onChange={(e) => setNewWeight(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
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
          添加
        </button>
        <button className="btn sm" onClick={() => setShowImport(!showImport)}>
          导入
        </button>
      </div>

      {/* 批量导入 */}
      {showImport && (
        <div className="import-box">
          <label className="faint" style={{ fontSize: 12, marginBottom: 6, display: 'block' }}>批量</label>
          <textarea
            className="input"
            style={{ minHeight: 100, resize: 'vertical' }}
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
                  {importPreview.entries.slice(0, 10).map((e) => (
                    <span key={e.id} style={{ marginRight: 8 }}>
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

      {/* 搜索 + 批量删除（有词条即可用） */}
      {bank.words.length > 0 && (
        <div className="row" style={{ gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            placeholder={`搜索词条（共 ${bank.words.length} 条）`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setVisibleCount(PAGE_SIZE)
            }}
          />
          <button
            className="btn sm danger"
            style={{ flex: '0 0 auto' }}
            disabled={filteredWords.length === 0}
            onClick={handleDeleteFiltered}
          >
            {search.trim()
              ? `删除筛选（${filteredWords.length}）`
              : `清空全部（${filteredWords.length}）`}
          </button>
        </div>
      )}

      {/* 词条列表：分页渲染，避免大字库一次渲染全部 */}
      <div className="obj-list">
        {visibleWords.map(({ w, idx }) => (
          <WordRow key={w.id} word={w} wordId={w.id} displayIndex={idx} bankId={bank.id} />
        ))}
      </div>
      {filteredWords.length > visibleWords.length && (
        <button
          className="btn"
          style={{ marginTop: 8 }}
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
        >
          显示更多（还有 {filteredWords.length - visibleWords.length} 条）
        </button>
      )}
    </div>
  )
}

// ===== 词条行 =====
// memo：大字库（千级词条）下，页内任意输入不再全量重渲所有行
const WordRow = memo(function WordRow({
  word,
  wordId,
  displayIndex,
  bankId,
}: {
  word: WordEntry
  wordId: string
  displayIndex: number
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
          style={{ flex: 2, minWidth: 0 }}
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
          title="权重"
        />
        <button
          className="btn sm primary"
          onClick={() => {
            updateWord(bankId, wordId, {
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
      <span className="idx">{displayIndex + 1}</span>
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
          编辑
        </button>
        <button
          className="icon-btn danger"
          title="删除"
          onClick={() => confirm(`删除词条「${word.text}」？`) && deleteWord(bankId, wordId)}
        >
          删除
        </button>
      </div>
    </div>
  )
})
