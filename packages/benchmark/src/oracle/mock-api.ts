import type { TaskItem, MockApiOptions } from '../types.js';

export const INITIAL_MOCK_TASKS: TaskItem[] = [
  {
    id: 'task-1',
    title: 'Review AUB benchmark protocol',
    status: 'Active',
    priority: 'High',
    tags: ['benchmark', 'research'],
    updatedAt: 1700000000000,
  },
  {
    id: 'task-2',
    title: 'Prepare team sync meeting',
    status: 'Completed',
    priority: 'Medium',
    tags: ['meeting', 'general'],
    updatedAt: 1700000001000,
  },
  {
    id: 'task-3',
    title: 'Fix critical race condition bug',
    status: 'Active',
    priority: 'High',
    tags: ['bug', 'urgent'],
    updatedAt: 1700000002000,
  },
  {
    id: 'task-4',
    title: 'Write documentation for reactive signals',
    status: 'Active',
    priority: 'Low',
    tags: ['docs'],
    updatedAt: 1700000003000,
  },
];

export class MockTaskBackend {
  private tasks: TaskItem[];
  private latencyMs: number;
  private shouldFailNextSave: boolean;
  private failureMessage: string;
  private callCount: { fetch: number; save: number; sync: number };

  constructor(options: MockApiOptions = {}) {
    this.tasks = JSON.parse(JSON.stringify(INITIAL_MOCK_TASKS));
    this.latencyMs = options.networkLatencyMs ?? 50;
    this.shouldFailNextSave = options.shouldFail ?? false;
    this.failureMessage = options.failureMessage ?? 'Network Error: HTTP 500 Internal Server Error';
    this.callCount = { fetch: 0, save: 0, sync: 0 };
  }

  public setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  public setFailNextSave(shouldFail: boolean, message?: string): void {
    this.shouldFailNextSave = shouldFail;
    if (message) this.failureMessage = message;
  }

  public getCallCounts() {
    return { ...this.callCount };
  }

  public reset(initialTasks: TaskItem[] = INITIAL_MOCK_TASKS): void {
    this.tasks = JSON.parse(JSON.stringify(initialTasks));
    this.shouldFailNextSave = false;
    this.callCount = { fetch: 0, save: 0, sync: 0 };
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async fetchTasks(): Promise<TaskItem[]> {
    this.callCount.fetch++;
    await this.sleep(this.latencyMs);
    return JSON.parse(JSON.stringify(this.tasks));
  }

  public async saveTasks(tasks: TaskItem[]): Promise<{ success: boolean; count: number }> {
    this.callCount.save++;
    await this.sleep(this.latencyMs);

    if (this.shouldFailNextSave) {
      this.shouldFailNextSave = false; // Reset single-shot failure
      throw new Error(this.failureMessage);
    }

    this.tasks = JSON.parse(JSON.stringify(tasks));
    return { success: true, count: this.tasks.length };
  }

  public async syncTask(task: TaskItem): Promise<TaskItem> {
    this.callCount.sync++;
    await this.sleep(this.latencyMs);

    if (this.shouldFailNextSave) {
      this.shouldFailNextSave = false;
      throw new Error(this.failureMessage);
    }

    const idx = this.tasks.findIndex((t) => t.id === task.id);
    const updated = { ...task, updatedAt: Date.now() };
    if (idx >= 0) {
      this.tasks[idx] = updated;
    } else {
      this.tasks.push(updated);
    }
    return updated;
  }
}

export const defaultMockBackend = new MockTaskBackend();
