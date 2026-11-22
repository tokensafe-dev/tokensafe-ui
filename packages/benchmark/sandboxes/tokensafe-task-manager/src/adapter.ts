import { mount, unmount } from 'tokensafe-ui';
import type { TaskManagerAdapter } from '../../../src/oracle/task-manager-oracle.js';
import type { TaskItem } from '../../../src/types.js';
import { MockTaskBackend, INITIAL_MOCK_TASKS } from '../../../src/oracle/mock-api.js';
import { TaskManagerComponent } from './TaskManager.js';

export function createTokenSafeTaskManagerAdapter(backend: MockTaskBackend): TaskManagerAdapter {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const instance = TaskManagerComponent();
  mount(instance, container);

  return {
    getState: () => ({
      tasks: instance.state.tasks as TaskItem[],
      filterStatus: instance.state.filterStatus,
      filterPriority: instance.state.filterPriority,
      searchQuery: instance.state.searchQuery,
      isSaving: instance.state.isSaving,
      errorMessage: instance.state.errorMessage,
      successMessage: instance.state.successMessage,
    }),
    getDomElement: () => container,
    dispatch: async (actionName: string, payload?: any) => {
      switch (actionName) {
        case 'addTask':
          instance.emit.addTask(payload);
          break;
        case 'toggleTask':
          instance.emit.toggleTask(payload);
          break;
        case 'setSearchQuery':
          instance.emit.setSearchQuery(payload);
          break;
        case 'setFilterStatus':
          instance.emit.setFilterStatus(payload);
          break;
        case 'setFilterPriority':
          instance.emit.setFilterPriority(payload);
          break;
        case 'saveTasks': {
          instance.emit.startSaving();
          try {
            await backend.saveTasks(instance.state.tasks);
            instance.emit.saveSuccess();
          } catch (err: any) {
            instance.emit.saveFailure({ error: err?.message || 'Failed to save tasks' });
            throw err;
          }
          break;
        }
        case 'retrySave': {
          instance.emit.startSaving();
          try {
            await backend.saveTasks(instance.state.tasks);
            instance.emit.saveSuccess();
          } catch (err: any) {
            instance.emit.saveFailure({ error: err?.message || 'Failed to save tasks' });
            throw err;
          }
          break;
        }
        case 'optimisticToggleTask': {
          const target = (instance.state.tasks as TaskItem[]).find((t) => t.id === payload.id);
          if (!target) return;
          const prevStatus = target.status;
          instance.emit.toggleTask({ id: payload.id });

          try {
            const nextStatus = prevStatus === 'Active' ? 'Completed' : 'Active';
            await backend.syncTask({ ...target, status: nextStatus });
          } catch (err: any) {
            instance.emit.rollbackToggle({
              id: payload.id,
              prevStatus,
              error: err?.message || 'Optimistic sync failed',
            });
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
