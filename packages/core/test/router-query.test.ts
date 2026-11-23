import { describe, it, expect, vi } from 'vitest';
import { createQuery, invalidateQueries, matchPath } from '../src/index.js';

describe('Router & Query Primitives', () => {
  it('matchPath accurately parses static and dynamic routes', () => {
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/blog/:slug', '/blog/shared-team-cache-l3')).toEqual({
      slug: 'shared-team-cache-l3',
    });
    expect(matchPath('/orgs/:orgId/seats/:seatId', '/orgs/org_123/seats/seat_456')).toEqual({
      orgId: 'org_123',
      seatId: 'seat_456',
    });
    expect(matchPath('/docs', '/pricing')).toBeNull();
  });

  it('createQuery manages reactive data fetching and invalidation', async () => {
    let callCount = 0;
    const mockFetcher = vi.fn(async () => {
      callCount++;
      return { count: callCount, message: 'ok' };
    });

    const query = createQuery({
      queryKey: ['test-query'],
      queryFn: mockFetcher,
    });

    expect(query.isLoading.value).toBe(true);

    // Await initial fetch
    await new Promise((r) => setTimeout(r, 10));

    expect(query.isLoading.value).toBe(false);
    expect(query.data.value).toEqual({ count: 1, message: 'ok' });
    expect(query.error.value).toBeNull();

    // Trigger invalidation
    invalidateQueries(['test-query']);
    await new Promise((r) => setTimeout(r, 10));

    expect(query.data.value).toEqual({ count: 2, message: 'ok' });
    expect(mockFetcher).toHaveBeenCalledTimes(2);
  });
});
