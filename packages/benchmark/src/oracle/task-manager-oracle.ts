import type {
  OracleAssertionResult,
  OracleEvaluationReport,
  TaskItem,
} from '../types.js';
import { MockTaskBackend, INITIAL_MOCK_TASKS } from './mock-api.js';

export interface TaskManagerAdapter {
  getState(): {
    tasks: TaskItem[];
    filterStatus: string;
    filterPriority: string;
    searchQuery: string;
    isSaving: boolean;
    errorMessage: string | null;
    successMessage: string | null;
  };
  getDomElement(): HTMLElement;
  dispatch(actionName: string, payload?: any): Promise<void> | void;
}

export class TaskManagerOracle {
  public static readonly ASSERTION_IDS = [
    'TC01_INITIAL_MOUNT',
    'TC02_ADD_TASK',
    'TC03_TOGGLE_COMPLETION',
    'TC04_SEARCH_QUERY',
    'TC05_STATUS_FILTER',
    'TC06_PRIORITY_FILTER',
    'TC07_COMBINED_FILTER_SEARCH',
    'TC08_ASYNC_SAVE_PENDING',
    'TC09_ASYNC_SAVE_SUCCESS',
    'TC10_ASYNC_SAVE_FAILURE',
    'TC11_ASYNC_RETRY_ACTION',
    'TC12_OPTIMISTIC_ROLLBACK',
  ] as const;

