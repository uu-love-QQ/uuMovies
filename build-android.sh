#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== 1. 构建 Android 应用 (Jetpack Compose) ==="
export ANDROID_HOME="${ANDROID_HOME:-/home/ctyun/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

VERSION="$(node -p "require('$DIR/src-tauri/tauri.conf.json').version" 2>/dev/null || echo "1.0.0")"
echo "=== 目标版本: v${VERSION} ==="

cd "$DIR/android"
./gradlew assembleRelease assembleDebug

cd "$DIR"
mkdir -p dist-android
cp android/app/build/outputs/apk/release/app-release.apk "dist-android/uuMovies_${VERSION}_release.apk"
cp android/app/build/outputs/apk/debug/app-debug.apk "dist-android/uuMovies_${VERSION}_debug.apk"
cp android/app/build/outputs/apk/release/app-release.apk dist-android/uuMovies_release.apk
cp android/app/build/outputs/apk/debug/app-debug.apk dist-android/uuMovies_debug.apk

cd dist-android
sha256sum "uuMovies_${VERSION}_release.apk" "uuMovies_${VERSION}_debug.apk" uuMovies_release.apk uuMovies_debug.apk > SHA256SUMS-android.txt
cd "$DIR"

echo "=== Android APK 构建完成! 产物位于 dist-android/ 目录 ==="
ls -lh dist-android/
