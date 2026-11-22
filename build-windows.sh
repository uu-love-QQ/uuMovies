#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PKG_CONFIG_PATH="/home/ctyun/.local/sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:/home/ctyun/.local/sysroot/usr/share/pkgconfig:$PKG_CONFIG_PATH"
export LIBRARY_PATH="/home/ctyun/.local/sysroot/usr/lib/x86_64-linux-gnu:$LIBRARY_PATH"
export RUSTFLAGS="-L /home/ctyun/.local/sysroot/usr/lib/x86_64-linux-gnu"
export PATH="/home/ctyun/.local/bin:$PATH"

VERSION="$(node -p "require('$DIR/src-tauri/tauri.conf.json').version")"
SETUP_NAME="uuMovies_${VERSION}_x64_Setup.exe"
echo "=== 目标版本: v${VERSION} ==="

echo "=== 1. 构建前端生产资源 ==="
npm --prefix "$DIR" run build

echo "=== 2. 使用 MSVC 工具链构建 Windows 64位 Release 可执行文件 ==="
cd "$DIR/src-tauri"
cargo xwin build --release --target x86_64-pc-windows-msvc

echo "=== 3. 生成 Windows 安装引导向导程序 (NSIS Setup) ==="
mkdir -p "$DIR/dist-windows"
rm -f "$DIR/dist-windows/"uuMovies_*_x64_Setup.exe
cp "$DIR/src-tauri/target/x86_64-pc-windows-msvc/release/uumovies.exe" "$DIR/dist-windows/"

cd "$DIR/src-tauri/windows"
makensis -INPUTCHARSET UTF8 "-DPRODUCT_VERSION=${VERSION}" installer.nsi

echo "=== 4. 打包 Windows 压缩包与校验文件 ==="
cd "$DIR/dist-windows"
rm -f uumovies_windows_x64.zip
/home/ctyun/.local/usr/lib/7zip/7z a -y uumovies_windows_x64.zip uumovies.exe "$SETUP_NAME"
sha256sum uumovies.exe "$SETUP_NAME" > SHA256SUMS.txt

echo ""
echo "=== 构建完成！产物位于 dist-windows/ 目录 ==="
ls -lh "$DIR/dist-windows"
echo ""
echo "发布到 GitHub Releases 后，客户端即可自动检查并安装此版本："
echo "  安装包: dist-windows/${SETUP_NAME}"
echo "  校验值: dist-windows/SHA256SUMS.txt"
