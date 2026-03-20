package com.prisma.core

/**
 * JNI bridge to the prisma-ffi Rust library.
 *
 * All native methods map to the JNI functions in prisma-ffi/src/android.rs.
 * The native library is loaded once by the companion object initializer.
 */
object PrismaCore {
    // Error codes (match prisma-ffi constants)
    const val OK = 0
    const val ERR_INVALID_CONFIG = 1
    const val ERR_ALREADY_CONNECTED = 2
    const val ERR_NOT_CONNECTED = 3
    const val ERR_PERMISSION_DENIED = 4
    const val ERR_INTERNAL = 5
    const val ERR_NULL_POINTER = 6

    // Status codes
    const val STATUS_DISCONNECTED = 0
    const val STATUS_CONNECTING = 1
    const val STATUS_CONNECTED = 2
    const val STATUS_ERROR = 3

    // Network types
    const val NET_DISCONNECTED = 0
    const val NET_WIFI = 1
    const val NET_CELLULAR = 2
    const val NET_ETHERNET = 3

    // Proxy modes
    const val MODE_SOCKS5 = 0x01
    const val MODE_SYSTEM_PROXY = 0x02
    const val MODE_TUN = 0x04
    const val MODE_PER_APP = 0x08

    init {
        System.loadLibrary("prisma_ffi")
    }

    // Lifecycle
    external fun nativeCreate(): Long
    external fun nativeDestroy(handle: Long)

    // Connection
    external fun nativeConnect(handle: Long, configJson: String, modes: Int): Int
    external fun nativeDisconnect(handle: Long): Int
    external fun nativeGetStatus(handle: Long): Int
    external fun nativeGetStatsJson(handle: Long): String?

    // Config
    external fun nativeSetConfig(configJson: String): Int

    // Profiles
    external fun nativeProfilesList(): String?
    external fun nativeProfileSave(profileJson: String): Int
    external fun nativeProfileDelete(id: String): Int

    // Mobile lifecycle
    external fun nativeOnNetworkChange(handle: Long, networkType: Int): Int
    external fun nativeOnMemoryWarning(handle: Long): Int
    external fun nativeOnBackground(handle: Long): Int
    external fun nativeOnForeground(handle: Long): Int

    // Traffic stats
    external fun nativeGetTrafficStats(handle: Long): String?

    // Version
    external fun nativeVersion(): String

    // System proxy
    external fun nativeSetSystemProxy(host: String, port: Int): Int
    external fun nativeClearSystemProxy(): Int

    // Ping
    external fun nativePing(serverAddr: String): String?
}
