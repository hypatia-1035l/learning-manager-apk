#!/usr/bin/env node
// 回归验证：把 src 下的纯逻辑模块用 esbuild 打包成 node bundle，逐个场景跑断言。
//
// 为什么需要它：store/migrate/randomStore/dataBackup 的关键行为（数据损坏保护、
// 计划项 pinned 标记、备份清理、预设导入）都是纯函数逻辑，用 tsc 只能验证类型，
// 验证不了行为。这里用真实源码 + 假 localStorage 跑端到端断言。
//
// 用法：npm run verify
// 依赖：esbuild（由 vite 间接带入 node_modules，无需额外安装）

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-verify-'))

const esbuildMain = path.join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js')
if (!fs.existsSync(esbuildMain)) {
  console.error('找不到 esbuild（' + esbuildMain + '）')
  console.error('请先执行 npm install')
  process.exit(1)
}
const esb = (await import(pathToFileURL(esbuildMain).href)).default
if (!esb || typeof esb.buildSync !== 'function') {
  console.error('esbuild 模块形态异常，无法使用 buildSync')
  process.exit(1)
}

// ---------- 测试环境（必须作为 entry 的第一个 import） ----------
// esbuild 会把内联模块的初始化提升到 banner 之前，所以不能用 banner 安装 stub，
// 只能靠「第一个 import 的模块」保证模块求值顺序。
const ENV_PATH = path.join(OUT, 'env.mjs')
fs.writeFileSync(
  ENV_PATH,
  `const seed = JSON.parse(process.env.LM_SEED || '{}')
const map = new Map(Object.entries(seed))
const ls = {
  get length() { return map.size },
  key(i) { return Array.from(map.keys())[i] ?? null },
  getItem(k) { return map.has(k) ? map.get(k) : null },
  setItem(k, v) { map.set(String(k), String(v)) },
  removeItem(k) { map.delete(k) },
  clear() { map.clear() },
}
globalThis.localStorage = ls
globalThis.__ls = ls
globalThis.window = { location: { reload() { globalThis.__reloaded = true } } }
export function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1) }
  console.log('  ok - ' + msg)
}
`,
  'utf8',
)

// Capacitor 的测试替身
const STUB_CORE = path.join(OUT, 'stub-capacitor-core.mjs')
fs.writeFileSync(
  STUB_CORE,
  `export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
  isPluginAvailable: () => false,
  convertFileSrc: (p) => p,
}
export const registerPlugin = () => ({})
export const Plugins = {}
export default { Capacitor, registerPlugin, Plugins }
`,
  'utf8',
)
const STUB_FS = path.join(OUT, 'stub-capacitor-filesystem.mjs')
fs.writeFileSync(
  STUB_FS,
  `export const Filesystem = { writeFile: async () => ({ uri: '' }), readFile: async () => ({ data: '' }) }
export const Directory = { Documents: 'DOCUMENTS', Data: 'DATA' }
export const Encoding = { UTF8: 'utf8' }
export default { Filesystem, Directory, Encoding }
`,
  'utf8',
)

// ---------- 场景 ----------
const d = new Date()
const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
  d.getDate(),
).padStart(2, '0')}`

const seedPinToday = {
  'learning-manager:data:v1': JSON.stringify({
    tasks: [
      {
        id: 't1', name: '阅读', icon: '', status: 'not_started', enabled: true,
        weight: 1, group: null, currentObjectId: null, totalStudyTime: 0,
        createdAt: 0, updatedAt: 0, weekdays: [],
      },
    ],
    records: [],
    reminder: {
      enabled: true, planSessions: 4, planTiming: 'random', intervalMinutes: 90,
      cooldownMinutes: 30, windows: [{ startMinute: 0, endMinute: 1439 }],
      skipAfterSessionMinutes: 0, deferMinutes: 2, reengageDays: 2,
      planLookaheadDays: 3, intensity: 'weak', guardEnabled: false, guardGraceMinutes: 5,
    },
    plans: [{ date: todayKey, items: [], generatedAt: 0 }],
    pinnedTasks: [],
  }),
}

const scenarios = [
  {
    name: '1-corrupt-backup',
    seed: { 'learning-manager:data:v1': '{not json' },
    imports: `import { getAppData } from './store'`,
    body: `
