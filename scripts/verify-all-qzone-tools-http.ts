/**
 * 对运行中的 onebot-qzone HTTP 服务做**全量只读**校验（与 OpenClaw napcat-qq `qzone_*` 工具对应的桥接 action）。
 *
 * 默认不执行发说说/点赞等写操作；需要时加 `--write`。
 *
 *   npx tsx scripts/verify-all-qzone-tools-http.ts
 *   npx tsx scripts/verify-all-qzone-tools-http.ts --write
 *
 * 环境：`.env` 中 ONEBOT_PORT / ONEBOT_ACCESS_TOKEN；桥接需已登录（与本机 verify:http 相同）。
 */
import 'dotenv/config';

const PORT = Number(process.env['ONEBOT_PORT'] ?? '5700');
const HOST = process.env['ONEBOT_VERIFY_HOST'] ?? '127.0.0.1';
const TOKEN = (process.env['ONEBOT_ACCESS_TOKEN'] ?? '').trim();
const BASE = `http://${HOST}:${PORT}`;
const TIMEOUT_MS = Math.max(15_000, Number(process.env['ONEBOT_VERIFY_TIMEOUT_MS'] ?? '120000') || 120_000);

const args = process.argv.slice(2);
const DO_WRITE = args.includes('--write');

type Level = 'pass' | 'fail' | 'skip' | 'warn';

interface Row {
  tool: string;
  bridgeAction: string;
  level: Level;
  detail: string;
}

const rows: Row[] = [];

function record(tool: string, bridgeAction: string, level: Level, detail: string): void {
  rows.push({ tool, bridgeAction, level, detail });
  const icon = level === 'pass' ? '✓' : level === 'fail' ? '✗' : level === 'warn' ? '!' : '○';
  console.log(`${icon} [${tool}] ${bridgeAction}: ${detail}`);
}

interface BridgeResp {
  status?: string;
  retcode?: number;
  data?: unknown;
  message?: string;
}

function isOk(r: BridgeResp): boolean {
  return r.status === 'ok' || r.retcode === 0;
}

