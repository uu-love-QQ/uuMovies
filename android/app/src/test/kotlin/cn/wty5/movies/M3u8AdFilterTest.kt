package cn.wty5.movies

import cn.wty5.movies.player.M3u8AdFilter
import org.junit.Test
import org.junit.Assert.*

class M3u8AdFilterTest {

    @Test
    fun testSanitizeM3u8StripsAds() {
        val originalM3u8 = """
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:6.0,
0000000.ts
#EXTINF:6.0,
0000001.ts
#EXT-X-DISCONTINUITY
#EXTINF:3.0,
/video/adjump/time/17932819848870000000.ts
#EXTINF:3.0,
/video/adjump/time/17932819848870000001.ts
#EXT-X-DISCONTINUITY
#EXTINF:6.0,
0000002.ts
#EXTINF:6.0,
0000003.ts
#EXT-X-ENDLIST
""".trimIndent()

        val cleaned = M3u8AdFilter.sanitizeM3u8(originalM3u8)
        assertFalse(cleaned.contains("adjump"))
        assertTrue(cleaned.contains("0000000.ts"))
        assertTrue(cleaned.contains("0000001.ts"))
        assertTrue(cleaned.contains("0000002.ts"))
        assertTrue(cleaned.contains("0000003.ts"))
        assertTrue(cleaned.contains("#EXT-X-ENDLIST"))
    }

    @Test
    fun testPreservesByteRangeAndMetadata() {
        val m3u8WithByteRange = """
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:5
#EXTINF:4.5,
#EXT-X-BYTERANGE:1024@0
segment.ts
#EXTINF:4.5,
#EXT-X-BYTERANGE:2048@1024
segment.ts
#EXT-X-ENDLIST
""".trimIndent()

        val cleaned = M3u8AdFilter.sanitizeM3u8(m3u8WithByteRange)
        assertTrue(cleaned.contains("#EXT-X-BYTERANGE:1024@0"))
        assertTrue(cleaned.contains("#EXT-X-BYTERANGE:2048@1024"))
        assertTrue(cleaned.contains("segment.ts"))
    }
}
