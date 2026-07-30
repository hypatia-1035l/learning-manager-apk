import { useState } from 'react'

interface Props {
  onClose: () => void
}

// vivo OriginOS 后台保活引导弹窗
// 首次启动时显示，提醒用户开启关键权限以保证提醒/悬浮窗功能可靠运行
export function VivoPermissionGuide({ onClose }: Props) {
  const [checked, setChecked] = useState(false)

  const steps = [
    {
      title: '允许通知',
      desc: '设置 → 应用管理 → 今天摸啥鱼 → 通知 → 全部开启',
      reason: '接收提醒通知',
    },
    {
      title: '允许自启动',
      desc: '设置 → 应用管理 → 今天摸啥鱼 → 自启动 → 开启',
      reason: '开机/解锁后提醒可恢复',
    },
    {
      title: '后台高耗电允许',
      desc: '设置 → 电池 → 后台耗电管理 → 今天摸啥鱼 → 允许后台高耗电',
      reason: '防止系统杀进程导致定时提醒失效',
    },
    {
      title: '锁定后台',
      desc: '在最近任务列表里给「今天摸啥鱼」加锁',
      reason: '一键清理时保留 App',
    },
    {
      title: '悬浮窗权限',
      desc: '设置 → 应用管理 → 今天摸啥鱼 → 悬浮窗 → 允许',
      reason: '学习时悬浮窗计时',
    },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>vivo 手机权限设置建议</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
          为保证提醒与悬浮窗功能可靠运行，建议开启以下权限。OriginOS
          默认会限制后台，不做这些设置提醒可能收不到。
        </p>

        {steps.map((s, i) => (
          <div key={i} className="perm-step">
            <div className="perm-head">
              <span className="perm-idx">{i + 1}</span>
              <span className="perm-title">{s.title}</span>
              <span className="perm-reason">{s.reason}</span>
            </div>
            <div className="perm-desc">{s.desc}</div>
          </div>
        ))}

        <label className="muted" style={{ fontSize: 13, display: 'block', margin: '14px 0' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          我已了解，下次不再提示
        </label>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            稍后设置
          </button>
          <button className="btn primary" onClick={onClose}>
            {checked ? '已记下，关闭' : '我知道了'}
          </button>
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
          提示：悬浮窗权限也可在学习会话里点「开启悬浮窗」时按需授予。
        </p>
      </div>
    </div>
  )
}
