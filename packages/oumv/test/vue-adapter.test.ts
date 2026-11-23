import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createVueAdapter } from '../src/vue.js';

describe('@tokensafe-ui/oumv - Vue Runtime Adapter', () => {
  let tmpDir: string;
  let testFile: string;

  const sampleVueSource = `<template>
  <div class="user-card" data-agent-id="user:root">
    <span data-agent-id="user:name">{{ name }}</span>
    <button data-agent-id="user:btn-rename" @click="rename('Alice')">Rename</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const name = ref('Bob');
function rename(newName: string) {
  name.value = newName;
}
</script>
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oumv-vue-'));
    testFile = path.join(tmpDir, 'UserCard.vue');
    fs.writeFileSync(testFile, sampleVueSource, 'utf-8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('performs protocol handshake with Vue runtime metadata', async () => {
    const adapter = createVueAdapter({ projectRoot: tmpDir });
    const handshake = await adapter.handshake();

    expect(handshake.protocolVersion).toBe('1.0.0');
    expect(handshake.runtimeInfo.name).toBe('vue');
    expect(handshake.runtimeInfo.version).toBe('3.x');
    expect(handshake.capabilities.observe.levels).toContain('L1');
    expect(handshake.capabilities.understand.componentGraph).toBe(true);
    expect(handshake.capabilities.mutate.occ).toBe(true);
    expect(handshake.capabilities.verify.multiMetric).toBe(true);
  });

  it('observes L0 pulse and L1 interactive surface from Vue DOM elements', async () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div data-agent-id="vue-profile:root">
        <input type="text" data-agent-id="profile:input" v-model="username" value="vuer" />
        <button data-agent-id="profile:save" @click="save">Save Profile</button>
      </div>
    `;

    const adapter = createVueAdapter({
      projectRoot: tmpDir,
      rootElement: container,
      components: {
        'vue-profile': {
          id: 'vue-profile',
          name: 'UserProfile',
          filePath: 'UserCard.vue',
          getState: () => ({ username: 'vuer' }),
          actions: { save: () => {} },
        },
      },
    });

    const l0 = await adapter.observe({ level: 'L0' });
    expect(l0.level).toBe('L0');
    expect(l0.payload).toContain('framework: vue');
    expect(l0.payload).toContain('mounted: [vue-profile]');

    const l1 = await adapter.observe({ level: 'L1' });
    expect(l1.level).toBe('L1');
    expect(l1.payload).toContain('profile:input');
    expect(l1.payload).toContain('value: "vuer"');
    expect(l1.payload).toContain('profile:save [role: button');
  });

  it('observes L2 component contract and L3 SFC source with OCC versioning', async () => {
    let internalState = { name: 'Bob', score: 100 };

    const adapter = createVueAdapter({
      projectRoot: tmpDir,
      components: {
        user: {
          id: 'user',
          name: 'UserCard',
          filePath: 'UserCard.vue',
          getState: () => internalState,
          actions: {
            rename: (payload: { name: string }) => {
              internalState.name = payload.name;
            },
          },
        },
      },
    });

    const l2 = await adapter.observe({ level: 'L2', componentId: 'user' });
    expect(l2.level).toBe('L2');
    expect(l2.payload).toContain('name":"Bob"');
    expect(l2.payload).toContain('rename');

    const l3 = await adapter.observe({ level: 'L3', componentId: 'user' });
    expect(l3.level).toBe('L3');
    expect(l3.payload).toContain('<template>');
    expect(l3.payload).toContain('<script setup');
  });

  it('performs impact analysis and understands Vue component graph', async () => {
    const adapter = createVueAdapter({
      projectRoot: tmpDir,
      components: {
        avatar: {
          id: 'avatar',
          name: 'Avatar',
          dependents: ['header'],
        },
        header: {
          id: 'header',
          name: 'Header',
          dependencies: ['avatar'],
          dependents: ['app'],
        },
        app: {
          id: 'app',
          name: 'App',
          dependencies: ['header'],
        },
      },
    });

    const impact = await adapter.understand({ query: 'impact', target: 'avatar' });
    expect(impact.target).toBe('avatar');
    expect(impact.directlyAffected).toContain('header');
    expect(impact.indirectlyAffected).toContain('app');

    const graph = await adapter.understand({ query: 'dependencies' });
    expect(graph.yaml).toContain('vue_dependency_graph:');
    expect(graph.yaml).toContain('component: avatar');
  });

  it('enforces OCC tokens and validates Vue SFC syntax during applyEdit', async () => {
    const adapter = createVueAdapter({ projectRoot: tmpDir });

    const src = await adapter.getSource({
      componentId: 'user',
      filePath: 'UserCard.vue',
    });

    expect(src.version).toMatch(/^sha256:[a-f0-9]{64}$/);

    // 1. Invalid SFC missing template/script
    await expect(
      adapter.applyEdit({
        filePath: 'UserCard.vue',
        source: 'just raw text without SFC blocks',
        expectedVersion: src.version,
      })
    ).rejects.toThrow(/OUMV SYNTAX_ERROR/);

    // 2. Invalid TypeScript in script block
    const badScriptSfc = `<template><div>hello</div></template>\n<script setup lang="ts">\nconst = broken;\n</script>`;
    await expect(
      adapter.applyEdit({
        filePath: 'UserCard.vue',
        source: badScriptSfc,
        expectedVersion: src.version,
      })
    ).rejects.toThrow(/OUMV SYNTAX_ERROR/);

    // 3. Valid SFC update
    const validSfc = `<template>\n  <div>Updated Vue Component</div>\n</template>\n<script setup lang="ts">\nconst ok = true;\n</script>`;
    const res = await adapter.applyEdit({
      filePath: 'UserCard.vue',
      source: validSfc,
      expectedVersion: src.version,
    });

    expect(res.success).toBe(true);
    expect(res.version).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(validSfc);
  });

  it('verifies local Vue component actions with state diffs and latency telemetry', async () => {
    let state = { count: 10 };

    const adapter = createVueAdapter({
      projectRoot: tmpDir,
      components: {
        counter: {
          id: 'counter',
          name: 'Counter',
          getState: () => state,
          actions: {
            double: () => {
              state.count *= 2;
            },
          },
        },
      },
    });

    const verifyRes = await adapter.verify({
      componentId: 'counter',
      action: 'double',
    });

    expect(verifyRes.componentId).toBe('counter');
    expect(verifyRes.action).toBe('double');
    expect(verifyRes.stateBefore.count).toBe(10);
    expect(verifyRes.stateAfter.count).toBe(20);
    expect(verifyRes.stateDiff.count).toEqual({ before: 10, after: 20 });
    expect(verifyRes.latency.totalMs).toBeGreaterThanOrEqual(0);

    const l4 = await adapter.observe({ level: 'L4', componentId: 'counter' });
    expect(l4.payload).toContain('double');
  });
});
