/**
 * stablePostKey / seen 键合并
 */
import {
  buildStablePostKeyFromItem,
  seenLookupKeysForPost,
} from '../../src/bridge/stablePostKey.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'buildStablePostKeyFromItem 与 raw 路径一致',
    fn: () => {
      const sk = buildStablePostKeyFromItem({ uin: '111', tid: 'abc123' });
      assert(sk === '111:abc123', sk);
    },
  },
  {
    name: 'seenLookupKeysForPost 合并 item 与 raw 的 tid/uin',
    fn: () => {
      const item = { uin: '2492835361', tid: 'fulltidhex00000000000001' };
      const raw = { uin: '2492835361', tid: 'shortfkey', cellid: 'cell99' };
      const keys = seenLookupKeysForPost(item, raw);
      assert(keys.includes('2492835361:fulltidhex00000000000001'), `缺 canonical: ${keys.join('|')}`);
      assert(keys.includes('2492835361_shortfkey'), `缺 uin_tid: ${keys.join('|')}`);
      assert(keys.includes('shortfkey'), `缺 bare tid: ${keys.join('|')}`);
    },
  },
];

export async function run() {
  return runSuite('bridge/stablePostKey', cases);
}
