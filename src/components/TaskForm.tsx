import { useState } from 'react'
import { Modal } from './Modal'
import { createTask } from '../store'
import { WeekdayPicker } from './WeekdayPicker'
import { parseSeqBlock, parseCountdownMin } from '../seqInput'
import { SeqGenerator } from './SeqGenerator'
import { ProgressNodesEditor } from './ProgressNodesEditor'
import type { ProgressNode } from '../types'

interface Props {
  onClose: () => void
}

// 方向模板：只预填「单位 / 目标 / 时长」这三个最常填的，别的字段不替用户做主。
// 选中后仍可改，模板只是省掉从零开始的思考成本。
const TASK_TEMPLATES: Array<{
  key: string
  label: string
  unit: string
  target: string
  countdown: string
}> = [
  { key: 'reading', label: '阅读', unit: '章', target: '20', countdown: '25' },
  { key: 'language', label: '语言', unit: '课', target: '12', countdown: '15' },
  { key: 'drawing', label: '绘画', unit: '张', target: '', countdown: '45' },
  { key: 'modeling', label: '建模', unit: '个', target: '', countdown: '60' },
]

export function TaskForm({ onClose }: Props) {
  const [name, setName] = useState('')
  // 插入位置：默认顶部（顺序即权重，新建通常想排前面）
  const [insertAt, setInsertAt] = useState<'top' | 'bottom'>('top')
  // 提醒星期（空 = 每天）
  const [weekdays, setWeekdays] = useState<number[]>([])
  // 已套用的模板（仅用于高亮，不做别的判断）
  const [tpl, setTpl] = useState<string>('')

  // 序列输入：每行一条，"名称 | 目标 | 单位 | 倒计时分钟" 竖线可选
  const [seqInput, setSeqInput] = useState('')

  // 全局模板（所有序列共用的默认参数，单独行覆盖全局）
  const [globalTarget, setGlobalTarget] = useState('')
  const [globalUnit, setGlobalUnit] = useState('')
  const [globalCountdown, setGlobalCountdown] = useState('')
  const [globalNodes, setGlobalNodes] = useState<ProgressNode[]>([])

  const submit = () => {
    if (!name.trim()) return
    const names: string[] = []
    const templates: NonNullable<Parameters<typeof createTask>[0]['sequenceTemplates']> = []

    const parsedLines = parseSeqBlock(seqInput)

    if (parsedLines.length > 0) {
      const gCountdown = parseCountdownMin(globalCountdown)
      for (const p of parsedLines) {
        names.push(p.name)
        templates.push({
          progressTarget: p.target || globalTarget || undefined,
          progressUnit: p.unit || globalUnit || undefined,
          countdownSeconds:
            parseCountdownMin(p.countdownMin ?? '') ?? gCountdown ?? undefined,
          progressNodes: globalNodes.length ? globalNodes : undefined,
          progress: (p.target || globalTarget) ? '0' : undefined,
        })
      }
    }

    createTask({
      name: name.trim(),
      icon: '',
      insertAt,
      weekdays,
      sequenceNames: names.length > 0 ? names : undefined,
      sequenceTemplates: templates.length > 0 ? templates : undefined,
      templateDefault:
        globalTarget || globalUnit || globalCountdown
          ? {
              progressTarget: globalTarget || undefined,
              progressUnit: globalUnit || undefined,
              countdownSeconds: parseCountdownMin(globalCountdown) ?? undefined,
            }
          : undefined,
    })
    onClose()
  }

  return (
    <Modal
      title="新建方向"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            创建
          </button>
        </>
      }
    >
      <div className="form-stack" style={{ gap: 10 }}>
        <div className="form-group-title">方向</div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label>名称</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label>
            快速模板
            <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
              只预填单位 / 目标 / 时长，可改
            </span>
          </label>
          <div className="row wrap" style={{ gap: 6 }}>
            {TASK_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`btn sm ${tpl === t.key ? 'primary' : ''}`}
                onClick={() => {
                  setTpl(tpl === t.key ? '' : t.key)
                  if (tpl === t.key) return
                  setGlobalUnit(t.unit)
                  setGlobalTarget(t.target)
                  setGlobalCountdown(t.countdown)
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label>插入位置</label>
          <div className="seg-row">
            <button
              type="button"
              className={`seg-item ${insertAt === 'top' ? 'active' : ''}`}
              onClick={() => setInsertAt('top')}
            >
              顶部
            </button>
            <button
              type="button"
              className={`seg-item ${insertAt === 'bottom' ? 'active' : ''}`}
              onClick={() => setInsertAt('bottom')}
            >
              底部
            </button>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label>提醒星期</label>
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
        </div>

        <div className="form-group-title">初始序列</div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label>序列名</label>
          <textarea
            className="textarea"
            placeholder={'每行一条：名称｜目标｜单位｜分钟\n也支持空格分隔（卷三 80 篇 25）、逗号拆分（卷一，卷二）'}
            value={seqInput}
            onChange={(e) => setSeqInput(e.target.value)}
            rows={4}
          />
          <SeqGenerator
            onGenerate={(lines) => {
              setSeqInput((prev) =>
                prev.trim() ? prev.replace(/\s+$/, '') + '\n' + lines.join('\n') : lines.join('\n'),
              )
            }}
          />
        </div>

        <div className="faint" style={{ fontSize: 12 }}>
          序列行未写的参数，取以下默认值
        </div>
        <div className="grid-3">
          <div className="mini-field">
            <label>目标</label>
            <input
              className="input"
              type="number"
              min={0}
              value={globalTarget}
              onChange={(e) => setGlobalTarget(e.target.value)}
            />
          </div>
          <div className="mini-field">
            <label>单位</label>
            <input
              className="input"
              value={globalUnit}
              onChange={(e) => setGlobalUnit(e.target.value)}
            />
          </div>
          <div className="mini-field">
            <label>倒计时·分</label>
            <input
              className="input"
              type="number"
              min={0}
              value={globalCountdown}
              onChange={(e) => setGlobalCountdown(e.target.value)}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="faint" style={{ fontSize: 12 }}>进度节点</label>
          <ProgressNodesEditor
            value={globalNodes}
            onChange={setGlobalNodes}
            previewProgress={globalTarget ? '0' : ''}
            unit={globalUnit}
            target={globalTarget}
          />
        </div>
      </div>
    </Modal>
  )
}