const raw = localStorage.getItem('learning-manager:data:v1')
assert(localStorage.getItem('learning-manager:data:corrupt-backup') === '{not json', '损坏原文已备份到恢复键')
let parsed = null
try { parsed = JSON.parse(raw) } catch {}
assert(parsed !== null && Array.isArray(parsed.tasks), '主键已写入可解析的默认数据（应用可继续运行）')
assert(getAppData().tasks.length >= 1, 'store 正常工作')
`,
  },
  {
    name: '2-pinned-migration',
    seed: {},
    imports: `import { migrateAppData } from './migrate'`,
    body: `
const data = migrateAppData({
  tasks: [], records: [],
  plans: [{ date: '2026-09-25', generatedAt: 1, items: [
    { id: 'i1', taskId: 't1', minuteOfDay: 600, status: 'pending', pinned: true },
    { id: 'i2', taskId: 't1', minuteOfDay: 700, status: 'pending' },
  ]}],
})
const items = data.plans[0].items
assert(items[0].pinned === true, 'migratePlanDay 保留 pinned=true')
assert(items[1].pinned === undefined, '未固定的项不写入 pinned')
`,
  },
  {
    name: '3-pinned-legacy-repair',
    seed: {},
    imports: `import { migrateAppData } from './migrate'`,
    body: `
const data = migrateAppData({
  tasks: [], records: [],
  pinnedTasks: [{ taskId: 't1', sequenceId: 's1' }],
  plans: [{ date: '2026-09-25', generatedAt: 1, items: [
    { id: 'i1', taskId: 't1', sequenceId: 's1', minuteOfDay: 600, status: 'pending' },
    { id: 'i2', taskId: 't1', sequenceId: 's2', minuteOfDay: 700, status: 'pending' },
    { id: 'i3', taskId: 't2', sequenceId: 's1', minuteOfDay: 800, status: 'pending' },
    { id: 'i4', taskId: 't1', sequenceId: 's1', minuteOfDay: 900, status: 'done' },
  ]}],
})
const items = data.plans[0].items
assert(items[0].pinned === true, '旧数据：固定项按 pinnedTasks 补回标记')
assert(items[1].pinned === undefined, '非固定序列不受影响')
assert(items[2].pinned === undefined, '非固定方向不受影响')
assert(items[3].pinned === undefined, '已完成项不补标记')
`,
  },
  {
    name: '4-preset-banknames',
    seed: {},
    imports: `import { importAll, exportAll } from './randomStore'`,
    body: `
const res = importAll({
  ranges: [],
  banks: [{ name: '测试库X', category: '', words: [{ text: 'a', weight: 1 }] }],
  presets: [{ name: '预设P', bankIds: ['legacy-id-from-other-device'], bankNames: ['测试库X'] }],
})
assert(res.addedBanks === 1, '词库导入 1 个')
assert(res.addedPresets === 1, '预设导入 1 个')
const dump = JSON.parse(exportAll())
const p = dump.presets.find((x) => x.name === '预设P')
assert(!!p, '导出结果里能找到该预设')
assert(p.bankIds.length === 1 && p.bankIds[0] === res.bankIds[0], '预设 bankIds 跨环境解析到新库 id（不再丢空）')
assert(p.bankNames[0] === '测试库X', '导出附带 bankNames')
`,
  },
  {
    name: '5-import-backup-sweep',
    seed: {},
    imports: `import { importBackup } from './dataBackup'`,
    body: `
localStorage.setItem('learning-manager:data:v1', '{"old":1}')
localStorage.setItem('learning-manager:random-toolbox:v1', '{"old":2}')
localStorage.setItem('learning-manager:random-seeded:v1', '1')
localStorage.setItem('learning-manager:default-task-seeded', '1')
importBackup({
  version: 1, exportedAt: 0, app: 'x',
  data: { 'learning-manager:data:v1': '{"restored":true}' },
})
const keys = []
for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i))
assert(!keys.includes('learning-manager:random-toolbox:v1'), '旧持久键 random-toolbox 已清除')
assert(!keys.includes('learning-manager:random-seeded:v1'), '旧持久键 random-seeded 已清除')
assert(!keys.includes('learning-manager:default-task-seeded'), '旧持久键 default-task-seeded 已清除（原实现会漏删）')
assert(localStorage.getItem('learning-manager:data:v1') === '{"restored":true}', '备份内容已写回')
assert(globalThis.__reloaded === true, '导入后触发 reload')
`,
  },
  {
    name: '6-pin-today',
    seed: seedPinToday,
    imports: `import { getAppData, togglePinnedTask } from './store'`,
    body: `
