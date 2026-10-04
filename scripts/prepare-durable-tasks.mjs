import { readFileSync, writeFileSync } from 'node:fs';
function patch(path, before, after) {
  const source = readFileSync(path, 'utf8');
  if (source.split(before).length !== 2) throw new Error('Expected one reviewed source boundary in ' + path);
  writeFileSync(path, source.replace(before, after));
}
const path = 'src/modern-bridge.ts';
patch(path, "import { workflowSkills } from './workflows/skills.js';", "import { workflowSkills } from './workflows/skills.js';\nimport { configuredTasks, registerTaskMethods, taskOperations, taskCapable, tasksCapability, type TaskRuntime } from './tasks/runtime.js';\nimport { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';");
patch(path, 'export function createModernHandler(events?: EventHub, logger?: FastifyBaseLogger) {', 'export function createModernHandler(events?: EventHub, logger?: FastifyBaseLogger, injectedTasks?: TaskRuntime) {');
patch(path, '  return createMcpHandler(\n', `  const tasks = injectedTasks ?? configuredTasks((input, signal) => delegated(async (client) => CallToolResultSchema.parse(await client.callTool({ name: input.name, arguments: input.arguments, _meta: forwardMeta(undefined, { traceparent: input.traceparent }) }, undefined, { signal }))));
  const handler = createMcpHandler(
`);
patch(path, "extensions: { 'io.modelcontextprotocol/skills': {} },", "extensions: { 'io.modelcontextprotocol/skills': {}, ...(tasks ? { [tasksCapability]: {} } : {}) },");
patch(path, "      server.setRequestHandler(\n        'skills/list',", "      if (tasks) registerTaskMethods(server, tasks);\n      server.setRequestHandler(\n        'skills/list',");
patch(path, "      server.setRequestHandler('tools/call', async (request, ctx) => {", `      server.setRequestHandler('tools/call', async (request, ctx) => {
        if (tasks && taskOperations.has(request.params.name) && taskCapable(ctx.mcpReq.envelope)) {
          return await tasks.start(request.params.name, request.params.arguments ?? {}, forwardMeta(undefined, ctx.mcpReq._meta).traceparent as string | undefined) as unknown as CallToolResult;
        }`);
patch(path, "    { legacy: 'reject' }\n  );\n}", "    { legacy: 'reject' }\n  );\n  return tasks ? { fetch: handler.fetch.bind(handler), close: async () => { await tasks.close(); await handler.close(); } } : handler;\n}");
patch('src/tasks/store.ts', '  close(): void { this.db.close(); }', '  hasWork(owner: string): boolean { return this.db.prepare("SELECT id FROM mcp_tasks WHERE owner=? AND state IN (\'queued\',\'running\') LIMIT 1").get(owner) !== undefined; }\n  close(): void { this.db.close(); }');
patch('src/tasks/runtime.ts', '  private async performOne(): Promise<void> {\n    await this.checkAuthorization();', '  private async performOne(): Promise<void> {\n    if (!this.store.hasWork(this.owner)) return;\n    await this.checkAuthorization();');
patch('src/tasks/runtime.ts', '  async close(): Promise<void> {\n    this.stopping = true;', '  async close(): Promise<void> {\n    if (this.stopping) { try { await this.active; } catch { /* Already shutting down. */ } return; }\n    this.stopping = true;');
const example = readFileSync('.env.example', 'utf8');
if (example.includes('MCP_TASKS_DB_PATH=')) throw new Error('Task path already configured in example');
writeFileSync('.env.example', example + '\n# Optional durable Tasks. Leave unset to keep existing synchronous behavior.\n# Requires a private persistent directory and the existing MCP_EVENTS_PRINCIPAL,\n# MCP_EVENTS_STATE_KEY and HTTPS MCP_EVENTS_AUTH_CHECK_URL/TOKEN ingress contract.\nMCP_TASKS_DB_PATH=\n');
