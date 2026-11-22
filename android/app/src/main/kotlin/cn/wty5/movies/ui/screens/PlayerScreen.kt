package cn.wty5.movies.ui.screens

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.media.AudioManager
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.VolumeDown
import androidx.compose.material.icons.automirrored.filled.VolumeMute
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
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
import cn.wty5.movies.cast.CastProxyServer
import cn.wty5.movies.cast.DlnaDevice
import cn.wty5.movies.cast.DlnaManager
import cn.wty5.movies.model.*
import cn.wty5.movies.repository.MovieRepository
import cn.wty5.movies.ui.theme.DarkColorScheme
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
    val configuration = LocalConfiguration.current
    val coroutineScope = rememberCoroutineScope()

    val allSources by repository.sourcesFlow.collectAsState()
    val favorites by repository.favoritesFlow.collectAsState()
    val playLines = remember(vod.vodId) { mutableStateListOf<PlayLine>().apply { addAll(vod.safePlayLines) } }

    var currentLineIdx by remember(vod.vodId) {
        val lineCount = vod.safePlayLines.size
        mutableIntStateOf(initialLineIndex.coerceIn(0, (lineCount - 1).coerceAtLeast(0)))
    }
    var currentEpIdx by remember(vod.vodId) {
        mutableIntStateOf(initialEpisodeIndex)
    }

    // Fullscreen state: orientation sensor or explicit toggle
    var isManualFullscreen by remember { mutableStateOf(false) }
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val isFullscreen = isManualFullscreen || isLandscape

    val isFav = favorites.any { it.vodId == vod.vodId && (it.sourceId == vod.sourceId || vod.sourceId.isNullOrBlank()) }

    // Intercept back key when in fullscreen to return to portrait first
    BackHandler(enabled = isFullscreen) {
        isManualFullscreen = false
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
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
    val currentEpisode: Episode? = currentLine?.safeEpisodes?.getOrNull(currentEpIdx) ?: currentLine?.safeEpisodes?.firstOrNull()

    // Player state
    var isPlaying by remember { mutableStateOf(true) }
    var currentPosition by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var bufferedPosition by remember { mutableLongStateOf(0L) }
    var showControls by remember { mutableStateOf(true) }
    var playbackSpeed by remember { mutableFloatStateOf(1.0f) }

    // HUD overlays & Dialogs
    var volumeHud by remember { mutableStateOf<Int?>(null) }
    var brightnessHud by remember { mutableStateOf<Int?>(null) }
    var showEpisodesDialog by remember { mutableStateOf(false) }
    var showLinesDialog by remember { mutableStateOf(false) }
    var showSpeedDialog by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showCastDialog by remember { mutableStateOf(false) }
    var activeCastDevice by remember { mutableStateOf<DlnaDevice?>(null) }

    // Ad-filtering OkHttpClient for stripping M3U8 in-video ads
    val adFilteringHttpClient = remember {
        okhttp3.OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
            .addInterceptor(cn.wty5.movies.player.M3u8AdFilter.Interceptor())
            .build()
    }

    // Initialize ExoPlayer
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

    // Line emptiness timeout check
    LaunchedEffect(playLines.size, vod.vodId) {
        if (playLines.isEmpty()) {
            delay(3000)
            if (playLines.isEmpty()) {
                errorMessage = "未能获取到可播放的线路，请尝试更换采集源"
            }
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
                bufferedPosition = exoPlayer.bufferedPosition.coerceAtLeast(0L)
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

    fun toggleFullscreen() {
        val next = !isFullscreen
        isManualFullscreen = next
        activity?.requestedOrientation = if (next) {
            ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    // -------------------------------------------------------------
    // Video Player Box (Top in portrait; Fullscreen in landscape)
    // -------------------------------------------------------------
    @Composable
    fun VideoPlayerBox(modifier: Modifier = Modifier) {
        MaterialTheme(colorScheme = DarkColorScheme) {
            Box(
                modifier = modifier
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
                // Video Surface via AndroidView
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
                        colors = CardDefaults.cardColors(containerColor = Color(0xEE200505)),
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(20.dp)
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(18.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ErrorOutline,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error,
                                modifier = Modifier.size(36.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = errorMessage ?: "播放失败",
                                color = Color.White,
                                fontSize = 12.sp,
                                textAlign = TextAlign.Center
                            )
                            Spacer(modifier = Modifier.height(12.dp))
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
                                    imageVector = if (vol == 0) Icons.AutoMirrored.Filled.VolumeMute else if (vol < 50) Icons.AutoMirrored.Filled.VolumeDown else Icons.AutoMirrored.Filled.VolumeUp,
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

                // Controls Overlay (YouTube style)
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
                        // Top Bar: Back, Title, Speed, Cast
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .align(Alignment.TopCenter)
                                .padding(horizontal = 8.dp, vertical = if (isFullscreen) 12.dp else 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            IconButton(onClick = {
                                if (isFullscreen) {
                                    toggleFullscreen()
                                } else {
                                    saveProgressNow()
                                    onClose()
                                }
                            }) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "返回",
                                    tint = Color.White
                                )
                            }
                            Spacer(modifier = Modifier.width(4.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = vod.vodName,
                                    color = Color.White,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "${currentEpisode?.name ?: "正片"} · ${currentLine?.title ?: "默认线路"}",
                                    color = Color.White.copy(alpha = 0.75f),
                                    fontSize = 11.sp,
                                    maxLines = 1
                                )
                            }

                            // Speed Button
                            TextButton(onClick = { showSpeedDialog = true }) {
                                Text(
                                    text = "${playbackSpeed}x",
                                    color = Color.White,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }

                            // Wireless Cast Button
                            if (activeCastDevice != null) {
                                Surface(
                                    shape = RoundedCornerShape(16.dp),
                                    color = Color(0xFF4CAF50).copy(alpha = 0.3f),
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
                                        Text("投屏中", color = Color(0xFF4CAF50), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                            } else {
                                IconButton(onClick = { showCastDialog = true }) {
                                    Icon(imageVector = Icons.Default.Tv, contentDescription = "无线投屏", tint = Color.White)
                                }
                            }
                        }

                        // Center Controls (10s Rewind, Play/Pause, 10s Forward)
                        Row(
                            modifier = Modifier.align(Alignment.Center),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(28.dp)
                        ) {
                            IconButton(
                                onClick = {
                                    val target = (exoPlayer.currentPosition - 10_000).coerceAtLeast(0L)
                                    exoPlayer.seekTo(target)
                                },
                                modifier = Modifier.size(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Replay10,
                                    contentDescription = "后退10秒",
                                    tint = Color.White,
                                    modifier = Modifier.size(32.dp)
                                )
                            }

                            IconButton(
                                onClick = {
                                    if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play()
                                },
                                modifier = Modifier.size(56.dp)
                            ) {
                                Icon(
                                    imageVector = if (isPlaying) Icons.Default.PauseCircle else Icons.Default.PlayCircle,
                                    contentDescription = if (isPlaying) "暂停" else "播放",
                                    tint = Color.White,
                                    modifier = Modifier.size(52.dp)
                                )
                            }

                            IconButton(
                                onClick = {
                                    val target = (exoPlayer.currentPosition + 10_000).coerceAtMost(duration)
                                    exoPlayer.seekTo(target)
                                },
                                modifier = Modifier.size(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Forward10,
                                    contentDescription = "快进10秒",
                                    tint = Color.White,
                                    modifier = Modifier.size(32.dp)
                                )
                            }
                        }

                        // Bottom Controls Bar: Sleek Scrubber + Timestamps + Fullscreen
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .align(Alignment.BottomCenter)
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            // Custom Sleek YouTube-style Progress Scrub Bar
                            VideoScrubBar(
                                positionMs = currentPosition,
                                durationMs = duration,
                                bufferedMs = bufferedPosition,
                                onSeek = { targetMs -> exoPlayer.seekTo(targetMs) }
                            )

                            // Timestamp and Action Buttons
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "${formatTime(currentPosition / 1000)} / ${formatTime(duration / 1000)}",
                                    color = Color.White.copy(alpha = 0.9f),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium
                                )

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    if (isFullscreen) {
                                        TextButton(
                                            onClick = { showLinesDialog = true },
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                        ) {
                                            Text(currentLine?.title ?: "换线", color = Color.White, fontSize = 11.sp)
                                        }
                                        TextButton(
                                            onClick = { showEpisodesDialog = true },
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                        ) {
                                            Text("选集 (${currentLine?.safeEpisodes?.size ?: 0})", color = Color.White, fontSize = 11.sp)
                                        }
                                    }

                                    IconButton(
                                        onClick = { toggleFullscreen() },
                                        modifier = Modifier.size(36.dp)
                                    ) {
                                        Icon(
                                            imageVector = if (isFullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                                            contentDescription = "全屏切换",
                                            tint = Color.White,
                                            modifier = Modifier.size(22.dp)
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

    // -------------------------------------------------------------
    // Fullscreen Layout vs. YouTube-Style Portrait Layout
    // -------------------------------------------------------------
    if (isFullscreen) {
        // Fullscreen immersive view
        VideoPlayerBox(modifier = Modifier.fillMaxSize())
    } else {
        // YouTube-style Portrait Layout:
        // Top: 16:9 Video Player
        // Bottom: Scrollable info, actions, line selector, episodes grid, and synopsis
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
        ) {
            // 1. 16:9 Video Area
            VideoPlayerBox(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
            )

            // 2. Video Details & Episodes Panel
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Video Title & Rating / Remarks
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = vod.vodName,
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp
                        ),
                        color = MaterialTheme.colorScheme.onBackground
                    )

                    // Metadata tags
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (!vod.vodRemarks.isNullOrBlank()) {
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = MaterialTheme.colorScheme.primaryContainer,
                                contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                            ) {
                                Text(
                                    text = vod.vodRemarks,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }

                        if (!vod.vodScore.isNullOrBlank() && vod.vodScore != "0" && vod.vodScore != "0.0") {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Star,
                                    contentDescription = null,
                                    tint = Color(0xFFFFB800),
                                    modifier = Modifier.size(13.dp)
                                )
                                Text(
                                    text = vod.vodScore,
                                    color = Color(0xFFFFB800),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        val tags = listOfNotNull(
                            vod.typeName.takeIf { it.isNotBlank() },
                            vod.vodYear.takeIf { !it.isNullOrBlank() },
                            vod.vodArea.takeIf { !it.isNullOrBlank() }
                        ).joinToString(" · ")

                        if (tags.isNotBlank()) {
                            Text(
                                text = tags,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                // Action Bar: Favorite, Cast, Source info
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Favorite Toggle Button
                    OutlinedButton(
                        onClick = {
                            repository.toggleFavorite(
                                FavoriteItem(
                                    vodId = vod.vodId,
                                    sourceId = vod.sourceId ?: "",
                                    sourceName = vod.sourceName ?: "默认源",
                                    vodName = vod.vodName,
                                    vodPic = vod.vodPic,
                                    typeName = vod.typeName,
                                    vodRemarks = vod.vodRemarks
                                )
                            )
                        },
                        colors = if (isFav) {
                            ButtonDefaults.outlinedButtonColors(
                                containerColor = MaterialTheme.colorScheme.primaryContainer,
                                contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        } else ButtonDefaults.outlinedButtonColors(),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        Icon(
                            imageVector = if (isFav) Icons.Default.Bookmark else Icons.Outlined.BookmarkBorder,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(if (isFav) "已收藏" else "收藏", fontSize = 12.sp)
                    }

                    // Cast Button
                    OutlinedButton(
                        onClick = { showCastDialog = true },
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Tv,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(if (activeCastDevice != null) "投屏中" else "无线投屏", fontSize = 12.sp)
                    }

                    Spacer(modifier = Modifier.weight(1f))

                    // Source origin pill
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant
                    ) {
                        Text(
                            text = vod.sourceName ?: "默认源",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))

                // Line Selection Chips
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "播放线路 (${playLines.size})",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onBackground
                    )

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        playLines.forEachIndexed { idx, line ->
                            val isSelected = idx == currentLineIdx
                            FilterChip(
                                selected = isSelected,
                                onClick = { currentLineIdx = idx },
                                label = {
                                    Text(
                                        text = "${line.title} (${line.safeEpisodes.size})",
                                        fontSize = 12.sp,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                    )
                                }
                            )
                        }
                    }
                }

                // Episode Selector Grid
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "剧集列表",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onBackground
                        )
                        Text(
                            text = "当前: ${currentEpisode?.name ?: "第 1 集"}",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    val episodes = currentLine?.safeEpisodes ?: emptyList()
                    if (episodes.isEmpty()) {
                        Text(
                            text = "该线路暂无可播放剧集",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else {
                        // Chunk episodes into rows of 4 for a crisp, responsive grid
                        val chunkedEpisodes = remember(episodes) { episodes.chunked(4) }
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            chunkedEpisodes.forEachIndexed { rowIndex, rowItems ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    rowItems.forEachIndexed { colIndex, ep ->
                                        val actualIdx = rowIndex * 4 + colIndex
                                        val isSelected = actualIdx == currentEpIdx

                                        Button(
                                            onClick = { currentEpIdx = actualIdx },
                                            modifier = Modifier.weight(1f),
                                            shape = RoundedCornerShape(8.dp),
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                                                contentColor = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                                            ),
                                            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp)
                                        ) {
                                            Text(
                                                text = ep.name,
                                                fontSize = 12.sp,
                                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                    }
                                    // Fill empty slots in the last row to maintain grid alignment
                                    repeat(4 - rowItems.size) {
                                        Spacer(modifier = Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                    }
                }

                // Synopsis & Cast Details
                val cleanContent = remember(vod.vodContent) {
                    vod.vodContent?.replace(Regex("<[^>]*>"), "")?.trim()
                }

                if (!cleanContent.isNullOrBlank() || !vod.vodActor.isNullOrBlank() || !vod.vodDirector.isNullOrBlank()) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = "影片简介",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onBackground
                        )

                        if (!vod.vodDirector.isNullOrBlank()) {
                            Text(
                                text = "导演：${vod.vodDirector}",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        if (!vod.vodActor.isNullOrBlank()) {
                            Text(
                                text = "主演：${vod.vodActor}",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        if (!cleanContent.isNullOrBlank()) {
                            var isExpanded by remember { mutableStateOf(false) }
                            Text(
                                text = cleanContent,
                                fontSize = 12.sp,
                                lineHeight = 18.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = if (isExpanded) Int.MAX_VALUE else 3,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.clickable { isExpanded = !isExpanded }
                            )
                            if (cleanContent.length > 80) {
                                Text(
                                    text = if (isExpanded) "收起" else "展开全部简介",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.clickable { isExpanded = !isExpanded }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // -------------------------------------------------------------
    // Fullscreen Dialogs (Speed, Lines, Episodes, DLNA Cast)
    // -------------------------------------------------------------
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
                                Text(text = "${line.safeEpisodes.size} 集", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showEpisodesDialog) {
        Dialog(onDismissRequest = { showEpisodesDialog = false }) {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E2023)),
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.7f)
                    .padding(16.dp)
            ) {
                val currentEpisodes = currentLine?.safeEpisodes ?: emptyList()
                Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                    Text(
                        text = "剧集列表 (${currentEpisodes.size})",
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
                        itemsIndexed(currentEpisodes) { idx, ep ->
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

// -----------------------------------------------------------------
// Sleek YouTube-Style Custom Video Scrub Bar
// -----------------------------------------------------------------
@Composable
fun VideoScrubBar(
    positionMs: Long,
    durationMs: Long,
    bufferedMs: Long,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
    playedColor: Color = Color(0xFFFF0033),
    bufferedColor: Color = Color.White.copy(alpha = 0.45f),
    trackColor: Color = Color.White.copy(alpha = 0.22f),
    thumbColor: Color = Color(0xFFFF0033)
) {
    var isDragging by remember { mutableStateOf(false) }
    var dragRatio by remember { mutableFloatStateOf(0f) }

    val currentRatio = if (isDragging) {
        dragRatio
    } else if (durationMs > 0) {
        (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
    } else {
        0f
    }

    val bufferRatio = if (durationMs > 0) {
        (bufferedMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
    } else {
        0f
    }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(28.dp)
            .pointerInput(durationMs) {
                detectTapGestures { offset ->
                    if (durationMs > 0) {
                        val newRatio = (offset.x / size.width).coerceIn(0f, 1f)
                        onSeek((newRatio * durationMs).toLong())
                    }
                }
            }
            .pointerInput(durationMs) {
                detectDragGestures(
                    onDragStart = { offset ->
                        if (durationMs > 0) {
                            isDragging = true
                            dragRatio = (offset.x / size.width).coerceIn(0f, 1f)
                        }
                    },
                    onDragEnd = {
                        if (isDragging && durationMs > 0) {
                            onSeek((dragRatio * durationMs).toLong())
                            isDragging = false
                        }
                    },
                    onDragCancel = {
                        isDragging = false
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        if (durationMs > 0) {
                            dragRatio = (change.position.x / size.width).coerceIn(0f, 1f)
                        }
                    }
                )
            },
        contentAlignment = Alignment.CenterStart
    ) {
        val widthPx = constraints.maxWidth.toFloat()
        val trackHeight = if (isDragging) 4.5.dp else 2.5.dp

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(trackHeight)
        ) {
            val h = size.height
            val w = size.width

            // 1. Background track
            drawRoundRect(
                color = trackColor,
                size = Size(w, h),
                cornerRadius = CornerRadius(h / 2, h / 2)
            )

            // 2. Buffered progress
            if (bufferRatio > 0f) {
                drawRoundRect(
                    color = bufferedColor,
                    size = Size(w * bufferRatio, h),
                    cornerRadius = CornerRadius(h / 2, h / 2)
                )
            }

            // 3. Played progress
            if (currentRatio > 0f) {
                drawRoundRect(
                    color = playedColor,
                    size = Size(w * currentRatio, h),
                    cornerRadius = CornerRadius(h / 2, h / 2)
                )
            }
        }

        // 4. Scrubber Thumb
        val thumbRadius = if (isDragging) 6.5.dp else 4.5.dp
        val thumbPx = with(LocalDensity.current) { thumbRadius.toPx() }
        val thumbOffset = (widthPx * currentRatio - thumbPx).coerceIn(0f, widthPx - thumbPx * 2)

        Box(
            modifier = Modifier
                .offset { IntOffset(thumbOffset.toInt(), 0) }
                .size(thumbRadius * 2)
                .clip(CircleShape)
                .background(thumbColor)
        )
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
    var devices by remember { mutableStateOf<List<DlnaDevice>>(emptyList()) }
    var isSearching by remember { mutableStateOf(false) }
    var castError by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()

    val search = {
        isSearching = true
        castError = null
        coroutineScope.launch {
            try {
                devices = DlnaManager.discoverDevices(context)
            } catch (e: Exception) {
                castError = e.message
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
                            "🛡️ 本地 M3U8 净化中继已启动，电视将播放纯净片源",
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
