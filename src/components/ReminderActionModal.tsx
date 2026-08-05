import type { Task } from '../types'
import {
  getCurrentObject,
  formatSequenceProgress,
} from '../store'
import { setCooldown } from '../reminderService'

interface Props {
  task: Task
  cooldownMinutes: number
  // 当前可随机任务池大小：< 2 时禁用「换一个」（避免重复抽到同一项）
  randomPoolSize: number
  onStart: (task: Task) => void // 开始计时
  onReroll: () => void // 换一个随机项
  onClose: () => void
}

// 提醒通知点击后的操作选择弹窗
// 仅保留：开始计时 / 换一个 / 取消
// 开始 → 进入会话；取消 / 关闭 → 进入冷却
export function ReminderActionModal({ task, cooldownMinutes, randomPoolSize, onStart, onReroll, onClose }: Props) {
  const obj = getCurrentObject(task)
  // 可随机任务少于 2 个时，换一个无意义（必然重复或为空）
  const canReroll = randomPoolSize >= 2

  const handleCancel = () => {
    setCooldown(cooldownMinutes)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>该摸一条鱼了</h3>

        <div className="reminder-action-card">
          <div className="rac-head">
            <span className="rac-icon">{task.icon}</span>
            <div>
              <div className="rac-name">{task.name}</div>
              {obj && <div className="rac-seq">{obj.name}</div>}
            </div>
          </div>
          {obj && (
            <div className="rac-prog">进度：{formatSequenceProgress(obj)}</div>
          )}
        </div>

        <div className="reminder-actions">
          <button className="btn primary lg" onClick={() => onStart(task)}>
            开始
          </button>
          <button
            className="btn lg"
            onClick={onReroll}
            disabled={!canReroll}
          >
            换一个
          </button>
          <button className="btn lg ghost" onClick={handleCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
