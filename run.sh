#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PKG_CONFIG_PATH="/home/ctyun/.local/sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:/home/ctyun/.local/sysroot/usr/share/pkgconfig:$PKG_CONFIG_PATH"
export LIBRARY_PATH="/home/ctyun/.local/sysroot/usr/lib/x86_64-linux-gnu:$LIBRARY_PATH"
export RUSTFLAGS="-L /home/ctyun/.local/sysroot/usr/lib/x86_64-linux-gnu"

if [ -f "$DIR/src-tauri/target/debug/uumovies" ]; then
    echo "启动 uuMovies..."
    exec "$DIR/src-tauri/target/debug/uumovies" "$@"
elif [ -f "$DIR/src-tauri/target/debug/app" ]; then
    echo "启动 uuMovies..."
    exec "$DIR/src-tauri/target/debug/app" "$@"
else
    echo "未检测到可执行程序，开始编译构建..."
    cd "$DIR"
    npx @tauri-apps/cli build --debug --no-bundle
    exec "$DIR/src-tauri/target/debug/uumovies" "$@"
fi
