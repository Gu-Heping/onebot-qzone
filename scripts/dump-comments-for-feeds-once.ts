/**
 * 为最近动态拉取真实评论（feeds3 / getCommentsBestEffort），写入 JSON 供人工核对。
 *
 * 用法:
 *   QZONE_CACHE_PATH=test_cache npx tsx scripts/dump-comments-for-feeds-once.ts
 *   COMMENT_DUMP_MAX_POSTS=12 COMMENT_DUMP_NUM=50 QZONE_CACHE_PATH=test_cache npx tsx scripts/dump-comments-for-feeds-once.ts
 *
 * 输入（可选）:
 *   COMMENT_DUMP_FEED_JSON=test_cache/feeds_manual_dump.json  — 用其中 items 的 tid/uin/cmtnum/created_time；
 *   若文件不存在或为空，则现场 getFriendFeeds(fast) 拉一页。
 *   默认会先再拉一次好友流并写入 postMetaCache（便于 fkey ↔ feeds3 t1_tid 别名）；COMMENT_DUMP_SKIP_WARM=1 可跳过。
 *
 * 行为:
 *   默认只请求 cmtnum>0 的帖（省请求）；COMMENT_DUMP_TRY_ALL=1 时对前 N 条帖都尝试拉评论（部分帖 cmtnum 可能不准）。
 *
 * 输出: $QZONE_CACHE_PATH/comments_manual_dump.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { QzoneClient } from '../src/qzone/client.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function pickComment(c: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'commentid', 'comment_id', 'id',
    'uin', 'name', 'nick', 'content', 'con', 'createtime', 'create_time',
    'is_reply', 'isReply', 'parent_comment_id', 'reply_to_uin', 'reply_to_nickname',
    'reply_to_comment_id', 'pic', '_feeds3_seq', '_source',
  ] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (c[k] !== undefined) out[k] = c[k];
  }
  return out;
}

interface FeedRow {
  tid: string;
  uin: string;
  nickname: string;
  cmtnum: number;
  created_time: number;
  appid: string;
  typeid: string;
}

async function loadFeedItems(
  client: QzoneClient,
  feedJsonPath: string,
  maxPosts: number,
): Promise<FeedRow[]> {
  const mapRaw = (m: Record<string, unknown>): FeedRow => ({
    tid: String(m.tid ?? m.cellid ?? '').trim(),
    uin: String(m.uin ?? m.opuin ?? '').trim(),
    nickname: String(m.nickname ?? m.name ?? ''),
    cmtnum: Number(m.cmtnum ?? 0) || 0,
    created_time: Number(m.created_time ?? 0) || 0,
    appid: String(m.appid ?? '311'),
    typeid: String(m.typeid ?? '0'),
  });

  if (fs.existsSync(feedJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(feedJsonPath, 'utf8')) as {
        items?: Record<string, unknown>[];
      };
      const items = raw.items;
      if (Array.isArray(items) && items.length > 0) {
        return items.slice(0, maxPosts).map(mapRaw).filter((x) => x.tid && x.uin);
      }
    } catch {
      /* fall through */
    }
  }
  const r = await client.getFriendFeeds('', maxPosts + 5, { fastMode: true });
  const list = (r as { msglist?: unknown[] }).msglist;
  if (!Array.isArray(list)) return [];
  return list.slice(0, maxPosts).map((raw) => mapRaw(raw as Record<string, unknown>)).filter((x) => x.tid && x.uin);
}

