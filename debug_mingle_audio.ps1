#!/usr/bin/env pwsh
<#
.SYNOPSIS
  debug_mingle_audio.ps1
  Mini README:
  - Purpose: list available microphone devices and optionally record a short sample to aid debugging for Mingle.
  - Structure:
    1. List devices using Get-PnpDevice.
    2. Optionally record a 3s sample when $env:MINGLE_AUDIO_DEBUG is true.
  - Notes: requires ffmpeg in PATH for recording. Set $env:MINGLE_AUDIO_DEVICE to specify the capture device.
#>
Set-StrictMode -Version Latest

$device = $env:MINGLE_AUDIO_DEVICE
$debug = $env:MINGLE_AUDIO_DEBUG -eq 'true'

Write-Host 'Available capture devices:'
try {
    Get-PnpDevice -Class AudioEndpoint | Where-Object { $_.FriendlyName -like '*microphone*' } | Format-Table -AutoSize
} catch {
    Write-Warning 'Get-PnpDevice not available. Run with administrative privileges.'
}

if ($debug) {
    Write-Host 'MINGLE_AUDIO_DEBUG enabled'
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        $out = 'mic_debug.wav'
        Write-Host "Recording 3s sample to $out"
        if ($device) {
            ffmpeg -y -f dshow -i "audio=$device" -t 3 $out
        } else {
            ffmpeg -y -f dshow -i audio="default" -t 3 $out
        }
    } else {
        Write-Warning 'ffmpeg not installed; skipping sample recording'
    }
}
