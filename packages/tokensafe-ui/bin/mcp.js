#!/usr/bin/env node
import { startMcpServer } from '../dist/mcp.js';

startMcpServer().catch((err) => {
  console.error('Failed to start TokenSafe UI MCP server:', err);
  process.exit(1);
});
