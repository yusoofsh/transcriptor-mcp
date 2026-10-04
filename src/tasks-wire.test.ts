import { createMcpHandler, Server, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
const extension = 'io.modelcontextprotocol/tasks';
function request(method: string, params: Record<string, unknown>, name: string, capabilities = true) {
  return new Request('http://localhost/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, 'mcp-name': name },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': { extensions: capabilities ? { [extension]: {} } : {} } } } }),
  });
}
it('serves explicit Tasks handlers without bypassing SDK routing or reusing a server', async () => {
  let calls = 0;
  const handler = createMcpHandler(() => {
    const server = new Server({ name: 'task-fixture', version: '1' }, { capabilities: { tools: {}, extensions: { [extension]: {} } } });
    const args = { params: z.object({ taskId: z.string() }).strict(), result: z.object({}).passthrough() };
    server.setRequestHandler('tasks/get', args, ({ taskId }) => {
      calls++;
      return { resultType: 'complete', taskId, status: 'completed', createdAt: '2026-01-01T00:00:00Z', lastUpdatedAt: '2026-01-01T00:00:01Z', ttlMs: 60000, result: { resultType: 'complete', content: [{ type: 'text', text: 'fixture' }] } };
    });
    server.setRequestHandler('tasks/cancel', args, () => { calls++; return { resultType: 'complete' }; });
    server.setRequestHandler('tools/call', () => ({ resultType: 'task', taskId: 't', status: 'working', createdAt: '2026-01-01T00:00:00Z', lastUpdatedAt: '2026-01-01T00:00:00Z', ttlMs: 60000, pollIntervalMs: 1000 }) as unknown as CallToolResult);
    return server;
  }, { legacy: 'reject' });
  try {
    const create = await handler.fetch(request('tools/call', { name: 'fixture', arguments: {} }, 'fixture'));
    expect(create.status).toBe(200);
    expect((await create.text().then(JSON.parse)).result).toMatchObject({ resultType: 'task', taskId: 't' });
    for (const method of ['tasks/get', 'tasks/cancel']) {
      const response = await handler.fetch(request(method, { taskId: 't' }, 't'));
      expect(response.status).toBe(200);
      expect((await response.text().then(JSON.parse)).result.resultType).toBe('complete');
    }
    const wrong = await handler.fetch(request('tasks/get', { taskId: 't' }, 'another-task'));
    expect(wrong.status).toBe(400);
    expect(calls).toBe(2);
    const unknown = await handler.fetch(request('unknown/operation', { taskId: 't' }, 't'));
    expect((await unknown.text().then(JSON.parse)).error.code).toBe(-32601);
  } finally { await handler.close(); }
});