const today = ${JSON.stringify(todayKey)}
const day0 = getAppData().plans.find((p) => p.date === today)
assert(!!day0, '预置的今日计划可读')
const before = day0.items.length
togglePinnedTask('t1')
const day1 = getAppData().plans.find((p) => p.date === today)
assert(day1.items.length === before + 1, '固定后当天计划立即多出一项')
assert(day1.items.some((it) => it.pinned === true && it.taskId === 't1'), '注入项带 pinned 标记')
togglePinnedTask('t1')
const day2 = getAppData().plans.find((p) => p.date === today)
assert(!day2.items.some((it) => it.pinned === true && it.taskId === 't1'), '取消固定后 pending 固定项被移除')
`,
  },
  {
    name: '7-modal-focus-trap',
    seed: {},
    imports: `import { resolveTabTarget } from './components/Modal'`,
    body: `
const a = { focus() {} }
const b = { focus() {} }
const c = { focus() {} }
const root = { focus() {}, contains: (el) => el === a || el === b || el === c }
const items = [a, b, c]
assert(resolveTabTarget(items, a, true, root) === c, 'Shift+Tab 在首元素 → 绕到末元素')
assert(resolveTabTarget(items, c, false, root) === a, 'Tab 在末元素 → 绕回首元素')
assert(resolveTabTarget(items, b, false, root) === null, 'Tab 在中间 → 交给浏览器默认行为')
assert(resolveTabTarget(items, b, true, root) === null, 'Shift+Tab 在中间 → 交给浏览器默认行为')
assert(resolveTabTarget(items, null, false, root) === a, '焦点在弹窗外 → 拉回首元素')
assert(resolveTabTarget([], null, false, root) === root, '没有可聚焦元素 → 聚焦对话框容器')
assert(resolveTabTarget([], a, true, root) === root, '没有可聚焦元素（Shift 方向）→ 聚焦对话框容器')
`,
  },
  {
    name: '8-dst-day-buckets',
    seed: {},
    // 用美国东部时区跑：2026-03-08 02:00 起夏令时，当天只有 23 小时
    env: { TZ: 'America/New_York' },
    imports: `import { getDailyDurations, getStreakDays } from './store'`,
    body: `
// 把「现在」钉死在 2026-03-09（夏令时切换的次日），让分桶结果可复现
const RealDate = Date
const FIXED = new RealDate('2026-03-09T12:00:00')
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED.getTime())
    else super(...args)
  }
  static now() { return FIXED.getTime() }
}
globalThis.Date = FakeDate

const at = (iso) => new RealDate(iso).getTime()
const rec = (id, date, duration) => ({
  id, taskId: 't', taskName: 'T', objectId: '', objectName: '',
  date, duration, startProgress: '', endProgress: '',
})
// 本地 2026-03-08 00:30 EST（UTC-5）= 05:30Z；当天 02:00 进入夏令时
const r308 = rec('a', at('2026-03-08T05:30:00Z'), 100)
// 本地 2026-03-09 00:30 EDT（UTC-4）= 04:30Z
const r309 = rec('b', at('2026-03-09T04:30:00Z'), 200)

// 自检：旧实现「减固定 86400000」在该时区确实会产生非 0 点的桶边界。
// 若哪天有人改回旧写法，下面这条会先失败，说明本用例是有效的判别器。
const probe = new RealDate(FIXED.getTime())
probe.setHours(0, 0, 0, 0)
const oldStyleBoundary = probe.getTime() - 5 * 24 * 60 * 60 * 1000
assert(
  new RealDate(oldStyleBoundary).getHours() !== 0,
  '自检：旧算法在跨夏令时窗口内确实错位（证明本用例能抓到该 bug）',
)

