import {
  chooseBetterCandidate,
  createFeedCandidateMergeState,
  mergeFeedCandidate,
} from './instant-like-candidates.js';

export type FeedTraceMode = 'playwright' | 'fast' | 'slow' | 'cache';
export type FeedTraceSource = 'playwright_feed' | 'feeds3_api' | 'feed_cache';

export interface FeedFetchTrace {
  mode: FeedTraceMode;
  page: number;
  ok: boolean;
  count: number;
  source?: FeedTraceSource;
  nextCursor?: string;
  kind?: string;
  message?: string;
  networkIntercepted?: boolean;
  domFallbackUsed?: boolean;
}

export interface FeedPool {
  posts: Record<string, unknown>[];
  traces: FeedFetchTrace[];
}

export interface PlaywrightFeedSnapshotLike {
  posts: Record<string, unknown>[];
  networkIntercepted: boolean;
  domFallbackUsed: boolean;
  interceptedResponseCount?: number;
}

export interface InstantLikeFeedCollectorClient {
  getPlaywrightFriendFeedSnapshot?(limit: number): Promise<PlaywrightFeedSnapshotLike>;
  getFriendFeedsBestEffort(
    cursor: string,
    num: number,
    options: { fastMode: boolean },
  ): Promise<{
    ok: boolean;
    kind?: string;
    details?: { message?: string };
    data?: { posts: Record<string, unknown>[]; hasMore: boolean; nextCursor?: string };
  }>;
}

export interface CollectFeedPoolOptions {
  preferFast: boolean;
  feedFetchPasses: number;
  feedFetchPages: number;
  targetCount: number;
  nowSec: number;
  strategy: 'playwright_first' | 'feeds3_first' | 'playwright_only' | 'feeds3_only';
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function keyFor(item: Record<string, unknown>): string {
  return `${normalizeText(item['uin'] ?? item['opuin'])}:${normalizeText(item['tid'] ?? item['cellid'])}`;
}

function aliasKeyFor(item: Record<string, unknown>): string {
  const uin = normalizeText(item['uin'] ?? item['opuin']);
  const created = Number(item['created_time'] ?? item['createTime'] ?? 0);
  const appid = normalizeText(item['appid']);
  const typeid = normalizeText(item['typeid']);
  const title = normalizeText(item['appShareTitle'] ?? item['content']).slice(0, 80);
  return `${uin}:${created}:${appid}:${typeid}:${title}`;
}

function candidateRichness(item: Record<string, unknown>): number {
  let richness = 0;
  if (normalizeText(item['likeUnikey'])) richness += 3;
  if (normalizeText(item['likeCurkey'])) richness += 3;
  if (normalizeText(item['detailUrl'] ?? item['detailurl'])) richness += 2;
  if (normalizeText(item['content'])) richness += 1;
  if (normalizeText(item['nickname'] ?? item['name'])) richness += 1;
  if (Boolean(item['_networkSource'])) richness += 2;
  return richness;
}

function mergePosts(
  state: ReturnType<typeof createFeedCandidateMergeState>,
  posts: Record<string, unknown>[],
  scoreOf: (item: Record<string, unknown>) => number,
): void {
  for (const item of posts) {
    mergeFeedCandidate(
      state,
      item,
      { primaryKey: keyFor(item), aliasKey: aliasKeyFor(item) },
      scoreOf,
      candidateRichness,
    );
  }
}

export function buildFeedModeSequence(preferFast: boolean, passes: number): boolean[] {
  const sequence: boolean[] = [];
  for (let index = 0; index < Math.max(1, passes); index += 1) {
    sequence.push(index % 2 === 0 ? preferFast : !preferFast);
  }
  return sequence;
}

export async function collectFeedPool(
  client: InstantLikeFeedCollectorClient,
  options: CollectFeedPoolOptions,
  scoreOf: (item: Record<string, unknown>) => number,
): Promise<FeedPool> {
  const mergeState = createFeedCandidateMergeState();
  const traces: FeedFetchTrace[] = [];
  const pageSize = Math.min(Math.max(options.targetCount, 20), 50);
  const usePlaywright = options.strategy !== 'feeds3_only';
  const useFeeds3 = options.strategy !== 'playwright_only';

  const runPlaywright = async (): Promise<boolean> => {
    if (!usePlaywright || !client.getPlaywrightFriendFeedSnapshot) return false;
    try {
      const snapshot = await client.getPlaywrightFriendFeedSnapshot(pageSize);
      traces.push({
        mode: 'playwright',
        page: 1,
        ok: snapshot.posts.length > 0,
        count: snapshot.posts.length,
        source: 'playwright_feed',
        networkIntercepted: snapshot.networkIntercepted,
        domFallbackUsed: snapshot.domFallbackUsed,
        message: snapshot.posts.length > 0
          ? `playwright network=${snapshot.networkIntercepted ? '1' : '0'} dom=${snapshot.domFallbackUsed ? '1' : '0'}`
          : 'playwright returned no posts',
      });
      mergePosts(mergeState, snapshot.posts, scoreOf);
      return snapshot.posts.length > 0;
    } catch (error) {
      traces.push({
        mode: 'playwright',
        page: 1,
        ok: false,
        count: 0,
        source: 'playwright_feed',
        kind: 'network',
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const runFeeds3 = async (): Promise<boolean> => {
    if (!useFeeds3) return false;
    let gotPosts = false;
    for (const preferFast of buildFeedModeSequence(options.preferFast, options.feedFetchPasses)) {
      let cursor = '';
      for (let page = 0; page < Math.max(1, options.feedFetchPages); page += 1) {
        const feed = await client.getFriendFeedsBestEffort(cursor, pageSize, { fastMode: preferFast });
        if (!feed.ok || !feed.data) {
          traces.push({
            mode: preferFast ? 'fast' : 'slow',
            page: page + 1,
            ok: false,
            count: 0,
            source: 'feeds3_api',
            kind: feed.kind,
            message: feed.details?.message,
          });
          break;
        }
        gotPosts = gotPosts || feed.data.posts.length > 0;
        traces.push({
          mode: preferFast ? 'fast' : 'slow',
          page: page + 1,
          ok: true,
          count: feed.data.posts.length,
          source: 'feeds3_api',
          nextCursor: feed.data.nextCursor,
        });
        mergePosts(mergeState, feed.data.posts, scoreOf);
        if (!feed.data.hasMore || !feed.data.nextCursor || mergeState.canonical.size >= options.targetCount) break;
        cursor = feed.data.nextCursor;
      }
      if (mergeState.canonical.size >= options.targetCount) break;
    }
    return gotPosts;
  };

  if (options.strategy === 'playwright_only') {
    await runPlaywright();
    return { posts: [...mergeState.canonical.values()], traces };
  }
  if (options.strategy === 'feeds3_only') {
    await runFeeds3();
    return { posts: [...mergeState.canonical.values()], traces };
  }
  if (options.strategy === 'playwright_first') {
    const playwrightOk = await runPlaywright();
    if (!playwrightOk) await runFeeds3();
    return { posts: [...mergeState.canonical.values()], traces };
  }
  const feeds3Ok = await runFeeds3();
  if (!feeds3Ok) await runPlaywright();

  return { posts: [...mergeState.canonical.values()], traces };
}

export function chooseMergedCandidate(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  scoreOf: (item: Record<string, unknown>) => number,
): Record<string, unknown> {
  return chooseBetterCandidate(left, right, scoreOf, candidateRichness);
}
