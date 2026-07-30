// 任务类型管理：动态增删 + 持久化
// 内置类型固定不可删；用户自定义类型可增可删
// 删除类型时，已用该类型的任务回退为 'custom'
import { useSyncExternalStore } from 'react'
import type { TaskType } from './types'
import { BUILTIN_TYPE_IDS, TASK_TYPE_LABELS } from './types'

const STORAGE_KEY = 'learning-manager:task-types:v1'

// 类型定义
export interface TaskTypeDef {
  id: string // 类型 ID（内置 ID 固定；自定义 ID 形如 type-xxx）
  label: string // 显示名称
  icon: string // emoji
  builtin: boolean // 是否内置（不可删）
}

// 内置类型定义（从 TASK_TYPE_LABELS + TYPE_ICON 派生）
const BUILTIN_ICON: Record<string, string> = {
  reading: '📖',
  video: '🎬',
  practice: '✍️',
  custom: '✨',
}

function buildBuiltinTypes(): TaskTypeDef[] {
  return BUILTIN_TYPE_IDS.map((id) => ({
    id,
    label: TASK_TYPE_LABELS[id] ?? id,
    icon: BUILTIN_ICON[id] ?? '✨',
    builtin: true,
  }))
}

// 存储：仅保存用户自定义类型（内置类型动态生成）
interface TypeStore {
  custom: TaskTypeDef[]
}

function loadStore(): TypeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as TypeStore
      if (Array.isArray(parsed.custom)) return parsed
    }
  } catch {
    /* ignore */
  }
  return { custom: [] }
}

let store: TypeStore = loadStore()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function setStore(updater: (prev: TypeStore) => TypeStore) {
  store = updater(store)
  persist()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot() {
  return store
}

// 全部类型列表（内置 + 自定义）
export function getAllTypes(): TaskTypeDef[] {
  return [...buildBuiltinTypes(), ...store.custom]
}

// React hook
export function useTaskTypes(): TaskTypeDef[] {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return getAllTypes()
}

// 新增自定义类型
// label 必填；icon 可选，默认 ✨
// 返回新类型 ID；若 label 为空或重复返回 null
export function addTaskType(label: string, icon: string = '✨'): string | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  // 标签去重（不区分大小写）
  const exists = getAllTypes().some(
    (t) => t.label.toLowerCase() === trimmed.toLowerCase(),
  )
  if (exists) return null
  const id = `type-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const def: TaskTypeDef = { id, label: trimmed, icon, builtin: false }
  setStore((prev) => ({ ...prev, custom: [...prev.custom, def] }))
  return id
}

// 删除自定义类型（内置不可删）
// 返回被删除的类型 ID；若不存在或为内置则返回 null
export function deleteTaskType(typeId: string): string | null {
  const target = store.custom.find((t) => t.id === typeId)
  if (!target) return null
  setStore((prev) => ({
    ...prev,
    custom: prev.custom.filter((t) => t.id !== typeId),
  }))
  return typeId
}

// 修改自定义类型标签/图标（内置不可改 id）
export function updateTaskType(
  typeId: string,
  patch: Partial<Pick<TaskTypeDef, 'label' | 'icon'>>,
): void {
  setStore((prev) => ({
    ...prev,
    custom: prev.custom.map((t) =>
      t.id === typeId ? { ...t, ...patch } : t,
    ),
  }))
}

// 根据 ID 取类型定义（找不到返回 null）
export function getTypeDef(typeId: TaskType): TaskTypeDef | null {
  return getAllTypes().find((t) => t.id === typeId) ?? null
}

// 根据 ID 取标签（找不到时回退到 TASK_TYPE_LABELS 或 ID 本身）
export function getTypeLabel(typeId: TaskType): string {
  const def = getTypeDef(typeId)
  if (def) return def.label
  return TASK_TYPE_LABELS[typeId] ?? typeId
}

// 根据 ID 取图标（找不到时回退到内置图标或 ✨）
export function getTypeIcon(typeId: TaskType): string {
  const def = getTypeDef(typeId)
  if (def) return def.icon
  return BUILTIN_ICON[typeId] ?? '✨'
}
