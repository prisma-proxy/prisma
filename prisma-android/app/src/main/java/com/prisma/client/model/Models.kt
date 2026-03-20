package com.prisma.client.model

import com.google.gson.annotations.SerializedName

data class Profile(
    val id: String,
    var name: String,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("last_used") var lastUsed: String? = null,
    val tags: List<String> = emptyList(),
    val config: ProfileConfig,
    @SerializedName("subscription_url") var subscriptionUrl: String? = null,
    @SerializedName("last_updated") var lastUpdated: String? = null
)

data class ProfileConfig(
    @SerializedName("server_addr") val serverAddr: String? = null,
    val identity: Identity? = null,
    val transport: String? = null,
    @SerializedName("cipher_suite") val cipherSuite: String? = null
)

data class Identity(
    @SerializedName("client_id") val clientId: String? = null,
    @SerializedName("auth_secret") val authSecret: String? = null
)

data class TrafficStats(
    @SerializedName("bytes_up") val bytesUp: Long = 0,
    @SerializedName("bytes_down") val bytesDown: Long = 0,
    @SerializedName("speed_up_bps") val speedUpBps: Long = 0,
    @SerializedName("speed_down_bps") val speedDownBps: Long = 0,
    @SerializedName("uptime_secs") val uptimeSecs: Long = 0
) {
    companion object {
        val ZERO = TrafficStats()
    }
}

data class PingResult(
    @SerializedName("latency_ms") val latencyMs: Long? = null,
    val error: String? = null
)

data class ImportResult(
    val count: Int,
    val profiles: List<Profile>
)

enum class ConnectionStatus {
    DISCONNECTED, CONNECTING, CONNECTED, ERROR;

    companion object {
        fun fromCode(code: Int): ConnectionStatus = when (code) {
            0 -> DISCONNECTED
            1 -> CONNECTING
            2 -> CONNECTED
            3 -> ERROR
            else -> DISCONNECTED
        }
    }
}

enum class NetworkType(val code: Int) {
    DISCONNECTED(0), WIFI(1), CELLULAR(2), ETHERNET(3)
}
