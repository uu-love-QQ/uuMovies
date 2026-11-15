package cn.wty5.movies.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.wty5.movies.model.FavoriteItem
import cn.wty5.movies.model.PlayHistoryItem
import cn.wty5.movies.model.VodItem
import cn.wty5.movies.repository.MovieRepository
import cn.wty5.movies.ui.components.EmptyView
import cn.wty5.movies.ui.components.VodCard
import coil.compose.AsyncImage

@Composable
fun LibraryScreen(
    repository: MovieRepository,
    onResumeHistory: (PlayHistoryItem) -> Unit,
    onPlayFavorite: (FavoriteItem) -> Unit
) {
    val history by repository.historyFlow.collectAsState()
    val favorites by repository.favoritesFlow.collectAsState()
    var selectedTab by remember { mutableIntStateOf(0) } // 0: 历史, 1: 收藏

    Column(modifier = Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = selectedTab) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text("播放历史 (${history.size})", fontSize = 13.sp) }
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = { Text("我的收藏 (${favorites.size})", fontSize = 13.sp) }
            )
        }

        Box(modifier = Modifier.fillMaxSize()) {
            if (selectedTab == 0) {
                // History List
                if (history.isEmpty()) {
                    EmptyView(
                        message = "暂无播放历史记录",
                        subMessage = "观看到的影片和播放进度将自动保存在这里",
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Column(modifier = Modifier.fillMaxSize()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "共 ${history.size} 条历史记录",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            TextButton(
                                onClick = { repository.clearHistory() },
                                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                            ) {
                                Icon(imageVector = Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("清空历史", fontSize = 12.sp)
                            }
                        }

                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(history, key = { "${it.vodId}__${it.sourceId}" }) { item ->
                                HistoryItemCard(
                                    item = item,
                                    onResume = { onResumeHistory(item) },
                                    onDelete = { repository.removeHistory(item.vodId, item.sourceId) }
                                )
                            }
                        }
                    }
                }
            } else {
                // Favorites Grid
                if (favorites.isEmpty()) {
                    EmptyView(
                        message = "暂无收藏的影视",
                        subMessage = "在影片详情中点击收藏，喜欢的剧集都在这里",
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(12.dp),
                        contentPadding = PaddingValues(bottom = 80.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(favorites, key = { "${it.vodId}__${it.sourceId}" }) { fav ->
                            VodCard(
                                vod = VodItem(
                                    vodId = fav.vodId,
                                    vodName = fav.vodName,
                                    vodPic = fav.vodPic,
                                    typeName = fav.typeName ?: "影视",
                                    vodRemarks = fav.vodRemarks,
                                    sourceId = fav.sourceId,
                                    sourceName = fav.sourceName
                                ),
                                onClick = { onPlayFavorite(fav) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun HistoryItemCard(
    item: PlayHistoryItem,
    onResume: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onResume),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Poster
            Box(
                modifier = Modifier
                    .width(64.dp)
                    .aspectRatio(0.7f)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color(0xFF222426))
            ) {
                if (!item.vodPic.isNullOrBlank()) {
                    AsyncImage(
                        model = item.vodPic,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.vodName,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "${item.episodeName} · ${item.sourceName}",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(6.dp))

                val progressRatio = if (item.durationSeconds > 0) {
                    (item.progressSeconds.toFloat() / item.durationSeconds.toFloat()).coerceIn(0f, 1f)
                } else 0f

                LinearProgressIndicator(
                    progress = { progressRatio },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp)),
                )

                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = "观看至 ${formatSeconds(item.progressSeconds)}",
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                )
            }

            IconButton(onClick = onDelete) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "删除记录",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

private fun formatSeconds(sec: Long): String {
    val m = sec / 60
    val s = sec % 60
    return String.format("%02d:%02d", m, s)
}
