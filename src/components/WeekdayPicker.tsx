import { WEEKDAY_LABELS } from '../types'

interface Props {
  // 0=周日 … 6=周六；空数组 = 每天（展示时按全选处理）
  value: number[]
  onChange: (v: number[]) => void
  disabled?: boolean
}

const ALL = [0, 1, 2, 3, 4, 5, 6]

// 提醒星期选择：7 个胶囊切换；全选 = 每天
// 语义约定：value 为空数组表示「每天」；保存时全选也归一为空数组。
export function WeekdayPicker({ value, onChange, disabled }: Props) {
  // 空 = 每天 → 视为全选
  const cur = value.length === 0 ? ALL : value

  const toggle = (v: number) => {
    const s = new Set(cur)
    if (s.has(v)) {
      if (s.size > 1) s.delete(v) // 至少保留一天
    } else {
      s.add(v)
    }
    const next = Array.from(s).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    // 全选归一为空数组（= 每天）
    onChange(next.length === 7 ? [] : next)
  }

  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {WEEKDAY_LABELS.map((w) => {
        const on = cur.includes(w.value)
        return (
          <button
            key={w.value}
            type="button"
            className={`btn sm ${on ? 'primary' : ''}`}
            onClick={() => toggle(w.value)}
            disabled={disabled}
            style={{ minWidth: 40 }}
          >
            {w.label}
          </button>
        )
      })}
      <span className="faint" style={{ fontSize: 12, alignSelf: 'center' }}>
        {value.length === 0 ? '每天' : `每周 ${value.length} 天`}
      </span>
    </div>
  )
}

// 星期数字组 → 短文本（如「一三五」）；空/全选 = 空串（= 每天，不显示）
export function weekdaysShort(weekdays: number[] | undefined): string {
  if (!weekdays || weekdays.length === 0 || weekdays.length === 7) return ''
  const sorted = [...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  return sorted
    .map((d) => WEEKDAY_LABELS.find((w) => w.value === d)?.label ?? '')
    .join('')
}
