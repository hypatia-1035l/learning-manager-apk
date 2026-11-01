import { useRef, useState } from 'react'
import {
  downloadBackup,
  readFileAsText,
  parseBackup,
  validateBackup,
  importBackup,
} from '../dataBackup'
import type { BackupFile } from '../dataBackup'
import { useSwipeBack } from '../useSwipeBack'

interface Props {
  onBack: () => void
}

// localStorage key → 友好名称
const KEY_LABELS: Record<string, string> = {
  'learning-manager:data:v1': '应用数据（任务/序列/记录/提醒设置）',
  'learning-manager:random-toolbox:v1': '随机工具箱（数字范围/词库/预设/随机记录）',
  'learning-manager:random-seeded:v1': '内置词库填充标记',
  'learning-manager:schema-version': '数据结构版本',
  'learning-manager:notif-perm-requested': '通知权限请求标记',
  'learning-manager:last-scheduled-date': '上次提醒调度日期',
  'learning-manager:cooldown-until': '提醒冷却时间',
  'learning-manager:session-active': '会话活跃标记',
  'learning-manager:wb-display-mode': '词库显示模式',
  'learning-manager:paused-task': '暂停的计时会话',
  'learning-manager:paused-elapsed': '暂停会话的已用时长',
  'learning-manager:last-seq-defaults': '序列录入默认值（上次用的单位 / 时长）',
  'learning-manager:data:v1-blocked-backup': '旧版黑名单存档（导入时忽略）',
}

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key
}

export function DataBackup({ onBack }: Props) {
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  // 导入失败提示单独一份：error 在「导出」区渲染，导入失败显示在那里会误导
  const [importError, setImportError] = useState('')
  const [pending, setPending] = useState<BackupFile | null>(null)
  // 校验通过但需要用户知情的副作用（如备份不含词库，导入会清空现有词库）
  const [warnings, setWarnings] = useState<string[]>([])
  const [validating, setValidating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 右滑返回设置页
  useSwipeBack(onBack)

  const handleExport = async () => {
    setMsg('')
    setError('')
    try {
      const where = await downloadBackup()
      setMsg(where)
    } catch {
      setError('导出失败，请重试')
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
    setImportError('')
    setPending(null)
    setWarnings([])

    try {
      const text = await readFileAsText(file)
      const backup = parseBackup(text)
      if (!backup) {
        // 若是词库导入文件，直接指出正确入口，避免用户在两个入口间来回试
        let hint = '文件格式不正确，无法识别为备份文件'
        try {
          const obj = JSON.parse(text)
          if (obj && Array.isArray(obj.banks)) {
            hint = '这是「词库」文件，不能用备份导入。请到「工具 → 词库 → 导入」里选择它。'
          }
        } catch {
          /* ignore */
        }
        setError(hint)
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
      setWarnings(result.warnings ?? [])
      setMsg(`已读取备份文件，包含 ${result.keyCount} 项数据，请确认导入`)
    } catch {
      setError('读取文件失败')
    }
    setValidating(false)
  }

  const handleConfirmImport = () => {
    if (!pending) return
    setImportError('')
    // importBackup 成功时内部会 reload（下面不会执行）；失败时返回错误，必须显示出来
    const result = importBackup(pending)
    if (!result.ok) {
      setImportError(result.error ?? '导入失败，请重试')
    }
  }

  const handleCancelImport = () => {
    setPending(null)
    setImportError('')
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
          <li>应用数据（任务、序列、记录、提醒设置）</li>
          <li>随机工具箱（数字范围、词库、预设、随机记录）</li>
          <li>数据结构版本与界面偏好标记</li>
        </ul>
        <p className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
          注：备份仅含用户数据，不包含运行时状态（如暂停的计时会话、提醒冷却/调度标记），导入后这些状态会按新环境重新生成。
        </p>
        <button className="btn primary" onClick={handleExport}>
          导出全部数据
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
          导入会替换现有数据，请确认文件来源可信。导入后应用会自动刷新。
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
            {validating ? '读取中…' : '选择备份文件'}
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
            {warnings.length > 0 && (
              <div
                className="notice-block"
                style={{ marginBottom: 12 }}
              >
                <div className="notice-title">⚠️ 导入前请确认</div>
                <div className="notice-body">
                  <ul className="notice-list">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn primary" onClick={handleConfirmImport}>
                确认导入（覆盖现有数据）
              </button>
              <button className="btn" onClick={handleCancelImport}>
                取消
              </button>
            </div>
            {importError && (
              <p style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>
                {importError}
              </p>
            )}
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
