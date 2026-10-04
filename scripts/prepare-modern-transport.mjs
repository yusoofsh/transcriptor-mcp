import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/mcp-http.ts';
let source = readFileSync(path, 'utf8');
const before = "import { Client } from '@modelcontextprotocol/sdk/client/index.js';\nimport { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';\nimport { version } from './version.js';";
if (source.split(before).length !== 2) throw new Error('Expected the preserved Events dispatcher imports');
source = source.replace(before, "import { isLegacyRequest } from '@modelcontextprotocol/server';\nimport { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';\nimport { createModernHandler } from './modern-bridge.js';");
source = source.replace("import { EventError } from './events/core.js';\n", '');
const start = source.indexOf('  const events = getTranscriptEventHub();\n  app.post(');
const end = source.indexOf('    // The transport writes status', start);
if (start < 0 || end < 0) throw new Error('Expected the reviewed modern/legacy boundary');
source = source.slice(0, start) + `  const events = getTranscriptEventHub();
  const modern = createModernHandler(events, app.log);
  const modernNode = toNodeHandler(modern);
  app.addHook('onClose', () => modern.close());
  app.post(MCP_PATH, async (request, reply) => {
    const webRequest = await toWebRequest(request.raw, request.body);
    if (!(await isLegacyRequest(webRequest, request.body))) {
      reply.header('Cache-Control', 'no-store');
      reply.raw.setHeader('Cache-Control', 'no-store');
      reply.hijack();
      await modernNode(request.raw, reply.raw, request.body);
      return;
    }
` + source.slice(end);
writeFileSync(path, source);
