import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync, realpathSync, openSync, closeSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const taskTtlMs = 24 * 60 * 60 * 1000;
export const taskLeaseMs = 60000;
const maxPayloadBytes = 2 * 1024 * 1024;
export type TaskInput = { name: string; arguments: Record<string, unknown>; traceparent?: string };
type Payload = {
  input?: TaskInput;
  result?: CallToolResult;
  error?: { code: number; message: string };
};
type Row = {
  id: string;
  owner: string;
  state: string;
  created: number;
  changed: number;
  expires: number;
  lease: number;
  worker: string | null;
  cancel: number;
  payload: string;
};
export class TaskAccessError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
/** No external work runs inside this store or inside its SQLite transactions. */
export class DurableTasks {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private readonly now: () => number;
  constructor(path: string, key: Buffer, now: () => number = Date.now) {
    if (key.length !== 32 || resolve(path) !== path)
      throw new Error('Tasks require an absolute private path and 32-byte key');
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.mode & 0o077 || realpathSync(directory) !== directory)
      throw new Error('Task directory must be private and not a symbolic link');
    try {
      closeSync(
        openSync(
          path,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600
        )
      );
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
    const info = lstatSync(path);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error('Task database must be a private file owned by the process');
    this.key = createHash('sha256').update('transcriptor-tasks-v1\0').update(key).digest();
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000; PRAGMA secure_delete=ON; PRAGMA max_page_count=32768;
      CREATE TABLE IF NOT EXISTS mcp_tasks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, changed INTEGER NOT NULL, expires INTEGER NOT NULL, lease INTEGER NOT NULL DEFAULT 0, worker TEXT, cancel INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mcp_tasks_queue ON mcp_tasks(owner,state,created);
      CREATE INDEX IF NOT EXISTS mcp_tasks_expiry ON mcp_tasks(expires);
      CREATE TABLE IF NOT EXISTS mcp_task_key (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);`);
    try {
      const fingerprint = createHash('sha256').update('key-check:').update(this.key).digest('hex');
      this.db
        .prepare('INSERT OR IGNORE INTO mcp_task_key(id,fingerprint) VALUES(1,?)')
        .run(fingerprint);
      const saved = this.db.prepare('SELECT fingerprint FROM mcp_task_key WHERE id=1').get() as {
        fingerprint: string;
      };
      if (saved.fingerprint !== fingerprint)
        throw new Error('Task key differs from existing storage');
    } catch {
      this.db.close();
      throw new Error('Task storage could not be opened with the configured key');
    }
  }
  private seal(owner: string, id: string, data: Payload): string {
    const body = Buffer.from(JSON.stringify(data));
    if (body.length > maxPayloadBytes)
      throw new TaskAccessError(
        -32603,
        'Task result exceeds the storage limit; request a smaller result'
      );
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(owner + ':' + id + ':v1'));
    const bytes = Buffer.concat([cipher.update(body), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
  }
  private open(row: Row): Payload {
    const bytes = Buffer.from(row.payload, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(row.owner + ':' + row.id + ':v1'));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()
    ) as Payload;
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private row(owner: string, id: string): Row {
    const row = this.db
      .prepare('SELECT * FROM mcp_tasks WHERE id=? AND owner=? AND expires>?')
      .get(id, owner, this.now()) as Row | undefined;
    if (!row) throw new TaskAccessError(-32602, 'Task is not available or has expired');
    return row;
  }
  create(owner: string, input: TaskInput) {
    if (!owner || owner.length > 200 || Buffer.byteLength(JSON.stringify(input)) > 65536)
      throw new TaskAccessError(-32602, 'Invalid task input');
    const id = randomUUID(),
      now = this.now();
    this.transaction(() => {
      this.db.prepare("DELETE FROM mcp_tasks WHERE expires<=? AND state<>'running'").run(now);
      const counts = this.db
        .prepare(
          "SELECT COUNT(*) AS total, SUM(CASE WHEN state IN ('queued','running') THEN 1 ELSE 0 END) AS active FROM mcp_tasks WHERE owner=?"
        )
        .get(owner) as { total: number; active: number | null };
      if (counts.total >= 64 || (counts.active ?? 0) >= 8)
        throw new TaskAccessError(
          -32000,
          'Task capacity reached; finish existing tasks before creating more'
        );
      this.db
        .prepare(
          "INSERT INTO mcp_tasks(id,owner,state,created,changed,expires,payload) VALUES(?,?,'queued',?,?,?,?)"
        )
        .run(id, owner, now, now, now + taskTtlMs, this.seal(owner, id, { input }));
    });
    return this.describe(owner, id);
  }
  describe(owner: string, id: string) {
    const row = this.row(owner, id),
      payload = this.open(row);
    const status = row.state === 'queued' || row.state === 'running' ? 'working' : row.state;
    return {
      taskId: id,
      status,
      createdAt: new Date(row.created).toISOString(),
      lastUpdatedAt: new Date(row.changed).toISOString(),
      ttlMs: row.expires - row.created,
      pollIntervalMs: 5000,
      statusMessage:
        row.cancel && status === 'working'
          ? 'Cancellation requested; provider work may still be finishing'
          : row.state === 'queued'
            ? 'Queued for one existing tool invocation'
            : row.state === 'failed'
              ? 'Execution did not produce a reliable result; no automatic retry was made'
              : status,
      ...(status === 'completed'
        ? { result: { ...payload.result, resultType: 'complete' as const } }
        : {}),
      ...(status === 'failed' ? { error: payload.error } : {}),
    };
  }
  cancel(owner: string, id: string): void {
    this.row(owner, id);
    this.db
      .prepare(
        "UPDATE mcp_tasks SET cancel=1, changed=?, state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END WHERE id=? AND owner=? AND state IN ('queued','running')"
      )
      .run(this.now(), id, owner);
  }
  /** Claim once; abandoned attempts fail rather than repeating a provider effect. */
  claim(owner: string, worker: string): { id: string; input: TaskInput } | undefined {
    return this.transaction(() => {
      const now = this.now();
      const abandoned = this.db
        .prepare(
          "SELECT * FROM mcp_tasks WHERE owner=? AND state='running' AND (lease<=? OR expires<=?)"
        )
        .all(owner, now, now) as Row[];
      for (const row of abandoned)
        this.db
          .prepare(
            "UPDATE mcp_tasks SET state='failed',changed=?,payload=? WHERE id=? AND owner=? AND state='running'"
          )
          .run(
            now,
            this.seal(owner, row.id, {
              error: {
                code: -32603,
                message: 'Execution was interrupted; its outcome is unknown. It was not retried.',
              },
            }),
            row.id,
            owner
          );
      this.db.prepare("DELETE FROM mcp_tasks WHERE expires<=? AND state<>'running'").run(now);
      const running = this.db
        .prepare("SELECT id FROM mcp_tasks WHERE owner=? AND state='running' LIMIT 1")
        .get(owner);
      if (running) return undefined;
      const row = this.db
        .prepare(
          "SELECT * FROM mcp_tasks WHERE owner=? AND state='queued' AND expires>? ORDER BY created,id LIMIT 1"
        )
        .get(owner, now) as Row | undefined;
      if (!row) return undefined;
      this.db
        .prepare(
          "UPDATE mcp_tasks SET state='running',worker=?,lease=?,changed=? WHERE id=? AND state='queued'"
        )
        .run(worker, now + taskLeaseMs, now, row.id);
      const input = this.open(row).input;
      if (!input) throw new Error('Stored task input is unavailable');
      return { id: row.id, input };
    });
  }
  heartbeat(owner: string, id: string, worker: string): boolean {
    const row = this.db
      .prepare(
        "SELECT cancel,expires FROM mcp_tasks WHERE id=? AND owner=? AND worker=? AND state='running'"
      )
      .get(id, owner, worker) as { cancel: number; expires: number } | undefined;
    if (!row || row.cancel || row.expires <= this.now()) return false;
    this.db
      .prepare(
        "UPDATE mcp_tasks SET lease=? WHERE id=? AND owner=? AND worker=? AND state='running'"
      )
      .run(this.now() + taskLeaseMs, id, owner, worker);
    return true;
  }
  finish(owner: string, id: string, worker: string, result: CallToolResult): void {
    const payload = this.seal(owner, id, { result });
    this.db
      .prepare(
        "UPDATE mcp_tasks SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'completed' END, changed=?,payload=?,lease=0 WHERE id=? AND owner=? AND worker=? AND state='running'"
      )
      .run(this.now(), payload, id, owner, worker);
  }
  fail(owner: string, id: string, worker: string, code = -32603): void {
    const payload = this.seal(owner, id, {
      error: {
        code,
        message:
          'The task could not finish reliably. Inspect its source service before submitting a new request.',
      },
    });
    this.db
      .prepare(
        "UPDATE mcp_tasks SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'failed' END, changed=?,payload=?,lease=0 WHERE id=? AND owner=? AND worker=? AND state='running'"
      )
      .run(this.now(), payload, id, owner, worker);
  }
  hasWork(owner: string): boolean {
    return (
      this.db
        .prepare("SELECT id FROM mcp_tasks WHERE owner=? AND state IN ('queued','running') LIMIT 1")
        .get(owner) !== undefined
    );
  }
  close(): void {
    this.db.close();
  }
}
