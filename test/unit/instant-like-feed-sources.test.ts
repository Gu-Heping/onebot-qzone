import {
  collectFeedPool,
  chooseMergedCandidate,
  type InstantLikeFeedCollectorClient,
} from '../../src/bridge/instant-like-feed-sources.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const scoreOf = (item: Record<string, unknown>) => Number(item['_score'] ?? 0);

function post(fields: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    tid: 'tid-1',
    uin: '10001',
    appid: 311,
    typeid: 0,
    created_time: 1_800_000_000,
    ...fields,
  };
}

const cases: TestCase[] = [
  {
    name: 'collectFeedPool prefers Playwright snapshot when available',
    fn: async () => {
      const calls: string[] = [];
      const client: InstantLikeFeedCollectorClient = {
        async getPlaywrightFriendFeedSnapshot() {
          calls.push('playwright');
          return {
            posts: [post({ tid: 'pw-1', likeUnikey: 'u', likeCurkey: 'c', _score: 90 })],
            networkIntercepted: true,
            domFallbackUsed: false,
          };
        },
        async getFriendFeedsBestEffort() {
          calls.push('feeds3');
          return {
            ok: true,
            details: {},
            data: { posts: [post({ tid: 'api-1', _score: 40 })], hasMore: false },
          };
        },
      };
      const result = await collectFeedPool(client, {
        preferFast: true,
        feedFetchPasses: 1,
        feedFetchPages: 1,
        targetCount: 20,
        nowSec: 1_800_000_000,
        strategy: 'playwright_first',
      }, scoreOf);
      assert(result.posts.length === 1, 'expected playwright posts only');
      assert(result.posts[0]?.['tid'] === 'pw-1', 'playwright post should win');
      assert(result.traces[0]?.source === 'playwright_feed', 'trace should mark playwright source');
      assert(calls.join(',') === 'playwright', 'feeds3 should not run when playwright succeeded');
    },
  },
  {
    name: 'collectFeedPool falls back to feeds3 after empty Playwright snapshot',
    fn: async () => {
      const client: InstantLikeFeedCollectorClient = {
        async getPlaywrightFriendFeedSnapshot() {
          return {
            posts: [],
            networkIntercepted: false,
            domFallbackUsed: true,
          };
        },
        async getFriendFeedsBestEffort() {
          return {
            ok: true,
            details: {},
            data: { posts: [post({ tid: 'api-2', _score: 50 })], hasMore: false },
          };
        },
      };
      const result = await collectFeedPool(client, {
        preferFast: true,
        feedFetchPasses: 1,
        feedFetchPages: 1,
        targetCount: 20,
        nowSec: 1_800_000_000,
        strategy: 'playwright_first',
      }, scoreOf);
      assert(result.posts.length === 1, 'expected fallback post');
      assert(result.posts[0]?.['tid'] === 'api-2', 'feeds3 fallback should supply post');
      assert(result.traces.length === 2, 'expected playwright trace plus feeds3 trace');
      assert(result.traces[1]?.source === 'feeds3_api', 'second trace should be feeds3');
    },
  },
  {
    name: 'chooseMergedCandidate prefers richer browser fields on score tie',
    fn: () => {
      const browserPost = post({ tid: 'same', likeUnikey: 'browser-unikey', likeCurkey: 'browser-curkey', _score: 60 });
      const feeds3Post = post({ tid: 'same', _score: 60 });
      const winner = chooseMergedCandidate(feeds3Post, browserPost, scoreOf);
      assert(winner['likeUnikey'] === 'browser-unikey', 'browser unikey should be preferred');
      assert(winner['likeCurkey'] === 'browser-curkey', 'browser curkey should be preferred');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('instant-like-feed-sources', cases);
}
