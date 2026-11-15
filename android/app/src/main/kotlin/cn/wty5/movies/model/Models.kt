package cn.wty5.movies.model

import com.google.gson.annotations.SerializedName

data class Source(
    val id: String,
    val name: String,
    @SerializedName("api_url") val apiUrl: String,
    @SerializedName("api_type") val apiType: String = "json",
    var enabled: Boolean = true,
    val group: String = "默认源",
    @SerializedName("adult_type_ids") val adultTypeIds: List<String> = emptyList(),
    @SerializedName("category_mapping") val categoryMapping: Map<String, List<String>> = emptyMap(),
    @SerializedName("subscription_id") val subscriptionId: String? = null
)

data class LocalCategory(
    val id: String,
    val name: String,
    @SerializedName("bind_tags") val bindTags: List<String>
)

data class UserTaxonomyConfig(
    @SerializedName("adult_mode") var adultMode: Boolean = false,
    val categories: List<LocalCategory> = emptyList(),
    @SerializedName("blocked_tags") val blockedTags: List<String> = emptyList(),
    @SerializedName("blocked_type_ids") val blockedTypeIds: List<String> = emptyList()
)

data class Category(
    @SerializedName("type_id") val typeId: String,
    @SerializedName("type_name") val typeName: String,
    @SerializedName("type_pid") val typePid: String? = null
)

data class Episode(
    val name: String,
    val url: String
)

data class PlayLine(
    val from: String,
    val title: String,
    val episodes: List<Episode> = emptyList()
)

data class VodItem(
    @SerializedName("vod_id") val vodId: String,
    @SerializedName("vod_name") val vodName: String,
    @SerializedName("type_id") val typeId: String = "",
    @SerializedName("type_name") val typeName: String = "",
    @SerializedName("vod_en") val vodEn: String? = null,
    @SerializedName("vod_time") val vodTime: String? = null,
    @SerializedName("vod_remarks") val vodRemarks: String? = null,
    @SerializedName("vod_play_from") val vodPlayFrom: String? = null,
    @SerializedName("vod_play_url") val vodPlayUrl: String? = null,
    @SerializedName("vod_pic") val vodPic: String? = null,
    @SerializedName("vod_actor") val vodActor: String? = null,
    @SerializedName("vod_director") val vodDirector: String? = null,
    @SerializedName("vod_content") val vodContent: String? = null,
    @SerializedName("vod_year") val vodYear: String? = null,
    @SerializedName("vod_area") val vodArea: String? = null,
    @SerializedName("vod_lang") val vodLang: String? = null,
    @SerializedName("vod_score") val vodScore: String? = null,
    val playLines: List<PlayLine> = emptyList(),
    var sourceId: String? = null,
    var sourceName: String? = null
)

data class VodResponse(
    val page: Int = 1,
    val pagecount: Int = 1,
    val limit: Int = 20,
    val total: Int = 0,
    val list: List<VodItem> = emptyList(),
    @SerializedName("class") val classes: List<Category> = emptyList()
)

data class PlayHistoryItem(
    val vodId: String,
    val sourceId: String,
    val sourceName: String,
    val vodName: String,
    val vodPic: String? = null,
    val lineIndex: Int = 0,
    val lineTitle: String = "默认线路",
    val episodeIndex: Int = 0,
    val episodeName: String = "第1集",
    val progressSeconds: Long = 0,
    val durationSeconds: Long = 0,
    val updatedAt: Long = System.currentTimeMillis()
)

data class FavoriteItem(
    val vodId: String,
    val sourceId: String,
    val sourceName: String,
    val vodName: String,
    val vodPic: String? = null,
    val typeName: String? = null,
    val vodRemarks: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

data class AppSettings(
    val autoPlayNext: Boolean = true,
    val playbackRate: Float = 1.0f,
    val skipIntroSeconds: Int = 0,
    val skipOutroSeconds: Int = 0
)

data class TestResult(
    val sourceId: String,
    val name: String,
    val ok: Boolean,
    val latencyMs: Long,
    val categoriesCount: Int = 0,
    val error: String? = null
)

data class SubscriptionItem(
    val id: String,
    val name: String,
    val url: String,
    var enabled: Boolean = true,
    var autoUpdate: Boolean = true,
    var lastUpdated: Long = 0L,
    var sourceCount: Int = 0,
    var errorMsg: String? = null
)

data class SharedSourceDefinition(
    val id: String,
    val name: String,
    val api: String? = null,
    @SerializedName("api_url") val apiUrl: String? = null,
    @SerializedName("api_type") val apiType: String? = "json",
    val group: String? = "远程订阅",
    @SerializedName("adult_type_ids") val adultTypeIds: List<String> = emptyList(),
    @SerializedName("category_mapping") val categoryMapping: Map<String, List<String>> = emptyMap()
)

data class SharedSourceBundle(
    val name: String? = null,
    val sources: List<SharedSourceDefinition> = emptyList()
)
