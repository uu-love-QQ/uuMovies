#!/bin/bash
set -e

echo "=== 1. 构建 Android 应用 (Jetpack Compose) ==="
export ANDROID_HOME="${ANDROID_HOME:-/home/ctyun/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

cd android
./gradlew assembleRelease assembleDebug

cd ..
mkdir -p dist-android
cp android/app/build/outputs/apk/release/app-release.apk dist-android/uuMovies_release.apk
cp android/app/build/outputs/apk/debug/app-debug.apk dist-android/uuMovies_debug.apk

echo "=== Android APK 构建完成! 产物位于 dist-android/ 目录 ==="
ls -lh dist-android/
