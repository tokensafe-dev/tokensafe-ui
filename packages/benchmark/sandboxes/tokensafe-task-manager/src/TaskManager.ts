import { defineComponent, z, h, Show, For } from 'tokensafe-ui';
import type { TaskItem } from '../../../src/types.js';
import { INITIAL_MOCK_TASKS } from '../../../src/oracle/mock-api.js';

export const TaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['Active', 'Completed']),
  priority: z.enum(['High', 'Medium', 'Low']),
  tags: z.array(z.string()).default([]),
  updatedAt: z.number().optional(),
});

export const TaskManagerComponent = defineComponent({
  id: 'task-manager',
  state: {
    tasks: z.array(TaskItemSchema).default(INITIAL_MOCK_TASKS),
    filterStatus: z.string().default('All'),
    filterPriority: z.string().default('All'),
    searchQuery: z.string().default(''),
    isSaving: z.boolean().default(false),
    errorMessage: z.string().nullable().default(null),
    successMessage: z.string().nullable().default(null),
  },
  actions: {
    addTask: (s, payload: { title: string; priority?: 'High' | 'Medium' | 'Low'; tags?: string[] }) => {
      const newTask: TaskItem = {
        id: `task-${Date.now()}`,
        title: payload.title,
        status: 'Active',
        priority: payload.priority || 'Medium',
        tags: payload.tags || [],
        updatedAt: Date.now(),
      };
      return { ...s, tasks: [...s.tasks, newTask] };
    },
    toggleTask: (s, payload: { id: string }) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === payload.id
          ? { ...t, status: t.status === 'Active' ? 'Completed' : 'Active', updatedAt: Date.now() }
          : t
      ),
    }),
    setSearchQuery: (s, payload: { query: string }) => ({
      ...s,
      searchQuery: payload.query,
    }),
    setFilterStatus: (s, payload: { status: string }) => ({
      ...s,
      filterStatus: payload.status,
    }),
    setFilterPriority: (s, payload: { priority: string }) => ({
      ...s,
      filterPriority: payload.priority,
    }),
    startSaving: (s) => ({
      ...s,
      isSaving: true,
      errorMessage: null,
      successMessage: null,
    }),
    saveSuccess: (s) => ({
      ...s,
      isSaving: false,
      successMessage: 'Saved successfully',
      errorMessage: null,
    }),
    saveFailure: (s, payload: { error: string }) => ({
      ...s,
      isSaving: false,
      errorMessage: payload.error,
    }),
    rollbackToggle: (s, payload: { id: string; prevStatus: 'Active' | 'Completed'; error: string }) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === payload.id ? { ...t, status: payload.prevStatus } : t)),
      errorMessage: payload.error,
    }),
  },
  render: ({ state, emit }) => {
    return h(
      'div',
      { class: 'task-manager', 'data-agent-id': 'task-manager:root' },
      h(
        'header',
        null,
        h('h1', null, 'Task Manager (TokenSafe UI)'),
        h('span', { 'data-agent-id': 'task-manager:count' }, () => `Total: ${state.tasks.length}`)
      ),
      // Error Banner
      h(Show, {
        when: () => Boolean(state.errorMessage),
        children: () =>
          h(
            'div',
            { role: 'alert', class: 'error-banner', 'data-agent-id': 'task-manager:error-banner' },
            h('span', null, () => state.errorMessage || ''),
            h('button', { 'data-agent-id': 'task-manager:retry-btn', 'data-testid': 'retry-btn' }, 'Retry')
          ),
      }),
      // Success Banner
      h(Show, {
        when: () => Boolean(state.successMessage),
        children: () =>
          h(
            'div',
            { class: 'success-banner', 'data-agent-id': 'task-manager:success-banner' },
            () => state.successMessage || ''
          ),
      }),
      // Controls
      h(
        'section',
        { class: 'controls' },
        h('input', {
          type: 'text',
          placeholder: 'Search...',
          value: () => state.searchQuery,
          'data-agent-id': 'task-manager:search',
        }),
        h(
          'select',
          { 'data-agent-id': 'task-manager:status-filter' },
          h('option', { value: 'All' }, 'All'),
          h('option', { value: 'Active' }, 'Active'),
          h('option', { value: 'Completed' }, 'Completed')
        ),
        h(
          'select',
          { 'data-agent-id': 'task-manager:priority-filter' },
          h('option', { value: 'All' }, 'All'),
          h('option', { value: 'High' }, 'High'),
          h('option', { value: 'Medium' }, 'Medium'),
          h('option', { value: 'Low' }, 'Low')
        ),
        h(
          'button',
          {
            'data-agent-id': 'task-manager:save-btn',
            'data-testid': 'save-btn',
            disabled: () => state.isSaving,
          },
          () => (state.isSaving ? 'Saving...' : 'Save Tasks')
        )
      ),
      // Task list
      h(
        'ul',
        { class: 'task-list', 'data-agent-id': 'task-manager:list' },
        h(For, {
          each: () => {
            const query = (state.searchQuery || '').toLowerCase();
            return (state.tasks || []).filter((t: TaskItem) => {
              if (state.filterStatus === 'Active' && t.status !== 'Active') return false;
              if (state.filterStatus === 'Completed' && t.status !== 'Completed') return false;
              if (state.filterPriority !== 'All' && t.priority !== state.filterPriority) return false;
              if (query.trim()) {
                const inTitle = t.title.toLowerCase().includes(query);
                const inTags = t.tags && t.tags.some((tag) => tag.toLowerCase().includes(query));
                if (!inTitle && !inTags) return false;
              }
              return true;
            });
          },
          key: 'id',
          children: (t: TaskItem) =>
            h(
              'li',
              { class: `task-item ${t.status.toLowerCase()}`, 'data-agent-id': `task-item:${t.id}` },
              h('span', { class: 'title' }, t.title),
              h('span', { class: `badge ${t.priority.toLowerCase()}` }, t.priority),
              h(
                'div',
                { class: 'tags' },
                (t.tags || []).map((tg) => h('span', { class: 'tag' }, `#${tg}`))
              )
            ),
        })
      )
    );
  },
});
