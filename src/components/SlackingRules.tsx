import { useEffect, useState } from 'react'
import {
  loadSlackingRulesConfig,
  saveSlackingRulesConfig,
  addRule,
  updateRule,
  removeRule,
  buildContext,
  evaluateRules,
  buildSlackingMessage,
} from '../slackingRulesService'
import type { SlackingEvaluation } from '../slackingRulesService'
import {
  RULE_TYPE_LABELS,
  RULE_TYPE_DESCRIPTIONS,
  SLACKING_RULE_PRESETS,
} from '../slackingRulesTypes'
import type {
  SlackingRulesConfig,
  SlackingRule,
  SlackingRuleType,
  SlackingRulePreset,
} from '../slackingRulesTypes'
import { useAppData, pickRandomTask, getContinueTask } from '../store'
import type { Task } from '../types'
import { RandomResultModal } from './RandomResultModal'
import { fetchTodayUsage, hasUsagePermission } from '../usageStatsService'

// 可选应用条目（用于单应用规则绑定）
interface AppOption {
  packageName: string
  appName: string
}

interface Props {
  onBack: () => void
  onOpenTask: (task: Task) => void
  // 通知点击时传入的待处理评估结果（点击摸鱼通知跳转过来）
  pendingEvaluation?: SlackingEvaluation | null
  onDismissEvaluation: () => void
}

