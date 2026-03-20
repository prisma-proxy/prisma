package com.prisma.client.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// Brand colors
val PrismaBlue = Color(0xFF3F7AFE)
val PrismaTeal = Color(0xFF00BFA5)
val PrismaGreen = Color(0xFF4CAF50)
val PrismaRed = Color(0xFFEF5350)
val PrismaOrange = Color(0xFFFF9800)

private val DarkColorScheme = darkColorScheme(
    primary = PrismaBlue,
    secondary = PrismaTeal,
    tertiary = PrismaGreen,
    error = PrismaRed,
)

private val LightColorScheme = lightColorScheme(
    primary = PrismaBlue,
    secondary = PrismaTeal,
    tertiary = PrismaGreen,
    error = PrismaRed,
)

@Composable
fun PrismaTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography(),
        content = content
    )
}
