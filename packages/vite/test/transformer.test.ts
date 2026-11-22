import { describe, it, expect } from 'vitest';
import { transformAgentDomJsx } from '../src/index.js';

describe('@agent-dom/vite - JSX Transformer', () => {
  it('transforms JSX into h() calls and auto-injects data-agent-id', () => {
    const input = `
import { defineComponent, z } from '@agent-dom/core';

export const MyCard = defineComponent({
  id: 'my-card',
  state: { count: z.number().default(0) },
  actions: {},
  render: ({ state }) => (
    <div class="card">
      <span>{state.count}</span>
    </div>
  ),
});
`;

    const res = transformAgentDomJsx(input, 'MyCard.tsx');

    // Should auto-inject h import into existing @agent-dom/core import
    expect(res.code).toContain('defineComponent, z, h');
    // Should auto-inject data-agent-id for div and span
    expect(res.code).toContain('"data-agent-id": "auto:div-1"');
    expect(res.code).toContain('"data-agent-id": "auto:span-2"');
    // Should wrap state.count into reactive closure () => state.count
    expect(res.code).toContain('() => state.count');
    // Should call h()
    expect(res.code).toContain('h("div"');
    expect(res.code).toContain('h("span"');
  });

  it('preserves existing data-agent-id if provided', () => {
    const input = `
import { defineComponent, z, h } from '@agent-dom/core';

export const MyCard = defineComponent({
  id: 'my-card',
  state: {},
  actions: {},
  render: () => <button data-agent-id="custom:btn">Click</button>,
});
`;

    const res = transformAgentDomJsx(input, 'MyCard.tsx');
    expect(res.code).toContain('"data-agent-id": "custom:btn"');
    expect(res.code).not.toContain('auto:button');
  });
});
