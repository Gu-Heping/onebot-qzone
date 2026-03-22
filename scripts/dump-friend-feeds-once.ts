/**
 * 拉取好友动态（feeds3 / getFriendFeeds），导出 JSON 供人工核对 + 终端摘要。
 *
 * 用法:
 *   QZONE_CACHE_PATH=test_cache npx tsx scripts/dump-friend-feeds-once.ts
 *   FEED_DUMP_NUM=25 FEED_DUMP_PAGES=2 QZONE_CACHE_PATH=test_cache npx tsx scripts/dump-friend-feeds-once.ts
 *
 * 输出:
 *   - 终端：表格摘要（仅好友流条目）
 *   - 文件：`$QZONE_CACHE_PATH/feeds_manual_dump.json`（完整字段，便于 diff）
 * 评论导出见 `scripts/dump-comments-for-feeds-once.ts`（写入 `comments_manual_dump.json`）。
 *
 * 说明：`items` 与 `getFriendFeeds` 一致：若好友流 HTML 里出现本人动态，会出现在 `items` 中。
 * 根字段 `loginUin` 标明当前 Cookie 账号。若还要单独拉「个人说说时间线」（scope=1 等策略），可用：
 *   FEED_DUMP_INCLUDE_SELF=1 FEED_DUMP_SELF_NUM=15 …
 * 额外写入 `loginAccountItems`（可能与 `items` 中本人帖 tid 重复）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { QzoneClient } from '../src/qzone/client.js';

function pickForDump(m: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'tid', 'cellid', 'uin', 'opuin', 'nickname', 'name', 'content',
    'appid', 'typeid', 'appName', 'appShareTitle',
    'created_time', 'createTime', 'createTime2',
    'cmtnum', 'likenum', 'fwdnum',
    'rt_tid', 'rt_uin', 'rt_uinname', 'rt_con',
    'likeUnikey', 'likeCurkey',
    'musicShare', 'feed_type', 'video',
    'pic', 'picsMeta',
    'isLiked', '_source',
  ] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (m[k] !== undefined) out[k] = m[k];
  }
  return out;
}

async function main() {
  const cachePath = process.env.QZONE_CACHE_PATH ?? './test_cache';
  const client = new QzoneClient({ cachePath });
  if (!client.loggedIn) {
    console.error('未登录：', cachePath, '/cookies.json 无效或不存在');
    process.exit(2);
  }

  const want = Math.min(80, Math.max(1, parseInt(process.env.FEED_DUMP_NUM ?? '20', 10) || 20));
  const maxPages = Math.min(10, Math.max(1, parseInt(process.env.FEED_DUMP_PAGES ?? '1', 10) || 1));
  const includeSelf = ['1', 'true', 'yes'].includes((process.env.FEED_DUMP_INCLUDE_SELF ?? '').toLowerCase());
  const selfNum = Math.min(50, Math.max(1, parseInt(process.env.FEED_DUMP_SELF_NUM ?? '15', 10) || 15));

  const merged: Record<string, unknown>[] = [];
  const seenTid = new Set<string>();
  let cursor = '';
  let lastMeta: Record<string, unknown> = {};

  for (let p = 0; p < maxPages && merged.length < want; p++) {
    const r = await client.getFriendFeeds(cursor, want - merged.length + 5, { fastMode: true });
    lastMeta = {
      code: r.code,
      message: r.message,
      has_more: r.has_more,
      next_cursor_len: typeof r.next_cursor === 'string' ? r.next_cursor.length : 0,
    };
    const list = (r as { msglist?: unknown[] }).msglist;
    if (!Array.isArray(list)) break;
    for (const raw of list) {
      const m = raw as Record<string, unknown>;
      const tid = String(m.tid ?? m.cellid ?? '').trim();
      if (!tid || seenTid.has(tid)) continue;
      seenTid.add(tid);
      merged.push(m);
      if (merged.length >= want) break;
    }
    const nc = typeof r.next_cursor === 'string' ? r.next_cursor : '';
    if (!nc || !r.has_more || list.length === 0) break;
    cursor = nc;
  }

  const dumpRows = merged.map(pickForDump);

  let loginAccountRows: Record<string, unknown>[] = [];
  let selfMeta: Record<string, unknown> = {};
  if (includeSelf && client.qqNumber) {
    const er = await client.getEmotionList(client.qqNumber, 0, selfNum);
    selfMeta = { code: er.code, message: er.message };
    const elist = (er as { msglist?: unknown[] }).msglist;
    if (Array.isArray(elist)) {
      loginAccountRows = elist.map((raw) => pickForDump(raw as Record<string, unknown>));
    }
  }

  const outPath = path.join(cachePath, 'feeds_manual_dump.json');
  const payload: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    cachePath: path.resolve(cachePath),
    loginUin: client.qqNumber ?? null,
    note:
      'items = getFriendFeeds(fastMode) 与桥接/工具一致；含好友与 HTML 中出现的本人动态。loginUin 为当前登录号。',
    request: { want, maxPages, fastMode: true, includeSelf, selfNum },
    responseMeta: lastMeta,
    count: dumpRows.length,
    items: dumpRows,
  };
  if (includeSelf) {
    payload.selfEmotionMeta = selfMeta;
    payload.loginAccountItems = loginAccountRows;
    payload.loginAccountCount = loginAccountRows.length;
  }
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log('--- 摘要（终端）---');
  console.log(JSON.stringify({ ...lastMeta, written: outPath, count: dumpRows.length }, null, 2));
  console.log('');
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i]!;
    const tid = String(m.tid ?? m.cellid ?? '');
    const uin = String(m.uin ?? '');
    const op = String(m.opuin ?? '');
    const nick = String(m.nickname ?? m.name ?? '');
    const content = String(m.content ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    const title = String(m.appShareTitle ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const appid = String(m.appid ?? '');
    const line = title && appid !== '311' ? `${content || title}` : content;
    console.log(
      `${String(i + 1).padStart(2)}  appid=${appid.padEnd(5)} uin=${uin} opuin=${op || '(同uin)'}  ${nick.slice(0, 12).padEnd(12)}  tid=${tid}\n    ${line}`,
    );
  }
  console.log('');
  if (includeSelf) {
    console.log(`--- 本人说说 loginAccountItems (${loginAccountRows.length} 条) ---`);
    for (let i = 0; i < loginAccountRows.length; i++) {
      const row = loginAccountRows[i]!;
      const tid = String(row.tid ?? '');
      const nick = String(row.nickname ?? '');
      const content = String(row.content ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
      console.log(`  s${i + 1}  tid=${tid}  ${nick}  | ${content}`);
    }
    console.log('');
  }
  console.log('完整 JSON 已写入:', outPath);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
