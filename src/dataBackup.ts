// 数据备份 / 导入导出
// 扫描所有 learning-manager:* 前缀的 localStorage，打包成 JSON
// 导入时写回 localStorage 并刷新页面，让 useSyncExternalStore 重新读取

import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'

const KEY_PREFIX = 'learning-manager:'
const EXPORT_VERSION = 1

// 主数据键：没有它就没有「学习数据」。
// 导入时会先清空所有现有持久键、再只写备份里有的键 —— 所以备份缺这个键时，
// 用户的学习记录会被整体清空且补不回来。必须直接拒绝，不能只提示。
const MAIN_DATA_KEY = 'learning-manager:data:v1'

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

// 本地专用键：既不导出、也不在导入时删除。
// 目前只有一条 —— v1→v2 迁移前的黑名单存档：它是「删字段前的存底」，
// 随每份备份反复传播没有意义，也不该在导入时被当成数据写入。
const LOCAL_ONLY_KEYS = new Set<string>([
  'learning-manager:data:v1-blocked-backup',
])

/** 既不是运行时瞬态、也不是本地存档的键，才参与备份的读写 */
function isBackupParticipant(key: string): boolean {
  return !TRANSIENT_KEYS.has(key) && !LOCAL_ONLY_KEYS.has(key)
}

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
        isBackupParticipant(key) // 排除运行时瞬态键与本地存档，避免污染运行态 / 反复传播存档
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
  /** 可以导入，但用户应当知道的副作用（在确认导入前展示） */
  warnings?: string[]
  keyCount?: number
  keys?: string[]
}

export function validateBackup(backup: BackupFile): ValidationResult {
  const entries = Object.entries(backup.data)
  if (entries.length === 0) {
    return { ok: false, error: '备份文件中没有数据' }
  }
  // 版本：只认识「不高于当前导出格式」的备份。
  // 更新版本的备份可能带当前代码读不懂的字段，硬导会静默丢数据。
  if (backup.version > EXPORT_VERSION) {
    return {
      ok: false,
      error: `备份来自更新版本的 App（格式 v${backup.version}，当前只认到 v${EXPORT_VERSION}）。为避免丢掉新字段，已阻止导入；请先升级 App。`,
    }
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
  // 主数据必须有：导入流程会先清空现有持久键，缺这条等于「清空学习记录且无处可补」
  if (!(MAIN_DATA_KEY in backup.data)) {
    return {
      ok: false,
      error:
        '备份里没有「学习数据」（任务 / 序列 / 记录）。导入会先清空现有数据，而这份文件补不回来 —— 已阻止，请确认选对了文件。',
    }
  }

  const warnings: string[] = []
  if (!('learning-manager:random-toolbox:v1' in backup.data)) {
    warnings.push('这份备份不含随机工具箱（词库 / 预设 / 随机记录），导入后现有词库会被清空。')
  }
  const localOnlyCount = entries.filter(([k]) => LOCAL_ONLY_KEYS.has(k)).length
  if (localOnlyCount > 0) {
    warnings.push(`备份里有 ${localOnlyCount} 项本地存档，导入时会忽略（不写回）。`)
  }

  return {
    ok: true,
    keyCount: entries.length,
    keys: entries.map(([k]) => k),
    warnings: warnings.length > 0 ? warnings : undefined,
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
      if (!key || !key.startsWith(KEY_PREFIX) || !isBackupParticipant(key)) continue
      const val = localStorage.getItem(key)
      if (val !== null) oldEntries.push([key, val])
    }
  } catch {
    /* ignore */
  }
  const staleKeys = oldEntries.map(([k]) => k)
  // 2. 待写入项：只写本应用的持久键（跳过任何瞬态键，防御性）
  const newEntries = Object.entries(backup.data).filter(
    ([key]) => key.startsWith(KEY_PREFIX) && isBackupParticipant(key),
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