const days = getDailyDurations([r308, r309], 5)
for (const d of days) {
  const x = new RealDate(d.date)
  assert(
    x.getHours() === 0 && x.getMinutes() === 0,
    '桶起点是本地 0 点（' + x.toString().slice(0, 24) + '）',
  )
}
assert(days[days.length - 2].duration === 100, '3-08 00:30 的记录落在 3-08 桶（减固定毫秒的旧实现会落到 3-09）')
assert(days[days.length - 1].duration === 200, '3-09 00:30 的记录落在 3-09 桶')
assert(getStreakDays([r308, r309]) === 2, '跨夏令时的连续两天仍算 2 天（旧实现会算成 1 天）')
`,
  },
  {
    name: '9-regenerate-keeps-manual',
    seed: {
      'learning-manager:data:v1': JSON.stringify({
        tasks: [
          {
            id: 't1', name: '阅读', icon: '', status: 'in_progress', enabled: true,
            weight: 1, currentObjectId: 's1', totalStudyTime: 0, createdAt: 0, updatedAt: 0,
            weekdays: [],
            group: {
              id: 'g1', name: '默认序列', mode: 'sequential',
              items: [
                { id: 's1', name: '左传', progress: '10', progressUnit: '篇', progressTarget: '100', completed: false, enabled: true, weight: 1 },
              ],
            },
          },
        ],
        records: [],
        reminder: {
          enabled: true, planSessions: 3, planTiming: 'random', intervalMinutes: 90,
          cooldownMinutes: 30, windows: [{ startMinute: 0, endMinute: 1439 }],
          skipAfterSessionMinutes: 0, deferMinutes: 0, reengageDays: 0,
          planLookaheadDays: 2, intensity: 'weak', guardEnabled: false, guardGraceMinutes: 5,
        },
        plans: [{
          date: todayKey, generatedAt: 0,
          items: [
            { id: 'auto1', taskId: 't1', taskName: '阅读', minuteOfDay: 600, status: 'pending' },
            { id: 'manual1', taskId: 't1', taskName: '读第 3 章', minuteOfDay: 700, status: 'pending', manual: true },
          ],
        }],
        pinnedTasks: [],
      }),
    },
    imports: `import { getAppData, regeneratePlanDayInStore } from './store'`,
    body: `
const today = ${JSON.stringify(todayKey)}
regeneratePlanDayInStore(today)
const day = getAppData().plans.find((p) => p.date === today)
assert(!!day, '重排后当天计划仍在')
assert(day.items.some((it) => it.id === 'manual1'), '重排保留用户手动创建的计划项（此前会被静默删除）')
const autoCount = day.items.filter((it) => !it.manual).length
assert(autoCount > 0, '重排仍生成了自动计划项')
`,
  },
  {
    name: '10-delete-task-clears-pins',
    seed: {
      // 已种子化：否则 load() 会自动补一个「即时」方向，干扰「删除后为空」断言
      'learning-manager:default-task-seeded': '1',
      'learning-manager:data:v1': JSON.stringify({
        tasks: [
          { id: 't1', name: 'A', icon: '', status: 'in_progress', enabled: true, weight: 1, currentObjectId: null, totalStudyTime: 0, createdAt: 0, updatedAt: 0, weekdays: [], group: null },
        ],
        records: [],
        pinnedTasks: [{ taskId: 't1' }],
      }),
    },
    imports: `import { getAppData, deleteTask } from './store'`,
    body: `
deleteTask('t1')
assert(getAppData().tasks.length === 0, '方向已删除')
assert((getAppData().pinnedTasks ?? []).length === 0, '删除方向时同步清理 pinnedTasks（否则提醒关闭后仍会生成计划）')
`,
  },
  {
    name: '11-pick-next-skips-disabled',
    seed: {},
    imports: `import { pickNextObject } from './store'`,
    body: `
const items = [
  { id: 'a', completed: true, enabled: true },
  { id: 'b', completed: false, enabled: false },
  { id: 'c', completed: false, enabled: true },
]
assert(pickNextObject(items, 'a', 'sequential') === 'c', '顺序接续跳过已停用序列（旧实现会选到 b）')
const allPaused = [
  { id: 'a', completed: true, enabled: true },
  { id: 'b', completed: false, enabled: false },
]
assert(pickNextObject(allPaused, 'a', 'sequential') === null, '只剩停用项时返回 null，而不是选中停用项')
`,
  },
  {
    name: '12-delete-record-subtracts',
    seed: {
      'learning-manager:data:v1': JSON.stringify({
        tasks: [
          { id: 't1', name: 'A', icon: '', status: 'in_progress', enabled: true, weight: 1, currentObjectId: null, totalStudyTime: 1000, createdAt: 0, updatedAt: 0, weekdays: [], group: null },
        ],
        records: [
          { id: 'r1', taskId: 't1', taskName: 'A', objectId: '', objectName: '', date: 1, duration: 120, startProgress: '', endProgress: '' },
        ],
      }),
    },
    imports: `import { getAppData, deleteStudyRecord } from './store'`,
    body: `
