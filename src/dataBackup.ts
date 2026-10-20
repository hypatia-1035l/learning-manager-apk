// 数据备份 / 导入导出
// 扫描所有 learning-manager:* 前缀的 localStorage，打包成 JSON
// 导入时写回 localStorage 并刷新页面，让 useSyncExternalStore 重新读取

import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'

const KEY_PREFIX = 'learning-manager:'
const EXPORT_VERSION = 1

// 运行时瞬态键：由当前设备运行状态派生，绝不可纳入备份。
// 若被导出并在其他设备/时间恢复，会导致：
//  - session-active=true        → 永久压制提醒
//  - paused-task/paused-elapsed → 复活陈旧的“暂停会话”
//  - cooldown-until             → 卡住提醒（一直冷却）
//  - last-scheduled-date         → 当天不再重新调度提醒
//  - notif-perm-requested        → 跳过通知权限请求
//  - reminder-fired/last-session-end → 历史触发/结束标记，跨设备无意义
// 新增任何运行时键时，必须同步加入此集合，否则会被误备份。
const TRANSIENT_KEYS = new Set<string>([
  'learning-manager:notif-perm-requested',
  'learning-manager:last-scheduled-date',
  'learning-manager:cooldown-until',
  'learning-manager:session-active',
  'learning-manager:paused-task',
  'learning-manager:paused-elapsed',
  'learning-manager:reminder-fired',
  'learning-manager:last-session-end',
])

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
      if (
        key &&
        key.startsWith(KEY_PREFIX) &&
        !TRANSIENT_KEYS.has(key) // 排除运行时瞬态键，避免恢复后污染运行态
      ) {
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

// 触发下载 / 原生写盘
// - 桌面 Web：用 Blob + <a download>，浏览器直接存盘
// - 原生（Android）：用 @capacitor/filesystem 写到「下载」目录（经 MediaStore，
//   无需危险权限，文件会出现在系统文件管理/下载中）。
//   注意：Android WebView 对 blob URL 的 <a download> 支持不可靠，会静默失败，
//   所以原生端必须走 Filesystem。
// 返回保存位置描述，便于 UI 给出精确提示。
export async function downloadBackup(): Promise<string> {
  const backup = exportAllData()
  const json = JSON.stringify(backup, null, 2)
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const fileName = `今天摸啥鱼-备份-${dateStr}.json`

  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path: fileName,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    })
    return `已保存到文档目录：${fileName}`
  }

  // Web 端：Blob 下载方案
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 释放 URL
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return `已导出，请到下载目录查找 ${fileName}`
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
  // 值必须是字符串（localStorage 只存字符串）：非字符串说明文件被改坏，
  // 直接写回会变成 "[object Object]" 之类的脏数据，后续解析失败等同丢数据
  const invalidValues = entries.filter(([, v]) => typeof v !== 'string')
  if (invalidValues.length > 0) {
    return {
      ok: false,
      error: `发现 ${invalidValues.length} 项数据不是字符串（文件可能被改坏）`,
    }
  }
  return {
    ok: true,
    keyCount: entries.length,
    keys: entries.map(([k]) => k),
  }
}

// 导入结果：失败时 UI 必须把 error 显示出来（旧实现静默吞掉写入错误）
export interface ImportBackupResult {
  ok: boolean
  failedKeys: string[]
  error?: string
}

// 导入备份：先收集现有“持久”数据键及原值 → 逐条写入并记录失败 →
// 失败则回滚旧值并返回错误（绝不 reload）。成功才 reload。
// - 只处理持久键（保留当前设备的瞬态运行态），避免误删正在进行的会话/冷却等状态；
// - 写回时再次跳过瞬态键（防御旧版备份里残留的瞬态键）。
// - 注意：会覆盖现有持久数据，调用方应先确认
export function importBackup(backup: BackupFile): ImportBackupResult {
  // 1. 先收集现有持久键及其原值（回滚用；瞬态键不参与）
  // 先收集再删除：边遍历边 removeItem 会让索引跳位，留下漏删的陈旧键
  const oldEntries: Array<[string, string]> = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(KEY_PREFIX) || TRANSIENT_KEYS.has(key)) continue
      const val = localStorage.getItem(key)
      if (val !== null) oldEntries.push([key, val])
    }
  } catch {
    /* ignore */
  }
  const staleKeys = oldEntries.map(([k]) => k)
  // 2. 待写入项：只写本应用的持久键（跳过任何瞬态键，防御性）
  const newEntries = Object.entries(backup.data).filter(
    ([key]) => key.startsWith(KEY_PREFIX) && !TRANSIENT_KEYS.has(key),
  )
  // 备份里只有瞬态键（或没有可写项）时直接失败：否则会「删光现有数据后什么都不写、再 reload」
  if (newEntries.length === 0) {
    return { ok: false, failedKeys: [], error: '备份文件中没有可导入的数据' }
  }

  // 3. 清掉现有持久键后再写回（先释放空间，避免「旧数据占着配额导致新数据写不进」）
  for (const key of staleKeys) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  const written: string[] = []
  const failedKeys: string[] = []
  for (const [key, value] of newEntries) {
    try {
      localStorage.setItem(key, String(value))
      written.push(key)
    } catch {
      failedKeys.push(key)
    }
  }

  // 4. 任一条写入失败：删掉已写入的新键、恢复旧值，返回错误（不 reload）
  // 旧实现忽略 setItem 失败直接 reload，会出现「旧数据已删、新数据只写一半、还提示成功」
  if (failedKeys.length > 0) {
    for (const key of written) {
      try {
        localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    }
    const rollbackFailed: string[] = []
    for (const [key, value] of oldEntries) {
      try {
        localStorage.setItem(key, value)
      } catch {
        rollbackFailed.push(key)
      }
    }
    return {
      ok: false,
      failedKeys,
      error:
        rollbackFailed.length > 0
          ? `写入本地存储失败（可能空间不足）：${failedKeys.length} 项未写入；回滚也未完全成功（${rollbackFailed.length} 项），请勿关闭应用并重试，或换一个备份文件恢复`
          : `写入本地存储失败（可能空间不足）：${failedKeys.length} 项未写入，已回滚到导入前的数据`,
    }
  }

  // 5. 全部成功：刷新页面，让所有 useSyncExternalStore 重新读取
  window.location.reload()
  return { ok: true, failedKeys: [] }
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
