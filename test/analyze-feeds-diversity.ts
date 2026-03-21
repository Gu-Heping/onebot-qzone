#!/usr/bin/env npx tsx
/**
 * 大规模真实数据：说说 appid/typeid/内容字段/多媒体/转发 + feeds3 评论结构
 *
 * 用法: npx tsx test/analyze-feeds-diversity.ts
 * 输出: 控制台摘要 + test_cache/analyze_feeds_diversity.json（不含 Cookie）
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fromEnv, buildClient } from '../src/bridge/config.js';
import { env } from '../src/qzone/config/env.js';
import { normalizeEmotion } from '../src/bridge/poller.js';

const OUT = path.join(process.env['QZONE_CACHE_PATH'] ?? './test_cache', 'analyze_feeds_diversity.json');

type AppidStats = {
  count: number;
  hasContent: number;
  hasConlist: number;
  hasAppShareTitle: number;
  hasMusicShare: number;
  hasPic: number;
  hasVideo: number;
  hasForward: number;
  /** content / conlist / appShareTitle / forward 全无 */
  emptyTextual: number;
  /** 无 content/con/conlist/appShareTitle，但有图（常见纯图说说） */
  noLineTextButPic: number;
  /** 无上述正文，但有转发块（转发语在 rt 侧） */
  noLineTextButForward: number;
  cmtnumSum: number;
  cmtnumPositive: number;
};

function emptyStats(): AppidStats {
  return {
    count: 0, hasContent: 0, hasConlist: 0, hasAppShareTitle: 0, hasMusicShare: 0, hasPic: 0, hasVideo: 0,
    hasForward: 0, emptyTextual: 0, noLineTextButPic: 0, noLineTextButForward: 0, cmtnumSum: 0, cmtnumPositive: 0,
  };
}

function ingestRaw(stats: Map<string, AppidStats>, raw: Record<string, unknown>): void {
  const appid = String(raw['appid'] ?? '(none)');
  const s = stats.get(appid) ?? emptyStats();
  s.count++;
  const content = String(raw['content'] ?? '').trim();
  const con = String(raw['con'] ?? '').trim();
  const conlist = Array.isArray(raw['conlist']) ? raw['conlist'] as unknown[] : [];
  const appShareTitle = String(raw['appShareTitle'] ?? '').trim();
  const pic = Array.isArray(raw['pic']) ? raw['pic'] : [];
  const video = Array.isArray(raw['video']) ? raw['video'] : [];
  const musicShare = raw['musicShare'] && typeof raw['musicShare'] === 'object';
  const rt = raw['rt_con'] ?? raw['rt_tid'];
  const hasForward = !!(rt && (typeof rt === 'object' ? Object.keys(rt as object).length : String(rt).trim()));

  if (content || con) s.hasContent++;
  if (conlist.length) s.hasConlist++;
  if (appShareTitle) s.hasAppShareTitle++;
  if (musicShare) s.hasMusicShare++;
  if (pic.length) s.hasPic++;
  if (video.length) s.hasVideo++;
  if (hasForward) s.hasForward++;
  const noLineText = !content && !con && conlist.length === 0 && !appShareTitle;
  if (!noLineText) {
    /* counted in hasContent / shareTitle / forward path */
  } else {
    s.emptyTextual++;
    if (pic.length) s.noLineTextButPic++;
    if (hasForward) s.noLineTextButForward++;
  }

  const cmt = Number(raw['cmtnum'] ?? 0);
  s.cmtnumSum += cmt;
  if (cmt > 0) s.cmtnumPositive++;
  stats.set(appid, s);
}

