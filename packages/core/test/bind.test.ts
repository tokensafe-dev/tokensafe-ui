import { describe, it, expect } from 'vitest';
import { defineComponent, z, h, mount, bind, signal } from '../src/index.js';

describe('Two-Way Form Binding (bind)', () => {
  const FormView = defineComponent({
    id: 'form-view',
    state: {
      username: z.string().default('Alice'),
      newsletter: z.boolean().default(false),
    },
    actions: {
      setUsername: (s, username: string) => ({ ...s, username }),
      setNewsletter: (s, newsletter: boolean) => ({ ...s, newsletter }),
    },
    render: ({ state, emit }) =>
      h(
        'form',
        null,
        h('input', {
          'data-agent-id': 'form-view:input-username',
          type: 'text',
          ...bind(emit.setUsername, state.username),
        }),
        h('input', {
          'data-agent-id': 'form-view:checkbox-newsletter',
          type: 'checkbox',
          ...bind(emit.setNewsletter, state.newsletter),
        })
      ),
  });

  it('binds text input value and dispatches action on input event', () => {
    const instance = FormView();
    const container = document.createElement('div');
    mount(instance, container);

    const input = container.querySelector(
      '[data-agent-id="form-view:input-username"]'
    ) as HTMLInputElement;
    expect(input.value).toBe('Alice');

    // Simulate input change
    input.value = 'Bob';
    input.dispatchEvent(new Event('input'));

    expect(instance.state.username).toBe('Bob');
  });

  it('binds checkbox checked state and dispatches action on change event', () => {
    const instance = FormView();
    const container = document.createElement('div');
    mount(instance, container);

    const checkbox = container.querySelector(
      '[data-agent-id="form-view:checkbox-newsletter"]'
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // Simulate checkbox toggle
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(instance.state.newsletter).toBe(true);
  });

  it('binds directly to a raw reactive Signal', () => {
    const countSig = signal('Initial Text');
    const binding = bind(countSig);

    expect(binding.value).toBe('Initial Text');

    // Simulate input handler
    binding.onInput?.({ target: { value: 'Updated Text' } });
    expect(countSig.value).toBe('Updated Text');
  });
});
