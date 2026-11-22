import { defineComponent, z, h } from '@agent-dom/core';

export const TaskBoard = defineComponent({
  id: 'task-board',
  state: {
    title: z.string().default('agent-dom Tasks'),
    count: z.number().default(0),
    status: z.string().default('Active'),
  },
  actions: {
    increment: (s) => ({ ...s, count: s.count + 1 }),
    decrement: (s) => ({ ...s, count: Math.max(0, s.count - 1) }),
    reset: (s) => ({ ...s, count: 0 }),
  },
  render: ({ state, emit }) =>
    h(
      'div',
      { class: 'task-board', 'data-agent-id': 'task-board:root' },
      h('h1', { 'data-agent-id': 'task-board:title' }, () => state.title),
      h(
        'div',
        { class: 'stats', 'data-agent-id': 'task-board:stats' },
        h('span', { 'data-agent-id': 'task-board:status-badge' }, () => state.status),
        h('span', { 'data-agent-id': 'task-board:count' }, () => state.count)
      ),
      h(
        'div',
        { class: 'actions', 'data-agent-id': 'task-board:actions' },
        h('button', { 'data-agent-id': 'task-board:btn-inc', 'data-agent-action': 'increment', onClick: emit.increment }, '+ Add Task'),
        h('button', { 'data-agent-id': 'task-board:btn-dec', 'data-agent-action': 'decrement', onClick: emit.decrement }, '- Remove Task'),
        h('button', { 'data-agent-id': 'task-board:btn-reset', 'data-agent-action': 'reset', onClick: emit.reset }, 'Reset')
      )
    ),
});
