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
// 选项：开始计时 / 换一个 / 延迟 / 忽略
// 开始计时 → 进入会话，计时结束后开始冷却
// 延迟 / 忽略 → 立即开始冷却
export function ReminderActionModal({ task, cooldownMinutes, randomPoolSize, onStart, onReroll, onClose }: Props) {
  const obj = getCurrentObject(task)
  // 可随机任务少于 2 个时，换一个无意义（必然重复或为空）
  const canReroll = randomPoolSize >= 2

  const handleDelay = () => {
    setCooldown(cooldownMinutes)
    onClose()
  }

  const handleIgnore = () => {
    setCooldown(cooldownMinutes)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
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
            开始计时
          </button>
          <button
            className="btn lg"
            onClick={onReroll}
            disabled={!canReroll}
            title={canReroll ? '换一个随机方向' : '可随机的方向不足 2 个，无法更换'}
          >
            换一个
          </button>
          <button className="btn lg" onClick={handleDelay}>
            延迟（{cooldownMinutes}分）
          </button>
          <button className="btn lg ghost" onClick={handleIgnore}>
            忽略
          </button>
        </div>

        <p className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 12 }}>
          开始计时后进入冷却；延迟/忽略也计算冷却
        </p>
      </div>
    </div>
  )
}
