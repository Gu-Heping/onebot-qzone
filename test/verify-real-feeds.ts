#!/usr/bin/env npx tsx
/**
 * 真实数据验证脚本（只读）
 *
 * 使用 QZONE_COOKIE_STRING（.env 或环境变量）登录，验证：
 * - getEmotionList / getFriendFeeds / getMobileMoodList 返回条数与结构
 * - normalizeEmotion 后是否为「人发的正常动态」
 * - 可选：首条说说的评论/点赞接口可解析
 *
 * 用法:
 *   npx tsx test/verify-real-feeds.ts
 *   QZONE_COOKIE_STRING="..." npx tsx test/verify-real-feeds.ts
 *
 * 不提交 Cookie 到仓库；仅从环境变量或 .env 读取。
 */
import 'dotenv/config';
import { fromEnv, buildClient } from '../src/bridge/config.js';
import { normalizeEmotion } from '../src/bridge/poller.js';
import { env } from '../src/qzone/config/env.js';

const ACTIVITY_APPID = '217'; // 好友点赞动态，非「人发说说」

function summary(text: string, maxLen = 80): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '…';
}

function isReasonablePost(raw: Record<string, unknown>): boolean {
  const tid = raw['tid'] ?? raw['cellid'];
  const uin = raw['uin'] ?? raw['frienduin'];
  if (!tid || !uin) return false;
  const appid = String(raw['appid'] ?? '');
  if (appid === ACTIVITY_APPID) return false;
  const hasContent =
    (raw['content'] && String(raw['content']).trim()) ||
    (raw['con'] && String(raw['con']).trim()) ||
    (Array.isArray(raw['conlist']) && (raw['conlist'] as unknown[]).length > 0) ||
    (raw['rt_con'] && String(raw['rt_con']).trim()) ||
    (raw['appShareTitle'] && String(raw['appShareTitle']).trim());
  return !!hasContent;
}

function checkNormalizedHumanLike(item: ReturnType<typeof normalizeEmotion>): boolean {
  if (!item.tid || !item.uin) return false;
  if (item.appid === ACTIVITY_APPID) return false;
  const hasContent =
    (item.content && item.content.trim()) ||
    (item.forwardContent && item.forwardContent.trim()) ||
    (item.appShareTitle && item.appShareTitle.trim());
  return !!hasContent;
}

