package com.prisma.client

import android.app.Application
import android.content.ComponentCallbacks2
import android.util.Log
import com.prisma.client.core.PrismaEngine

class PrismaApplication : Application() {
    companion object {
        private const val TAG = "PrismaApplication"
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Prisma application starting")

        // Initialize the engine singleton
        try {
            PrismaEngine.getInstance()
            Log.i(TAG, "PrismaEngine initialized, version=${PrismaEngine.getInstance().version}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize PrismaEngine", e)
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE) {
            Log.w(TAG, "Memory pressure, notifying engine")
            try {
                PrismaEngine.getInstance().onMemoryWarning()
            } catch (_: Exception) {}
        }
    }

    override fun onTerminate() {
        try {
            PrismaEngine.getInstance().destroy()
        } catch (_: Exception) {}
        super.onTerminate()
    }
}
