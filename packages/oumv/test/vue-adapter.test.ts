import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createVueAdapter, VueProtocolError } from '../src/vue.js';

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

const sha = (text: string) => 'sha256:' + crypto.createHash('sha256').update(text, 'utf-8').digest('hex');

describe('@tokensafe-ui/oumv - Vue Runtime Adapter (wire 1.5.0)', () => {
  let tmpDir: string;
  let testFile: string;

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

  it('performs the 1.5.0 handshake with profile and session, and rejects a foreign major', async () => {
    const adapter = createVueAdapter({ projectRoot: tmpDir });
    const handshake = await adapter.handshake();

    expect(handshake.protocolVersion).toBe('1.5.0');
    expect(handshake.profile).toBe('frontend');
    expect(handshake.sessionId).toMatch(/^sess-/);
    expect(handshake.runtimeInfo.name).toBe('vue');
    expect(handshake.runtimeInfo.version).toBe('3.x');
    expect(handshake.capabilities.observe.levels).toContain('L3');
    expect(handshake.capabilities.mutate.occ).toBe(true);
    expect(handshake.capabilities.understand.componentGraph).toBe(true);

    await expect(adapter.handshake({ protocolVersion: '9.9.9' })).rejects.toMatchObject({ code: -32006 });
  });

  it('observes L0 and L1 in the canonical envelope (data, not payload)', async () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div data-agent-id="vue-profile:root">
        <input type="text" data-agent-id="profile:input" value="vuer" />
        <button data-agent-id="profile:save">Save Profile</button>
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
    expect(l0.format).toBe('json');
    expect(l0).not.toHaveProperty('payload');
    expect(l0.data.framework).toBe('vue');
    expect(l0.data.mounted).toContain('vue-profile');

    const l1 = await adapter.observe({ level: 'L1' });
    expect(l1.level).toBe('L1');
    const ids = (l1.data.elements as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain('profile:input');
    expect(ids).toContain('profile:save');
    expect(l1.data.total).toBe(l1.data.elements.length);
  });

  it('observes L2 and L3 with OCC versioning and evidence', async () => {
    const adapter = createVueAdapter({
      projectRoot: tmpDir,
      components: {
        user: {
          id: 'user',
          name: 'UserCard',
          filePath: 'UserCard.vue',
          getState: () => ({ name: 'Bob', score: 100 }),
          actions: { rename: () => {} },
        },
      },
    });

    const l2 = await adapter.observe({ level: 'L2', componentId: 'user' });
    expect(l2.level).toBe('L2');
    expect(l2.data.target).toBe('UserCard');
    expect(l2.data.state).toEqual({ name: 'Bob', score: 100 });
    expect(l2.data.actions).toContain('rename');
    expect(l2.evidence?.provenance).toBe('runtime');

    const l3 = await adapter.observe({ level: 'L3', componentId: 'user' });
    expect(l3.level).toBe('L3');
    expect(l3.data.source).toContain('<template>');
    expect(l3.data.version).toBe(sha(sampleVueSource));
    expect(l3.data.startLine).toBe(1);
    expect(l3.data.endLine).toBe(sampleVueSource.split('\n').length);
  });

  it('supports getSource windows, ifVersion dedup and symbol slices', async () => {
    const adapter = createVueAdapter({ projectRoot: tmpDir });
    const full = await adapter.getSource({ path: 'UserCard.vue' });
    expect(full.version).toBe(sha(sampleVueSource));

    const unchanged = await adapter.getSource({ path: 'UserCard.vue', ifVersion: full.version });
    expect(unchanged).toMatchObject({ unchanged: true, version: full.version });
    expect(unchanged).not.toHaveProperty('source');

    const windowed = await adapter.getSource({ path: 'UserCard.vue', startLine: 8, endLine: 9 });
    expect(windowed.startLine).toBe(8);
    expect(windowed.endLine).toBe(9);
    expect(windowed.source.split('\n').length).toBe(2);

    const symbol = await adapter.getSource({ path: 'UserCard.vue', symbol: 'rename' });
    expect(symbol.source).toContain('function rename');
    expect(symbol.startLine).toBeGreaterThan(1);

    await expect(adapter.getSource({ path: 'UserCard.vue', symbol: 'NoSuchSymbol' })).rejects.toMatchObject({ code: -32009 });
  });

  it('enforces OCC, SFC syntax and machine-actionable duplicate-hunk errors', async () => {
    const adapter = createVueAdapter({ projectRoot: tmpDir });
    const src = await adapter.getSource({ path: 'UserCard.vue' });

    // Syntax pre-flight: a file with no SFC blocks and a broken script both fail -32002.
    await expect(
      adapter.applyEdit({ path: 'UserCard.vue', replacement: 'just raw text', expectedVersion: src.version })
    ).rejects.toMatchObject({ code: -32002 });
    await expect(
      adapter.applyEdit({
        path: 'UserCard.vue',
        replacement: '<template><div>x</div></template>\n<script setup>\nconst = broken;\n</script>',
        expectedVersion: src.version,
      })
    ).rejects.toMatchObject({ code: -32002 });

    // OCC conflict.
    await expect(
      adapter.applyEdit({ path: 'UserCard.vue', replacement: sampleVueSource, expectedVersion: 'sha256:' + '0'.repeat(64) })
    ).rejects.toMatchObject({ code: -32001 });

    // A unique patch target splices in place.
    const patched = await adapter.applyEdit({
      path: 'UserCard.vue',
      mode: 'patch',
      expectedVersion: src.version,
      hunks: [{ target: "const name = ref('Bob');", replacement: "const name = ref('Alice');" }],
    });
    expect(patched.status).toBe('APPLIED');
    expect(patched.hunksApplied).toBe(1);
    expect(fs.readFileSync(testFile, 'utf-8')).toContain("const name = ref('Alice');");

    // A duplicate target is rejected with occurrences and a ready-to-use scoped retry.
    const duplicate = `<template>\n  <div><button @click="go">a</button><button @click="go">b</button></div>\n</template>\n<script setup>\nfunction go() {}\n</script>\n`;
    fs.writeFileSync(testFile, duplicate, 'utf-8');
    const duplicateVersion = sha(duplicate);
    let captured: VueProtocolError | null = null;
    try {
      await adapter.applyEdit({
        path: 'UserCard.vue',
        mode: 'patch',
        expectedVersion: duplicateVersion,
        hunks: [{ target: '@click="go"', replacement: '@click="goTwice"' }],
      });
    } catch (err) {
      captured = err as VueProtocolError;
    }
    expect(captured?.code).toBe(-32011);
    expect(captured?.data?.reason).toBe('target_not_unique');
    expect(captured?.data?.count).toBe(2);
    expect((captured?.data?.lines as number[]).length).toBe(2);
    expect((captured?.data?.suggestedHunks as unknown[]).length).toBe(2);
    // Nothing was written on a rejected hunk set.
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(duplicate);
  });

  it('creates, deletes and renames files with the canonical result fields', async () => {
    const adapter = createVueAdapter({ projectRoot: tmpDir });
    const createdContent = '<template>\n  <div>New</div>\n</template>\n';
    const created = await adapter.applyEdit({ path: 'components/NewWidget.vue', mode: 'create', replacement: createdContent });
    expect(created).toMatchObject({ status: 'APPLIED', created: true, newVersion: sha(createdContent) });

    await expect(
      adapter.applyEdit({ path: 'components/NewWidget.vue', mode: 'create', replacement: createdContent })
    ).rejects.toMatchObject({ code: -32001 });

    const rename = await adapter.applyEdit({
      path: 'components/NewWidget.vue',
      mode: 'rename',
      renameTo: 'components/RenamedWidget.vue',
      expectedVersion: sha(createdContent),
    });
    expect(rename.newPath).toBe('components/RenamedWidget.vue');

    const deleted = await adapter.applyEdit({
      path: 'components/RenamedWidget.vue',
      mode: 'delete',
      expectedVersion: sha(createdContent),
    });
    expect(deleted.deleted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'components/RenamedWidget.vue'))).toBe(false);
  });

  it('verifies registered actions with state diffs and records L4 traces', async () => {
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

    const verified = await adapter.verify({ componentId: 'counter', action: 'double' });
    expect(verified.status).toBe('passed');
    expect(verified.target).toBe('counter');
    expect(verified.diff.count).toEqual({ before: 10, after: 20 });
    expect(verified.timings.t_total_ms).toBeGreaterThanOrEqual(0);
    expect(verified.scope.checked).toContain('counter:double');

    const l4 = await adapter.observe({ level: 'L4', componentId: 'counter' });
    expect((l4.data as { traces: unknown[] }).traces.length).toBe(1);
  });

  it('answers impact and causality in the canonical understand envelope', async () => {
    const adapter = createVueAdapter({
      projectRoot: tmpDir,
      components: {
        avatar: { id: 'avatar', name: 'Avatar', dependents: ['header'] },
        header: { id: 'header', name: 'Header', dependencies: ['avatar'], dependents: ['app'] },
        app: { id: 'app', name: 'App', dependencies: ['header'] },
      },
    });

    const impact = await adapter.understand({ query: 'impact', target: 'avatar' });
    expect(impact.query).toBe('impact');
    expect(impact.target).toBe('avatar');
    expect(impact.impact!.directlyAffected).toContain('header');
    expect(impact.impact!.indirectlyAffected).toContain('app');

    const causality = await adapter.understand({ query: 'causality', target: 'avatar' });
    expect(causality.query).toBe('causality');
    expect(causality.causality!.observed).toBe(false);
    expect(causality.causality!.note).toBeTruthy();

    const graph = await adapter.understand({ query: 'dependencies' });
    expect(graph.dependencyGraph!.map((n: { component: string }) => n.component)).toContain('avatar');
  });
});
