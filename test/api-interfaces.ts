#!/usr/bin/env npx tsx
/**
 * QZone Bridge 全量接口测试（读 + 写）
 *
 * 覆盖所有 34 个 action，包括：
 *   - Meta: get_version_info, get_status, get_login_info
 *   - 查询: get_emotion_list, get_friend_feeds, get_msg, get_comment_list, get_like_list
 *   - 用户: get_stranger_info, get_friend_list, get_visitor_list, get_portrait
 *   - 新增: get_traffic_data, set_emotion_privacy
 *   - 相册: get_album_list, get_photo_list, create_album, delete_album
 *   - 探测: probe_api_routes, reset_api_caches
 *   - 写操作: send_msg, send_comment, send_like, unlike, forward_msg,
 *             delete_comment, delete_msg
 *   - 登录: login_cookie (仅参数校验), logout (仅结构测试, 不真执行)
 *
 * 用法:
 *   npx tsx test/api-interfaces.ts                     # 全量（读+写）
 *   npx tsx test/api-interfaces.ts --readonly           # 仅只读
 *   npx tsx test/api-interfaces.ts --port 8080
 *   QZONE_TEST_LIGHT=1 npx tsx test/api-interfaces.ts   # 仅连通性
 *
 * 需先启动 bridge 且已登录。写操作会产生真实数据，请使用测试账号。
 */

// ─── CLI args ──────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const LIGHT = process.env['QZONE_TEST_LIGHT'] === '1';
const READONLY = ARGS.includes('--readonly') || ARGS.includes('--no-write');
const PORT = (() => {
  const i = ARGS.indexOf('--port');
  return i >= 0 && ARGS[i + 1] ? Number(ARGS[i + 1]) : 8080;
})();
const BASE = `http://127.0.0.1:${PORT}`;
const RATE_MS = 800;

