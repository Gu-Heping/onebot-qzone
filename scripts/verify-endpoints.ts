#!/usr/bin/env tsx
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { QzoneClient } from '../src/qzone/client.js';
import { validateApiResponse } from '../src/qzone/validate.js';
import type { SchemaName } from '../src/qzone/schemas.js';
import { env } from '../src/qzone/config/env.js';

const args = process.argv.slice(2);
const skipWrite = args.includes('--skip-write') || args.includes('--readonly');

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export class SkipCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkipCheckError';
  }
}

export interface Feeds3FailureSummary {
  kind: 'auth' | 'rate_limit' | 'upstream_changed' | 'unknown';
  message: string;
}

export function summarizeFeeds3Failure(payload: Record<string, unknown>, endpoint = 'feeds3'): Feeds3FailureSummary {
  const failureKind = String(payload['_failure_kind'] ?? '').trim();
  const code = Number(payload['code'] ?? 0);
  const subcode = Number(payload['subcode'] ?? 0);
  const message = [
    payload['message'],
    payload['msg'],
    payload['tips'],
  ].filter((part) => typeof part === 'string' && String(part).trim()).join(' | ');
  const lower = message.toLowerCase();
  const kind: Feeds3FailureSummary['kind'] =
    failureKind === 'auth' || code === -3000 || subcode === -4001 || /need\s+login|请先登录|需要登录|未登录/.test(lower)
      ? 'auth'
      : failureKind === 'rate_limit'
        ? 'rate_limit'
        : failureKind === 'upstream_changed' || code !== 0
          ? 'upstream_changed'
          : 'unknown';
  const detail = message || `code=${code}${Number.isFinite(subcode) && subcode !== 0 ? ` subcode=${subcode}` : ''}`;
  return {
    kind,
    message: endpoint === 'emotion_list' && kind === 'auth'
      ? `feeds3 auth failure: ${detail}`
      : `${endpoint} ${kind} failure: ${detail}`,
  };
}

export function buildDependentFailureMessage(endpoint: string, parent: Feeds3FailureSummary): string {
  return `${endpoint} blocked by emotion_list ${parent.kind} failure: ${parent.message}`;
}

interface CheckResult {
  name: string;
  passed: boolean;
  duration: number;
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
    if (err instanceof SkipCheckError) {
      results.push({ name, passed: true, duration, issues: [msg], skipped: true });
      process.stdout.write(`  ${yellow('SKIP')}  ${name}  ${dim(`${duration}ms`)}  ${dim(msg.slice(0, 120))}\n`);
      return;
    }
    results.push({ name, passed: false, duration, issues: [msg] });
    process.stdout.write(`  ${red('FAIL')}  ${name}  ${dim(`${duration}ms`)}  ${dim(msg.slice(0, 120))}\n`);
  }
}

async function main() {
  console.log(cyan('\nQZone Endpoint Sanity Check\n'));
  console.log(dim(`模式: ${skipWrite ? '只读 (--skip-write)' : '完整'}`));
  console.log();

  const client = new QzoneClient();
  const cookie = env.cookieString;
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

  console.log(cyan('只读端点'));

  let firstTid = '';
  let emotionListFailure: Feeds3FailureSummary | null = null;

  const requireFirstTid = (endpoint: string): string => {
    if (firstTid) return firstTid;
    if (emotionListFailure) throw new Error(buildDependentFailureMessage(endpoint, emotionListFailure));
    throw new SkipCheckError(`${endpoint}: emotion_list returned no posts`);
  };

  await check('emotion_list (自己)', 'emotion_list', async () => {
    const result = await client.getEmotionList(selfUin, 0, 5);
    const msglist = Array.isArray(result['msglist']) ? result['msglist'] as Array<Record<string, unknown>> : [];
    if (msglist.length > 0) firstTid = String(msglist[0]!['tid'] ?? '');
    if (Number(result['code'] ?? -1) !== 0) {
      emotionListFailure = summarizeFeeds3Failure(result as Record<string, unknown>, 'emotion_list');
      throw new Error(emotionListFailure.message);
    }
    return result;
  });

  await check('playwright_feed', null, async () => {
    const snapshot = await client.getPlaywrightFriendFeedSnapshot(10);
    if (snapshot.posts.length === 0) {
      throw new Error(`playwright feed unavailable: network=${snapshot.networkIntercepted ? '1' : '0'} dom=${snapshot.domFallbackUsed ? '1' : '0'}`);
    }
    return {
      code: 0,
      count: snapshot.posts.length,
      networkIntercepted: snapshot.networkIntercepted,
      domFallbackUsed: snapshot.domFallbackUsed,
    };
  });

  await check('shuoshuo_detail', 'shuoshuo_detail', async () => {
    return client.getShuoshuoDetail(selfUin, requireFirstTid('shuoshuo_detail'));
  });

  await check('comment_list', 'comment_list', async () => {
    const result = await client.getCommentsBestEffort(selfUin, requireFirstTid('comment_list'), 5, 0) as Record<string, unknown>;
    if (Number(result['code'] ?? -1) !== 0) {
      throw new Error(summarizeFeeds3Failure(result, 'comment_list').message);
    }
    return result;
  });

  await check('traffic_data', 'traffic_data', async () => {
    const tid = requireFirstTid('traffic_data');
    const traffic = await client.getTrafficData(selfUin, tid);
    return { code: 0, data: [{ current: { newdata: { LIKE: traffic.like, PRD: traffic.read, CS: traffic.comment, ZS: traffic.forward } } }] };
  });

  await check('user_info', 'user_info', async () => client.getUserInfo(selfUin));
  await check('friend_list', 'friend_list', async () => client.getFriendList(0, 10));
  await check('visitor_list', 'visitor', async () => client.getVisitorList(selfUin));
  await check('album_list', 'album_list', async () => client.getAlbumList(selfUin));

  console.log(cyan('\n写操作端点'));

  let publishedTid = '';

  await check('publish + delete', 'social_action', async () => {
    const [tid] = await client.publish(`verify-test ${Date.now()}`);
    publishedTid = tid;
    await new Promise(resolve => setTimeout(resolve, 1000));
    return client.deleteEmotion(tid);
  }, { skip: skipWrite });

  await check('like + unlike', 'social_action', async () => {
    const tid = requireFirstTid('like + unlike');
    const abstime = Math.floor(Date.now() / 1000);
    const likeResult = await client.likeEmotion(selfUin, tid, abstime);
    await new Promise(resolve => setTimeout(resolve, 500));
    await client.unlikeEmotion(selfUin, tid, abstime);
    return likeResult;
  }, { skip: skipWrite });

  if (publishedTid) void publishedTid;

  console.log(cyan('\n结果汇总\n'));

  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total = results.length;

  console.log(`  通过: ${green(String(passed))}  失败: ${failed ? red(String(failed)) : '0'}  跳过: ${skipped ? yellow(String(skipped)) : '0'}  共计: ${total}`);

  if (failed > 0) {
    console.log(red('\n失败详情:'));
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  ${red('×')} ${result.name}`);
      for (const issue of result.issues) console.log(`    ${dim(issue)}`);
    }
  }

  if (skipped > 0) {
    console.log(yellow('\n跳过详情:'));
    for (const result of results.filter((r) => r.skipped)) {
      console.log(`  ${yellow('·')} ${result.name}`);
      for (const issue of result.issues) console.log(`    ${dim(issue)}`);
    }
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(red(`脚本异常: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(2);
  });
}
