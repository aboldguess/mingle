#!/usr/bin/env bash
# debug_mingle_audio.sh
# Mini README:
# - Purpose: list available microphone devices and optionally record a short sample to aid debugging for Mingle.
# - Structure:
#   1. List devices using arecord or pactl.
#   2. Optionally record a 3s sample when MINGLE_AUDIO_DEBUG=true.
# - Notes: requires alsa-utils or pulseaudio-utils. Set MINGLE_AUDIO_DEVICE to choose a device. ffmpeg is used for recording if available.
set -euo pipefail

DEVICE="${MINGLE_AUDIO_DEVICE:-}"
DEBUG="${MINGLE_AUDIO_DEBUG:-false}"

echo "Available capture devices:"
if command -v arecord >/dev/null 2>&1; then
  arecord -l || true
elif command -v pactl >/dev/null 2>&1; then
  pactl list short sources || true
else
  echo "No arecord or pactl found. Install alsa-utils or pulseaudio-utils." >&2
fi

if [ "$DEBUG" = "true" ]; then
  echo "MINGLE_AUDIO_DEBUG enabled"
  if command -v ffmpeg >/dev/null 2>&1; then
    OUTPUT_FILE="mic_debug.wav"
    echo "Recording 3s sample to $OUTPUT_FILE"
    if [ -n "$DEVICE" ]; then
      ffmpeg -y -f alsa -i "$DEVICE" -t 3 "$OUTPUT_FILE"
    else
      ffmpeg -y -f alsa -i default -t 3 "$OUTPUT_FILE"
    fi
  else
    echo "ffmpeg not installed; skipping sample recording" >&2
  fi
fi
