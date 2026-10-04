import {
  createMcpHandler,
  Server,
  ProtocolError,
  type ListToolsResult,
  type CallToolResult,
} from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import { createMcpServer } from './mcp-core.js';
import { version } from './version.js';
import { EventError, type EventHub } from './events/core.js';

/** The SDK validates the wire request; existing handlers retain business behavior. */
export function createModernHandler(events?: EventHub, logger?: FastifyBaseLogger) {
  async function delegated<T>(read: (client: Client) => Promise<T>): Promise<T> {
    const legacy = createMcpServer({ logger });
    const client = new Client({ name: 'transcriptor-compatibility', version });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await legacy.connect(serverTransport);
      await client.connect(clientTransport);
      return await read(client);
    } finally {
      await client.close();
      await legacy.close();
    }
  }
  return createMcpHandler(
    () => {
      const server = new Server(
        { name: 'transcriptor-mcp', version },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            ...(events ? { events: {} } : {}),
          },
        }
      );
      // The two SDK versions model JSON Schema differently. Both wire ends validate it.
      server.setRequestHandler('tools/list', async (request, context) => ({
        ...((await delegated((client) =>
          client.listTools(request.params, { signal: context.mcpReq.signal })
        )) as unknown as ListToolsResult),
        resultType: 'complete',
      }));
      server.setRequestHandler('tools/call', async (request, context) => ({
        ...((await delegated((client) =>
          client.callTool(request.params, undefined, { signal: context.mcpReq.signal })
        )) as unknown as CallToolResult),
        resultType: 'complete',
      }));
      server.setRequestHandler('resources/list', async (request, context) => ({
        ...(await delegated((client) =>
          client.listResources(request.params, { signal: context.mcpReq.signal })
        )),
        resultType: 'complete',
      }));
      server.setRequestHandler('resources/templates/list', async (request, context) => ({
        ...(await delegated((client) =>
          client.listResourceTemplates(request.params, { signal: context.mcpReq.signal })
        )),
        resultType: 'complete',
      }));
      server.setRequestHandler('resources/read', async (request, context) => ({
        ...(await delegated((client) =>
          client.readResource(request.params, { signal: context.mcpReq.signal })
        )),
        resultType: 'complete',
      }));
      server.setRequestHandler('prompts/list', async (request, context) => ({
        ...(await delegated((client) =>
          client.listPrompts(request.params, { signal: context.mcpReq.signal })
        )),
        resultType: 'complete',
      }));
      server.setRequestHandler('prompts/get', async (request, context) => ({
        ...(await delegated((client) =>
          client.getPrompt(request.params, { signal: context.mcpReq.signal })
        )),
        resultType: 'complete',
      }));
      if (events) {
        for (const method of ['events/list', 'events/subscribe', 'events/unsubscribe']) {
          server.setRequestHandler(
            method,
            {
              params: z.record(z.string(), z.unknown()),
              result: z.object({ resultType: z.literal('complete') }).passthrough(),
            },
            async (params) => {
              try {
                const result = await events.handle(
                  method,
                  params,
                  process.env.MCP_EVENTS_PRINCIPAL!
                );
                return {
                  ...z.record(z.string(), z.unknown()).parse(result),
                  resultType: 'complete' as const,
                };
              } catch (error) {
                if (error instanceof EventError)
                  throw new ProtocolError(
                    error.code,
                    error.message,
                    error.reason ? { reason: error.reason } : undefined
                  );
                throw new ProtocolError(-32603, 'Event operation failed');
              }
            }
          );
        }
      }
      return server;
    },
    { legacy: 'reject' }
  );
}
