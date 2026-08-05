// 设置页 —— 系统配置入口：提醒 / 数据备份 / 版本信息
import { BUILD_VERSION, BUILD_TIME } from '../buildInfo'

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
              <div className="si-desc">定时 / 随机提醒</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>

        <button className="settings-item" onClick={onOpenBackup}>
          <span className="si-left">
            <span>
              <div className="si-name">数据备份</div>
              <div className="si-desc">导出 / 导入</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>
      </div>

      <section className="section" style={{ marginTop: 20 }}>
        <div className="section-title">版本信息</div>
        <div className="obj-list">
          <div className="obj-item">
            <span className="name">v{BUILD_VERSION}</span>
            <div className="ops" />
            <span className="prog">{BUILD_TIME}</span>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          版本号/构建时间与页面一致即为最新 APK。
        </p>
      </section>
    </div>
  )
}
