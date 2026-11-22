import { describe, it, expect } from 'vitest';
import { defineComponent, z, h, mount, renderToString, Show, For, ErrorBoundary } from '../src/index.js';

describe('Control-Flow Components (<Show>, <For>, <ErrorBoundary>)', () => {
  it('<Show> conditionally renders and toggles branches reactively', () => {
    const TestComponent = defineComponent({
      id: 'show-test',
      state: {
        isLoggedIn: z.boolean().default(false),
      },
      actions: {
        toggle: (s) => ({ ...s, isLoggedIn: !s.isLoggedIn }),
      },
      render: ({ state }) =>
        h(
          'div',
          null,
          h(
            Show,
            {
              when: () => state.isLoggedIn,
              fallback: h('span', { 'data-agent-id': 'show:guest' }, 'Please log in'),
            },
            h('span', { 'data-agent-id': 'show:user' }, 'Welcome User!')
          )
        ),
    });

    const instance = TestComponent();
    const container = document.createElement('div');
    mount(instance, container);

    // Initial state: Guest
    expect(container.querySelector('[data-agent-id="show:guest"]')?.textContent).toBe('Please log in');
    expect(container.querySelector('[data-agent-id="show:user"]')).toBeNull();

    // Toggle to Logged In
    instance.emit.toggle();
    expect(container.querySelector('[data-agent-id="show:user"]')?.textContent).toBe('Welcome User!');
    expect(container.querySelector('[data-agent-id="show:guest"]')).toBeNull();

    // Toggle back to Guest
    instance.emit.toggle();
    expect(container.querySelector('[data-agent-id="show:guest"]')?.textContent).toBe('Please log in');
  });

  it('<For> renders reactive keyed lists with item addition and removal', () => {
    const ListComponent = defineComponent({
      id: 'for-test',
      state: {
        items: z.array(z.string()).default(['Apple', 'Banana']),
      },
      actions: {
        addItem: (s, item: string) => ({ ...s, items: [...s.items, item] }),
        removeItem: (s, index: number) => ({
          ...s,
          items: s.items.filter((_, i) => i !== index),
        }),
      },
      render: ({ state }) =>
        h(
          'ul',
          { 'data-agent-id': 'list:root' },
          h(For, {
            each: () => state.items,
            children: (item, index) =>
              h(
                'li',
                { 'data-agent-id': `item:${index()}` },
                () => `${index() + 1}. ${item}`
              ),
          })
        ),
    });

    const instance = ListComponent();
    const container = document.createElement('div');
    mount(instance, container);

    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe('1. Apple');
    expect(lis[1].textContent).toBe('2. Banana');

    // Add item
    instance.emit.addItem('Cherry');
    const updatedLis = container.querySelectorAll('li');
    expect(updatedLis.length).toBe(3);
    expect(updatedLis[2].textContent).toBe('3. Cherry');

    // Remove first item
    instance.emit.removeItem(0);
    const afterRemoveLis = container.querySelectorAll('li');
    expect(afterRemoveLis.length).toBe(2);
    expect(afterRemoveLis[0].textContent).toBe('1. Banana');
  });

  it('SSR renders <Show> and <For> correctly', () => {
    const SSRComponent = defineComponent({
      id: 'ssr-control',
      state: {
        isVisible: z.boolean().default(true),
        tags: z.array(z.string()).default(['reactivity', 'signals']),
      },
      actions: {},
      render: ({ state }) =>
        h(
          'div',
          null,
          h(Show, { when: () => state.isVisible }, h('p', null, 'Visible Content')),
          h(For, {
            each: () => state.tags,
            children: (tag) => h('span', null, tag),
          })
        ),
    });

    const instance = SSRComponent();
    const ssrHtml = renderToString(instance);

    expect(ssrHtml).toContain('<p>Visible Content</p>');
    expect(ssrHtml).toContain('<span>reactivity</span>');
    expect(ssrHtml).toContain('<span>signals</span>');
  });

  it('<ErrorBoundary> catches child errors and renders fallback', () => {
    const ProblemComponent = () => {
      throw new Error('Explosion in Component!');
    };

    const SafeApp = defineComponent({
      id: 'error-test',
      state: {},
      actions: {},
      render: () =>
        h(
          'div',
          null,
          h(
            ErrorBoundary,
            {
              fallback: (err) => h('div', { class: 'error-box' }, `Caught: ${err.message}`),
            },
            h(ProblemComponent, null)
          )
        ),
    });

    const instance = SafeApp();
    const container = document.createElement('div');
    mount(instance, container);

    const errorBox = container.querySelector('.error-box');
    expect(errorBox?.textContent).toBe('Caught: Explosion in Component!');

    // Verify runtime telemetry event was logged
    expect(instance.runtimeLog.some((e) => e.type === 'error')).toBe(true);
  });
});
