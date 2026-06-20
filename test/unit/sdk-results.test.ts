import { QzoneClient } from '../../src/qzone/client.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'getPostsStrict returns strict sdk result',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      anyClient.qqNumber = '3905536442';
      anyClient.getEmotionList = async () => ({
        code: 0,
        msglist: [{ tid: 't1', uin: '3905536442', content: 'hello' }],
        next_cursor: 'cursor-2',
      });

      const result = await client.getPostsStrict();
      assert(result.ok, `expected success, got ${JSON.stringify(result)}`);
      if (!result.ok) return;
      assert(result.reliability === 'strict', `expected strict reliability, got ${result.reliability}`);
      assert(result.data.posts.length === 1, `expected one post, got ${result.data.posts.length}`);
      assert(result.data.nextCursor === 'cursor-2', `expected cursor-2, got ${String(result.data.nextCursor)}`);
    },
  },
  {
    name: 'getPostsStrict maps feeds3 auth failure to strict auth result',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      anyClient.qqNumber = '3905536442';
      anyClient.getEmotionList = async () => ({
        code: -3000,
        subcode: -4001,
        message: 'need login',
        _source: 'feeds3',
        msglist: [],
      });

      const result = await client.getPostsStrict();
      assert(!result.ok, `expected auth failure, got ${JSON.stringify(result)}`);
      if (result.ok) return;
      assert(result.kind === 'auth', `expected auth failure kind, got ${result.kind}`);
      assert(result.reliability === 'strict', `expected strict reliability, got ${result.reliability}`);
    },
  },
  {
    name: 'comments sdk result marks not_embedded when counts exist but html does not embed detail',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      client.cachePostMeta('tid-1', {
        uin: '10001',
        appid: '311',
        typeid: '0',
        likeUnikey: '',
        likeCurkey: '',
        abstime: 1712345678,
        cmtnum: 3,
      });
      anyClient.getCommentsBestEffortLegacy = async () => ({
        code: 0,
        commentlist: [],
        _source: 'feeds3',
      });

      const result = await client.getCommentsBestEffort({ uin: '10001', tid: 'tid-1', num: 10, pos: 0 });
      assert(result.ok, `expected success, got ${JSON.stringify(result)}`);
      if (!result.ok) return;
      assert(result.data.availability === 'not_embedded', `expected not_embedded, got ${result.data.availability}`);
      assert(result.warnings.length > 0, 'expected warning for missing embedded comments');
    },
  },
  {
    name: 'comments sdk result maps feeds3 auth failure',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      anyClient.getCommentsBestEffortLegacy = async () => ({
        code: -3000,
        subcode: -4001,
        message: 'need login',
        _source: 'feeds3',
        commentlist: [],
      });

      const result = await client.getCommentsBestEffort({ uin: '10001', tid: 'tid-auth', num: 10, pos: 0 });
      assert(!result.ok, `expected auth failure, got ${JSON.stringify(result)}`);
      if (result.ok) return;
      assert(result.kind === 'auth', `expected auth failure kind, got ${result.kind}`);
    },
  },
  {
    name: 'likes sdk result marks partial when like count exceeds parsed detail',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      client.cachePostMeta('tid-2', {
        uin: '10002',
        appid: '311',
        typeid: '0',
        likeUnikey: '',
        likeCurkey: '',
        abstime: 1712345679,
        likenum: 4,
      });
      anyClient.getLikeListBestEffort = async () => ([
        { uin: '1', name: 'alice', _source: 'feeds3_html' },
        { uin: '2', name: 'bob', _source: 'feeds3_html' },
      ]);

      const result = await client.getLikesBestEffort('10002', 'tid-2');
      assert(result.ok, `expected success, got ${JSON.stringify(result)}`);
      if (!result.ok) return;
      assert(result.data.availability === 'available_partial', `expected available_partial, got ${result.data.availability}`);
      assert(result.data.likes.length === 2, `expected 2 likes, got ${result.data.likes.length}`);
    },
  },
  {
    name: 'likes sdk result maps feeds3 auth failure',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      anyClient.getLikeListBestEffort = async () => {
        anyClient.lastFeeds3FailureByTid.set('tid-like-auth', {
          code: -3000,
          subcode: -4001,
          message: 'need login',
        });
        return [];
      };

      const result = await client.getLikesBestEffort('10002', 'tid-like-auth');
      assert(!result.ok, `expected auth failure, got ${JSON.stringify(result)}`);
      if (result.ok) return;
      assert(result.kind === 'auth', `expected auth failure kind, got ${result.kind}`);
    },
  },
];

export async function run() {
  return runSuite('sdk/results', cases);
}
