package cn.wty5.movies.player

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.util.regex.Pattern

object M3u8AdFilter {

    private val AD_PATTERNS = listOf(
        "/adjump/",
        "/ad/",
        "/ads/",
        "guanggao",
        "advert",
        "/ad_",
        "googleads",
        "doubleclick",
        "appad",
        "union",
        "casino",
        "macau",
        "amwns"
    )

    private val TS_PATTERN = Pattern.compile("(\\d+)\\.ts", Pattern.CASE_INSENSITIVE)

    private fun extractTrailingSeq(uri: String): Int? {
        val matcher = TS_PATTERN.matcher(uri)
        if (!matcher.find()) return null
        val numStr = matcher.group(1) ?: return null
        val suffix = if (numStr.length > 4) numStr.substring(numStr.length - 4) else numStr
        return suffix.toIntOrNull()
    }

    private fun isAdUri(uri: String): Boolean {
        val lower = uri.lowercase()
        return AD_PATTERNS.any { lower.contains(it) }
    }

    data class Segment(val extinf: String, val uri: String)

    /**
     * Sanitizes an M3U8 playlist by stripping in-video ads:
     * 1. Direct blacklisted ad segment URLs (/adjump/, etc.)
     * 2. Sandwiched foreign interstitial segments between #EXT-X-DISCONTINUITY (e.g. gambling/casino video ads)
     */
    fun sanitizeM3u8(content: String): String {
        // If not a media playlist with segments (e.g. master playlist), return untouched
        if (content.contains("#EXT-X-STREAM-INF") || !content.contains("#EXTINF")) {
            return content
        }

        val lines = content.lines()
        val headers = mutableListOf<String>()
        val blocks = mutableListOf<MutableList<Segment>>()
        var currentBlock = mutableListOf<Segment>()

        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (line.isEmpty()) {
                i++
                continue
            }

            if (line.startsWith("#EXT-X-DISCONTINUITY")) {
                if (currentBlock.isNotEmpty()) {
                    blocks.add(currentBlock)
                    currentBlock = mutableListOf()
                }
                i++
                continue
            }

            if (line.startsWith("#EXTINF")) {
                val extinf = line
                i++
                while (i < lines.size && lines[i].trim().startsWith("#") && !lines[i].trim().startsWith("#EXTINF")) {
                    i++
                }
                if (i < lines.size) {
                    val uri = lines[i].trim()
                    if (uri.isNotEmpty() && !uri.startsWith("#")) {
                        currentBlock.add(Segment(extinf, uri))
                    }
                }
                i++
                continue
            }

            if (blocks.isEmpty() && currentBlock.isEmpty() && line.startsWith("#")) {
                headers.add(line)
            }
            i++
        }

        if (currentBlock.isNotEmpty()) {
            blocks.add(currentBlock)
        }

        val keep = BooleanArray(blocks.size) { true }

        // 1. Blacklisted URI check
        for (idx in blocks.indices) {
            if (blocks[idx].any { isAdUri(it.uri) }) {
                keep[idx] = false
            }
        }

        // 2. Discontinuity Sandwich Anomaly Detection (injected gambling watermark segments)
        for (k in 1 until blocks.size - 1) {
            if (!keep[k]) continue
            val prevB = blocks[k - 1]
            val nextB = blocks[k + 1]
            if (prevB.isNotEmpty() && nextB.isNotEmpty()) {
                val prevSeq = extractTrailingSeq(prevB.last().uri)
                val nextSeq = extractTrailingSeq(nextB.first().uri)
                if (prevSeq != null && nextSeq != null) {
                    // If next block seamlessly continues the previous block's sequence, the middle block is an injected ad!
                    if (nextSeq == prevSeq + 1 || nextSeq == prevSeq) {
                        keep[k] = false
                    }
                }
            }
        }

        val out = mutableListOf<String>()
        out.addAll(headers)
        for (idx in blocks.indices) {
            if (!keep[idx]) continue
            for (item in blocks[idx]) {
                out.add(item.extinf)
                out.add(item.uri)
            }
        }
        out.add("#EXT-X-ENDLIST")
        return out.joinToString("\n")
    }

    /**
     * OkHttp Interceptor that intercepts .m3u8 responses and filters ads
     */
    class Interceptor : okhttp3.Interceptor {
        override fun intercept(chain: okhttp3.Interceptor.Chain): Response {
            val request = chain.request()
            val response = chain.proceed(request)
            val url = request.url.toString()

            val contentType = response.header("Content-Type")?.lowercase() ?: ""
            val isM3u8 = url.contains(".m3u8") ||
                    contentType.contains("mpegurl") ||
                    contentType.contains("application/x-mpegurl")

            if (response.isSuccessful && isM3u8) {
                val body = response.body
                if (body != null) {
                    val rawText = body.string()
                    val cleanedText = sanitizeM3u8(rawText)
                    val newBody = cleanedText.toResponseBody(body.contentType())
                    return response.newBuilder().body(newBody).build()
                }
            }
            return response
        }
    }
}
