package cn.wty5.movies.repository

import android.content.Context
import android.content.SharedPreferences
import cn.wty5.movies.config.DefaultConfig
import cn.wty5.movies.model.*
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class MovieRepository(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("uumovies_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()

    private val _sourcesFlow = MutableStateFlow<List<Source>>(emptyList())
    val sourcesFlow: StateFlow<List<Source>> = _sourcesFlow.asStateFlow()

    private val _activeSourceFlow = MutableStateFlow<Source?>(null)
    val activeSourceFlow: StateFlow<Source?> = _activeSourceFlow.asStateFlow()

    private val _taxonomyFlow = MutableStateFlow(DefaultConfig.DEFAULT_TAXONOMY)
    val taxonomyFlow: StateFlow<UserTaxonomyConfig> = _taxonomyFlow.asStateFlow()

    private val _historyFlow = MutableStateFlow<List<PlayHistoryItem>>(emptyList())
    val historyFlow: StateFlow<List<PlayHistoryItem>> = _historyFlow.asStateFlow()

    private val _favoritesFlow = MutableStateFlow<List<FavoriteItem>>(emptyList())
    val favoritesFlow: StateFlow<List<FavoriteItem>> = _favoritesFlow.asStateFlow()

    private val _settingsFlow = MutableStateFlow(AppSettings())
    val settingsFlow: StateFlow<AppSettings> = _settingsFlow.asStateFlow()

    private val _subscriptionsFlow = MutableStateFlow<List<SubscriptionItem>>(emptyList())
    val subscriptionsFlow: StateFlow<List<SubscriptionItem>> = _subscriptionsFlow.asStateFlow()

    private val httpClient = okhttp3.OkHttpClient.Builder()
        .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    init {
        loadAll()
    }

    private fun loadAll() {
        // 1. Sources
        val sourcesJson = prefs.getString("key_sources", null)
        val loadedSources: List<Source> = if (!sourcesJson.isNullOrBlank()) {
            try {
                val type = object : TypeToken<List<Source>>() {}.type
                gson.fromJson(sourcesJson, type)
            } catch (e: Exception) {
                DefaultConfig.DEFAULT_SOURCES
            }
        } else {
            DefaultConfig.DEFAULT_SOURCES
        }
        _sourcesFlow.value = loadedSources

        // 2. Active Source ID
        val savedActiveId = prefs.getString("key_active_source_id", null)
        val active = loadedSources.find { it.id == savedActiveId && it.enabled }
            ?: loadedSources.firstOrNull { it.enabled }
            ?: loadedSources.firstOrNull()
        _activeSourceFlow.value = active

        // 3. Taxonomy
        val taxJson = prefs.getString("key_taxonomy", null)
        val loadedTax: UserTaxonomyConfig = if (!taxJson.isNullOrBlank()) {
            try {
                gson.fromJson(taxJson, UserTaxonomyConfig::class.java)
            } catch (e: Exception) {
                DefaultConfig.DEFAULT_TAXONOMY
            }
        } else {
            DefaultConfig.DEFAULT_TAXONOMY
        }
        _taxonomyFlow.value = loadedTax

        // 4. History
        val historyJson = prefs.getString("key_history", null)
        if (!historyJson.isNullOrBlank()) {
            try {
                val type = object : TypeToken<List<PlayHistoryItem>>() {}.type
                _historyFlow.value = gson.fromJson(historyJson, type)
            } catch (e: Exception) {
                _historyFlow.value = emptyList()
            }
        }

        // 5. Favorites
        val favJson = prefs.getString("key_favorites", null)
        if (!favJson.isNullOrBlank()) {
            try {
                val type = object : TypeToken<List<FavoriteItem>>() {}.type
                _favoritesFlow.value = gson.fromJson(favJson, type)
            } catch (e: Exception) {
                _favoritesFlow.value = emptyList()
            }
        }

        // 6. Settings
        val settingsJson = prefs.getString("key_settings", null)
        if (!settingsJson.isNullOrBlank()) {
            try {
                _settingsFlow.value = gson.fromJson(settingsJson, AppSettings::class.java)
            } catch (e: Exception) {
                _settingsFlow.value = AppSettings()
            }
        }

        // 7. Subscriptions
        val subsJson = prefs.getString("key_subscriptions", null)
        if (!subsJson.isNullOrBlank()) {
            try {
                val type = object : TypeToken<List<SubscriptionItem>>() {}.type
                _subscriptionsFlow.value = gson.fromJson(subsJson, type)
            } catch (e: Exception) {
                _subscriptionsFlow.value = emptyList()
            }
        }
    }

    fun setActiveSource(sourceId: String) {
        val src = _sourcesFlow.value.find { it.id == sourceId } ?: return
        _activeSourceFlow.value = src
        prefs.edit().putString("key_active_source_id", sourceId).apply()
    }

    fun saveSources(sources: List<Source>) {
        _sourcesFlow.value = sources
        prefs.edit().putString("key_sources", gson.toJson(sources)).apply()
        val curActive = _activeSourceFlow.value
        if (curActive == null || !sources.any { it.id == curActive.id }) {
            val nextActive = sources.firstOrNull { it.enabled } ?: sources.firstOrNull()
            _activeSourceFlow.value = nextActive
            prefs.edit().putString("key_active_source_id", nextActive?.id).apply()
        } else {
            // Update the reference of active source
            _activeSourceFlow.value = sources.find { it.id == curActive.id }
        }
    }

    fun resetDefaultSources() {
        saveSources(DefaultConfig.DEFAULT_SOURCES)
    }

    fun saveTaxonomy(config: UserTaxonomyConfig) {
        _taxonomyFlow.value = config
        prefs.edit().putString("key_taxonomy", gson.toJson(config)).apply()
    }

    fun toggleAdultMode(enabled: Boolean) {
        val updated = _taxonomyFlow.value.copy(adultMode = enabled)
        saveTaxonomy(updated)
    }

    fun saveHistory(item: PlayHistoryItem) {
        val current = _historyFlow.value.toMutableList()
        current.removeAll { it.vodId == item.vodId && it.sourceId == item.sourceId }
        current.add(0, item)
        val capped = current.take(100)
        _historyFlow.value = capped
        prefs.edit().putString("key_history", gson.toJson(capped)).apply()
    }

    fun removeHistory(vodId: String, sourceId: String) {
        val current = _historyFlow.value.toMutableList()
        current.removeAll { it.vodId == vodId && it.sourceId == sourceId }
        _historyFlow.value = current
        prefs.edit().putString("key_history", gson.toJson(current)).apply()
    }

    fun clearHistory() {
        _historyFlow.value = emptyList()
        prefs.edit().remove("key_history").apply()
    }

    fun toggleFavorite(item: FavoriteItem): Boolean {
        val current = _favoritesFlow.value.toMutableList()
        val existingIndex = current.indexOfFirst { it.vodId == item.vodId && it.sourceId == item.sourceId }
        val isAdded = if (existingIndex >= 0) {
            current.removeAt(existingIndex)
            false
        } else {
            current.add(0, item)
            true
        }
        _favoritesFlow.value = current
        prefs.edit().putString("key_favorites", gson.toJson(current)).apply()
        return isAdded
    }

    fun isFavorite(vodId: String, sourceId: String): Boolean {
        return _favoritesFlow.value.any { it.vodId == vodId && it.sourceId == sourceId }
    }

    fun saveSettings(settings: AppSettings) {
        _settingsFlow.value = settings
        prefs.edit().putString("key_settings", gson.toJson(settings)).apply()
    }

    fun addSubscription(name: String, url: String) {
        val cleanUrl = url.trim()
        val sub = SubscriptionItem(
            id = "sub_${System.currentTimeMillis()}",
            name = if (name.isBlank()) "远程订阅 ${(_subscriptionsFlow.value.size + 1)}" else name,
            url = cleanUrl
        )
        val updated = _subscriptionsFlow.value + sub
        _subscriptionsFlow.value = updated
        prefs.edit().putString("key_subscriptions", gson.toJson(updated)).apply()
    }

    fun deleteSubscription(subId: String) {
        val updatedSubs = _subscriptionsFlow.value.filter { it.id != subId }
        _subscriptionsFlow.value = updatedSubs
        prefs.edit().putString("key_subscriptions", gson.toJson(updatedSubs)).apply()

        // Also delete all sources imported from this subscription
        val updatedSources = _sourcesFlow.value.filter { it.subscriptionId != subId }
        saveSources(updatedSources)
    }

    suspend fun syncSubscription(subId: String): Int = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val sub = _subscriptionsFlow.value.find { it.id == subId } ?: return@withContext 0
        try {
            val request = okhttp3.Request.Builder()
                .url(sub.url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/128.0.0.0")
                .build()

            val response = httpClient.newCall(request).execute()
            val body = response.body?.string() ?: throw Exception("订阅源内容为空")

            val newSources = mutableListOf<Source>()
            try {
                val type = object : TypeToken<List<Source>>() {}.type
                val directList: List<Source> = gson.fromJson(body, type)
                directList.forEach { s ->
                    newSources.add(s.copy(subscriptionId = subId, group = if (s.group.isBlank()) sub.name else s.group))
                }
            } catch (e: Exception) {
                try {
                    val bundle = gson.fromJson(body, SharedSourceBundle::class.java)
                    bundle.sources.forEach { s ->
                        val cleanApi = s.apiUrl ?: s.api ?: ""
                        if (cleanApi.isNotBlank()) {
                            newSources.add(
                                Source(
                                    id = if (s.id.isBlank()) "sub_${subId}_${s.name.hashCode()}" else s.id,
                                    name = s.name,
                                    apiUrl = cleanApi,
                                    apiType = s.apiType ?: "json",
                                    enabled = true,
                                    group = s.group ?: bundle.name ?: sub.name,
                                    adultTypeIds = s.adultTypeIds,
                                    categoryMapping = s.categoryMapping,
                                    subscriptionId = subId
                                )
                            )
                        }
                    }
                } catch (e2: Exception) {
                    throw Exception("订阅源格式无法识别")
                }
            }

            // Remove old sources belonging to this subscription and append new ones
            val nonSubSources = _sourcesFlow.value.filter { it.subscriptionId != subId }
            saveSources(nonSubSources + newSources)

            // Update subscription item
            val updatedSubs = _subscriptionsFlow.value.map {
                if (it.id == subId) {
                    it.copy(
                        lastUpdated = System.currentTimeMillis(),
                        sourceCount = newSources.size,
                        errorMsg = null
                    )
                } else it
            }
            _subscriptionsFlow.value = updatedSubs
            prefs.edit().putString("key_subscriptions", gson.toJson(updatedSubs)).apply()

            newSources.size
        } catch (e: Exception) {
            val updatedSubs = _subscriptionsFlow.value.map {
                if (it.id == subId) {
                    it.copy(errorMsg = e.message ?: "同步失败")
                } else it
            }
            _subscriptionsFlow.value = updatedSubs
            prefs.edit().putString("key_subscriptions", gson.toJson(updatedSubs)).apply()
            throw e
        }
    }

    suspend fun syncAllSubscriptions(): Int {
        var totalImported = 0
        _subscriptionsFlow.value.filter { it.enabled }.forEach { sub ->
            try {
                totalImported += syncSubscription(sub.id)
            } catch (e: Exception) {
                // Ignore individual failure
            }
        }
        return totalImported
    }
}
