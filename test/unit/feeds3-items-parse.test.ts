/**
 * parseFeeds3Items：真实页面中 id="feed_*" 首段 uin 常为内部映射，与 data-uin 不一致。
 */
import { parseFeeds3Items } from '../../src/qzone/feeds3/items.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

/** feed_ 用「内部 uin」3628420742；data-uin 为展示 QQ 2492835361 */
const INTERNAL_UIN_MISMATCH_FIXTURE = `<li class="f-single"><div id="feed_3628420742_311_0_1774000000_1_1"><div class="qz_summary wupfeed"><i class="none" name="feed_data" data-tid="1774000000" data-uin="2492835361" data-abstime="1774000000" data-fkey="testfkey123456789012345"></i><a class="f-name" href="#">昵称</a><div class="txt-box-title"><p>昵称：正文测试</p></div></div></div></li>`;

const cases: TestCase[] = [
  {
    name: 'parseFeeds3Items: feed_ 内部 uin ≠ data-uin 时仍按 data-uin 过滤成功',
    fn: () => {
      const items = parseFeeds3Items(INTERNAL_UIN_MISMATCH_FIXTURE, '2492835361', undefined, 10, false);
      assert(items.length === 1, `应解析 1 条，实际 ${items.length}`);
      assert(String(items[0]!.uin) === '2492835361', 'item.uin 应为 data-uin');
      assert(String(items[0]!.content ?? '').includes('正文测试'), '应提取正文');
      assert(String(items[0]!.tid) === 'testfkey123456789012345', '数字 tid 应归一为 fkey');
    },
  },
];

export async function run() {
  return runSuite('feeds3/items-parse', cases);
}
