import { describe, it, expect } from 'vitest';
import { defineComponent, z, h, mount, renderToString } from '../src/index.js';

describe('defineComponent & DOM Runtime', () => {
  const Counter = defineComponent({
    id: 'counter-card',
    state: {
      count: z.number().default(0),
      title: z.string().default('My Counter'),
    },
    actions: {
      increment: (s) => ({ ...s, count: s.count + 1 }),
      decrement: (s) => ({ ...s, count: s.count - 1 }),
      setTitle: (s, title: string) => ({ ...s, title }),
    },
    render: ({ state, emit }) =>
      h(
        'div',
        { class: 'counter', 'data-agent-id': 'counter-card:root' },
        h('h3', { 'data-agent-id': 'counter-card:title' }, () => state.title),
        h('span', { 'data-agent-id': 'counter-card:display' }, () => state.count),
        h('button', { 'data-agent-id': 'counter-card:btn-inc', onClick: emit.increment }, '+'),
        h('button', { 'data-agent-id': 'counter-card:btn-dec', onClick: emit.decrement }, '-')
      ),
  });

  it('initializes component with schema defaults and validates state', () => {
    const instance = Counter();
    expect(instance.id).toBe('counter-card');
    expect(instance.state.count).toBe(0);
    expect(instance.state.title).toBe('My Counter');
  });

  it('mutates state via deterministic actions', () => {
    const instance = Counter();
    instance.emit.increment();
    expect(instance.state.count).toBe(1);

    instance.emit.increment();
    expect(instance.state.count).toBe(2);

    instance.emit.decrement();
    expect(instance.state.count).toBe(1);

    instance.emit.setTitle('Updated Counter');
    expect(instance.state.title).toBe('Updated Counter');
  });

  it('mounts into DOM and updates text reactively on action dispatch', () => {
    const instance = Counter();
    const container = document.createElement('div');
    mount(instance, container);

    const display = container.querySelector('[data-agent-id="counter-card:display"]');
    expect(display?.textContent).toBe('0');

    instance.emit.increment();
    expect(display?.textContent).toBe('1');

    instance.emit.increment();
    expect(display?.textContent).toBe('2');

    // Simulate clicking the inc button
    const btnInc = container.querySelector('[data-agent-id="counter-card:btn-inc"]') as HTMLButtonElement;
    btnInc.click();
    expect(display?.textContent).toBe('3');
  });

  it('renders isomorphic SSR string with embedded state script', () => {
    const instance = Counter();
    instance.emit.increment();
    instance.emit.increment();

    const ssrHtml = renderToString(instance);
    expect(ssrHtml).toContain('<div class="counter" data-agent-id="counter-card:root">');
    expect(ssrHtml).toContain('<script id="__TOKENSAFE_UI_STATE__" type="application/json">');
    expect(ssrHtml).toContain('"count":2');
  });

  it('mounts nested defineComponent instances seamlessly in parent component', () => {
    const Parent = defineComponent({
      id: 'parent-view',
      state: {
        banner: z.string().default('Parent Header'),
      },
      render: ({ state }) =>
        h(
          'div',
          { class: 'parent-container' },
          h('h1', null, () => state.banner),
          h(Counter, { initialState: { count: 10, title: 'Nested Child' } })
        ),
    });

    const parentInst = Parent();
    const container = document.createElement('div');
    mount(parentInst, container);

    const childTitle = container.querySelector('[data-agent-id="counter-card:title"]');
    const childDisplay = container.querySelector('[data-agent-id="counter-card:display"]');
    expect(childTitle?.textContent).toBe('Nested Child');
    expect(childDisplay?.textContent).toBe('10');

    const ssr = renderToString(parentInst);
    expect(ssr).toContain('Parent Header');
    expect(ssr).toContain('Nested Child');
  });
});
