import { mkdtempSync, rmSync, chmodSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableTasks } from './store.js';
import { TaskRuntime } from './runtime.js';

const result = { content: [{ type: 'text' as const, text: 'fixture' }] };
function directory() {
  return mkdtempSync(join(tmpdir(), 'task-lifecycle-'));
}
it('does not let another live worker claim the active job', async () => {
  const path = directory(),
    key = Buffer.alloc(32, 3);
  const firstStore = new DurableTasks(join(path, 'tasks.db'), key);
  const secondStore = new DurableTasks(join(path, 'tasks.db'), key);
  let release: () => void = () => {},
    started: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstCalls = 0,
    secondCalls = 0;
  const first = new TaskRuntime(
    firstStore,
    'owner',
    () => Promise.resolve(true),
    async () => {
      firstCalls++;
      started();
      await gate;
      return result;
    },
    false
  );
  const second = new TaskRuntime(
    secondStore,
    'owner',
    () => Promise.resolve(true),
    () => {
      secondCalls++;
      return Promise.resolve(result);
    },
    false
  );
  try {
    await first.start('get_transcript', { url: 'first' });
    const work = first.processOne();
    await entered;
    await second.start('get_transcript', { url: 'second' });
    await second.processOne();
    expect(secondCalls).toBe(0);
    release();
    await work;
    await second.processOne();
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
  } finally {
    release();
    await first.close();
    await second.close();
    rmSync(path, { recursive: true, force: true });
  }
});
it('persists active cancellation, signals the runner and never reruns it', async () => {
  jest.useFakeTimers();
  const path = directory(),
    store = new DurableTasks(join(path, 'tasks.db'), Buffer.alloc(32, 3));
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const runtime = new TaskRuntime(
    store,
    'owner',
    () => Promise.resolve(true),
    (_input, signal) =>
      new Promise((_resolve, reject) => {
        calls++;
        signal.addEventListener('abort', () => reject(new Error('cancelled fixture')), {
          once: true,
        });
        entered();
      }),
    false
  );
  try {
    const task = await runtime.start('get_transcript', {});
    const work = runtime.processOne();
    await started;
    await runtime.cancel(task.taskId);
    expect((await runtime.get(task.taskId)).status).toBe('working');
    await jest.advanceTimersByTimeAsync(5001);
    await work;
    expect((await runtime.get(task.taskId)).status).toBe('cancelled');
    await runtime.processOne();
    expect(calls).toBe(1);
  } finally {
    await runtime.close();
    jest.useRealTimers();
    rmSync(path, { recursive: true, force: true });
  }
});
it('refuses changed keys, shared permissions and linked database files', () => {
  const path = directory(),
    file = join(path, 'tasks.db'),
    key = Buffer.alloc(32, 3);
  let store = new DurableTasks(file, key);
  store.close();
  try {
    expect(() => new DurableTasks(file, Buffer.alloc(32, 4))).toThrow(/configured key/);
    store = new DurableTasks(file, key);
    store.close();
    const symbolic = join(path, 'linked.db');
    symlinkSync(file, symbolic);
    expect(() => new DurableTasks(symbolic, key)).toThrow();
    const hard = join(path, 'hard.db');
    linkSync(file, hard);
    expect(() => new DurableTasks(hard, key)).toThrow();
    rmSync(hard);
    chmodSync(file, 0o644);
    expect(() => new DurableTasks(file, key)).toThrow();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
