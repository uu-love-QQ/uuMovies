package cn.wty5.movies

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.wty5.movies.api.AppleCmsClient
import cn.wty5.movies.model.*
import cn.wty5.movies.repository.MovieRepository
import cn.wty5.movies.ui.screens.*
import cn.wty5.movies.ui.theme.UuMoviesTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var repository: MovieRepository
    private val client = AppleCmsClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        repository = MovieRepository(applicationContext)

        setContent {
            UuMoviesTheme {
                MainApp(repository = repository, client = client)
            }
        }
    }
}

enum class ScreenTab(val title: String) {
    HOME("影院"),
    CATEGORIES("分类"),
    SEARCH("搜索"),
    LIBRARY("我的"),
    SETTINGS("设置")
}

data class PlayerState(
    val vod: VodItem,
    val lineIndex: Int = 0,
    val episodeIndex: Int = 0,
    val initialTimeSeconds: Long = 0
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainApp(
    repository: MovieRepository,
    client: AppleCmsClient
) {
    val sources by repository.sourcesFlow.collectAsState()
    val activeSource by repository.activeSourceFlow.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var currentTab by remember { mutableStateOf(ScreenTab.HOME) }
    var activePlayer by remember { mutableStateOf<PlayerState?>(null) }
    var showSourceSheet by remember { mutableStateOf(false) }

    // Quick play handler: load full detail if needed then launch player
    val playVod: (VodItem, Int, Int, Long) -> Unit = { item, lineIdx, epIdx, initialSec ->
        coroutineScope.launch {
            var fullVod = item
            if (fullVod.safePlayLines.isEmpty()) {
                val targetSource = sources.find { it.id == item.sourceId } ?: activeSource
                if (targetSource != null) {
                    try {
                        val detail = client.fetchVodDetail(targetSource, item.vodId)
                        fullVod = detail
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }
            if (fullVod.safePlayLines.isEmpty() && !fullVod.vodPlayUrl.isNullOrBlank()) {
                val parsedLines = client.parsePlayLines(fullVod.vodPlayFrom ?: "", fullVod.vodPlayUrl ?: "")
                if (parsedLines.isNotEmpty()) {
                    fullVod = fullVod.copy(playLines = parsedLines)
                }
            }
            activePlayer = PlayerState(
                vod = fullVod,
                lineIndex = lineIdx,
                episodeIndex = epIdx,
                initialTimeSeconds = initialSec
            )
        }
    }

    if (activePlayer != null) {
        val playerState = activePlayer!!
        BackHandler {
            activePlayer = null
        }
        PlayerScreen(
            vod = playerState.vod,
            initialLineIndex = playerState.lineIndex,
            initialEpisodeIndex = playerState.episodeIndex,
            initialTimeSeconds = playerState.initialTimeSeconds,
            repository = repository,
            client = client,
            onClose = { activePlayer = null }
        )
    } else {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = "uuMovies",
                                fontWeight = FontWeight.Black,
                                fontSize = 18.sp,
                                color = MaterialTheme.colorScheme.primary
                            )

                            // Source Switcher Pill
                            Surface(
                                shape = RoundedCornerShape(16.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                modifier = Modifier.clickable { showSourceSheet = true }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(6.dp)
                                            .clip(RoundedCornerShape(3.dp))
                                            .background(Color(0xFF4CAF50))
                                    )
                                    Text(
                                        text = activeSource?.name ?: "切换源",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Icon(
                                        imageVector = Icons.Default.ArrowDropDown,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(14.dp)
                                    )
                                }
                            }
                        }
                    },
                    actions = {
                        if (currentTab != ScreenTab.SEARCH) {
                            IconButton(onClick = { currentTab = ScreenTab.SEARCH }) {
                                Icon(imageVector = Icons.Default.Search, contentDescription = "搜索")
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                )
            },
            bottomBar = {
                NavigationBar(
                    tonalElevation = 4.dp,
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    NavigationBarItem(
                        selected = currentTab == ScreenTab.HOME,
                        onClick = { currentTab = ScreenTab.HOME },
                        icon = { Icon(imageVector = if (currentTab == ScreenTab.HOME) Icons.Filled.Movie else Icons.Outlined.Movie, contentDescription = null) },
                        label = { Text("影院") }
                    )
                    NavigationBarItem(
                        selected = currentTab == ScreenTab.CATEGORIES,
                        onClick = { currentTab = ScreenTab.CATEGORIES },
                        icon = { Icon(imageVector = if (currentTab == ScreenTab.CATEGORIES) Icons.Filled.Explore else Icons.Outlined.Explore, contentDescription = null) },
                        label = { Text("分类") }
                    )
                    NavigationBarItem(
                        selected = currentTab == ScreenTab.SEARCH,
                        onClick = { currentTab = ScreenTab.SEARCH },
                        icon = { Icon(imageVector = Icons.Default.Search, contentDescription = null) },
                        label = { Text("搜索") }
                    )
                    NavigationBarItem(
                        selected = currentTab == ScreenTab.LIBRARY,
                        onClick = { currentTab = ScreenTab.LIBRARY },
                        icon = { Icon(imageVector = if (currentTab == ScreenTab.LIBRARY) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, contentDescription = null) },
                        label = { Text("我的") }
                    )
                    NavigationBarItem(
                        selected = currentTab == ScreenTab.SETTINGS,
                        onClick = { currentTab = ScreenTab.SETTINGS },
                        icon = { Icon(imageVector = if (currentTab == ScreenTab.SETTINGS) Icons.Filled.Settings else Icons.Outlined.Settings, contentDescription = null) },
                        label = { Text("设置") }
                    )
                }
            }
        ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
                when (currentTab) {
                    ScreenTab.HOME -> {
                        HomeScreen(
                            repository = repository,
                            client = client,
                            onPlayVod = { playVod(it, 0, 0, 0) }
                        )
                    }
                    ScreenTab.CATEGORIES -> {
                        CategoriesScreen(
                            repository = repository,
                            client = client,
                            onPlayVod = { playVod(it, 0, 0, 0) }
                        )
                    }
                    ScreenTab.SEARCH -> {
                        SearchScreen(
                            repository = repository,
                            client = client,
                            onPlayVod = { playVod(it, 0, 0, 0) }
                        )
                    }
                    ScreenTab.LIBRARY -> {
                        LibraryScreen(
                            repository = repository,
                            onResumeHistory = { h: PlayHistoryItem ->
                                val fallbackLines = if (!h.playUrl.isNullOrBlank()) {
                                    val episodes = mutableListOf<Episode>()
                                    for (i in 0..h.episodeIndex) {
                                        if (i == h.episodeIndex) {
                                            episodes.add(Episode(name = h.episodeName, url = h.playUrl))
                                        } else {
                                            episodes.add(Episode(name = "第${i + 1}集", url = ""))
                                        }
                                    }
                                    val lines = mutableListOf<PlayLine>()
                                    for (l in 0..h.lineIndex) {
                                        if (l == h.lineIndex) {
                                            lines.add(PlayLine(from = h.sourceId, title = h.lineTitle.ifBlank { "历史线路" }, episodes = episodes))
                                        } else {
                                            lines.add(PlayLine(from = "default", title = "线路 ${l + 1}", episodes = emptyList<Episode>()))
                                        }
                                    }
                                    lines
                                } else {
                                    emptyList<PlayLine>()
                                }
                                val vod = VodItem(
                                    vodId = h.vodId,
                                    vodName = h.vodName,
                                    vodPic = h.vodPic,
                                    sourceId = h.sourceId,
                                    sourceName = h.sourceName,
                                    playLines = fallbackLines
                                )
                                playVod(vod, h.lineIndex, h.episodeIndex, h.progressSeconds)
                            },
                            onPlayFavorite = { fav ->
                                val vod = VodItem(
                                    vodId = fav.vodId,
                                    vodName = fav.vodName,
                                    vodPic = fav.vodPic,
                                    sourceId = fav.sourceId,
                                    sourceName = fav.sourceName,
                                    typeName = fav.typeName ?: "影视",
                                    vodRemarks = fav.vodRemarks
                                )
                                playVod(vod, 0, 0, 0)
                            }
                        )
                    }
                    ScreenTab.SETTINGS -> {
                        SettingsScreen(
                            repository = repository,
                            client = client
                        )
                    }
                }
            }
        }

        // Source Switcher Modal Bottom Sheet
        if (showSourceSheet) {
            ModalBottomSheet(
                onDismissRequest = { showSourceSheet = false }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp)
                ) {
                    Text(
                        text = "切换视频采集源",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                    Text(
                        text = "当前有 ${sources.count { it.enabled }} 个可用采集源",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(12.dp))

                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(bottom = 24.dp)
                    ) {
                        items(sources.filter { it.enabled }) { src ->
                            val isSelected = src.id == activeSource?.id
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(
                                        if (isSelected) MaterialTheme.colorScheme.primaryContainer
                                        else MaterialTheme.colorScheme.surfaceVariant
                                    )
                                    .clickable {
                                        repository.setActiveSource(src.id)
                                        showSourceSheet = false
                                    }
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = src.name,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                        fontSize = 14.sp,
                                        color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface
                                    )
                                    Text(
                                        text = "${src.group} · ${src.apiUrl}",
                                        fontSize = 10.sp,
                                        color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f) else MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1
                                    )
                                }
                                if (isSelected) {
                                    Icon(
                                        imageVector = Icons.Default.Check,
                                        contentDescription = "已选中",
                                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
