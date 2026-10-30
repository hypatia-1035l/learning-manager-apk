// 序列编辑弹层：新增与编辑共用同一份字段，一次只编辑一个。
//
// 为什么从「列表内联」搬进弹层：
//   1. 内联时表单会把 .obj-item 撑高，而它是 align-items:center —— 序号被垂直居中，
//      看起来「悬在表单外面」；
//   2. 新增区和编辑区长得一模一样、又都堆在列表里，用户分不清哪个是哪个。
//
// 字段策略：默认只露「名称 + 时长」两栏（90% 的序列只需要这两个），
// 单位 / 目标 / 当前进度 / 进度节点收进「更多」，默认收起。
import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { addLearningObject, updateLearningObject } from '../store'
import { parseCountdownMin, parseSeqBlock } from '../seqInput'
import { ProgressNodesEditor } from './ProgressNodesEditor'
import { readSeqDefaults, writeSeqDefaults } from '../seqDefaults'
import type { LearningObject, ProgressNode, Task } from '../types'

interface Props {
  task: Task
  /** 传入 = 编辑该序列；不传 = 新增 */
  item?: LearningObject
  onClose: () => void
}

const PRESET_MIN = [5, 15, 25, 45]

export function SequenceSheet({ task, item, onClose }: Props) {
  const isEdit = !!item
  const dflt = readSeqDefaults()

  const [line, setLine] = useState('')
  const [parsed, setParsed] = useState<{ name: string; target?: string; unit?: string; countdownMin?: string } | null>(null)
  const [multiCount, setMultiCount] = useState(0)

  const [name, setName] = useState(item?.name ?? '')
  const [countdown, setCountdown] = useState(
    item?.countdownSeconds ? String(Math.round(item.countdownSeconds / 60)) : dflt.countdownMin,
  )
  const [unit, setUnit] = useState(item?.progressUnit ?? dflt.unit)
  const [target, setTarget] = useState(item?.progressTarget ?? '')
  const [prog, setProg] = useState(item?.progress ?? '')
  const [nodes, setNodes] = useState<ProgressNode[]>(item?.progressNodes ?? [])
  const [more, setMore] = useState(false)

  // 一行录入：粘贴「卷三 80 篇 25」就自动解到各字段。
  // 复用 bulk 那套 parseSeqBlock，保证「一行」和「批量」是同一套语法，不用记两遍。
  const handleLine = (v: string) => {
    setLine(v)
    const lines = parseSeqBlock(v)
    if (lines.length === 0) {
      setParsed(null)
      setMultiCount(0)
      return
    }
    if (lines.length > 1) {
      // 一次只想编辑一条：多条交给列表页的「批量」，这里只提示，不擅自拆分
      setParsed(null)
      setMultiCount(lines.length)
      return
    }
    const p = lines[0]
    setMultiCount(0)
    setParsed(p)
    setName(p.name)
    if (p.target !== undefined) setTarget(p.target)
    if (p.unit !== undefined) setUnit(p.unit)
    if (p.countdownMin !== undefined) setCountdown(p.countdownMin)
  }

  const canSave = name.trim().length > 0

  const submit = (keepOpen: boolean) => {
    if (!canSave) return
    const cd = parseCountdownMin(countdown)
    const remember = { unit: unit.trim(), countdownMin: countdown.trim() }

    if (isEdit && item) {
      updateLearningObject(task.id, item.id, {
        name: name.trim(),
        progress: prog,
        progressUnit: unit.trim(),
        progressTarget: target.trim(),
        countdownSeconds: cd,
        progressNodes: nodes.length > 0 ? nodes : undefined,
      })
      writeSeqDefaults(remember)
      onClose()
      return
    }

    addLearningObject(task.id, {
      name: name.trim(),
      progress: target.trim() ? '0' : undefined,
      progressUnit: unit.trim(),
      progressTarget: target.trim(),
      countdownSeconds: cd,
    })
    writeSeqDefaults(remember)

    if (!keepOpen) {
      onClose()
      return
    }
    // 连续添加：清名称与录入行，保留单位/时长（正是「记住上次」要的效果）
    setName('')
    setLine('')
    setParsed(null)
    setMultiCount(0)
  }

  const title = isEdit ? '编辑序列' : '新建序列'
  const cdHint = useMemo(() => {
    const cd = parseCountdownMin(countdown)
    if (cd === null) return '不填 = 正向计时（计到手动结束）'
    return `倒计时 ${Math.round(cd / 60)} 分钟`
  }, [countdown])

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          {!isEdit && (
            <button className="btn" onClick={() => submit(true)} disabled={!canSave}>
              保存并继续添加
            </button>
          )}
          <button className="btn primary" onClick={() => submit(false)} disabled={!canSave}>
            保存
          </button>
        </>
      }
    >
      <div className="form-stack" style={{ gap: 10 }}>
        {!isEdit && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              一行录入
              <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
                可选，省得逐栏填
              </span>
            </label>
            <input
              className="input"
              placeholder="如：卷三 80 篇 25"
              value={line}
              onChange={(e) => handleLine(e.target.value)}
            />
            {parsed && (
              <div className="app-chips" style={{ marginTop: 6 }}>
                <span className="app-chip static">{parsed.name}</span>
                {parsed.target && (
                  <span className="app-chip static">
                    {parsed.target}
                    {parsed.unit ?? unit}
                  </span>
                )}
                {parseCountdownMin(parsed.countdownMin ?? '') !== null && (
                  <span className="app-chip static">
                    {Math.round((parseCountdownMin(parsed.countdownMin ?? '') ?? 0) / 60)} 分钟
                  </span>
                )}
              </div>
            )}
            {multiCount > 1 && (
              <p className="faint" style={{ fontSize: 12, marginTop: 6, color: 'var(--amber, #c47f00)' }}>
                识别到 {multiCount} 条。这里一次只建一条——多条请退出后用列表页的「批量」。
              </p>
            )}
            {!parsed && multiCount === 0 && (
              <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                语法与「批量」一致：名称 目标 单位 分钟；也可以只写名称。
              </p>
            )}
          </div>
        )}

        <div className="field" style={{ marginBottom: 0 }}>
          <label>名称</label>
          <input
            className="input"
            autoFocus={isEdit}
            placeholder="如：卷三"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) submit(false)
            }}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>时长</label>
          <div className="row wrap" style={{ gap: 6 }}>
            {PRESET_MIN.map((m) => (
              <button
                key={m}
                type="button"
                className={`btn sm ${countdown === String(m) ? 'primary' : ''}`}
                onClick={() => setCountdown(countdown === String(m) ? '' : String(m))}
              >
                {m}分
              </button>
            ))}
            <input
              className="input"
              type="number"
              min={0}
              style={{ width: 82 }}
              placeholder="自定"
              value={countdown}
              onChange={(e) => setCountdown(e.target.value)}
            />
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{cdHint}</p>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`btn sm ${more ? 'primary' : ''}`}
            onClick={() => setMore((v) => !v)}
          >
            {more ? '收起更多' : '更多（单位 / 目标 / 进度节点）'}
          </button>
        </div>

        {more && (
          <>
            <div className="grid-2">
              <div className="mini-field">
                <label>单位</label>
                <input
                  className="input"
                  placeholder="如：篇 / 章 / 回"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
              <div className="mini-field">
                <label>目标</label>
                <input
                  className="input"
                  placeholder="如：80"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
            </div>

            {isEdit && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  当前进度
                  <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>
                    改这里等于直接校正已学量
                  </span>
                </label>
                <input
                  className="input"
                  value={prog}
                  onChange={(e) => setProg(e.target.value)}
                />
              </div>
            )}

            <div className="field" style={{ marginBottom: 0 }}>
              <label className="faint" style={{ fontSize: 12 }}>
                进度节点
              </label>
              <ProgressNodesEditor
                value={nodes}
                onChange={setNodes}
                previewProgress={isEdit ? prog : target ? '0' : ''}
                unit={unit}
                target={target}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
