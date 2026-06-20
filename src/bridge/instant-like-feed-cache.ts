export interface FeedFetchTraceLike {
  mode: 'playwright' | 'fast' | 'slow' | 'cache';
  page: number;
  ok: boolean;
  count: number;
  source?: 'playwright_feed' | 'feeds3_api' | 'feed_cache';
  nextCursor?: string;
  kind?: string;
  message?: string;
  networkIntercepted?: boolean;
  domFallbackUsed?: boolean;
}

export interface FeedPoolLike {
  posts: Record<string, unknown>[];
  traces: FeedFetchTraceLike[];
}

export interface CachedFeedPool {
  cachedAt: number;
  posts: Record<string, unknown>[];
}

export function applyCachedFeedPoolFallback(
  liveFeedPool: FeedPoolLike,
  cached: CachedFeedPool | null,
  maxAgeSec: number,
  nowSec: number,
): FeedPoolLike {
  if (liveFeedPool.posts.length > 0 || maxAgeSec <= 0 || !cached) return liveFeedPool;
  const ageSec = nowSec - cached.cachedAt;
  if (ageSec < 0 || ageSec > maxAgeSec || cached.posts.length === 0) return liveFeedPool;
  return {
    posts: cached.posts,
    traces: [
      ...liveFeedPool.traces,
      {
        mode: 'cache',
        page: 0,
        ok: true,
        count: cached.posts.length,
        source: 'feed_cache',
        message: `cache_fallback age=${ageSec}s`,
      },
    ],
  };
}
