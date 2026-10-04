import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableTasks, taskLeaseMs, taskTtlMs } from './store.js';
import { TaskRuntime } from './runtime.js';

const output = { content: [{ type: 'text' as const, text: 'private transcript result' }] };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-task-'));
  let now = 1000000;
  return { directory, path: join(directory, 'tasks.sqlite'), key: Buffer.alloc(32, 7), clock: () => now, advance: (ms: number) => { now += ms; }, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
it('persists a queued job before return, survives restart and preserves the exact tool result', async () => {
  const f = fixture(); let store = new DurableTasks(f.path, f.key, f.clock);
  let calls = 0;
  let runtime = new TaskRuntime(store, 'owner', () => Promise.resolve(true), () => { calls++; return Promise.resolve(output); }, false);
  try {
    const created = await runtime.start('get_transcript', { url: 'https://example.test/private-video' });
    expect(calls).toBe(0); expect(created.status).toBe('working');
    await runtime.close();
    store = new DurableTasks(f.path, f.key, f.clock);
    runtime = new TaskRuntime(store, 'owner', () => Promise.resolve(true), () => { calls++; return Promise.resolve(output); }, false);
    await runtime.processOne();
    expect((await runtime.get(created.taskId)).result).toEqual(output);
    expect(calls).toBe(1);
    expect(() => store.describe('other-owner', created.taskId)).toThrow();
    await runtime.processOne(); expect(calls).toBe(1);
    expect(readFileSync(f.path).includes(Buffer.from('private transcript result'))).toBe(false);
  } finally { await runtime.close(); f.cleanup(); }
});
it('does not replay an abandoned running attempt after restart', () => {
  const f = fixture(); let store = new DurableTasks(f.path, f.key, f.clock);
  try {
    const task = store.create('owner', { name: 'get_transcript', arguments: {} });
    expect(store.claim('owner', 'old-worker')?.id).toBe(task.taskId);
    store.close(); f.advance(taskLeaseMs + 1);
    store = new DurableTasks(f.path, f.key, f.clock);
    expect(store.claim('owner', 'new-worker')).toBeUndefined();
    expect(store.describe('owner', task.taskId)).toMatchObject({ status: 'failed', error: { code: -32603 } });
  } finally { store.close(); f.cleanup(); }
});
it('rechecks authorization before reads or work and cancels queued tasks without execution', async () => {
  const f = fixture(); const store = new DurableTasks(f.path, f.key, f.clock);
  let authorized = true, calls = 0;
  const runtime = new TaskRuntime(store, 'owner', () => Promise.resolve(authorized), () => { calls++; return Promise.resolve(output); }, false);
  try {
    const task = await runtime.start('get_transcript', {});
    authorized = false;
    await expect(runtime.get(task.taskId)).rejects.toThrow();
    await expect(runtime.processOne()).rejects.toThrow();
    expect(calls).toBe(0);
    authorized = true;
    await runtime.cancel(task.taskId); await runtime.processOne();
    expect((await runtime.get(task.taskId)).status).toBe('cancelled'); expect(calls).toBe(0);
    f.advance(taskTtlMs + 1); await expect(runtime.get(task.taskId)).rejects.toThrow();
  } finally { await runtime.close(); f.cleanup(); }
});
it('keeps tool errors completed and bounds queue capacity', async () => {
  const f = fixture(); const store = new DurableTasks(f.path, f.key, f.clock);
  const result = { ...output, isError: true };
  const runtime = new TaskRuntime(store, 'owner', () => Promise.resolve(true), () => Promise.resolve(result), false);
  try {
    const task = await runtime.start('get_transcript', {}); await runtime.processOne();
    expect(await runtime.get(task.taskId)).toMatchObject({ status: 'completed', result });
    for (let i = 0; i < 8; i++) await runtime.start('get_transcript', {});
    await expect(runtime.start('get_transcript', {})).rejects.toThrow(/capacity/);
    await expect(runtime.start('send_message', {})).rejects.toThrow();
  } finally { await runtime.close(); f.cleanup(); }
});
