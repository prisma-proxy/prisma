package com.prisma.client.service

import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import com.prisma.client.core.PrismaEngine

/**
 * Quick Settings tile for toggling VPN connection.
 */
class PrismaTileService : TileService() {
    companion object {
        private const val TAG = "PrismaTileService"
    }

    override fun onStartListening() {
        super.onStartListening()
        updateTile()
    }

    override fun onClick() {
        super.onClick()

        if (PrismaVpnService.isRunning) {
            // Disconnect
            val intent = Intent(this, PrismaVpnService::class.java).apply {
                action = PrismaVpnService.ACTION_DISCONNECT
            }
            startService(intent)
        } else {
            // Connect using last profile
            // The actual connect logic is handled by the main activity
            // since VPN permission dialog requires an Activity context
            Log.i(TAG, "Tile clicked — launching app to connect")
            val intent = packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            intent?.putExtra("action", "connect")
            startActivityAndCollapse(intent)
        }
    }

    private fun updateTile() {
        val tile = qsTile ?: return
        if (PrismaVpnService.isRunning) {
            tile.state = Tile.STATE_ACTIVE
            tile.label = "Prisma: On"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Connected"
            }
        } else {
            tile.state = Tile.STATE_INACTIVE
            tile.label = "Prisma: Off"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Disconnected"
            }
        }
        tile.updateTile()
    }
}
