/**
 * 用实机 Cookie 拉一页 feeds3 HTML，校验「parseFeeds3Items 的 tid」与「parseFeeds3Comments 分桶」是否一致。
 *
 *   QZONE_CACHE_PATH=test_cache npx tsx scripts/verify-feeds3-comments-alignment.ts
 */
import { QzoneClient } from '../src/qzone/client.js';

async function fetchFeeds3HtmlPage(client: QzoneClient, uin: string): Promise<string> {
  const c = client as unknown as {
    fetchFeeds3Html(
      uin: string,
      forceRefresh: boolean,
      scope: number,
      count: number,
    ): Promise<string>;
  };
  return c.fetchFeeds3Html(uin, true, 1, 50);
}
import { parseFeeds3Comments, parseFeeds3CommentsScoped } from '../src/qzone/feeds3Parser.js';
import { parseFeeds3Items } from '../src/qzone/feeds3Parser.js';
import { preprocessHtml } from '../src/qzone/feeds3/preprocess.js';

async function main(): Promise<void> {
  const cachePath = process.env.QZONE_CACHE_PATH ?? './test_cache';
  const client = new QzoneClient({ cachePath });
  if (!client.loggedIn || !client.qqNumber) {
    console.error('未登录：请检查', cachePath, '/cookies.json');
    process.exit(2);
  }
  const uin = client.qqNumber;
  const html = await fetchFeeds3HtmlPage(client, uin);
  const { text: processed } = preprocessHtml(html);

  const items = parseFeeds3Items(html, undefined, undefined, 100);
  const commentsMap = parseFeeds3Comments(html);
  const scopedOnly = parseFeeds3CommentsScoped(processed);

  const itemTids = new Set(items.map((i) => String(i.tid)));
  const withCmt = items.filter((i) => Number(i.cmtnum) > 0);

  let matched = 0;
  let missingBucket = 0;
  let underfilled = 0;

  console.log('htmlLen(raw)', html.length, 'processed', processed.length);
  console.log('items', items.length, 'parseFeeds3Comments buckets', commentsMap.size, 'scoped-only buckets', scopedOnly.size);
  console.log('--- comment buckets ↔ items（无论 cmtnum 是否>0）---');
  for (const tid of commentsMap.keys()) {
    const it = items.find((x) => String(x.tid) === tid);
    const n = commentsMap.get(tid)?.length ?? 0;
    const cmt = it ? Number(it.cmtnum) || 0 : -1;
    const nick = it ? String(it.nickname ?? '').slice(0, 16) : '(无对应 item)';
    const roots = (commentsMap.get(tid) ?? [])
      .filter((c) => !c['is_reply'])
      .map((c) => String(c['content'] ?? '').replace(/\s+/g, ' ').slice(0, 48));
    console.log(`  tid=${tid} comments=${n} feed_cmtnum=${cmt} ${nick}`);
    console.log(`    一级评论摘要: ${roots.join(' | ') || '(无)'}`);
  }

  console.log('--- posts with cmtnum>0 (feed list) ---');

  for (const it of withCmt) {
    const tid = String(it.tid);
    const bucket = commentsMap.get(tid);
    const cmt = Number(it.cmtnum) || 0;
    const n = bucket?.length ?? 0;
    if (n === 0) {
      missingBucket++;
      console.log(`  [缺桶] tid=${tid} cmtnum=${cmt} uin=${it.uin} ${String(it.nickname ?? '').slice(0, 12)}`);
    } else {
      matched++;
      if (n < cmt) underfilled++;
      const first = String(bucket![0]?.['content'] ?? '').slice(0, 24).replace(/\s+/g, ' ');
      console.log(`  [对齐] tid=${tid} parsed=${n} cmtnum=${cmt} 首条:「${first}」`);
    }
  }

  const orphanTids: string[] = [];
  for (const tid of commentsMap.keys()) {
    if (!itemTids.has(tid)) orphanTids.push(tid);
  }

  console.log('--- orphan comment buckets (tid 不在本页 items 中) ---');
  if (orphanTids.length === 0) {
    console.log('  (无)');
  } else {
    for (const tid of orphanTids) {
      console.log(`  tid=${tid} count=${commentsMap.get(tid)?.length ?? 0}`);
    }
  }

  console.log('--- summary ---');
  console.log(
    JSON.stringify(
      {
        loginUin: uin,
        itemsCount: items.length,
        postsWithCmtnumPositive: withCmt.length,
        matchedNonEmptyBucket: matched,
        missingBucket,
        underfilledVsCmtnum: underfilled,
        orphanCommentBuckets: orphanTids.length,
        usedScopedPath: scopedOnly.size > 0,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
