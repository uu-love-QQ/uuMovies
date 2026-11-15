//! GitHub Releases based update checker and silent self-installer.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

pub const REPO_OWNER: &str = "uu-love-QQ";
pub const REPO_NAME: &str = "uuMovies";
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

const USER_AGENT: &str = concat!("uuMovies-Updater/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub tag: String,
    pub name: String,
    pub notes: String,
    pub published_at: String,
    pub html_url: String,
    pub download_url: Option<String>,
    pub download_name: Option<String>,
    pub download_size: u64,
    pub sha256: Option<String>,
    pub install_supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum UpdateEvent {
    #[serde(rename = "progress")]
    Progress { downloaded: u64, total: u64 },
    #[serde(rename = "verifying")]
    Verifying,
    #[serde(rename = "installing")]
    Installing,
    #[serde(rename = "done")]
    Done,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    #[serde(default)]
    name: String,
    #[serde(default)]
    browser_download_url: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    digest: Option<String>,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("网络客户端初始化失败: {e}"))
}

fn normalize_version(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    trimmed
        .split(['-', '+'])
        .next()
        .unwrap_or(trimmed)
        .to_string()
}

fn version_parts(raw: &str) -> Vec<u64> {
    normalize_version(raw)
        .split('.')
        .map(|p| {
            p.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let a = version_parts(latest);
    let b = version_parts(current);
    for idx in 0..a.len().max(b.len()) {
        let lhs = a.get(idx).copied().unwrap_or(0);
        let rhs = b.get(idx).copied().unwrap_or(0);
        if lhs != rhs {
            return lhs > rhs;
        }
    }
    false
}

fn pick_asset<'a>(assets: &'a [GitHubAsset]) -> Option<&'a GitHubAsset> {
    let is_exe = |a: &&GitHubAsset| a.name.to_lowercase().ends_with(".exe");
    let is_setup = |a: &&GitHubAsset| {
        let name = a.name.to_lowercase();
        name.ends_with(".exe") && name.contains("setup")
    };
    assets
        .iter()
        .find(is_setup)
        .or_else(|| assets.iter().find(is_exe))
        .filter(|a| !a.browser_download_url.is_empty())
}

fn sha256_digest(asset: &GitHubAsset) -> Option<String> {
    asset
        .digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
}

pub async fn check() -> Result<UpdateInfo, String> {
    let client = http_client()?;
    match check_via_api(&client).await {
        Ok(info) => Ok(info),
        Err(api_error) => match check_via_html(&client).await {
            Ok(info) => Ok(info),
            Err(fallback_error) => {
                if api_error.contains("还没有发布") {
                    Err(api_error)
                } else {
                    Err(format!("{api_error}（备用通道: {fallback_error}）"))
                }
            }
        },
    }
}

async fn check_via_api(client: &reqwest::Client) -> Result<UpdateInfo, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        REPO_OWNER, REPO_NAME
    );
    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("检查更新失败: 无法连接 GitHub ({e})"))?;

    let status = response.status();
    if status.as_u16() == 404 {
        return Err("检查更新失败: 仓库还没有发布任何版本".to_string());
    }
    if status.as_u16() == 403 || status.as_u16() == 429 {
        return Err(format!(
            "检查更新失败: GitHub 接口访问受限 (HTTP {status})"
        ));
    }
    if !status.is_success() {
        return Err(format!("检查更新失败: GitHub 返回 HTTP {status}"));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("检查更新失败: 版本信息解析错误 ({e})"))?;

    if release.tag_name.is_empty() {
        return Err("检查更新失败: 发布版本缺少标签名".to_string());
    }

    let latest_version = normalize_version(&release.tag_name);
    let available = is_newer(&latest_version, CURRENT_VERSION);
    let asset = pick_asset(&release.assets);

    let html_url = if release.html_url.is_empty() {
        release_page_url()
    } else {
        release.html_url.clone()
    };

    let display_name = release
        .name
        .clone()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| release.tag_name.clone());

    Ok(UpdateInfo {
        available,
        current_version: CURRENT_VERSION.to_string(),
        latest_version,
        tag: release.tag_name,
        name: display_name,
        notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        html_url,
        download_url: asset.map(|a| a.browser_download_url.clone()),
        download_name: asset.map(|a| a.name.clone()),
        download_size: asset.map(|a| a.size).unwrap_or(0),
        sha256: asset.and_then(sha256_digest),
        install_supported: cfg!(target_os = "windows"),
    })
}

