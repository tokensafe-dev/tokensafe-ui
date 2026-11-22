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
    expect(causality?.componentId).toBe('user-profile');
    expect(causality?.value).toBe('/new-avatar.png');
    expect(causality?.lastMutation?.actionName).toBe('updateAvatar');
    expect(causality?.explanation).toContain("Last mutated by action 'updateAvatar'");
  });
});
