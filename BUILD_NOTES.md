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
