import { useState } from 'react'
import { Modal } from './Modal'
import { useAppData, addPlanItem } from '../store'
import { scheduleReminders } from '../reminderService'
import type { Task } from '../types'

interface Props {
  todayKey: string
  onClose: () => void
  onStartSession?: (task: Task) => void
}

// 随机插入今日某个未来时刻（5 分钟 ~ 3 小时内），时间不重要，等提醒即可
function recommendedMinute(): number {
  const now = new Date()
  const nowM = now.getHours() * 60 + now.getMinutes()
  const start = nowM + 5
  const end = Math.min(1439, nowM + 5 + 180)
  if (end <= start) return Math.min(1439, start)
  return start + Math.floor(Math.random() * (end - start))
}

export function PlanForm({ todayKey, onClose, onStartSession }: Props) {
  const data = useAppData()
  const [taskId, setTaskId] = useState<string>(
    data.tasks.find((t) => t.enabled)?.id ?? data.tasks[0]?.id ?? '',
  )
  const [content, setContent] = useState('')
  // 时刻：留空 = 随机插入未来 5 分钟~3 小时；填了 = 指定今天的该时刻
  const [timeStr, setTimeStr] = useState('')
  // 仅提醒：到点只提醒，不进计时，在计划页直接标记完成
  const [remindOnly, setRemindOnly] = useState(false)

  const canSubmit = !!content.trim() && !!taskId

  const timeToMinute = (t: string): number => {
    const [h, m] = t.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return NaN
    return Math.max(0, Math.min(1439, h * 60 + m))
  }

  const submit = (startNow = false) => {
    if (!canSubmit) return
    const minute = timeStr ? timeToMinute(timeStr) : recommendedMinute()
    addPlanItem(todayKey, {
      taskId,
      taskName: content.trim(),
      minuteOfDay: isNaN(minute) ? recommendedMinute() : minute,
      manual: true,
      remindOnly: remindOnly || undefined,
    })
    if (data.reminder?.enabled) {
      scheduleReminders().catch(() => {})
    }
    if (startNow) {
      const task = data.tasks.find((t) => t.id === taskId)
      if (task) onStartSession?.(task)
    }
    onClose()
  }

  return (
    <Modal
      title="新建计划"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={() => submit(false)} disabled={!canSubmit}>
            加入计划
          </button>
          {!remindOnly && (
            <button className="btn primary" onClick={() => submit(true)} disabled={!canSubmit}>
              开始
            </button>
          )}
        </>
      }
    >
      <div className="form-stack" style={{ gap: 10 }}>
        <div className="field" style={{ marginBottom: 4 }}>
          <label>方向</label>
          {data.tasks.length === 0 ? (
            <div className="faint" style={{ fontSize: 13 }}>暂无方向，请先在「方向」里新建</div>
          ) : (
            <select
              className="input"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
            >
              {data.tasks.map((t: Task) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label>内容</label>
          <input
            className="input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(false)
            }}
          />
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label>
            时刻
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              留空随机插入未来时段
            </span>
          </label>
          <input
            type="time"
            className="input"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
          />
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={remindOnly}
              onChange={(e) => setRemindOnly(e.target.checked)}
            />
            <span style={{ marginLeft: 6 }}>
              仅提醒（不计时）
              <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
                到点只提醒，在计划页直接标完成；未处理会每天顺延
              </span>
            </span>
          </label>
        </div>
      </div>
    </Modal>
  )
}
