Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class EmulatorMover {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public static List<IntPtr> FindEmulatorWindows() {
        var windows = new List<IntPtr>();
        EnumWindows((hwnd, lparam) => {
            var sb = new StringBuilder(256);
            GetWindowText(hwnd, sb, 256);
            string title = sb.ToString();
            if ((title.Contains("Android Emulator") || title.Contains("Medium_Phone") || title.Contains("emulator")) && IsWindowVisible(hwnd)) {
                windows.Add(hwnd);
            }
            return true;
        }, IntPtr.Zero);
        return windows;
    }
}
"@

Write-Host "Waiting for Android Emulator window..."
$maxWait = 60
$elapsed = 0
$moved = $false

while ($elapsed -lt $maxWait -and -not $moved) {
    $windows = [EmulatorMover]::FindEmulatorWindows()
    foreach ($hwnd in $windows) {
        $sb = New-Object System.Text.StringBuilder 256
        [EmulatorMover]::GetWindowText($hwnd, $sb, 256) | Out-Null
        Write-Host "Found: $($sb.ToString())"
        # SW_RESTORE = 9 (restore if minimized)
        [EmulatorMover]::ShowWindow($hwnd, 9) | Out-Null
        # Center on 2560x1440: place at (800, 100) with size 450x950
        [EmulatorMover]::MoveWindow($hwnd, 800, 100, 450, 950, $true) | Out-Null
        Write-Host "Moved to center (800, 100) size 450x950"
        $moved = $true
    }
    if (-not $moved) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        Write-Host "." -NoNewline
    }
}

if (-not $moved) {
    Write-Host "`nNo emulator window found after ${maxWait}s. Make sure the emulator is running."
} else {
    Write-Host "Done!"
}
