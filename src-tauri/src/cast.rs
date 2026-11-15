use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DlnaDevice {
    pub name: String,
    pub location: String,
    pub control_url: String,
}

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SERVER_PORT: AtomicU16 = AtomicU16::new(0);

pub struct CastManager;

impl CastManager {
    /// Gets the local LAN IP address of this computer
    pub fn get_local_ip() -> String {
        // Create a dummy UDP socket to 8.8.8.8:80 to determine local routing interface
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if socket.connect("8.8.8.8:80").is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    return addr.ip().to_string();
                }
            }
        }
        "127.0.0.1".to_string()
    }

    /// Starts the local HTTP sanitizing proxy server if not already running
    pub async fn ensure_proxy_server() -> Result<u16, String> {
        if SERVER_RUNNING.load(Ordering::SeqCst) {
            let port = SERVER_PORT.load(Ordering::SeqCst);
            if port > 0 {
                return Ok(port);
            }
        }

        let listener = match TcpListener::bind("0.0.0.0:8999").await {
            Ok(l) => l,
            Err(_) => TcpListener::bind("0.0.0.0:0")
                .await
                .map_err(|e| format!("无法启动本地中继代理端口: {e}"))?,
        };

        let port = listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .port();

        SERVER_PORT.store(port, Ordering::SeqCst);
        SERVER_RUNNING.store(true, Ordering::SeqCst);

        // Spawn background HTTP server task
        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .unwrap_or_default();

            loop {
                match listener.accept().await {
                    Ok((mut stream, _)) => {
                        let client = client.clone();
                        tokio::spawn(async move {
                            handle_http_request(&mut stream, &client).await;
                        });
                    }
                    Err(_) => break,
                }
            }
            SERVER_RUNNING.store(false, Ordering::SeqCst);
        });

        Ok(port)
    }

    /// Scans the local network for DLNA/UPnP smart TVs using SSDP
    pub async fn discover_devices(timeout_secs: u64) -> Result<Vec<DlnaDevice>, String> {
        let socket = UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(|e| format!("绑定 UDP 搜索套接字失败: {e}"))?;

        socket
            .set_broadcast(true)
            .map_err(|e| e.to_string())?;

        let search_msg = "M-SEARCH * HTTP/1.1\r\n\
                          HOST: 239.255.255.250:1900\r\n\
                          MAN: \"ssdp:discover\"\r\n\
                          MX: 3\r\n\
                          ST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n";

        let target_addr: SocketAddr = "239.255.255.250:1900".parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
        let _ = socket.send_to(search_msg.as_bytes(), target_addr).await;
        let _ = socket.send_to(search_msg.as_bytes(), target_addr).await;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_default();

        let mut discovered_locations = HashSet::new();
        let mut devices = Vec::new();
        let mut buf = [0u8; 2048];

        let start = tokio::time::Instant::now();
        let timeout_duration = Duration::from_secs(timeout_secs.max(3));

        while tokio::time::Instant::now() - start < timeout_duration {
            let remaining = timeout_duration.saturating_sub(tokio::time::Instant::now() - start);
            match tokio::time::timeout(remaining.min(Duration::from_millis(800)), socket.recv_from(&mut buf)).await {
                Ok(Ok((len, _))) => {
                    let text = String::from_utf8_lossy(&buf[..len]);
                    if let Some(location) = extract_header(&text, "LOCATION") {
                        if discovered_locations.insert(location.clone()) {
                            if let Some(dev) = parse_device_description(&client, &location).await {
                                devices.push(dev);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(devices)
    }

    /// Casts an ad-filtered video stream to the selected smart TV via local proxy relay
    pub async fn cast_to_device(
        device: DlnaDevice,
        video_title: String,
        raw_stream_url: String,
    ) -> Result<String, String> {
        let port = Self::ensure_proxy_server().await?;
        let encoded_url = utf8_percent_encode(&raw_stream_url, NON_ALPHANUMERIC).to_string();
        let local_ip = Self::get_local_ip();
        let proxy_url = format!("http://{local_ip}:{port}/proxy/m3u8?url={encoded_url}");

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        // 1. SetAVTransportURI
        let set_uri_xml = format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<InstanceID>0</InstanceID>
<CurrentURI>{proxy_url}</CurrentURI>
<CurrentURIMetaData>&lt;DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"&gt;&lt;item id="1" parentID="0" restricted="1"&gt;&lt;dc:title&gt;{video_title}&lt;/dc:title&gt;&lt;upnp:class&gt;object.item.videoItem&lt;/upnp:class&gt;&lt;res protocolInfo="http-get:*:application/vnd.apple.mpegurl:*"&gt;{proxy_url}&lt;/res&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</CurrentURIMetaData>
</u:SetAVTransportURI>
</s:Body>
</s:Envelope>"#
        );

        send_soap_action(
            &client,
            &device.control_url,
            "urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI",
            &set_uri_xml,
        )
        .await?;

        // 2. Play
        let play_xml = r#"<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<InstanceID>0</InstanceID>
<Speed>1</Speed>
</u:Play>
</s:Body>
</s:Envelope>"#;

        send_soap_action(
            &client,
            &device.control_url,
            "urn:schemas-upnp-org:service:AVTransport:1#Play",
            play_xml,
        )
        .await?;

        Ok(proxy_url)
    }

    pub async fn stop_cast(control_url: String) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap_or_default();

        let stop_xml = r#"<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<InstanceID>0</InstanceID>
</u:Stop>
</s:Body>
</s:Envelope>"#;

        send_soap_action(
            &client,
            &control_url,
            "urn:schemas-upnp-org:service:AVTransport:1#Stop",
            stop_xml,
        )
        .await
    }
}

async fn handle_http_request(stream: &mut tokio::net::TcpStream, client: &reqwest::Client) {
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buf[..n]);
    let first_line = req_str.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();

    if parts.len() < 2 || parts[0] != "GET" {
        let _ = stream.write_all(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n").await;
        return;
    }

    let path = parts[1];
    if !path.starts_with("/proxy/m3u8") {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
        return;
    }

    let url_param = match path.find("url=") {
        Some(idx) => &path[idx + 4..],
        None => {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
            return;
        }
    };
    let target_url = percent_decode_str(url_param).decode_utf8_lossy().to_string();
    if target_url.is_empty() {
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        return;
    }

    match client.get(&target_url).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                let err_res = format!("HTTP/1.1 {} Origin Error\r\n\r\n", resp.status().as_u16());
                let _ = stream.write_all(err_res.as_bytes()).await;
                return;
            }
            let raw_content = resp.text().await.unwrap_or_default();

            // 1. Strip ads & discontinuity casino watermarks
            // 2. Resolve relative segment URIs into absolute CDN URLs
            let cleaned = sanitize_and_resolve_m3u8(&raw_content, &target_url);
            let bytes = cleaned.as_bytes();

            let header = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: application/vnd.apple.mpegurl\r\n\
                 Content-Length: {}\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Cache-Control: no-cache\r\n\
                 Connection: close\r\n\r\n",
                bytes.len()
            );

            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(bytes).await;
            let _ = stream.flush().await;
        }
        Err(e) => {
            let err_res = format!("HTTP/1.1 502 Bad Gateway\r\n\r\n{e}");
            let _ = stream.write_all(err_res.as_bytes()).await;
        }
    }
}

