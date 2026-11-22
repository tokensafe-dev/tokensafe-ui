#!/usr/bin/env node
const arg = process.argv[2];

if (arg === 'mcp' || !arg) {
  import('./mcp.js');
} else {
  console.log(`TokenSafe UI CLI\nUsage:\n  tokensafe-ui mcp    Start MCP server over stdio\n`);
}
