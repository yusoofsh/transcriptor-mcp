import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const image = process.argv[2];
if (!image || image.startsWith('-')) throw new Error('An image reference is required');
const script = String.raw`
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DurableTasks } from '/app/dist/tasks/store.js';
import { TaskRuntime, tasksCapability } from '/app/dist/tasks/runtime.js';
import { createModernHandler } from '/app/dist/modern-bridge.js';

const directory = mkdtempSync(join(tmpdir(), 'packaged-task-'));
const path = join(directory, 'tasks.db');
const producer = [
  "import { DurableTasks } from '/app/dist/tasks/store.js';",
  "const store = new DurableTasks(process.argv[1], Buffer.alloc(32, 6));",
  "const task = store.create('fixture-owner', {name:'get_transcript',arguments:{url:'https://fixture.invalid/private-source'}});",
  "console.log(JSON.stringify(task)); store.close();",
].join('\n');
const child = spawnSync(process.execPath, ['--input-type=module', '-e', producer, path], { encoding: 'utf8', timeout: 10000 });
assert.equal(child.status, 0, child.stderr);
const persisted = JSON.parse(child.stdout);
assert.equal(persisted.status, 'working');
let calls = 0, authorized = true;
const store = new DurableTasks(path, Buffer.alloc(32, 6));
const runtime = new TaskRuntime(store, 'fixture-owner', () => Promise.resolve(authorized), () => {
  calls++;
  return Promise.resolve({ content: [{ type: 'text', text: 'private fixture transcript' }], _meta: { original: true } });
});
const handler = createModernHandler(undefined, undefined, runtime);
let id = 0;
async function rpc(method, params, capable = true, overrideName) {
  const name = params.name ?? params.taskId;
  const response = await handler.fetch(new Request('http://localhost/mcp', {
    method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-method': method, 'mcp-protocol-version': '2026-07-28',
      ...(typeof name === 'string' ? { 'mcp-name': overrideName ?? name } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': { extensions: capable ? { [tasksCapability]: {} } : {} },
    } } }),
  }));
  return { status: response.status, body: await response.json() };
}
try {
  const discovery = await rpc('server/discover', {});
  assert.deepEqual(discovery.body.result.capabilities.extensions[tasksCapability], {});
  const badName = await rpc('tasks/get', { taskId: persisted.taskId }, true, 'different');
  assert.equal(badName.status, 400);
  assert.equal((await rpc('tasks/get', { taskId: persisted.taskId }, false)).body.error.code, -32003);
  const deadline = Date.now() + 8000;
  let snapshot;
  do {
    snapshot = (await rpc('tasks/get', { taskId: persisted.taskId })).body.result;
    if (snapshot?.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(calls, 1);
  assert.deepEqual(snapshot.result, { resultType: 'complete', content: [{ type: 'text', text: 'private fixture transcript' }], _meta: { original: true } });
  assert.throws(() => store.describe('another-owner', persisted.taskId));
  const queued = await rpc('tools/call', { name: 'get_transcript', arguments: { url: 'https://fixture.invalid/never-called' } });
  assert.equal(queued.body.result.resultType, 'task');
  const cancelledId = queued.body.result.taskId;
  assert.equal((await rpc('tasks/cancel', { taskId: cancelledId })).body.result.resultType, 'complete');
  assert.equal((await rpc('tasks/get', { taskId: cancelledId })).body.result.status, 'cancelled');
  assert.equal((await rpc('tasks/update', { taskId: persisted.taskId, inputResponses: { ignored: { action: 'cancel' } } })).body.result.resultType, 'complete');
  authorized = false;
  assert.equal((await rpc('tasks/get', { taskId: persisted.taskId })).body.error.code, -32001);
  assert.equal((await rpc('tasks/cancel', { taskId: persisted.taskId })).body.error.code, -32001);
  assert.equal(calls, 1);
} finally {
  await handler.close();
  assert.equal(readFileSync(path).includes(Buffer.from('private fixture transcript')), false);
  assert.equal(readFileSync(path).includes(Buffer.from('https://fixture.invalid/private-source')), false);
  rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ verified: true, processRestart: true, automaticExecution: true, nativeProtocol: true, authorization: true, cancellation: true, calls: 1, network: 'disabled' }));
`;
const check = spawnSync('docker', [
  'run', '--rm', '-i', '--network', 'none', '--read-only', '--user', '1000:1000',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp',
  '-e', 'HOME=/tmp', '--entrypoint', 'node', image, '--input-type=module',
], { input: script, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
assert.equal(check.status, 0, 'Packaged task verification failed: ' + check.stderr.slice(-4000));
assert.equal(JSON.parse(check.stdout.trim()).verified, true);
console.log(check.stdout.trim());
