import { signal, Signal, effect } from './signals.js';

export interface QueryOptions<T> {
  queryKey: string | any[];
  queryFn: () => Promise<T>;
  refetchInterval?: number | false | ((data: T | null) => number | false);
  enabled?: boolean | (() => boolean);
  initialData?: T;
  staleTime?: number;
}

export interface QueryResult<T> {
  data: Signal<T | null>;
  isLoading: Signal<boolean>;
  isFetching: Signal<boolean>;
  error: Signal<Error | null>;
  refetch: () => Promise<T | null>;
}

interface CacheEntry<T = any> {
  key: string;
  data: Signal<T | null>;
  isLoading: Signal<boolean>;
  isFetching: Signal<boolean>;
  error: Signal<Error | null>;
  lastFetched: number;
  options: QueryOptions<T>;
  subscribers: number;
}

const queryCache = new Map<string, CacheEntry>();

function normalizeKey(key: string | any[]): string {
  if (typeof key === 'string') return key;
  return JSON.stringify(key);
}

export function createQuery<T>(options: QueryOptions<T>): QueryResult<T> {
  const normKey = normalizeKey(options.queryKey);
  let entry = queryCache.get(normKey);

  if (!entry) {
    entry = {
      key: normKey,
      data: signal<T | null>(options.initialData ?? null, { name: `query:${normKey}.data` }),
      isLoading: signal<boolean>(options.initialData === undefined, { name: `query:${normKey}.isLoading` }),
      isFetching: signal<boolean>(false, { name: `query:${normKey}.isFetching` }),
      error: signal<Error | null>(null, { name: `query:${normKey}.error` }),
      lastFetched: 0,
      options,
      subscribers: 0,
    };
    queryCache.set(normKey, entry);
  } else {
    entry.options = options;
  }

  entry.subscribers++;

  const executeFetch = async (): Promise<T | null> => {
    if (!entry) return null;
    const isEnabled = typeof options.enabled === 'function' ? options.enabled() : options.enabled !== false;
    if (!isEnabled) {
      entry.isLoading.value = false;
      return null;
    }

    entry.isFetching.value = true;
    try {
      const result = await options.queryFn();
      entry.data.value = result;
      entry.error.value = null;
      entry.lastFetched = Date.now();
      return result;
    } catch (err: any) {
      entry.error.value = err instanceof Error ? err : new Error(String(err));
      return null;
    } finally {
      entry.isLoading.value = false;
      entry.isFetching.value = false;
    }
  };

  // Immediate or stale fetch
  const staleLimit = options.staleTime ?? 0;
  const isStale = Date.now() - entry.lastFetched >= staleLimit;
  if (isStale || entry.data.value === null) {
    executeFetch();
  }

  // Auto-polling interval
  let intervalTimer: any = null;
  const setupInterval = () => {
    if (intervalTimer) clearInterval(intervalTimer);
    const intervalMs = typeof options.refetchInterval === 'function'
      ? options.refetchInterval(entry.data.value)
      : options.refetchInterval;

    if (typeof intervalMs === 'number' && intervalMs > 0 && typeof window !== 'undefined') {
      intervalTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        executeFetch();
      }, intervalMs);
    }
  };
  setupInterval();

  return {
    data: entry.data,
    isLoading: entry.isLoading,
    isFetching: entry.isFetching,
    error: entry.error,
    refetch: executeFetch,
  };
}

export function invalidateQueries(keyPrefix: string | any[]): void {
  const prefix = normalizeKey(keyPrefix);
  for (const [key, entry] of queryCache.entries()) {
    if (key === prefix || key.startsWith(prefix) || key.includes(prefix)) {
      entry.lastFetched = 0;
      const isEnabled = typeof entry.options.enabled === 'function'
        ? entry.options.enabled()
        : entry.options.enabled !== false;
      if (isEnabled) {
        entry.isFetching.value = true;
        entry.options.queryFn()
          .then((res) => {
            entry.data.value = res;
            entry.error.value = null;
          })
          .catch((err) => {
            entry.error.value = err instanceof Error ? err : new Error(String(err));
          })
          .finally(() => {
            entry.isFetching.value = false;
            entry.isLoading.value = false;
          });
      }
    }
  }
}
