#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.resolve(__dirname, '../packages/tokensafe-ui/bin/mcp.js');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverScript],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const client = new Client(
    {
      name: 'tokensafe-mcp-agent-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  try {
    if (command === 'list' || command === 'list-tools') {
      const res = await client.listTools();
      console.log(JSON.stringify(res, null, 2));
    } else if (command === 'call') {
      const toolName = args[1];
      const toolArgsJson = args[2] || '{}';
      let toolArgs: any;
      try {
        toolArgs = JSON.parse(toolArgsJson);
      } catch (err: any) {
        console.error(`Invalid JSON arguments: ${err.message}`);
        process.exit(1);
      }

      const res = await client.callTool({
        name: toolName,
        arguments: toolArgs,
      });
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log('Usage:');
      console.log('  npx tsx playground/mcp-client.ts list');
      console.log('  npx tsx playground/mcp-client.ts call <toolName> <jsonArgs>');
      process.exit(1);
    }
  } finally {
    await transport.close();
  }
}

main().catch((err) => {
  console.error('MCP Client Error:', err);
  process.exit(1);
});
