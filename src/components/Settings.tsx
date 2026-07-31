// 设置页 —— 系统配置入口：提醒 / 摸鱼规则 / 数据备份
// 作为「设置」工作区内容，标题由 Shell 统一展示
interface Props {
  onOpenReminder: () => void
  onOpenSlackingRules: () => void
  onOpenBackup: () => void
}

export function Settings({
  onOpenReminder,
  onOpenSlackingRules,
  onOpenBackup,
}: Props) {
  return (
    <div>
      <header className="app-header">
        <h1 className="app-title">⚙️ 设置</h1>
      </header>
      <p className="app-tagline">系统配置 · 全局设置</p>

      <div className="settings-list">
        <button className="settings-item" onClick={onOpenReminder}>
          <span className="si-left">
            <span className="si-icon">🔔</span>
            <span>
              <div className="si-name">提醒设置</div>
              <div className="si-desc">定时提醒 / 随机提醒摸鱼</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>

        <button className="settings-item" onClick={onOpenSlackingRules}>
          <span className="si-left">
            <span className="si-icon">🐟</span>
            <span>
              <div className="si-name">摸鱼规则</div>
              <div className="si-desc">智能检测捞鱼 · 规则与阈值</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>

        <button className="settings-item" onClick={onOpenBackup}>
          <span className="si-left">
            <span className="si-icon">💾</span>
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
