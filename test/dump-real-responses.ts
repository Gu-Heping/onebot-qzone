#!/usr/bin/env npx tsx
/**
 * 抓取真实接口返回值并写入 test_cache，用于排查：
 * - Cookie 是否可用
 * - 说说内容为空（content/conlist 结构）
 * - 图片/视频被识别成其他乱七八糟的图（pic/video 结构及来源）
 * - 事件监听延迟（轮询间隔与 tid 一致性）
 *
 * 用法: QZONE_COOKIE_STRING="..." npx tsx test/dump-real-responses.ts
 * 输出: test_cache/debug_raw_msglist.json, debug_friend_feeds.json, debug_cookie_ok.json
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fromEnv, buildClient } from '../src/bridge/config.js';
import { env } from '../src/qzone/config/env.js';

const CACHE_DIR = process.env['QZONE_CACHE_PATH'] ?? './test_cache';
const DEBUG_DIR = path.join(CACHE_DIR, 'debug');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(name: string, data: unknown): void {
  ensureDir(DEBUG_DIR);
  const filepath = path.join(DEBUG_DIR, name);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`已写入: ${filepath}`);
}

async function main(): Promise<void> {
  const cookieStr = env.cookieString;
  if (!cookieStr) {
    console.error('请设置 QZONE_COOKIE_STRING');
    process.exit(1);
  }

  const config = fromEnv();
  const client = buildClient(config);
  await client.loginWithCookieString(cookieStr);
  if (!client.loggedIn || !client.qqNumber) {
    writeJson('debug_cookie_ok.json', { ok: false, reason: 'login_failed' });
    console.error('登录失败');
    process.exit(1);
  }

  const selfUin = client.qqNumber;
  writeJson('debug_cookie_ok.json', { ok: true, uin: selfUin, ts: new Date().toISOString() });
  console.log(`Cookie 有效, uin=${selfUin}\n`);

  // 1) 自己的说说列表（getEmotionList → feeds3）
  const emotionRes = await client.getEmotionList(selfUin, 0, 10) as Record<string, unknown>;
  const msglist = Array.isArray(emotionRes['msglist']) ? (emotionRes['msglist'] as Record<string, unknown>[]) : [];
  const source = emotionRes['_source'] ?? 'feeds3';

  writeJson('debug_raw_msglist.json', {
    _note: 'getEmotionList 返回的 msglist 前几条，用于排查 content 为空、pic/video 错位',
    _source: source,
    _uin: selfUin,
    _ts: new Date().toISOString(),
    code: emotionRes['code'],
    count: msglist.length,
    items: msglist.slice(0, 5).map((item, i) => ({
      index: i,
      tid: item['tid'],
      uin: item['uin'],
      nickname: item['nickname'],
      content: item['content'],
      con: item['con'],
      conlist: item['conlist'],
      pic: item['pic'],
      picCount: Array.isArray(item['pic']) ? (item['pic'] as unknown[]).length : 0,
      video: item['video'],
      videoCount: Array.isArray(item['video']) ? (item['video'] as unknown[]).length : 0,
      created_time: item['created_time'],
      appid: item['appid'],
      typeid: item['typeid'],
      rt_tid: item['rt_tid'],
      rt_con: item['rt_con'],
      _keys: Object.keys(item),
    })),
  });
  console.log(`getEmotionList: ${msglist.length} 条, _source=${source}, 已 dump 前 5 条\n`);

  // 2) 好友动态（翻页拉取多页）
  const maxFriendPages = 3;
  const wantPerPage = 50;
  const friendList: Record<string, unknown>[] = [];
  let friendCursor = '';
  for (let p = 0; p < maxFriendPages; p++) {
    const friendRes = await client.getFriendFeeds(friendCursor, wantPerPage) as Record<string, unknown>;
    const pageList = Array.isArray(friendRes['msglist']) ? (friendRes['msglist'] as Record<string, unknown>[]) : [];
    friendList.push(...pageList);
    friendCursor = String(friendRes['next_cursor'] ?? '');
    const hasMore = friendCursor.length > 0;
    console.log(`getFriendFeeds 第 ${p + 1} 页: 本页 ${pageList.length} 条, 累计 ${friendList.length} 条, hasMore=${hasMore}`);
    if (!hasMore) break;
  }
  writeJson('debug_friend_feeds.json', {
    _note: 'getFriendFeeds 翻页合并的 msglist',
    _ts: new Date().toISOString(),
    count: friendList.length,
    items: friendList.slice(0, 20).map((item, i) => ({
      index: i,
      tid: item['tid'],
      uin: item['uin'],
      content: item['content'] ?? item['rt_con'] ?? '',
      rt_con: item['rt_con'],
      rt_uinname: item['rt_uinname'],
      con: item['con'],
      conlist: item['conlist'],
      pic: item['pic'],
      video: item['video'],
      appShareTitle: item['appShareTitle'],
      _keys: Object.keys(item),
    })),
  });
  console.log(`getFriendFeeds: 共 ${friendList.length} 条, 已 dump 前 20 条\n`);

  // 3) 评论真实数据（feeds3 HTML 内嵌评论，parseFeeds3Comments 解析结果，含一级与多级回复、评论内图片 pic）
  const commentsByPost = Object.fromEntries(client.feeds3Comments);
  const commentPostTids = Object.keys(commentsByPost);
  const byPost: Record<string, unknown> = {};
  for (const tid of commentPostTids.slice(0, 15)) {
    const list = commentsByPost[tid] as Record<string, unknown>[];
    byPost[tid] = list.map((c, i) => ({
      index: i,
      commentid: c['commentid'],
      uin: c['uin'],
      name: c['name'],
      content: c['content'],
      pic: c['pic'],
      picCount: Array.isArray(c['pic']) ? (c['pic'] as unknown[]).length : 0,
      createtime: c['createtime'],
      is_reply: c['is_reply'],
      parent_comment_id: c['parent_comment_id'],
      reply_to_uin: c['reply_to_uin'],
      reply_to_nickname: c['reply_to_nickname'],
      reply_to_comment_id: c['reply_to_comment_id'],
    }));
  }
  const fifthTid = friendList.length >= 5 ? (friendList[4] as Record<string, unknown>)['tid'] as string : undefined;
  const fifthComments = fifthTid ? (commentsByPost[fifthTid] as Record<string, unknown>[] | undefined) : undefined;
  writeJson('debug_comments.json', {
    _note: 'parseFeeds3Comments 从 feeds3 HTML 解析的评论，含 pic（评论带图）。第五条动态评论见 fifthFeedComments',
    _ts: new Date().toISOString(),
    postCount: commentPostTids.length,
    fifthFeedIndex: 4,
    fifthFeedTid: fifthTid,
    fifthFeedComments: fifthComments == null
      ? null
      : fifthComments.map((c, i) => ({
          index: i,
          commentid: c['commentid'],
          uin: c['uin'],
          name: c['name'],
          content: c['content'],
          pic: c['pic'],
          picCount: Array.isArray(c['pic']) ? (c['pic'] as unknown[]).length : 0,
          is_reply: c['is_reply'],
          parent_comment_id: c['parent_comment_id'],
          reply_to_nickname: c['reply_to_nickname'],
        })),
    byPost,
    _allPostTids: commentPostTids,
  });
  console.log(`评论: ${commentPostTids.length} 个帖子有内嵌评论, 已 dump 前 15 个帖子的评论列表`);
  if (fifthTid) {
    const withPic = fifthComments?.filter((c) => Array.isArray(c['pic']) && (c['pic'] as unknown[]).length > 0) ?? [];
    console.log(`第5条动态 tid=${fifthTid}, 评论数=${fifthComments?.length ?? 0}, 其中带图评论数=${withPic.length}\n`);
  } else {
    console.log('');
  }

  // 4) 轮询间隔与说明（供排查「无法及时监听到」）
  const pollInterval = config.pollInterval;
  writeJson('debug_poll_config.json', {
    _note: '事件轮询间隔（秒）。新说说要等下一次 pollMyPosts 才会进入 trackTids 并推送，延迟最多 pollInterval 秒',
    pollInterval,
    pollIntervalSeconds: pollInterval,
    env: process.env['ONEBOT_POLL_INTERVAL'] ?? '(default 60)',
  });
  console.log(`轮询间隔: ${pollInterval}s (ONEBOT_POLL_INTERVAL)\n`);
  console.log('请查看 test_cache/debug/*.json 对比接口返回与解析逻辑。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
