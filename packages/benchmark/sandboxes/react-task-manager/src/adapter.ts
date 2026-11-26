import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { TaskManagerAdapter } from '../../../src/oracle/task-manager-oracle.js';
import type { TaskItem } from '../../../src/types.js';
import { MockTaskBackend, INITIAL_MOCK_TASKS } from '../../../src/oracle/mock-api.js';
import { ReactTaskManager } from './TaskManager.js';
import { TaskManagerStore } from './store.js';

/**
 * Real React adapter: the component is mounted with `createRoot` and its state is
 * read from the store it renders.
 *
 * The previous implementation projected markup with `innerHTML`, so the "React arm"
 * exercised no React at all. `flushSync` is used only to make the DOM observable
 * synchronously after a dispatch (the oracle checks a disabled button mid-save).
 */
export function createReactTaskManagerAdapter(backend: MockTaskBackend): TaskManagerAdapter {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const store = new TaskManagerStore(
    JSON.parse(JSON.stringify(INITIAL_MOCK_TASKS)) as TaskItem[],
    backend
  );

  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(ReactTaskManager, { store }));
  });

  const dispatch = async (actionName: string, payload?: any): Promise<void> => {
    const sync = (fn: () => void) => flushSync(fn);

    switch (actionName) {
      case 'addTask':
        sync(() => store.addTask(payload));
        return;
      case 'toggleTask':
        sync(() => store.toggleTask(payload.id));
        return;
      case 'setSearchQuery':
        sync(() => store.setSearchQuery(payload.query));
        return;
      case 'setFilterStatus':
        sync(() => store.setFilterStatus(payload.status));
        return;
      case 'setFilterPriority':
        sync(() => store.setFilterPriority(payload.priority));
        return;
      case 'saveTasks':
      case 'retrySave':
      case 'optimisticToggleTask': {
        // Start the action, commit the pending state, then settle it.
        let pending: Promise<void>;
        flushSync(() => {
          pending =
            actionName === 'saveTasks'
              ? store.saveTasks()
              : actionName === 'retrySave'
              ? store.retrySave()
              : store.optimisticToggleTask(payload.id);
        });
        try {
          await pending!;
        } finally {
          flushSync(() => undefined);
        }
        return;
      }
      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  };

  return {
    getState: () => store.getState(),
    getDomElement: () => container,
    dispatch,
  };
}
