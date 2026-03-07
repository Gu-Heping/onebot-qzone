#!/usr/bin/env tsx
/* ─────────────────────────────────────────────
   端点健康检查脚本 (Sanity Check)
   使用 Zod 校验所有核心 QZone API 端点，彩色输出 PASS / FAIL

   用法:
     npm run verify              # 完整检查（包含写操作）
     npm run verify:readonly     # 只读检查
   ───────────────────────────────────────────── */

import 'dotenv/config';
import { QzoneClient } from '../src/qzone/client.js';
import { validateApiResponse } from '../src/qzone/validate.js';
import type { SchemaName } from '../src/qzone/schemas.js';
import { log } from '../src/qzone/utils.js';

// ── CLI 参数 ──

const args = process.argv.slice(2);
const skipWrite = args.includes('--skip-write') || args.includes('--readonly');

// ── 颜色工具 ──

const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ── 测试结果 ──

interface CheckResult {
  name: string;
  passed: boolean;
  duration: number;      // ms
  issues: string[];
  skipped?: boolean;
}

const results: CheckResult[] = [];

async function check(
  name: string,
  schemaName: SchemaName | null,
  fn: () => Promise<unknown>,
  opts?: { skip?: boolean },
): Promise<void> {
  if (opts?.skip) {
    results.push({ name, passed: true, duration: 0, issues: ['SKIPPED'], skipped: true });
    process.stdout.write(`  ${yellow('SKIP')}  ${name}\n`);
    return;
  }
  const t0 = performance.now();
  try {
    const payload = await fn();
    const duration = Math.round(performance.now() - t0);

    if (schemaName) {
      const vr = validateApiResponse(schemaName, payload);
      if (!vr.ok) {
        results.push({ name, passed: false, duration, issues: vr.issues });
        process.stdout.write(`  ${red('FAIL')}  ${name}  ${dim(`${duration}ms`)}  ${dim(vr.issues[0] ?? '')}\n`);
        return;
      }
    }

    results.push({ name, passed: true, duration, issues: [] });
    process.stdout.write(`  ${green('PASS')}  ${name}  ${dim(`${duration}ms`)}\n`);
  } catch (err) {
    const duration = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, duration, issues: [msg] });
    process.stdout.write(`  ${red('FAIL')}  ${name}  ${dim(`${duration}ms`)}  ${dim(msg.slice(0, 120))}\n`);
  }
}

// ── 主流程 ──

async function main() {
  console.log(cyan('\n═══ QZone Endpoint Sanity Check ═══\n'));
  console.log(dim(`模式: ${skipWrite ? '只读 (--skip-write)' : '完整'}`));
  console.log();

  // 1. 初始化客户端
  const client = new QzoneClient();
  const cookie = process.env['QZONE_COOKIE'];
  if (!cookie) {
    console.error(red('错误: 缺少 QZONE_COOKIE 环境变量'));
    process.exit(1);
  }
  await client.loginWithCookieString(cookie);

  const selfUin = client.qqNumber;
  if (!selfUin) {
    console.error(red('错误: 无法从 Cookie 中提取 QQ 号'));
    process.exit(1);
  }
  console.log(dim(`QQ: ${selfUin}\n`));

  // ────────────────
  // 只读端点检查
  // ────────────────
  console.log(cyan('── 只读端点 ──'));

  // 说说列表
  let firstTid = '';
  await check('emotion_list (自己)', 'emotion_list', async () => {
    const r = await client.getEmotionList(selfUin, 0, 5);
    const ml = r['msglist'] as Array<Record<string, unknown>> | undefined;
    if (ml?.length) firstTid = String(ml[0]!['tid'] ?? '');
    return r;
  });

  // 说说详情（用第一条 tid）
  await check('shuoshuo_detail', 'shuoshuo_detail', async () => {
    if (!firstTid) throw new Error('无可用 tid，跳过');
    return client.getShuoshuoDetail(selfUin, firstTid);
  });

  // 评论列表
  await check('comment_list', 'comment_list', async () => {
    if (!firstTid) throw new Error('无可用 tid，跳过');
    return client.getComments(selfUin, firstTid, 5);
  });

  // 流量数据
  await check('traffic_data', 'traffic_data', async () => {
    if (!firstTid) throw new Error('无可用 tid，跳过');
    const td = await client.getTrafficData(selfUin, firstTid);
    // getTrafficData 返回 { like, read, comment, forward }，包一层以匹配 schema
    // 但实际上 validateApiResponse 针对的是 parseJsonp 后的原始结构，
    // 这里手工构造验证
    return { code: 0, data: [{ current: { newdata: { LIKE: td.like, PRD: td.read, CS: td.comment, ZS: td.forward } } }] };
  });

  // 用户信息
  await check('user_info', 'user_info', async () => {
    return client.getUserInfo(selfUin);
  });

  // 好友列表
  await check('friend_list', 'friend_list', async () => {
    return client.getFriendList(0, 10);
  });

  // 访客列表
  await check('visitor_list', 'visitor', async () => {
    return client.getVisitorList(selfUin);
  });

  // 相册列表
  await check('album_list', 'album_list', async () => {
    return client.getAlbumList(selfUin);
  });

  // ────────────────
  // 写操作端点检查
  // ────────────────
  console.log(cyan('\n── 写操作端点 ──'));

  let publishedTid = '';

  // 发布说说 → 删除
  await check('publish + delete', 'social_action', async () => {
    const [tid] = await client.publish(`verify-test ${Date.now()}`);
    publishedTid = tid;
    // 等一下再删
    await new Promise((r) => setTimeout(r, 1000));
    return client.deleteEmotion(tid);
  }, { skip: skipWrite });

  // 点赞 → 取消点赞
  await check('like + unlike', 'social_action', async () => {
    if (!firstTid) throw new Error('无可用 tid，跳过');
    const abstime = Math.floor(Date.now() / 1000);
    const likeResult = await client.likeEmotion(selfUin, firstTid, abstime);
    await new Promise((r) => setTimeout(r, 500));
    await client.unlikeEmotion(selfUin, firstTid, abstime);
    return likeResult;
  }, { skip: skipWrite });

  // ────────────────
  // 汇总
  // ────────────────
  console.log(cyan('\n═══ 结果汇总 ═══\n'));

  const passed  = results.filter((r) => r.passed && !r.skipped).length;
  const failed  = results.filter((r) => !r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total   = results.length;

  console.log(`  通过: ${green(String(passed))}  失败: ${failed ? red(String(failed)) : '0'}  跳过: ${skipped ? yellow(String(skipped)) : '0'}  共计: ${total}`);

  if (failed > 0) {
    console.log(red('\n失败详情:'));
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ${red('✗')} ${r.name}`);
      for (const issue of r.issues) {
        console.log(`    ${dim(issue)}`);
      }
    }
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(red(`脚本异常: ${err}`));
  process.exit(2);
});
