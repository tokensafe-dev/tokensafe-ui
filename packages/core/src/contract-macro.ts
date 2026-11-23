import { z } from 'zod';
import { defineComponent } from './component.js';
import type { ComponentInstance } from './types.js';

export interface AsyncCrudEntity {
  id: string;
  status?: string;
  priority?: string;
  title?: string;
  [key: string]: any;
}

export interface AsyncCrudBackend<T extends AsyncCrudEntity> {
  fetchItems?: () => Promise<T[]>;
  saveItems?: (items: T[]) => Promise<any>;
  syncItem?: (item: T) => Promise<T>;
}

export interface AsyncCrudOptions<T extends AsyncCrudEntity> {
  id: string;
  entityName?: string;
  itemSchema: z.ZodType<T>;
  initialItems?: T[];
  backend?: AsyncCrudBackend<T>;
  customActions?: Record<string, (state: any, payload: any) => any>;
  render: (ctx: { state: any; emit: any; dispatch: any }) => any;
}

/**
 * High-velocity Async CRUD Component Macro.
 * Eliminates repetitive boilerplate by pre-generating standard reactive state
 * and action reducers for async persistence, loading spinners, network errors,
 * retry recovery, and optimistic rollbacks.
 */
export function defineAsyncCrudComponent<T extends AsyncCrudEntity>(
  options: AsyncCrudOptions<T>
) {
  const {
    id,
    itemSchema,
    initialItems = [],
    backend,
    customActions = {},
    render,
  } = options;

  return defineComponent({
    id,
    state: {
      items: z.array(itemSchema).default(initialItems),
      isSaving: z.boolean().default(false),
      errorMessage: z.string().nullable().default(null),
      successMessage: z.string().nullable().default(null),
      searchQuery: z.string().default(''),
      filterStatus: z.string().default('All'),
      filterPriority: z.string().default('All'),
    },
    actions: {
      addItem: (s: any, payload: Partial<T> & { title: string }) => {
        const newItem = {
          id: `${options.entityName || 'item'}-${Date.now()}`,
          status: 'Active',
          priority: 'Medium',
          ...payload,
        } as T;
        return { ...s, items: [...s.items, newItem] };
      },
      toggleItem: (s: any, payload: { id: string }) => ({
        ...s,
        items: s.items.map((it: T) =>
          it.id === payload.id
            ? { ...it, status: it.status === 'Active' ? 'Completed' : 'Active' }
            : it
        ),
      }),
      deleteItem: (s: any, payload: { id: string }) => ({
        ...s,
        items: s.items.filter((it: T) => it.id !== payload.id),
      }),
      setSearchQuery: (s: any, payload: { query: string }) => ({
        ...s,
        searchQuery: payload.query,
      }),
      setFilterStatus: (s: any, payload: { status: string }) => ({
        ...s,
        filterStatus: payload.status,
      }),
      setFilterPriority: (s: any, payload: { priority: string }) => ({
        ...s,
        filterPriority: payload.priority,
      }),
      startSaving: (s: any) => ({
        ...s,
        isSaving: true,
        errorMessage: null,
        successMessage: null,
      }),
      saveSuccess: (s: any) => ({
        ...s,
        isSaving: false,
        successMessage: 'Saved successfully',
        errorMessage: null,
      }),
      saveFailure: (s: any, payload: { error: string }) => ({
        ...s,
        isSaving: false,
        errorMessage: payload.error,
      }),
      rollbackToggle: (s: any, payload: { id: string; prevStatus: string; error: string }) => ({
        ...s,
        items: s.items.map((it: T) =>
          it.id === payload.id ? { ...it, status: payload.prevStatus } : it
        ),
        errorMessage: payload.error,
      }),
      ...customActions,
    },
    render,
  });
}