deleteStudyRecord('r1')
const t = getAppData().tasks.find((x) => x.id === 't1')
assert(getAppData().records.length === 0, '记录已删除')
assert(t.totalStudyTime === 880, '累计时长按单条 duration 扣减（不再从被 2000 条上限裁剪的 records 反推）')
`,
  },
  {
    name: '13-add-seq-revives-completed-task',
    seed: {
      'learning-manager:data:v1': JSON.stringify({
        tasks: [
          {
            id: 't1', name: 'A', icon: '', status: 'completed', enabled: true, weight: 1,
            currentObjectId: 's1', totalStudyTime: 0, createdAt: 0, updatedAt: 0, weekdays: [],
            group: {
              id: 'g1', name: '默认序列', mode: 'sequential',
              items: [
                { id: 's1', name: '旧序列', progress: '', progressUnit: '', progressTarget: '', completed: true, enabled: true, weight: 1 },
              ],
            },
          },
        ],
        records: [],
      }),
    },
    imports: `import { getAppData, addLearningObject, getRandomPool } from './store'`,
    body: `
addLearningObject('t1', { name: '新序列' })
const t = getAppData().tasks.find((x) => x.id === 't1')
assert(t.status === 'in_progress', '给已完成方向新增序列后回到 in_progress（旧实现永久卡在 completed）')
assert(getRandomPool(getAppData().tasks).some((x) => x.id === 't1'), '方向重新回到计划/随机候选池')
`,
  },
  {
    name: '14-back-blocker-stack',
    seed: {},
    imports: `import { pushBackBlocker, runTopBackBlocker, hasBackBlocker } from './backNavigation'`,
    body: `
const calls = []
const off1 = pushBackBlocker(() => calls.push('a'))
const off2 = pushBackBlocker(() => calls.push('b'))
assert(hasBackBlocker(), '压栈后有拦截器')
assert(runTopBackBlocker() === true && calls[0] === 'b', '返回事件先派发给栈顶（最上层弹窗）')
off2()
assert(runTopBackBlocker() === true && calls[1] === 'a', '弹出栈顶后派发给上一层')
off1()
assert(runTopBackBlocker() === false && hasBackBlocker() === false, '栈空时交回 App 层（退桌面/回子页）')
`,
  },
  {
    name: '15-random-num-bounds',
    seed: {},
    imports: `import { randNum } from './randomStore'`,
    body: `
// 整数模式必须能取到上界：骰子 1-6 要能出 6，硬币 1-2 要能出 2
const seen = new Set()
let outside = 0
for (let i = 0; i < 50000; i++) {
  const v = randNum(1, 6, 0)
  seen.add(v)
  if (v < 1 || v > 6) outside++
}
assert(seen.has(1) && seen.has(6), '整数模式 [1,6] 两端都能取到（旧实现永远取不到 6）')
assert(outside === 0, '整数模式结果不越界')
const seenCoin = new Set()
for (let i = 0; i < 2000; i++) seenCoin.add(randNum(1, 2, 0))
assert(seenCoin.size === 2, '硬币 1-2 两种结果都会出现（旧实现恒为 1）')
// 小数模式：round 不能把结果带到区间外
let decOutside = 0
for (let i = 0; i < 50000; i++) {
  const a = randNum(0, 1.06, 1)
  if (a < 0 || a > 1.06) decOutside++
  const b = randNum(0.04, 1, 1)
  if (b < 0.04 || b > 1) decOutside++
}
assert(decOutside === 0, '小数模式结果夹在 [min,max] 内（round 边界不越界）')
// 区间内没有整数时不崩、不越界（UI 层会提前拒绝）
const odd = randNum(1.2, 1.8, 0)
assert(odd >= 1.2 && odd <= 1.8, '无整数区间退化为区间中点且不越界')
`,
  },
  {
    name: '16-random-seed-persist',
    seed: {},
    imports: `import { exportAll } from './randomStore'`,
    body: `
