// 设置页 —— 系统配置入口：提醒 / 数据备份
// 作为「设置」工作区内容，顶部标题由 Shell 统一展示，这里只渲染列表
interface Props {
  onOpenReminder: () => void
  onOpenBackup: () => void
}

export function Settings({
  onOpenReminder,
  onOpenBackup,
}: Props) {
  return (
    <div className="pool-compact">
      <div className="settings-list">
        <button className="settings-item" onClick={onOpenReminder}>
          <span className="si-left">
            <span>
              <div className="si-name">提醒设置</div>
              <div className="si-desc">定时提醒 / 随机提醒摸鱼</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>

        <button className="settings-item" onClick={onOpenBackup}>
          <span className="si-left">
            <span>
              <div className="si-name">数据备份</div>
              <div className="si-desc">导出 / 导入恢复</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>
      </div>
    </div>
  )
}
