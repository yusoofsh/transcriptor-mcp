import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { workflowSkills } from './skills.js';
import { privateResult } from './core.js';
export function registerWorkflowResources(server: McpServer) {
  for (const file of workflowSkills.files) server.registerResource(file.frontmatter.name, file.uri,
    { mimeType: 'text/markdown', description: file.frontmatter.description },
    () => privateResult(workflowSkills.read(file.uri), 30000));
}
