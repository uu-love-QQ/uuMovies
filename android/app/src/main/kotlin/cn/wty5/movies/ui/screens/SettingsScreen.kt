package cn.wty5.movies.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RotateRight
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import cn.wty5.movies.api.AppleCmsClient
import cn.wty5.movies.model.AppSettings
import cn.wty5.movies.model.Category
import cn.wty5.movies.model.Source
import cn.wty5.movies.model.TestResult
import cn.wty5.movies.repository.MovieRepository
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    repository: MovieRepository,
    client: AppleCmsClient
) {
    val sources by repository.sourcesFlow.collectAsState()
    val activeSource by repository.activeSourceFlow.collectAsState()
    val taxonomy by repository.taxonomyFlow.collectAsState()
    val settings by repository.settingsFlow.collectAsState()
    val subscriptions by repository.subscriptionsFlow.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var showAddSourceDialog by remember { mutableStateOf(false) }
    var showAddSubDialog by remember { mutableStateOf(false) }
    var mappingSource by remember { mutableStateOf<Source?>(null) }
    var syncingSubId by remember { mutableStateOf<String?>(null) }
    var subToastMessage by remember { mutableStateOf<String?>(null) }
    val testResults = remember { mutableStateMapOf<String, TestResult>() }
    val testingIds = remember { mutableStateSetOf<String>() }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 80.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item {
                Text(
                    text = "系统设置与采集源",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                )
                Text(
                    text = "管理苹果CMS采集源、映射规则及播放偏好",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 1. Content Safety & 18+ mode
            item {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("18+ 成人内容模式", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                if (taxonomy.adultMode) {
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("🔥 已开启", color = MaterialTheme.colorScheme.error, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = if (taxonomy.adultMode) "已解除过滤，显示采集源中标记的成人与伦理频道" else "未成年人保护：已自动过滤伦理片、成人分类内容",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = taxonomy.adultMode,
                            onCheckedChange = { repository.toggleAdultMode(it) }
                        )
                    }
                }
            }

            // 2. Playback Preferences
            item {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("播放偏好", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("自动连播下一集", fontSize = 13.sp)
                            Switch(
                                checked = settings.autoPlayNext,
                                onCheckedChange = { repository.saveSettings(settings.copy(autoPlayNext = it)) }
                            )
                        }

                        HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("跳过片头 (秒)", fontSize = 13.sp)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TextButton(onClick = {
                                    val next = (settings.skipIntroSeconds - 10).coerceAtLeast(0)
                                    repository.saveSettings(settings.copy(skipIntroSeconds = next))
                                }) { Text("-10s") }
                                Text("${settings.skipIntroSeconds}s", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                TextButton(onClick = {
                                    val next = settings.skipIntroSeconds + 10
                                    repository.saveSettings(settings.copy(skipIntroSeconds = next))
                                }) { Text("+10s") }
                            }
                        }
                    }
                }
            }

            // 3. Remote Subscriptions Management
            item {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("远程规则与采集订阅", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                Text("支持输入在线 JSON 订阅地址一键拉取采集源", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (subscriptions.isNotEmpty()) {
                                    TextButton(
                                        onClick = {
                                            coroutineScope.launch {
                                                try {
                                                    val count = repository.syncAllSubscriptions()
                                                    subToastMessage = "成功同步 $count 个采集源"
                                                } catch (e: Exception) {
                                                    subToastMessage = "同步失败: ${e.message}"
                                                }
                                            }
                                        },
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                                    ) {
                                        Text("同步全部", fontSize = 11.sp)
                                    }
                                }
                                Button(
                                    onClick = { showAddSubDialog = true },
                                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                                ) {
                                    Icon(imageVector = Icons.Default.Add, contentDescription = null, modifier = Modifier.size(14.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("添加订阅", fontSize = 11.sp)
                                }
                            }
                        }

                        if (subToastMessage != null) {
                            Text(text = subToastMessage!!, fontSize = 11.sp, color = MaterialTheme.colorScheme.primary)
                        }

                        if (subscriptions.isEmpty()) {
                            Text(
                                text = "暂无远程订阅源。您可以点击“添加订阅”输入云端公开订阅地址。",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                modifier = Modifier.padding(vertical = 4.dp)
                            )
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                subscriptions.forEach { sub ->
                                    val isSyncing = syncingSubId == sub.id
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.6f))
                                            .padding(10.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(sub.name, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                            Text(sub.url, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f), maxLines = 1)
                                            if (sub.errorMsg != null) {
                                                Text("同步异常: ${sub.errorMsg}", fontSize = 10.sp, color = MaterialTheme.colorScheme.error)
                                            } else {
                                                Text("已收录 ${sub.sourceCount} 个源", fontSize = 10.sp, color = MaterialTheme.colorScheme.primary)
                                            }
                                        }
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            IconButton(
                                                onClick = {
                                                    syncingSubId = sub.id
                                                    coroutineScope.launch {
                                                        try {
                                                            val c = repository.syncSubscription(sub.id)
                                                            subToastMessage = "【${sub.name}】成功同步 $c 个采集源"
                                                        } catch (e: Exception) {
                                                            subToastMessage = "同步失败: ${e.message}"
                                                        } finally {
                                                            syncingSubId = null
                                                        }
                                                    }
                                                },
                                                enabled = !isSyncing
                                            ) {
                                                if (isSyncing) {
                                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                                } else {
                                                    Icon(imageVector = Icons.Default.Refresh, contentDescription = "同步", modifier = Modifier.size(18.dp))
                                                }
                                            }
                                            IconButton(
                                                onClick = { repository.deleteSubscription(sub.id) }
                                            ) {
                                                Icon(imageVector = Icons.Default.Delete, contentDescription = "删除", tint = MaterialTheme.colorScheme.error.copy(alpha = 0.8f), modifier = Modifier.size(18.dp))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 3. Source Management
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("采集源与规则映射", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text("已收录 ${sources.size} 个苹果CMS源，支持多源测速与规则自定义", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Button(
                            onClick = { showAddSourceDialog = true },
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                        ) {
                            Icon(imageVector = Icons.Default.Add, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("添加源", fontSize = 11.sp)
                        }
                    }
                }
            }

            // Source items
            items(sources, key = { it.id }) { src ->
                val isActive = src.id == activeSource?.id
                val test = testResults[src.id]
                val isTesting = testingIds.contains(src.id)

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isActive) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surface
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    border = if (isActive) CardDefaults.outlinedCardBorder().copy(brush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary)) else null
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                                Text(
                                    src.name,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    color = if (isActive) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                if (isActive) {
                                    Text("【当前使用】", color = MaterialTheme.colorScheme.primary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                }
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    src.group,
                                    fontSize = 10.sp,
                                    color = if (isActive) MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f) else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }

                            Switch(
                                checked = src.enabled,
                                onCheckedChange = { checked ->
                                    val updated = sources.map {
                                        if (it.id == src.id) it.copy(enabled = checked) else it
                                    }
                                    repository.saveSources(updated)
                                }
                            )
                        }

                        Text(
                            text = src.apiUrl,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                            maxLines = 1
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Test latency badge
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (isTesting) {
                                    CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("测速中...", fontSize = 10.sp)
                                } else if (test != null) {
                                    if (test.ok) {
                                        Text("${test.latencyMs}ms (${test.categoriesCount}类)", color = Color(0xFF4CAF50), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    } else {
                                        Text("不可达: ${test.error}", color = MaterialTheme.colorScheme.error, fontSize = 10.sp)
                                    }
                                }
                            }

                            // Actions
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(
                                    onClick = {
                                        testingIds.add(src.id)
                                        coroutineScope.launch {
                                            val res = client.testSource(src)
                                            testResults[src.id] = res
                                            testingIds.remove(src.id)
                                        }
                                    },
                                    contentPadding = PaddingValues(horizontal = 6.dp)
                                ) {
                                    Text("测速", fontSize = 11.sp)
                                }

                                if (!isActive) {
                                    TextButton(
                                        onClick = { repository.setActiveSource(src.id) },
                                        contentPadding = PaddingValues(horizontal = 6.dp)
                                    ) {
                                        Text("设为当前", fontSize = 11.sp)
                                    }
                                }

                                TextButton(
                                    onClick = { mappingSource = src },
                                    contentPadding = PaddingValues(horizontal = 6.dp)
                                ) {
                                    Text("规则映射", fontSize = 11.sp)
                                }

                                IconButton(
                                    onClick = {
                                        val updated = sources.filter { it.id != src.id }
                                        repository.saveSources(updated)
                                    },
                                    modifier = Modifier.size(28.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Delete,
                                        contentDescription = "删除源",
                                        tint = MaterialTheme.colorScheme.error.copy(alpha = 0.8f),
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    OutlinedButton(onClick = { repository.resetDefaultSources() }) {
                        Icon(imageVector = Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("恢复内置默认采集源", fontSize = 12.sp)
                    }
                }
            }
        }

        // Add source dialog
        if (showAddSourceDialog) {
            AddSourceDialog(
                onDismiss = { showAddSourceDialog = false },
                onAdd = { name, url, group ->
                    val newSrc = Source(
                        id = "custom_${System.currentTimeMillis()}",
                        name = name,
                        apiUrl = url,
                        group = if (group.isBlank()) "自定义源" else group,
                        enabled = true
                    )
                    repository.saveSources(sources + newSrc)
                    showAddSourceDialog = false
                }
            )
        }

        // Category mapping dialog
        mappingSource?.let { src ->
            CategoryMappingDialog(
                source = src,
                client = client,
                taxonomy = taxonomy,
                onDismiss = { mappingSource = null },
                onSave = { updatedMapping, updatedAdults ->
                    val updatedList = sources.map {
                        if (it.id == src.id) {
                            it.copy(categoryMapping = updatedMapping, adultTypeIds = updatedAdults)
                        } else it
                    }
                    repository.saveSources(updatedList)
                    mappingSource = null
                }
            )
        }

        // Add subscription dialog
        if (showAddSubDialog) {
            AddSubscriptionDialog(
                onDismiss = { showAddSubDialog = false },
                onAdd = { name, url ->
                    repository.addSubscription(name, url)
                    showAddSubDialog = false
                    coroutineScope.launch {
                        try {
                            repository.syncAllSubscriptions()
                            subToastMessage = "订阅已添加并完成同步"
                        } catch (e: Exception) {
                            // Ignore
                        }
                    }
                }
            )
        }
    }
}

@Composable
fun AddSourceDialog(
    onDismiss: () -> Unit,
    onAdd: (name: String, url: String, group: String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var group by remember { mutableStateOf("自定义源") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("添加 AppleCMS 采集源", fontSize = 16.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("源站名称 (如: 某某资源)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("API 地址 (如: https://.../api.php/provide/vod/)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = group,
                    onValueChange = { group = it },
                    label = { Text("分组 (如: 备用专线)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (name.isNotBlank() && url.isNotBlank()) {
                        onAdd(name.trim(), url.trim(), group.trim())
                    }
                },
                enabled = name.isNotBlank() && url.isNotBlank()
            ) {
                Text("添加并保存")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

@Composable
fun CategoryMappingDialog(
    source: Source,
    client: AppleCmsClient,
    taxonomy: cn.wty5.movies.model.UserTaxonomyConfig,
    onDismiss: () -> Unit,
    onSave: (Map<String, List<String>>, List<String>) -> Unit
) {
    var classes by remember { mutableStateOf<List<Category>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val mapping = remember { mutableStateMapOf<String, String>() } // typeId -> tag
    val adultSet = remember { mutableStateSetOf<String>() }
    val coroutineScope = rememberCoroutineScope()

    // Initialize mapping from source
    LaunchedEffect(source.id) {
        source.categoryMapping.forEach { (tag, ids) ->
            ids.forEach { tid -> mapping[tid] = tag }
        }
        adultSet.addAll(source.adultTypeIds)

        try {
            val fetched = client.fetchClasses(source)
            classes = fetched
        } catch (e: Exception) {
            // Ignore
        } finally {
            isLoading = false
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.85f),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp)
            ) {
                Text(
                    text = "【${source.name}】分类规则映射",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
                Text(
                    text = "为源站分类指定标准语义标签，标记 18+ 分类",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(10.dp))

                Box(modifier = Modifier.weight(1f)) {
                    if (isLoading) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    } else if (classes.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("未发现源站分类，或接口无法连接", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(classes, key = { it.typeId }) { cat ->
                                val assignedTag = mapping[cat.typeId] ?: "unmapped"
                                val isAdult = adultSet.contains(cat.typeId)

                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
                                        .padding(8.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(cat.typeName, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                        Text("ID: ${cat.typeId}${if (!cat.typePid.isNullOrEmpty() && cat.typePid != "0") " · PID: ${cat.typePid}" else ""}", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }

                                    // Tag selector chip
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        var expanded by remember { mutableStateOf(false) }
                                        Box {
                                            OutlinedButton(
                                                onClick = { expanded = true },
                                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                                modifier = Modifier.height(32.dp)
                                            ) {
                                                val tagDisplay = taxonomy.categories.find { it.bindTags.contains(assignedTag) }?.name
                                                    ?: if (assignedTag == "unmapped") "透传" else assignedTag
                                                Text(tagDisplay, fontSize = 11.sp)
                                            }
                                            DropdownMenu(
                                                expanded = expanded,
                                                onDismissRequest = { expanded = false }
                                            ) {
                                                DropdownMenuItem(
                                                    text = { Text("不映射 (透传)") },
                                                    onClick = {
                                                        mapping.remove(cat.typeId)
                                                        expanded = false
                                                    }
                                                )
                                                taxonomy.categories.forEach { localCat ->
                                                    localCat.bindTags.firstOrNull()?.let { tag ->
                                                        DropdownMenuItem(
                                                            text = { Text("${localCat.name} ($tag)") },
                                                            onClick = {
                                                                mapping[cat.typeId] = tag
                                                                expanded = false
                                                            }
                                                        )
                                                    }
                                                }
                                            }
                                        }

                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.clickable {
                                                if (isAdult) adultSet.remove(cat.typeId) else adultSet.add(cat.typeId)
                                            }
                                        ) {
                                            Checkbox(
                                                checked = isAdult,
                                                onCheckedChange = { checked ->
                                                    if (checked) adultSet.add(cat.typeId) else adultSet.remove(cat.typeId)
                                                },
                                                modifier = Modifier.size(24.dp)
                                            )
                                            Text("18+", fontSize = 10.sp, color = if (isAdult) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = onDismiss) { Text("取消") }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = {
                            val resultMap = mutableMapOf<String, MutableList<String>>()
                            mapping.forEach { (tid, tag) ->
                                resultMap.getOrPut(tag) { mutableListOf() }.add(tid)
                            }
                            onSave(resultMap, adultSet.toList())
                        }
                    ) {
                        Text("保存映射")
                    }
                }
            }
        }
    }
}

@Composable
fun AddSubscriptionDialog(
    onDismiss: () -> Unit,
    onAdd: (name: String, url: String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("添加远程采集源订阅", fontSize = 16.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("订阅名称 (选填)") },
                    placeholder = { Text("例如: 我的云端源订阅") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("订阅 URL (必须为有效 JSON 链接)") },
                    placeholder = { Text("https://.../sources.json") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (url.isNotBlank()) {
                        onAdd(name.trim(), url.trim())
                    }
                },
                enabled = url.isNotBlank()
            ) {
                Text("添加并立即同步")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
