import type { TaskItem } from '../../../src/types.js';
import type { MockTaskBackend } from '../../../src/oracle/mock-api.js';

export interface TaskManagerState {
  tasks: TaskItem[];
  filterStatus: string;
  filterPriority: string;
  searchQuery: string;
  isSaving: boolean;
  errorMessage: string | null;
  successMessage: string | null;
}

/**
 * Synchronous store behind the React view.
 *
 * The oracle asserts on state immediately after a dispatch (including "isSaving is
 * true while the request is in flight"), which React's concurrent scheduler cannot
 * guarantee on its own. Keeping the source of truth here — and rendering it through
 * `useSyncExternalStore` — keeps the UI genuinely React while making state reads
 * deterministic.
 */
export class TaskManagerStore {
  private state: TaskManagerState;
  private listeners = new Set<() => void>();

  constructor(initialTasks: TaskItem[], private backend?: MockTaskBackend) {
    this.state = {
      tasks: JSON.parse(JSON.stringify(initialTasks)),
      filterStatus: 'All',
      filterPriority: 'All',
      searchQuery: '',
      isSaving: false,
      errorMessage: null,
      successMessage: null,
    };
  }

  getSnapshot = (): TaskManagerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<TaskManagerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  getState(): TaskManagerState {
    return this.state;
  }

  addTask(payload: { title: string; priority?: TaskItem['priority']; tags?: string[] }): void {
    if (!payload?.title?.trim()) return;
    const task: TaskItem = {
      id: `task-${Date.now()}`,
      title: payload.title.trim(),
      status: 'Active',
      priority: payload.priority ?? 'Medium',
      tags: payload.tags ?? [],
      updatedAt: Date.now(),
    };
    this.set({ tasks: [...this.state.tasks, task] });
  }

  toggleTask(id: string): void {
    this.set({
      tasks: this.state.tasks.map((t) =>
        t.id === id
          ? { ...t, status: t.status === 'Active' ? 'Completed' : 'Active', updatedAt: Date.now() }
          : t
      ),
    });
  }

  setSearchQuery(query: string): void {
    this.set({ searchQuery: query });
  }

  setFilterStatus(status: string): void {
    this.set({ filterStatus: status });
  }

  setFilterPriority(priority: string): void {
    this.set({ filterPriority: priority });
  }

  async saveTasks(): Promise<void> {
    if (!this.backend) return;
    this.set({ isSaving: true, errorMessage: null, successMessage: null });
    try {
      await this.backend.saveTasks(this.state.tasks);
      this.set({ isSaving: false, successMessage: 'Saved successfully' });
    } catch (err: any) {
      this.set({ isSaving: false, errorMessage: err?.message || 'Failed to save tasks' });
      throw err;
    }
  }

  async retrySave(): Promise<void> {
    return this.saveTasks();
  }

  async optimisticToggleTask(id: string): Promise<void> {
    const prior = this.state.tasks.find((t) => t.id === id);
    if (!prior) return;
    const nextStatus: TaskItem['status'] = prior.status === 'Active' ? 'Completed' : 'Active';

    this.set({
      tasks: this.state.tasks.map((t) => (t.id === id ? { ...t, status: nextStatus } : t)),
    });

    if (!this.backend) return;
    try {
      await this.backend.syncTask({ ...prior, status: nextStatus });
    } catch (err: any) {
      this.set({
        tasks: this.state.tasks.map((t) => (t.id === id ? { ...t, status: prior.status } : t)),
        errorMessage: err?.message || 'Optimistic sync failed',
      });
      throw err;
    }
  }
}

export function selectFilteredTasks(state: TaskManagerState): TaskItem[] {
  return state.tasks.filter((task) => {
    if (state.filterStatus === 'Active' && task.status !== 'Active') return false;
    if (state.filterStatus === 'Completed' && task.status !== 'Completed') return false;
    if (state.filterPriority !== 'All' && task.priority !== state.filterPriority) return false;
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase();
      const inTitle = task.title.toLowerCase().includes(q);
      const inTags = task.tags?.some((tag) => tag.toLowerCase().includes(q)) ?? false;
      if (!inTitle && !inTags) return false;
    }
    return true;
  });
}
