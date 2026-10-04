# 安卓构建说明（ relocated + JDK 21 修复）

## 工程已搬家
- 旧位置（含中文，aapt2 拒绝）：`H:\开发\今天摸啥鱼 随机与计时系统\`（仍保留，确认无误后可手动删除）
- **新位置（纯英文，已验证可出包）**：`H:\dev\learning-manager`

## 关键修复
1. **中文路径**：AGP/aapt2 不接受 `H:\开发\...` 中文路径。整目录搬到纯 ASCII 路径后解决（无需 `overridePathCheck`，但保留无害）。
2. **JDK 版本**：Capacitor 8.4 的安卓库要求 **target 21**，必须用 **JDK 21** 编译。
   - 已用 winget 安装 Temurin JDK 21：`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`
   - 构建以 **JDK 17 启动**（其 cacerts 已导入 Windows CA，SSL 正常），Gradle 自动探测到 JDK 21 仅用于 Capacitor 库编译（该步无网络）。
   - 保持 JDK 17 为活动 JDK即可，无需把 JAVA_HOME 切到 21（切到 21 会改用 JDK21 的 cacerts，届时需另行导入 Windows CA）。

## 已验证产出
- Debug 签名回退的 release 包（用于侧载/测试）：
  `android\app\build\outputs\apk\release\app-release.apk`

## 你自己出包（推荐方式）
在项目目录用管理员 PowerShell 运行：
```
powershell -ExecutionPolicy Bypass -File "H:\dev\learning-manager\setup-android.ps1"
```
脚本会：校验 JDK → 设 ANDROID_HOME → 装/校验 SDK → 同意许可 → npm 构建并 cap sync → 交互式询问 keystore 密码 → `gradlew assembleRelease`。

- **若要正式签名包**：运行脚本时在提示处填入你创建 `release.keystore` 时的 store 密码 / alias / key 密码（三者齐全才会用正式 keystore 签名；留空则回退 debug 签名）。
- **忘记 keystore 密码**：可用 `keytool` 新建一个 keystore，或在提示处直接回车（得 debug 签名包，可装可测，但不能上架）。

## 环境现状（确认清单）
- JDK 17（活动，cacerts 已修）→ `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot`
- JDK 21（已装，供 Capacitor 编译）→ `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`
- Android SDK → `C:\Users\Hypatia\AppData\Local\Android\Sdk`（android-36 / build-tools 36.0.0 / platform-tools）
- `android/local.properties` 的 `sdk.dir` 已指向上述 Studio SDK 路径
