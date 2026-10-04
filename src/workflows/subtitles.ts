export interface SubtitleCue { index: number; startMs: number; endMs: number; text: string }
/** Parse bounded SRT/WebVTT as text. Payloads are never HTML or URLs to execute. */
export function parseSubtitles(text: string) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('Subtitle input exceeds the one-megabyte limit');
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const cues: SubtitleCue[] = [], warnings: string[] = [];
  function timestamp(value: string): number | null {
    const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return null;
    return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
  }
  let ignored = 0;
  for (const block of blocks) {
    if (/^(WEBVTT(?:\s|$)|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) continue;
    const lines = block.split('\n'), line = lines.findIndex(row => row.includes('-->'));
    const timing = line < 0 ? null : /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[line].trim());
    const startMs = timing ? timestamp(timing[1]) : null, endMs = timing ? timestamp(timing[2]) : null;
    if (startMs === null || endMs === null || endMs < startMs || line + 1 >= lines.length) { ignored++; continue; }
    if (cues.length >= 5000) { warnings.push('Only the first 5000 valid cues are shown.'); break; }
    const payload = lines.slice(line + 1).join('\n');
    if (payload.length > 8000) { ignored++; continue; }
    cues.push({ index: cues.length + 1, startMs, endMs, text: payload });
  }
  if (ignored) warnings.push(`${ignored} malformed or oversized cue blocks were not shown. The original file was not changed.`);
  return { cues, warnings, complete: ignored === 0 && !warnings.length };
}
