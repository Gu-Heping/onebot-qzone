/**
 * parseFeeds3PostMeta：无 feed_data 时 legacy；有 feed_data 时 scoped + canonical tid
 */
import {
  parseFeeds3PostMeta,
  parseFeeds3PostMetaScoped,
} from '../../src/qzone/feeds3Parser.js';
import { preprocessHtml } from '../../src/qzone/feeds3/preprocess.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

/** 无 name="feed_data"，仅靠 t1_tid 划块（与旧行为一致） */
const LEGACY_ONLY = `
<div>t1_tid=legacytid99&t1_uin=100001
<div class="f-info">纯文本正文</div>
</div>`;

const cases: TestCase[] = [
  {
    name: '无 feed_data 时走 legacy，按 t1_tid 取 f-info',
    fn: () => {
      const m = parseFeeds3PostMeta(LEGACY_ONLY);
      assert(m.size >= 1, `应有条目，实际 size=${m.size}`);
      const row = m.get('legacytid99');
      assert(row !== undefined, '应有 legacytid99');
      assert(String(row!.content).includes('纯文本正文'), `content 应对上，实际=${row!.content}`);
    },
  },
  {
    name: '有 feed_data 时 scoped：两条 hex tid 分段、正文与评论数',
    fn: () => {
      const html = `
<i name="feed_data" data-tid="hexmeta111" data-uin="2492835361" data-abstime="1700000001" data-fkey="hexmeta111"></i>
<div class="f-ct"><p class="txt-box-title ellipsis-one"><a class="nickname" link="nameCard_2492835361">甲</a><span>：</span>第一条说说</p></div>
<div class="mod-comments"><ul><li class="comments-item bor3" data-type="commentroot"></li></ul></div>
<i name="feed_data" data-tid="hexmeta222" data-uin="2492835361" data-abstime="1700000002" data-fkey="hexmeta222"></i>
<div class="f-ct"><p class="txt-box-title ellipsis-one"><a class="nickname" link="nameCard_2492835361">甲</a><span>：</span>第二条说说</p></div>
`;
      const { text: proc } = preprocessHtml(html);
      const scoped = parseFeeds3PostMetaScoped(proc);
      assert(scoped.size === 2, `应有 2 条 meta，实际 ${scoped.size}`);
      const a = scoped.get('hexmeta111');
      const b = scoped.get('hexmeta222');
      assert(a !== undefined && String(a.content).includes('第一条说说'), '第一条正文');
      assert(b !== undefined && String(b.content).includes('第二条说说'), '第二条正文');
      assert(Number(a!.commentCount) === 1, `第一条 cmt=1，实际 ${a!.commentCount}`);
      assert(Number(b!.commentCount) === 0, `第二条无评论，实际 ${b!.commentCount}`);

      const viaMain = parseFeeds3PostMeta(html);
      assert(viaMain.size === 2, `主入口应走 scoped，size=${viaMain.size}`);
    },
  },
];

export async function run() {
  return runSuite('feeds3-meta', cases);
}
