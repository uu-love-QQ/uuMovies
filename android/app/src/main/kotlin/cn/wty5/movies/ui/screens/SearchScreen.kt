package cn.wty5.movies.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.wty5.movies.api.AppleCmsClient
import cn.wty5.movies.model.VodItem
import cn.wty5.movies.repository.MovieRepository
import cn.wty5.movies.ui.components.EmptyView
import cn.wty5.movies.ui.components.VodCard
import kotlinx.coroutines.launch

@Composable
fun SearchScreen(
    repository: MovieRepository,
    client: AppleCmsClient,
    onPlayVod: (VodItem) -> Unit
) {
    val sources by repository.sourcesFlow.collectAsState()
    val coroutineScope = rememberCoroutineScope()
    val keyboardController = LocalSoftwareKeyboardController.current

    var query by remember { mutableStateOf("") }
    var isSearching by remember { mutableStateOf(false) }
    var searchResults by remember { mutableStateOf<List<VodItem>>(emptyList()) }
    var selectedSourceId by remember { mutableStateOf<String?>("all") }
    var hasSearched by remember { mutableStateOf(false) }

    val doSearch: () -> Unit = {
        val trimmed = query.trim()
        if (trimmed.isNotEmpty()) {
            hasSearched = true
            isSearching = true
            keyboardController?.hide()
            coroutineScope.launch {
                try {
                    val results = client.searchAcrossSources(sources, trimmed)
                    searchResults = results
                } catch (e: Exception) {
                    searchResults = emptyList()
                } finally {
                    isSearching = false
                }
            }
        }
    }

    val filteredResults = remember(searchResults, selectedSourceId) {
        if (selectedSourceId == null || selectedSourceId == "all") {
            searchResults
        } else {
            searchResults.filter { it.sourceId == selectedSourceId }
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Search bar
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            placeholder = { Text("搜索全网电影、电视剧、演员...", fontSize = 13.sp) },
            leadingIcon = {
                Icon(imageVector = Icons.Default.Search, contentDescription = "搜索")
            },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { query = "" }) {
                        Icon(imageVector = Icons.Default.Clear, contentDescription = "清空")
                    }
                }
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { doSearch() }),
            shape = MaterialTheme.shapes.medium
        )

        // Sources filter chips
        if (searchResults.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                FilterChip(
                    selected = selectedSourceId == "all",
                    onClick = { selectedSourceId = "all" },
                    label = { Text("全部来源 (${searchResults.size})", fontSize = 11.sp) }
                )
                val foundSources = searchResults.mapNotNull { it.sourceId }.distinct()
                foundSources.forEach { sid ->
                    val srcName = sources.find { it.id == sid }?.name ?: sid
                    val count = searchResults.count { it.sourceId == sid }
                    FilterChip(
                        selected = selectedSourceId == sid,
                        onClick = { selectedSourceId = sid },
                        label = { Text("$srcName ($count)", fontSize = 11.sp) }
                    )
                }
            }
        }

        // Results area
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                isSearching -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(modifier = Modifier.size(36.dp))
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                text = "正在全网多源并行搜索中...",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                hasSearched && filteredResults.isEmpty() -> {
                    EmptyView(
                        message = "未搜索到相关影视资源",
                        subMessage = "请尝试更换关键词，或在设置中启用更多采集源",
                        modifier = Modifier.fillMaxSize()
                    )
                }
                !hasSearched -> {
                    EmptyView(
                        message = "输入片名或演员开始搜索",
                        subMessage = "将并发穿透全部已启用的苹果CMS资源站",
                        modifier = Modifier.fillMaxSize()
                    )
                }
                else -> {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 12.dp),
                        contentPadding = PaddingValues(bottom = 80.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(filteredResults, key = { "${it.vodId}__${it.sourceId}" }) { vod ->
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
