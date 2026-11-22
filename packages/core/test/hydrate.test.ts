import { describe, it, expect } from 'vitest';
import { defineComponent, z, h, renderToString, hydrate } from '../src/index.js';

describe('Isomorphic Client-Side Hydration (hydrate)', () => {
  const Counter = defineComponent({
    id: 'counter-view',
    state: {
      count: z.number().default(10),
    },
    actions: {
      inc: (s) => ({ ...s, count: s.count + 1 }),
    },
    render: ({ state, emit }) =>
      h(
        'div',
        { 'data-agent-id': 'counter-view:root' },
        h('span', { 'data-agent-id': 'counter-view:label' }, () => `Count: ${state.count}`),
        h(
          'button',
          {
            'data-agent-id': 'counter-view:btn-inc',
            onClick: () => emit.inc(),
          },
          '+1'
        )
      ),
  });

  it('hydrates server-rendered HTML and attaches live event listeners without destroying DOM', () => {
    // 1. SSR Step: render component to HTML string
    const serverInstance = Counter();
    const ssrHtml = renderToString(serverInstance);

    expect(ssrHtml).toContain('Count: 10');
    expect(ssrHtml).toContain('+1');

    // 2. Client Setup: populate container with server HTML
    const container = document.createElement('div');
    container.innerHTML = ssrHtml;

    const initialRootEl = container.firstElementChild;
    expect(initialRootEl).not.toBeNull();

    // 3. Client Hydration
    const clientInstance = Counter();
    const hydratedEl = hydrate(clientInstance, container);

    // Hydrated element should be the EXACT same DOM node from SSR (not re-created)
    expect(hydratedEl).toBe(initialRootEl);

    // 4. Test Event Listener & Reactivity
    const btn = container.querySelector(
      '[data-agent-id="counter-view:btn-inc"]'
    ) as HTMLButtonElement;
    const label = container.querySelector(
      '[data-agent-id="counter-view:label"]'
    ) as HTMLElement;

    expect(label.textContent).toBe('Count: 10');

    // Click button: should increment count and update reactive text node
    btn.click();

    expect(clientInstance.state.count).toBe(11);
    expect(label.textContent).toBe('Count: 11');
  });
});
