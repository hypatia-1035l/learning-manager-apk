import { Modal } from './Modal'
import type { Task } from '../types'
import { getCurrentObject } from '../store'

interface Props {
  task: Task
  onStart: () => void // 进入学习会话
  onReroll: () => void // 重新随机
  onClose: () => void
  onOpenTask: () => void // 该方向无学习对象时跳转去配置
}

export function RandomResultModal({
  task,
  onStart,
  onReroll,
  onClose,
  onOpenTask,
}: Props) {
  const obj = getCurrentObject(task)
  return (
    <Modal title="🎲 随机结果" onClose={onClose}>
      <div className="random-result">
        <div className="rr-icon">{task.icon}</div>
        <div className="rr-name">{task.name}</div>

        <div className="rr-block">
          <div className="label">当前学习对象</div>
          <div className="obj">
            {obj ? obj.name : '（尚未设置学习对象）'}
          </div>
        </div>

        <div className="rr-block">
          <div className="label">当前进度</div>
          <div className="prog">
            {obj ? obj.progress || '尚未记录' : '—'}
          </div>
        </div>
      </div>

      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn ghost" onClick={onClose}>
          取消
        </button>
        <div className="row">
          <button className="btn" onClick={onReroll} title="重新随机选择">
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
              去添加学习对象
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
