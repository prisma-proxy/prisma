package com.prisma.client.core

import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.prisma.client.model.*
import com.prisma.core.PrismaCore

/**
 * High-level Kotlin wrapper around PrismaCore JNI bindings.
 * Provides type-safe access to all Prisma functionality.
 */
class PrismaEngine private constructor() {
    private var handle: Long = 0L
    private val gson = Gson()

    companion object {
        private const val TAG = "PrismaEngine"

        @Volatile
        private var instance: PrismaEngine? = null

        fun getInstance(): PrismaEngine {
            return instance ?: synchronized(this) {
                instance ?: PrismaEngine().also {
                    it.initialize()
                    instance = it
                }
            }
        }
    }

    private fun initialize() {
        handle = PrismaCore.nativeCreate()
        if (handle == 0L) {
            throw RuntimeException("Failed to create PrismaClient handle")
        }
        Log.i(TAG, "PrismaEngine initialized, handle=$handle")
    }

    fun destroy() {
        if (handle != 0L) {
            PrismaCore.nativeDestroy(handle)
            handle = 0L
            instance = null
            Log.i(TAG, "PrismaEngine destroyed")
        }
    }

    // -- Connection --

    fun connect(configJson: String, modes: Int = PrismaCore.MODE_TUN): Int {
        return PrismaCore.nativeConnect(handle, configJson, modes)
    }

    fun disconnect(): Int {
        return PrismaCore.nativeDisconnect(handle)
    }

    fun getStatus(): ConnectionStatus {
        return ConnectionStatus.fromCode(PrismaCore.nativeGetStatus(handle))
    }

    val isConnected: Boolean
        get() = getStatus() == ConnectionStatus.CONNECTED

    fun getStatsJson(): String? {
        return PrismaCore.nativeGetStatsJson(handle)
    }

    fun getTrafficStats(): TrafficStats {
        val json = PrismaCore.nativeGetTrafficStats(handle) ?: return TrafficStats.ZERO
        return try {
            gson.fromJson(json, TrafficStats::class.java)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse traffic stats: $e")
            TrafficStats.ZERO
        }
    }

    // -- Version --

    val version: String
        get() = try { PrismaCore.nativeVersion() } catch (_: Exception) { "unknown" }

    // -- Profiles --

    fun listProfiles(): List<Profile> {
        val json = PrismaCore.nativeProfilesList() ?: return emptyList()
        return try {
            val type = object : TypeToken<List<Profile>>() {}.type
            gson.fromJson(json, type)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse profiles: $e")
            emptyList()
        }
    }

    fun saveProfile(profile: Profile): Int {
        val json = gson.toJson(profile)
        return PrismaCore.nativeProfileSave(json)
    }

    fun deleteProfile(id: String): Int {
        return PrismaCore.nativeProfileDelete(id)
    }

    // -- Ping --

    fun ping(serverAddr: String): PingResult? {
        val json = PrismaCore.nativePing(serverAddr) ?: return null
        return try {
            gson.fromJson(json, PingResult::class.java)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse ping result: $e")
            null
        }
    }

    // -- Mobile lifecycle --

    fun onNetworkChange(type: NetworkType) {
        PrismaCore.nativeOnNetworkChange(handle, type.code)
    }

    fun onMemoryWarning() {
        PrismaCore.nativeOnMemoryWarning(handle)
    }

    fun onBackground() {
        PrismaCore.nativeOnBackground(handle)
    }

    fun onForeground() {
        PrismaCore.nativeOnForeground(handle)
    }

    // -- Config validation --

    fun validateConfig(json: String): Boolean {
        return PrismaCore.nativeSetConfig(json) == PrismaCore.OK
    }
}
