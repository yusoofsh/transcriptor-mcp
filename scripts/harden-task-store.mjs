import { readFileSync, writeFileSync } from 'node:fs';
function patch(path, before, after) {
  const source = readFileSync(path, 'utf8');
  if (source.split(before).length !== 2) throw new Error('Expected one reviewed task edit in ' + path);
  writeFileSync(path, source.replace(before, after));
}
patch('src/tasks/store.ts', "if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;", "if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EEXIST') throw error;");
patch('src/tasks/store.ts', 'if (!info.isFile() || info.mode & 0o077 ||', 'if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 ||');
patch('src/tasks/store.ts', "      CREATE INDEX IF NOT EXISTS mcp_tasks_expiry ON mcp_tasks(expires);`);", `      CREATE INDEX IF NOT EXISTS mcp_tasks_expiry ON mcp_tasks(expires);
      CREATE TABLE IF NOT EXISTS mcp_task_key (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);\x60);
    try {
      const fingerprint = createHash('sha256').update('key-check:').update(this.key).digest('hex');
      this.db.prepare('INSERT OR IGNORE INTO mcp_task_key(id,fingerprint) VALUES(1,?)').run(fingerprint);
      const saved = this.db.prepare('SELECT fingerprint FROM mcp_task_key WHERE id=1').get() as { fingerprint: string };
      if (saved.fingerprint !== fingerprint) throw new Error('Task key differs from existing storage');
    } catch { this.db.close(); throw new Error('Task storage could not be opened with the configured key'); }`);
patch('src/tasks/store.ts', "{ result: payload.result }", "{ result: { ...payload.result, resultType: 'complete' as const } }");
patch('src/tasks/runtime.test.ts', 'expect((await runtime.get(created.taskId)).result).toEqual(output);', "expect((await runtime.get(created.taskId)).result).toEqual({ ...output, resultType: 'complete' });");
