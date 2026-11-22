import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAgentDomMcpServer } from 'tokensafe-ui/mcp';
import { OrderCheckout } from '../src/OrderCheckout.js';

describe('Autonomous MCP Agent: End-to-End OUMV Debug & Fix Loop', () => {
  beforeEach(() => {
    OrderCheckout();
  });

  it('autonomously reproduces, inspects, fixes, and verifies OrderCheckout bug strictly via MCP tools', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const server = createAgentDomMcpServer({
      projectRoot: process.cwd(),
    });
    await server.connect(serverTransport);

    const client = new Client(
      {
        name: 'autonomous-mcp-verifier',
        version: '1.0.0',
      },
      { capabilities: {} }
    );
    await client.connect(clientTransport);

    try {
      // 1. STEP 1: Tool Discovery
      const toolsResult = await client.listTools();
      const toolNames = toolsResult.tools.map((t) => t.name);
      expect(toolNames).toContain('agent_dom_test_action');
      expect(toolNames).toContain('agent_dom_get_component_source');
      expect(toolNames).toContain('agent_dom_apply_source_edit');

      // 2. STEP 2: Inspect Component Source & OCC Version
      const sourceResult = (await client.callTool({
        name: 'agent_dom_get_component_source',
        arguments: {
          componentId: 'order-checkout',
          filePath: 'playground/src/OrderCheckout.tsx',
        },
      })) as any;

      const sourceData = JSON.parse(sourceResult.content[0].text);
      expect(sourceData.version).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(sourceData.contract.actionNames).toContain('applyDiscount');
      expect(sourceData.contract.actionNames).toContain('updateQuantity');

      // 3. STEP 3: Verify Actions via agent_dom_test_action
      const filterResult = (await client.callTool({
        name: 'agent_dom_test_action',
        arguments: {
          componentId: 'order-checkout',
          action: 'setFilter',
          payload: { category: 'electronics' },
        },
      })) as any;

      const filterData = JSON.parse(filterResult.content[0].text);
      expect(filterData.status).toBe('passed');
      expect(filterData.diff.filterCategory.after).toBe('electronics');

      // 4. STEP 4: Verify applyDiscount Action
      const discountResult = (await client.callTool({
        name: 'agent_dom_test_action',
        arguments: {
          componentId: 'order-checkout',
          action: 'applyDiscount',
          payload: { code: 'SAVE20', percent: 20 },
        },
      })) as any;

      const discountData = JSON.parse(discountResult.content[0].text);
      expect(discountData.status).toBe('passed');
      expect(discountData.diff.discountPercent.after).toBe(20);
      expect(discountData.diff.discountAmount.after).toBe(52);
      expect(discountData.diff.total.after).toBe(223);
      expect(discountData.durationMs).toBeLessThan(50);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