fn release_page_url() -> String {
    format!("https://github.com/{}/{}/releases", REPO_OWNER, REPO_NAME)
}

/// Fallback used when the GitHub REST API is rate limited (common behind
/// shared NAT / CI networks). Uses the public web UI endpoints, which are not
/// subject to API quotas: `/releases/latest` resolves the newest tag and
/// `/releases/expanded_assets/<tag>` lists the downloadable assets.
async fn check_via_html(client: &reqwest::Client) -> Result<UpdateInfo, String> {
    let release_url = format!(
        "https://github.com/{}/{}/releases/latest",
        REPO_OWNER, REPO_NAME
    );
    let response = client
        .get(&release_url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("无法访问发布页面 ({e})"))?;
    if !response.status().is_success() {
        return Err(format!("发布页面返回 HTTP {}", response.status()));
    }
    let final_url = response.url().to_string();
    let tag = parse_release_tag(&final_url)
        .ok_or_else(|| "仓库还没有发布任何版本".to_string())?;
    let latest_version = normalize_version(&tag);
    if !latest_version.chars().any(|c| c.is_ascii_digit()) {
        return Err("发布页面版本号无法识别".to_string());
    }

    let assets_url = format!(
        "https://github.com/{}/{}/releases/expanded_assets/{}",
        REPO_OWNER, REPO_NAME, tag
    );
    let assets_response = client
        .get(&assets_url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("无法读取发布资产列表 ({e})"))?;
    if !assets_response.status().is_success() {
        return Err(format!(
            "发布资产列表返回 HTTP {}",
            assets_response.status()
        ));
    }
    let assets_html = assets_response
        .text()
        .await
        .map_err(|e| format!("发布资产列表读取失败 ({e})"))?;
    let (asset_name, download_url) = parse_assets_page(&assets_html)
        .ok_or_else(|| "该版本没有可供下载的安装包".to_string())?;

    Ok(UpdateInfo {
        available: is_newer(&latest_version, CURRENT_VERSION),
        current_version: CURRENT_VERSION.to_string(),
        latest_version,
        tag: tag.clone(),
        name: tag,
        notes: String::new(),
        published_at: String::new(),
        html_url: final_url,
        download_url: Some(download_url),
        download_name: Some(asset_name),
        download_size: 0,
        sha256: None,
        install_supported: cfg!(target_os = "windows"),
    })
}

fn parse_release_tag(final_url: &str) -> Option<String> {
    let tag = final_url
        .split("/releases/tag/")
        .nth(1)?
        .split(['?', '#'])
        .next()?
        .trim_end_matches('/')
        .to_string();
    if tag.is_empty() || tag == "latest" {
        return None;
    }
    Some(tag)
}

fn parse_assets_page(html: &str) -> Option<(String, String)> {
    let pattern = format!(
        r#"(/{owner}/{repo}/releases/download/[^/"\s]+/([^"?#\s]+\.exe))"#,
        owner = REPO_OWNER,
        repo = REPO_NAME
    );
    let re = regex::Regex::new(&pattern).ok()?;
    let mut candidates: Vec<(String, String)> = re
        .captures_iter(html)
        .map(|cap| {
            let path = cap
                .get(1)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            let name = cap
                .get(2)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            (name, path)
        })
        .filter(|(name, path)| !name.is_empty() && !path.is_empty())
        .collect();

    candidates.sort_by_key(|(name, _)| !name.to_lowercase().contains("setup"));
    let (asset_name, path) = candidates.into_iter().next()?;
    Some((asset_name, format!("https://github.com{path}")))
}

