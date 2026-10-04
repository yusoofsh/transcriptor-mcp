import { parseSubtitles } from './subtitles.js';
import { subtitleViewerHtml } from './subtitle-viewer.js';
describe('bounded subtitle viewing', () => {
  it('keeps SRT and WebVTT timing and literal markup', () => {
    const srt = parseSubtitles('1\r\n00:00:01,200 --> 00:00:03,400\r\n<img src=x onerror=bad()>\r\n');
    expect(srt.cues[0]).toEqual({ index: 1, startMs: 1200, endMs: 3400, text: '<img src=x onerror=bad()>' });
    const vtt = parseSubtitles('WEBVTT\n\nNOTE hidden\nnot a cue\n\nc1\n00:02.000 --> 00:03.000 align:start\nhello');
    expect(vtt.cues[0].text).toBe('hello'); expect(vtt.cues[0].startMs).toBe(2000);
  });
  it('reports malformed and oversized data without repairing or executing it', () => {
    expect(parseSubtitles('1\n00:00:03,000 --> 00:00:02,000\nbad').complete).toBe(false);
    expect(parseSubtitles('1\n00:99:03,000 --> 00:99:04,000\nbad').cues).toEqual([]);
    expect(() => parseSubtitles('x'.repeat(1024 * 1024 + 1))).toThrow();
    expect(() => parseSubtitles('🙂'.repeat(300000))).toThrow();
    expect(subtitleViewerHtml).not.toContain('innerHTML');
    expect(subtitleViewerHtml).not.toContain('openai/resources/write');
    expect(subtitleViewerHtml).toContain('event.source!==window.parent');
    expect(subtitleViewerHtml).toContain('ui/update-model-context');
  });
});
