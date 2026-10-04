# ============================================================
# setup-android.ps1  -  one-shot Android build env setup + release APK
# Run with [Administrator] PowerShell, in the project dir:  .\setup-android.ps1
# Prereq: JDK 17 active (cacerts SSL-fixed) + JDK 21 installed (auto-detected for Capacitor compile);
#         Android commandline-tools present (sdkmanager callable); project at an ASCII path.
# ============================================================

# NOTE: do NOT set $ErrorActionPreference = "Stop" here.
# Native build tools (java -version, gradlew, sdkmanager) write legitimately
# to stderr; under "Stop" PowerShell would treat that as a fatal NativeCommandError.

# ---------- 0. config ----------
# SDK goes to Android Studio's default location; local.properties must match.
$ANDROID_HOME = "C:\Users\Hypatia\AppData\Local\Android\Sdk"
# project root = directory where this script lives (avoids hardcoding any non-ASCII path)
$PRJ = Split-Path -Parent $MyInvocation.MyCommand.Definition

# ---------- 1. check JDK (17+ required; Capacitor 8.4 compiles its android lib with
#            target 21, so JDK 21 must ALSO be installed and is auto-detected by Gradle) ----------
# Keep JDK 17 active as the build launcher: its cacerts were SSL-fixed. Gradle will
# auto-detect the installed JDK 21 only for the Capacitor library compile (no network there).
$jv = (java -version 2>&1 | Select-String "version" | Select-Object -First 1)
if ($jv -notmatch "(17|18|19|2[0-9])\.") {
    Write-Host "[X] Java 17+ required. Keep JDK 17 active (its cacerts are SSL-fixed); install JDK 21 for Capacitor compile. Current: $jv" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] JDK ready: $jv" -ForegroundColor Green

# ---------- 2. env vars (machine level, needs admin) ----------
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $ANDROID_HOME, "Machine")
$bin = "$ANDROID_HOME\cmdline-tools\latest\bin"
$p = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($p -notlike "*$bin*") { [Environment]::SetEnvironmentVariable("Path", "$bin;$p", "Machine") }
$env:ANDROID_HOME = $ANDROID_HOME
$env:Path = "$bin;$env:ANDROID_HOME\platform-tools;$env:Path"
Write-Host "[OK] ANDROID_HOME = $ANDROID_HOME" -ForegroundColor Green

# ---------- 3. install SDK (direct from Google; machine can reach dl.google.com) ----------
Write-Host "==> Installing platform-tools / android-36 / build-tools 36 (from Google)" -ForegroundColor Cyan
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-36" "build-tools;36.0.0"
if ($LASTEXITCODE -ne 0) { Write-Host "[X] sdkmanager install failed" -ForegroundColor Red; exit 1 }

# ---------- 4. accept licenses ----------
Write-Host "==> Accepting SDK licenses" -ForegroundColor Cyan
(1..40 | ForEach-Object { 'y' }) | sdkmanager --sdk_root=$ANDROID_HOME --licenses

# ---------- 5. web build + sync to android ----------
Write-Host "==> npm install + build web + cap sync" -ForegroundColor Cyan
cd $PRJ
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "[X] npm install failed" -ForegroundColor Red; exit 1 }
npm run build:android
if ($LASTEXITCODE -ne 0) { Write-Host "[X] build:android failed" -ForegroundColor Red; exit 1 }

# ---------- 6. build release APK (keystore secrets entered interactively) ----------
cd android
$storePwd = Read-Host "Enter release.keystore store password"
$alias    = Read-Host "Enter key alias"
$keyPwd   = Read-Host "Enter key password"
$env:RELEASE_STORE_FILE     = "$PRJ\release.keystore"
$env:RELEASE_STORE_PASSWORD = $storePwd
$env:RELEASE_KEY_ALIAS      = $alias
$env:RELEASE_KEY_PASSWORD   = $keyPwd

Write-Host "==> gradlew assembleRelease" -ForegroundColor Cyan
.\gradlew assembleRelease
if ($LASTEXITCODE -ne 0) { Write-Host "[X] gradlew assembleRelease failed" -ForegroundColor Red; exit 1 }

Write-Host "==================================================" -ForegroundColor Green
Write-Host "Done! APK: android\app\build\outputs\apk\release\app-release.apk" -ForegroundColor Green
