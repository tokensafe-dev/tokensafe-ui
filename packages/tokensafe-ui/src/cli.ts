import { startMcpServer } from './mcp.js';

interface CliArgs {
  command: string;
  args: string[];
  flags: Record<string, string>;
}

function parseCliArgs(argv: string[]): CliArgs {
  const raw = argv.slice(2);
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (const item of raw) {
    if (item.startsWith('--')) {
      const eq = item.indexOf('=');
      if (eq !== -1) {
        const k = item.slice(2, eq);
        const v = item.slice(eq + 1);
        flags[k] = v;
      } else {
        flags[item.slice(2)] = 'true';
      }
    } else {
      positional.push(item);
    }
  }

  const command = positional[0] || (flags['mcp'] ? 'mcp' : '');
  const args = positional.slice(1);

  return { command, args, flags };
}

async function callRpc(devServerUrl: string, method: string, params: any) {
  for (const endpoint of ['/__tokensafe_ui/rpc', '/__agent_dom/rpc']) {
    try {
      const res = await fetch(`${devServerUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
  }
  throw new Error(`Failed to connect to TokenSafe UI dev server at ${devServerUrl}. Ensure Vite is running.`);
}

export async function runCli(argv = process.argv): Promise<void> {
  const { command, args, flags } = parseCliArgs(argv);
  const devServerUrl = flags['url'] || 'http://localhost:5173';

  switch (command) {
    case 'mcp':
    case '': {
      if (!command && Object.keys(flags).length === 0 && args.length === 0) {
        // Default when called bare: run MCP server
        await startMcpServer();
        return;
      }
      if (command === 'mcp') {
        await startMcpServer();
        return;
      }
      printUsage();
      break;
    }

    case 'test-action': {
      const [componentId, action, rawPayload] = args;
      if (!componentId || !action) {
        console.error('Usage: tokensafe-ui test-action <componentId> <action> [payloadJson] [--expect=json] [--url=url]');
        process.exit(1);
      }

      let payload: any = undefined;
      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          payload = rawPayload;
        }
      }

      let expectVal: any = undefined;
      if (flags['expect']) {
        try {
          expectVal = JSON.parse(flags['expect']);
        } catch {
          console.error('Invalid JSON for --expect');
          process.exit(1);
        }
      }

      const res = await callRpc(devServerUrl, 'test_action', {
        componentId,
        action,
        payload,
        expect: expectVal,
        filePath: flags['file'],
      });

      console.log(JSON.stringify(res.result || res, null, 2));
      if (res.result?.status === 'failed' || res.error) {
        process.exit(1);
      }
      break;
    }

    case 'test-effect': {
      const [componentId, effect, rawPayload] = args;
      if (!componentId || !effect) {
        console.error('Usage: tokensafe-ui test-effect <componentId> <effect> [payloadJson] [--timeout=ms] [--expect=json] [--url=url]');
        process.exit(1);
      }

      let payload: any = undefined;
      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          payload = rawPayload;
        }
      }

      const timeoutMs = flags['timeout'] ? Number(flags['timeout']) : 1500;
      let expectVal: any = undefined;
      if (flags['expect']) {
        try {
          expectVal = JSON.parse(flags['expect']);
        } catch {
          console.error('Invalid JSON for --expect');
          process.exit(1);
        }
      }

      const res = await callRpc(devServerUrl, 'test_effect', {
        componentId,
        effect,
        payload,
        timeoutMs,
        expect: expectVal,
        filePath: flags['file'],
      });

      console.log(JSON.stringify(res.result || res, null, 2));
      if (res.result?.status === 'failed' || res.error) {
        process.exit(1);
      }
      break;
    }

    case 'observe': {
      const level = args[0] || flags['level'] || 'L1';
      const componentId = flags['component'];
      const format = flags['format'] || 'yaml';

      const res = await callRpc(devServerUrl, 'observe', {
        level,
        componentId,
        format,
      });

      console.log(res.result?.payload || res.result?.snapshot || JSON.stringify(res, null, 2));
      break;
    }

    case 'patch': {
      const [componentId, target, name, code] = args;
      if (!componentId || !target || !code) {
        console.error('Usage: tokensafe-ui patch <componentId> <action|render|state> [name] <code> [--file=filePath] [--url=url]');
        process.exit(1);
      }

      const res = await callRpc(devServerUrl, 'apply_patch', {
        filePath: flags['file'] || `src/${componentId}.tsx`,
        patch: {
          op: target === 'action' ? 'update_action' : target === 'render' ? 'update_render' : 'update_state',
          componentId,
          name: name || undefined,
          code,
        },
      });

      console.log(JSON.stringify(res.result || res, null, 2));
      break;
    }

    case 'oracle': {
      const scenario = args[0] || flags['scenario'] || 'task-manager';
      const res = await callRpc(devServerUrl, 'run_oracle', { scenario });
      console.log(JSON.stringify(res.result || res, null, 2));
      break;
    }

    case 'help':
    case '--help':
    default: {
      printUsage();
      break;
    }
  }
}

function printUsage() {
  console.log(`
TokenSafe UI Agent CLI
Deterministic Zero-Config Protocol Runner for AI Coding Agents

Usage:
  tokensafe-ui mcp                                      Start MCP server over stdio (default)
  tokensafe-ui test-action <id> <action> [payload]      Verify state transition in <1ms
  tokensafe-ui test-effect <id> <effect> [payload]      Verify async effect & concurrency
  tokensafe-ui observe [L0|L1|L2|L3|L4]                 Progressive semantic context observation
  tokensafe-ui patch <id> <target> <name> <code>        Surgical AST symbol replacement
  tokensafe-ui oracle [scenario]                        Run in-memory acceptance verification oracle

Flags:
  --url=http://localhost:5173     Vite dev server URL (default: http://localhost:5173)
  --expect='{"count":5}'         Declarative assert contract for state values
  --timeout=ms                   Timeout in milliseconds for test-effect (default: 1500)
  --file=src/Component.tsx       Path to component file
`);
}
