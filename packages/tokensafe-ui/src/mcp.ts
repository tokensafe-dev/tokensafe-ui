export * from '@tokensafe-ui/mcp';

import { createTokensafeMcpServer } from '@tokensafe-ui/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export async function startMcpServer(): Promise<void> {
  const server = createTokensafeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
