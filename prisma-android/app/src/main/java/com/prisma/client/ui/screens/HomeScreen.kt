package com.prisma.client.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.prisma.client.model.ConnectionStatus
import com.prisma.client.model.TrafficStats
import com.prisma.client.viewmodel.MainViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: MainViewModel,
    onRequestVpnPermission: () -> Unit
) {
    val status by viewModel.connectionStatus.collectAsState()
    val stats by viewModel.trafficStats.collectAsState()
    val selectedProfile = viewModel.selectedProfile
    val version = remember { viewModel.let { vm ->
        try { com.prisma.client.core.PrismaEngine.getInstance().version } catch (_: Exception) { "?" }
    }}

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Prisma") },
                actions = {
                    Text(
                        "v$version",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(end = 16.dp)
                    )
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Status indicator
            StatusIndicator(status)

            // Connect button
            ConnectButton(
                status = status,
                hasProfile = selectedProfile != null,
                onClick = {
                    if (status == ConnectionStatus.CONNECTED || status == ConnectionStatus.CONNECTING) {
                        viewModel.disconnect()
                    } else {
                        val vpnIntent = viewModel.prepareVpn()
                        if (vpnIntent != null) {
                            onRequestVpnPermission()
                        } else {
                            viewModel.connect()
                        }
                    }
                }
            )

            // Active server card
            if (selectedProfile != null) {
                ActiveServerCard(
                    name = selectedProfile.name,
                    address = selectedProfile.config.serverAddr ?: "Unknown",
                    transport = selectedProfile.config.transport?.uppercase() ?: ""
                )
            } else {
                NoServerCard()
            }

            // Traffic stats
            if (status == ConnectionStatus.CONNECTED) {
                TrafficStatsCard(stats)
            }
        }
    }
}

@Composable
private fun StatusIndicator(status: ConnectionStatus) {
    val color by animateColorAsState(
        targetValue = when (status) {
            ConnectionStatus.CONNECTED -> Color(0xFF4CAF50)
            ConnectionStatus.CONNECTING -> Color(0xFFFFC107)
            ConnectionStatus.ERROR -> Color(0xFFEF5350)
            ConnectionStatus.DISCONNECTED -> MaterialTheme.colorScheme.surfaceVariant
        },
        label = "statusColor"
    )

    val icon = when (status) {
        ConnectionStatus.CONNECTED -> Icons.Filled.Shield
        ConnectionStatus.CONNECTING -> Icons.Filled.Sync
        ConnectionStatus.ERROR -> Icons.Filled.Error
        ConnectionStatus.DISCONNECTED -> Icons.Filled.ShieldMoon
    }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .size(88.dp)
                .clip(CircleShape)
                .background(color),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(42.dp)
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = when (status) {
                ConnectionStatus.CONNECTED -> "Connected"
                ConnectionStatus.CONNECTING -> "Connecting..."
                ConnectionStatus.ERROR -> "Error"
                ConnectionStatus.DISCONNECTED -> "Disconnected"
            },
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun ConnectButton(
    status: ConnectionStatus,
    hasProfile: Boolean,
    onClick: () -> Unit
) {
    val buttonColor = when (status) {
        ConnectionStatus.CONNECTED -> MaterialTheme.colorScheme.error
        ConnectionStatus.CONNECTING -> Color(0xFFFF9800)
        else -> MaterialTheme.colorScheme.primary
    }

    Button(
        onClick = onClick,
        enabled = hasProfile && status != ConnectionStatus.CONNECTING,
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp),
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(containerColor = buttonColor)
    ) {
        if (status == ConnectionStatus.CONNECTING) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = Color.White,
                strokeWidth = 2.dp
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text = when (status) {
                ConnectionStatus.CONNECTED -> "Disconnect"
                ConnectionStatus.CONNECTING -> "Connecting..."
                else -> "Connect"
            },
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun ActiveServerCard(name: String, address: String, transport: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.Dns,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text("Active Server", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
            Text(address, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (transport.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                SuggestionChip(
                    onClick = {},
                    label = { Text(transport, style = MaterialTheme.typography.labelSmall) },
                    modifier = Modifier.height(24.dp)
                )
            }
        }
    }
}

@Composable
private fun NoServerCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                Icons.Filled.Warning,
                contentDescription = null,
                tint = Color(0xFFFF9800),
                modifier = Modifier.size(32.dp)
            )
            Spacer(Modifier.height(8.dp))
            Text("No Server Selected", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
            Text(
                "Go to the Servers tab to add or select a server.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun TrafficStatsCard(stats: TrafficStats) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.BarChart,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text("Traffic", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                Text(
                    formatDuration(stats.uptimeSecs),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                StatColumn(
                    icon = Icons.Filled.ArrowUpward,
                    label = "Upload",
                    value = formatBytes(stats.bytesUp),
                    speed = formatSpeed(stats.speedUpBps),
                    color = Color(0xFF2196F3),
                    modifier = Modifier.weight(1f)
                )
                StatColumn(
                    icon = Icons.Filled.ArrowDownward,
                    label = "Download",
                    value = formatBytes(stats.bytesDown),
                    speed = formatSpeed(stats.speedDownBps),
                    color = Color(0xFF4CAF50),
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun StatColumn(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    speed: String,
    color: Color,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(speed, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// Formatters
private fun formatBytes(bytes: Long): String {
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var idx = 0
    while (value >= 1024 && idx < units.size - 1) {
        value /= 1024
        idx++
    }
    return "%.1f %s".format(value, units[idx])
}

private fun formatSpeed(bps: Long): String {
    val bytesPerSec = bps / 8.0
    return when {
        bytesPerSec < 1024 -> "%.0f B/s".format(bytesPerSec)
        bytesPerSec < 1024 * 1024 -> "%.1f KB/s".format(bytesPerSec / 1024)
        else -> "%.1f MB/s".format(bytesPerSec / (1024 * 1024))
    }
}

private fun formatDuration(seconds: Long): String {
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return if (h > 0) "%dh %02dm".format(h, m) else "%dm %02ds".format(m, s)
}