  public async evaluate(
    adapterFactory: (backend: MockTaskBackend) => Promise<TaskManagerAdapter> | TaskManagerAdapter
  ): Promise<OracleEvaluationReport> {
    const startAll = performance.now();
    const assertions: OracleAssertionResult[] = [];

    // Helper to evaluate a test assertion safely
    const runAssertion = async (
      id: string,
      title: string,
      fn: () => Promise<void>
    ) => {
      const start = performance.now();
      try {
        await fn();
        assertions.push({
          id,
          title,
          passed: true,
          durationMs: Math.round(performance.now() - start),
        });
      } catch (err: any) {
        assertions.push({
          id,
          title,
          passed: false,
          durationMs: Math.round(performance.now() - start),
          error: err?.message || String(err),
        });
      }
    };

    // TC01: Initial mount
    await runAssertion('TC01_INITIAL_MOUNT', 'Initial state renders with defaults and pre-seeded tasks', async () => {
      const backend = new MockTaskBackend();
      const adapter = await adapterFactory(backend);
      const state = adapter.getState();
      const dom = adapter.getDomElement();

      if (!state.tasks || state.tasks.length === 0) {
        throw new Error('Initial task list is empty');
      }
      if (state.filterStatus !== 'All' && state.filterStatus !== 'all') {
        throw new Error(`Expected default filterStatus 'All', received '${state.filterStatus}'`);
      }
      if (state.searchQuery !== '') {
        throw new Error(`Expected empty initial searchQuery, received '${state.searchQuery}'`);
      }
      if (!dom || !dom.innerHTML) {
        throw new Error('DOM container has not rendered');
      }
    });

    // TC02: Add task
    await runAssertion('TC02_ADD_TASK', 'Add new task with title, default Active status and Medium priority', async () => {
      const backend = new MockTaskBackend();
      const adapter = await adapterFactory(backend);
      const prevCount = adapter.getState().tasks.length;

      await adapter.dispatch('addTask', { title: 'Implement benchmark CLI' });
      const state = adapter.getState();

      if (state.tasks.length !== prevCount + 1) {
        throw new Error(`Expected tasks length ${prevCount + 1}, got ${state.tasks.length}`);
      }
      const added = state.tasks.find((t) => t.title === 'Implement benchmark CLI');
      if (!added) {
        throw new Error("Newly added task 'Implement benchmark CLI' not found in state");
      }
      if (added.status !== 'Active') {
        throw new Error(`Expected status 'Active', got '${added.status}'`);
      }
      if (added.priority !== 'Medium') {
        throw new Error(`Expected default priority 'Medium', got '${added.priority}'`);
      }
    });

    // TC03: Toggle completion
    await runAssertion('TC03_TOGGLE_COMPLETION', 'Toggle task status between Active and Completed', async () => {
      const backend = new MockTaskBackend();
      const adapter = await adapterFactory(backend);
      const targetId = 'task-1'; // Initially Active

      await adapter.dispatch('toggleTask', { id: targetId });
      let item = adapter.getState().tasks.find((t) => t.id === targetId);
      if (!item || item.status !== 'Completed') {
        throw new Error(`Expected task-1 status 'Completed', got '${item?.status}'`);
      }

      await adapter.dispatch('toggleTask', { id: targetId });
      item = adapter.getState().tasks.find((t) => t.id === targetId);
      if (!item || item.status !== 'Active') {
        throw new Error(`Expected task-1 toggled back to 'Active', got '${item?.status}'`);
      }
    });

    // TC04: Search query
    await runAssertion('TC04_SEARCH_QUERY', 'Search query filters visible items matching title or tags', async () => {
      const backend = new MockTaskBackend();
      const adapter = await adapterFactory(backend);

      await adapter.dispatch('setSearchQuery', { query: 'meeting' });
      const state = adapter.getState();
      const dom = adapter.getDomElement();

      if (state.searchQuery !== 'meeting') {
        throw new Error(`Expected searchQuery 'meeting', got '${state.searchQuery}'`);
      }

      // Check rendered text or visible items
      const html = dom.innerHTML.toLowerCase();
      if (!html.includes('meeting')) {
        throw new Error('Search result does not display task containing query "meeting"');
      }
      // 'critical race condition bug' should be filtered out
      if (html.includes('race condition')) {
        throw new Error('Non-matching item "race condition" still visible when searching "meeting"');
      }
    });

    // TC05: Status filter
    await runAssertion('TC05_STATUS_FILTER', 'Filter by Active and Completed status', async () => {
      const backend = new MockTaskBackend();
      const adapter = await adapterFactory(backend);

      await adapter.dispatch('setFilterStatus', { status: 'Completed' });
      let dom = adapter.getDomElement();
      let html = dom.innerHTML.toLowerCase();

      if (!html.includes('meeting')) {
        throw new Error('Completed filter failed to show completed task "meeting"');
      }
      if (html.includes('review aub')) {
        throw new Error('Completed filter shows active task "review aub"');
      }

      await adapter.dispatch('setFilterStatus', { status: 'Active' });
      dom = adapter.getDomElement();
      html = dom.innerHTML.toLowerCase();
      if (!html.includes('review aub')) {
        throw new Error('Active filter failed to show active task "review aub"');
      }
    });

    // TC06: Priority filter
    await runAssertion('TC06_PRIORITY_FILTER', 'Filter by High priority isolates only high-priority tasks', async () => {
      const backend = new MockTaskBackend();
      const adapter = await adapterFactory(backend);

      await adapter.dispatch('setFilterPriority', { priority: 'High' });
      const html = adapter.getDomElement().innerHTML.toLowerCase();

      if (!html.includes('review aub') || !html.includes('race condition')) {
        throw new Error('High priority filter missing High priority tasks');
      }
      if (html.includes('reactive signals') || html.includes('meeting')) {
        throw new Error('High priority filter shows Medium or Low priority tasks');
      }
    });

    // TC07: Combined filter and search
    await runAssertion('TC07_COMBINED_FILTER_SEARCH', 'Multi-condition filter conjunction (query + status + priority)', async () => {
      const backend = new MockTaskBackend();
      const adapter = await adapterFactory(backend);

      await adapter.dispatch('setSearchQuery', { query: 'bug' });
      await adapter.dispatch('setFilterStatus', { status: 'Active' });
      await adapter.dispatch('setFilterPriority', { priority: 'High' });

      const html = adapter.getDomElement().innerHTML.toLowerCase();
      if (!html.includes('fix critical race condition bug')) {
        throw new Error('Combined filter failed to match target high-priority active bug');
      }
      if (html.includes('review aub')) {
        throw new Error('Combined filter incorrectly matched non-query task "review aub"');
      }
    });

    // TC08: Async save pending state
    await runAssertion('TC08_ASYNC_SAVE_PENDING', 'Save action engages pending loading state (isSaving: true)', async () => {
      const backend = new MockTaskBackend({ networkLatencyMs: 100 });
      const adapter = await adapterFactory(backend);

      const promise = adapter.dispatch('saveTasks');
      // Inspect state immediately while save is pending
      const pendingState = adapter.getState();
      if (!pendingState.isSaving) {
        throw new Error('Expected isSaving to be true during active network save');
      }

      const dom = adapter.getDomElement();
      const btn = dom.querySelector('button[data-agent-id="task-manager:save-btn"], button[data-testid="save-btn"]') as HTMLButtonElement;
      if (btn && !btn.disabled && !dom.innerHTML.includes('disabled') && !dom.innerHTML.includes('saving')) {
        throw new Error('Save button is not disabled or loading during save operation');
      }

      await promise;
    });

    // TC09: Async save success
    await runAssertion('TC09_ASYNC_SAVE_SUCCESS', 'Successful save clears isSaving and displays success message', async () => {
      const backend = new MockTaskBackend({ networkLatencyMs: 20 });
      const adapter = await adapterFactory(backend);

      await adapter.dispatch('saveTasks');
      const state = adapter.getState();

      if (state.isSaving) {
        throw new Error('Expected isSaving to become false after completion');
      }
      if (state.errorMessage !== null) {
        throw new Error(`Unexpected error message after successful save: ${state.errorMessage}`);
      }
      if (!state.successMessage && !adapter.getDomElement().innerHTML.toLowerCase().includes('saved')) {
        throw new Error('Expected success confirmation after successful save');
      }
    });

    // TC10: Async save failure
    await runAssertion('TC10_ASYNC_SAVE_FAILURE', 'Simulated 500 error displays error banner and preserves tasks', async () => {
      const backend = new MockTaskBackend({ networkLatencyMs: 20, shouldFail: true, failureMessage: 'HTTP 500 Failed' });
      const adapter = await adapterFactory(backend);
      const originalCount = adapter.getState().tasks.length;

      try {
        await adapter.dispatch('saveTasks');
      } catch {}

      const state = adapter.getState();
      if (state.isSaving) {
        throw new Error('Expected isSaving to be false after error rejection');
      }
      if (!state.errorMessage && !adapter.getDomElement().innerHTML.includes('Failed')) {
        throw new Error('Error banner was not set upon save rejection');
      }
      if (state.tasks.length !== originalCount) {
        throw new Error('Task items were unexpectedly cleared on save error');
      }
    });

    // TC11: Async retry action
    await runAssertion('TC11_ASYNC_RETRY_ACTION', 'Retry action re-triggers save and resolves error state', async () => {
      const backend = new MockTaskBackend({ networkLatencyMs: 20, shouldFail: true });
      const adapter = await adapterFactory(backend);

      // Trigger initial failure
      try {
        await adapter.dispatch('saveTasks');
      } catch {}

      let state = adapter.getState();
      if (!state.errorMessage && !adapter.getDomElement().innerHTML.includes('Failed')) {
        throw new Error('Setup failure: initial save did not register error');
      }

      // Now backend will succeed on retry
      await adapter.dispatch('retrySave');
      state = adapter.getState();

      if (state.errorMessage !== null) {
        throw new Error(`Expected errorMessage to be cleared on retry, got: ${state.errorMessage}`);
      }
      if (state.isSaving) {
        throw new Error('Expected isSaving to be false after retry completion');
      }
    });

    // TC12: Optimistic rollback
    await runAssertion('TC12_OPTIMISTIC_ROLLBACK', 'Optimistic task toggle rolls back to prior state on sync rejection', async () => {
      const backend = new MockTaskBackend({ networkLatencyMs: 20, shouldFail: true });
      const adapter = await adapterFactory(backend);
      const targetId = 'task-1'; // Initially Active

      // Trigger optimistic toggle with rejection
      try {
        await adapter.dispatch('optimisticToggleTask', { id: targetId });
      } catch {}

      const state = adapter.getState();
      const item = state.tasks.find((t) => t.id === targetId);
      if (!item) throw new Error('Target task missing');

      if (item.status !== 'Active') {
        throw new Error(`Optimistic rollback failed: expected status 'Active', got '${item.status}'`);
      }
      if (!state.errorMessage && !adapter.getDomElement().innerHTML.includes('Failed')) {
        throw new Error('Expected error notification following failed optimistic sync');
      }
    });

    const passedCount = assertions.filter((a) => a.passed).length;
    return {
      passedCount,
      totalCount: assertions.length,
      assertions,
      allPassed: passedCount === assertions.length,
      durationMs: Math.round(performance.now() - startAll),
    };
  }
}