async function main(): Promise<void> {
  const cookieStr = env.cookieString;
  if (!cookieStr) {
    console.error('缺少 QZONE_COOKIE_STRING，请在 .env 或环境变量中设置');
    process.exit(1);
  }

  const config = fromEnv();
  const client = buildClient(config);
  await client.loginWithCookieString(cookieStr);
  if (!client.loggedIn || !client.qqNumber) {
    console.error('登录失败或无法获取 QQ 号');
    process.exit(1);
  }
  const selfUin = client.qqNumber;
  console.log(`已登录: uin=${selfUin}\n`);

  let allOk = true;
  let firstTid: string | null = null;
  const emotionMsglist: Record<string, unknown>[] = [];
  const friendMsglist: Record<string, unknown>[] = [];

  // ── getEmotionList ──
  try {
    const res = await client.getEmotionList(selfUin, 0, 20) as Record<string, unknown>;
    const msglist = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
    emotionMsglist.push(...msglist);
    const source = res['_source'] ?? 'pc';
    const code = res['code'];
    console.log(`getEmotionList: code=${code} _source=${source} 条数=${msglist.length}`);
    if (msglist.length > 0) {
      firstTid = String(msglist[0]!['tid'] ?? msglist[0]!['cellid'] ?? '');
      const normalized = msglist.map((r) => normalizeEmotion(r, selfUin));
      const humanLike = normalized.filter(checkNormalizedHumanLike);
      const reasonable = msglist.filter(isReasonablePost);
      console.log(`  归一化后人发正常动态: ${humanLike.length}/${normalized.length} 条，原始合理: ${reasonable.length}/${msglist.length} 条`);
      const first = msglist[0]!;
      console.log(`  首条: tid=${firstTid?.slice(0, 16)} uin=${first['uin']} content=${summary(String(first['content'] ?? first['con'] ?? ''), 60)}`);
      if (humanLike.length === 0 && msglist.length > 0) allOk = false;
    } else {
      console.log('  (无数据，可能限流或 feeds3 解析为空)');
      if (code !== 0) allOk = false;
    }
  } catch (e) {
    console.error('getEmotionList 异常:', e);
    allOk = false;
  }
  console.log('');

  // ── getFriendFeeds ──
  try {
    const res = await client.getFriendFeeds('', 20) as Record<string, unknown>;
    const msglist = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
    friendMsglist.push(...msglist);
    console.log(`getFriendFeeds: 条数=${msglist.length}`);
    if (msglist.length > 0) {
      const normalized = msglist.map((r) => normalizeEmotion(r, String(r['uin'] ?? '')));
      const humanLike = normalized.filter(checkNormalizedHumanLike);
      const reasonable = msglist.filter(isReasonablePost);
      console.log(`  归一化后人发正常动态: ${humanLike.length}/${normalized.length} 条，原始合理: ${reasonable.length}/${msglist.length} 条`);
      const first = msglist[0]!;
      const tid = String(first['tid'] ?? first['cellid'] ?? '');
      if (!firstTid) firstTid = tid;
      console.log(`  首条: tid=${tid.slice(0, 16)} uin=${first['uin']} content=${summary(String(first['content'] ?? first['con'] ?? ''), 60)}`);
      if (humanLike.length === 0 && msglist.length > 0) allOk = false;
    }
  } catch (e) {
    console.error('getFriendFeeds 异常:', e);
    allOk = false;
  }
  console.log('');

  // getMobileMoodList 已移除，仅使用 feeds3 / getEmotionList
  console.log('getMobileMoodList: 已移除（仅 feeds3）');
  console.log('');

  // ── 可选：首条说说的评论/点赞 ──
  if (firstTid) {
    try {
      const commentsRes = await client.getCommentsBestEffort(selfUin, firstTid, 10, 0) as Record<string, unknown>;
      const commentList = commentsRes['commentlist'] ?? commentsRes['comment_list'] ?? commentsRes['data'] ?? commentsRes['comments'];
      const commentCount = Array.isArray(commentList) ? commentList.length : 0;
      console.log(`getCommentsBestEffort(tid=${firstTid.slice(0, 12)}…): 评论数=${commentCount}`);
    } catch (e) {
      console.error('getCommentsBestEffort 异常:', e);
    }
    try {
      const likes = await client.getLikeListBestEffort(selfUin, firstTid);
      console.log(`getLikeListBestEffort(tid=${firstTid.slice(0, 12)}…): 点赞数=${likes.length}`);
    } catch (e) {
      console.error('getLikeListBestEffort 异常:', e);
    }
  }

  // ── 含图说说、多级评论、含图评论（真实数据回归）────────────────────────
  let postsWithPic = 0;
  let totalCommentRoot = 0;
  let totalCommentReply = 0;
  let commentsWithPic = 0;
  let postsWithReplies = 0;

  for (const item of [...emotionMsglist, ...friendMsglist]) {
    const pic = item['pic'];
    if (Array.isArray(pic) && pic.length > 0) postsWithPic++;
  }

  if (client.feeds3Comments && client.feeds3Comments.size > 0) {
    for (const [, comments] of client.feeds3Comments) {
      if (!Array.isArray(comments)) continue;
      let hasReply = false;
      for (const c of comments) {
        if (c['is_reply'] === true) {
          totalCommentReply++;
          hasReply = true;
        } else {
          totalCommentRoot++;
        }
        const pic = c['pic'];
        if (Array.isArray(pic) && pic.length > 0) commentsWithPic++;
      }
      if (hasReply) postsWithReplies++;
    }
  }

  console.log('\n── 真实数据回归：含图说说 / 多级评论 / 含图评论 ──');
  console.log(`  含图说说: ${postsWithPic} 条（getEmotionList + getFriendFeeds 中 pic 非空）`);
  console.log(`  多级评论: 一级=${totalCommentRoot} 条，二级回复=${totalCommentReply} 条，有回复的帖子=${postsWithReplies} 个`);
  console.log(`  含图评论: ${commentsWithPic} 条（评论带 pic 数组且长度>0）`);

  console.log('\n────────────────────────────');
  console.log(allOk ? '结论: 是，当前数据为人发正常动态' : '结论: 否或部分异常，请查看上方详情');
  process.exit(allOk ? 0 : 1);
}

main();