async function post(action: string, body: Record<string, unknown> = {}): Promise<BridgeResp> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const url = `${BASE.replace(/\/+$/, '')}/${action.replace(/^\/+/, '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return (await res.json()) as BridgeResp;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function firstTidFromMsglist(data: unknown): string {
  const o = asObj(data);
  const list = o?.['msglist'];
  if (!Array.isArray(list) || list.length === 0) return '';
  const first = asObj(list[0]);
  return String(first?.['tid'] ?? first?.['cellid'] ?? '').trim();
}

function firstAlbumId(data: unknown): string {
  const o = asObj(data);
  if (!o || o['_empty']) return '';
  const candidates = [
    o['albumlist'],
    o['albumList'],
    o['topicListInfo'],
    (asObj(o['data']) ?? {})['topicListInfo'],
  ];
  for (const c of candidates) {
    if (!Array.isArray(c) || c.length === 0) continue;
    const item = asObj(c[0]);
    const id = item?.['albumid'] ?? item?.['id'] ?? item?.['topicId'];
    if (id != null && String(id).trim()) return String(id).trim();
  }
  return '';
}

async function main(): Promise<void> {
  console.log(`\n═══ verify-all-qzone-tools-http ${BASE} write=${DO_WRITE} timeout=${TIMEOUT_MS}ms ═══\n`);

  // ── qzone_status（拆成三个 action）──
  {
    const r = await post('get_status', {});
    if (isOk(r) && asObj(r.data)) record('qzone_status', 'get_status', 'pass', 'data 为对象');
    else record('qzone_status', 'get_status', 'fail', JSON.stringify(r).slice(0, 200));
  }
  {
    const r = await post('check_cookie', { probe: false });
    if (isOk(r) && asObj(r.data)?.['valid'] === true) record('qzone_status', 'check_cookie', 'pass', 'valid=true');
    else record('qzone_status', 'check_cookie', 'fail', JSON.stringify(r).slice(0, 200));
  }
  let selfUin = '';
  let loginNick = '';
  {
    const r = await post('get_login_info', {});
    const d = asObj(r.data);
    if (isOk(r) && d && d['user_id'] != null) {
      selfUin = String(d['user_id']);
      loginNick = String(d['nickname'] ?? '');
      const level = loginNick && loginNick !== 'QZone用户' ? 'pass' : 'warn';
      record('qzone_status', 'get_login_info', level, `user_id=${selfUin} nickname=${loginNick || '(空)'}`);
    } else record('qzone_status', 'get_login_info', 'fail', JSON.stringify(r).slice(0, 200));
  }

  if (!selfUin) {
    console.error('未拿到 user_id，后续依赖 tid 的用例将跳过');
  }

  // ── qzone_version ──
  {
    const r = await post('get_version_info', {});
    const d = asObj(r.data);
    if (isOk(r) && d?.['app_name']) record('qzone_version', 'get_version_info', 'pass', String(d['app_name']));
    else record('qzone_version', 'get_version_info', 'fail', JSON.stringify(r).slice(0, 200));
  }

  // ── qzone_get_posts ──
  let sampleTid = '';
  {
    const r = await post('get_emotion_list', { pos: 0, num: 5, include_image_data: false, max_pages: 2 });
    const d = r.data;
    sampleTid = firstTidFromMsglist(d);
    if (isOk(r) && asObj(d) && Array.isArray(asObj(d)?.['msglist'])) {
      record('qzone_get_posts', 'get_emotion_list', 'pass', `msglist=${(asObj(d)?.['msglist'] as unknown[]).length} tid=${sampleTid || '无'}`);
    } else record('qzone_get_posts', 'get_emotion_list', 'fail', JSON.stringify(r).slice(0, 200));
  }

  // ── qzone_get_space_html_act_feed ──
  {
    const r = await post('get_feeds_html_act_all', {
      user_id: selfUin,
      start: 0,
      count: 5,
      include_image_data: false,
    });
    const d = asObj(r.data);
    const n = Array.isArray(d?.['msglist']) ? (d!['msglist'] as unknown[]).length : -1;
    if (isOk(r) && n >= 0) record('qzone_get_space_html_act_feed', 'get_feeds_html_act_all', 'pass', `msglist.len=${n}`);
    else record('qzone_get_space_html_act_feed', 'get_feeds_html_act_all', 'fail', JSON.stringify(r).slice(0, 200));
  }

  // ── qzone_get_user_act_feed（feed_owner）──
  if (selfUin) {
    const r = await post('get_feeds_html_act_all', {
      feed_owner: selfUin,
      start: 0,
      count: 5,
      include_image_data: false,
    });
    const d = asObj(r.data);
    const n = Array.isArray(d?.['msglist']) ? (d!['msglist'] as unknown[]).length : -1;
    if (isOk(r) && n >= 0) record('qzone_get_user_act_feed', 'get_feeds_html_act_all', 'pass', `feed_owner msglist.len=${n}`);
    else record('qzone_get_user_act_feed', 'get_feeds_html_act_all', 'fail', JSON.stringify(r).slice(0, 200));
  }

  // ── qzone_get_friend_feeds ──
  {
    const r = await post('get_friend_feeds', { num: 8, include_image_data: false });
    const d = asObj(r.data);
    const n = Array.isArray(d?.['msglist']) ? (d!['msglist'] as unknown[]).length : -1;
    if (isOk(r) && n >= 0) record('qzone_get_friend_feeds', 'get_friend_feeds', 'pass', `msglist.len=${n}`);
    else record('qzone_get_friend_feeds', 'get_friend_feeds', 'fail', JSON.stringify(r).slice(0, 200));
  }

  // ── tid 依赖 ──
  if (!sampleTid && selfUin) {
    const r = await post('get_friend_feeds', { num: 20, include_image_data: false });
    sampleTid = firstTidFromMsglist(r.data);
  }

  if (sampleTid && selfUin) {
    {
      const r = await post('get_msg', { user_id: selfUin, message_id: sampleTid, tid: sampleTid });
      if (isOk(r) && r.data != null) record('qzone_get_post_detail', 'get_msg', 'pass', `tid=${sampleTid.slice(0, 12)}…`);
      else record('qzone_get_post_detail', 'get_msg', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('get_feed_images', { user_id: selfUin, tid: sampleTid });
      const d = asObj(r.data);
      const urls = d?.['urls'];
      if (isOk(r) && Array.isArray(urls)) record('qzone_get_post_images', 'get_feed_images', 'pass', `urls=${urls.length}`);
      else if (isOk(r)) record('qzone_get_post_images', 'get_feed_images', 'pass', '无 urls 数组（可能无图）');
      else record('qzone_get_post_images', 'get_feed_images', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('get_comment_list', { user_id: selfUin, tid: sampleTid, num: 20, pos: 0 });
      const d = asObj(r.data);
      const n = [d?.['commentlist'], d?.['comment_list'], d?.['comments']].find(Array.isArray) as unknown[] | undefined;
      if (isOk(r) && n) record('qzone_get_comments', 'get_comment_list', 'pass', `comments=${n.length}`);
      else if (isOk(r)) record('qzone_get_comments', 'get_comment_list', 'pass', '结构可解析（可能 0 条）');
      else record('qzone_get_comments', 'get_comment_list', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('get_like_list', { user_id: selfUin, tid: sampleTid });
      if (isOk(r) && Array.isArray(r.data)) record('qzone_get_likes', 'get_like_list', 'pass', `len=${(r.data as unknown[]).length}`);
      else if (isOk(r)) record('qzone_get_likes', 'get_like_list', 'pass', 'ok');
      else record('qzone_get_likes', 'get_like_list', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('get_traffic_data', { user_id: selfUin, tid: sampleTid });
      const d = asObj(r.data);
      if (isOk(r) && d && (d['like'] != null || d['read'] != null || d['comment'] != null))
        record('qzone_get_traffic', 'get_traffic_data', 'pass', '含 like/read/comment 等字段');
      else if (isOk(r)) record('qzone_get_traffic', 'get_traffic_data', 'warn', `结构非预期 ${JSON.stringify(r.data).slice(0, 120)}`);
      else record('qzone_get_traffic', 'get_traffic_data', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('probe_api_routes', { uin: selfUin, tid: sampleTid });
      if (isOk(r) && r.data != null) record('qzone_probe_routes', 'probe_api_routes', 'pass', '有 data');
      else record('qzone_probe_routes', 'probe_api_routes', 'fail', JSON.stringify(r).slice(0, 200));
    }
  } else {
    const reason = !selfUin ? '无 user_id' : '无 tid';
    const skip = (tool: string, action: string) => record(tool, action, 'skip', reason);
    skip('qzone_get_post_detail', 'get_msg');
    skip('qzone_get_post_images', 'get_feed_images');
    skip('qzone_get_comments', 'get_comment_list');
    skip('qzone_get_likes', 'get_like_list');
    skip('qzone_get_traffic', 'get_traffic_data');
    skip('qzone_probe_routes', 'probe_api_routes');
  }

  // ── qzone_get_stranger_info / get_friend_list / visitors / portrait ──
  if (selfUin) {
    {
      const r = await post('get_stranger_info', { user_id: selfUin });
      const d = asObj(r.data);
      if (isOk(r) && d?.['nickname']) record('(bridge)', 'get_stranger_info', 'pass', `nickname=${d['nickname']}`);
      else record('(bridge)', 'get_stranger_info', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('get_friend_list', {});
      const d = asObj(r.data);
      const items = d?.['items'];
      if (isOk(r) && Array.isArray(items)) record('(bridge)', 'get_friend_list', 'pass', `items=${items.length}`);
      else record('(bridge)', 'get_friend_list', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('get_visitor_list', { user_id: selfUin });
      if (isOk(r)) record('qzone_get_visitors', 'get_visitor_list', 'pass', 'ok');
      else record('qzone_get_visitors', 'get_visitor_list', 'fail', JSON.stringify(r).slice(0, 200));
    }
    {
      const r = await post('get_portrait', { user_id: selfUin });
      const d = asObj(r.data);
      const nick = d?.['nickname'];
      const url = d?.['avatarUrl'] ?? d?.['avatar'];
      if (isOk(r) && (nick || url)) record('qzone_get_portrait', 'get_portrait', 'pass', `nick=${!!nick} avatar=${!!url}`);
      else record('qzone_get_portrait', 'get_portrait', 'fail', JSON.stringify(r).slice(0, 200));
    }
  }

  // ── fetch_image（白名单 URL）──
  if (selfUin) {
    const pr = await post('get_portrait', { user_id: selfUin });
    const avatarUrl = asObj(pr.data)?.['avatarUrl'] ?? asObj(pr.data)?.['avatar'];
    if (typeof avatarUrl === 'string' && avatarUrl.startsWith('http')) {
      const r = await post('fetch_image', { url: avatarUrl });
      const d = asObj(r.data);
      if (isOk(r) && d?.['base64'] && String(d['base64']).length > 20) record('(bridge)', 'fetch_image', 'pass', `base64.len=${String(d['base64']).length}`);
      else record('(bridge)', 'fetch_image', 'fail', JSON.stringify(r).slice(0, 200));
    } else record('(bridge)', 'fetch_image', 'skip', '无头像 URL');
  }

  // ── 相册 ──
  {
    const r = await post('get_album_list', { user_id: selfUin || undefined });
    const d = asObj(r.data);
    if (isOk(r) && d) {
      const aid = firstAlbumId(r.data);
      if (d['_empty']) record('qzone_get_albums', 'get_album_list', 'warn', '_empty（接口无列表或权限）');
      else record('qzone_get_albums', 'get_album_list', 'pass', aid ? `album=${aid}` : '无 album id');
      if (aid && selfUin) {
        const r2 = await post('get_photo_list', { user_id: selfUin, album_id: aid, num: 10 });
        if (isOk(r2)) record('qzone_get_photos', 'get_photo_list', 'pass', 'ok');
        else record('qzone_get_photos', 'get_photo_list', 'fail', JSON.stringify(r2).slice(0, 200));
      } else record('qzone_get_photos', 'get_photo_list', 'skip', '无相册 id');
    } else record('qzone_get_albums', 'get_album_list', 'fail', JSON.stringify(r).slice(0, 200));
  }

  // ── 写操作（可选）──
  if (DO_WRITE && selfUin && sampleTid) {
    {
      const r = await post('send_like', { tid: sampleTid, user_id: selfUin });
      if (isOk(r)) record('qzone_like', 'send_like', 'pass', 'ok');
      else record('qzone_like', 'send_like', 'warn', JSON.stringify(r).slice(0, 200));
      await new Promise((x) => setTimeout(x, 800));
      const u = await post('unlike', { tid: sampleTid, user_id: selfUin });
      if (isOk(u)) record('qzone_unlike', 'unlike', 'pass', 'ok');
      else record('qzone_unlike', 'unlike', 'warn', JSON.stringify(u).slice(0, 200));
    }
    const tag = `verify-all-${Date.now()}`;
    {
      const r = await post('send_msg', {
        message: [{ type: 'text', data: { text: `${tag} 自动验收` } }],
      });
      const d = asObj(r.data);
      const tid = String(d?.['tid'] ?? '');
      if (isOk(r) && tid) {
        record('qzone_publish', 'send_msg', 'pass', `tid=${tid.slice(0, 14)}…`);
        await new Promise((x) => setTimeout(x, 1200));
        const del = await post('delete_msg', { message_id: tid, tid });
        if (isOk(del)) record('qzone_delete', 'delete_msg', 'pass', '已删');
        else record('qzone_delete', 'delete_msg', 'fail', JSON.stringify(del).slice(0, 200));
      } else record('qzone_publish', 'send_msg', 'fail', JSON.stringify(r).slice(0, 200));
    }
  } else {
    const s = !DO_WRITE ? '--write 未开启' : '缺 user_id/tid';
    record('qzone_like/unlike/publish/delete', '(write)', 'skip', s);
  }

  // ── 未直接 HTTP 的插件工具 ──
  record('qzone_emoji_list', '(本地)', 'skip', '无桥接，插件内置');
  record('qzone_comment/delete_comment/forward/set_privacy/upload/create_album/delete_*', '(write)', 'skip', '默认跳过，避免副作用');

  // ── 汇总 ──
  const fail = rows.filter((x) => x.level === 'fail').length;
  const warn = rows.filter((x) => x.level === 'warn').length;
  console.log(`\n── 汇总: fail=${fail} warn=${warn} 共 ${rows.length} 项 ──\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