pub fn sanitize_and_resolve_m3u8(content: &str, base_url_str: &str) -> String {
    if content.contains("#EXT-X-STREAM-INF") || !content.contains("#EXTINF") {
        return content.to_string();
    }

    let ad_patterns = [
        "/adjump/", "/ad/", "/ads/", "guanggao", "advert", "/ad_",
        "googleads", "doubleclick", "appad", "union", "casino", "macau", "amwns"
    ];

    let ts_re = Regex::new(r"(\d+)\.ts").unwrap();
    let extract_seq = |uri: &str| -> Option<u32> {
        ts_re.captures(uri).and_then(|c| {
            let s = c.get(1)?.as_str();
            let suffix = if s.len() > 4 { &s[s.len() - 4..] } else { s };
            suffix.parse::<u32>().ok()
        })
    };

    let mut headers = Vec::new();
    let mut blocks: Vec<Vec<(String, String)>> = Vec::new();
    let mut current_block: Vec<(String, String)> = Vec::new();

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();
        if line.is_empty() {
            i += 1;
            continue;
        }

        if line.starts_with("#EXT-X-DISCONTINUITY") {
            if !current_block.is_empty() {
                blocks.push(std::mem::take(&mut current_block));
            }
            i += 1;
            continue;
        }

        if line.starts_with("#EXTINF") {
            let extinf = line.to_string();
            i += 1;
            while i < lines.len() && lines[i].trim().starts_with('#') && !lines[i].trim().starts_with("#EXTINF") {
                i += 1;
            }
            if i < lines.len() {
                let uri = lines[i].trim();
                if !uri.is_empty() && !uri.starts_with('#') {
                    current_block.push((extinf, uri.to_string()));
                }
            }
            i += 1;
            continue;
        }

        if blocks.is_empty() && current_block.is_empty() && line.starts_with('#') {
            headers.push(line.to_string());
        }
        i += 1;
    }

    if !current_block.is_empty() {
        blocks.push(current_block);
    }

    let mut keep = vec![true; blocks.len()];

    // 1. Direct blacklisted URI check
    for idx in 0..blocks.len() {
        let has_ad = blocks[idx].iter().any(|(_, uri)| {
            let lower = uri.to_lowercase();
            ad_patterns.iter().any(|p| lower.contains(p))
        });
        if has_ad {
            keep[idx] = false;
        }
    }

    // 2. Discontinuity Sandwich Anomaly Detection (injected gambling watermark segments)
    if blocks.len() > 2 {
        for k in 1..blocks.len() - 1 {
            if !keep[k] {
                continue;
            }
            let prev_b = &blocks[k - 1];
            let next_b = &blocks[k + 1];
            if !prev_b.is_empty() && !next_b.is_empty() {
                let prev_seq = extract_seq(&prev_b.last().unwrap().1);
                let next_seq = extract_seq(&next_b.first().unwrap().1);
                if let (Some(p), Some(n)) = (prev_seq, next_seq) {
                    if n == p + 1 || n == p {
                        keep[k] = false;
                    }
                }
            }
        }
    }

    let base_url = reqwest::Url::parse(base_url_str).ok();

    let mut out = headers;
    for idx in 0..blocks.len() {
        if !keep[idx] {
            continue;
        }
        for (extinf, uri) in &blocks[idx] {
            out.push(extinf.clone());
            // Resolve relative URI to absolute URL based on origin playlist
            let absolute_uri = if uri.starts_with("http://") || uri.starts_with("https://") {
                uri.clone()
            } else if let Some(base) = &base_url {
                base.join(uri).map(|u| u.to_string()).unwrap_or_else(|_| uri.clone())
            } else {
                uri.clone()
            };
            out.push(absolute_uri);
        }
    }
    out.push("#EXT-X-ENDLIST".to_string());
    out.join("\n")
}

