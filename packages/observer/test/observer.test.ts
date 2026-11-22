import { describe, it, expect } from 'vitest';
import { defineComponent, z, h, mount } from '@agent-dom/core';
import { getSemanticSnapshot } from '../src/index.js';

describe('@agent-dom/observer - Semantic Agent Vision', () => {
  const TodoApp = defineComponent({
    id: 'todo-app',
    state: {
      count: z.number().default(2),
      filter: z.string().default('all'),
    },
    actions: {
      add: (s) => ({ ...s, count: s.count + 1 }),
    },
    render: ({ state, emit }) =>
      h(
        'div',
        { 'data-agent-id': 'todo-app:root' },
        h('h1', { 'data-agent-id': 'todo-app:header' }, 'Todo Manager'),
        h(
          'form',
          { 'data-agent-id': 'todo-app:form' },
          h('input', {
            'data-agent-id': 'todo-app:input-task',
            type: 'text',
            value: 'Buy coffee',
          }),
          h(
            'button',
            {
              'data-agent-id': 'todo-app:btn-add',
              'data-agent-action': 'add',
              onClick: emit.add,
            },
            'Add Item'
          )
        ),
        h(
          'ul',
          { 'data-agent-id': 'todo-app:list' },
          h('li', { 'data-agent-id': 'todo-app:item-1' }, 'Item 1'),
          h('li', { 'data-agent-id': 'todo-app:item-2' }, 'Item 2')
        )
      ),
  });

  it('generates a compact YAML semantic snapshot under 100 tokens', () => {
    const instance = TodoApp();
    const container = document.createElement('div');
    mount(instance, container);

    const snapshot = getSemanticSnapshot(container.firstElementChild as HTMLElement, {
      format: 'yaml',
    }) as string;

    expect(snapshot).toContain('view: todo-app');
    expect(snapshot).toContain('state: {"count":2,"filter":"all"}');
    expect(snapshot).toContain('h1#todo-app:header [role: heading]: "Todo Manager"');
    expect(snapshot).toContain('button#todo-app:btn-add [action: add]: "Add Item"');

    // Token count estimate: ~50-80 words/tokens
    const tokenEstimate = snapshot.split(/\s+/).length;
    expect(tokenEstimate).toBeLessThan(100);
  });

  it('generates an ultra-lean S-Expression snapshot', () => {
    const instance = TodoApp();
    const container = document.createElement('div');
    mount(instance, container);

    const snapshot = getSemanticSnapshot(container.firstElementChild as HTMLElement, {
      format: 'sexp',
    }) as string;

    expect(snapshot).toContain('(view todo-app');
    expect(snapshot).toContain('(count 2)');
    expect(snapshot).toContain('(button#todo-app:btn-add :act add "Add Item")');
  });

  it('exports structured JSON projection', () => {
    const instance = TodoApp();
    const container = document.createElement('div');
    mount(instance, container);

    const snapshot = getSemanticSnapshot(container.firstElementChild as HTMLElement, {
      format: 'json',
    }) as any;

    expect(snapshot.view).toBe('todo-app');
    expect(snapshot.state.count).toBe(2);
    expect(snapshot.elements.length).toBeGreaterThan(0);
    const btn = snapshot.elements.find((e: any) => e.id === 'todo-app:btn-add');
    expect(btn?.action).toBe('add');
    expect(btn?.text).toBe('Add Item');
  });
});
