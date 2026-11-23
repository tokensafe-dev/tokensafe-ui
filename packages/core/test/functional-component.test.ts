import { describe, it, expect } from 'vitest';
import { h, mount, signal, Fragment } from '../src/index.js';

describe('Reactive Functional Components', () => {
  it('re-renders functional component when accessed signal mutates', () => {
    const countSig = signal(0);

    function Counter() {
      return h('div', { class: 'counter-box' }, `Count: ${countSig.value}`);
    }

    const container = document.createElement('div');
    mount(h(Counter, null), container);

    expect(container.textContent).toBe('Count: 0');

    // Mutate signal
    countSig.value = 5;
    expect(container.textContent).toBe('Count: 5');

    countSig.value = 42;
    expect(container.textContent).toBe('Count: 42');
  });

  it('switches views reactively based on active view signal', () => {
    const viewSig = signal<'home' | 'pricing'>('home');

    function Home() {
      return h('h1', null, 'Welcome Home');
    }

    function Pricing() {
      return h('h1', null, 'Predictable Pricing');
    }

    function App() {
      const view = viewSig.value;
      return h('main', null, view === 'home' ? h(Home, null) : h(Pricing, null));
    }

    const container = document.createElement('div');
    mount(h(App, null), container);

    expect(container.querySelector('h1')?.textContent).toBe('Welcome Home');

    // Switch view
    viewSig.value = 'pricing';
    expect(container.querySelector('h1')?.textContent).toBe('Predictable Pricing');

    // Switch back
    viewSig.value = 'home';
    expect(container.querySelector('h1')?.textContent).toBe('Welcome Home');
  });

  it('updates child functional component surgically without re-rendering parent', () => {
    let parentRenderCount = 0;
    let childRenderCount = 0;

    const childSig = signal('initial');

    function Child() {
      childRenderCount++;
      return h('span', { id: 'child-text' }, childSig.value);
    }

    function Parent() {
      parentRenderCount++;
      return h('div', { id: 'parent-box' }, h('header', null, 'Header'), h(Child, null));
    }

    const container = document.createElement('div');
    mount(h(Parent, null), container);

    expect(parentRenderCount).toBe(1);
    expect(childRenderCount).toBe(1);
    expect(container.querySelector('#child-text')?.textContent).toBe('initial');

    // Update only child signal
    childSig.value = 'updated';
    expect(container.querySelector('#child-text')?.textContent).toBe('updated');
    expect(childRenderCount).toBe(2);
    // Parent should NOT re-render
    expect(parentRenderCount).toBe(1);
  });
});
