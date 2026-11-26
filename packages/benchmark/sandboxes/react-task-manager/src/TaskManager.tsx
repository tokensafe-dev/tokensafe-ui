import React, { useSyncExternalStore } from 'react';
import type { TaskItem } from '../../../src/types.js';
import { TaskManagerStore, selectFilteredTasks, type TaskManagerState } from './store.js';

export interface ReactTaskManagerProps {
  store: TaskManagerStore;
}

/**
 * Real React view over a synchronous store.
 *
 * Rendering goes through React (reconciliation, hooks, event handlers); the state
 * itself lives in `TaskManagerStore` so a test/agent adapter can read it
 * deterministically right after dispatching an action.
 */
export const ReactTaskManager: React.FC<ReactTaskManagerProps> = ({ store }) => {
  const state: TaskManagerState = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const visible: TaskItem[] = selectFilteredTasks(state);

  return (
    <div className="task-manager" data-agent-id="task-manager:root">
      <header>
        <h1>Task Manager (React)</h1>
        <span data-agent-id="task-manager:count">Total: {state.tasks.length}</span>
      </header>

      {state.errorMessage && (
        <div role="alert" className="error-banner" data-agent-id="task-manager:error-banner">
          <span>{state.errorMessage}</span>
          <button
            data-agent-id="task-manager:retry-btn"
            data-testid="retry-btn"
            onClick={() => {
              void store.retrySave().catch(() => undefined);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {state.successMessage && (
        <div className="success-banner" data-agent-id="task-manager:success-banner">
          {state.successMessage}
        </div>
      )}

      <section className="controls">
        <input
          type="text"
          placeholder="Search tasks or tags..."
          value={state.searchQuery}
          onChange={(e) => store.setSearchQuery(e.target.value)}
          data-agent-id="task-manager:search"
          data-testid="search-input"
        />

        <select
          value={state.filterStatus}
          onChange={(e) => store.setFilterStatus(e.target.value)}
          data-agent-id="task-manager:status-filter"
          data-testid="status-filter"
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
        </select>

        <select
          value={state.filterPriority}
          onChange={(e) => store.setFilterPriority(e.target.value)}
          data-agent-id="task-manager:priority-filter"
        >
          <option value="All">All Priorities</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <button
          disabled={state.isSaving}
          onClick={() => {
            void store.saveTasks().catch(() => undefined);
          }}
          data-agent-id="task-manager:save-btn"
          data-testid="save-btn"
        >
          {state.isSaving ? 'Saving...' : 'Save Tasks'}
        </button>
      </section>

      <ul className="task-list" data-agent-id="task-manager:list">
        {visible.map((task) => (
          <li
            key={task.id}
            className={`task-item ${task.status.toLowerCase()}`}
            data-agent-id={`task-item:${task.id}`}
          >
            <input
              type="checkbox"
              checked={task.status === 'Completed'}
              onChange={() => store.toggleTask(task.id)}
            />
            <span className="title">{task.title}</span>
            <span className={`badge ${task.priority.toLowerCase()}`}>{task.priority}</span>
            <div className="tags">
              {task.tags?.map((tag) => (
                <span key={tag} className="tag">
                  #{tag}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