async function main() {
  const cachePath = process.env.QZONE_CACHE_PATH ?? './test_cache';
  const client = new QzoneClient({ cachePath });
  if (!client.loggedIn) {
    console.error('未登录：', cachePath);
    process.exit(2);
  }

  const maxPosts = Math.min(40, Math.max(1, parseInt(process.env.COMMENT_DUMP_MAX_POSTS ?? '15', 10) || 15));
  const numPerPost = Math.min(100, Math.max(1, parseInt(process.env.COMMENT_DUMP_NUM ?? '50', 10) || 50));
  const tryAll = ['1', 'true', 'yes'].includes((process.env.COMMENT_DUMP_TRY_ALL ?? '').toLowerCase());
  const gapMs = Math.min(5000, Math.max(0, parseInt(process.env.COMMENT_DUMP_GAP_MS ?? '350', 10) || 350));
  const feedJson = process.env.COMMENT_DUMP_FEED_JSON ?? path.join(cachePath, 'feeds_manual_dump.json');

  const posts = await loadFeedItems(client, feedJson, maxPosts);
  if (posts.length === 0) {
    console.error('没有可用动态条目，请先运行 dump-friend-feeds-once 或检查 feeds JSON');
    process.exit(1);
  }

  const skipWarm = ['1', 'true', 'yes'].includes((process.env.COMMENT_DUMP_SKIP_WARM ?? '').toLowerCase());
  if (!skipWarm) {
    await client.getFriendFeeds('', Math.max(maxPosts + 10, 30), { fastMode: true });
    if (fs.existsSync(feedJson)) {
      try {
        const raw = JSON.parse(fs.readFileSync(feedJson, 'utf8')) as { items?: Record<string, unknown>[] };
        const items = raw.items;
        if (Array.isArray(items)) {
          for (const m of items.slice(0, maxPosts)) {
            if (m && String(m.tid ?? m.cellid ?? '').trim()) client.cachePostMetaFromRaw(m);
          }
        }
      } catch {
        for (const p of posts) {
          if (p.created_time > 0) {
            client.cachePostMetaFromRaw({
              tid: p.tid,
              uin: p.uin,
              created_time: p.created_time,
              appid: p.appid,
              typeid: p.typeid,
              likeUnikey: '',
              likeCurkey: '',
            });
          }
        }
      }
    } else {
      for (const p of posts) {
        if (p.created_time > 0) {
          client.cachePostMetaFromRaw({
            tid: p.tid,
            uin: p.uin,
            created_time: p.created_time,
            appid: p.appid,
            typeid: p.typeid,
            likeUnikey: '',
            likeCurkey: '',
          });
        }
      }
    }
  }

  const results: Array<{
    tid: string;
    uin: string;
    nickname: string;
    cmtnumFromFeed: number;
    commentResCode: number;
    commentSource?: string;
    commentCount: number;
    comments: Record<string, unknown>[];
    message?: string;
  }> = [];

  for (const p of posts) {
    if (!tryAll && p.cmtnum <= 0) {
      results.push({
        tid: p.tid,
        uin: p.uin,
        nickname: p.nickname,
        cmtnumFromFeed: p.cmtnum,
        commentResCode: -999,
        commentCount: 0,
        comments: [],
        message: 'skipped (cmtnum=0, set COMMENT_DUMP_TRY_ALL=1 to try anyway)',
      });
      continue;
    }

    const res = await client.getCommentsBestEffort(p.uin, p.tid, numPerPost, 0, {
      forceRefresh: true,
      maxCacheAgeSec: 0,
    });
    const list = (res as { commentlist?: unknown[] }).commentlist;
    const arr = Array.isArray(list) ? list as Record<string, unknown>[] : [];
    results.push({
      tid: p.tid,
      uin: p.uin,
      nickname: p.nickname,
      cmtnumFromFeed: p.cmtnum,
      commentResCode: Number((res as { code?: number }).code ?? -1),
      commentSource: String((res as { _source?: string })._source ?? ''),
      commentCount: arr.length,
      comments: arr.map(pickComment),
      message: typeof (res as { message?: string }).message === 'string'
        ? (res as { message: string }).message
        : undefined,
    });
    if (gapMs > 0) await sleep(gapMs);
  }

  const outPath = path.join(cachePath, 'comments_manual_dump.json');
  const payload = {
    exportedAt: new Date().toISOString(),
    cachePath: path.resolve(cachePath),
    loginUin: client.qqNumber ?? null,
    feedJsonUsed: fs.existsSync(feedJson) ? path.resolve(feedJson) : null,
    request: { maxPosts, numPerPost, tryAll, gapMs },
    posts: results,
    summary: {
      postsScanned: results.length,
      postsWithComments: results.filter((x) => x.commentCount > 0).length,
      totalComments: results.reduce((s, x) => s + x.commentCount, 0),
    },
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(JSON.stringify(payload.summary, null, 2));
  console.log('已写入', outPath);
  for (const row of results) {
    if (row.commentCount > 0) {
      console.log(`\n# ${row.nickname} (${row.uin}) tid=${row.tid}  comments=${row.commentCount} src=${row.commentSource}`);
      for (let i = 0; i < Math.min(5, row.comments.length); i++) {
        const c = row.comments[i]!;
        console.log(
          `  ${i + 1}. ${c.name ?? c.nick ?? ''} (${c.uin}): ${String(c.content ?? '').replace(/\s+/g, ' ').slice(0, 80)}`,
        );
      }
      if (row.comments.length > 5) console.log(`  ... +${row.comments.length - 5} 条见 JSON`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
