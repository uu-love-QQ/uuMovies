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

    data class Segment(val tags: List<String>, val uri: String)

    /**
     * Sanitizes an M3U8 playlist by stripping in-video ads:
     * 1. Direct blacklisted ad segment URLs (/adjump/, etc.)
     * 2. Sandwiched foreign interstitial segments between #EXT-X-DISCONTINUITY (e.g. gambling/casino video ads)
     * Preserves legitimate #EXT-X-DISCONTINUITY and segment metadata (like #EXT-X-BYTERANGE, #EXT-X-KEY).
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
        var pendingTags = mutableListOf<String>()

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
                pendingTags.clear()
                i++
                continue
            }

            if (line.startsWith("#EXTINF")) {
                pendingTags.add(line)
                i++
                // Collect any additional tags before the URI (e.g. #EXT-X-BYTERANGE, #EXT-X-KEY)
                while (i < lines.size) {
                    val subLine = lines[i].trim()
                    if (subLine.isEmpty()) {
                        i++
                        continue
                    }
                    if (subLine.startsWith("#")) {
                        if (subLine.startsWith("#EXTINF") || subLine.startsWith("#EXT-X-DISCONTINUITY")) {
                            break
                        }
                        pendingTags.add(subLine)
                        i++
                    } else {
                        // This is the URI
                        currentBlock.add(Segment(pendingTags.toList(), subLine))
                        pendingTags.clear()
                        i++
                        break
                    }
                }
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

        if (blocks.isEmpty()) {
            return content
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

        // Check if keeping at least one block; if all filtered out, return original as fallback
        if (keep.none { it }) {
            return content
        }

        val out = mutableListOf<String>()
        out.addAll(headers)
        var hasAddedPreviousBlock = false
        for (idx in blocks.indices) {
            if (!keep[idx]) continue
            if (hasAddedPreviousBlock) {
                // If previous block in sequence was discontinuous, insert #EXT-X-DISCONTINUITY
                val prevKeptIdx = (idx - 1 downTo 0).firstOrNull { keep[it] }
                if (prevKeptIdx != null) {
                    val prevLastSeq = extractTrailingSeq(blocks[prevKeptIdx].last().uri)
                    val curFirstSeq = extractTrailingSeq(blocks[idx].first().uri)
                    if (prevLastSeq == null || curFirstSeq == null || curFirstSeq != prevLastSeq + 1) {
                        out.add("#EXT-X-DISCONTINUITY")
                    }
                }
            }
            for (item in blocks[idx]) {
                out.addAll(item.tags)
                out.add(item.uri)
            }
            hasAddedPreviousBlock = true
        }
        if (!out.any { it.startsWith("#EXT-X-ENDLIST") }) {
            out.add("#EXT-X-ENDLIST")
        }
        return out.joinToString("\n")
    }

    /**
     * OkHttp Interceptor that intercepts ONLY .m3u8 responses and filters ads.
     * Strictly avoids intercepting video segments (.ts, .mp4, etc.) to prevent data corruption.
     */
    class Interceptor : okhttp3.Interceptor {
        override fun intercept(chain: okhttp3.Interceptor.Chain): Response {
            val request = chain.request()
            val response = chain.proceed(request)

            val path = request.url.encodedPath.lowercase()
            // Strictly exclude media segments and non-playlist binary files
            if (path.endsWith(".ts") || path.endsWith(".mp4") || path.endsWith(".m4s") ||
                path.endsWith(".key") || path.endsWith(".aac") || path.endsWith(".mp3")
            ) {
                return response
            }

            val contentType = response.header("Content-Type")?.lowercase() ?: ""
            val isM3u8 = path.endsWith(".m3u8") ||
                    contentType.contains("mpegurl") ||
                    contentType.contains("application/x-mpegurl")

            if (response.isSuccessful && isM3u8) {
                val body = response.body
                if (body != null) {
                    try {
                        val rawText = body.string()
                        // Ensure it's a valid HLS playlist before modifying
                        if (rawText.contains("#EXTM3U")) {
                            val cleanedText = sanitizeM3u8(rawText)
                            val mediaType = (response.header("Content-Type") ?: "application/vnd.apple.mpegurl").toMediaTypeOrNull()
                            val newBody = cleanedText.toResponseBody(mediaType)
                            return response.newBuilder()
                                .removeHeader("Content-Length")
                                .body(newBody)
                                .build()
                        } else {
                            // If not #EXTM3U, restore original body
                            val newBody = rawText.toResponseBody(body.contentType())
                            return response.newBuilder().body(newBody).build()
                        }
                    } catch (e: Exception) {
                        // Fail open on error
                        return response
                    }
                }
            }
            return response
        }
    }
}
