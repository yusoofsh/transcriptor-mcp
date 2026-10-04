import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const image = process.argv[2];
if (!image || image.startsWith('-')) throw new Error('An image reference is required');
const isolation = ['run', '--rm', '--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp', '-e', 'HOME=/tmp'];
const expected = ['get_transcript', 'get_raw_subtitles', 'get_available_subtitles', 'get_video_info', 'get_video_chapters', 'get_video_frame', 'get_playlist_transcripts', 'search_videos'].sort();
const client = new Client({ name: 'packaged-fork-check', version: '1' });
const transport = new StdioClientTransport({ command: 'docker', args: [...isolation, '-i', '--entrypoint', 'node', image, '/app/dist/mcp.js'], stderr: 'pipe' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), expected);
  await client.listResources();
  await client.listPrompts();
} finally {
  await client.close();
  await transport.close();
}
const httpCheck = `
import assert from 'node:assert/strict';
import { buildMcpHttpApp } from '/app/dist/mcp-http.js';
const app = buildMcpHttpApp();
const decode = text => text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\\n').find(line => line.startsWith('data:')).slice(5).trim());
try {
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/mcp' })).statusCode, 405);
  const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
  const init = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'image-test', version: '1' } } } });
  assert.equal(init.statusCode, 200); assert(decode(init.body).result.capabilities.tools);
  const list = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
  assert.equal(list.statusCode, 200); assert.equal(decode(list.body).result.tools.length, 8);
} finally { await app.close(); }
`;
const check = spawnSync('docker', [...isolation, '--entrypoint', 'node', image, '--input-type=module', '-e', httpCheck], { timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (check.status !== 0) throw new Error('Packaged HTTP check failed: ' + check.stderr.slice(-4000));
console.log('Packaged stdio and HTTP discovery passed with no network, credentials or platform calls');
