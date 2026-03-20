package com.prisma.client.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.preference.PreferenceManager

/**
 * Receiver for BOOT_COMPLETED to auto-connect VPN on device startup.
 */
class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val autoConnect = prefs.getBoolean("auto_connect_on_boot", false)

        if (!autoConnect) {
            Log.d(TAG, "Auto-connect on boot disabled, skipping")
            return
        }

        Log.i(TAG, "Boot completed — auto-connect enabled, launching app")

        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        launchIntent?.putExtra("action", "connect")
        context.startActivity(launchIntent)
    }
}
