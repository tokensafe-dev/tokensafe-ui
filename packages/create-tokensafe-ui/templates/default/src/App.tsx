import { defineComponent, z, bind, h } from 'tokensafe-ui';

export const App = defineComponent({
  id: 'app-root',
  state: {
    count: z.number().default(0),
    name: z.string().default('Agent'),
  },
  actions: {
    inc: (s) => ({ ...s, count: s.count + 1 }),
    dec: (s) => ({ ...s, count: Math.max(0, s.count - 1) }),
    setName: (s, name: string) => ({ ...s, name }),
  },
  render: ({ state, emit }) =>
    h(
      'div',
      { class: 'container', 'data-agent-id': 'app-root:container' },
      h('h1', { 'data-agent-id': 'app-root:title' }, 'TokenSafe UI'),
      h('p', { 'data-agent-id': 'app-root:greeting' }, `Hello, ${state.name}!`),
      h('input', {
        type: 'text',
        placeholder: 'Enter your name',
        'data-agent-id': 'app-root:input-name',
        ...bind(emit.setName, state.name),
      }),
      h(
        'div',
        { class: 'counter-group', 'data-agent-id': 'app-root:counter-group' },
        h(
          'button',
          { 'data-agent-id': 'app-root:btn-dec', onClick: () => emit.dec() },
          '-'
        ),
        h(
          'span',
          { class: 'count-value', 'data-agent-id': 'app-root:count-value' },
          String(state.count)
        ),
        h(
          'button',
          { 'data-agent-id': 'app-root:btn-inc', onClick: () => emit.inc() },
          '+'
        )
      )
    ),
});
