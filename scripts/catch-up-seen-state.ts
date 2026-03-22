#!/usr/bin/env npx tsx
/**
 * 用真实接口把「当前能拉到的」说说、评论、点赞标记为已见，写入缓存文件，停止历史重复推送。
 *
 * 写入：
 *   - seen_post_tids.json（合并稳定键，与 poller 一致）
 *   - seen_interactive_state.json（评论 id / 点赞 uin / qz 计数，供 poller 启动加载）
 *
 * 用法（在仓库根目录，需有效 Cookie，建议先停掉 bridge 再执行，避免旧进程随后覆盖 JSON）：
 *   npx tsx scripts/catch-up-seen-state.ts
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { fromEnv, buildClient } from '../src/bridge/config.js';
import { commentDedupMark } from '../src/bridge/commentDedup.js';
import { normalizeComment, normalizeEmotion, normalizeLike } from '../src/bridge/poller.js';
import { seenLookupKeysForPost } from '../src/bridge/stablePostKey.js';
import { env } from '../src/qzone/config/env.js';
import { log } from '../src/qzone/utils.js';
import type { QzoneClient } from '../src/qzone/client.js';

type InteractiveFile = {
  v: 1;
  comments: Record<string, string[]>;
  likes: Record<string, string[]>;
  counts: Record<string, { comment: number; like: number }>;
};

function extractCommentList(res: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['commentlist', 'comment_list', 'data', 'comments']) {
    const v = res[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

async function collectCommentSeenKeys(
  client: QzoneClient,
  selfUin: string,
  tid: string,
): Promise<{ keys: string[]; rowCount: number }> {
  const seen = new Set<string>();
  let rowCount = 0;
  let pos = 0;
  const num = 80;
  let first = true;
  for (let page = 0; page < 50; page++) {
    const res = (await client.getCommentsBestEffort(selfUin, tid, num, pos, {
      forceRefresh: first,
      maxCacheAgeSec: 0,
    })) as unknown as Record<string, unknown>;
    first = false;
    const list = extractCommentList(res);
    rowCount += list.length;
    for (const raw of list) {
      const c = normalizeComment(raw);
      if (!c.commentId) continue;
      commentDedupMark(seen, tid, c);
    }
    if (!list.length || !res['has_more']) break;
    pos += list.length;
  }
  return { keys: [...seen], rowCount };
}

async function collectLikeUins(client: QzoneClient, selfUin: string, tid: string): Promise<string[]> {
  const raw = await client.getLikeListBestEffort(selfUin, tid);
  const uins = new Set<string>();
  for (const r of raw) {
    const like = normalizeLike(r);
    if (like.uin) uins.add(like.uin);
  }
  return [...uins];
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  renameSync(tmp, path);
}

async function ensureLogin(client: QzoneClient): Promise<boolean> {
  if (client.loggedIn) {
    const valid = await client.validateSession();
    if (valid) return true;
    if (env.skipRefreshOnStart) {
      log('WARNING', '探针失败但 QZONE_SKIP_REFRESH_ON_START=1，仍尝试继续 catch-up');
      return client.loggedIn;
    }
    const refreshed = await client.refreshSession();
    if (refreshed) return true;
    client.logout();
  }
  const cookieStr = env.cookieString;
  if (cookieStr) {
    await client.loginWithCookieString(cookieStr);
    if (client.loggedIn && (await client.validateSession(true))) return true;
    client.logout();
  }
  log('ERROR', '无法登录：请配置有效 cookies 或先在本机成功登录 bridge');
  return false;
}

async function main(): Promise<void> {
  const config = fromEnv();
  mkdirSync(config.cachePath, { recursive: true });
  const client = buildClient(config);

  if (!(await ensureLogin(client)) || !client.qqNumber) {
    process.exit(1);
    return;
  }
  const selfUin = String(client.qqNumber);
  log('INFO', `catch-up: 已登录 ${selfUin}，cache=${config.cachePath}`);

  const seenPostPath = join(config.cachePath, 'seen_post_tids.json');
  const interactivePath = join(config.cachePath, 'seen_interactive_state.json');

  const seenPostArr = readJson<string[]>(seenPostPath) ?? [];
  const seenPost = new Set(seenPostArr);

  const prevInteractive = readJson<Partial<InteractiveFile>>(interactivePath);
  const comments: Record<string, Set<string>> = {};
  const likes: Record<string, Set<string>> = {};
  const counts: Record<string, { comment: number; like: number }> = {};

  const mergeSet = (rec: Record<string, Set<string>>, tid: string, values: string[]) => {
    if (!rec[tid]) rec[tid] = new Set();
    for (const v of values) rec[tid].add(v);
  };

  if (prevInteractive?.comments) {
    for (const [tid, arr] of Object.entries(prevInteractive.comments)) {
      mergeSet(comments, tid, arr);
    }
  }
  if (prevInteractive?.likes) {
    for (const [tid, arr] of Object.entries(prevInteractive.likes)) {
      mergeSet(likes, tid, arr);
    }
  }
  if (prevInteractive?.counts) {
    for (const [tid, c] of Object.entries(prevInteractive.counts)) {
      counts[tid] = {
        comment: Math.max(0, c.comment),
        like: Math.max(0, c.like),
      };
    }
  }

  const myTids = new Set<string>();

  const ingestFeed = (rawList: Record<string, unknown>[], label: string) => {
    for (let i = 0; i < rawList.length; i++) {
      const r = rawList[i]!;
      const item = normalizeEmotion(r, selfUin);
      if (!item.tid) continue;
      for (const k of seenLookupKeysForPost(item, r)) seenPost.add(k);
      if (label === 'my' && item.uin === selfUin) myTids.add(item.tid);
    }
  };

  for (let pos = 0, page = 0; page < 20; page++) {
    const res = await client.getEmotionList(selfUin, pos, 20);
    const rawList = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
    if (rawList.length === 0) break;
    ingestFeed(rawList, 'my');
    pos += rawList.length;
  }

  for (let page = 0; page < 5; page++) {
    const res = await client.getFriendFeeds('', 20);
    const rawList = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
    if (rawList.length === 0) break;
    ingestFeed(rawList, 'friend');
  }

  const outSeen = [...seenPost].slice(-2000);
  atomicWriteJson(seenPostPath, outSeen);
  log('INFO', `catch-up: 已写入 seen_post_tids.json，共 ${outSeen.length} 条键`);

  const limit = pLimit(4);
  const tidList = [...myTids];
  log('INFO', `catch-up: 本人说说 ${tidList.length} 条，拉取评论/点赞…`);

  await Promise.all(
    tidList.map(tid =>
      limit(async () => {
        try {
          const { keys: ckeys, rowCount: commentRows } = await collectCommentSeenKeys(client, selfUin, tid);
          mergeSet(comments, tid, ckeys);
          const uins = await collectLikeUins(client, selfUin, tid);
          mergeSet(likes, tid, uins);
          const traffic = await client.getTrafficData(selfUin, tid);
          const prev = counts[tid];
          const next = {
            comment: Math.max(prev?.comment ?? 0, traffic.comment, commentRows),
            like: Math.max(prev?.like ?? 0, traffic.like, uins.length),
          };
          counts[tid] = next;
        } catch (e) {
          log('WARNING', `catch-up: tid=${tid.slice(0, 12)}… 跳过: ${e}`);
        }
      }),
    ),
  );

  const outInteractive: InteractiveFile = {
    v: 1,
    comments: {},
    likes: {},
    counts: {},
  };
  for (const [tid, s] of Object.entries(comments)) {
    if (s.size) outInteractive.comments[tid] = [...s];
  }
  for (const [tid, s] of Object.entries(likes)) {
    if (s.size) outInteractive.likes[tid] = [...s];
  }
  for (const [tid, c] of Object.entries(counts)) {
    outInteractive.counts[tid] = c;
  }

  atomicWriteJson(interactivePath, outInteractive);
  log(
    'INFO',
    `catch-up: 已写入 seen_interactive_state.json（${Object.keys(outInteractive.comments).length} 帖有评论记录，` +
      `${Object.keys(outInteractive.likes).length} 帖有点赞记录）。请重启 bridge 使 poller 加载。`,
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