const dump = JSON.parse(exportAll())
assert(dump.banks.length >= 3, '首次启动种入内置词库（' + dump.banks.length + '）')
assert(dump.colorRanges && dump.colorRanges.length >= 6, '首次启动种入内置颜色范围')
// 关键：seed 内容必须同时落盘，否则下次启动「已种子化」标记还在、数据却没了
const raw = localStorage.getItem('learning-manager:random-toolbox:v1')
assert(!!raw, '内置数据已持久化到 localStorage（此前只写内存，第二次启动会永久丢失）')
assert(JSON.parse(raw).banks.length >= 3, '落盘数据里包含内置词库')
`,
  },
  {
    name: '17-random-import-validation',
    seed: {},
    imports: `import { detectImportFormat, importAll } from './randomStore'`,
    body: `
// 非法条目必须在「预览」阶段就被拒绝，而不是点确认时抛 TypeError（界面无反应）
assert(detectImportFormat('{"banks":[null]}').type === 'invalid', 'banks 里的 null 条目被判为非法文件')
assert(detectImportFormat('{"banks":[{"name":123,"words":[]}]}').type === 'invalid', '词库名不是字符串被判为非法文件')
// 旧格式（无 colorRanges）仍可导入，且合法条目正常入库；数值非法的 range 被丢弃计数
const res = importAll({
  ranges: [{ name: '坏范围' }, { name: '好范围', min: 1, max: 10 }],
  banks: [{ name: '新词库', category: '', words: [{ text: 'a', weight: 1 }] }],
  presets: [],
})
assert(res.addedBanks === 1, '合法词库正常导入')
assert(res.addedRanges === 1, '只有 min/max 合法的范围被导入')
assert(res.invalidItems >= 1, '非法条目被丢弃并计数（不再写入不可用数据）')
assert(Array.isArray(res.bankIds) && res.bankIds.length === 1, '返回新词库 id')
`,
  },
  {
    name: '18-random-color-range-roundtrip',
    seed: {},
    imports: `import { addColorRange, exportAll, importAll } from './randomStore'`,
    body: `
addColorRange({ name: '莫兰迪偏暖', mode: 'rgb', c1Min: 180, c1Max: 220, c2Min: 150, c2Max: 190, c3Min: 130, c3Max: 170 })
const dump = JSON.parse(exportAll())
assert(Array.isArray(dump.colorRanges) && dump.colorRanges.some((r) => r.name === '莫兰迪偏暖'), '「导出全部」包含自定义颜色范围（此前遗漏）')
const res = importAll(dump)
assert(res.addedColorRanges === 0 || res.skippedColorRanges > 0, '同环境重复导入按名称+模式去重，不产生重复范围')
assert(res.invalidItems === 0, '合法导出文件没有非法条目')
`,
  },
]

const alias = {
  '@capacitor/core': STUB_CORE,
  '@capacitor/filesystem': STUB_FS,
}

// ---------- 构建并执行 ----------
let failed = 0
for (const s of scenarios) {
  const contents = [
    `import { assert } from ${JSON.stringify(ENV_PATH)}`,
    s.imports,
    s.body,
  ].join('\n')

  const outFile = path.join(OUT, `out-${s.name}.mjs`)
  try {
    const res = esb.buildSync({
      stdin: { contents, resolveDir: SRC, sourcefile: 'entry.ts', loader: 'ts' },
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      alias,
      write: false,
      logLevel: 'warning',
    })
    fs.writeFileSync(outFile, res.outputFiles[0].text)
  } catch (e) {
    console.error(`[${s.name}] 构建失败：${e && e.message ? e.message : e}`)
    failed++
    continue
  }

  console.log(`--- ${s.name} ---`)
  const r = spawnSync(process.execPath, [outFile], {
    env: { ...process.env, ...(s.env || {}), LM_SEED: JSON.stringify(s.seed) },
    stdio: 'inherit',
  })
  if (r.status !== 0) failed++
}

if (failed > 0) {
  console.error(`\n${failed}/${scenarios.length} 个场景失败`)
  process.exit(1)
}
console.log(`\n全部 ${scenarios.length} 个场景通过`)
