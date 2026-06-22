# Registers MDViewer.exe as the default handler for .md / .markdown files.
# Run this once after building (or moving) MDViewer.exe.
# Right-click this file -> "Run with PowerShell" (no admin required).

$exePath = Join-Path $PSScriptRoot "MDViewer.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "MDViewer.exe not found next to this script." -ForegroundColor Red
    Write-Host "Build it first with: npm run dist" -ForegroundColor Yellow
    Write-Host "Then copy this script into the same folder as bin\MDViewer.exe, or edit `$exePath above." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

$exePath = (Resolve-Path $exePath).Path
$progId = "MDViewer.Markdown"

Write-Host "Registering MDViewer at: $exePath"

# Per-user registration (HKCU) — no admin rights needed
New-Item -Path "HKCU:\Software\Classes\$progId" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId" -Name "(default)" -Value "Markdown Document"

New-Item -Path "HKCU:\Software\Classes\$progId\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId\shell\open\command" -Name "(default)" -Value "`"$exePath`" `"%1`""

New-Item -Path "HKCU:\Software\Classes\$progId\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId\DefaultIcon" -Name "(default)" -Value "$exePath,0"

foreach ($ext in ".md", ".markdown") {
    New-Item -Path "HKCU:\Software\Classes\$ext" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\Software\Classes\$ext" -Name "(default)" -Value $progId

    # Also register under OpenWithProgids so it shows in "Open with" picker
    $owPath = "HKCU:\Software\Classes\$ext\OpenWithProgids"
    New-Item -Path $owPath -Force | Out-Null
    New-ItemProperty -Path $owPath -Name $progId -PropertyType String -Value "" -Force | Out-Null
}

# Notify Explorer of the change so it takes effect immediately
$sig = '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);'
Add-Type -MemberDefinition $sig -Namespace WinAPI -Name Explorer
[WinAPI.Explorer]::SHChangeNotify(0x8000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host ""
Write-Host "Done. .md and .markdown files are now set to open in MDViewer." -ForegroundColor Green
Write-Host "If a file still opens elsewhere, right-click it once -> Open with -> MDViewer -> 'Always'." -ForegroundColor Yellow
Read-Host "Press Enter to exit"
