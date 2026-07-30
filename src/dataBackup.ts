// 数据备份 / 导入导出
// 扫描所有 learning-manager:* 前缀的 localStorage，打包成 JSON
// 导入时写回 localStorage 并刷新页面，让 useSyncExternalStore 重新读取

const KEY_PREFIX = 'learning-manager:'
const EXPORT_VERSION = 1

// 备份文件结构
export interface BackupFile {
  version: number
  exportedAt: number
  app: string
  data: Record<string, string> // localStorage key → value
}

// 导出全部数据
export function exportAllData(): BackupFile {
  const data: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(KEY_PREFIX)) {
        const val = localStorage.getItem(key)
        if (val !== null) data[key] = val
      }
    }
  } catch {
    /* ignore */
  }
  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    app: '今天摸啥鱼',
    data,
  }
}

// 触发浏览器下载备份文件
export function downloadBackup(): void {
  const backup = exportAllData()
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // 文件名：今天摸啥鱼-备份-2026-07-28.json
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  a.download = `今天摸啥鱼-备份-${dateStr}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 释放 URL
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 解析备份文件内容
export function parseBackup(text: string): BackupFile | null {
  try {
    const obj = JSON.parse(text)
    if (
      typeof obj === 'object' &&
      obj !== null &&
      typeof obj.version === 'number' &&
      typeof obj.data === 'object' &&
      obj.data !== null
    ) {
      return obj as BackupFile
    }
  } catch {
    /* ignore */
  }
  return null
}

// 校验备份文件是否合法
export interface ValidationResult {
  ok: boolean
  error?: string
  keyCount?: number
  keys?: string[]
}

export function validateBackup(backup: BackupFile): ValidationResult {
  const entries = Object.entries(backup.data)
  if (entries.length === 0) {
    return { ok: false, error: '备份文件中没有数据' }
  }
  // 所有 key 必须以 learning-manager: 开头
  const invalid = entries.filter(([k]) => !k.startsWith(KEY_PREFIX))
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `发现 ${invalid.length} 个非本应用的数据项`,
    }
  }
  return {
    ok: true,
    keyCount: entries.length,
    keys: entries.map(([k]) => k),
  }
}

// 导入备份：覆盖现有 localStorage 数据
// 注意：会覆盖现有数据，调用方应先确认
export function importBackup(backup: BackupFile): void {
  for (const [key, value] of Object.entries(backup.data)) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  }
  // 刷新页面，让所有 useSyncExternalStore 重新读取
  window.location.reload()
}

// 读取文件内容（Promise 版）
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(String(reader.result ?? ''))
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}
