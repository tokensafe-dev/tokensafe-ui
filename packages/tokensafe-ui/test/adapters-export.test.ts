import { describe, it, expect } from 'vitest';
import { createReactAdapter } from '../src/react.js';
import { createVueAdapter } from '../src/vue.js';
import {
  createAgentDomAdapter,
  createReactAdapter as reactFromOumv,
  createVueAdapter as vueFromOumv,
} from '../src/oumv.js';

describe('tokensafe-ui - First-Class Adapters Export (Unified Distribution)', () => {
  it('exports createReactAdapter from tokensafe-ui/react and tokensafe-ui/oumv', async () => {
    expect(typeof createReactAdapter).toBe('function');
    expect(typeof reactFromOumv).toBe('function');

    const adapter = createReactAdapter();
    const handshake = await adapter.handshake();

    expect(handshake.runtimeInfo.name).toBe('react');
    expect(handshake.capabilities.observe.levels).toContain('L1');
    expect(handshake.capabilities.mutate.occ).toBe(true);
  });

  it('exports createVueAdapter from tokensafe-ui/vue and tokensafe-ui/oumv', async () => {
    expect(typeof createVueAdapter).toBe('function');
    expect(typeof vueFromOumv).toBe('function');

    const adapter = createVueAdapter();
    const handshake = await adapter.handshake();

    expect(handshake.runtimeInfo.name).toBe('vue');
    expect(handshake.capabilities.observe.levels).toContain('L1');
    expect(handshake.capabilities.mutate.occ).toBe(true);
  });

  it('preserves native createAgentDomAdapter in tokensafe-ui/oumv', async () => {
    expect(typeof createAgentDomAdapter).toBe('function');
    const adapter = createAgentDomAdapter();
    const handshake = await adapter.handshake();
    expect(handshake.runtimeInfo.name).toBe('agent-dom');
  });
});
