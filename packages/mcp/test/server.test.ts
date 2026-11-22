import { describe, it, expect } from 'vitest';
import { inspectComponentContract } from '../src/index.js';

describe('@agent-dom/mcp - MCP Server Tools', () => {
  const sampleComponentSource = `
import { defineComponent, z } from '@agent-dom/core';

export const Counter = defineComponent({
  id: 'counter-card',
  state: {
    count: z.number().default(0),
    title: z.string().default('Counter'),
  },
  actions: {
    increment: (s) => ({ ...s, count: s.count + 1 }),
    decrement: (s) => ({ ...s, count: s.count - 1 }),
  },
  render: ({ state, emit }) => (
    <div class="card" data-agent-id="counter-card:root">
      <h3 data-agent-id="counter-card:title">{state.title}</h3>
      <span data-agent-id="counter-card:display">{state.count}</span>
      <button data-agent-id="counter-card:btn-inc" onClick={emit.increment}>+</button>
    </div>
  ),
});
`;

  it('inspects component contract and extracts state fields, actions, and agent IDs', () => {
    const contract = inspectComponentContract(sampleComponentSource, 'counter-card');

    expect(contract.componentId).toBe('counter-card');
    expect(contract.stateFields).toEqual(['count', 'title']);
    expect(contract.actionNames).toEqual(['increment', 'decrement']);
    expect(contract.elementAgentIds).toEqual([
      'counter-card:root',
      'counter-card:title',
      'counter-card:display',
      'counter-card:btn-inc',
    ]);
  });
});
