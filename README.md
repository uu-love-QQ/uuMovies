# uuMovies - 多源聚合影视播放器

基于 **Tauri v2 + Rust (MSVC / Linux) + React 18 + TypeScript + Tailwind CSS** 构建的高性能跨平台桌面影视 App，完全兼容 **苹果 CMS (MacCMS v10 / v8) 采集规则与 API 标准**。

---

## 核心特性

### 1. 苹果 CMS 采集标准支持
- **双协议兼容**：支持标准 AppleCMS JSON API 接口（`?ac=videolist` / `?ac=detail`）及 RSS XML 采集格式，自动识别解析。
- **播放规则智能解析**：
  - 自动拆解多线路 `vod_play_from`（如 `lzm3u8$$$ffm3u8`）与 `vod_play_url`。
  - 智能解析分集名与播放链接（如 `第01集$https://...m3u8#第02集$https://...m3u8`）。
  - 自动映射线路标识为友好名称（如「量子线路」、「暴风线路」、「非凡线路」等）。

### 2. 多源管理与全网聚合搜索
- **内置优质源**：预设暴风、量子、红牛、索尼、天空、卧龙、非凡等高可用采集源。
- **采集源管理**：
  - 自由添加私有采集源（名称、URL、格式、分组）。
  - **一键全源测速**：并发测试所有采集源的连接延迟（ms）、分类数量及连通状态。
  - 采集源启用/停用开关、编辑、删除。
  - **配置导入/导出**：支持 JSON 格式备份与分享采集源清单。
- **全网聚合搜索**：
  - 支持单源精确搜索。
  - 支持**多源并发聚合搜索**，同时向所有已启用的采集源发起搜索并将结果自动聚合呈现。

### 3. 专业级播放器
- **HLS 极速播放**：集成 `Hls.js`，流畅播放 `.m3u8` 切片流与 MP4 直链。
- **完整交互控制**：
  - 播放/暂停（空格快捷键）、快进/快退（方向键左右）、音量调节（方向键上下）。
  - 多档倍速调节（0.5x、0.75x、1.0x、1.25x、1.5x、2.0x）。
  - 线路切换菜单（一键在不同资源站线路间平滑切换）。
  - 选集抽屉（支持正序/倒序排列与快速换集）。
  - 自动连播（剧集播放完毕后自动播放下一集）。
  - **断点续播**：自动记录播放进度，再次打开时提示并自动续播。

### 4. 观看历史与我的收藏
- 播放历史实时记录（剧集、观看百分比、时间戳）。
- 影视详情页一键加入/取消收藏。

---

## Windows MSVC 构建与安装程序

本项目已配置 **Windows MSVC (`x86_64-pc-windows-msvc`) 原生构建链** 与 **NSIS 安装引导向导**。

产物输出目录位于 `dist-windows/`：
- **安装向导程序**：`dist-windows/uuMovies_<版本>_x64_Setup.exe` (NSIS 安装包，具备安装路径选择、开始菜单与桌面快捷方式创建、完整控制面板卸载程序；自动更新会静默执行同一安装包)
- **便携独立程序**：`dist-windows/uumovies.exe` (Windows 64位独立 Release GUI 程序)
- **校验文件**：`dist-windows/SHA256SUMS.txt`

版本号唯一来源为 `src-tauri/tauri.conf.json` 的 `version` 字段，NSIS 安装包文件名由构建脚本自动带入。

一键重新构建 Windows 程序与安装向导：
```bash
./build-windows.sh
```

一键构建 Android APK (Release & Debug)：
```bash
./build-android.sh
```

---

## 检查更新与自动更新

桌面端内置了基于 **GitHub Releases** 的更新检查与静默自更新（仓库：`uu-love-QQ/uuMovies`）。

- **自动检查**：启动 3 秒后静默检查一次，此后每 6 小时检查一次（可在「设置 → 关于与更新」中关闭）。
- **双通道检查**：优先调用 GitHub REST API（可读取发布说明与资产 SHA-256）；若接口被限流（共享出口 IP 常见），自动回退到解析公开 Release 页面，保证检查可用。
- **一键更新**：发现新版本后右下角弹出更新卡片，显示版本号、更新说明与安装包大小；点击「立即更新」后：
  1. 下载安装包并按 GitHub 提供的 SHA-256 校验（无摘要时校验字节数）；
  2. 生成等待脚本，检测到 `uumovies.exe` 进程退出后静默执行 `Setup.exe /S`；
  3. 安装完成后自动重启新版应用。
- **非 Windows 平台**：仅提供版本检查，点击更新会打开 Release 页面手动下载。

### 发布新版本流程（GitHub Actions 自动发布）
1. 修改 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json` 中的版本号（例如 `0.1.2` → `0.1.3`）。
2. 提交后打标签并推送：
   ```bash
   git tag -a v0.1.3 -m "uuMovies v0.1.3"
   git push origin main v0.1.3
   ```
3. `.github/workflows/release.yml` 会自动并行执行：
   - **Windows** (`windows-latest`)：前端构建 → `cargo test` → MSVC Release 编译 → `makensis` 生成安装包 → 打包 zip 与 `SHA256SUMS.txt`。
   - **Android** (`ubuntu-latest`)：`gradlew test` 单元测试 → 编译 Release 与 Debug APK → 生成 `SHA256SUMS-android.txt`。
   - **发布**：整合 Windows 与 Android 产物创建 GitHub Release 并上传全部资产。
4. 旧版本客户端会在下一次检查时发现并自动静默升级。

补充说明：
- 已存在但尚未发布 Release 的标签（例如 `v0.1.1`），可在仓库 **Actions → Release → Run workflow** 中手动输入该标签补发。
- CI 产出的资产命名与本地 `./build-windows.sh`、`./build-android.sh` 完全一致：`uuMovies_<版本>_x64_Setup.exe`、`uumovies.exe`、`uumovies_windows_x64.zip`、`uuMovies_<版本>_release.apk`、`uuMovies_<版本>_debug.apk` 等。
- Workflow 会校验标签与 `tauri.conf.json` 版本是否一致，不一致直接失败，避免发布错误版本。

> 只有严格高于当前版本的标签才会触发更新，`v0.1.1-beta` 这类预发布标签不会被当作新版本。

---

## 运行与开发

### Linux 本地直接运行
```bash
./run.sh
```

### 开发模式
```bash
npm run dev
# 或配合 Tauri 调试：
npx @tauri-apps/cli dev
```

---

## 项目技术栈
- **桌面容器**：Tauri v2 (`tauri`, `wry`, `tao`, WebView2 on Windows)
- **后台核心**：Rust (`reqwest`, `quick-xml`, `tokio`, `serde`, `serde_json`, `dirs`)
- **前端框架**：React 18 + TypeScript + Vite + Tailwind CSS
- **流媒体播放**：Hls.js + HTML5 Video API
- **打包工具**：NSIS (Nullsoft Scriptable Install System) + MSVC xwin
- **更新机制**：GitHub Releases REST API + Release 页面备用通道 + SHA-256 校验 + 静默安装脚本
