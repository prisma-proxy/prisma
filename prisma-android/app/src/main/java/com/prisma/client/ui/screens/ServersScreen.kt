package com.prisma.client.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.prisma.client.model.Identity
import com.prisma.client.model.Profile
import com.prisma.client.model.ProfileConfig
import com.prisma.client.viewmodel.MainViewModel
import java.time.Instant
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServersScreen(
    viewModel: MainViewModel,
    onScanQR: () -> Unit
) {
    val profiles by viewModel.profiles.collectAsState()
    val selectedId by viewModel.selectedProfileId.collectAsState()
    val pingResults by viewModel.pingResults.collectAsState()

    var showAddDialog by remember { mutableStateOf(false) }
    var showSubscriptionDialog by remember { mutableStateOf(false) }
    var profileToDelete by remember { mutableStateOf<Profile?>(null) }
    var searchQuery by remember { mutableStateOf("") }

    val filteredProfiles = if (searchQuery.isBlank()) profiles
    else profiles.filter {
        it.name.contains(searchQuery, ignoreCase = true) ||
                (it.config.serverAddr ?: "").contains(searchQuery, ignoreCase = true)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Servers") },
                actions = {
                    IconButton(onClick = { viewModel.pingAll() }) {
                        Icon(Icons.Filled.NetworkPing, "Ping all")
                    }
                    IconButton(onClick = { showAddDialog = true }) {
                        Icon(Icons.Filled.Add, "Add server")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Filled.Add, "Add server")
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // Search bar
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search servers...") },
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )

            if (filteredProfiles.isEmpty()) {
                // Empty state
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Filled.Dns,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "No Servers",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Add a server manually, scan a QR code,\nor import from a subscription.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(16.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilledTonalButton(onClick = onScanQR) {
                                Icon(Icons.Filled.QrCodeScanner, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Scan QR")
                            }
                            FilledTonalButton(onClick = { showSubscriptionDialog = true }) {
                                Icon(Icons.Filled.Link, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("URL")
                            }
                        }
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filteredProfiles, key = { it.id }) { profile ->
                        ServerCard(
                            profile = profile,
                            isSelected = profile.id == selectedId,
                            latency = pingResults[profile.id],
                            onClick = { viewModel.selectProfile(profile) },
                            onDelete = { profileToDelete = profile },
                            onPing = { viewModel.pingProfile(profile) }
                        )
                    }
                }
            }
        }
    }

    // Add server dialog
    if (showAddDialog) {
        AddServerDialog(
            onDismiss = { showAddDialog = false },
            onSave = { profile ->
                viewModel.saveProfile(profile)
                viewModel.selectProfile(profile)
                showAddDialog = false
            },
            onScanQR = {
                showAddDialog = false
                onScanQR()
            }
        )
    }

    // Delete confirmation
    profileToDelete?.let { profile ->
        AlertDialog(
            onDismissRequest = { profileToDelete = null },
            title = { Text("Delete Server") },
            text = { Text("Delete \"${profile.name}\"?") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteProfile(profile)
                    profileToDelete = null
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { profileToDelete = null }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun ServerCard(
    profile: Profile,
    isSelected: Boolean,
    latency: Long?,
    onClick: () -> Unit,
    onDelete: () -> Unit,
    onPing: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (isSelected) Icons.Filled.RadioButtonChecked else Icons.Filled.RadioButtonUnchecked,
                contentDescription = null,
                tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(24.dp)
            )
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    profile.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    profile.config.serverAddr?.let { addr ->
                        Text(addr, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    profile.config.transport?.let { transport ->
                        SuggestionChip(
                            onClick = {},
                            label = { Text(transport.uppercase(), style = MaterialTheme.typography.labelSmall) },
                            modifier = Modifier.height(20.dp)
                        )
                    }
                }
            }

            // Latency
            latency?.let { ms ->
                val color = when {
                    ms < 100 -> Color(0xFF4CAF50)
                    ms < 200 -> Color(0xFFFFC107)
                    else -> Color(0xFFEF5350)
                }
                Text(
                    "${ms}ms",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = color
                )
                Spacer(Modifier.width(8.dp))
            }

            IconButton(onClick = onPing, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.NetworkPing, "Ping", modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Delete, "Delete", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun AddServerDialog(
    onDismiss: () -> Unit,
    onSave: (Profile) -> Unit,
    onScanQR: () -> Unit
) {
    var name by remember { mutableStateOf("") }
    var serverAddr by remember { mutableStateOf("") }
    var clientId by remember { mutableStateOf("") }
    var authSecret by remember { mutableStateOf("") }
    var transport by remember { mutableStateOf("prisma-tls") }
    val transports = listOf("prisma-tls", "quic-v2", "websocket", "grpc", "xporta")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Server") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = serverAddr, onValueChange = { serverAddr = it }, label = { Text("Address (host:port)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = clientId, onValueChange = { clientId = it }, label = { Text("Client ID") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = authSecret, onValueChange = { authSecret = it }, label = { Text("Auth Secret") }, singleLine = true, modifier = Modifier.fillMaxWidth())

                // Transport picker
                var expanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                    OutlinedTextField(
                        value = transport.uppercase(),
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Transport") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor()
                    )
                    ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        transports.forEach { t ->
                            DropdownMenuItem(text = { Text(t.uppercase()) }, onClick = { transport = t; expanded = false })
                        }
                    }
                }

                TextButton(onClick = onScanQR) {
                    Icon(Icons.Filled.QrCodeScanner, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Scan QR Code Instead")
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val profile = Profile(
                        id = UUID.randomUUID().toString(),
                        name = name.ifBlank { serverAddr },
                        createdAt = Instant.now().toString(),
                        tags = emptyList(),
                        config = ProfileConfig(
                            serverAddr = serverAddr,
                            identity = Identity(
                                clientId = clientId.ifBlank { null },
                                authSecret = authSecret.ifBlank { null }
                            ),
                            transport = transport
                        )
                    )
                    onSave(profile)
                },
                enabled = name.isNotBlank() && serverAddr.isNotBlank()
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
