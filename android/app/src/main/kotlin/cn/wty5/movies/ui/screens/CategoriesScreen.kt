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
import cn.wty5.movies.model.Category
import cn.wty5.movies.model.VodItem
import cn.wty5.movies.repository.MovieRepository
import cn.wty5.movies.ui.components.EmptyView
import cn.wty5.movies.ui.components.VodCard
import kotlinx.coroutines.launch

@Composable
fun CategoriesScreen(
    repository: MovieRepository,
    client: AppleCmsClient,
    onPlayVod: (VodItem) -> Unit
) {
    val activeSource by repository.activeSourceFlow.collectAsState()
    val taxonomy by repository.taxonomyFlow.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var selectedLocalCatId by remember { mutableStateOf("movie") }
    var selectedSubId by remember { mutableStateOf("all") }
    var currentPage by remember { mutableIntStateOf(1) }
    var pageCount by remember { mutableIntStateOf(1) }
    var totalCount by remember { mutableIntStateOf(0) }
    var items by remember { mutableStateOf<List<VodItem>>(emptyList()) }
    var classes by remember { mutableStateOf<List<Category>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val displayCategories = remember(taxonomy) {
        val list = taxonomy.categories.toMutableList()
        if (!taxonomy.adultMode) {
            list.removeAll { it.bindTags.contains("#18plus") || it.id == "18plus" }
        }
        list
    }

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

    val activeLocalCat = remember(selectedLocalCatId, displayCategories) {
        displayCategories.find { it.id == selectedLocalCatId }
    }

    // Subcategories for active local channel
    val mappedSubCategories = remember(activeLocalCat, classes, activeSource) {
        if (activeLocalCat == null) return@remember emptyList()
        val bindTags = activeLocalCat.bindTags

        val matched = classes.filter { c ->
            var matchedTag: String? = null
            activeSource?.categoryMapping?.forEach { (tag, ids) ->
                if (ids.contains(c.typeId)) matchedTag = tag
            }
            if (bindTags.contains("#18plus") && activeSource?.adultTypeIds?.contains(c.typeId) == true) {
                true
            } else {
                matchedTag != null && bindTags.contains(matchedTag)
            }
        }

        val parentIdsWithChildren = classes.mapNotNull { it.typePid }.filter { it != "0" && it.isNotEmpty() }.toSet()
        val realSubs = matched.filter { !parentIdsWithChildren.contains(it.typeId) && it.typeName != activeLocalCat.name }
        if (realSubs.isNotEmpty()) realSubs else matched
    }

    // Determine query typeId
    val effectiveTypeId = remember(selectedSubId, mappedSubCategories) {
        if (selectedSubId != "all") {
            selectedSubId
        } else {
            if (mappedSubCategories.isEmpty()) {
                "EMPTY_MATCH"
            } else {
                mappedSubCategories.map { it.typeId }.joinToString(",")
            }
        }
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
                            items = res.list
                            totalCount = res.total
                            pageCount = res.pagecount
                            if (res.classes.isNotEmpty()) classes = res.classes
                        } catch (e: Exception) {
                            errorMessage = e.message ?: "获取分类视频失败"
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
        // Row 1: Channel Tabs
        ScrollableTabRow(
            selectedTabIndex = displayCategories.indexOfFirst { it.id == selectedLocalCatId }.coerceAtLeast(0),
            edgePadding = 12.dp,
            divider = {}
        ) {
            displayCategories.forEach { cat ->
                val isSelected = selectedLocalCatId == cat.id
                val isAdult = cat.id == "18plus" || cat.bindTags.contains("#18plus")
                Tab(
                    selected = isSelected,
                    onClick = {
                        selectedLocalCatId = cat.id
                        selectedSubId = "all"
                        currentPage = 1
                    },
                    text = {
                        Text(
                            text = if (isAdult) "🔥 ${cat.name}" else cat.name,
                            fontSize = 13.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                )
            }
        }

        // Row 2: Subcategory Pills (Level 2)
        if (activeLocalCat != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (mappedSubCategories.isNotEmpty()) {
                    FilterChip(
                        selected = selectedSubId == "all",
                        onClick = {
                            selectedSubId = "all"
                            currentPage = 1
                        },
                        label = { Text("全部${activeLocalCat.name}", fontSize = 11.sp) }
                    )
                    mappedSubCategories.forEach { sub ->
                        FilterChip(
                            selected = selectedSubId == sub.typeId,
                            onClick = {
                                selectedSubId = sub.typeId
                                currentPage = 1
                            },
                            label = { Text(sub.typeName, fontSize = 11.sp) }
                        )
                    }
                } else {
                    Text(
                        text = "当前采集源尚未为此频道映射细分类别",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                }
            }
        }

        HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))

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
                        message = if (effectiveTypeId == "EMPTY_MATCH") "【${activeLocalCat?.name}】在此源下未绑定映射" else "暂无该分类的影视资源",
                        subMessage = if (effectiveTypeId == "EMPTY_MATCH") "您可在【设置 -> 采集源管理】中配置分类映射" else "请尝试切换其它分类或采集源",
                        modifier = Modifier.fillMaxSize()
                    )
                }
                else -> {
                    Column(modifier = Modifier.fillMaxSize()) {
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
