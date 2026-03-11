#!/usr/bin/env npx tsx
/**
 * 评论和点赞监听功能验证测试
 *
 * 用法：
 *   npx tsx test/poller-validation.ts [--live]
 *
 * 加 --live 会实际启动 bridge 并等待事件（需要有效 Cookie）
 */

import { fromEnv, buildClient } from '../src/bridge/config.js';
import { EventHub } from '../src/bridge/hub.js';
import { EventPoller } from '../src/bridge/poller.js';
import type { OneBotEvent } from '../src/qzone/types.js';

const args = process.argv.slice(2);
const liveMode = args.includes('--live');

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, error?: string) {
  results.push({ name, passed: condition, error: condition ? undefined : error });
  const icon = condition ? '✔' : '✘';
  console.log(`  ${icon} ${name}`);
  if (!condition && error) {
    console.log(`      错误: ${error}`);
  }
}

// ──────────────────────────────────────────────
// 单元测试（无需登录）
// ──────────────────────────────────────────────
async function runUnitTests(): Promise<void> {
  console.log('\n━━━ 单元测试 ━━━\n');

  // 测试 EventHub
  const hub = new EventHub();
  let received = 0;
  const testCb = () => { received++; };

  hub.subscribe(testCb);
  await hub.publish({ test: true });
  assert('EventHub 订阅和发布', received === 1, `期望收到 1 个事件，实际 ${received}`);

  hub.unsubscribe(testCb);
  await hub.publish({ test: true });
  assert('EventHub 取消订阅', received === 1, `取消订阅后不应收到事件，实际 ${received}`);

  // 测试 seed tids
  hub.addSeedTid('test_tid_1');
  hub.addSeedTid('test_tid_2');
  hub.addSeedTid('test_tid_1'); // 重复添加
  const seeds = hub.getSeedTids();
  assert('EventHub seed tids', seeds.length === 2, `期望 2 个 seed，实际 ${seeds.length}`);

  // 测试 subscriberCount
  assert('EventHub subscriberCount', hub.subscriberCount() === 0, `期望 0 订阅者，实际 ${hub.subscriberCount()}`);
}

