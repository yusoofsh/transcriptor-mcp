import { createModernHandler } from '../modern-bridge.js';
import { subtitleViewerUri } from './subtitle-viewer.js';
function rpc(method: string, params: Record<string, unknown> = {}) {
  return new Request('http://localhost/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(typeof (params.name ?? params.uri) === 'string' ? { 'mcp-name': String(params.name ?? params.uri) } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/skills': {} } } } } }) });
}
it('exposes complete skills and the viewer without calling external platforms', async () => {
  const handler = createModernHandler();
  try {
    const skills = await (await handler.fetch(rpc('skills/list'))).text().then(JSON.parse);
    expect(skills.result.skills).toHaveLength(2);
    expect(skills.result.cacheScope).toBe('private');
    const resource = await (await handler.fetch(rpc('resources/read', { uri: skills.result.skills[0].uri }))).text().then(JSON.parse);
    expect(resource.result.contents[0].text).toContain('name:');
    const tools = await (await handler.fetch(rpc('tools/list'))).text().then(JSON.parse);
    expect(tools.result.tools).toHaveLength(9);
    expect(tools.result.tools.filter((tool: { name: string }) => tool.name === 'get_transcript')).toHaveLength(1);
    const open = await (await handler.fetch(rpc('tools/call', { name: 'open_subtitle_viewer', arguments: {} }))).text().then(JSON.parse);
    expect(open.result.resultType).toBe('complete');
    const view = await (await handler.fetch(rpc('resources/read', { uri: subtitleViewerUri }))).text().then(JSON.parse);
    expect(view.result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(view.result.contents[0]._meta.ui.csp.connectDomains).toEqual([]);
    expect(view.result.contents[0].text).not.toContain('openai/resources/write');
  } finally { await handler.close(); }
});
