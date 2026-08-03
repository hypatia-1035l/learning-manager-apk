import { useState } from 'react'
import { Modal } from './Modal'
import { createTask } from '../store'
import type { ProgressNode } from '../types'

interface Props {
  onClose: () => void
}

function parseCountdownMin(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n) * 60
}

// 每行可支持 "序列名 | 目标 | 单位 | 倒计时分钟"，| 换成中文也可识别
//  例：左传 | 500  | 篇 | 25
function parseSeqLine(line: string): {
  name: string
  target?: string
  unit?: string
  countdownMin?: string
} {
  const parts = line.split(/[|｜]/).map((p) => p.trim())
  const [name, target, unit, countdownMin] = parts
  return { name: name || '', target, unit, countdownMin }
}

function parseNodesText(text: string): ProgressNode[] {
  const lines = text.split('\n')
  const nodes: ProgressNode[] = []
  for (const l of lines) {
    const t = l.trim()
    if (!t) continue
    const m = t.match(/^(\d+(?:\.\d+)?)\s*[,，\s|、]\s*(.+)$/)
    if (m) nodes.push({ at: Math.floor(Number(m[1])), label: m[2].trim() })
  }
  return nodes.sort((a, b) => a.at - b.at)
}

export function TaskForm({ onClose }: Props) {
  const [name, setName] = useState('')

  // 序列输入：每行一条，"名称 | 目标 | 单位 | 倒计时分钟" 竖线可选
  const [seqInput, setSeqInput] = useState('')

  // 全局模板（所有序列共用的默认参数，单独行覆盖全局）
  const [globalTarget, setGlobalTarget] = useState('')
  const [globalUnit, setGlobalUnit] = useState('')
  const [globalCountdown, setGlobalCountdown] = useState('')
  const [globalNodes, setGlobalNodes] = useState('')

  const quickPreset = (mode: 'book' | 'videos' | 'articles' | 'pomodoro') => {
    if (mode === 'book') {
      setGlobalTarget('300')
      setGlobalUnit('页')
      setGlobalCountdown('25')
    } else if (mode === 'videos') {
      setGlobalTarget('50')
      setGlobalUnit('集')
      setGlobalCountdown('15')
    } else if (mode === 'articles') {
      setGlobalTarget('100')
      setGlobalUnit('篇')
      setGlobalCountdown('10')
    } else if (mode === 'pomodoro') {
      setGlobalCountdown('25')
    }
  }

  const submit = () => {
    if (!name.trim()) return
    const names: string[] = []
    const templates: NonNullable<Parameters<typeof createTask>[0]['sequenceTemplates']> = []

    const parsedLines = seqInput
      .split('\n')
      .map((l) => l.trimEnd())
      .map(parseSeqLine)
      .filter((x) => x.name)

    if (parsedLines.length > 0) {
      const nodes = parseNodesText(globalNodes)
      const gCountdown = parseCountdownMin(globalCountdown)
      for (const p of parsedLines) {
        names.push(p.name)
        templates.push({
          progressTarget: p.target || globalTarget || undefined,
          progressUnit: p.unit || globalUnit || undefined,
          countdownSeconds:
            parseCountdownMin(p.countdownMin ?? '') ?? gCountdown ?? undefined,
          progressNodes: nodes.length ? nodes : undefined,
          progress: (p.target || globalTarget) ? '0' : undefined,
        })
      }
    }

    createTask({
      name: name.trim(),
      icon: '',
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
      title="新建学习方向"
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
        <div className="field" style={{ marginBottom: 4 }}>
          <label>方向名称</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：历史阅读、英语、Blender"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <div>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <span className="faint" style={{ fontSize: 12, alignSelf: 'center' }}>快速模板：</span>
            <button className="btn sm" onClick={() => quickPreset('book')}>读书 300页/25分</button>
            <button className="btn sm" onClick={() => quickPreset('videos')}>视频 50集/15分</button>
            <button className="btn sm" onClick={() => quickPreset('articles')}>文章 100篇/10分</button>
            <button className="btn sm" onClick={() => quickPreset('pomodoro')}>番茄钟 25分</button>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 2 }}>
          <div className="field" style={{ flex: '1 1 90px', marginBottom: 0 }}>
            <label className="faint" style={{ fontSize: 12 }}>默认目标</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="300"
              value={globalTarget}
              onChange={(e) => setGlobalTarget(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '1 1 70px', marginBottom: 0 }}>
            <label className="faint" style={{ fontSize: 12 }}>单位</label>
            <input
              className="input"
              placeholder="页/集/篇"
              value={globalUnit}
              onChange={(e) => setGlobalUnit(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '1 1 90px', marginBottom: 0 }}>
            <label className="faint" style={{ fontSize: 12 }}>倒计时(分)</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="25"
              value={globalCountdown}
              onChange={(e) => setGlobalCountdown(e.target.value)}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label className="faint" style={{ fontSize: 12 }}>
            进度节点（可选，所有序列共用）· 每行 <code style={{ fontSize: 11 }}>数字 名称</code>
          </label>
          <textarea
            className="input"
            rows={2}
            placeholder={'0 入门\n100 进阶\n200 大师'}
            value={globalNodes}
            onChange={(e) => setGlobalNodes(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontSize: 13, padding: 8 }}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>
            预置序列名
            <span className="faint" style={{ fontSize: 12 }}>
              · 每行一条，可带参数：<code style={{ fontSize: 11 }}>名称 | 目标 | 单位 | 分钟</code>（竖线后可不填，空则用全局模板）
            </span>
          </label>
          <textarea
            className="textarea"
            placeholder={
              '例：\n左传\n资治通鉴 | 294 | 卷 | 45\n史记'
            }
            value={seqInput}
            onChange={(e) => setSeqInput(e.target.value)}
            rows={4}
          />
        </div>

        <p className="faint" style={{ fontSize: 12, marginTop: 2 }}>
          留空序列名只建方向，之后手动加。有目标+单位→自动是 count 型进度，否则 position 型。
        </p>
      </div>
    </Modal>
  )
}
