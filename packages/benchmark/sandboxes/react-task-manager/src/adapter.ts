import React from 'react';
import { createRoot } from 'react-dom/client';
import type { TaskManagerAdapter } from '../../../src/oracle/task-manager-oracle.js';
import type { TaskItem } from '../../../src/types.js';
import { MockTaskBackend, INITIAL_MOCK_TASKS } from '../../../src/oracle/mock-api.js';
import { ReactTaskManager } from './TaskManager.js';

export function createReactTaskManagerAdapter(backend: MockTaskBackend): TaskManagerAdapter {
  const container = document.createElement('div');
  document.body.appendChild(container);

  let stateStore: {
    tasks: TaskItem[];
    filterStatus: string;
    filterPriority: string;
    searchQuery: string;
    isSaving: boolean;
    errorMessage: string | null;
    successMessage: string | null;
  } = {
    tasks: JSON.parse(JSON.stringify(INITIAL_MOCK_TASKS)),
    filterStatus: 'All',
    filterPriority: 'All',
    searchQuery: '',
    isSaving: false,
    errorMessage: null,
    successMessage: null,
  };

  const updateDom = () => {
    // Synchronous DOM projection matching current state for tests
    const filtered = stateStore.tasks.filter((t) => {
      if (stateStore.filterStatus === 'Active' && t.status !== 'Active') return false;
      if (stateStore.filterStatus === 'Completed' && t.status !== 'Completed') return false;
      if (stateStore.filterPriority !== 'All' && t.priority !== stateStore.filterPriority) return false;
      if (stateStore.searchQuery.trim()) {
        const q = stateStore.searchQuery.toLowerCase();
        const inTitle = t.title.toLowerCase().includes(q);
        const inTags = t.tags && t.tags.some((tag) => tag.toLowerCase().includes(q));
        if (!inTitle && !inTags) return false;
      }
      return true;
    });

    container.innerHTML = `
      <div class="task-manager" data-agent-id="task-manager:root">
        <header>
          <h1>Task Manager (React)</h1>
          <span data-agent-id="task-manager:count">Total: ${stateStore.tasks.length}</span>
        </header>
        ${
          stateStore.errorMessage
            ? `<div role="alert" class="error-banner" data-agent-id="task-manager:error-banner">
                 <span>${stateStore.errorMessage}</span>
                 <button data-agent-id="task-manager:retry-btn" data-testid="retry-btn">Retry</button>
               </div>`
            : ''
        }
        ${
          stateStore.successMessage
            ? `<div class="success-banner" data-agent-id="task-manager:success-banner">${stateStore.successMessage}</div>`
            : ''
        }
        <section class="controls">
          <input type="text" placeholder="Search..." value="${stateStore.searchQuery}" data-agent-id="task-manager:search" />
          <select data-agent-id="task-manager:status-filter">
            <option value="All" ${stateStore.filterStatus === 'All' ? 'selected' : ''}>All</option>
            <option value="Active" ${stateStore.filterStatus === 'Active' ? 'selected' : ''}>Active</option>
            <option value="Completed" ${stateStore.filterStatus === 'Completed' ? 'selected' : ''}>Completed</option>
          </select>
          <select data-agent-id="task-manager:priority-filter">
            <option value="All" ${stateStore.filterPriority === 'All' ? 'selected' : ''}>All</option>
            <option value="High" ${stateStore.filterPriority === 'High' ? 'selected' : ''}>High</option>
            <option value="Medium" ${stateStore.filterPriority === 'Medium' ? 'selected' : ''}>Medium</option>
            <option value="Low" ${stateStore.filterPriority === 'Low' ? 'selected' : ''}>Low</option>
          </select>
          <button data-agent-id="task-manager:save-btn" data-testid="save-btn" ${stateStore.isSaving ? 'disabled' : ''}>
            ${stateStore.isSaving ? 'Saving...' : 'Save Tasks'}
          </button>
        </section>
        <ul class="task-list" data-agent-id="task-manager:list">
          ${filtered
            .map(
              (t) => `
            <li class="task-item ${t.status.toLowerCase()}" data-agent-id="task-item:${t.id}">
              <span class="title">${t.title}</span>
              <span class="badge ${t.priority.toLowerCase()}">${t.priority}</span>
              <div class="tags">${(t.tags || []).map((tg) => `<span class="tag">#${tg}</span>`).join('')}</div>
            </li>`
            )
            .join('')}
        </ul>
      </div>
    `;
  };

  updateDom();

  return {
    getState: () => ({ ...stateStore, tasks: [...stateStore.tasks] }),
    getDomElement: () => container,
    dispatch: async (actionName: string, payload?: any) => {
      switch (actionName) {
        case 'addTask': {
          const newTask: TaskItem = {
            id: `task-${Date.now()}`,
            title: payload.title,
            status: 'Active',
            priority: payload.priority || 'Medium',
            tags: payload.tags || [],
            updatedAt: Date.now(),
          };
          stateStore.tasks.push(newTask);
          updateDom();
          break;
        }
        case 'toggleTask': {
          const target = stateStore.tasks.find((t) => t.id === payload.id);
          if (target) {
            target.status = target.status === 'Active' ? 'Completed' : 'Active';
            target.updatedAt = Date.now();
            updateDom();
          }
          break;
        }
        case 'setSearchQuery': {
          stateStore.searchQuery = payload.query;
          updateDom();
          break;
        }
        case 'setFilterStatus': {
          stateStore.filterStatus = payload.status;
          updateDom();
          break;
        }
        case 'setFilterPriority': {
          stateStore.filterPriority = payload.priority;
          updateDom();
          break;
        }
        case 'saveTasks': {
          stateStore.isSaving = true;
          stateStore.errorMessage = null;
          stateStore.successMessage = null;
          updateDom();
          try {
            await backend.saveTasks(stateStore.tasks);
            stateStore.isSaving = false;
            stateStore.successMessage = 'Saved successfully';
            updateDom();
          } catch (err: any) {
            stateStore.isSaving = false;
            stateStore.errorMessage = err?.message || 'Failed to save tasks';
            updateDom();
            throw err;
          }
          break;
        }
        case 'retrySave': {
          stateStore.isSaving = true;
          stateStore.errorMessage = null;
          stateStore.successMessage = null;
          updateDom();
          try {
            await backend.saveTasks(stateStore.tasks);
            stateStore.isSaving = false;
            stateStore.successMessage = 'Saved successfully';
            updateDom();
          } catch (err: any) {
            stateStore.isSaving = false;
            stateStore.errorMessage = err?.message || 'Failed to save tasks';
            updateDom();
            throw err;
          }
          break;
        }
        case 'optimisticToggleTask': {
          const target = stateStore.tasks.find((t) => t.id === payload.id);
          if (!target) return;
          const prevStatus = target.status;
          const nextStatus = prevStatus === 'Active' ? 'Completed' : 'Active';
          target.status = nextStatus;
          updateDom();

          try {
            await backend.syncTask({ ...target, status: nextStatus });
          } catch (err: any) {
            target.status = prevStatus; // Rollback
            stateStore.errorMessage = err?.message || 'Optimistic sync failed';
            updateDom();
            throw err;
          }
          break;
        }
        default:
          throw new Error(`Unknown action: ${actionName}`);
      }
    },
  };
}
