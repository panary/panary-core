#!/usr/bin/env bash
# Baut die POS als Debug-APK (Capacitor) und installiert sie optional per adb.
#   bash tools/scripts/android-apk.sh build              Web-Build + cap sync + Gradle assembleDebug
#   bash tools/scripts/android-apk.sh install [serial]   APK per `adb -s <serial> install -r` (sonst ANDROID_SERIAL)
#   bash tools/scripts/android-apk.sh run [serial]       build + install
# Toolchain per Env (Defaults: Homebrew-Pfade): JAVA_HOME (JDK 21), ANDROID_HOME (SDK 36 + Build-Tools).
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
APK="$ROOT/apps/pos-client/android/app/build/outputs/apk/debug/app-debug.apk"

build() {
  pnpm nx build pos-client --configuration=development
  (cd apps/pos-client && pnpm exec cap sync android)
  (cd apps/pos-client/android && ./gradlew assembleDebug)
  echo "APK: $APK"
}

install_apk() {
  local serial="${1:-${ANDROID_SERIAL:-}}"
  [ -f "$APK" ] || { echo "Keine APK — erst 'build'." >&2; exit 1; }
  [ -n "$serial" ] || { echo "Zielgerät fehlt: Serial als Argument oder ANDROID_SERIAL setzen (adb devices)." >&2; exit 1; }
  adb -s "$serial" install -r "$APK"
}

case "${1:-}" in
  build) build ;;
  install) install_apk "${2:-}" ;;
  run) build && install_apk "${2:-}" ;;
  *) echo "Aufruf: $0 build|install [serial]|run [serial]" >&2; exit 1 ;;
esac
