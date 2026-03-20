package com.prisma.client.viewmodel

import android.app.Application
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.Gson
import com.prisma.client.core.PrismaEngine
import com.prisma.client.model.*
import com.prisma.client.service.PrismaVpnService
import com.prisma.core.PrismaCore
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class MainViewModel(application: Application) : AndroidViewModel(application) {
    companion object {
        private const val TAG = "MainViewModel"
    }

    private val engine = PrismaEngine.getInstance()
    private val gson = Gson()
    private val prefs = application.getSharedPreferences("prisma_prefs", 0)

    // State
    private val _connectionStatus = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus.asStateFlow()

    private val _profiles = MutableStateFlow<List<Profile>>(emptyList())
    val profiles: StateFlow<List<Profile>> = _profiles.asStateFlow()

    private val _selectedProfileId = MutableStateFlow<String?>(null)
    val selectedProfileId: StateFlow<String?> = _selectedProfileId.asStateFlow()

    private val _trafficStats = MutableStateFlow(TrafficStats.ZERO)
    val trafficStats: StateFlow<TrafficStats> = _trafficStats.asStateFlow()

    private val _pingResults = MutableStateFlow<Map<String, Long>>(emptyMap())
    val pingResults: StateFlow<Map<String, Long>> = _pingResults.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private var statsJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    val selectedProfile: Profile?
        get() = _profiles.value.find { it.id == _selectedProfileId.value }

    init {
        _selectedProfileId.value = prefs.getString("selected_profile_id", null)
        loadProfiles()
        startNetworkMonitor()
    }

    // -- Profiles --

    fun loadProfiles() {
        _profiles.value = engine.listProfiles()
        // Validate selection
        if (_selectedProfileId.value != null && _profiles.value.none { it.id == _selectedProfileId.value }) {
            _selectedProfileId.value = _profiles.value.firstOrNull()?.id
        }
    }

    fun selectProfile(profile: Profile) {
        _selectedProfileId.value = profile.id
        prefs.edit().putString("selected_profile_id", profile.id).apply()
    }

    fun saveProfile(profile: Profile) {
        engine.saveProfile(profile)
        loadProfiles()
    }

    fun deleteProfile(profile: Profile) {
        engine.deleteProfile(profile.id)
        if (_selectedProfileId.value == profile.id) {
            _selectedProfileId.value = null
            prefs.edit().remove("selected_profile_id").apply()
        }
        loadProfiles()
    }

    // -- Connection --

    fun prepareVpn(): Intent? {
        return VpnService.prepare(getApplication())
    }

    fun connect() {
        val profile = selectedProfile ?: return
        val configJson = gson.toJson(profile.config)

        _connectionStatus.value = ConnectionStatus.CONNECTING

        val intent = Intent(getApplication(), PrismaVpnService::class.java).apply {
            action = PrismaVpnService.ACTION_CONNECT
            putExtra(PrismaVpnService.EXTRA_CONFIG_JSON, configJson)
        }
        getApplication<Application>().startService(intent)

        startStatsPolling()
    }

    fun disconnect() {
        _connectionStatus.value = ConnectionStatus.DISCONNECTED
        stopStatsPolling()

        val intent = Intent(getApplication(), PrismaVpnService::class.java).apply {
            action = PrismaVpnService.ACTION_DISCONNECT
        }
        getApplication<Application>().startService(intent)
    }

    fun toggleConnection() {
        if (PrismaVpnService.isRunning) {
            disconnect()
        } else {
            connect()
        }
    }

    // -- Stats polling --

    private fun startStatsPolling() {
        statsJob?.cancel()
        statsJob = viewModelScope.launch(Dispatchers.IO) {
            while (isActive) {
                val status = engine.getStatus()
                withContext(Dispatchers.Main) {
                    _connectionStatus.value = status
                }

                if (status == ConnectionStatus.CONNECTED) {
                    val stats = engine.getTrafficStats()
                    withContext(Dispatchers.Main) {
                        _trafficStats.value = stats
                    }
                }

                delay(1000)
            }
        }
    }

    private fun stopStatsPolling() {
        statsJob?.cancel()
        statsJob = null
        _trafficStats.value = TrafficStats.ZERO
    }

    // -- Ping --

    fun pingAll() {
        viewModelScope.launch(Dispatchers.IO) {
            val results = mutableMapOf<String, Long>()
            for (profile in _profiles.value) {
                val addr = profile.config.serverAddr ?: continue
                val result = engine.ping(addr)
                if (result?.latencyMs != null) {
                    results[profile.id] = result.latencyMs
                }
            }
            withContext(Dispatchers.Main) {
                _pingResults.value = results
            }
        }
    }

    fun pingProfile(profile: Profile) {
        viewModelScope.launch(Dispatchers.IO) {
            val addr = profile.config.serverAddr ?: return@launch
            val result = engine.ping(addr)
            if (result?.latencyMs != null) {
                withContext(Dispatchers.Main) {
                    _pingResults.value = _pingResults.value + (profile.id to result.latencyMs)
                }
            }
        }
    }

    // -- Network monitoring --

    private fun startNetworkMonitor() {
        val cm = getApplication<Application>().getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                val type = when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkType.WIFI
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkType.CELLULAR
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkType.ETHERNET
                    else -> NetworkType.WIFI
                }
                engine.onNetworkChange(type)
            }

            override fun onLost(network: Network) {
                engine.onNetworkChange(NetworkType.DISCONNECTED)
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, callback)
        networkCallback = callback
    }

    // -- Lifecycle --

    fun onForeground() {
        engine.onForeground()
        if (PrismaVpnService.isRunning) {
            startStatsPolling()
        }
        // Refresh status
        _connectionStatus.value = if (PrismaVpnService.isRunning) {
            engine.getStatus()
        } else {
            ConnectionStatus.DISCONNECTED
        }
    }

    fun onBackground() {
        engine.onBackground()
        stopStatsPolling()
    }

    override fun onCleared() {
        super.onCleared()
        networkCallback?.let {
            try {
                val cm = getApplication<Application>().getSystemService(ConnectivityManager::class.java)
                cm?.unregisterNetworkCallback(it)
            } catch (_: Exception) {}
        }
    }
}
