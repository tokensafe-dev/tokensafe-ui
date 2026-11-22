export * from '@agent-dom/mcp';

import { createAgentDomMcpServer } from '@agent-dom/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export async function startMcpServer(): Promise<void> {
  const server = createAgentDomMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
