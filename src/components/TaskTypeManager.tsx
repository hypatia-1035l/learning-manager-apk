import { useState } from 'react'
import { useTaskTypes, addTaskType, deleteTaskType } from '../taskTypes'
import { useAppData, updateTask } from '../store'

// 任务类型管理：增删自定义类型
// 内置类型不可删；删除自定义类型时，已用该类型的任务回退为 'custom'
export function TaskTypeManager() {
  const types = useTaskTypes()
  const data = useAppData()
  const [newLabel, setNewLabel] = useState('')
  const [msg, setMsg] = useState('')

  const handleAdd = () => {
    const label = newLabel.trim()
    if (!label) return
    const id = addTaskType(label)
    if (!id) {
      setMsg('类型名称已存在')
      return
    }
    setNewLabel('')
    setMsg(`已添加类型「${label}」`)
  }

  const handleDelete = (typeId: string, label: string) => {
    // 统计使用该类型的任务
    const usedCount = data.tasks.filter((t) => t.type === typeId).length
    const tip =
      usedCount > 0
        ? `删除类型「${label}」？\n${usedCount} 个任务将回退为「自定义」类型。`
        : `删除类型「${label}」？`
    if (!confirm(tip)) return
    // 已用该类型的任务回退为 'custom'
    for (const t of data.tasks) {
      if (t.type === typeId) {
        updateTask(t.id, { type: 'custom' })
      }
    }
    deleteTaskType(typeId)
    setMsg(`已删除类型「${label}」`)
  }

  return (
    <section className="section">
      <div className="section-title">
        类型管理
        <span className="count">（{types.length} 个类型）</span>
      </div>

      {/* 现有类型列表 */}
      <div className="obj-list">
        {types.map((t) => {
          const usedCount = data.tasks.filter(
            (task) => task.type === t.id,
          ).length
          return (
            <div key={t.id} className="obj-item">
              <span className="tc-icon">{t.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{t.label}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {t.builtin ? '内置类型' : '自定义'}
                  {usedCount > 0 && ` · ${usedCount} 个任务使用`}
                </div>
              </div>
              {!t.builtin && (
                <button
                  className="icon-btn danger"
                  title="删除类型"
                  onClick={() => handleDelete(t.id, t.label)}
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 添加新类型 */}
      <div className="row" style={{ marginTop: 12 }}>
        <input
          className="input"
          placeholder="新类型名称，如：绘画、整理、网课"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn primary" onClick={handleAdd} disabled={!newLabel.trim()}>
          + 添加
        </button>
      </div>

      {msg && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {msg}
        </p>
      )}
    </section>
  )
}
