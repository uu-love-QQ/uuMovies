package cn.wty5.movies.cast

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.MulticastSocket
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern

data class DlnaDevice(
    val name: String,
    val location: String,
    val controlUrl: String
)

object DlnaManager {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private const val SSDP_HOST = "239.255.255.250"
    private const val SSDP_PORT = 1900

    private val SSDP_SEARCH_MSG = "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: 239.255.255.250:1900\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 3\r\n" +
            "ST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n"

    /**
     * Searches for smart TVs and DLNA renderers on the local Wi-Fi
     */
    suspend fun discoverDevices(context: Context, timeoutSeconds: Int = 4): List<DlnaDevice> = withContext(Dispatchers.IO) {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val multicastLock = wifiManager?.createMulticastLock("dlna_search")?.apply {
            setReferenceCounted(false)
            acquire()
        }

        val discoveredLocations = mutableSetOf<String>()
        val devices = mutableListOf<DlnaDevice>()

        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket()
            socket.soTimeout = 1000

            val sendData = SSDP_SEARCH_MSG.toByteArray(Charsets.UTF_8)
            val sendPacket = DatagramPacket(
                sendData,
                sendData.size,
                InetAddress.getByName(SSDP_HOST),
                SSDP_PORT
            )

            // Send 2 multicast discovery packets
            socket.send(sendPacket)
            socket.send(sendPacket)

            val startTime = System.currentTimeMillis()
            val buf = ByteArray(2048)

            while (System.currentTimeMillis() - startTime < timeoutSeconds * 1000) {
                try {
                    val recvPacket = DatagramPacket(buf, buf.size)
                    socket.receive(recvPacket)
                    val response = String(recvPacket.data, 0, recvPacket.length, Charsets.UTF_8)

                    val location = extractHeader(response, "LOCATION")
                    if (!location.isNullOrBlank() && discoveredLocations.add(location)) {
                        val device = parseDeviceXml(location)
                        if (device != null) {
                            devices.add(device)
                        }
                    }
                } catch (e: Exception) {
                    // Socket timeout on individual receive, keep listening until total time expires
                }
            }
        } catch (e: Exception) {
            // Error discovering
        } finally {
            try {
                socket?.close()
            } catch (e: Exception) {
                // Ignore
            }
            try {
                if (multicastLock?.isHeld == true) {
                    multicastLock.release()
                }
            } catch (e: Exception) {
                // Ignore
            }
        }

        devices
    }

    /**
     * Casts an ad-filtered stream to the TV via local proxy relay
     */
    suspend fun castToTv(
        context: Context,
        device: DlnaDevice,
        videoTitle: String,
        rawStreamUrl: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            // 1. Build local ad-filtered proxy URL
            // When TV requests this URL, phone strips all in-video ads and casino watermarks!
            val proxyUrl = CastProxyServer.buildCastProxyUrl(context, rawStreamUrl)

            // 2. Set AVTransport URI
            val setUriXml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                    "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
                    "<s:Body>" +
                    "<u:SetAVTransportURI xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                    "<InstanceID>0</InstanceID>" +
                    "<CurrentURI>$proxyUrl</CurrentURI>" +
                    "<CurrentURIMetaData>&lt;DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"&gt;&lt;item id=\"1\" parentID=\"0\" restricted=\"1\"&gt;&lt;dc:title&gt;$videoTitle&lt;/dc:title&gt;&lt;upnp:class&gt;object.item.videoItem&lt;/upnp:class&gt;&lt;res protocolInfo=\"http-get:*:application/vnd.apple.mpegurl:*\"&gt;$proxyUrl&lt;/res&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</CurrentURIMetaData>" +
                    "</u:SetAVTransportURI>" +
                    "</s:Body>" +
                    "</s:Envelope>"

            sendSoapAction(device.controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI", setUriXml)

            // 3. Play command
            val playXml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                    "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
                    "<s:Body>" +
                    "<u:Play xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                    "<InstanceID>0</InstanceID>" +
                    "<Speed>1</Speed>" +
                    "</u:Play>" +
                    "</s:Body>" +
                    "</s:Envelope>"

            sendSoapAction(device.controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#Play", playXml)

            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun stopCasting(device: DlnaDevice): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val stopXml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                    "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
                    "<s:Body>" +
                    "<u:Stop xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                    "<InstanceID>0</InstanceID>" +
                    "</u:Stop>" +
                    "</s:Body>" +
                    "</s:Envelope>"

            sendSoapAction(device.controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#Stop", stopXml)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun sendSoapAction(controlUrl: String, soapAction: String, xmlPayload: String) {
        val mediaType = "text/xml; charset=utf-8".toMediaType()
        val body = xmlPayload.toRequestBody(mediaType)

        val request = Request.Builder()
            .url(controlUrl)
            .addHeader("SOAPAction", "\"$soapAction\"")
            .post(body)
            .build()

        val response = httpClient.newCall(request).execute()
        if (!response.isSuccessful) {
            throw Exception("DLNA 请求失败: HTTP ${response.code}")
        }
    }

    private fun extractHeader(raw: String, name: String): String? {
        val lines = raw.lines()
        for (line in lines) {
            val idx = line.indexOf(':')
            if (idx > 0) {
                val key = line.substring(0, idx).trim()
                if (key.equals(name, ignoreCase = true)) {
                    return line.substring(idx + 1).trim()
                }
            }
        }
        return null
    }

    private fun parseDeviceXml(locationUrl: String): DlnaDevice? {
        try {
            val request = Request.Builder().url(locationUrl).build()
            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return null
            val xml = response.body?.string() ?: return null

            // Extract friendlyName
            val namePattern = Pattern.compile("<friendlyName>(.*?)</friendlyName>", Pattern.CASE_INSENSITIVE)
            val nameMatcher = namePattern.matcher(xml)
            val name = if (nameMatcher.find()) nameMatcher.group(1)?.trim() ?: "智能电视" else "智能电视"

            // Extract AVTransport controlURL
            val servicePattern = Pattern.compile("<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>[\\s\\S]*?<controlURL>(.*?)</controlURL>", Pattern.CASE_INSENSITIVE)
            val serviceMatcher = servicePattern.matcher(xml)
            if (serviceMatcher.find()) {
                var controlUrl = serviceMatcher.group(1)?.trim() ?: return null
                if (!controlUrl.startsWith("http://") && !controlUrl.startsWith("https://")) {
                    val base = URL(locationUrl)
                    controlUrl = URL(base, controlUrl).toString()
                }
                return DlnaDevice(name = name, location = locationUrl, controlUrl = controlUrl)
            }
        } catch (e: Exception) {
            // XML parse error
        }
        return null
    }
}
