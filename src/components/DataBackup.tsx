import { useRef, useState } from 'react'
import {
  downloadBackup,
  readFileAsText,
  parseBackup,
  validateBackup,
  importBackup,
} from '../dataBackup'
import type { BackupFile } from '../dataBackup'

interface Props {
  onBack: () => void
}

// localStorage key → 友好名称
const KEY_LABELS: Record<string, string> = {
  'learning-manager:data:v1': '学习数据（任务/任务组/学习记录/提醒）',
  'learning-manager:random-toolbox:v1': '工具（数字/词库随机）',
  'learning-manager:slacking-rules:v1': '摸鱼检测规则',
  'learning-manager:app-category-map:v1': '应用分类设置',
  'learning-manager:slacking-alert:v1': '摸鱼提醒（旧版）',
  'learning-manager:vivo-guide-shown:v1': '引导标记',
}

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key
}

export function DataBackup({ onBack }: Props) {
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [validating, setValidating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    try {
      downloadBackup()
      setMsg('已导出，请到下载目录查找 .json 文件')
      setError('')
    } catch {
      setError('导出失败')
    }
  }

  const handlePickFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    // 清空 input，便于重复选择同一文件
    e.target.value = ''
    if (!file) return

    setValidating(true)
    setMsg('')
    setError('')
    setPending(null)

    try {
      const text = await readFileAsText(file)
      const backup = parseBackup(text)
      if (!backup) {
        setError('文件格式不正确，无法识别为备份文件')
        setValidating(false)
        return
      }
      const result = validateBackup(backup)
      if (!result.ok) {
        setError(result.error ?? '备份文件校验失败')
        setValidating(false)
        return
      }
      setPending(backup)
      setMsg(`已读取备份文件，包含 ${result.keyCount} 项数据，请确认导入`)
    } catch {
      setError('读取文件失败')
    }
    setValidating(false)
  }

  const handleConfirmImport = () => {
    if (!pending) return
    importBackup(pending)
    // importBackup 内部会 reload，下面不会执行
  }

  const handleCancelImport = () => {
    setPending(null)
    setMsg('已取消导入')
  }

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← 返回
      </button>
      <header className="app-header">
        <h1 className="app-title">数据备份</h1>
      </header>
      <p className="app-tagline">
        导出全部数据防止丢失 · 导入可跨设备恢复
      </p>

      {/* 导出 */}
      <section className="section">
        <div className="section-title">导出全部数据</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          将以下数据打包为 JSON 文件下载：
        </p>
        <ul className="muted" style={{ fontSize: 13, marginBottom: 14, paddingLeft: 20 }}>
          <li>学习数据（任务、任务组、学习记录、提醒设置）</li>
          <li>工具（数字范围、词库随机）</li>
          <li>摸鱼检测规则（规则、阈值、冷却）</li>
          <li>应用分类设置（自定义分类映射）</li>
        </ul>
        <button className="btn primary" onClick={handleExport}>
          📥 导出全部数据
        </button>
        {msg && !pending && (
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            {msg}
          </p>
        )}
        {error && (
          <p style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>
            {error}
          </p>
        )}
      </section>

      {/* 导入 */}
      <section className="section">
        <div className="section-title">导入恢复</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          选择之前导出的 .json 备份文件，将<strong style={{ color: 'var(--red)' }}>覆盖</strong>当前所有数据。
        </p>
        <p className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
          ⚠️ 导入会替换现有数据，请确认文件来源可信。导入后应用会自动刷新。
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {!pending ? (
          <button
            className="btn"
            onClick={handlePickFile}
            disabled={validating}
          >
            {validating ? '读取中…' : '📁 选择备份文件'}
          </button>
        ) : (
          <div>
            <div
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: 12,
                marginBottom: 12,
              }}
            >
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                将导入以下数据：
              </div>
              <ul style={{ fontSize: 13, paddingLeft: 20, margin: 0 }}>
                {Object.keys(pending.data).map((key) => (
                  <li key={key}>{keyLabel(key)}</li>
                ))}
              </ul>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn primary" onClick={handleConfirmImport}>
                ✅ 确认导入（覆盖现有数据）
              </button>
              <button className="btn" onClick={handleCancelImport}>
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 说明 */}
      <section className="section">
        <div className="section-title">说明</div>
        <ul className="muted" style={{ fontSize: 13, paddingLeft: 20 }}>
          <li>备份文件为标准 JSON，可用文本编辑器打开查看</li>
          <li>建议定期导出，避免长期积累的数据丢失</li>
          <li>跨设备迁移：在新设备安装 App 后导入即可</li>
          <li>导入仅恢复应用数据，不含系统权限设置</li>
        </ul>
      </section>
    </div>
  )
}
