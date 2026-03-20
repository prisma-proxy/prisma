package com.prisma.client.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import com.prisma.client.MainActivity
import com.prisma.client.R
import com.prisma.client.core.PrismaEngine
import com.prisma.core.PrismaCore

/**
 * Android VPN Service for Prisma.
 *
 * This service:
 * 1. Creates a TUN interface via VpnService.Builder
 * 2. Starts the Prisma proxy engine with TUN mode
 * 3. Runs as a foreground service with a persistent notification
 * 4. Handles reconnection and cleanup
 */
class PrismaVpnService : VpnService() {
    companion object {
        private const val TAG = "PrismaVpnService"
        private const val NOTIFICATION_CHANNEL_ID = "prisma_vpn"
        private const val NOTIFICATION_ID = 1
        const val ACTION_CONNECT = "com.prisma.client.CONNECT"
        const val ACTION_DISCONNECT = "com.prisma.client.DISCONNECT"
        const val EXTRA_CONFIG_JSON = "config_json"

        @Volatile
        var isRunning = false
            private set
    }

    private var tunFd: ParcelFileDescriptor? = null
    private var engine: PrismaEngine? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val configJson = intent.getStringExtra(EXTRA_CONFIG_JSON)
                if (configJson != null) {
                    startVpn(configJson)
                } else {
                    Log.e(TAG, "Missing config JSON in CONNECT intent")
                    stopSelf()
                }
            }
            ACTION_DISCONNECT -> {
                stopVpn()
            }
            else -> {
                Log.w(TAG, "Unknown action: ${intent?.action}")
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    override fun onRevoke() {
        // Called when the user revokes VPN permission
        Log.i(TAG, "VPN permission revoked by user")
        stopVpn()
    }

    private fun startVpn(configJson: String) {
        if (isRunning) {
            Log.w(TAG, "VPN already running, stopping first")
            stopVpn()
        }

        try {
            // Create TUN interface
            val builder = Builder()
                .setSession("Prisma")
                .setMtu(1400)
                .addAddress("10.8.0.2", 24)
                .addRoute("0.0.0.0", 0) // Route all IPv4
                .addRoute("::", 0) // Route all IPv6
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")

            // Allow the app itself to bypass the VPN (prevents routing loop)
            try {
                builder.addDisallowedApplication(packageName)
            } catch (e: Exception) {
                Log.w(TAG, "Could not exclude self from VPN: $e")
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setMetered(false)
            }

            tunFd = builder.establish()
            if (tunFd == null) {
                Log.e(TAG, "Failed to establish TUN interface")
                stopSelf()
                return
            }

            Log.i(TAG, "TUN interface established, fd=${tunFd!!.fd}")

            // Start the Prisma engine
            engine = PrismaEngine.getInstance()
            val result = engine!!.connect(configJson, PrismaCore.MODE_TUN)

            if (result != PrismaCore.OK) {
                Log.e(TAG, "Prisma connect failed with code $result")
                closeTun()
                stopSelf()
                return
            }

            isRunning = true

            // Start foreground notification
            startForeground(NOTIFICATION_ID, createNotification())

            Log.i(TAG, "VPN started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start VPN", e)
            closeTun()
            stopSelf()
        }
    }

    private fun stopVpn() {
        Log.i(TAG, "Stopping VPN")

        engine?.disconnect()
        closeTun()

        isRunning = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun closeTun() {
        try {
            tunFd?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing TUN fd: $e")
        }
        tunFd = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.vpn_notification_channel),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Prisma VPN connection status"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val mainIntent = Intent(this, MainActivity::class.java)
        val pendingMain = PendingIntent.getActivity(
            this, 0, mainIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val disconnectIntent = Intent(this, PrismaVpnService::class.java).apply {
            action = ACTION_DISCONNECT
        }
        val pendingDisconnect = PendingIntent.getService(
            this, 1, disconnectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
            .setContentTitle(getString(R.string.vpn_notification_title))
            .setContentText(getString(R.string.vpn_notification_text))
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(pendingMain)
            .addAction(
                Notification.Action.Builder(
                    null,
                    getString(R.string.action_disconnect),
                    pendingDisconnect
                ).build()
            )
            .setOngoing(true)
            .build()
    }
}
