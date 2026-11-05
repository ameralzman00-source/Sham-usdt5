#!/bin/bash
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-/tmp/gradle-home}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
cd "$ROOT/.."
npm run build
npx cap sync android
cd "$ROOT"
./gradlew :app:assembleRelease :app:assembleDebug --no-daemon
mkdir -p ../../releases
cp app/build/outputs/apk/release/app-release.apk ../../releases/usdt-sham.apk
cp app/build/outputs/apk/debug/app-debug.apk ../../releases/usdt-sham-debug.apk
echo "APK: releases/usdt-sham.apk"
