import {
  subtitleViewerTool,
  subtitleViewerUri,
  subtitleViewerResource,
} from './workflows/subtitle-viewer.js';
import { workflowSkills } from './workflows/skills.js';
import { privateResult, forwardMeta } from './workflows/core.js';
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

/** Validate modern requests once, retaining the original authorized business handlers. */
export function createModernHandler(events?: EventHub, logger?: FastifyBaseLogger) {
  async function delegated<T>(read: (client: Client) => Promise<T>): Promise<T> {
    const source = createMcpServer({ logger }),
      client = new Client({ name: 'transcriptor-compatibility', version });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await source.connect(a);
      await client.connect(b);
      return await read(client);
    } finally {
      await client.close();
      await source.close();
    }
  }
  return createMcpHandler(
    () => {
      const server = new Server(
        { name: 'transcriptor-mcp', version },
        {
          capabilities: {
            extensions: { 'io.modelcontextprotocol/skills': {} },
            tools: {},
            resources: {},
            prompts: {},
            ...(events ? { events: {} } : {}),
          },
        }
      );
      server.setRequestHandler(
        'skills/list',
        {
          params: z.object({ cursor: z.string().optional() }).strict(),
          result: z.object({}).passthrough(),
        },
        (params) => {
          try {
            return {
              ...privateResult(workflowSkills.list(params.cursor), 30000),
              resultType: 'complete',
            };
          } catch {
            throw new ProtocolError(-32602, 'Invalid skills cursor');
          }
        }
      );
      server.setRequestHandler(
        'skills/get',
        {
          params: z.object({ uri: z.string().max(300) }).strict(),
          result: z.object({}).passthrough(),
        },
        (params) => {
          try {
            return {
              ...privateResult(workflowSkills.get(params.uri), 30000),
              resultType: 'complete',
            };
          } catch {
            throw new ProtocolError(-32602, 'Unknown skill');
          }
        }
      );
      server.setRequestHandler('tools/list', async (request, ctx) => {
        const result = await delegated((c) =>
          c.listTools(
            { ...request.params, _meta: forwardMeta(request.params?._meta, ctx.mcpReq._meta) },
            { signal: ctx.mcpReq.signal }
          )
        );
        return {
          ...result,
          tools: [...result.tools, subtitleViewerTool] as unknown as ListToolsResult['tools'],
          ttlMs: 0,
          cacheScope: 'private',
          resultType: 'complete',
        };
      });
      server.setRequestHandler('tools/call', async (request, ctx) => {
        if (request.params.name === subtitleViewerTool.name) {
          const args = z
            .object({
              file: z
                .object({
                  name: z
                    .string()
                    .max(200)
                    .regex(/\.(srt|vtt)$/i),
                  resourceUri: z.string().trim().min(1).max(2048),
                })
                .strict()
                .optional(),
            })
            .strict()
            .parse(request.params.arguments ?? {});
          return {
            resultType: 'complete',
            content: [
              {
                type: 'text',
                text: 'Read-only subtitle viewer. The host reads file contents only after an explicit action.',
              },
            ],
            structuredContent: args,
          };
        }
        return {
          ...((await delegated((c) =>
            c.callTool(
              { ...request.params, _meta: forwardMeta(request.params._meta, ctx.mcpReq._meta) },
              undefined,
              { signal: ctx.mcpReq.signal }
            )
          )) as unknown as CallToolResult),
          resultType: 'complete',
        };
      });
      server.setRequestHandler('resources/list', async (request, ctx) => {
        const result = await delegated((c) =>
          c.listResources(
            { ...request.params, _meta: forwardMeta(request.params?._meta, ctx.mcpReq._meta) },
            { signal: ctx.mcpReq.signal }
          )
        );
        return {
          ...result,
          resources: [
            ...result.resources,
            {
              name: 'Subtitle reader',
              uri: subtitleViewerUri,
              mimeType: 'text/html;profile=mcp-app',
            },
          ],
          ttlMs: 0,
          cacheScope: 'private',
          resultType: 'complete',
        };
      });
      server.setRequestHandler('resources/templates/list', async (request, ctx) => ({
        ...(await delegated((c) =>
          c.listResourceTemplates(
            { ...request.params, _meta: forwardMeta(request.params?._meta, ctx.mcpReq._meta) },
            { signal: ctx.mcpReq.signal }
          )
        )),
        ttlMs: 0,
        cacheScope: 'private',
        resultType: 'complete',
      }));
      server.setRequestHandler('resources/read', async (request, ctx) => {
        if (request.params.uri === subtitleViewerUri)
          return {
            ...subtitleViewerResource(),
            ttlMs: 30000,
            cacheScope: 'private',
            resultType: 'complete',
          };
        return {
          ...(await delegated((c) =>
            c.readResource(
              { ...request.params, _meta: forwardMeta(request.params._meta, ctx.mcpReq._meta) },
              { signal: ctx.mcpReq.signal }
            )
          )),
          ttlMs: 0,
          cacheScope: 'private',
          resultType: 'complete',
        };
      });
      server.setRequestHandler('prompts/list', async (request, ctx) => ({
        ...(await delegated((c) =>
          c.listPrompts(
            { ...request.params, _meta: forwardMeta(request.params?._meta, ctx.mcpReq._meta) },
            { signal: ctx.mcpReq.signal }
          )
        )),
        ttlMs: 0,
        cacheScope: 'private',
        resultType: 'complete',
      }));
      server.setRequestHandler('prompts/get', async (request, ctx) => ({
        ...(await delegated((c) =>
          c.getPrompt(
            { ...request.params, _meta: forwardMeta(request.params._meta, ctx.mcpReq._meta) },
            { signal: ctx.mcpReq.signal }
          )
        )),
        resultType: 'complete',
      }));
      if (events)
        for (const method of ['events/list', 'events/subscribe', 'events/unsubscribe']) {
          server.setRequestHandler(
            method,
            {
              params: z.record(z.string(), z.unknown()),
              result: z.object({ resultType: z.literal('complete') }).passthrough(),
            },
            async (params) => {
              try {
                return {
                  ...z
                    .record(z.string(), z.unknown())
                    .parse(await events.handle(method, params, process.env.MCP_EVENTS_PRINCIPAL!)),
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
      return server;
    },
    { legacy: 'reject' }
  );
}