async function run(): Promise<void> {
  if (!env.cookieString) {
    console.error('缺少 QZONE_COOKIE_STRING');
    process.exit(1);
  }
  const cookieStr = env.cookieString;
  const config = fromEnv();
  const client = buildClient(config);
  await client.loginWithCookieString(cookieStr);
  if (!client.loggedIn || !client.qqNumber) {
    console.error('登录失败');
    process.exit(1);
  }
  const self = client.qqNumber;

  const byAppid = new Map<string, AppidStats>();
  const byTypeid = new Map<string, number>();
  const allPosts: Record<string, unknown>[] = [];

  // ── 自己的说说：两段 pos 拉更多条（内部已多页 feeds3）
  for (const pos of [0, 80]) {
    const res = await client.getEmotionList(self, pos, 80) as Record<string, unknown>;
    const ml = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
    for (const raw of ml) {
      allPosts.push(raw);
    }
  }

  // ── 好友流：多页 cursor
  let cursor = '';
  for (let p = 0; p < 6; p++) {
    const fr = await client.getFriendFeeds(cursor, 50) as Record<string, unknown>;
    const ml = Array.isArray(fr['msglist']) ? (fr['msglist'] as Record<string, unknown>[]) : [];
    for (const raw of ml) {
      allPosts.push(raw);
    }
    cursor = String(fr['next_cursor'] ?? '');
    if (!cursor) break;
  }

  // 去重 tid（emotion+好友可能重叠）
  const seenTid = new Set<string>();
  const uniquePosts: Record<string, unknown>[] = [];
  for (const raw of allPosts) {
    const tid = String(raw['tid'] ?? '');
    if (!tid || seenTid.has(tid)) continue;
    seenTid.add(tid);
    uniquePosts.push(raw);
  }

  for (const raw of uniquePosts) {
    ingestRaw(byAppid, raw);
    const t = String(raw['typeid'] ?? '(none)');
    byTypeid.set(t, (byTypeid.get(t) ?? 0) + 1);
  }

  // ── 归一化抽检：是否与 raw 同类字段一致
  let normContentOk = 0;
  let normMismatch = 0;
  for (const raw of uniquePosts.slice(0, Math.min(200, uniquePosts.length))) {
    const item = normalizeEmotion(raw, self);
    const rawHas =
      !!(String(raw['content'] ?? '').trim() || String(raw['con'] ?? '').trim()
        || (Array.isArray(raw['conlist']) && raw['conlist'].length)
        || String(raw['appShareTitle'] ?? '').trim());
    const itemHas = !!(item.content?.trim() || item.appShareTitle?.trim() || item.forwardContent?.trim());
    if (!rawHas && !itemHas) normContentOk++;
    else if (rawHas === itemHas || itemHas) normContentOk++;
    else normMismatch++;
  }

  // ── 评论：getEmotionList 已填充 feeds3Comments
  const commentMap = client.feeds3Comments;
  let totalRoot = 0;
  let totalReply = 0;
  let commentsWithPic = 0;
  let postsWithCommentRows = 0;
  let cmtMismatch = 0;

  for (const [, list] of commentMap) {
    if (!Array.isArray(list) || list.length === 0) continue;
    postsWithCommentRows++;
    for (const c of list) {
      if (c['is_reply'] === true) totalReply++;
      else totalRoot++;
      const pic = c['pic'];
      if (Array.isArray(pic) && pic.length > 0) commentsWithPic++;
    }
  }

  for (const raw of uniquePosts.slice(0, 150)) {
    const tid = String(raw['tid'] ?? '');
    const cmtnum = Number(raw['cmtnum'] ?? 0);
    if (!tid || cmtnum <= 0) continue;
    const parsed = commentMap.get(tid);
    const n = Array.isArray(parsed) ? parsed.length : 0;
    if (n === 0 && cmtnum > 0) cmtMismatch++;
  }

  const tidToUin = new Map<string, string>();
  for (const raw of uniquePosts) {
    const tid = String(raw['tid'] ?? '');
    const uin = String(raw['uin'] ?? '');
    if (tid && uin && !tidToUin.has(tid)) tidToUin.set(tid, uin);
  }

  // ── getCommentsBestEffort 抽样：优先 feeds3 里已有评论的 tid（真实数据里 cmtnum 字段常为 0）
  const sampleTids: Array<{ uin: string; tid: string; embeddedLen: number; fast: boolean }> = [];
  for (const tid of commentMap.keys()) {
    if (sampleTids.length >= 14) break;
    const uin = tidToUin.get(tid) ?? self;
    const embedded = commentMap.get(tid);
    const embeddedLen = Array.isArray(embedded) ? embedded.length : 0;
    sampleTids.push({ uin, tid, embeddedLen, fast: sampleTids.length % 2 === 0 });
  }

  const commentApiSamples: Array<{
    tidShort: string;
    embeddedLen: number;
    fastMode: boolean;
    apiLen: number;
    matchEmbedded: boolean;
  }> = [];

  for (const s of sampleTids) {
    const res = await client.getCommentsBestEffort(s.uin, s.tid, 50, 0, {
      forceRefresh: true,
      maxCacheAgeSec: 0,
      fastMode: s.fast,
    }) as Record<string, unknown>;
    const list = (res['commentlist'] ?? res['comment_list'] ?? []) as unknown[];
    const apiLen = Array.isArray(list) ? list.length : 0;
    commentApiSamples.push({
      tidShort: s.tid.length > 14 ? s.tid.slice(0, 12) + '…' : s.tid,
      embeddedLen: s.embeddedLen,
      fastMode: s.fast,
      apiLen,
      matchEmbedded: apiLen === s.embeddedLen || (apiLen > 0 && s.embeddedLen > 0),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    selfUinSuffix: self.slice(-4),
    totals: {
      rawListings: allPosts.length,
      uniquePostsByTid: uniquePosts.length,
      uniqueAppids: byAppid.size,
      uniqueTypeids: byTypeid.size,
      feeds3CommentPostsInMap: commentMap.size,
      postsWithAtLeastOneParsedComment: postsWithCommentRows,
    },
    byAppid: Object.fromEntries(
      [...byAppid.entries()].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => [k, v]),
    ),
    byTypeid: Object.fromEntries([...byTypeid.entries()].sort((a, b) => b[1] - a[1])),
    commentsEmbedded: {
      totalRootComments: totalRoot,
      totalReplyComments: totalReply,
      commentsWithPicArray: commentsWithPic,
      postsWithCmtnumButZeroParsedInCache_sample150: cmtMismatch,
    },
    normalizeSample: {
      checked: Math.min(200, uniquePosts.length),
      approxAgree: normContentOk,
      approxMismatch: normMismatch,
    },
    getCommentsBestEffortSamples: commentApiSamples,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n========== 说说/评论 解析多样性报告 ==========');
  console.log(JSON.stringify(report.totals, null, 2));
  console.log('\n--- byAppid ---');
  for (const [aid, s] of [...byAppid.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(
      `  appid=${aid}  n=${s.count}  noLineTxt=${s.emptyTextual}  +pic=${s.noLineTextButPic}  +fwd=${s.noLineTextButForward}  pic=${s.hasPic}  video=${s.hasVideo}  fwd=${s.hasForward}  musicMeta=${s.hasMusicShare}  shareTitle=${s.hasAppShareTitle}  cmtnum>0=${s.cmtnumPositive}`,
    );
  }
  console.log('\n--- getCommentsBestEffort vs 内嵌评论条数 (fast/slow 交替) ---');
  for (const row of commentApiSamples) {
    console.log(
      `  tid=${row.tidShort}  embedded=${row.embeddedLen}  fast=${row.fastMode}  apiLen=${row.apiLen}  match≈${row.matchEmbedded}`,
    );
  }
  console.log(`\n完整 JSON: ${OUT}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
