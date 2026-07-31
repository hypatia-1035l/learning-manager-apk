import { Modal } from './Modal'
import type { Task } from '../types'
import { getCurrentObject, formatSequenceProgress } from '../store'

interface Props {
  task: Task
  // 当前可随机任务池大小：< 2 时禁用「重新随机」（避免重复抽到同一项）
  randomPoolSize: number
  onStart: () => void // 进入学习会话
  onReroll: () => void // 重新随机
  onClose: () => void
  onOpenTask: () => void // 该方向无学习序列时跳转去配置
}

export function RandomResultModal({
  task,
  randomPoolSize,
  onStart,
  onReroll,
  onClose,
  onOpenTask,
}: Props) {
  const obj = getCurrentObject(task)
  // 可随机任务少于 2 个时，重新随机无意义（必然重复）
  const canReroll = randomPoolSize >= 2
  return (
    <Modal title="🎲 随机结果" onClose={onClose}>
      <div className="random-result">
        <div className="rr-icon">{task.icon}</div>
        <div className="rr-name">{task.name}</div>

        <div className="rr-block">
          <div className="label">当前学习序列</div>
          <div className="obj">
            {obj ? obj.name : '（尚未设置学习序列）'}
          </div>
        </div>

        <div className="rr-block">
          <div className="label">当前进度</div>
          <div className="prog">
            {obj ? formatSequenceProgress(obj) : '—'}
          </div>
        </div>
      </div>

      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn ghost" onClick={onClose}>
          取消
        </button>
        <div className="row">
          <button
            className="btn"
            onClick={onReroll}
            disabled={!canReroll}
            title={canReroll ? '重新随机选择' : '可随机的方向不足 2 个，无法重新随机'}
          >
            🔄 重新随机
          </button>
          {obj ? (
            <button
              className="btn primary"
              onClick={onStart}
              title="进入正向计时学习"
            >
              ▶ 开始学习
            </button>
          ) : (
            <button className="btn primary" onClick={onOpenTask}>
              去添加学习序列
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
