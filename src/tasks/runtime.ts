import { randomUUID, createHash } from 'node:crypto';
import { ProtocolError, type Server } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DurableTasks, TaskAccessError, type TaskInput } from './store.js';

export const tasksCapability = 'io.modelcontextprotocol/tasks';
export const taskOperations = new Set(['get_transcript', 'get_playlist_transcripts']);
type Runner = (input: TaskInput, signal: AbortSignal) => Promise<CallToolResult>;
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function taskCapable(envelope: unknown): boolean {
  const capabilities = record(record(envelope)?.['io.modelcontextprotocol/clientCapabilities']);
  return record(record(capabilities?.extensions)?.[tasksCapability]) !== undefined;
}
export class TaskRuntime {
  private readonly worker = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private controller?: AbortController;
  private stopping = false;
  readonly owner: string;
  readonly store: DurableTasks;
  private readonly authorize: () => Promise<boolean>;
  private readonly runner: Runner;
  constructor(store: DurableTasks, owner: string, authorize: () => Promise<boolean>, runner: Runner, automatic = true) {
    this.store = store; this.owner = owner; this.authorize = authorize; this.runner = runner;
    if (!owner) throw new Error('Task owner is required');
    if (automatic) {
      this.timer = setInterval(() => { void this.processOne().catch(() => {}); }, 1000);
      this.timer.unref();
    }
  }
  private async checkAuthorization(): Promise<void> {
    if (!(await this.authorize().catch(() => false))) throw new TaskAccessError(-32001, 'Current authorization is required');
  }
  async start(name: string, args: Record<string, unknown>, traceparent?: string) {
    await this.checkAuthorization();
    if (this.stopping || !taskOperations.has(name)) throw new TaskAccessError(-32602, 'This operation is not task-enabled');
    const task = this.store.create(this.owner, { name, arguments: args, ...(traceparent ? { traceparent } : {}) });
    return { ...task, resultType: 'task' as const };
  }
  async get(id: string) { await this.checkAuthorization(); return { ...this.store.describe(this.owner, id), resultType: 'complete' as const }; }
  async cancel(id: string) { await this.checkAuthorization(); this.store.cancel(this.owner, id); return { resultType: 'complete' as const }; }
  async update(id: string) {
    // This runtime currently issues no inputRequests. Unknown response keys are ignored,
    // but ownership, expiry and current authorization are still checked.
    await this.checkAuthorization(); this.store.describe(this.owner, id);
    return { resultType: 'complete' as const };
  }
  processOne(): Promise<void> {
    if (this.stopping || this.active) return this.active ?? Promise.resolve();
    const work = this.performOne();
    this.active = work;
    void work.finally(() => { if (this.active === work) this.active = undefined; }).catch(() => {});
    return work;
  }
  private async performOne(): Promise<void> {
    await this.checkAuthorization();
    if (this.stopping) return;
    const job = this.store.claim(this.owner, this.worker);
    if (!job) return;
    const controller = new AbortController(); this.controller = controller;
    let checking = false;
    const heartbeat = setInterval(() => {
      if (checking) return;
      checking = true;
      void (async () => {
        try {
          if (!(await this.authorize()) || !this.store.heartbeat(this.owner, job.id, this.worker)) controller.abort();
        } catch { controller.abort(); }
        finally { checking = false; }
      })();
    }, 5000);
    heartbeat.unref();
    try {
      const result = await this.runner(job.input, controller.signal);
      await this.checkAuthorization();
      this.store.finish(this.owner, job.id, this.worker, result);
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'number' && Number.isInteger(error.code) ? error.code : -32603;
      this.store.fail(this.owner, job.id, this.worker, code);
    } finally {
      clearInterval(heartbeat);
      if (this.controller === controller) this.controller = undefined;
    }
  }
  async close(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    try { await this.active; } catch { /* No caller data or source errors are logged. */ }
    this.store.close();
  }
}
export function configuredTasks(runner: Runner): TaskRuntime | undefined {
  const path = process.env.MCP_TASKS_DB_PATH;
  if (!path) return undefined;
  const principal = process.env.MCP_EVENTS_PRINCIPAL;
  const key = process.env.MCP_EVENTS_STATE_KEY;
  const check = process.env.MCP_EVENTS_AUTH_CHECK_URL;
  const token = process.env.MCP_EVENTS_AUTH_CHECK_TOKEN;
  if (!principal || !key || !/^[a-fA-F0-9]{64}$/.test(key) || !check || !token) throw new Error('Tasks require the existing private ingress authorization settings and persistent state key');
  const endpoint = new URL(check);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Tasks require a valid HTTPS authorization checker');
  const owner = createHash('sha256').update(principal + '\0' + endpoint.origin + endpoint.pathname).digest('hex');
  const authorize = async () => {
    const response = await fetch(check, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ principal }) });
    return response.ok && record(await response.json())?.authorized === true;
  };
  return new TaskRuntime(new DurableTasks(path, Buffer.from(key, 'hex')), owner, authorize, runner);
}
export function registerTaskMethods(server: Server, runtime: TaskRuntime): void {
  const base = z.object({ taskId: z.string().uuid() }).strict();
  for (const method of ['tasks/get', 'tasks/cancel', 'tasks/update']) {
    const params = method === 'tasks/update' ? base.extend({ inputResponses: z.record(z.string().max(100), z.unknown()).refine(value => Object.keys(value).length <= 16) }) : base;
    server.setRequestHandler(method, { params, result: z.object({ resultType: z.literal('complete') }).passthrough() }, async (args, ctx) => {
      if (!taskCapable(ctx.mcpReq.envelope)) throw new ProtocolError(-32003, 'Declare the Tasks extension before using task methods', { requiredCapabilities: { extensions: { [tasksCapability]: {} } } });
      try {
        if (method === 'tasks/get') return await runtime.get(args.taskId);
        if (method === 'tasks/cancel') return await runtime.cancel(args.taskId);
        return await runtime.update(args.taskId);
      } catch (error) {
        if (error instanceof TaskAccessError) throw new ProtocolError(error.code, error.message);
        throw new ProtocolError(-32603, 'Task operation is unavailable');
      }
    });
  }
}