fn ensure_github_url(url: &str) -> Result<(), String> {
    let parsed = url
        .split_once("://")
        .filter(|(scheme, _)| *scheme == "https")
        .map(|(_, rest)| rest)
        .ok_or_else(|| "更新地址不合法: 仅支持 HTTPS".to_string())?;
    let host = parsed.split('/').next().unwrap_or_default().to_lowercase();
    let allowed = ["github.com", "githubusercontent.com"]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")));
    if !allowed {
        return Err(format!("更新地址不合法: 不受信任的域名 {host}"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn launch_installer(setup: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    let dir = setup
        .parent()
        .ok_or_else(|| "更新包路径异常".to_string())?;
    let setup_name = setup
        .file_name()
        .ok_or_else(|| "更新包路径异常".to_string())?
        .to_string_lossy()
        .to_string();
    let script = dir.join("run_update.cmd");

    // Waits for the running app to release the exe, installs silently, then
    // relaunches the installed build.
    let content = format!(
        "@echo off\r\n\
setlocal enabledelayedexpansion\r\n\
set \"SETUP=%~dp0{setup_name}\"\r\n\
set \"INSTALLED=%LOCALAPPDATA%\\Programs\\uuMovies\\uumovies.exe\"\r\n\
set /a tries=0\r\n\
:waitapp\r\n\
tasklist /FI \"IMAGENAME eq uumovies.exe\" 2>nul | find /I \"uumovies.exe\" >nul\r\n\
if not errorlevel 1 (\r\n\
  set /a tries+=1\r\n\
  if !tries! GEQ 180 goto install\r\n\
  ping -n 2 127.0.0.1 >nul\r\n\
  goto waitapp\r\n\
)\r\n\
:install\r\n\
if exist \"%SETUP%\" start \"\" /wait \"%SETUP%\" /S\r\n\
if exist \"%INSTALLED%\" start \"\" \"%INSTALLED%\"\r\n\
if exist \"%SETUP%\" del /f /q \"%SETUP%\" >nul 2>&1\r\n\
del /f /q \"%~f0\" >nul 2>&1\r\n"
    );

    std::fs::write(&script, content).map_err(|e| format!("写入更新脚本失败: {e}"))?;

    std::process::Command::new("cmd")
        .arg("/C")
        .arg(script.as_os_str())
        .current_dir(dir)
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map_err(|e| format!("启动更新进程失败: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_installer(_setup: &std::path::Path) -> Result<(), String> {
    Err("当前平台不支持自动安装，请前往发布页面手动下载".to_string())
}

#[tauri::command]
pub async fn check_app_update() -> Result<UpdateInfo, String> {
    check().await
}

#[tauri::command]
pub async fn get_app_version() -> Result<String, String> {
    Ok(CURRENT_VERSION.to_string())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("仅允许打开 http(s) 链接".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
        return Ok(());
    }
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    on_event: Channel<UpdateEvent>,
    download_url: String,
    sha256: Option<String>,
    version: String,
) -> Result<(), String> {
    ensure_github_url(&download_url)?;

    let client = http_client()?;
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("下载更新包失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载更新包失败: HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let safe_version: String = version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let work_dir = std::env::temp_dir().join(format!("uumovies-update-{}", std::process::id()));
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;
    let setup_path = work_dir.join(format!("uuMovies_{safe_version}_setup.exe"));

    let mut file = tokio::fs::File::create(&setup_path)
        .await
        .map_err(|e| format!("创建更新包失败: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut stream = response.bytes_stream();

    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载更新包中断: {e}"))?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入更新包失败: {e}"))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(120) {
            last_emit = Instant::now();
            let _ = on_event.send(UpdateEvent::Progress { downloaded, total });
        }
    }
    file.flush().await.ok();
    drop(file);
    let _ = on_event.send(UpdateEvent::Progress { downloaded, total });

    if downloaded == 0 {
        let _ = tokio::fs::remove_file(&setup_path).await;
        return Err("下载更新包失败: 文件为空".to_string());
    }
    if total > 0 && downloaded != total {
        let _ = tokio::fs::remove_file(&setup_path).await;
        return Err(format!(
            "下载更新包不完整 (已下载 {downloaded} / {total} 字节)，请重试"
        ));
    }

    if let Some(expected) = sha256
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
    {
        let _ = on_event.send(UpdateEvent::Verifying);
        let actual = format!("{:x}", hasher.finalize());
        if actual != expected {
            let _ = tokio::fs::remove_file(&setup_path).await;
            return Err("更新包完整性校验失败 (SHA-256 不匹配)".to_string());
        }
    }

    let _ = on_event.send(UpdateEvent::Installing);
    launch_installer(&setup_path)?;

    // Give the detached installer script time to start, then quit so the exe
    // lock is released before it is overwritten.
    let handle = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        handle.exit(0);
    });
    let _ = on_event.send(UpdateEvent::Done);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str, size: u64, digest: Option<&str>) -> GitHubAsset {
        GitHubAsset {
            name: name.to_string(),
            browser_download_url: format!("https://github.com/uu-love-QQ/uuMovies/releases/download/v9/{name}"),
            size,
            digest: digest.map(str::to_string),
        }
    }

    #[test]
    fn detects_newer_versions() {
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(is_newer("v0.2", "0.1.9"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.1.1", "0.1.1"));
        assert!(!is_newer("0.1.0", "0.1.1"));
        assert!(!is_newer("v0.1.1-beta.1", "0.1.1"));
        assert!(is_newer("0.1.1-beta.2", "0.1.0"));
    }

    #[test]
    fn normalizes_tags_and_suffixes() {
        assert_eq!(normalize_version("v0.1.2"), "0.1.2");
        assert_eq!(normalize_version(" 1.2.3 "), "1.2.3");
        assert_eq!(normalize_version("1.2.3-rc.1"), "1.2.3");
        assert_eq!(version_parts("v2.10.3"), vec![2, 10, 3]);
    }

    #[test]
    fn prefers_setup_executable_asset() {
        let assets = vec![
            asset("uumovies.exe", 10, None),
            asset("uuMovies_0.1.1_x64_Setup.exe", 20, None),
            asset("source.zip", 30, None),
        ];
        let picked = pick_asset(&assets).expect("setup asset");
        assert_eq!(picked.name, "uuMovies_0.1.1_x64_Setup.exe");
    }

    #[test]
    fn reads_sha256_digest() {
        let a = asset("setup.exe", 1, Some("sha256:ABCDEF"));
        assert_eq!(sha256_digest(&a).as_deref(), Some("abcdef"));
        let b = asset("setup.exe", 1, None);
        assert_eq!(sha256_digest(&b), None);
    }

    #[test]
    fn parses_release_page_assets() {
        let assets_html = r#"
          <li class="Box-row">
            <a href="/uu-love-QQ/uuMovies/releases/download/v0.1.1/uumovies.exe">Direct</a>
            <a href="/uu-love-QQ/uuMovies/releases/download/v0.1.1/uuMovies_0.1.1_x64_Setup.exe" rel="nofollow">Download</a>
          </li>
        "#;
        let (asset, url) = parse_assets_page(assets_html).expect("asset info");
        assert_eq!(asset, "uuMovies_0.1.1_x64_Setup.exe");
        assert_eq!(
            url,
            "https://github.com/uu-love-QQ/uuMovies/releases/download/v0.1.1/uuMovies_0.1.1_x64_Setup.exe"
        );
        assert_eq!(
            parse_release_tag("https://github.com/uu-love-QQ/uuMovies/releases/tag/v0.1.1").as_deref(),
            Some("v0.1.1")
        );
        assert!(parse_release_tag("https://github.com/uu-love-QQ/uuMovies/releases").is_none());
        assert!(parse_assets_page("<div>no assets</div>").is_none());
    }

    #[tokio::test]
    #[ignore = "hits the live GitHub release pages"]
    async fn live_fallback_reports_missing_release() {
        let client = http_client().expect("client");
        let error = check_via_html(&client)
            .await
            .expect_err("repository has no published release yet");
        assert!(error.contains("还没有发布"), "unexpected error: {error}");
    }

    #[test]
    fn only_trusts_github_hosts() {
        assert!(ensure_github_url("https://github.com/uu-love-QQ/uuMovies/releases/download/v1/a.exe").is_ok());
        assert!(ensure_github_url("https://objects.githubusercontent.com/x/a.exe").is_ok());
        assert!(ensure_github_url("https://release-assets.githubusercontent.com/x/a.exe").is_ok());
        assert!(ensure_github_url("http://github.com/a.exe").is_err());
        assert!(ensure_github_url("https://github.com.evil.test/a.exe").is_err());
        assert!(ensure_github_url("https://evil.test/a.exe").is_err());
        assert!(ensure_github_url("file:///etc/passwd").is_err());
    }
}
