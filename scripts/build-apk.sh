#!/usr/bin/env bash
# 在纯 ASCII 路径下构建 release APK。
#
# 为什么要有这个脚本：AGP / aapt2 不接受含中文的工程路径，而源码仓落在
# M:\仓库\04_秋日造物\... 这种全中文路径上。于是构建不在原地做，而是：
#   源码仓（唯一真相，可以是中文路径）
#     --robocopy 镜像--> 纯 ASCII 构建目录
#     --npm build:android + gradlew assembleRelease--> APK
#     --回填--> 源码仓根目录的 app-release*.apk（+ src/buildInfo.ts）
#
# 用法（Git Bash，在源码仓根目录）：
#   bash scripts/build-apk.sh
# 可选环境变量：
#   BUILD_DIR   构建目录，默认 H:/dev/learning-manager-build（必须是纯 ASCII）
#   JDK17       启动 Gradle 用的 JDK 17 目录
#   SKIP_SYNC=1 跳过镜像（只重跑构建，适合改完 mirror 内的东西再打一次）
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-H:/dev/learning-manager-build}"
JDK17="${JDK17:-C:/Program Files/Eclipse Adoptium/jdk-17.0.20.8-hotspot}"

win() { printf '%s' "$1" | sed 's|/|\\|g'; }

say() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0. 前置校验 ----------
[ -f "$REPO/package.json" ] || die "源码仓根目录异常：$REPO 下没有 package.json"
[ -d "$REPO/android" ] || die "源码仓缺少 android/ 目录"

# 构建目录必须是纯 ASCII，否则白折腾一趟
NON_ASCII="$(printf '%s' "$BUILD_DIR" | LC_ALL=C tr -d '\000-\177' | wc -c)"
[ "$NON_ASCII" -eq 0 ] || die "BUILD_DIR 含非 ASCII 字符，aapt2 会拒绝：$BUILD_DIR"

# JDK 17：活动 JDK。Capacitor 8.4 的库要 21 编译，但 Gradle 用 17 启动
# （17 的 cacerts 已导入 Windows CA，拉依赖不报 SSL；21 的没导）
[ -x "$JDK17/bin/java" ] || die "找不到 JDK 17：$JDK17（用 JDK17=... 指定）"

VER="$(node -p "require('$REPO/package.json').version")"
say "源码仓 $REPO"
say "构建区 $BUILD_DIR（版本 $VER）"

# ---------- 1. 镜像源码 ----------
if [ "${SKIP_SYNC:-0}" = "1" ] && [ -d "$BUILD_DIR/src" ]; then
  say "SKIP_SYNC=1，跳过镜像"
else
  say "镜像源码 → $BUILD_DIR"
  mkdir -p "$BUILD_DIR"

  SRC_W="$(win "$REPO")"
  DST_W="$(win "$BUILD_DIR")"

  # 排除：版本库、产物、以及会拖慢镜像的 node_modules（单独同步，见步骤 2）
  set +e
  robocopy "$SRC_W" "$DST_W" /E /NFL /NDL /NJH /NJS /NP \
    /XD "$SRC_W\\.git" "$SRC_W\\node_modules" "$SRC_W\\dist" \
        "$SRC_W\\android\\app\\build" "$SRC_W\\android\\.gradle" \
        "$SRC_W\\android\\build" "$SRC_W\\android\\captures" \
        "$SRC_W\\build" \
    /XF "*.apk" "*.aab" "*.tsbuildinfo" > /dev/null
  RC=$?
  set -e
  # robocopy 的 0-7 都是成功（1=有文件被拷），≥8 才是真失败
  [ "$RC" -lt 8 ] || die "robocopy 失败，退出码 $RC"
fi

# ---------- 2. 依赖：首次装一次，之后复用 ----------
if [ ! -d "$BUILD_DIR/node_modules" ]; then
  say "首次构建：装依赖（npm ci）"
  ( cd "$BUILD_DIR" && npm ci )
else
  say "复用已有 node_modules"
fi

# local.properties 被 .gitignore 排除，但 Gradle 必须要，缺了就补
if [ ! -f "$BUILD_DIR/android/local.properties" ]; then
  say "补 android/local.properties（sdk.dir）"
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-C:/Users/Hypatia/AppData/Local/Android/Sdk}}"
  [ -d "$SDK" ] || die "找不到 Android SDK：$SDK（设 ANDROID_HOME 后重试）"
  printf 'sdk.dir=%s\n' "$SDK" > "$BUILD_DIR/android/local.properties"
fi

# ---------- 3. Web 侧构建 + cap sync ----------
export JAVA_HOME="$JDK17"
export PATH="$JAVA_HOME/bin:$PATH"
say "JDK: $(java -version 2>&1 | head -1)"

say "npm run build:android（tsc + vite build + cap sync）"
( cd "$BUILD_DIR" && npm run build:android )

# ---------- 4. Gradle 出包 ----------
say "gradlew assembleRelease"
# 用 gradlew.bat：工作区里的 gradlew（shell 版）在 Windows 上是 CRLF，bash 直接跑会报 $'\r'
( cd "$BUILD_DIR/android" && cmd //c gradlew.bat assembleRelease --console=plain )

APK_SRC="$BUILD_DIR/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK_SRC" ] || die "没找到产物：$APK_SRC"

# ---------- 5. 回填源码仓 ----------
say "回填产物到源码仓"
cp -f "$APK_SRC" "$REPO/app-release.apk"
cp -f "$APK_SRC" "$REPO/app-release-$VER.apk"
# 构建时间由 prebuild 写进 buildInfo.ts，回填后 App 内「设置 → 版本信息」才与这枚包一致
if ! diff -q "$BUILD_DIR/src/buildInfo.ts" "$REPO/src/buildInfo.ts" > /dev/null 2>&1; then
  cp -f "$BUILD_DIR/src/buildInfo.ts" "$REPO/src/buildInfo.ts"
  echo "  buildInfo.ts 已回填（记得连同源码一起提交）"
fi

say "完成"
node -e '
const fs = require("fs");
for (const f of process.argv.slice(1)) {
  const s = fs.statSync(f);
  console.log(`  ${f}  ${(s.size / 1048576).toFixed(2)} MB`);
}
' "$REPO/app-release.apk" "$REPO/app-release-$VER.apk"
