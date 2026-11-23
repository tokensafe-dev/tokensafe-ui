import { describe, it, expect } from 'vitest';
import { VERSION, mount, renderToString, Fragment } from '../src/index.js';

describe('agent-dom core smoke test', () => {
  it('exports valid version string', () => {
    expect(VERSION).toBe('0.2.0');
  });

  it('renders React-style elements where children exist only in props.children', () => {
    const reactLikeElement = {
      $$typeof: Symbol.for('react.element'),
      type: 'div',
      props: {
        className: 'container',
        children: [
          {
            $$typeof: Symbol.for('react.element'),
            type: 'span',
            props: {
              className: 'child',
              children: 'Hello from React JSX!',
            },
          },
        ],
      },
    };

    // 1. renderToString
    const html = renderToString(reactLikeElement as any);
    expect(html).toContain('class="container"');
    expect(html).toContain('class="child"');
    expect(html).toContain('Hello from React JSX!');

    // 2. mount
    const container = document.createElement('div');
    mount(reactLikeElement as any, container);
    expect(container.querySelector('.container')).not.toBeNull();
    expect(container.querySelector('.child')?.textContent).toBe('Hello from React JSX!');
  });

  it('renders forwardRef components that call useId without throwing', () => {
    // Mock global React with internals
    let hookId = '';
    const mockReact: any = {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {},
    };
    (globalThis as any).React = mockReact;

    const ForwardRefComponent = {
      $$typeof: Symbol.for('react.forward_ref'),
      render: (props: any) => {
        const id = mockReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H.useId();
        hookId = id;
        return {
          $$typeof: Symbol.for('react.element'),
          type: 'svg',
          props: {
            id,
            className: props.className,
          },
        };
      },
    };

    const vnode = {
      type: ForwardRefComponent,
      props: { className: 'icon-test' },
      children: [],
    };

    const container = document.createElement('div');
    mount(vnode as any, container);
    expect(hookId).toMatch(/:r\d+:/);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('icon-test');
  });
});
