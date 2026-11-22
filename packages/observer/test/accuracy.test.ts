import { describe, it, expect } from 'vitest';
import { defineComponent, z, h, mount } from '@agent-dom/core';
import { observe } from '../src/index.js';

describe('Observer L0–L4 Accuracy & Action Correlation', () => {
  const TodoApp = defineComponent({
    id: 'todo-app',
    state: {
      filter: z.enum(['all', 'active', 'completed']).default('all'),
      todosCount: z.number().default(3),
    },
    actions: {
      setFilter: (s, filter: 'all' | 'active' | 'completed') => ({ ...s, filter }),
      clearCompleted: (s) => ({ ...s, todosCount: Math.max(0, s.todosCount - 1) }),
    },
    render: ({ state, emit }) =>
      h(
        'div',
        { 'data-agent-id': 'todo-app:root' },
        h('h1', { 'data-agent-id': 'todo-app:heading' }, 'Todos'),
        // Notice: No manual data-agent-action! Action name should be auto-detected from emit
        h(
          'button',
          {
            'data-agent-id': 'todo-app:btn-filter-active',
            onClick: () => emit.setFilter('active'),
          },
          'Active'
        ),
        h(
          'button',
          {
            'data-agent-id': 'todo-app:btn-clear',
            onClick: emit.clearCompleted,
          },
          'Clear Completed'
        )
      ),
  });

  it('L0 accurately tracks active instances and removes unmounted components', () => {
    const instance = TodoApp();
    const container = document.createElement('div');
    mount(instance, container);

    const l0Before = observe(container.firstElementChild as HTMLElement, {
      level: 'L0',
      format: 'json',
    }) as any;

    expect(l0Before.mounted).toContain('todo-app');
    expect(l0Before.elements).toBeGreaterThan(0);

    // Unmount
    instance.unmount();

    const l0After = observe(container, {
      level: 'L0',
      format: 'json',
    }) as any;

    expect(l0After.mounted).not.toContain('todo-app');
  });

  it('L1 automatically correlates actions attached to event handlers', () => {
    const instance = TodoApp();
    const container = document.createElement('div');
    mount(instance, container);

    const l1 = observe(container.firstElementChild as HTMLElement, {
      level: 'L1',
      format: 'json',
    }) as any;

    expect(l1.view).toBe('todo-app');
    const clearBtn = l1.elements.find((e: any) => e.id === 'todo-app:btn-clear');
    expect(clearBtn).toBeDefined();
    expect(clearBtn.action).toBe('clearCompleted');

    instance.unmount();
  });
});