// ──────────────────────────────────────────────
// 集成测试（需要登录和真实 Cookie）
// ──────────────────────────────────────────────
async function runLiveTests(): Promise<void> {
  if (!liveMode) {
    console.log('\n━━━ 集成测试（跳过，加 --live 启用）━━━\n');
    return;
  }

  console.log('\n━━━ 集成测试（需要有效 Cookie）━━━\n');

  const config = fromEnv();
  const client = buildClient(config);

  // 尝试登录
  if (!client.loggedIn) {
    const cookieStr = process.env['QZONE_COOKIE_STRING'] || process.env['QZONE_COOKIE'];
    if (cookieStr) {
      try {
        await client.loginWithCookieString(cookieStr);
        const valid = await client.validateSession(true);
        if (!valid) {
          console.error('Cookie 已失效');
          process.exit(1);
        }
      } catch (e) {
        console.error(`登录失败: ${e}`);
        process.exit(1);
      }
    } else {
      console.error('未配置 Cookie');
      process.exit(1);
    }
  }

  console.log(`已登录: ${client.qqNumber}`);

  // 获取自己的说说列表
  console.log('\n  获取说说列表...');
  const emotions = await client.getEmotionList(client.qqNumber!, 0, 5);
  const msglist = emotions['msglist'] as Array<Record<string, unknown>> | undefined;

  if (!msglist || msglist.length === 0) {
    console.error('没有说说可供测试');
    process.exit(1);
  }

  const testPost = msglist[0]!;
  const tid = String(testPost['tid'] ?? testPost['cellid'] ?? '');
  const ownerUin = String(testPost['uin'] ?? client.qqNumber!);

  console.log(`  测试说说: tid=${tid.slice(0, 16)}..., uin=${ownerUin}`);

  // 测试评论获取
  console.log('\n  测试评论获取...');
  try {
    const commentsRes = await client.getCommentsBestEffort(ownerUin, tid, 20, 0);
    const commentlist = commentsRes['commentlist'] as Array<Record<string, unknown>> | undefined;

    assert(
      'getCommentsBestEffort 返回',
      commentsRes['code'] === 0 || (commentlist && commentlist.length >= 0),
      `code=${commentsRes['code']}, message=${commentsRes['message'] || '无'}`
    );

    if (commentlist) {
      console.log(`    获取到 ${commentlist.length} 条评论`);
      if (commentlist.length > 0) {
        const first = commentlist[0]!;
        assert(
          '评论数据结构',
          first['commentid'] && first['uin'] && first['content'],
          `缺少必要字段: ${JSON.stringify(Object.keys(first))}`
        );
      }
    }
  } catch (e) {
    assert('getCommentsBestEffort', false, String(e));
  }

  // 测试点赞列表获取
  console.log('\n  测试点赞列表获取...');
  try {
    const likes = await client.getLikeList(ownerUin, tid);
    assert('getLikeList 返回', Array.isArray(likes), `返回类型: ${typeof likes}`);
    console.log(`    获取到 ${likes.length} 个点赞`);

    if (likes.length > 0) {
      const first = likes[0]!;
      assert(
        '点赞数据结构',
        first['uin'] || first['fuin'],
        `缺少 uin 字段: ${JSON.stringify(Object.keys(first))}`
      );
    }
  } catch (e) {
    assert('getLikeList', false, String(e));
  }

  // 测试流量数据获取
  console.log('\n  测试流量数据获取...');
  try {
    const traffic = await client.getTrafficData(ownerUin, tid);
    assert(
      'getTrafficData 返回',
      traffic && typeof traffic.like === 'number' && typeof traffic.comment === 'number',
      `返回: ${JSON.stringify(traffic)}`
    );
    console.log(`    点赞: ${traffic.like}, 评论: ${traffic.comment}, 阅读: ${traffic.read}`);
  } catch (e) {
    assert('getTrafficData', false, String(e));
  }

  // 测试轮询器事件发布
  console.log('\n  测试轮询器事件发布...');
  const testHub = new EventHub();
  const events: OneBotEvent[] = [];

  testHub.subscribe((ev) => {
    events.push(ev);
  });

  const poller = new EventPoller(client, testHub, {
    ...config,
    emitMessageEvents: true,
    emitCommentEvents: true,
    emitLikeEvents: true,
  });

  // 手动添加测试用的 seed tid
  testHub.addSeedTid(tid);

  // 启动轮询器一小段时间
  poller.start();

  console.log('    轮询器已启动，等待 3 秒...');
  await new Promise(r => setTimeout(r, 3000));

  poller.stop();

  console.log(`    收到 ${events.length} 个事件`);

  // 检查事件类型
  const heartbeatEvents = events.filter(e => e.post_type === 'meta_event');
  const messageEvents = events.filter(e => e.post_type === 'message');
  const noticeEvents = events.filter(e => e.post_type === 'notice');

  assert('收到心跳事件', heartbeatEvents.length > 0, `收到 ${heartbeatEvents.length} 个心跳事件`);
  console.log(`    - 心跳事件: ${heartbeatEvents.length}`);
  console.log(`    - 消息事件: ${messageEvents.length}`);
  console.log(`    - 通知事件: ${noticeEvents.length}`);

  // 如果有评论或点赞事件，检查数据结构
  const commentEvents = noticeEvents.filter(e => e.notice_type === 'qzone_comment');
  const likeEvents = noticeEvents.filter(e => e.notice_type === 'qzone_like');

  if (commentEvents.length > 0) {
    const ev = commentEvents[0]!;
    assert(
      '评论事件数据结构',
      ev.comment_id && ev.comment_content !== undefined,
      `字段: ${JSON.stringify(Object.keys(ev))}`
    );
  }

  if (likeEvents.length > 0) {
    const ev = likeEvents[0]!;
    assert(
      '点赞事件数据结构',
      ev.user_id && ev.sender_name,
      `字段: ${JSON.stringify(Object.keys(ev))}`
    );
  }
}

// ──────────────────────────────────────────────
// 汇总报告
// ──────────────────────────────────────────────
async function printSummary(): Promise<void> {
  console.log('\n━━━ 测试汇总 ━━━\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const r of results) {
    if (!r.passed) {
      console.log(`  ✘ ${r.name}`);
      if (r.error) console.log(`      ${r.error}`);
    }
  }

  console.log(`\n  总计: ${passed} 通过, ${failed} 失败`);

  if (failed > 0) {
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// 主程序
// ──────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     评论和点赞监听功能验证测试                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  await runUnitTests();
  await runLiveTests();
  await printSummary();
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(2);
});
