# Prisma ProGuard rules

# Keep JNI methods
-keepclasseswithmembers class com.prisma.core.PrismaCore {
    native <methods>;
}

# Keep data classes used with Gson
-keep class com.prisma.client.model.** { *; }

# Keep VPN service
-keep class com.prisma.client.service.PrismaVpnService { *; }
