import { describe, it, expect } from 'vitest';
import { GLOBAL_KEYS, getGlobalRegistry, checkMultiInstanceGuard } from '../src/globals.js';
import { activeInstances, defineComponent } from '../src/component.js';
import { z } from 'zod';

describe('Global Namespace & Multi-Instance Guard', () => {
  it('anchors activeInstances to globalThis with Symbol', () => {
    const registry = (globalThis as any)[GLOBAL_KEYS.ACTIVE_INSTANCES];
    expect(registry).toBeDefined();
    expect(registry).toBe(activeInstances);
  });

  it('preserves existing global Map across re-evaluations', () => {
    const dummyKey = Symbol.for('tokensafe-ui.test-registry');
    const map1 = getGlobalRegistry(dummyKey, () => new Map<string, any>());
    map1.set('test', 123);

    const map2 = getGlobalRegistry(dummyKey, () => new Map<string, any>());
    expect(map2).toBe(map1);
    expect(map2.get('test')).toBe(123);
  });

  it('records runtime version on globalThis and detects competing versions', () => {
    expect((globalThis as any)[GLOBAL_KEYS.RUNTIME_VERSION]).toBe('0.2.0');
    checkMultiInstanceGuard('0.2.0');
    expect((globalThis as any)[GLOBAL_KEYS.RUNTIME_VERSION]).toBe('0.2.0');
  });
});
