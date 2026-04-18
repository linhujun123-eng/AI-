import type { LyricLine } from '../types/song';

/**
 * Parse LRC formatted text into an array of LyricLine objects.
 *
 * Supported formats:
 *   [mm:ss.xx] text     — centisecond precision (most common)
 *   [mm:ss.xxx] text    — millisecond precision
 *   [mm:ss] text        — whole-second precision
 *
 * Lines with no text are preserved (empty string) to mark intro/interludes.
 * Multiple timestamps on one line are expanded (e.g. [00:10.00][00:20.00] text).
 * Output is sorted by time ascending.
 */

// Matches a single [mm:ss] or [mm:ss.xx] or [mm:ss.xxx] tag
const TAG_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{2,3}))?\]/g;

/**
 * Parse a single time tag [mm:ss.xx] → seconds
 */
function parseTimeTag(min: string, sec: string, frac?: string): number {
  const minutes = parseInt(min, 10);
  const seconds = parseInt(sec, 10);
  let fraction = 0;
  if (frac) {
    // Normalize to milliseconds: "36" → 360ms, "360" → 360ms
    fraction = frac.length === 2
      ? parseInt(frac, 10) * 10
      : parseInt(frac, 10);
  }
  return minutes * 60 + seconds + fraction / 1000;
}

/**
 * Parse LRC text into LyricLine array, sorted by time.
 */
export function parseLRC(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const rawLine of lrcText.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Collect all time tags from this line
    const times: number[] = [];
    let lastIndex = 0;

    TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_RE.exec(trimmed)) !== null) {
      times.push(parseTimeTag(match[1], match[2], match[3]));
      lastIndex = TAG_RE.lastIndex;
    }

    // No valid time tags → skip (metadata lines like [ti:xxx], [ar:xxx])
    if (times.length === 0) continue;

    // Text is everything after the last tag
    const text = trimmed.slice(lastIndex).trim();

    // Expand: each timestamp gets the same text
    for (const time of times) {
      lines.push({ time, text });
    }
  }

  // Sort by time ascending (stable)
  lines.sort((a, b) => a.time - b.time);

  return lines;
}
