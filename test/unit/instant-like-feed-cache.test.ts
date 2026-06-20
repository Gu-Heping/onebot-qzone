import { applyCachedFeedPoolFallback } from '../../src/bridge/instant-like-feed-cache.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const NOW = 1_800_000_000;

const cases: TestCase[] = [
  {
    name: 'applyCachedFeedPoolFallback keeps live pool when live posts exist',
    fn: () => {
      const live = { posts: [{ tid: 'live' }], traces: [] };
      const cached = { cachedAt: NOW - 10, posts: [{ tid: 'cached' }] };
      const result = applyCachedFeedPoolFallback(live, cached, 300, NOW);
      assert(result.posts[0]?.['tid'] === 'live', 'live posts should win');
    },
  },
  {
    name: 'applyCachedFeedPoolFallback ignores stale cache',
    fn: () => {
      const live = { posts: [], traces: [{ mode: 'fast' as const, page: 1, ok: false, count: 0, kind: 'auth' }] };
      const cached = { cachedAt: NOW - 301, posts: [{ tid: 'cached' }] };
      const result = applyCachedFeedPoolFallback(live, cached, 300, NOW);
      assert(result.posts.length === 0, 'stale cache should not be used');
      assert(result.traces.length === 1, 'no cache trace added');
    },
  },
  {
    name: 'applyCachedFeedPoolFallback uses fresh cache and adds trace',
    fn: () => {
      const live = { posts: [], traces: [{ mode: 'slow' as const, page: 1, ok: false, count: 0, kind: 'parse_miss' }] };
      const cached = { cachedAt: NOW - 42, posts: [{ tid: 'cached-1' }, { tid: 'cached-2' }] };
      const result = applyCachedFeedPoolFallback(live, cached, 300, NOW);
      assert(result.posts.length === 2, 'fresh cache used');
      assert(result.traces.length === 2, 'cache trace appended');
      assert(result.traces[1]?.message === 'cache_fallback age=42s', 'cache trace message');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('instant-like-feed-cache', cases);
}
