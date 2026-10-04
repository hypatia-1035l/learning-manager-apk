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
