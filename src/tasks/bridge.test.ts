import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModernHandler } from '../modern-bridge.js';
import { DurableTasks } from './store.js';
import { TaskRuntime, tasksCapability } from './runtime.js';

jest.mock('../mcp-core.js', () => ({
  createMcpServer: () => {
    const { McpServer } = jest.requireActual<typeof import('@modelcontextprotocol/sdk/server/mcp.js')>('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'fixture', version: '1' });
    server.registerTool('get_transcript', { inputSchema: {} }, () => ({ content: [{ type: 'text', text: 'synchronous fallback' }] }));
    return server;
  },
}));
function rpc(method: string, params: Record<string, unknown>, capable = true, nameOverride?: string) {
  const name = String(params.name ?? params.taskId ?? '');
  return new Request('http://localhost/mcp', { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method,
    ...(name ? { 'mcp-name': nameOverride ?? name } : {}),
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': { extensions: capable ? { [tasksCapability]: {} } : {} } } } }) });
}
it('returns durable handles only to capable clients and protects the real lifecycle methods', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'task-bridge-'));
  let allowed = true, calls = 0;
  const runtime = new TaskRuntime(new DurableTasks(join(directory, 'tasks.db'), Buffer.alloc(32, 2)), 'private-owner', () => Promise.resolve(allowed), () => { calls++; return Promise.resolve({ content: [{ type: 'text', text: 'durable result' }], _meta: { preserved: true } }); }, false);
  const handler = createModernHandler(undefined, undefined, runtime);
  const call = async (method: string, params: Record<string, unknown>, capable = true, name?: string) => {
    const response = await handler.fetch(rpc(method, params, capable, name));
    return { status: response.status, body: await response.text().then(JSON.parse) };
  };
  try {
    expect((await call('server/discover', {})).body.result.capabilities.extensions[tasksCapability]).toEqual({});
    const fallback = await call('tools/call', { name: 'get_transcript', arguments: {} }, false);
    expect(fallback.body.result.content[0].text).toBe('synchronous fallback'); expect(calls).toBe(0);
    const created = await call('tools/call', { name: 'get_transcript', arguments: {} });
    expect(created.body.result.resultType).toBe('task'); expect(calls).toBe(0);
    const taskId = created.body.result.taskId as string;
    expect((await call('tasks/get', { taskId }, true, 'wrong-task')).status).toBe(400);
    expect((await call('tasks/get', { taskId }, false)).body.error.code).toBe(-32003);
    await runtime.processOne();
    const complete = await call('tasks/get', { taskId });
    expect(complete.body.result).toMatchObject({ resultType: 'complete', status: 'completed', result: { resultType: 'complete', content: [{ type: 'text', text: 'durable result' }], _meta: { preserved: true } } });
    expect(calls).toBe(1);
    expect((await call('tasks/update', { taskId, inputResponses: { unknown: {} } })).body.result.resultType).toBe('complete');
    allowed = false;
    expect((await call('tasks/get', { taskId })).body.error.code).toBe(-32001);
    expect((await call('tasks/cancel', { taskId })).body.error.code).toBe(-32001);
    expect(calls).toBe(1);
    expect(JSON.stringify(complete.body)).not.toContain('private-owner');
  } finally { await handler.close(); rmSync(directory, { recursive: true, force: true }); }
});
