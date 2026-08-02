#!/usr/bin/env node
// prebuild: 写死具体版本 + 构建时间到 src/buildInfo.ts
const fs = require('fs')
const path = require('path')
const pkg = require('../package.json')

const pad = (n) => String(n).padStart(2, '0')
const sh = new Date()
const cn = new Date(sh.getTime() + 8 * 3600 * 1000) // 东八
const t = `${cn.getUTCFullYear()}-${pad(cn.getUTCMonth() + 1)}-${pad(cn.getUTCDate())} ${pad(cn.getUTCHours())}:${pad(cn.getUTCMinutes())}`

const out = path.resolve(__dirname, '..', 'src', 'buildInfo.ts')
const content =
`// 由 scripts/writeBuildInfo.js 预构建自动生成；请勿手工修改
export const BUILD_VERSION = '${pkg.version}'
export const BUILD_TIME = '${t}'
`
fs.writeFileSync(out, content, 'utf-8')
console.log('[writeBuildInfo]', `${pkg.version} / ${t}`)
