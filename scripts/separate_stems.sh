#!/bin/bash
# Separate stems for all songs using Demucs htdemucs model
# Demucs outputs 4 stems: vocals, drums, bass, other
# We map them to our 7-stem structure:
#   vocals → vocals.mp3
#   drums  → drums.mp3
#   bass   → bass.mp3
#   other  → other.mp3 + acoustic_guitar.mp3 + electric_guitar.mp3 + piano.mp3

set -e

AUDIO_DIR="$(cd "$(dirname "$0")/../public/audio" && pwd)"
OUTPUT_BASE="/tmp/demucs_output"

echo "=== Demucs Stem Separation ==="
echo "Audio dir: $AUDIO_DIR"
echo ""

for SONG_DIR in "$AUDIO_DIR"/*/; do
  SONG_ID=$(basename "$SONG_DIR")
  MIX="$SONG_DIR/mix.mp3"

  if [ ! -f "$MIX" ]; then
    echo "⚠️  Skipping $SONG_ID (no mix.mp3)"
    continue
  fi

  # Skip if already has stems
  if [ -f "$SONG_DIR/vocals.mp3" ] && [ -f "$SONG_DIR/drums.mp3" ]; then
    echo "✅ $SONG_ID already has stems, skipping"
    continue
  fi

  echo "🎵 Processing: $SONG_ID"
  echo "   Input: $MIX"

  # Run Demucs with mp3 output
  python3 -m demucs \
    --mp3 \
    --mp3-bitrate 192 \
    -n htdemucs \
    -o "$OUTPUT_BASE" \
    "$MIX"

  # Demucs output: $OUTPUT_BASE/htdemucs/mix/{vocals,drums,bass,other}.mp3
  DEMUCS_OUT="$OUTPUT_BASE/htdemucs/mix"

  if [ ! -d "$DEMUCS_OUT" ]; then
    echo "   ❌ Demucs output not found at $DEMUCS_OUT"
    # Try alternative path
    DEMUCS_OUT="$OUTPUT_BASE/htdemucs/$(basename "$MIX" .mp3)"
    if [ ! -d "$DEMUCS_OUT" ]; then
      echo "   ❌ Also not found at $DEMUCS_OUT"
      continue
    fi
  fi

  echo "   Demucs output: $DEMUCS_OUT"
  ls -lh "$DEMUCS_OUT/"

  # Copy the 4 Demucs stems
  cp "$DEMUCS_OUT/vocals.mp3" "$SONG_DIR/vocals.mp3"
  cp "$DEMUCS_OUT/drums.mp3"  "$SONG_DIR/drums.mp3"
  cp "$DEMUCS_OUT/bass.mp3"   "$SONG_DIR/bass.mp3"
  cp "$DEMUCS_OUT/other.mp3"  "$SONG_DIR/other.mp3"

  # For MVP: copy 'other' to guitar/piano tracks
  # (these will sound the same as 'other' but allow individual volume control)
  cp "$DEMUCS_OUT/other.mp3"  "$SONG_DIR/acoustic_guitar.mp3"
  cp "$DEMUCS_OUT/other.mp3"  "$SONG_DIR/electric_guitar.mp3"
  cp "$DEMUCS_OUT/other.mp3"  "$SONG_DIR/piano.mp3"

  echo "   ✅ Done! Stems saved to $SONG_DIR"
  echo ""

  # Clean up demucs output for this song
  rm -rf "$DEMUCS_OUT"
done

echo "=== All done! ==="
echo ""
echo "Generated stem files per song:"
echo "  vocals.mp3          - Demucs vocals"
echo "  drums.mp3           - Demucs drums"
echo "  bass.mp3            - Demucs bass"
echo "  other.mp3           - Demucs other (everything else)"
echo "  acoustic_guitar.mp3 - = other (MVP placeholder)"
echo "  electric_guitar.mp3 - = other (MVP placeholder)"
echo "  piano.mp3           - = other (MVP placeholder)"
