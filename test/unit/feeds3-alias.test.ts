import { QzoneClient } from '../../src/qzone/client.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'getCommentsBestEffort aliases d_uin_abstime bucket to canonical tid',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const clientAny = client as unknown as Record<string, any>;
      const canonicalTid = 'ecadhfbihb';
      const sourceTid = 'd1179350197_1712345678_feed';
      client.cachePostMeta(canonicalTid, {
        uin: '1179350197',
        appid: '311',
        typeid: '0',
        likeUnikey: '',
        likeCurkey: '',
        abstime: 1712345678,
      });
      client.feeds3Comments.set(sourceTid, [{
        commentid: 'c1',
        uin: '1',
        name: 'tester',
        content: 'hello',
        createtime: 1712345680,
      }]);
      clientAny.feeds3CommentsFetchedAt.set(sourceTid, Math.floor(Date.now() / 1000));

      const res = await client.getCommentsBestEffort('1179350197', canonicalTid, 10, 0, {
        forceRefresh: false,
        maxCacheAgeSec: 3600,
      }) as Record<string, unknown>;
      const list = res['commentlist'] as Array<Record<string, unknown>>;
      assert(Array.isArray(list) && list.length === 1, `expected aliased comments, got ${JSON.stringify(res)}`);
    },
  },
  {
    name: 'getLikeListBestEffort aliases d_uin_abstime bucket to canonical tid',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const clientAny = client as unknown as Record<string, any>;
      const canonicalTid = 'ecadhfbihb';
      const sourceTid = 'd1179350197_1712345678_feed';
      client.cachePostMeta(canonicalTid, {
        uin: '1179350197',
        appid: '311',
        typeid: '0',
        likeUnikey: '',
        likeCurkey: '',
        abstime: 1712345678,
      });
      client.feeds3Likes.set(sourceTid, [{
        uin: '2',
        nickname: 'liker',
        tid: sourceTid,
        ownerUin: '1179350197',
        abstime: 1712345678,
        customItemId: '',
        _source: 'feeds3_html',
      }]);
      clientAny.feeds3LikesCache.set(sourceTid, [{
        uin: '2',
        name: 'liker',
        time: 1712345678,
        customItemId: '',
        _source: 'feeds3_html',
      }]);

      const list = await client.getLikeListBestEffort('1179350197', canonicalTid);
      assert(Array.isArray(list) && list.length === 1, `expected aliased likes, got ${JSON.stringify(list)}`);
    },
  },
];

export async function run() {
  return runSuite('feeds3/alias', cases);
}
