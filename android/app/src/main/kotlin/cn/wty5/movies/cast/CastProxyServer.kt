package cn.wty5.movies.cast

import android.content.Context
import android.net.wifi.WifiManager
import android.text.format.Formatter
import cn.wty5.movies.player.M3u8AdFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object CastProxyServer {

    private var serverSocket: ServerSocket? = null
    private var serverPort: Int = 8998
    private var isRunning = false
    private val threadPool = Executors.newCachedThreadPool()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    @Synchronized
    fun start(context: Context, preferredPort: Int = 8998): Int {
        if (isRunning && serverSocket != null && !serverSocket!!.isClosed) {
            return serverPort
        }

        try {
            serverSocket = ServerSocket(preferredPort)
            serverPort = serverSocket!!.localPort
        } catch (e: Exception) {
            // Pick any available port
            serverSocket = ServerSocket(0)
            serverPort = serverSocket!!.localPort
        }

        isRunning = true

        threadPool.execute {
            while (isRunning && serverSocket != null && !serverSocket!!.isClosed) {
                try {
                    val clientSocket = serverSocket!!.accept()
                    threadPool.execute {
                        handleClient(clientSocket)
                    }
                } catch (e: Exception) {
                    if (!isRunning) break
                }
            }
        }

        return serverPort
    }

    @Synchronized
    fun stop() {
        isRunning = false
        try {
            serverSocket?.close()
        } catch (e: Exception) {
            // Ignore
        }
        serverSocket = null
    }

    fun getLocalIpAddress(context: Context): String {
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val wifiInfo = wifiManager?.connectionInfo
            val ipInt = wifiInfo?.ipAddress ?: 0
            if (ipInt != 0) {
                return Formatter.formatIpAddress(ipInt)
            }
        } catch (e: Exception) {
            // Ignore
        }

        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr.hostAddress?.contains(':') == false) {
                        return addr.hostAddress ?: "127.0.0.1"
                    }
                }
            }
        } catch (e: Exception) {
            // Ignore
        }

        return "127.0.0.1"
    }

    /**
     * Builds an ad-filtered proxy URL for DLNA casting:
     * When the TV plays this URL, the phone strips all in-video ads, casino watermarks, and interstitial segments!
     */
    fun buildCastProxyUrl(context: Context, rawStreamUrl: String): String {
        val port = start(context)
        val ip = getLocalIpAddress(context)
        val encoded = URLEncoder.encode(rawStreamUrl.trim(), "UTF-8")
        return "http://$ip:$port/proxy/m3u8?url=$encoded"
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.soTimeout = 15000
            val input = BufferedReader(InputStreamReader(socket.getInputStream()))
            val output = socket.getOutputStream()

            val requestLine = input.readLine() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return

            val method = parts[0]
            val path = parts[1]

            if (method.equals("GET", ignoreCase = true) && path.startsWith("/proxy/m3u8")) {
                val urlParam = extractQueryParam(path, "url")
                if (urlParam != null) {
                    val decodedUrl = URLDecoder.decode(urlParam, "UTF-8")
                    serveSanitizedM3u8(decodedUrl, output)
                } else {
                    send400(output, "Missing 'url' query parameter")
                }
            } else {
                send404(output)
            }
        } catch (e: Exception) {
            // Client disconnected or error
        } finally {
            try {
                socket.close()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    private fun extractQueryParam(path: String, paramName: String): String? {
        val qIdx = path.indexOf('?')
        if (qIdx < 0 || qIdx + 1 >= path.length) return null
        val query = path.substring(qIdx + 1)
        val pairs = query.split("&")
        for (pair in pairs) {
            val idx = pair.indexOf('=')
            if (idx > 0) {
                val key = pair.substring(0, idx)
                if (key == paramName) {
                    return pair.substring(idx + 1)
                }
            }
        }
        return null
    }

    private fun serveSanitizedM3u8(targetUrl: String, output: OutputStream) {
        try {
            val request = Request.Builder()
                .url(targetUrl)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/128.0.0.0")
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                sendError(output, response.code, "Failed to fetch origin M3U8: HTTP ${response.code}")
                return
            }

            val rawBody = response.body?.string() ?: ""
            // 1. Run M3U8 Ad Filter (strips blacklisted URIs & discontinuity casino ads)
            val filteredM3u8 = M3u8AdFilter.sanitizeM3u8(rawBody)

            // 2. Resolve relative segment URIs into absolute URLs based on targetUrl
            // This allows the TV to download clean video segments directly from the CDN without phone proxying!
            val resolvedM3u8 = resolveRelativeUris(filteredM3u8, targetUrl)

            val bodyBytes = resolvedM3u8.toByteArray(Charsets.UTF_8)
            val headers = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: application/vnd.apple.mpegurl\r\n" +
                    "Content-Length: ${bodyBytes.size}\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Cache-Control: no-cache\r\n" +
                    "Connection: close\r\n\r\n"

            output.write(headers.toByteArray(Charsets.UTF_8))
            output.write(bodyBytes)
            output.flush()
        } catch (e: Exception) {
            sendError(output, 500, "Proxy error: ${e.message}")
        }
    }

    /**
     * Resolves any relative URI lines in the M3U8 playlist to full absolute URLs
     */
    private fun resolveRelativeUris(m3u8Content: String, baseUrlStr: String): String {
        val baseUrl = URL(baseUrlStr)
        val lines = m3u8Content.lines()
        val out = mutableListOf<String>()

        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                out.add(line)
            } else {
                // This is a media segment URI or nested playlist URI
                val absoluteUri = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                    trimmed
                } else {
                    URL(baseUrl, trimmed).toString()
                }
                out.add(absoluteUri)
            }
        }
        return out.joinToString("\n")
    }

    private fun send400(output: OutputStream, msg: String) {
        val body = "400 Bad Request: $msg\r\n".toByteArray(Charsets.UTF_8)
        val response = "HTTP/1.1 400 Bad Request\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
        output.write(response.toByteArray(Charsets.UTF_8))
        output.write(body)
        output.flush()
    }

    private fun send404(output: OutputStream) {
        val body = "404 Not Found\r\n".toByteArray(Charsets.UTF_8)
        val response = "HTTP/1.1 404 Not Found\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
        output.write(response.toByteArray(Charsets.UTF_8))
        output.write(body)
        output.flush()
    }

    private fun sendError(output: OutputStream, code: Int, msg: String) {
        val body = "$code $msg\r\n".toByteArray(Charsets.UTF_8)
        val response = "HTTP/1.1 $code Error\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
        output.write(response.toByteArray(Charsets.UTF_8))
        output.write(body)
        output.flush()
    }
}
