package cn.wty5.movies.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.wty5.movies.api.AppleCmsClient
import cn.wty5.movies.model.*
import cn.wty5.movies.repository.MovieRepository
import cn.wty5.movies.ui.components.EmptyView
import cn.wty5.movies.ui.components.VodCard
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(
    repository: MovieRepository,
    client: AppleCmsClient,
    onPlayVod: (VodItem) -> Unit
) {
    val activeSource by repository.activeSourceFlow.collectAsState()
    val taxonomy by repository.taxonomyFlow.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var selectedLocalCatId by remember { mutableStateOf("all") }
    var currentPage by remember { mutableIntStateOf(1) }
    var pageCount by remember { mutableIntStateOf(1) }
    var totalCount by remember { mutableIntStateOf(0) }
    var items by remember { mutableStateOf<List<VodItem>>(emptyList()) }
    var classes by remember { mutableStateOf<List<Category>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Resolve visible categories (filter out 18+ if adult mode is off)
    val displayCategories = remember(taxonomy) {
        val list = taxonomy.safeCategories.toMutableList()
        if (!taxonomy.adultMode) {
            list.removeAll { it.bindTags.contains("#18plus") || it.id == "18plus" }
        }
        list
    }

    // Load classes for active source
    LaunchedEffect(activeSource?.id) {
        activeSource?.let { src ->
            try {
                val fetched = client.fetchClasses(src)
                if (fetched.isNotEmpty()) classes = fetched
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    // Determine subcategory IDs for selected local category
    val effectiveTypeId = remember(selectedLocalCatId, classes, activeSource, taxonomy) {
        if (selectedLocalCatId == "all") return@remember null
        val localCat = displayCategories.find { it.id == selectedLocalCatId } ?: return@remember null
        val bindTags = localCat.bindTags

        val matched = classes.filter { c ->
            var matchedTag: String? = null
            activeSource?.safeCategoryMapping?.forEach { (tag, ids) ->
                if (ids.contains(c.typeId)) matchedTag = tag
            }
            if (bindTags.contains("#18plus") && activeSource?.safeAdultTypeIds?.contains(c.typeId) == true) {
                true
            } else {
                matchedTag != null && bindTags.contains(matchedTag)
            }
        }

        if (matched.isEmpty()) return@remember "EMPTY_MATCH"

        // Filter out container categories that have children
        val parentIdsWithChildren = classes.mapNotNull { it.typePid }.filter { it != "0" && it.isNotEmpty() }.toSet()
        val realSubcategories = matched.filter { !parentIdsWithChildren.contains(it.typeId) && it.typeName != localCat.name }
        val targets = if (realSubcategories.isNotEmpty()) realSubcategories else matched
        targets.map { it.typeId }.joinToString(",")
    }

    val loadData = remember(activeSource?.id, effectiveTypeId, currentPage) {
        {
            activeSource?.let { src ->
                if (effectiveTypeId == "EMPTY_MATCH") {
                    items = emptyList()
                    totalCount = 0
                    pageCount = 1
                    isLoading = false
                } else {
                    isLoading = true
                    errorMessage = null
                    coroutineScope.launch {
                        try {
                            val res = client.fetchVodList(
                                source = src,
                                typeId = effectiveTypeId,
                                page = currentPage
                            )
                            items = res.safeList
                            totalCount = res.total
                            pageCount = res.pagecount
                            if (res.safeClasses.isNotEmpty()) {
                                classes = res.safeClasses
                            }
                        } catch (e: Exception) {
                            errorMessage = e.message ?: "加载影片失败"
                        } finally {
                            isLoading = false
                        }
                    }
                }
            }
        }
    }

    LaunchedEffect(activeSource?.id, effectiveTypeId, currentPage) {
        loadData()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Channel Selector Pills
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            FilterChip(
                selected = selectedLocalCatId == "all",
                onClick = {
                    selectedLocalCatId = "all"
                    currentPage = 1
                },
                label = { Text("全部", fontSize = 12.sp) }
            )

            displayCategories.forEach { cat ->
                val isSelected = selectedLocalCatId == cat.id
                val isAdult = cat.id == "18plus" || cat.bindTags.contains("#18plus")
                FilterChip(
                    selected = isSelected,
                    onClick = {
                        selectedLocalCatId = cat.id
                        currentPage = 1
                    },
                    label = {
                        Text(
                            text = if (isAdult) "🔥 ${cat.name}" else cat.name,
                            fontSize = 12.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                        )
                    },
                    colors = if (isAdult) {
                        FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.error,
                            selectedLabelColor = MaterialTheme.colorScheme.onError
                        )
                    } else FilterChipDefaults.filterChipColors()
                )
            }
        }

        // Content Area
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                isLoading && items.isEmpty() -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(36.dp))
                    }
                }
                errorMessage != null && items.isEmpty() -> {
                    EmptyView(
                        message = "资源拉取失败",
                        subMessage = errorMessage,
                        onAction = { loadData() },
                        actionText = "重试",
                        modifier = Modifier.fillMaxSize()
                    )
                }
                items.isEmpty() -> {
                    EmptyView(
                        message = if (effectiveTypeId == "EMPTY_MATCH") "当前分类在此源下未绑定映射" else "暂无影片资源",
                        subMessage = if (effectiveTypeId == "EMPTY_MATCH") "您可在【设置 -> 采集源管理】中配置该源的分类映射" else "请尝试切换其它分类或采集源",
                        modifier = Modifier.fillMaxSize()
                    )
                }
                else -> {
                    Column(modifier = Modifier.fillMaxSize()) {
                        // Total count subtitle
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "共 $totalCount 部影视 · 第 $currentPage / $pageCount 页",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )

                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (currentPage > 1) {
                                    TextButton(onClick = { currentPage-- }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                                        Text("上一页", fontSize = 11.sp)
                                    }
                                }
                                if (currentPage < pageCount) {
                                    TextButton(onClick = { currentPage++ }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                                        Text("下一页", fontSize = 11.sp)
                                    }
                                }
                            }
                        }

                        LazyVerticalGrid(
                            columns = GridCells.Fixed(3),
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 12.dp),
                            contentPadding = PaddingValues(bottom = 80.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            items(items, key = { it.vodId }) { vod ->
                                VodCard(
                                    vod = vod,
                                    onClick = { onPlayVod(vod) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
