import { describe, it, expect } from 'vitest';
import { defineComponent, z } from '@agent-dom/core';
import { buildDependencyGraph } from '../src/index.js';

describe('Component Dependency Graph & Impact Analysis', () => {
  const UserProfile = defineComponent({
    id: 'user-profile',
    state: {
      userId: z.string().default('user-1'),
      avatarUrl: z.string().default('/avatar.png'),
    },
    actions: {
      updateAvatar: (s, avatarUrl: string) => ({ ...s, avatarUrl }),
    },
    render: () => ({ type: 'div', props: { 'data-agent-id': 'user-profile:root' }, children: [] }),
  });

  const TaskList = defineComponent({
    id: 'task-list',
    state: {
      tasks: z.array(z.string()).default(['Task 1']),
    },
    actions: {
      addTask: (s, t: string) => ({ ...s, tasks: [...s.tasks, t] }),
    },
    render: () => ({ type: 'div', props: { 'data-agent-id': 'task-list:root' }, children: [] }),
  });

  it('builds dependency graph from active component instances', () => {
    UserProfile();
    TaskList();

    const graph = buildDependencyGraph();

    expect(graph.components['user-profile']).toBeDefined();
    expect(graph.components['user-profile'].stateKeys).toContain('avatarUrl');
    expect(graph.components['task-list']).toBeDefined();
    expect(graph.components['task-list'].stateKeys).toContain('tasks');

    const yaml = graph.toYaml();
    expect(yaml).toContain('component: user-profile');
    expect(yaml).toContain('component: task-list');
  });

  it('analyzes impact of mutating a state key', () => {
    UserProfile();
    TaskList();

    const graph = buildDependencyGraph();
    const impact = graph.analyzeImpact('avatarUrl');

    expect(impact.target).toBe('avatarUrl');
    expect(impact.directlyAffected).toContain('user-profile');
    expect(impact.safeComponents).toContain('task-list');
    expect(impact.recommendation).toContain("Editing 'avatarUrl' directly impacts: [user-profile]");
  });

  it('traces runtime causality and explains state mutations', () => {
    const userInstance = UserProfile();
    userInstance.emit.updateAvatar('/new-avatar.png');

    const graph = buildDependencyGraph();
    const causality = graph.traceCausality('user-profile.avatarUrl');

    expect(causality).not.toBeNull();
    expect(causality?.value).toBe('/new-avatar.png');
    expect(causality?.explanation).toContain("mutated by action 'updateAvatar'");
  });

  it('computes transitive multi-hop blast radius and propagation paths', () => {
    const ChildCard = defineComponent({
      id: 'child-card',
      state: { text: z.string().default('hello') },
      actions: {},
      render: () => ({ type: 'div', props: { 'data-agent-id': 'child-card:root' }, children: [] }),
    });

    const MiddleSection = defineComponent({
      id: 'middle-section',
      state: {},
      actions: {},
      render: () => ({
        type: 'div',
        props: { 'data-agent-id': 'middle-section:root' },
        children: [
          { type: 'div', props: { 'data-agent-id': 'child-card:embed' }, children: [] },
        ],
      }),
    });

    const RootApp = defineComponent({
      id: 'root-app',
      state: {},
      actions: {},
      render: () => ({
        type: 'div',
        props: { 'data-agent-id': 'root-app:root' },
        children: [
          { type: 'div', props: { 'data-agent-id': 'middle-section:embed' }, children: [] },
        ],
      }),
    });

    ChildCard();
    MiddleSection();
    RootApp();

    const graph = buildDependencyGraph();
    const impact = graph.analyzeImpact('child-card');

    expect(impact.directlyAffected).toContain('child-card');
    expect(impact.directlyAffected).toContain('middle-section');
    expect(impact.indirectlyAffected).toContain('root-app');
    expect(impact.blastRadiusDepth).toBeGreaterThanOrEqual(2);
    expect(impact.propagationPaths?.some((p) => p.includes('middle-section -> root-app'))).toBe(true);
  });
});
