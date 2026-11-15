package cn.wty5.movies.api

import cn.wty5.movies.model.*
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class AppleCmsClient {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    suspend fun fetchVodList(
        source: Source,
        typeId: String? = null,
        page: Int = 1,
        keyword: String? = null,
        hours: Int? = null
    ): VodResponse = withContext(Dispatchers.IO) {
        val multipleIds = typeId?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()

        if (multipleIds.size > 1) {
            // Concurrent subcategory aggregation
            coroutineScope {
                val deferredList = multipleIds.map { tid ->
                    async {
                        try {
                            fetchSingleVodList(source, tid, page, keyword, hours)
                        } catch (e: Exception) {
                            null
                        }
                    }
                }
                val responses = deferredList.awaitAll().filterNotNull()
                var totalSum = 0
                val combinedList = mutableListOf<VodItem>()
                val seenVodIds = mutableSetOf<String>()
                val combinedClasses = mutableListOf<Category>()
                val seenClassIds = mutableSetOf<String>()

                for (res in responses) {
                    totalSum += res.total
                    for (c in res.classes) {
                        if (seenClassIds.add(c.typeId)) combinedClasses.add(c)
                    }
                    for (v in res.list) {
                        if (seenVodIds.add(v.vodId)) {
                            v.sourceId = source.id
                            v.sourceName = source.name
                            combinedList.add(v)
                        }
                    }
                }

                combinedList.sortByDescending { it.vodTime ?: "" }
                val pagedItems = combinedList.take(20)
                val pageCount = if (totalSum > 0) (totalSum + 19) / 20 else 1

                VodResponse(
                    page = page,
                    pagecount = pageCount,
                    limit = 20,
                    total = totalSum,
                    list = pagedItems,
                    classes = combinedClasses
                )
            }
        } else {
            fetchSingleVodList(source, typeId, page, keyword, hours)
        }
    }

    private suspend fun fetchSingleVodList(
        source: Source,
        typeId: String?,
        page: Int,
        keyword: String?,
        hours: Int?
    ): VodResponse = withContext(Dispatchers.IO) {
        val baseUrl = buildBaseUrl(source.apiUrl)
        val urlBuilder = StringBuilder(baseUrl)
        urlBuilder.append(if (baseUrl.contains("?")) "&" else "?")
        urlBuilder.append("ac=videolist&pg=").append(page)

        if (!typeId.isNullOrBlank()) {
            urlBuilder.append("&t=").append(typeId)
        }
        if (!keyword.isNullOrBlank()) {
            urlBuilder.append("&wd=").append(java.net.URLEncoder.encode(keyword, "UTF-8"))
        }
        if (hours != null && hours > 0) {
            urlBuilder.append("&h=").append(hours)
        }

        val request = Request.Builder()
            .url(urlBuilder.toString())
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/128.0.0.0")
            .build()

        val response = httpClient.newCall(request).execute()
        val body = response.body?.string() ?: throw Exception("响应为空")
        val parsed = gson.fromJson(body, VodResponse::class.java)

        parsed.list.forEach {
            it.sourceId = source.id
            it.sourceName = source.name
        }
        parsed
    }

    suspend fun fetchVodDetail(source: Source, vodId: String): VodItem = withContext(Dispatchers.IO) {
        val baseUrl = buildBaseUrl(source.apiUrl)
        val sep = if (baseUrl.contains("?")) "&" else "?"
        val url = "${baseUrl}${sep}ac=detail&ids=${vodId}"

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/128.0.0.0")
            .build()

        val response = httpClient.newCall(request).execute()
        val body = response.body?.string() ?: throw Exception("详情响应为空")
        val parsed = gson.fromJson(body, VodResponse::class.java)

        val item = parsed.list.firstOrNull() ?: throw Exception("未找到影片详情")
        item.sourceId = source.id
        item.sourceName = source.name

        // Parse play lines and episodes
        val playFromStr = item.vodPlayFrom ?: ""
        val playUrlStr = item.vodPlayUrl ?: ""
        val playLines = parsePlayLines(playFromStr, playUrlStr)

        item.copy(playLines = playLines, sourceId = source.id, sourceName = source.name)
    }

    suspend fun fetchClasses(source: Source): List<Category> = withContext(Dispatchers.IO) {
        val baseUrl = buildBaseUrl(source.apiUrl)
        val sep = if (baseUrl.contains("?")) "&" else "?"
        val url = "${baseUrl}${sep}ac=list"

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/128.0.0.0")
            .build()

        val response = httpClient.newCall(request).execute()
        val body = response.body?.string() ?: return@withContext emptyList()
        val parsed = gson.fromJson(body, VodResponse::class.java)
        parsed.classes
    }

    suspend fun testSource(source: Source): TestResult = withContext(Dispatchers.IO) {
        val start = System.currentTimeMillis()
        try {
            val classes = fetchClasses(source)
            val latency = System.currentTimeMillis() - start
            TestResult(
                sourceId = source.id,
                name = source.name,
                ok = true,
                latencyMs = latency,
                categoriesCount = classes.size
            )
        } catch (e: Exception) {
            TestResult(
                sourceId = source.id,
                name = source.name,
                ok = false,
                latencyMs = System.currentTimeMillis() - start,
                error = e.message ?: "连接失败"
            )
        }
    }

    suspend fun searchAcrossSources(
        sources: List<Source>,
        keyword: String
    ): List<VodItem> = coroutineScope {
        val enabledSources = sources.filter { it.enabled }
        val deferredList = enabledSources.map { source ->
            async {
                try {
                    val res = fetchVodList(source = source, page = 1, keyword = keyword)
                    res.list
                } catch (e: Exception) {
                    emptyList<VodItem>()
                }
            }
        }
        val allResults = deferredList.awaitAll().flatten()
        val unique = mutableListOf<VodItem>()
        val seen = mutableSetOf<String>()
        for (item in allResults) {
            val key = "${item.vodName}__${item.sourceId}"
            if (seen.add(key)) {
                unique.add(item)
            }
        }
        unique
    }

    suspend fun aggregateCrossStationLines(
        sources: List<Source>,
        vodName: String,
        currentSourceId: String?
    ): List<PlayLine> = coroutineScope {
        val otherSources = sources.filter { it.enabled && it.id != currentSourceId }
        val deferredList = otherSources.map { src ->
            async {
                try {
                    val searchRes = fetchVodList(source = src, page = 1, keyword = vodName)
                    val matchedItem = searchRes.list.firstOrNull { it.vodName == vodName }
                        ?: searchRes.list.firstOrNull { it.vodName.contains(vodName) || vodName.contains(it.vodName) }
                    if (matchedItem != null) {
                        val detail = fetchVodDetail(source = src, vodId = matchedItem.vodId)
                        detail.playLines.map { line ->
                            line.copy(
                                title = "${src.name} · ${line.title}"
                            )
                        }
                    } else {
                        emptyList()
                    }
                } catch (e: Exception) {
                    emptyList<PlayLine>()
                }
            }
        }
        deferredList.awaitAll().flatten()
    }

    private fun parsePlayLines(playFrom: String, playUrl: String): List<PlayLine> {
        val froms = playFrom.split("$$$").map { it.trim() }
        val urlGroups = playUrl.split("$$$").map { it.trim() }
        val lines = mutableListOf<PlayLine>()

        for (i in froms.indices) {
            val fromName = froms[i]
            val groupText = urlGroups.getOrNull(i) ?: ""
            val episodes = mutableListOf<Episode>()

            val epStrings = groupText.split("#").map { it.trim() }.filter { it.isNotEmpty() }
            for (epStr in epStrings) {
                val parts = epStr.split("$")
                if (parts.size >= 2) {
                    val epName = parts[0].trim()
                    val epUrl = parts[1].trim()
                    if (epUrl.startsWith("http://") || epUrl.startsWith("https://")) {
                        episodes.add(Episode(name = epName, url = epUrl))
                    }
                } else if (parts.size == 1) {
                    val loneUrl = parts[0].trim()
                    if (loneUrl.startsWith("http://") || loneUrl.startsWith("https://")) {
                        episodes.add(Episode(name = "正片", url = loneUrl))
                    }
                }
            }

            if (episodes.isNotEmpty()) {
                val title = when {
                    fromName.contains("m3u8", ignoreCase = true) -> "M3U8在线播放"
                    fromName.contains("mp4", ignoreCase = true) -> "MP4直链"
                    else -> fromName.ifEmpty { "默认线路 ${i + 1}" }
                }
                lines.add(PlayLine(from = fromName, title = title, episodes = episodes))
            }
        }
        return lines
    }

    private fun buildBaseUrl(raw: String): String {
        var clean = raw.trim()
        if (clean.endsWith("?")) {
            clean = clean.substring(0, clean.length - 1)
        }
        return clean
    }
}