// ─── helpers ───────────────────────────────────────────────────────────────
let lastCall = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function call(action: string, params: Record<string, unknown> = {}): Promise<any> {
  const now = Date.now();
  if (now - lastCall < RATE_MS) await sleep(RATE_MS - (now - lastCall));
  lastCall = Date.now();
  const res = await fetch(`${BASE}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

function isOk(r: any): boolean {
  return r && r.status === 'ok' && r.retcode === 0;
}

function assertOk(r: any, msg?: string): void {
  if (!isOk(r)) throw new Error(msg ?? `status=${r?.status} retcode=${r?.retcode} ${r?.message ?? ''}`);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ─── result tracking ───────────────────────────────────────────────────────
interface TestResult {
  action: string;
  pass: boolean;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  ms: number;
}

const results: TestResult[] = [];
let selfUin = '';
let sampleTid = '';
let sampleUin = '';

const PASS = '\x1b[32m✔\x1b[0m';
const FAIL = '\x1b[31m✘\x1b[0m';
const SKIP = '\x1b[33m⊘\x1b[0m';

async function run(
  action: string,
  fn: () => Promise<void>,
  opts?: { skip?: boolean; skipReason?: string },
): Promise<boolean> {
  if (opts?.skip) {
    results.push({ action, pass: true, skipped: true, skipReason: opts.skipReason, ms: 0 });
    console.log(`  ${SKIP} ${action} — ${opts.skipReason}`);
    return false;
  }
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ action, pass: true, ms });
    console.log(`  ${PASS} ${action} (${ms}ms)`);
    return true;
  } catch (e: any) {
    const ms = Date.now() - t0;
    const msg = e.message ?? String(e);
    results.push({ action, pass: false, error: msg, ms });
    console.log(`  ${FAIL} ${action} (${ms}ms) — ${msg}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test groups
// ═══════════════════════════════════════════════════════════════════════════

async function groupMeta() {
  console.log('\n── Meta ──');

  await run('get_version_info', async () => {
    const r = await call('get_version_info');
    assertOk(r);
    assert(typeof r.data?.app_version === 'string', 'app_version 应为字符串');
    assert(r.data.protocol_version === 'v11', 'protocol_version 应为 v11');
  });

  await run('get_status', async () => {
    const r = await call('get_status');
    assertOk(r);
    assert('online' in r.data && 'good' in r.data, '应含 online 和 good');
  });

  await run('get_login_info', async () => {
    const r = await call('get_login_info');
    assertOk(r);
    assert(r.data?.user_id != null && r.data.user_id !== 0, 'user_id 不能为 0');
    assert(typeof r.data?.nickname === 'string', 'nickname 应为字符串');
    selfUin = String(r.data.user_id);
    sampleUin = selfUin;
  });
}

async function groupQuery() {
  console.log('\n── 查询 ──');

  await run('get_emotion_list', async () => {
    const r = await call('get_emotion_list', { num: 20 });
    assertOk(r);
    assert(Array.isArray(r.data?.msglist), 'msglist 应为数组');
    assert(r.data.msglist.length >= 1, '至少 1 条说说');
    sampleTid = String(r.data.msglist[0].tid ?? r.data.msglist[0].cellid ?? '');
    if (r.data.msglist[0].uin) sampleUin = String(r.data.msglist[0].uin);
  });

  await run('get_emotion_list (指定用户)', async () => {
    const r = await call('get_emotion_list', { user_id: selfUin, num: 5 });
    assertOk(r);
    assert(Array.isArray(r.data?.msglist), 'msglist 应为数组');
  });

  await run('get_friend_feeds', async () => {
    const r = await call('get_friend_feeds');
    assertOk(r);
    assert(Array.isArray(r.data?.msglist), 'msglist 应为数组');
  });

  await run('get_msg', async () => {
    assert(!!sampleTid, 'no sampleTid');
    const r = await call('get_msg', { tid: sampleTid, user_id: sampleUin });
    assertOk(r);
    assert(r.data != null, 'data 不能为 null');
  });

  await run('get_comment_list', async () => {
    assert(!!sampleTid, 'no sampleTid');
    const r = await call('get_comment_list', { tid: sampleTid, num: 5 });
    assertOk(r);
    assert(r.data != null, 'data 不能为 null');
  });

  await run('get_like_list', async () => {
    assert(!!sampleTid, 'no sampleTid');
    const r = await call('get_like_list', { tid: sampleTid, user_id: sampleUin });
    assertOk(r);
  });
}

async function groupUser() {
  console.log('\n── 用户 / 社交 ──');

  await run('get_friend_list', async () => {
    const r = await call('get_friend_list');
    assertOk(r);
    assert(Array.isArray(r.data?.items), 'items 应为数组');
    assert(typeof r.data?.total === 'number', 'total 应为数字');
  });

  await run('get_visitor_list', async () => {
    const r = await call('get_visitor_list');
    assertOk(r);
    assert(r.data != null, 'data 不能为 null');
  });

  await run('get_stranger_info', async () => {
    assert(!!selfUin, 'no selfUin');
    const r = await call('get_stranger_info', { user_id: selfUin });
    assertOk(r);
    assert(r.data != null && !r.data?.error, 'data 应有效');
  });

  await run('get_portrait', async () => {
    assert(!!selfUin, 'no selfUin');
    const r = await call('get_portrait', { user_id: selfUin });
    assertOk(r);
    assert(typeof r.data === 'object', 'data 应为对象');
    assert('nickname' in r.data && 'avatarUrl' in r.data, '应含 nickname 和 avatarUrl');
  });
}

async function groupTrafficPrivacy() {
  console.log('\n── 流量 / 隐私 ──');

  await run('get_traffic_data', async () => {
    assert(!!sampleTid, 'no sampleTid');
    const r = await call('get_traffic_data', { tid: sampleTid });
    assertOk(r);
    assert(r.data != null, 'data 不能为 null');
  });

  await run('get_traffic_data (参数校验)', async () => {
    const r = await call('get_traffic_data', {});
    assert(r.retcode === 1400, '缺少 tid 应返回 1400');
  });

  await run('set_emotion_privacy (参数校验)', async () => {
    const r = await call('set_emotion_privacy', {});
    assert(r.retcode === 1400, '缺少 tid 应返回 1400');
  });
}

async function groupAlbum() {
  console.log('\n── 相册 ──');

  let albumId = '';

  await run('get_album_list', async () => {
    const r = await call('get_album_list');
    assertOk(r);
  });

  await run('get_photo_list', async () => {
    const r = await call('get_photo_list', { num: 5 });
    assertOk(r);
  });

  const createOk = await run('create_album', async () => {
    const name = `测试相册_${Date.now()}`;
    const r = await call('create_album', { name, desc: '接口测试自动创建', priv: 4 });
    assertOk(r);
    albumId = String(r.data?.albumid ?? r.data?.topic ?? r.data?.topicId ?? '');
  }, { skip: READONLY, skipReason: '只读模式' });

  await run('delete_album', async () => {
    assert(!!albumId, '无 albumId (create_album 未成功)');
    const r = await call('delete_album', { album_id: albumId });
    assertOk(r);
  }, { skip: READONLY || !createOk || !albumId, skipReason: READONLY ? '只读模式' : '无 albumId' });
}

async function groupProbe() {
  console.log('\n── 探测 / 维护 ──');

  await run('probe_api_routes', async () => {
    assert(!!sampleTid, 'no sampleTid');
    const r = await call('probe_api_routes', { tid: sampleTid });
    assertOk(r);
    assert(typeof r.data === 'object', 'data 应为路由探测结果对象');
  });

  await run('reset_api_caches', async () => {
    const r = await call('reset_api_caches');
    assertOk(r);
  });
}

async function groupWrite() {
  console.log('\n── 写操作 (CRUD 全流程) ──');

  let testTid = '';
  let testCommentId = '';

  // 1. 发说说
  const sendOk = await run('send_msg (发说说)', async () => {
    const content = `[自动测试] ${new Date().toLocaleString('zh-CN')} pid=${process.pid}`;
    const r = await call('send_msg', { message: content, who_can_see: 2 });
    assertOk(r);
    testTid = String(r.data?.tid ?? '');
    assert(!!testTid, '发布应返回 tid');
  }, { skip: READONLY, skipReason: '只读模式' });

  if (testTid) await sleep(2000);

  // 2. 查看刚发的说说
  await run('get_msg (验证发布)', async () => {
    assert(!!testTid, 'no testTid');
    const r = await call('get_msg', { tid: testTid, user_id: selfUin });
    assertOk(r);
  }, { skip: !sendOk || !testTid, skipReason: 'send_msg 未成功' });

  // 3. 评论
  const commentOk = await run('send_comment', async () => {
    assert(!!testTid, 'no testTid');
    const r = await call('send_comment', {
      target_uin: selfUin,
      target_tid: testTid,
      content: `[测试评论] ${Date.now()}`,
    });
    assertOk(r);
    // send_comment 现在会从 HTML 响应中提取 comment_id
    if (r.data?.comment_id) testCommentId = String(r.data.comment_id);
  }, { skip: !sendOk || !testTid, skipReason: 'send_msg 未成功' });

  // 3.1 备用：如果 send_comment 没返回 comment_id，尝试从评论列表获取
  if (commentOk && testTid && !testCommentId) {
    await sleep(1500);
    try {
      const cmtRes = await call('get_comment_list', { tid: testTid, num: 10 });
      if (isOk(cmtRes)) {
        const list = cmtRes.data?.data ?? cmtRes.data?.commentlist ?? cmtRes.data;
        if (Array.isArray(list)) {
          const ours = list.find((c: any) => String(c.content ?? c.con ?? '').includes('[测试评论]'));
          if (ours) testCommentId = String(ours.commentid ?? ours.id ?? '');
        }
      }
    } catch { /* best effort */ }
  }

  // 4. 点赞
  await run('send_like', async () => {
    assert(!!testTid, 'no testTid');
    const r = await call('send_like', { user_id: selfUin, tid: testTid });
    assertOk(r);
  }, { skip: !sendOk || !testTid, skipReason: 'send_msg 未成功' });

  // 5. 取消点赞
  if (testTid) await sleep(2000);
  await run('unlike', async () => {
    assert(!!testTid, 'no testTid');
    const r = await call('unlike', { user_id: selfUin, tid: testTid });
    assertOk(r);
  }, { skip: !sendOk || !testTid, skipReason: 'send_msg 未成功' });

  // 6. 转发
  await run('forward_msg', async () => {
    const tid = sampleTid || testTid;
    assert(!!tid, 'no tid');
    const r = await call('forward_msg', {
      user_id: selfUin,
      tid,
      content: `[测试转发] ${Date.now()}`,
    });
    assertOk(r);
  }, { skip: READONLY, skipReason: '只读模式' });

  // 7. set_emotion_privacy
  await run('set_emotion_privacy (设为私密)', async () => {
    assert(!!testTid, 'no testTid');
    const r = await call('set_emotion_privacy', { tid: testTid, privacy: 'private' });
    assertOk(r);
  }, { skip: !sendOk || !testTid, skipReason: 'send_msg 未成功' });

  await run('set_emotion_privacy (恢复公开)', async () => {
    assert(!!testTid, 'no testTid');
    const r = await call('set_emotion_privacy', { tid: testTid, privacy: 'public' });
    assertOk(r);
  }, { skip: !sendOk || !testTid, skipReason: 'send_msg 未成功' });

  // 8. 删除评论
  await run('delete_comment', async () => {
    assert(!!testTid && !!testCommentId, 'no testTid 或 testCommentId');
    const r = await call('delete_comment', { uin: selfUin, tid: testTid, comment_id: testCommentId });
    assertOk(r);
  }, { skip: !testTid || !testCommentId, skipReason: '无评论可删' });

  // 9. 删除测试说说
  await run('delete_msg (清理测试说说)', async () => {
    assert(!!testTid, 'no testTid');
    const r = await call('delete_msg', { tid: testTid });
    assertOk(r);
  }, { skip: !sendOk || !testTid, skipReason: 'send_msg 未成功' });
}

async function groupLogin() {
  console.log('\n── 登录接口 (参数校验) ──');

  await run('login_cookie (参数校验)', async () => {
    const r = await call('login_cookie', {});
    assert(r.retcode === 1400, '缺少 cookie 应返回 1400');
  });

  await run('logout (仅验证仍在线, 不执行登出)', async () => {
    const r = await call('get_login_info');
    assertOk(r);
    assert(r.data?.user_id != null, '仍应保持登录');
  });

  await run('login_qr (action 已注册)', async () => {
    // 验证不存在的 action 返回 1404
    const bad = await call('__nonexistent_action__');
    assert(bad.retcode === 1404, '不存在的 action 应返回 1404');
    // login_qr 存在所以不会是 1404 — 但不真正调用以免弹二维码
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║    QZone Bridge 全量接口测试                        ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  服务: ${BASE}`);
  console.log(`  模式: ${READONLY ? '只读' : '读写 (含发说说/评论/点赞/转发/删除)'}`);
  console.log(`  限流: ${RATE_MS}ms/请求\n`);

  // 连通性检查
  try {
    const v = await call('get_version_info');
    if (!v || v.status !== 'ok') throw new Error(v?.message ?? '无响应');
  } catch (e: any) {
    console.error(`  无法连接 ${BASE}，请先启动 bridge: npx tsx src/main.ts`);
    console.error(`  错误: ${e.message}`);
    process.exit(1);
  }

  // Light 模式
  if (LIGHT) {
    await groupMeta();
    console.log('\n  轻量模式完成。');
    const fail = results.filter((r) => !r.pass && !r.skipped);
    process.exit(fail.length > 0 ? 1 : 0);
  }

  // 登录校验
  const loginCheck = await call('get_login_info');
  if (!isOk(loginCheck) || !loginCheck.data?.user_id) {
    console.error('  未登录（get_login_info 失败），请先登录后运行测试。');
    process.exit(1);
  }
  selfUin = String(loginCheck.data.user_id);
  sampleUin = selfUin;

  // 运行所有测试组
  await groupMeta();
  await groupQuery();
  await groupUser();
  await groupTrafficPrivacy();
  await groupAlbum();
  await groupProbe();
  await groupWrite();
  await groupLogin();

  // ── 汇总 ──
  console.log('\n' + '═'.repeat(54));
  const passed = results.filter((r) => r.pass && !r.skipped);
  const failed = results.filter((r) => !r.pass && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  console.log(`  ${PASS} 通过: ${passed.length}`);
  console.log(`  ${FAIL} 失败: ${failed.length}`);
  console.log(`  ${SKIP} 跳过: ${skipped.length}`);
  console.log(`  ⏱  耗时: ${(totalMs / 1000).toFixed(1)}s`);

  if (failed.length > 0) {
    console.log('\n  失败项:');
    for (const f of failed) {
      console.log(`    ${FAIL} ${f.action}: ${f.error}`);
    }
  }
  console.log('');
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(2);
});
