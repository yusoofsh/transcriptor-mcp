import { createModernHandler } from './modern-bridge.js';
import { EventError, type EventHub } from './events/core.js';

jest.mock('./mcp-core.js', () => ({
  createMcpServer: () => {
    const { McpServer } = jest.requireActual<
      typeof import('@modelcontextprotocol/sdk/server/mcp.js')
    >('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'fixture', version: '1' });
    server.registerTool(
      'fixture_read',
      { inputSchema: {}, _meta: { ui: { resourceUri: 'ui://fixture/view.html' } } },
      () => ({ content: [{ type: 'text', text: 'read' }], _meta: { fixture: 'retained' } })
    );
    server.registerResource(
      'fixture',
      'ui://fixture/view.html',
      { mimeType: 'text/html;profile=mcp-app' },
      () => ({
        contents: [
          {
            uri: 'ui://fixture/view.html',
            mimeType: 'text/html;profile=mcp-app',
            text: '<h1>fixture</h1>',
            _meta: { ui: { csp: { connectDomains: [] } } },
          },
        ],
      })
    );
    server.registerPrompt('fixture_prompt', {}, () => ({
      messages: [{ role: 'user', content: { type: 'text', text: 'fixture prompt' } }],
    }));
    return server;
  },
}));
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};
function rpc(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  const name = params.name ?? params.uri;
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof name === 'string' ? { 'mcp-name': name } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: meta } }),
  });
}
describe('modern and legacy feature parity', () => {
  it('preserves discovery, widget metadata, resources and prompts', async () => {
    const handler = createModernHandler();
    try {
      const discover = await (await handler.fetch(rpc('server/discover'))).text().then(JSON.parse);
      expect(discover.result.supportedVersions).toContain('2026-07-28');
      expect(discover.result.capabilities).toMatchObject({ tools: {}, resources: {}, prompts: {} });
      const tools = await (await handler.fetch(rpc('tools/list'))).text().then(JSON.parse);
      expect(tools.result.tools[0]._meta.ui.resourceUri).toBe('ui://fixture/view.html');
      const call = await (
        await handler.fetch(rpc('tools/call', { name: 'fixture_read', arguments: {} }))
      )
        .text()
        .then(JSON.parse);
      expect(call.result._meta.fixture).toBe('retained');
      const resources = await (await handler.fetch(rpc('resources/list'))).text().then(JSON.parse);
      expect(resources.result.resources[0].uri).toBe('ui://fixture/view.html');
      const resource = await (
        await handler.fetch(rpc('resources/read', { uri: 'ui://fixture/view.html' }))
      )
        .text()
        .then(JSON.parse);
      expect(resource.result.resultType).toBe('complete');
      expect(resource.result.contents[0].text).toBe('<h1>fixture</h1>');
      expect(resource.result.contents[0]._meta.ui.csp.connectDomains).toEqual([]);
      const prompts = await (await handler.fetch(rpc('prompts/list'))).text().then(JSON.parse);
      expect(prompts.result.prompts[0].name).toBe('fixture_prompt');
      const prompt = await (
        await handler.fetch(rpc('prompts/get', { name: 'fixture_prompt', arguments: {} }))
      )
        .text()
        .then(JSON.parse);
      expect(prompt.result.messages[0].content.text).toBe('fixture prompt');
    } finally {
      await handler.close();
    }
  });
  it('rejects invalid headers before discovery or an Events callback', async () => {
    const callback = jest.fn().mockResolvedValue({ events: [] });
    const handler = createModernHandler({ handle: callback } as unknown as EventHub);
    try {
      for (const method of [
        'server/discover',
        'events/list',
        'events/subscribe',
        'events/unsubscribe',
      ]) {
        const response = await handler.fetch(rpc(method, {}, { 'mcp-method': 'tools/list' }));
        expect(response.status).toBe(400);
      }
      expect(callback).not.toHaveBeenCalled();
      const response = await handler.fetch(rpc('events/list'));
      expect(response.status).toBe(200);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      await handler.close();
    }
  });
  it('preserves safe extension error codes and reasons', async () => {
    const callback = jest
      .fn()
      .mockRejectedValue(new EventError(-32602, 'Invalid event request', 'invalid_filter'));
    const handler = createModernHandler({ handle: callback } as unknown as EventHub);
    try {
      const body = await (await handler.fetch(rpc('events/subscribe'))).text().then(JSON.parse);
      expect(body.error.code).toBe(-32602);
      expect(body.error.data.reason).toBe('invalid_filter');
    } finally {
      await handler.close();
    }
  });
});