async fn send_soap_action(
    client: &reqwest::Client,
    control_url: &str,
    soap_action: &str,
    xml: &str,
) -> Result<(), String> {
    let resp = client
        .post(control_url)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header("SOAPAction", format!("\"{soap_action}\""))
        .body(xml.to_string())
        .send()
        .await
        .map_err(|e| format!("发送 DLNA 指令失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("电视端拒绝指令 (HTTP {})", resp.status().as_u16()));
    }
    Ok(())
}

fn extract_header(raw: &str, name: &str) -> Option<String> {
    for line in raw.lines() {
        if let Some(idx) = line.find(':') {
            let key = line[..idx].trim();
            if key.eq_ignore_ascii_case(name) {
                return Some(line[idx + 1..].trim().to_string());
            }
        }
    }
    None
}

async fn parse_device_description(client: &reqwest::Client, location: &str) -> Option<DlnaDevice> {
    let xml = client.get(location).send().await.ok()?.text().await.ok()?;

    let name_re = Regex::new(r"(?i)<friendlyName>(.*?)</friendlyName>").ok()?;
    let name = name_re
        .captures(&xml)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .unwrap_or_else(|| "智能电视 / 盒子".to_string());

    let service_re = Regex::new(r"(?is)<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>.*?<controlURL>(.*?)</controlURL>").ok()?;
    let control_sub = service_re
        .captures(&xml)
        .and_then(|c| c.get(1))?
        .as_str()
        .trim();

    let control_url = if control_sub.starts_with("http://") || control_sub.starts_with("https://") {
        control_sub.to_string()
    } else {
        let base = reqwest::Url::parse(location).ok()?;
        base.join(control_sub).ok()?.to_string()
    };

    Some(DlnaDevice {
        name,
        location: location.to_string(),
        control_url,
    })
}
