# 安卓构建说明（源码仓 + 纯 ASCII 构建区）

## 路径与构建位置（2026-10-27 修订）

- **源码仓（唯一真相）**：`M:\仓库\04_秋日造物\06_输出生成层\应用\今天摸啥鱼_learning-manager`
  路径含中文，**不在原地构建**（AGP / aapt2 不接受中文工程路径）。
- **构建工作区（纯 ASCII 镜像）**：`H:\dev\learning-manager-build`
  由 `scripts/build-apk.sh` 从源码仓镜像过去，构建完把 APK 与 `buildInfo.ts` 回填源码仓。
- 历史位置（已废弃，勿再用）：`H:\开发\今天摸啥鱼 随机与计时系统\`、`H:\dev\learning-manager`（两者均已不存在）。

> 为什么不能原地构建：aapt2 处理含中文的路径会直接报错。**不要**试图用 `overridePathCheck` 绕过 ——
> 拆成「源码仓 + 纯 ASCII 构建区」两层，两边职责清楚，也不用为了构建把仓库搬到 C/D 盘。

## 关键修复

1. **中文路径**：改为镜像构建 —— `scripts/build-apk.sh` 用 robocopy 把源码镜像到纯 ASCII 目录再 build（无需 `overridePathCheck`，但保留无害）。
2. **JDK 版本**：Capacitor 8.4 的安卓库要求 **target 21**，必须用 **JDK 21** 编译。
   - 已用 winget 安装 Temurin JDK 21：`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`
   - **必须用 JDK 21 启动 Gradle**：Capacitor 只写了 `sourceCompatibility JavaVersion.VERSION_21`、**没有声明 toolchain**，Gradle 就直接用「启动它的那个 JVM」编译；用 JDK 17 会报 `无效的源发行版：21`（`:capacitor-android:compileReleaseJavaWithJavac FAILED`）。
   - JDK 17 只作备用：万一 JDK 21 拉依赖时报 SSL（JDK 21 的 cacerts 未导入 Windows CA），可临时用 17 预热 Gradle 缓存，或往 JDK 21 的 cacerts 导入 CA。依赖已在 `~/.gradle` 缓存时，21 出包全程不需要联网。

## 已验证产出

- Debug 签名回退的 release 包（用于侧载/测试），构建完回填到源码仓根目录：
  `app-release.apk` / `app-release-<版本号>.apk`

## 出包（推荐方式）

在**源码仓根目录**用 Git Bash 运行：

```
bash scripts/build-apk.sh
```

脚本会依次：校验构建目录为纯 ASCII → robocopy 镜像源码（排除 `.git` / `node_modules` / `dist` / 各 build 产物）
→ 首次从源码仓镜像 `node_modules`（离线；源码仓也没有才退回 `npm ci`）、清空 cap 生成的
`android/capacitor-cordova-android-plugins` → 补齐 `android/local.properties` → `JAVA_HOME` 指向 JDK 21 →
`npm run build:android` → `gradlew assembleRelease` → 把 APK 与 `buildInfo.ts` 回填源码仓。

- 可选环境变量：`BUILD_DIR`（默认 `H:/dev/learning-manager-build`）、`JDK17`、`SKIP_SYNC=1`（只重跑构建不动镜像）。
- **若要正式签名包**：构建前把 `RELEASE_STORE_FILE` / `RELEASE_STORE_PASSWORD` / `RELEASE_KEY_ALIAS` /
  `RELEASE_KEY_PASSWORD` 四个环境变量设齐（见 `android/app/build.gradle` 的 `signingConfigs.release`）；
  四者不齐则自动回退 debug 签名（可装可测，但不能上架）。
- **忘记 keystore 密码**：可用 `keytool` 新建一个 keystore，或不设四件套（得 debug 签名包）。

## 环境现状（确认清单）

- JDK 17（备用；cacerts 已导入 Windows CA）→ `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot`
- JDK 21（**构建用**，脚本自动指向）→ `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`
- Android SDK → `C:\Users\Hypatia\AppData\Local\Android\Sdk`（android-36 / build-tools 36.0.0 / platform-tools）
- `android/local.properties` 的 `sdk.dir` 已指向上述 Studio SDK 路径（该文件不入库，镜像时从源码仓带过去，缺失则由脚本生成）

## 0.3.0（2026-10-23）起名模块

- 新增「起名」tab（随机工具箱第 5 个）：西幻八感 + 东方四感的人名/地名。
- 逻辑移植自 civ-atlas `src/gen/names/`（TS 原版，落在 `src/namegen/`），只补了
  `src/namegen/rng.ts`（Rng / mulberry32 / subSeed / fmix，取自 civ `src/gen/util.ts`，去 simplex 依赖）。
- **口径：Python 版（命名生成器_namegen）为准、是实验场；这里是有损快照**。模块冻结后才同步，
  改动时两边都要动，别让词库各改各的。
- 构建：`bash scripts/build-apk.sh`（约 1.5 分钟，debug 签名回退）。

## 0.4.0（2026-10-23）二期：魔法 / 风味 / 神话 / 世界卡

- 「起名」tab 从两档扩到六档：人名 / 地名 / 魔法(6 子项) / 风味(6 子项) / 神话(3 子项) / 世界卡。
- 新增 TS 移植（均移植自 namegen/*.py，Python 为准）：
  - `src/namegen/magic.ts`：咒语（意译 75% + 音译 25%，famous 拉丁+中文双层）/ 场所 / 法器 / 魔药 / 地牢 / 典籍
  - `src/namegen/flavor.ts`：称号 / 酒馆 / 街区 / 菜单 / 舰船 / 历法（成套 12 月）
  - `src/namegen/mythos.ts`：神祇 / 龙（拉丁黑名单）/ 怪物图鉴
  - `src/namegen/worldlet.ts`：世界卡（国号/君主/尊号/都城/守护神/神器/禁咒/龙/名店/历法，一卡一体系）
  - `src/namegen/compose.ts`：`personName()` 补「姓尾 ≠ 名首」守卫——civ 的 surname/given 是两个独立
    API，直拼会出「风风尧」；Python 版 xianxia.person() 本有该守卫，此处补回。
- `western.ts` 导出 `latinShapeOk`，供 magic / mythos 的音译支复用。
- 容量（esbuild 实测）：咒语 946 / 场所 572 / 法器 375 / 魔药 1197 / 地牢 251 / 典籍 196 /
  称号 420 / 酒馆 179 / 街区 138 / 菜单 133 / 舰船 54 / 神祇 1121 / 龙 1995 / 怪物 169。

## 0.5.0（2026-10-28）B1：越界管控三档 + 应用白名单收敛

数据结构 **schema 1 → 2**（`migrate.ts` 有完整迁移，旧数据自动升级）：

- `ReminderConfig.guardEnabled: boolean` → `guardLevel: 'off' | 'warn' | 'pull'`（旧 true 迁成 `'warn'`，不擅自升级成会拉回的 `'pull'`）。
- `ReminderConfig.guardGraceMinutes` → `guardGraceSeconds`（旧值 ×60，上限 600）。
- 新增 `AppData.globalAllowedApps`：全局白名单，所有方向共用；`Task.allowedApps` 语义改为**增量**。
  最终放行 = 自动放行 ∪ 全局白名单 ∪ 方向额外放行，**只做加法不做减法**（`store.resolveAllowedApps()` 单点计算）。
- **删除 `Task.blockedApps`**：黑名单与「默认禁止」语义重复。删前整体 dump 到
  `localStorage['learning-manager:data:v1-blocked-backup']`，只写一次、不覆盖。

原生（`StudyTimerService`）：

- 轮询间隔 `GUARD_POLL_MS 60s` → 按档位：off 不启动 / warn 15s / pull 3s。
- 新增 `buildAutoAllow()`：本 App、`systemui`、`android`、**桌面 launcher**、输入法、默认拨号。
  桌面必须放行，否则按 Home 键会被判越界并来回拉。
- 息屏不算离开：`PowerManager.isInteractive()` 为 false 时直接跳过。
- 判定只剩一档判据：前台是否在放行集合内；「分心名单」分支已移除。

界面：设置页「应用名单」→「应用白名单」（只管全局那一段 + 各方向额外放行的只读摘要）；
「越界提醒」→「越界管控」（三档分段，宽限改秒，拉回档灰着）；方向编辑页拆成「继承全局（只读）」+「额外放行」；
计时页**长按「结束」700ms → 确认 → 放弃本次计时**（紧急退出，不写记录）。

尚未做（登记在此，别当成已完成）：悬浮窗权限 + 真拉回（B3）、界面 §2 的 10 项与安全区滚动改造（B4）。

## 0.6.0（2026-10-28）B2：判定改 queryEvents + 判定日志

- **数据源替换**：`queryUsageStats(INTERVAL_BEST)` → `queryEvents(now-window, now)`，取最后一条
  `ACTIVITY_RESUMED`（API < 29 用 `MOVE_TO_FOREGROUND`）。聚合查询本身有分钟级延迟，
  3 秒轮询读到的还是几分钟前的排序，「离开 5 秒」根本立不住。
  同一包最后一条若是 `ACTIVITY_PAUSED` 且晚于 resumed，视为已退后台 → 返回 null，不计越界。
- **轮询统一 3 秒**（原先 warn 15s / pull 3s 不等）：宽限已经下沉到秒级，轮询比宽限粗的话，
  宽限这个参数就是假的（15 秒轮询下写 5 秒宽限，实际最早 15 秒才响）。
- **判定日志**：`SharedPreferences['guardLog']`，环形上限 200 条，只在两个时机写：
  `away`（本轮越界起点）/ `trigger`（真的发出了通知，受 5 分钟节流）。
  不每轮都写——3 秒一条会把日志变成噪声。
  `clearState()` 与 `clearPersistedState()` 现在**保留**这个键，否则一停表证据就没了。
- **接口**：插件新增 `getGuardLog()` / `clearGuardLog()`；JS 侧 `readGuardLog()` / `clearGuardLog()`。
  原生返回 JSON 字符串，字段形状由 JS 解析，原生不用跟着改。
- **界面**：越界管控弹层加「判定记录」，展开看最近 30 条（时间 / 应用 / 离开 或 已提醒 / 离开秒数），可清空。
  误报时把这块贴出来，比「好像老响」有用。

未做：悬浮窗 + 真拉回（B3）、界面 §2 十项与安全区滚动改造（B4）。

## 0.7.0（2026-10-28）B3：悬浮窗 + 真拉回 + 权限体检

- Manifest 新增 `SYSTEM_ALERT_WINDOW`：Android 10+ 只有持该权限的应用才有资格从后台
  `startActivity`，「拉回」全靠它。覆盖安装后请在体检区确认三项状态（授权本身会保留，但值得复一眼）。
- **新原生插件 `NativePermPlugin`（名 `NativePerm`）**，在 `MainActivity.onCreate` 注册：
  `check` / `openUsageAccess` / `openOverlay` / `openAppDetails` / `openAutoStart`。
  另提供两个静态方法给 Service 复用：
  - `hasUsageAccess()`：走 `AppOpsManager` 查 `OPSTR_GET_USAGE_STATS` 是否为 `MODE_ALLOWED`，
    比“猜 Settings 值”准；
  - `canDrawOverlays()`：`Settings.canDrawOverlays`。
- **真拉回**：`pull` 档 + 有悬浮窗权限 → `bringToFront()`
  （`NEW_TASK | SINGLE_TOP | REORDER_TO_FRONT`），**节流 10 秒**——不节流会每 3 秒抢一次屏，
  人在别的应用里连一个字都打不完。`startActivity` 抛异常（ROM 拦后台启动）时落到通知，不静默。
  拉回后下一轮看到前台是自己 → `firstOffListAt` 归零，不会自己拽自己。
- **权限体检**（越界管控弹层内）：使用情况访问 / 悬浮窗 / 厂商自启动三行，逐项状态 + 一键跳转。
  厂商自启动页是私有 Activity，依次试 MIUI / ColorOS / vivo / 华为 / 荣耀六个已知入口，
  **全打不开就退到应用详情页，不谎报「已开启」**（状态根本读不到）。切回前台自动重新检测。
- UI：强度里的「离开就拉回」**有权限才可点**，没权限时灰着并指向体检区——不给按了没反应的开关。
- 判定日志新增第三种判定 `pull`（已拉回），与 `away` / `trigger` 并列显示。
- `src/usageStats.ts` 顶部标注：权限判定统一走 `nativePerm.ts`，本文件保留给后续「统计页」
  （`queryTodayUsageStats` 是它唯一还没被取代的价值），避免同一件事两处实现各说各话。

未做：界面 §2 十项与安全区滚动改造（B4）。

## 0.8.0（2026-10-28）B4a：方向卡片 / 计划汇总 / 空状态 + 安全区收进容器

- **撤销完成**（顺手修的旧缺陷）：序列标记「已完成」后原本**没有任何回退入口**——`更多`里只在
  `!completed` 时给「完成」按钮，点错了只能删掉重建、进度全丢。新增 `store.uncompleteObject()`：
  翻回 `completed: false` 并**重算 `Task.status`**（只改序列会留下「序列未完成、方向已完成」的不一致）。
- **方向卡片**
  - 四个排序箭头从常驻改为「排序模式」才出现（工具栏 `排序` 按钮）。常驻时 `.tc-reorder` 是竖排
    4 个 `28×22` + `gap:4` ＝ **100px**，卡片被顶到 100px 以上，信息反被挤掉。
  - 复选框旁加文字「参与计划」——原来只有 `title="启用 / 停用"`，看不出这个勾管的是什么。
  - 名称前加标识色圆点：`task.id` 稳定哈希取 6 色盘，不加字段、不用随机数。
  - 数量型进度加 4px 进度条 + `120/1000 条`；位置型（「卷八十九」）没有分母，不画。
- **计划页**：顶部加汇总行 `今日 2/7 · 预计 1 小时 10 分`（由 `status` 与 `durationSec` 直接算，无新字段）。
- **空状态**改成入口：方向页「+ 添加第一个方向」，计划页「新建今日计划」。
- **安全区**
  - `env(safe-area-inset-*)` 共 10 处 → `var(--safe-area-inset-*, env(...))` 降级链：
    Capacitor 8 的 `SystemBars` 注入前一组变量，WebView ≥140 走 `env()` 直通，更老的由原生补 padding。
  - **结构性改动已回退（见 0.8.1）**：曾把 body 改成 `overflow:hidden` 并把滚动交给页面容器
    （`.app.app-shell{height:100%}` + `.app:not(.app-shell){overflow-y:auto}`）。
    结果**所有靠整页滚动的页面（设置 / 统计 / 应用白名单）直接划不动** ——
    这些页面根元素是 `.pool-compact`，里面并没有滚动容器，只是内容高过一屏，原本全靠文档滚动。
    教训：动滚动模型之前必须逐页确认「这一页有没有自己的 overflow 容器」，不能全局一刀切。

未做（B4b，已登记）：序列表单弹层化（新增/编辑共用、删 inline-edit 与悬空序号）、
一行录入实时解析 + 预览、记住上次单位/时长、进度节点生成器、方向模板。

## 0.8.1（2026-10-30）修复：设置 / 统计页划不动

- **回退** 0.8.0 的滚动结构改动（`body{overflow:hidden}` 及两条配套规则）。
  原因：`Settings`、`StatsView`、`AppListSettings` 的根元素都是 `.pool-compact`，
  内部**没有** `.pool-scroll`，内容高过一屏时靠的是文档滚动；body 一禁滚，这些页面全部卡死。
  只有 `TaskPool` / `RandomToolbox` 用了 `.inner-tab-swiper` + `.pool-scroll` 的页内滚动模型。
- **保留** `env()` → `var(--safe-area-inset-*, env(...))` 降级链：纯增益，不碰滚动模型。
- 顺带修：`main.css` 行尾归一为 CRLF（此前用 shell 追加样式带进了 83 行裸 LF）。
- 「滚动时标签顶进状态栏」**仍未解决**。正确做法是逐页给内容区包一层滚动容器（照 `.inner-tab-swiper`
  那套），属于 B4b 的独立改动，不再用全局改滚动模型的方式做。

> 教训（写在这里免得下次再犯）：任何全局性的 `overflow` / `height` 改动，先列出「哪些页面有自己的滚动容器」，
> 只改有容器的那批，或者先给没有容器的页面补上容器，再谈全局。

## 0.9.0（2026-10-30）B4b：序列表单弹层化 + 一行录入 + 记住上次 + 节点生成器 + 方向模板

- **新增 `SequenceSheet`**（底部弹层）：新增与编辑共用同一份字段，一次只编辑一个。
  列表里删掉了常驻的新增区和行内编辑（`inline-edit`）——两者样式雷同且上下堆叠，
  用户分不清「现在改的是哪一个」；内联还会把 `.obj-item` 撑高，而它是 `align-items:center`，
  序号被垂直居中，看着像飘在表单外面。**序号悬空的问题随 inline-edit 一起消失**。
- **字段折叠**：默认只露「名称 + 时长（5/15/25/45 快捷 + 自定义）」；
  单位 / 目标 / 当前进度 / 进度节点收进「更多」，默认收起。
- **一行录入**：新增模式顶部一个输入框，粘「卷三 80 篇 25」即时解析成各字段并显示预览 chips。
  复用 bulk 的 `parseSeqBlock`，所以「一行」与「批量」是同一套语法，不用记两遍。
  识别到多条时不擅自拆分，提示改用批量。
- **记住上次**：`src/seqDefaults.ts`，`localStorage['learning-manager:last-seq-defaults']`。
  保存成功即写入 unit + countdownMin，新建时预填；批量导入缺省参数也取这一份。
  放 localStorage 而不是 AppData：这是输入习惯，不该进备份/迁移。
- **进度节点生成器**（`ProgressNodesEditor` 内）：步长 + 上限（默认取目标）+ 前缀 + 后缀 + 中文数字开关，
  按步长铺刻度（例：步长 10、前缀「第」、后缀「章」→ `10 第十章`）。上限 100 条，防塞几千行进存储。
- **方向模板**（`TaskForm`）：阅读 / 语言 / 绘画 / 建模 四个 chips，只预填 单位 + 目标 + 时长，可改。
- **连续添加**：弹层底部多一个「保存并继续添加」，清名称、留单位与时长，录入一长串时不用反复开关。

滚动模型**未动**（0.8.0 的教训）。「滚动时标签顶进状态栏」仍需逐页补滚动容器，见下表。

| 视图 | 根元素 | 自有滚动容器 | 备注 |
|---|---|---|---|
| `TaskPool` | `.pool-compact` | ✅ `.inner-tab-swiper` + `.pool-scroll` | 安全 |
| `RandomToolbox` | `.pool-compact` | ✅ 同上 | 安全 |
| `Settings` | `.pool-compact` | ❌ 靠文档滚动 | **不能全局禁滚** |
| `StatsView` | 无 `.pool-compact` | ❌ 靠文档滚动 | 同上 |
| `AppListSettings` | `.pool-compact` | ❌ 靠文档滚动 | 同上 |
| `TaskDetail` | `.app`（非 shell） | ❌ 靠文档滚动 | 状态栏问题就出在这里 |

> 要解决状态栏问题，得先给后四行补上滚动容器（照 `.inner-tab-swiper` + `.pool-scroll` 那套），
> 再逐页验收，不要一次全局改。

## 0.9.1（2026-11-01）B4c：状态栏隔离带（不改滚动模型）

原本打算逐页补滚动容器，实际读代码后换了做法——原因和做法都记在这里，免得下次又绕回来。

**为什么不用「逐页补容器」**：`.shell-main` 不是 flex 容器、`.pool-compact` 的 `flex:1` 在这里不生效，
所以 `.inner-tab-swiper{height:100%}` 实际也拿不到确定高度——**全站其实都靠文档滚动**，
所谓「页内滚动」只是看起来像。要让某页真正内部滚动，就得同时改
`body / .app-shell / .shell-main / .pool-compact` 的 height 链，正是 0.8.0 翻车的那条路。

**改成两层隔离，都不碰滚动模型**：

1. `body::before`：在状态栏高度画一条与页面同色（`var(--bg)`）的不透明带，滚上去的内容被盖住。
   `position: fixed` + `z-index: 15`（高于 sticky 头部 10 与普通内容，低于 tabbar 50 / 会话遮罩 60 / 弹层 70）。
2. `.shell-header`：原本 `sticky top: 0`，吸顶时顶端正好落在状态栏里；改为
   `top: var(--safe-area-inset-top, env(...))`，吸附在隔离带下方。
   只有第 1 层没有第 2 层的话，头部会嵌在带子下面被切掉一截。

**为什么不会重演 0.8.0**：这次没有一条规则改 `overflow` / `height`，滚动依旧由文档完成；
Web 预览或无刘海设备上 `--safe-area-inset-top` 为 0，带子高度 0、sticky 仍在 0，**效果与改动前完全一致**。

**与 Capacitor 两条分支的关系**（重要，别改坏）：
- WebView ≥ 140：`SystemBars` 走 passthrough，`--safe-area-inset-*` 是真值，`env()` 也生效 → 带子与 body padding 同时起作用。
- WebView < 140：`SystemBars` 给 WebView 父视图设 padding，且注入的变量被置 0 → 带子高度 0、body padding 0，
  间距由原生负责，不会出现「双份间距」。

## 0.9.2（2026-11-01）备份导入的三处硬缺陷 + 日期边界回归用例

**先纠正我上一轮的两处误判**（查了代码才发现的，写在前面免得下次又照着错的去做）：
- `StatsView` **不是**「只有饼图」：它已有按方向汇总、7/30 天趋势、最近 15 条记录、连续天数。
- 日桶边界**已经**是对的：`startOfDayOffset` 用 `setDate` 取本地 0 点而不是减 `86400000`，
  注释里也写了夏令时那天只有 23/25 小时。缺的不是修逻辑，是**没有用例守住它**。

**备份导入的真缺陷（都在 `dataBackup.ts`）**

| # | 缺陷 | 后果 | 修法 |
|---|---|---|---|
| A | 备份缺 `learning-manager:data:v1` 时仍可通过校验 | `importBackup` 先清空**所有**持久键、再只写备份里有的键 → **学习记录被整体清空，且补不回来**，还提示导入成功 | `validateBackup` 把主数据列为必备，缺则拒绝并说明原因 |
| B | 不校验 `backup.version` | 导入更新版本 App 导出的备份，未知字段被静默丢弃 | `version > EXPORT_VERSION` 直接拒绝，提示升级 App |
| C | `data:v1-blocked-backup`（v1→v2 迁移存档）随备份导出 | 旧黑名单在每个备份里反复传播 | 新增 `LOCAL_ONLY_KEYS` + `isBackupParticipant()`：既不导出，也不在导入时删除 |

另外：`validateBackup` 新增 `warnings`（可导入但需知情），目前覆盖「备份不含词库，导入后现有词库会被清空」；
`DataBackup.tsx` 在确认前用 notice 块展示；`KEY_LABELS` 补了 `last-seq-defaults` 与迁移存档两条。

**回归用例（`npm run verify`，18 → 22 场景，全通过）**
- `19-backup-rejects-missing-main-data`：缺主数据被拒；含主数据通过；缺词库给 1 条提醒。
- `20-backup-rejects-future-version`：`version: 99` 被拒，错误信息含版本号与「升级」。
- `21-backup-skips-local-archive`：迁移存档不进入备份，主数据与词库正常导出。
- `22-stats-daily-bucket-boundary`：今天 0 点整 / 昨天最后一毫秒 / 昨天 0 点分别落对桶；连续天数 2。
  **故意用 `env: { TZ: 'America/New_York' }` 跑**——哪天有人把 `setDate` 换回减 `86400000`，这个场景就会红。

## 0.9.3（2026-11-01）隔离带在弹层下透出横带的修正

0.9.1 的 `body::before` 隔离带压在 `.modal-overlay`（`rgba(40,32,22,.45)` 半透明遮罩）之下，
遮罩顶部会透出一条更亮的横带，看着像「顶部多了个色块」。修法：

```css
body:has(.modal-overlay)::before,
body:has(.session-overlay)::before { height: 0; }
```

- 弹层 / 学习会话打开时把带子收掉：这两者自己铺满全屏，不需要带子
  （会话遮罩本来是不透明渐变，收掉不影响）。
- `:has()` 需 Chromium 105+；更老的 WebView 会忽略本段，最多留一条浅带，不影响功能。

**关于隔离带本身的定位（保留理由，记在这里免得以后反复）**：它是「遮盖」而不是「根治」。
根治要让内容根本不进入状态栏区域，即每页自带滚动容器；但本项目全站都靠文档滚动
（`.shell-main` 非 flex、`.pool-compact` 的 `flex:1` 不生效、`.inner-tab-swiper{height:100%}` 取空高度），
要做就得动 `body / .app-shell / .shell-main / .pool-compact` 的 height 链 —— 0.8.0 翻车的同一条路。
在不动滚动模型的前提下，画同色带盖住是唯一可行解，故保留。

## 0.9.4（2026-11-01）重构后的术语与说明收口

B1–B4 把「黑名单 / 分心名单 / 越界提醒 / 应用名单」换掉了，但注释与帮助页还有旧说法。
用户可见文案其实已经统一（扫描确认），这次修的是**会误导后续维护的注释**和**缺整段的功能说明**：

**注释订正（4 处，都是「按旧模型写、读起来会带错路」的）**
| 位置 | 旧说法 | 问题 |
|---|---|---|
| `types.ts` appPool 注释 | 「允许/分心全部存在 Task 上」 | `blockedApps` 已删，残句会让人以为还有第二个名单 |
| `migrate.ts` sanitizePackageList | 「方向应用名单 / 默认全部禁止」 | 语义已改为「全局之外的增量放行」 |
| `LearningSession.tsx` | 「允许的应用」 | 实为「全局白名单 ∪ 额外放行」 |
| `Settings.tsx` 顶部 | 「应用名单子页 / 越界提醒设置弹窗」 | 子页与弹层都已改名 |

**帮助页补两段**
- **新增「越界管控」整段**（此前完全没有说明）：三档、宽限秒、拉回需悬浮窗、判定记录怎么读、
  权限体检三项、长按结束紧急退出。
- **重写「内容序列」段**：原文还停留在「序列名 / 单位 / 目标 / 倒计时：添加一条序列时的参数」，
  现已改为弹层 + 一行录入 + 记住上次 + 节点自动生成 + 完成可撤销。

`tsc` 通过，`npm run verify` 22 场景全通过（本次无逻辑改动，跑一遍防手滑）。


## 0.9.5（2026-11-01）移动端设计令牌层

新增 `src/styles/design-tokens.css`（563 行），对应设计稿「今天摸啥鱼 · 移动端界面设计」
（18 屏 + 4 块规范/说明板，画布 https://ardot.tencent.com/file/742656878555437）。

- **只增不改**：全部 `--m-*` / `.m-*` 前缀，不覆盖 `main.css` 里任何既有变量或类；
  不碰 `overflow` / `height` 链，滚动仍由文档承担（0.8.0 的教训）。
- **令牌**：间距（4 基数）、圆角 6 档、字号 7 档、行高、页面边距、安全区、
  状态栏 62 / 药丸 62 / 距底 21、内容区底部预留、触控 44、层级 6 档、暖调阴影 3 种、动效。
- **组件**：卡片（`--now` 进行中）、进度条（宽度走 `--m-bar-fill`，由 CSS 过渡）、
  chip 三态、分段控件、按钮三态、表单与输入、开关（`::after` 做拨杆，省一个 DOM 节点）、
  药丸 TabBar、遮罩 / 底部弹层 / 模态、空状态、状态点。
- **断点**：`≤360` 只收边距（20→16）不缩字号，宁可换行；`≥431` 整壳限宽 560 居中；
  `prefers-reduced-motion` 关动效。
- **main.css**：把 `.m-mask` / `.m-sheet` 并入 0.9.3「弹层打开时收掉状态栏隔离带」那条选择器列表。
  不并进去，令牌层的弹层顶部会露一条比遮罩更亮的横带——与 0.9.3 修的是同一个现象。
- **行尾**：`design-tokens.css` 全 CRLF、无 BOM，与 `main.css` 一致（本项目 CSS 不加 BOM）。

验收：`npm run verify` 22/22 通过；`tsc -b` 通过；`vite build` 成功（CSS 52.65 kB / gzip 10.45 kB）。
拆包复验：`assets/public/assets/index-*.css` 52648 B，含 `--m-page-x` / `.m-tabbar` / `.m-sheet` /
`:has(.m-mask)` / `--m-bar-fill` 五项。APK 1.90 MB，debug 签名回退。
