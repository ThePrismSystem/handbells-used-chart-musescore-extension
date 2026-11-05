<#
Drives MuseScore for the dialog tests on Windows (test/gui/drivers/windows.js).
  windows.ps1 -Action find -ProcessId 123 -Title name   exits 0 when that process has a window whose title holds the text, 3 when not
  windows.ps1 -Action key -ProcessId 123 -Keys 17,72    brings MuseScore forward, then presses the virtual keys together
  windows.ps1 -Action click -X 10 -Y 20                 a left click at that point on the screen
  windows.ps1 -Action shot -File out.png                the whole screen
#>
param(
    [Parameter(Mandatory = $true)][ValidateSet("find", "key", "click", "shot")][string]$Action,
    [int]$ProcessId,
    [string]$Title,
    [string]$Keys,
    [int]$X,
    [int]$Y,
    [string]$File
)
$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HbucInput {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
# Screen positions in pixels, as Qt reports them at the runner's 100% scaling.
[void][HbucInput]::SetProcessDPIAware()

$KEYUP = 2
$ALT = 0x12

function Send-Key([byte]$vk, [uint32]$flags) {
    [HbucInput]::keybd_event($vk, 0, $flags, [UIntPtr]::Zero)
}

# Keys go to whichever window has the focus. When that is not MuseScore's, its main window is brought forward first.
# Windows lets a process take the foreground only just after a key press, hence the Alt.
function Enter-MuseScore([int]$id) {
    $owner = [uint32]0
    [void][HbucInput]::GetWindowThreadProcessId([HbucInput]::GetForegroundWindow(), [ref]$owner)
    if ($owner -eq $id) { return }
    $window = (Get-Process -Id $id).MainWindowHandle
    Send-Key $ALT 0
    Send-Key $ALT $KEYUP
    [void][HbucInput]::SetForegroundWindow($window)
    Start-Sleep -Milliseconds 300
}

switch ($Action) {
    "find" {
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($process -and $process.MainWindowTitle -like "*$Title*") { exit 0 }
        exit 3
    }
    "key" {
        Enter-MuseScore $ProcessId
        $codes = $Keys -split "," | ForEach-Object { [byte][int]$_ }
        foreach ($code in $codes) { Send-Key $code 0 }
        [array]::Reverse($codes)
        foreach ($code in $codes) { Send-Key $code $KEYUP }
    }
    "click" {
        [void][HbucInput]::SetCursorPos($X, $Y)
        Start-Sleep -Milliseconds 100
        [HbucInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [HbucInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
    "shot" {
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bitmap.Save($File, [System.Drawing.Imaging.ImageFormat]::Png)
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}
