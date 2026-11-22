package cn.wty5.movies.ui.screens

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import cn.wty5.movies.model.Episode
import cn.wty5.movies.model.PlayHistoryItem
import cn.wty5.movies.model.PlayLine
import cn.wty5.movies.model.VodItem
import cn.wty5.movies.repository.MovieRepository
import cn.wty5.movies.cast.DlnaDevice
import cn.wty5.movies.cast.DlnaManager
import cn.wty5.movies.cast.CastProxyServer
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    vod: VodItem,
    initialLineIndex: Int = 0,
    initialEpisodeIndex: Int = 0,
    initialTimeSeconds: Long = 0,
    repository: MovieRepository,
    client: cn.wty5.movies.api.AppleCmsClient,
    onClose: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? Activity
    val audioManager = remember { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }

    val allSources by repository.sourcesFlow.collectAsState()
    val playLines = remember(vod.vodId) { mutableStateListOf<PlayLine>().apply { addAll(vod.playLines) } }

    var currentLineIdx by remember(vod.vodId) {
        mutableIntStateOf(initialLineIndex.coerceIn(0, (vod.playLines.size - 1).coerceAtLeast(0)))
    }
    var currentEpIdx by remember(vod.vodId) {
        mutableIntStateOf(initialEpisodeIndex)
    }

    // Discover cross-station alternative lines from other enabled sources
    LaunchedEffect(vod.vodId) {
        try {
            val otherLines = client.aggregateCrossStationLines(allSources, vod.vodName, vod.sourceId)
            val existingKeys = playLines.map { "${it.from}__${it.title}" }.toSet()
            otherLines.forEach { line ->
                if (!existingKeys.contains("${line.from}__${line.title}")) {
                    playLines.add(line)
                }
            }
        } catch (e: Exception) {
            // Ignore
        }
    }

    val currentLine: PlayLine? = playLines.getOrNull(currentLineIdx) ?: playLines.firstOrNull()
    val currentEpisode: Episode? = currentLine?.episodes?.getOrNull(currentEpIdx) ?: currentLine?.episodes?.firstOrNull()

    // Player state
    var isPlaying by remember { mutableStateOf(true) }
    var currentPosition by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var showControls by remember { mutableStateOf(true) }
    var playbackSpeed by remember { mutableFloatStateOf(1.0f) }
    var isFullscreen by remember { mutableStateOf(false) }

    // HUD overlays
    var volumeHud by remember { mutableStateOf<Int?>(null) }
    var brightnessHud by remember { mutableStateOf<Int?>(null) }
    var showEpisodesDialog by remember { mutableStateOf(false) }
    var showLinesDialog by remember { mutableStateOf(false) }
    var showSpeedDialog by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showCastDialog by remember { mutableStateOf(false) }
    var activeCastDevice by remember { mutableStateOf<DlnaDevice?>(null) }
    val coroutineScope = rememberCoroutineScope()

    // Ad-filtering OkHttpClient for stripping M3U8 in-video ads
    val adFilteringHttpClient = remember {
        okhttp3.OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
            .addInterceptor(cn.wty5.movies.player.M3u8AdFilter.Interceptor())
            .build()
    }

    // Initialize ExoPlayer with standard DefaultDataSource wrapping OkHttpDataSource
    val exoPlayer = remember {
        val okHttpDataSourceFactory = androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(adFilteringHttpClient)
            .setUserAgent("Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/128.0.0.0")

        val defaultDataSourceFactory = androidx.media3.datasource.DefaultDataSource.Factory(
            context.applicationContext,
            okHttpDataSourceFactory
        )

        val mediaSourceFactory = androidx.media3.exoplayer.source.DefaultMediaSourceFactory(context.applicationContext)
            .setDataSourceFactory(defaultDataSourceFactory)

        ExoPlayer.Builder(context.applicationContext)
            .setMediaSourceFactory(mediaSourceFactory)
            .build().apply {
                playWhenReady = true
            }
    }

    // Auto-save history helper
    fun saveProgressNow() {
        try {
            val ep = currentEpisode ?: return
            val posSec = exoPlayer.currentPosition / 1000
            val durSec = (exoPlayer.duration.takeIf { it > 0 } ?: 0L) / 1000
            if (posSec > 0) {
                repository.saveHistory(
                    PlayHistoryItem(
                        vodId = vod.vodId,
                        sourceId = vod.sourceId ?: "",
                        sourceName = vod.sourceName ?: "默认源",
                        vodName = vod.vodName,
                        vodPic = vod.vodPic,
                        lineIndex = currentLineIdx,
                        lineTitle = currentLine?.title ?: "默认线路",
                        episodeIndex = currentEpIdx,
                        episodeName = ep.name,
                        progressSeconds = posSec,
                        durationSeconds = durSec
                    )
                )
            }
        } catch (e: Exception) {
            // Ignore during disposal
        }
    }

    // Load stream URL
    LaunchedEffect(currentEpisode?.url) {
        val url = currentEpisode?.url?.trim()
        if (!url.isNullOrBlank()) {
            errorMessage = null
            try {
                val mediaItem = MediaItem.fromUri(Uri.parse(url))
                exoPlayer.setMediaItem(mediaItem)
                exoPlayer.prepare()

                if (initialTimeSeconds > 0) {
                    exoPlayer.seekTo(initialTimeSeconds * 1000)
                }
                exoPlayer.play()
            } catch (t: Throwable) {
                errorMessage = t.message ?: "播放失败，请尝试换线"
            }
        } else if (currentEpisode != null) {
            errorMessage = "该剧集播放地址为空，请尝试换线"
        }
    }

    // Player event listeners
    DisposableEffect(exoPlayer) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }

            override fun onPlayerError(error: PlaybackException) {
                errorMessage = "播放错误: ${error.message ?: "媒体流解码异常，请换源重试"}"
            }
        }
        exoPlayer.addListener(listener)

        onDispose {
            try {
                saveProgressNow()
                exoPlayer.removeListener(listener)
                exoPlayer.stop()
                exoPlayer.clearMediaItems()
                exoPlayer.release()
            } catch (e: Exception) {
                // Ignore
            }
            try {
                activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                CastProxyServer.stop()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    // Position updater loop & periodic autosave
    LaunchedEffect(exoPlayer) {
        while (true) {
            try {
                currentPosition = exoPlayer.currentPosition.coerceAtLeast(0L)
                duration = exoPlayer.duration.coerceAtLeast(0L)
                saveProgressNow()
            } catch (e: Exception) {
                break
            }
            delay(1000)
        }
    }

    // Auto-hide controls after 5 seconds
    LaunchedEffect(showControls) {
        if (showControls) {
            delay(5000)
            showControls = false
        }
    }

    // Fullscreen orientation handler
    fun toggleFullscreen() {
        val next = !isFullscreen
        isFullscreen = next
        activity?.requestedOrientation = if (next) {
            ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                var totalDragY = 0f
                var isRightSide = false
                detectDragGestures(
                    onDragStart = { offset ->
                        totalDragY = 0f
                        isRightSide = offset.x > size.width / 2
                    },
                    onDragEnd = {
                        volumeHud = null
                        brightnessHud = null
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        totalDragY -= dragAmount.y
                        val delta = dragAmount.y / size.height

                        if (isRightSide) {
                            val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                            val curVol = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
                            val changeAmount = (-dragAmount.y / 40).toInt()
                            if (changeAmount != 0) {
                                val target = (curVol + changeAmount).coerceIn(0, maxVol)
                                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
                                volumeHud = ((target.toFloat() / maxVol) * 100).toInt()
                            }
                        } else {
                            val lp = activity?.window?.attributes
                            if (lp != null) {
                                val curBrightness = if (lp.screenBrightness < 0) 0.5f else lp.screenBrightness
                                val newBrightness = (curBrightness - delta).coerceIn(0.01f, 1.0f)
                                lp.screenBrightness = newBrightness
                                activity.window.attributes = lp
                                brightnessHud = (newBrightness * 100).toInt()
                            }
                        }
                    }
                )
            }
            .clickable { showControls = !showControls }
    ) {
        // Video Surface via AndroidView with safe lifecycle onRelease
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    setEnableComposeSurfaceSyncWorkaround(true)
                    player = exoPlayer
                    useController = false
                }
            },
            update = { playerView ->
                if (playerView.player != exoPlayer) {
                    playerView.player = exoPlayer
                }
            },
            onRelease = { playerView ->
                playerView.player = null
            },
            modifier = Modifier.fillMaxSize()
        )

        // Error message banner overlay
        if (errorMessage != null) {
            Card(
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xDD200000)),
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(24.dp)
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(20.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ErrorOutline,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(40.dp)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = errorMessage ?: "播放失败",
                        color = Color.White,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(14.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = { showLinesDialog = true },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                        ) {
                            Text("切换线路", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = {
                                val url = currentEpisode?.url?.trim()
                                if (!url.isNullOrBlank()) {
                                    errorMessage = null
                                    try {
                                        val mediaItem = MediaItem.fromUri(Uri.parse(url))
                                        exoPlayer.setMediaItem(mediaItem)
                                        exoPlayer.prepare()
                                        exoPlayer.play()
                                    } catch (e: Exception) {
                                        errorMessage = e.message ?: "重试失败"
                                    }
                                }
                            }
                        ) {
                            Text("重试", color = Color.White, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Centered Volume HUD Overlay
        AnimatedVisibility(
            visible = volumeHud != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.Center)
        ) {
            volumeHud?.let { vol ->
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.Black.copy(alpha = 0.85f)),
                    modifier = Modifier.padding(24.dp)
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp)
                    ) {
                        Icon(
                            imageVector = if (vol == 0) Icons.Default.VolumeMute else if (vol < 50) Icons.Default.VolumeDown else Icons.Default.VolumeUp,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(36.dp)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(text = if (vol == 0) "静音" else "$vol%", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Spacer(modifier = Modifier.height(8.dp))
                        LinearProgressIndicator(
                            progress = { vol / 100f },
                            modifier = Modifier
                                .width(90.dp)
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp))
                        )
                    }
                }
            }
        }

        // Centered Brightness HUD Overlay
        AnimatedVisibility(
            visible = brightnessHud != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.Center)
        ) {
            brightnessHud?.let { bri ->
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.Black.copy(alpha = 0.85f)),
                    modifier = Modifier.padding(24.dp)
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.BrightnessMedium,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(36.dp)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(text = "$bri%", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Spacer(modifier = Modifier.height(8.dp))
                        LinearProgressIndicator(
                            progress = { bri / 100f },
                            modifier = Modifier
                                .width(90.dp)
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp))
                        )
                    }
                }
            }
        }

        // Custom Controls Overlay
        AnimatedVisibility(
            visible = showControls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize()
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.45f))
            ) {
                // Top App Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.TopCenter)
                        .padding(horizontal = 12.dp, vertical = 20.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = {
                        saveProgressNow()
                        onClose()
                    }) {
                        Icon(imageVector = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Color.White)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = vod.vodName,
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = "${currentEpisode?.name ?: "正片"} · ${currentLine?.title ?: "默认线路"}",
                            color = Color.White.copy(alpha = 0.75f),
                            fontSize = 11.sp
                        )
                    }

                    // Wireless Cast Button / Casting status pill
                    if (activeCastDevice != null) {
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = Color(0xFF4CAF50).copy(alpha = 0.25f),
                            modifier = Modifier
                                .clip(RoundedCornerShape(16.dp))
                                .clickable { showCastDialog = true }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(Icons.Default.Tv, contentDescription = null, tint = Color(0xFF4CAF50), modifier = Modifier.size(14.dp))
                                Text("投屏中: ${activeCastDevice!!.name}", color = Color(0xFF4CAF50), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    } else {
                        IconButton(onClick = { showCastDialog = true }) {
                            Icon(imageVector = Icons.Default.Tv, contentDescription = "无线投屏", tint = Color.White)
                        }
                    }
                }

                // Center Action Buttons (Rewind 10s, Play/Pause, Forward 10s)
                Row(
                    modifier = Modifier.align(Alignment.Center),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(32.dp)
                ) {
                    IconButton(
                        onClick = {
                            val target = (exoPlayer.currentPosition - 10_000).coerceAtLeast(0L)
                            exoPlayer.seekTo(target)
                        },
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Replay10, contentDescription = "后退10秒", tint = Color.White, modifier = Modifier.size(36.dp))
                    }

                    IconButton(
                        onClick = {
                            if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play()
                        },
                        modifier = Modifier.size(64.dp)
                    ) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.PauseCircle else Icons.Default.PlayCircle,
                            contentDescription = if (isPlaying) "暂停" else "播放",
                            tint = Color.White,
                            modifier = Modifier.size(56.dp)
                        )
                    }

                    IconButton(
                        onClick = {
                            val target = (exoPlayer.currentPosition + 10_000).coerceAtMost(duration)
                            exoPlayer.seekTo(target)
                        },
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Forward10, contentDescription = "快进10秒", tint = Color.White, modifier = Modifier.size(36.dp))
                    }
                }

                // Bottom Controls Bar
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.BottomCenter)
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                ) {
                    // Progress Slider & Timestamps
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = formatTime(currentPosition / 1000),
                            color = Color.White,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Slider(
                            value = if (duration > 0) (currentPosition.toFloat() / duration.toFloat()).coerceIn(0f, 1f) else 0f,
                            onValueChange = { ratio ->
                                val targetMs = (ratio * duration).toLong()
                                exoPlayer.seekTo(targetMs)
                            },
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = 8.dp)
                        )
                        Text(
                            text = formatTime(duration / 1000),
                            color = Color.White.copy(alpha = 0.75f),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    // Options Row: Speed, Episodes, Lines, Fullscreen
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            TextButton(onClick = { showSpeedDialog = true }) {
                                Text("${playbackSpeed}x", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                            TextButton(onClick = { showLinesDialog = true }) {
                                Text(currentLine?.title ?: "切换线路", color = Color.White, fontSize = 12.sp)
                            }
                            TextButton(onClick = { showEpisodesDialog = true }) {
                                Text("选集 (${currentLine?.episodes?.size ?: 0})", color = Color.White, fontSize = 12.sp)
                            }
                        }

                        IconButton(onClick = { toggleFullscreen() }) {
                            Icon(
                                imageVector = if (isFullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                                contentDescription = "全屏切换",
                                tint = Color.White
                            )
                        }
                    }
                }
            }
        }

        // Episodes Dialog Drawer
        if (showEpisodesDialog && currentLine != null) {
            Dialog(onDismissRequest = { showEpisodesDialog = false }) {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E2023)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .fillMaxHeight(0.7f)
                        .padding(16.dp)
                ) {
                    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                        Text(
                            text = "剧集列表 (${currentLine.episodes.size})",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(3),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxSize()
                        ) {
                            itemsIndexed(currentLine.episodes) { idx, ep ->
                                val isCur = idx == currentEpIdx
                                Button(
                                    onClick = {
                                        currentEpIdx = idx
                                        showEpisodesDialog = false
                                    },
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (isCur) MaterialTheme.colorScheme.primary else Color(0xFF2C3033)
                                    ),
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
                                ) {
                                    Text(
                                        text = ep.name,
                                        color = if (isCur) MaterialTheme.colorScheme.onPrimary else Color.White,
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Lines Dialog Drawer
        if (showLinesDialog) {
            Dialog(onDismissRequest = { showLinesDialog = false }) {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E2023)),
                    modifier = Modifier.fillMaxWidth().padding(16.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("选择播放线路", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Spacer(modifier = Modifier.height(12.dp))
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            itemsIndexed(playLines) { idx, line ->
                                val isSelected = idx == currentLineIdx
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color(0xFF2C3033))
                                        .clickable {
                                            currentLineIdx = idx
                                            showLinesDialog = false
                                        }
                                        .padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(text = line.title, color = Color.White, fontSize = 13.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal)
                                    Text(text = "${line.episodes.size} 集", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
                                }
                            }
                        }
                    }
                }
            }
        }

        // Speed Dialog
        if (showSpeedDialog) {
            val speeds = listOf(0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f)
            Dialog(onDismissRequest = { showSpeedDialog = false }) {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E2023)),
                    modifier = Modifier.fillMaxWidth().padding(16.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("播放倍速", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            speeds.forEach { spd ->
                                val isSel = spd == playbackSpeed
                                FilterChip(
                                    selected = isSel,
                                    onClick = {
                                        playbackSpeed = spd
                                        exoPlayer.setPlaybackSpeed(spd)
                                        showSpeedDialog = false
                                    },
                                    label = { Text("${spd}x", fontSize = 12.sp) }
                                )
                            }
                        }
                    }
                }
            }
        }

        // Cast to TV Dialog
        if (showCastDialog) {
            CastDialog(
                context = context,
                vodTitle = "${vod.vodName} ${currentEpisode?.name ?: ""}".trim(),
                streamUrl = currentEpisode?.url ?: "",
                activeDevice = activeCastDevice,
                onDeviceSelected = { device ->
                    activeCastDevice = device
                    exoPlayer.pause()
                },
                onStopCasting = { device ->
                    coroutineScope.launch {
                        DlnaManager.stopCasting(device)
                        activeCastDevice = null
                    }
                },
                onDismiss = { showCastDialog = false }
            )
        }
    }
}