export function SlackingRules({
  onBack,
  onOpenTask,
  pendingEvaluation,
  onDismissEvaluation,
}: Props) {
  const data = useAppData()
  const [cfg, setCfg] = useState<SlackingRulesConfig>(loadSlackingRulesConfig())
  const [detecting, setDetecting] = useState(false)
  const [evaluation, setEvaluation] = useState<SlackingEvaluation | null>(
    pendingEvaluation ?? null,
  )
  const [randomTask, setRandomTask] = useState<Task | null>(null)
  const [msg, setMsg] = useState('')
  // 可选应用列表（仅娱乐类，用于单应用规则绑定）
  const [appOptions, setAppOptions] = useState<AppOption[]>([])

  // 拉取今日娱乐类应用，供单应用规则选择
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const granted = await hasUsagePermission()
      if (!granted) return
      const usage = await fetchTodayUsage()
      if (cancelled || !usage) return
      const ent = usage.items
        .filter((it) => it.category === 'entertainment')
        .map((it) => ({ packageName: it.packageName, appName: it.appName }))
      setAppOptions(ent)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggleEnabled = (enabled: boolean) => {
    const newCfg = { ...cfg, enabled }
    saveSlackingRulesConfig(newCfg)
    setCfg(newCfg)
    setMsg(enabled ? '摸鱼检测已开启' : '摸鱼检测已关闭')
  }

  const handleCooldownChange = (minutes: number) => {
    const newCfg = { ...cfg, cooldownMs: minutes * 60 * 1000 }
    saveSlackingRulesConfig(newCfg)
    setCfg(newCfg)
  }

  const handleRuleToggle = (ruleId: string, enabled: boolean) => {
    const rule = cfg.rules.find((r) => r.id === ruleId)
    if (!rule) return
    const newCfg = updateRule(cfg, { ...rule, enabled })
    setCfg(newCfg)
  }

  const handleThresholdChange = (ruleId: string, minutes: number) => {
    const rule = cfg.rules.find((r) => r.id === ruleId)
    if (!rule) return
    const newCfg = updateRule(cfg, { ...rule, thresholdMs: minutes * 60 * 1000 })
    setCfg(newCfg)
  }

  const handleTypeChange = (ruleId: string, type: SlackingRuleType) => {
    const rule = cfg.rules.find((r) => r.id === ruleId)
    if (!rule) return
    // 切换到非 single_app 类型时清空 packageName（无意义）
    const patch: SlackingRule = { ...rule, type }
    if (type !== 'single_app') {
      delete patch.packageName
      delete patch.appName
    }
    const newCfg = updateRule(cfg, patch)
    setCfg(newCfg)
  }

  // 单应用规则绑定具体应用（空字符串 = 任意娱乐应用）
  const handleAppChange = (ruleId: string, packageName: string) => {
    const rule = cfg.rules.find((r) => r.id === ruleId)
    if (!rule) return
    const opt = appOptions.find((o) => o.packageName === packageName)
    const patch: SlackingRule = {
      ...rule,
      packageName: packageName || undefined,
      appName: opt?.appName,
    }
    const newCfg = updateRule(cfg, patch)
    setCfg(newCfg)
  }

  const handleAddRule = () => {
    const newRule: SlackingRule = {
      id: `rule-${Date.now()}`,
      type: 'single_app',
      enabled: true,
      thresholdMs: 60 * 60 * 1000,
    }
    const newCfg = addRule(cfg, newRule)
    setCfg(newCfg)
  }

  // 一键导入预设规则
  const handleImportPreset = (preset: SlackingRulePreset) => {
    const newRule: SlackingRule = {
      id: `rule-${Date.now()}`,
      ...preset.rule,
    }
    const newCfg = addRule(cfg, newRule)
    setCfg(newCfg)
    setMsg(`已导入：${preset.label}`)
  }

  const handleRemoveRule = (ruleId: string) => {
    const newCfg = removeRule(cfg, ruleId)
    setCfg(newCfg)
  }

  const handleDetect = async () => {
    setDetecting(true)
    setMsg('')
    try {
      const ctx = await buildContext(data.tasks, data.records)
      if (!ctx) {
        setMsg('无法获取使用数据，请检查使用情况访问权限')
        setDetecting(false)
        return
      }
      // 评估时忽略冷却（手动检测）
      const cfgNoCooldown = { ...cfg, lastTriggeredAt: undefined }
      const result = evaluateRules(cfgNoCooldown, ctx)
      if (result.shouldTrigger) {
        setEvaluation(result)
        // 更新触发时间
        const newCfg = { ...cfg, lastTriggeredAt: Date.now() }
        saveSlackingRulesConfig(newCfg)
        setCfg(newCfg)
        setMsg('检测到摸鱼状态！')
      } else {
        setMsg('当前状态良好，继续加油')
      }
    } catch {
      setMsg('检测失败')
    }
    setDetecting(false)
  }

  // 动作：开始摸鱼（调用现有随机开始逻辑）
  const handleStartSlacking = () => {
    const picked = pickRandomTask(data.tasks)
    if (picked) {
      setRandomTask(picked)
    } else {
      setMsg('暂无可随机的任务，请先在任务池中启用任务并勾选「参与随机」')
    }
    setEvaluation(null)
    onDismissEvaluation()
  }

  // 动作：继续任务（打开最近学习任务）
  const handleContinueTask = () => {
    const taskId =
      evaluation?.recommendedTaskId ?? getContinueTask(data.tasks, data.records)?.id
    if (taskId) {
      const task = data.tasks.find((t) => t.id === taskId)
      if (task) {
        onOpenTask(task)
        return
      }
    }
    setMsg('暂无可继续的任务')
    setEvaluation(null)
    onDismissEvaluation()
  }

  // 动作：忽略
  const handleIgnore = () => {
    setEvaluation(null)
    onDismissEvaluation()
    setMsg('已忽略，冷却时间内不再提醒')
  }

  const continueTask = getContinueTask(data.tasks, data.records)

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← 返回
      </button>
      <header className="app-header">
        <h1 className="app-title">摸鱼规则</h1>
      </header>
      <p className="app-tagline">
        根据应用使用情况提醒切换任务 · 不是限制工具 · 只提供提醒
      </p>

      {/* 摸鱼提醒触发卡片 */}
      {evaluation && evaluation.shouldTrigger && (
        <section
          className="section"
          style={{
            borderColor: 'var(--amber)',
            background: 'var(--amber-bg)',
          }}
        >
          <div className="section-title">🐟 摸鱼提醒</div>
          <p style={{ fontSize: 15, marginBottom: 10 }}>
            {buildSlackingMessage(evaluation)}
          </p>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            原因：{evaluation.reason}
          </p>
          <div className="row wrap">
            <button className="btn primary" onClick={handleStartSlacking}>
              🎲 开始摸鱼
            </button>
            <button
              className="btn"
              onClick={handleContinueTask}
              disabled={!continueTask && !evaluation.recommendedTaskId}
            >
              ▶ 继续任务
            </button>
            <button className="btn ghost" onClick={handleIgnore}>
              ✕ 忽略
            </button>
          </div>
        </section>
      )}

      {/* 总开关 */}
      <section className="section">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="section-title" style={{ margin: 0 }}>
              摸鱼检测
            </div>
            <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
              开启后根据应用使用情况自动提醒
            </p>
          </div>
          <label>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
          </label>
        </div>
      </section>

      {/* 冷却时间 */}
      {cfg.enabled && (
        <section className="section">
          <div className="section-title">冷却时间</div>
          <div className="field">
            <label>提醒后多长时间内不重复提醒（分钟）</label>
            <input
              type="number"
              className="input"
              min={5}
              step={5}
              value={Math.round(cfg.cooldownMs / 60000)}
              onChange={(e) =>
                handleCooldownChange(
                  Math.max(5, Number(e.target.value) || 30),
                )
              }
            />
            <span className="faint" style={{ fontSize: 12 }}>
              默认 30 分钟。避免过度提醒。手动检测会忽略冷却。
            </span>
          </div>
        </section>
      )}

      {/* 规则列表 */}
      {cfg.enabled && (
        <section className="section">
          <div
            className="row"
            style={{ justifyContent: 'space-between', marginBottom: 14 }}
          >
            <div className="section-title" style={{ margin: 0 }}>
              检测规则
            </div>
            <button className="btn sm" onClick={handleAddRule}>
              + 添加规则
            </button>
          </div>

          {/* 预设快捷导入 */}
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
            <span className="faint" style={{ fontSize: 12, alignSelf: 'center' }}>
              快速添加：
            </span>
            {SLACKING_RULE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="btn sm ghost"
                title={preset.description}
                onClick={() => handleImportPreset(preset)}
              >
                + {preset.label}
              </button>
            ))}
          </div>

          {cfg.rules.length === 0 ? (
            <p className="faint">暂无规则，点击「添加规则」或上方预设创建</p>
          ) : (
            <div className="obj-list">
              {cfg.rules.map((rule) => (
                <div
                  key={rule.id}
                  className="obj-item"
                  style={{
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 8,
                  }}
                >
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) =>
                          handleRuleToggle(rule.id, e.target.checked)
                        }
                      />
                      <strong style={{ marginLeft: 6 }}>
                        {RULE_TYPE_LABELS[rule.type]}
                      </strong>
                    </label>
                    <button
                      className="icon-btn danger"
                      onClick={() => handleRemoveRule(rule.id)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <select
                      className="select sm"
                      value={rule.type}
                      onChange={(e) =>
                        handleTypeChange(
                          rule.id,
                          e.target.value as SlackingRuleType,
                        )
                      }
                    >
                      <option value="single_app">单应用时长</option>
                      <option value="entertainment_total">娱乐总时长</option>
                      <option value="continuous">连续使用</option>
                    </select>
                    <div className="row">
                      <span className="faint" style={{ fontSize: 12 }}>
                        阈值：
                      </span>
                      <input
                        type="number"
                        className="input sm"
                        style={{ width: 80 }}
                        min={5}
                        step={5}
                        value={Math.round(rule.thresholdMs / 60000)}
                        onChange={(e) =>
                          handleThresholdChange(
                            rule.id,
                            Math.max(5, Number(e.target.value) || 30),
                          )
                        }
                      />
                      <span className="faint" style={{ fontSize: 12 }}>
                        分钟
                      </span>
                    </div>
                  </div>
                  {/* 单应用规则：绑定具体应用 */}
                  {rule.type === 'single_app' && (
                    <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
                      <span className="faint" style={{ fontSize: 12 }}>
                        应用：
                      </span>
                      <select
                        className="select sm"
                        style={{ minWidth: 160 }}
                        value={rule.packageName ?? ''}
                        onChange={(e) =>
                          handleAppChange(rule.id, e.target.value)
                        }
                      >
                        <option value="">任意娱乐应用（时长最长者）</option>
                        {appOptions.map((opt) => (
                          <option key={opt.packageName} value={opt.packageName}>
                            {opt.appName}
                          </option>
                        ))}
                      </select>
                      {appOptions.length === 0 && (
                        <span className="faint" style={{ fontSize: 11 }}>
                          今日暂无娱乐应用数据
                        </span>
                      )}
                    </div>
                  )}
                  <p className="faint" style={{ fontSize: 11 }}>
                    {RULE_TYPE_DESCRIPTIONS[rule.type]}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 手动检测 */}
      {cfg.enabled && (
        <section className="section">
          <div className="section-title">立即检测</div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            手动触发一次检测，查看当前是否需要提醒。手动检测会忽略冷却时间。
          </p>
          <button
            className="btn primary"
            onClick={handleDetect}
            disabled={detecting}
          >
            {detecting ? '检测中…' : '🔍 立即检测'}
          </button>
          {msg && (
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              {msg}
            </p>
          )}
        </section>
      )}

      {/* 关闭状态说明 */}
      {!cfg.enabled && (
        <section className="section">
          <p className="muted" style={{ fontSize: 14 }}>
            摸鱼检测已关闭。开启后将根据应用使用情况，在你需要时提醒捞一条鱼。
          </p>
          {msg && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {msg}
            </p>
          )}
        </section>
      )}

      {/* 随机任务推荐 Modal（复用现有随机开始逻辑） */}
      {randomTask && (
        <RandomResultModal
          task={randomTask}
          onClose={() => setRandomTask(null)}
          onReroll={() => {
            const picked = pickRandomTask(data.tasks)
            setRandomTask(picked)
          }}
          onStart={() => {
            onOpenTask(randomTask)
            setRandomTask(null)
          }}
          onOpenTask={() => {
            onOpenTask(randomTask)
            setRandomTask(null)
          }}
        />
      )}
    </div>
  )
}