private fun formatTime(sec: Long): String {
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return if (h > 0) {
        String.format("%02d:%02d:%02d", h, m, s)
    } else {
        String.format("%02d:%02d", m, s)
    }
}

@Composable
fun CastDialog(
    context: Context,
    vodTitle: String,
    streamUrl: String,
    activeDevice: DlnaDevice?,
    onDeviceSelected: (DlnaDevice) -> Unit,
    onStopCasting: (DlnaDevice) -> Unit,
    onDismiss: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<DlnaDevice>>(emptyList()) }
    var isSearching by remember { mutableStateOf(true) }
    var castError by remember { mutableStateOf<String?>(null) }

    fun search() {
        isSearching = true
        castError = null
        coroutineScope.launch {
            try {
                devices = DlnaManager.discoverDevices(context, 3)
            } catch (e: Exception) {
                // Ignore
            } finally {
                isSearching = false
            }
        }
    }

    LaunchedEffect(Unit) {
        search()
    }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E2023)),
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.65f)
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("无线投屏到电视", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(
                            "🛡️ 本地 M3U8 净化中继已启动，电视将播放纯净无广告片源",
                            fontSize = 10.sp,
                            color = Color(0xFF4CAF50)
                        )
                    }
                    if (isSearching) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        IconButton(onClick = { search() }, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Default.Refresh, contentDescription = "刷新", tint = Color.White)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                if (castError != null) {
                    Text(castError!!, color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                }

                Box(modifier = Modifier.weight(1f)) {
                    if (isSearching && devices.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                                Spacer(modifier = Modifier.height(12.dp))
                                Text("正在搜索局域网电视与投屏设备...", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                            }
                        }
                    } else if (devices.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.TvOff, contentDescription = null, tint = Color.White.copy(alpha = 0.4f), modifier = Modifier.size(40.dp))
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("未发现局域网内的智能电视或投屏设备", color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text("请确保手机与电视连接在同一 Wi-Fi 网络下", color = Color.White.copy(alpha = 0.5f), fontSize = 10.sp)
                            }
                        }
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(devices) { device ->
                                val isCurCasting = activeDevice?.controlUrl == device.controlUrl
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(if (isCurCasting) Color(0xFF4CAF50).copy(alpha = 0.2f) else Color(0xFF2C3033))
                                        .clickable {
                                            if (isCurCasting) {
                                                onStopCasting(device)
                                            } else {
                                                coroutineScope.launch {
                                                    val res = DlnaManager.castToTv(context, device, vodTitle, streamUrl)
                                                    if (res.isSuccess) {
                                                        onDeviceSelected(device)
                                                        onDismiss()
                                                    } else {
                                                        castError = "投屏失败: ${res.exceptionOrNull()?.message}"
                                                    }
                                                }
                                            }
                                        }
                                        .padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Icon(Icons.Default.Tv, contentDescription = null, tint = if (isCurCasting) Color(0xFF4CAF50) else Color.White)
                                        Column {
                                            Text(device.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                            Text(if (isCurCasting) "正在投屏播放中 (点击断开)" else "点击投屏至此设备", color = if (isCurCasting) Color(0xFF4CAF50) else Color.White.copy(alpha = 0.6f), fontSize = 10.sp)
                                        }
                                    }
                                    if (isCurCasting) {
                                        TextButton(onClick = { onStopCasting(device) }) {
                                            Text("断开", color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) {
                        Text("关闭", color = Color.White)
                    }
                }
            }
        }
    }
}
