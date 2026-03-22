import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import pLimit from 'p-limit';
import { QzoneClient } from '../qzone/client.js';

// #region agent log
function getDebugLogPath(cachePath: string): string {
  return path.join(cachePath, 'debug.log');
}
function debugLog(cachePath: string, payload: { location: string; message: string; data: Record<string, unknown>; timestamp: number; hypothesisId?: string }): void {
  try {
    fs.appendFileSync(getDebugLogPath(cachePath), JSON.stringify(payload) + '\n');
  } catch (_) {}
  fetch('http://127.0.0.1:7242/ingest/8be6e162-8615-4320-91d6-a9ff0807a9c9', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
}
// #endregion
import type { BridgeConfig } from './config.js';
import type { EventHub } from './hub.js';
import type { EventPoller } from './poller.js';
import { safeInt } from './utils.js';
import type { OneBotResponse } from '../qzone/types.js';
import { log } from '../qzone/utils.js';

// ──────────────────────────────────────────────
// SSRF guard
// ──────────────────────────────────────────────
const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/, /^fc/, /^fd/, /^fe80/, /^0\.0\.0\.0$/, /^localhost$/i,
];

export function isSafeUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname;
    return !PRIVATE_RANGES.some(r => r.test(host));
  } catch { return false; }
}

/** QZone CDN 图片 URL 白名单（仅允许这些域名用于带 Cookie 拉取，避免 SSRF） */
const QZONE_IMAGE_HOST_SUFFIXES = [
  'qpic.cn',
  'photo.store.qq.com',
  'qzonestyle.gtimg.cn',
];

export function isQzoneImageUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return QZONE_IMAGE_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith('.' + suffix));
  } catch { return false; }
}

// ──────────────────────────────────────────────
// CQ code parser
// ──────────────────────────────────────────────
type Segment = { type: string; data: Record<string, string> };

export function parseMessageSegments(message: unknown): Segment[] {
  if (typeof message === 'string') {
    return parseCqCode(message);
  }
  if (!Array.isArray(message)) return [];
  return (message as unknown[]).map(seg => {
    if (typeof seg === 'string') return { type: 'text', data: { text: seg } };
    const s = seg as Record<string, unknown>;
    return {
      type: String(s['type'] ?? 'text'),
      data: Object.fromEntries(
        Object.entries((s['data'] as Record<string, unknown>) ?? {})
          .map(([k, v]) => [k, String(v ?? '')]),
      ),
    };
  });
}

function parseCqCode(raw: string): Segment[] {
  const segs: Segment[] = [];
  let last = 0;
  const cqRe = /\[CQ:(\w+)((?:,[^\]]*)*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = cqRe.exec(raw)) !== null) {
    if (m.index > last) segs.push({ type: 'text', data: { text: raw.slice(last, m.index) } });
    const type = m[1]!;
    const params: Record<string, string> = {};
    for (const kv of (m[2] ?? '').split(',').filter(Boolean)) {
      const eq = kv.indexOf('=');
      if (eq !== -1) params[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    }
    segs.push({ type, data: params });
    last = m.index + m[0].length;
  }
  if (last < raw.length) segs.push({ type: 'text', data: { text: raw.slice(last) } });
  return segs;
}

// ──────────────────────────────────────────────
// response builder
// ──────────────────────────────────────────────
function ok(data: unknown = null, echo?: string): OneBotResponse {
  return { status: 'ok', retcode: 0, data, echo };
}

function fail(retcode: number, msg: string, echo?: string): OneBotResponse {
  return { status: 'failed', retcode, data: null, message: msg, echo };
}

/** 将秒级/毫秒级时间戳格式化为便于阅读的 YYYY-MM-DD HH:mm */
function formatTimestampToReadable(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

const MAX_IMAGE_DATA_PER_POST = 5;
const MAX_IMAGE_DATA_PER_RESPONSE = 20;
const SEND_IMAGE_FETCH_CONCURRENCY = 3;
const SEND_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const SEND_IMAGE_FETCH_RETRIES = 2;

function isSupportedImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return true;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return true;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return true;
  return false;
}

/** 为 get_emotion_list 返回的 msglist 中每条补充 createTime/createTime2（便于 AI/客户端展示，避免仅显示时间戳） */
function ensureReadableTimeOnMsglist(res: Record<string, unknown>): void {
  const msglist = (res['msglist'] ?? (res['data'] as Record<string, unknown>)?.msglist) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(msglist)) return;
  for (const item of msglist) {
    const ts = Number(item['created_time'] ?? item['createdTime'] ?? 0);
    if (!ts || !Number.isFinite(ts)) continue;
    if (!item['createTime2']) item['createTime2'] = formatTimestampToReadable(ts);
    if (!item['createTime'] || String(item['createTime']).match(/^\d+$/)) item['createTime'] = formatTimestampToReadable(ts);
  }
}

/** 从 pic 项解析出 URL（支持 { url } 或 字符串） */
function getPicUrl(entry: unknown): string | null {
  if (typeof entry === 'string' && entry.startsWith('http')) return entry;
  if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['url'] === 'string') {
    return (entry as Record<string, unknown>)['url'] as string;
  }
  return null;
}

// ──────────────────────────────────────────────
// ActionHandler
// ──────────────────────────────────────────────
export class ActionHandler {
  constructor(
    private readonly client: QzoneClient,
    private readonly hub: EventHub,
    private readonly poller: EventPoller,
    private readonly config: BridgeConfig,
  ) {}

  async handle(action: string, params: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    const method = `action_${action.replace(/\./g, '_')}` as keyof this;
    try {
      if (typeof this[method] === 'function') {
        return await (this[method] as (p: Record<string, unknown>, echo?: string) => Promise<OneBotResponse>)(params, echo);
      }
      return fail(1404, `不支持的 action: ${action}`, echo);
    } catch (err) {
      return fail(1500, err instanceof Error ? err.message : String(err), echo);
    }
  }

  // ── meta ────────────────────────────────────
  async action_get_login_info(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = this.client.qqNumber!;
    const nickname = (await this.client.resolveLoginNickname(uin)) || 'QZone用户';
    return ok({ user_id: safeInt(uin), nickname }, echo);
  }

  async action_get_status(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    const pollerStatus = this.poller.getStatus();
    return ok({
      online: this.client.loggedIn && (pollerStatus['online'] as boolean ?? false),
      good: this.client.loggedIn,
      ...pollerStatus,
    }, echo);
  }

  /** 检查当前 Cookie 是否过期：执行网络探针校验，返回是否有效及 Cookie 年龄等信息 */
  async action_check_cookie(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) {
      return ok({
        valid: false,
        expired: true,
        message: '未登录，无 Cookie',
        cookie_age_seconds: null,
        has_p_skey: false,
        has_skey: false,
      }, echo);
    }
    const now = Date.now();
    const cookieAgeSeconds = this.client.cookiesLastUsed
      ? Math.round((now - this.client.cookiesLastUsed.getTime()) / 1000)
      : null;
    const hasPskey = !!this.client.cookies['p_skey'];
    const hasSkey = !!this.client.cookies['skey'];
    const probe = (p['probe'] !== false && p['probe'] !== '0'); // 默认 true：发起网络探针
    let valid = false;
    if (probe) {
      valid = await this.client.validateSession();
    } else {
      valid = hasPskey && hasSkey;
    }
    return ok({
      valid,
      expired: !valid,
      message: valid ? 'Cookie 有效' : (probe ? 'Cookie 已过期或探针失败，建议重新登录' : '未探针，仅根据 p_skey/skey 存在判断'),
      cookie_age_seconds: cookieAgeSeconds,
      has_p_skey: hasPskey,
      has_skey: hasSkey,
      qq: this.client.qqNumber ?? null,
    }, echo);
  }

  async action_get_version_info(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    return ok({ app_name: 'qzone-bridge', app_version: '2.0.0', protocol_version: 'v11' }, echo);
  }

  // ── send_msg ─────────────────────────────────
  async action_send_msg(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    return this.action_send_private_msg(p, echo);
  }

  async action_send_private_msg(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const segs = parseMessageSegments(p['message']);
    let text = '';
    const imageTasks: Array<Promise<string | null>> = [];
    const fetchLimit = pLimit(SEND_IMAGE_FETCH_CONCURRENCY);
    for (const seg of segs) {
      if (seg.type === 'text') text += seg.data['text'] ?? '';
      else if (seg.type === 'image') {
        const source = seg.data['url'] ?? seg.data['file'] ?? '';
        imageTasks.push(fetchLimit(() => this.resolveImageBase64(source)));
      }
    }
    const images = (await Promise.all(imageTasks)).filter((image): image is string => !!image);

    const whoCanSee = p['who_can_see'] !== undefined ? safeInt(p['who_can_see']) : undefined;
    const [tid, picIds] = await this.client.publish(text, images.length ? images : undefined, whoCanSee);
    return ok({ message_id: safeInt(tid), tid, pic_ids: picIds }, echo);
  }

  async action_send_group_msg(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    // qzone 无群聊 - map to private
    return this.action_send_private_msg(p, echo);
  }

  // ── recall / delete ───────────────────────────
  async action_delete_msg(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tid = String(p['message_id'] ?? p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 message_id', echo);
    const res = await this.client.deleteEmotion(tid);
    return (res['code'] as number) === 0 ? ok(null, echo) : fail(1500, String(res['message'] ?? ''), echo);
  }

  // ── like ──────────────────────────────────────
  async action_send_like(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tid = String(p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 tid', echo);
    // user_id 可选——缺失时由 client 从缓存补全
    const ouin = String(p['user_id'] ?? '');
    const abstime = safeInt(p['abstime'] ?? 0);
    const appid = safeInt(p['appid'] ?? 0);
    const typeid = safeInt(p['typeid'] ?? 0);
    const unikey = p['unikey'] ? String(p['unikey']) : undefined;
    const curkey = p['curkey'] ? String(p['curkey']) : undefined;
    const res = await this.client.likeEmotion(ouin, tid, abstime, appid, typeid, unikey, curkey);
    return (res as Record<string, unknown>)['code'] != null && (res as Record<string, unknown>)['code'] !== 0
      ? fail(1500, String((res as Record<string, unknown>)['message'] ?? ''), echo)
      : ok(null, echo);
  }

  async action_unlike(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tid = String(p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 tid', echo);
    const ouin = String(p['user_id'] ?? '');
    const abstime = safeInt(p['abstime'] ?? 0);
    const appid = safeInt(p['appid'] ?? 0);
    const typeid = safeInt(p['typeid'] ?? 0);
    const unikey = p['unikey'] ? String(p['unikey']) : undefined;
    const curkey = p['curkey'] ? String(p['curkey']) : undefined;
    const res = await this.client.unlikeEmotion(ouin, tid, abstime, appid, typeid, unikey, curkey);
    return (res as Record<string, unknown>)['code'] === 0 || (res as Record<string, unknown>)['ret'] === 0
      ? ok(null, echo) : fail(1500, String((res as Record<string, unknown>)['message'] ?? ''), echo);
  }

  // ── comment ───────────────────────────────────
  async action_send_comment(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tidRaw = String(p['target_tid'] ?? p['tid'] ?? '');
    const content = String(p['content'] ?? '');
    if (!tidRaw || !content) return fail(1400, '缺少 tid / content', echo);
    const tid = this.client.resolveTidForComments(tidRaw);
    // user_id 可选——缺失时由 client 从缓存补全（缓存 key 为 hex 时 getPostMeta(tid) 才命中）
    const ouin = String(p['target_uin'] ?? p['user_id'] ?? '');
    const replyId = p['reply_comment_id'] ? String(p['reply_comment_id']) : undefined;
    const replyUin = p['reply_uin'] ? String(p['reply_uin']) : undefined;
    const appid = safeInt(p['appid'] ?? 0);
    const abstime = safeInt(p['abstime'] ?? 0);
    const res = await this.client.commentEmotion(ouin, tid, content, replyId, replyUin, appid, abstime);
    if ((res as Record<string, unknown>)['code'] !== 0)
      return fail(1500, String((res as Record<string, unknown>)['message'] ?? ''), echo);
    // 从返回 HTML 中提取刚发布评论的 comment_id
    let commentId: string | undefined;
    const feeds = String((res as any)?.data?.feeds ?? '');
    const m = feeds.match(/data-type="commentroot"\s+data-tid="(\d+)"/g);
    if (m?.length) {
      const last = m[m.length - 1].match(/data-tid="(\d+)"/);
      if (last) commentId = last[1];
    }
    return ok(commentId ? { comment_id: commentId } : null, echo);
  }

  async action_delete_comment(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tidRaw = String(p['tid'] ?? '');
    const commentId = String(p['comment_id'] ?? '');
    if (!tidRaw || !commentId) return fail(1400, '缺少 tid / comment_id', echo);
    const tid = this.client.resolveTidForComments(tidRaw);
    let uin = String(p['uin'] ?? p['user_id'] ?? '');
    if (!uin) {
      const meta = this.client.getPostMeta(tid);
      if (meta) uin = meta.uin;
    }
    if (!uin) return fail(1400, '缺少 uin/user_id 且无法从缓存补全', echo);
    const commentUin = p['comment_uin'] !== undefined ? String(p['comment_uin']) : undefined;
    const res = await this.client.deleteComment(uin, tid, commentId, commentUin);
    const code = (res as Record<string, unknown>)['code'];
    const ret = (res as Record<string, unknown>)['ret'];
    const okCode = code === 0 || ret === 0;
    return okCode ? ok(null, echo) : fail(1500, String((res as Record<string, unknown>)['message'] ?? (res as Record<string, unknown>)['msg'] ?? ''), echo);
  }

  // ── forward ───────────────────────────────────
  async action_forward_msg(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const ouin = String(p['user_id'] ?? '');
    const tid = String(p['tid'] ?? '');
    const content = String(p['content'] ?? '');
    if (!ouin || !tid) return fail(1400, '缺少 user_id 或 tid', echo);
    const res = await this.client.forwardEmotion(ouin, tid, content);
    return (res as Record<string, unknown>)['code'] === 0
      ? ok(null, echo) : fail(1500, String((res as Record<string, unknown>)['message'] ?? ''), echo);
  }

  // ── get_msg / fetch ───────────────────────────
  async action_get_msg(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['user_id'] ?? this.client.qqNumber!);
    const tid = String(p['message_id'] ?? p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 message_id', echo);
    const res = await this.client.getShuoshuoDetail(uin, tid);
    return ok(res, echo);
  }

  async action_get_feed_images(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['user_id'] ?? this.client.qqNumber!);
    const tid = String(p['tid'] ?? p['message_id'] ?? '');
    if (!tid) return fail(1400, '缺少 tid', echo);
    const urls = await this.client.getFeedImages(uin, tid);
    return ok({ urls }, echo);
  }

  async action_get_emotion_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = p['user_id'] ? String(p['user_id']) : this.client.qqNumber!;
    const pos = safeInt(p['pos'] ?? 0);
    const num = Math.max(1, Math.min(200, safeInt(p['num'] ?? 50)));
    const maxPages = Math.max(1, Math.min(30, safeInt(p['max_pages'] ?? p['pages'] ?? 15)));
    const res = await this.client.getEmotionList(uin, pos, num, undefined, undefined, undefined, maxPages);
    if (res && typeof res === 'object') {
      ensureReadableTimeOnMsglist(res as Record<string, unknown>);
      const includeImageData = p['include_image_data'] !== false && p['include_image_data'] !== '0';
      if (includeImageData) {
        await this.enrichMsglistWithImageData(res as Record<string, unknown>, MAX_IMAGE_DATA_PER_POST, MAX_IMAGE_DATA_PER_RESPONSE);
      }
    }
    return ok(res, echo);
  }

  /** ic2 feeds_html_act_all；可选 feed_owner=单 QQ 封装（=hostuin，且 uin 默认同号，模拟「在该人空间页」） */
  async action_get_feeds_html_act_all(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const login = String(this.client.qqNumber ?? '').trim();
    if (!login) return fail(1401, '未登录', echo);
    const feedOwnerRaw = p['feed_owner'] ?? p['owner_qq'] ?? p['owner_uin'] ?? p['space_uin'] ?? p['qq'];
    const feedOwner = feedOwnerRaw != null && String(feedOwnerRaw).trim() !== '' ? String(feedOwnerRaw).trim() : '';

    let urlUin: string;
    let hostUin: string;
    if (feedOwner) {
      hostUin = feedOwner;
      const pageUin = String(p['user_id'] ?? p['uin'] ?? p['page_uin'] ?? '').trim();
      urlUin = pageUin || feedOwner;
    } else {
      urlUin = String(p['user_id'] ?? p['uin'] ?? '').trim() || login;
      const hostUinRaw = p['host_uin'] ?? p['hostuin'];
      hostUin = hostUinRaw != null && String(hostUinRaw).trim() !== '' ? String(hostUinRaw).trim() : login;
    }

    const start0 = Math.max(0, safeInt(p['start'] ?? 0));
    const count = Math.max(1, Math.min(50, safeInt(p['count'] ?? p['num'] ?? 10)));
    const scope = p['scope'] != null && p['scope'] !== '' ? safeInt(p['scope']) : undefined;
    const includeImageData = p['include_image_data'] === true || p['include_image_data'] === '1' || p['include_image_data'] === 'true';
    const includeRawSnippet = p['include_raw_snippet'] === true || p['include_raw_snippet'] === '1';
    const allPages = p['all_pages'] === true || p['all_pages'] === '1' || p['all_pages'] === 'true'
      || p['fetch_all'] === true || p['fetch_all'] === '1';
    const maxRounds = Math.max(1, Math.min(80, safeInt(p['max_rounds'] ?? p['max_pages'] ?? 30)));

    const clientOpts = {
      hostUin,
      count,
      scope,
      filter: p['filter'] != null ? String(p['filter']) : undefined,
      flag: p['flag'] != null ? String(p['flag']) : undefined,
      refresh: p['refresh'] != null ? String(p['refresh']) : undefined,
      refer: p['refer'] != null ? String(p['refer']) : undefined,
      includeRawSnippet,
    };

    if (!allPages) {
      const res = await this.client.getFeedsHtmlActAll(urlUin, { ...clientOpts, start: start0 });
      if (res && typeof res === 'object') {
        ensureReadableTimeOnMsglist(res as Record<string, unknown>);
        if (includeImageData) {
          await this.enrichMsglistWithImageData(res as Record<string, unknown>, MAX_IMAGE_DATA_PER_POST, MAX_IMAGE_DATA_PER_RESPONSE);
        }
      }
      return ok(res, echo);
    }

    /** 自动翻页：合并说说/分享等全部 appid，按 tid 去重，直到无更多或达 max_rounds */
    const merged: Record<string, unknown>[] = [];
    const seenTid = new Set<string>();
    let start = start0;
    let prevStart = -1;
    let lastHasMore = false;
    let truncated = false;
    let lastNextStart = start0;
    let rounds = 0;

    for (; rounds < maxRounds; rounds++) {
      if (start === prevStart) break;
      prevStart = start;
      const page = await this.client.getFeedsHtmlActAll(urlUin, { ...clientOpts, start });
      if (page['code'] != null && Number(page['code']) !== 0) {
        return ok(page, echo);
      }
      const list = (page['msglist'] as Record<string, unknown>[] | undefined) ?? [];
      lastHasMore = Boolean(page['has_more']);
      const ns = page['next_start'];
      lastNextStart = typeof ns === 'number' && Number.isFinite(ns) ? ns : start + count;

      for (const m of list) {
        const tid = String(m['tid'] ?? m['cellid'] ?? '').trim();
        if (tid) {
          if (seenTid.has(tid)) continue;
          seenTid.add(tid);
        }
        merged.push(m);
      }

      if (!lastHasMore) break;
      if (list.length === 0) break;
      const nextS = typeof page['next_start'] === 'number' && Number.isFinite(page['next_start'] as number)
        ? (page['next_start'] as number)
        : start + count;
      if (nextS <= start) break;
      start = nextS;
    }
    if (lastHasMore && rounds >= maxRounds) truncated = true;

    const res: Record<string, unknown> = {
      code: 0,
      message: 'ok',
      msglist: merged,
      has_more: truncated ? true : lastHasMore,
      next_start: truncated ? lastNextStart : undefined,
      _page_info: {
        source: 'feeds_html_act_all',
        all_pages: true,
        rounds,
        per_page_count: count,
        start_initial: start0,
        unique_items: merged.length,
        truncated_by_max_rounds: truncated,
        max_rounds: maxRounds,
        request_uin: urlUin,
        feed_owner_uin: hostUin,
        hostuin: hostUin,
        note: '合并多页 ic2 动态（含说说、音乐分享等），不按 appid 过滤；受 max_rounds 与接口限制，未必是历史全部',
      },
    };
    ensureReadableTimeOnMsglist(res);
    if (includeImageData && merged.length > 0) {
      await this.enrichMsglistWithImageData(res, MAX_IMAGE_DATA_PER_POST, MAX_IMAGE_DATA_PER_RESPONSE);
    }
    return ok(res, echo);
  }

  async action_get_comment_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tidRaw = String(p['tid'] ?? '');
    if (!tidRaw) return fail(1400, '缺少 tid', echo);
    const tid = this.client.resolveTidForComments(tidRaw);
    let uin = p['user_id'] !== undefined && p['user_id'] !== '' ? String(p['user_id']) : '';
    if (!uin) {
      const meta = this.client.getPostMeta(tid);
      if (meta) uin = meta.uin;
    }
    if (!uin) uin = this.client.qqNumber!;
    const num = safeInt(p['num'] ?? 20);
    const pos = safeInt(p['pos'] ?? 0);
    const fastMode = !['0', 'false', 'no'].includes(String(p['fast_mode'] ?? '1').toLowerCase());
    log('INFO', `get_comment_list: tidRaw=${tidRaw} -> tid=${tid} uin=${uin}`);
    const res = await this.client.getCommentsBestEffort(uin, tid, num, pos, { fastMode });
    const cnt = [res['commentlist'], res['comment_list'], res['comments'], res['data']].find(Array.isArray) as unknown[] | undefined;
    log('INFO', `get_comment_list: code=${(res as Record<string, unknown>)['code']} comments=${cnt?.length ?? 0}`);
    return ok(res, echo);
  }

  async action_get_like_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tidRaw = String(p['tid'] ?? '');
    if (!tidRaw) return fail(1400, '缺少 tid', echo);
    const tid = this.client.resolveTidForComments(tidRaw);
    let uin = p['user_id'] !== undefined && p['user_id'] !== '' ? String(p['user_id']) : '';
    if (!uin) {
      const meta = this.client.getPostMeta(tid);
      if (meta) uin = meta.uin;
    }
    if (!uin) uin = this.client.qqNumber!;
    const list = await this.client.getLikeList(uin, tid);
    return ok(list, echo);
  }

  // ── user / social ──────────────────────────────
  async action_get_stranger_info(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['user_id'] ?? '');
    if (!uin) return fail(1400, '缺少 user_id', echo);
    const res = await this.client.getUserInfo(uin);
    return ok(res, echo);
  }

  async action_get_friend_list(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const res = await this.client.getFriendList();
    const rawItems = (res.data as { items?: Array<{ uin?: string; nickname?: string; avatar?: string; lastSeen?: number }> })?.items ?? [];
    // OneBot v11: [{ user_id, nickname, remark }]，remark 无则空；扩展 _source / avatar 供调试
    const items = rawItems.map((f: { uin?: string; nickname?: string; avatar?: string; lastSeen?: number }) => ({
      user_id: f.uin ?? '',
      nickname: f.nickname ?? '',
      remark: '',
      avatar: f.avatar ?? '',
      _source: (res.data as { source?: string })?.source,
    }));
    return ok({
      items,
      total: (res.data as { total?: number })?.total ?? 0,
      _source: (res.data as { source?: string })?.source ?? '',
    }, echo);
  }

  async action_get_visitor_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = p['user_id'] ? String(p['user_id']) : undefined;
    const res = await this.client.getVisitorList(uin);
    // 访客来源映射
    const sourceMap: Record<number, string> = { 1: '说说', 2: '日志', 3: '相册', 4: '留言板', 5: '个人中心', 6: '分享' };
    const dataObj = (res['data'] ?? res) as Record<string, unknown>;
    const items = dataObj['items'] ?? dataObj['list'] ?? [];
    if (Array.isArray(items)) {
      for (const it of items as Record<string, unknown>[]) {
        const src = Number(it['source'] ?? it['type'] ?? 0);
        (it as Record<string, unknown>)['_source_name'] = sourceMap[src] ?? '未知';
      }
    }
    return ok(res, echo);
  }

  // ── traffic / privacy / portrait ──────────────
  async action_get_traffic_data(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['user_id'] ?? p['uin'] ?? this.client.qqNumber!);
    const tid = String(p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 tid', echo);
    const data = await this.client.getTrafficData(uin, tid);
    return ok(data, echo);
  }

  async action_set_emotion_privacy(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const tid = String(p['tid'] ?? '');
    const privacy = String(p['privacy'] ?? 'private') as 'private' | 'public';
    if (!tid) return fail(1400, '缺少 tid', echo);
    const res = await this.client.setEmotionPrivacy(tid, privacy);
    return ok(res, echo);
  }

  async action_get_portrait(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['user_id'] ?? p['uin'] ?? '');
    if (!uin) return fail(1400, '缺少 user_id', echo);
    const data = await this.client.getPortrait(uin);
    return ok(data, echo);
  }

  // ── albums ─────────────────────────────────────
  async action_get_album_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = p['user_id'] ? String(p['user_id']) : undefined;
    const res = await this.client.getAlbumList(uin);
    return ok(res, echo);
  }

  async action_get_photo_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = p['user_id'] ? String(p['user_id']) : undefined;
    const albumId = String(p['album_id'] ?? p['topicId'] ?? '');
    const num = safeInt(p['num'] ?? 30);
    const res = await this.client.getPhotoList(uin, albumId, num);
    return ok(res, echo);
  }

  async action_create_album(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const name = String(p['name'] ?? '');
    const desc = String(p['desc'] ?? '');
    const priv = safeInt(p['priv'] ?? 1);
    if (!name) return fail(1400, '缺少 name', echo);
    const res = await this.client.createAlbum(name, desc, priv);
    return ok(res, echo);
  }

  async action_delete_album(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const albumId = String(p['album_id'] ?? '');
    if (!albumId) return fail(1400, '缺少 album_id', echo);
    return ok(await this.client.deleteAlbum(albumId), echo);
  }

  async action_delete_photo(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = p['user_id'] ? String(p['user_id']) : undefined;
    const albumId = String(p['album_id'] ?? '');
    const photoId = String(p['photo_id'] ?? p['lloc'] ?? '');
    return ok(await this.client.deletePhoto(uin, albumId, photoId), echo);
  }

  // ── upload ──────────────────────────────────────
  async action_upload_image(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    let b64 = String(p['base64'] ?? p['file'] ?? '');
    if (!b64 && p['url']) {
      if (!isSafeUrl(String(p['url']))) return fail(1403, 'URL 不安全', echo);
      b64 = await this.fetchImageBase64(String(p['url']));
    }
    if (!b64) return fail(1400, '缺少 base64 或 url', echo);
    b64 = this.normalizeAndValidateImageBase64(b64, String(p['url'] ?? p['file'] ?? 'upload_image'));
    const albumId = p['album_id'] ? String(p['album_id']) : undefined;
    const res = await this.client.uploadImage(b64, albumId);
    return ok(res, echo);
  }

  // ── login ───────────────────────────────────────
  async action_login_qr(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    // 手动触发 QR 重登（先 logout 再走二维码流程）
    this.client.logout();
    try {
      await this.client.loginWithPlaywright();
    } catch (e) {
      return fail(1500, `QR 登录失败: ${e}`, echo);
    }
    if (!this.client.loggedIn) return fail(1500, 'QR 登录未完成', echo);
    const uin = this.client.qqNumber!;
    const nickname = (await this.client.resolveLoginNickname(uin)) || 'QZone用户';
    return ok({ user_id: safeInt(uin), nickname }, echo);
  }

  async action_login_cookie(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    const cookieStr = String(p['cookie'] ?? p['cookie_string'] ?? '');
    if (!cookieStr) return fail(1400, '缺少 cookie', echo);
    await this.client.loginWithCookieString(cookieStr);
    const uin = this.client.qqNumber!;
    const nickname = (await this.client.resolveLoginNickname(uin)) || 'QZone用户';
    return ok({ user_id: safeInt(uin), nickname }, echo);
  }

  /** 更新 Cookie：传入与 login_cookie 相同格式的 cookie 字符串，覆盖当前会话并写回缓存/.env */
  async action_update_cookie(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    const cookieStr = String(p['cookie'] ?? p['cookie_string'] ?? '').trim();
    if (!cookieStr) return fail(1400, '缺少 cookie（请传入 cookie 或 cookie_string）', echo);
    try {
      await this.client.loginWithCookieString(cookieStr);
      this.client.syncCookieToEnvFile();
      const uin = this.client.qqNumber!;
      const nickname = (await this.client.resolveLoginNickname(uin)) || 'QZone用户';
      return ok({
        message: 'Cookie 已更新',
        user_id: safeInt(uin),
        nickname,
      }, echo);
    } catch (e) {
      return fail(1500, e instanceof Error ? e.message : String(e), echo);
    }
  }

  async action_logout(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    this.client.logout();
    return ok(null, echo);
  }

  async action_reset_api_caches(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    this.client.resetApiCaches();
    return ok(null, echo);
  }

  async action_probe_api_routes(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['uin'] ?? this.client.qqNumber!);
    const tid = String(p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 tid', echo);
    const routes = await this.client.probeApiRoutes(uin, tid);
    return ok(routes, echo);
  }

  async action_get_friend_feeds(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    // #region agent log
    const rawInc = p['include_image_data'];
    const includeImageData = rawInc !== false && rawInc !== '0';
    debugLog(this.config.cachePath, { location: 'actions.ts:action_get_friend_feeds', message: 'include_image_data param', data: { raw: rawInc, resolved: includeImageData, willEnrich: includeImageData }, timestamp: Date.now(), hypothesisId: 'H1' });
    // #endregion
    const cursor = typeof p['cursor'] === 'string' ? p['cursor'] : '';
    const num = Math.max(1, Math.min(200, safeInt(p['num'] ?? p['count'] ?? 50)));
    const fastMode = !['0', 'false', 'no'].includes(String(p['fast_mode'] ?? '1').toLowerCase());
    const res = await this.client.getFriendFeeds(cursor, num, { fastMode });
    if (includeImageData && res && typeof res === 'object') {
      await this.enrichMsglistWithImageData(res as Record<string, unknown>, MAX_IMAGE_DATA_PER_POST, MAX_IMAGE_DATA_PER_RESPONSE);
    }
    return ok(res, echo);
  }

  async action_fetch_image(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const url = typeof p['url'] === 'string' ? p['url'] : undefined;
    const urls = Array.isArray(p['urls']) ? (p['urls'] as unknown[]).filter((u): u is string => typeof u === 'string') : undefined;
    const list = url ? [url] : urls;
    if (!list || list.length === 0) return fail(1400, '缺少 url 或 urls', echo);
    for (const u of list) {
      if (!isQzoneImageUrl(u)) return fail(1403, '仅允许 QZone CDN 白名单 URL（qpic.cn、photo.store.qq.com、qzonestyle.gtimg.cn）', echo);
    }
    if (list.length === 1) {
      try {
        const { data, contentType } = await this.client.fetchImageWithAuth(list[0]!);
        return ok({ base64: data.toString('base64'), content_type: contentType }, echo);
      } catch (e) {
        return fail(1500, e instanceof Error ? e.message : String(e), echo);
      }
    }
    const images: Array<{ url: string; base64?: string; content_type?: string }> = [];
    for (const u of list) {
      try {
        const { data, contentType } = await this.client.fetchImageWithAuth(u);
        images.push({ url: u, base64: data.toString('base64'), content_type: contentType });
      } catch {
        images.push({ url: u });
      }
    }
    return ok({ images }, echo);
  }

  /** 为 msglist 中每条说说的 pic 附带 base64（仅白名单 URL），单条最多 maxPerPost 张，总 maxTotal 张 */
  private async enrichMsglistWithImageData(
    res: Record<string, unknown>,
    maxPerPost: number,
    maxTotal: number,
  ): Promise<void> {
    const msglist = res['msglist'] as Record<string, unknown>[] | undefined;
    const hasMsglist = Array.isArray(msglist);
    const msglistLen = hasMsglist ? msglist!.length : 0;
    const hasData = res['data'] != null;
    // #region agent log
    debugLog(this.config.cachePath, { location: 'actions.ts:enrichMsglistWithImageData', message: 'msglist source', data: { hasMsglist, msglistLen, hasData, keys: Object.keys(res).slice(0, 20) }, timestamp: Date.now(), hypothesisId: 'H3' });
    // #endregion
    if (!hasMsglist) return;
    let totalFetched = 0;
    let firstItemPicLogged = false;
    for (const item of msglist!) {
      if (totalFetched >= maxTotal) break;
      const pic = item['pic'] as Array<unknown> | undefined;
      const picArr = Array.isArray(pic) ? pic : [];
      if (!firstItemPicLogged && picArr.length > 0) {
        firstItemPicLogged = true;
        const firstUrl = getPicUrl(picArr[0]);
        const whitelist = firstUrl ? isQzoneImageUrl(firstUrl) : false;
        // #region agent log
        debugLog(this.config.cachePath, { location: 'actions.ts:enrichMsglistWithImageData', message: 'first item pic', data: { picLen: picArr.length, firstUrl: firstUrl ? firstUrl.slice(0, 80) : null, whitelist }, timestamp: Date.now(), hypothesisId: 'H2' });
        // #endregion
      }
      if (picArr.length === 0) continue;
      let perPost = 0;
      for (let i = 0; i < picArr.length && perPost < maxPerPost && totalFetched < maxTotal; i++) {
        const entry = picArr[i] as Record<string, unknown> | string;
        const url = getPicUrl(entry);
        if (!url || !isQzoneImageUrl(url)) continue;
        try {
          const { data, contentType } = await this.client.fetchImageWithAuth(url);
          const obj = typeof entry === 'object' && entry ? entry : { url };
          const b64 = data.toString('base64');
          (obj as Record<string, unknown>)['base64'] = b64;
          (obj as Record<string, unknown>)['content_type'] = contentType;
          perPost++;
          totalFetched++;
          // #region agent log
          if (totalFetched === 1) {
            debugLog(this.config.cachePath, { location: 'actions.ts:enrichMsglistWithImageData', message: 'first fetch ok', data: { totalFetched, base64Len: b64.length }, timestamp: Date.now(), hypothesisId: 'H2' });
          }
          // #endregion
        } catch (e) {
          // #region agent log
          debugLog(this.config.cachePath, { location: 'actions.ts:enrichMsglistWithImageData', message: 'fetchImageWithAuth failed', data: { url: url.slice(0, 90), err: String(e) }, timestamp: Date.now(), hypothesisId: 'H4' });
          // #endregion
        }
      }
    }
    // #region agent log
    let sampleBase64Len = 0;
    for (const item of msglist!) {
      const pic = item['pic'] as Array<unknown> | undefined;
      if (Array.isArray(pic) && pic.length > 0) {
        const first = pic[0];
        const b64 = typeof first === 'object' && first && (first as Record<string, unknown>)['base64'];
        if (typeof b64 === 'string') {
          sampleBase64Len = b64.length;
          break;
        }
      }
    }
    debugLog(this.config.cachePath, { location: 'actions.ts:enrichMsglistWithImageData', message: 'enrich done', data: { totalFetched, sampleBase64Len }, timestamp: Date.now(), hypothesisId: 'H3' });
    // #endregion
  }

  // ── util ─────────────────────────────────────────
  private fetchImageBase64(url: string): Promise<string> {
    return this.fetchImageBuffer(url).then(buffer => buffer.toString('base64'));
  }

  private async resolveImageBase64(source: string): Promise<string | null> {
    if (!source) return null;
    if (source.startsWith('base64://') || source.startsWith('data:')) {
      return this.normalizeAndValidateImageBase64(source, source.slice(0, 64));
    }
    if (isSafeUrl(source)) {
      return this.fetchImageBase64(source);
    }
    const localPath = this.resolveLocalImagePath(source);
    if (!localPath) return null;
    return this.normalizeAndValidateImageBuffer(fs.readFileSync(localPath), localPath).toString('base64');
  }

  private resolveLocalImagePath(source: string): string | null {
    let localSource = source;
    if (localSource.startsWith('file://')) {
      try {
        localSource = decodeURIComponent(new URL(localSource).pathname);
      } catch {
        return null;
      }
      if (/^\/[A-Za-z]:\//.test(localSource)) localSource = localSource.slice(1);
    }

    const candidates = [
      path.resolve(localSource),
      path.resolve(this.config.cachePath, localSource),
      path.resolve(this.config.cachePath, path.basename(localSource)),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  private async fetchImageBuffer(url: string): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= SEND_IMAGE_FETCH_RETRIES; attempt++) {
      try {
        const buffer = await new Promise<Buffer>((resolve, reject) => {
          const mod = url.startsWith('https') ? https : (require('node:http') as typeof https);
          const req = mod.get(url, { timeout: 15000 }, (res) => {
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              res.resume();
              return;
            }
            const contentLength = Number(res.headers['content-length'] ?? 0);
            if (contentLength > SEND_IMAGE_MAX_BYTES) {
              reject(new Error(`image too large: ${contentLength} bytes`));
              res.resume();
              return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            res.on('data', (chunk: Buffer) => {
              total += chunk.length;
              if (total > SEND_IMAGE_MAX_BYTES) {
                req.destroy(new Error(`image too large: ${total} bytes`));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          });
          req.on('timeout', () => req.destroy(new Error('image fetch timeout')));
          req.on('error', reject);
        });
        return this.normalizeAndValidateImageBuffer(buffer, url, false);
      } catch (error) {
        lastError = error;
        if (attempt >= SEND_IMAGE_FETCH_RETRIES) break;
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private normalizeAndValidateImageBase64(rawBase64: string, sourceLabel: string): string {
    const normalized = rawBase64.replace(/^base64:\/\//, '').replace(/^data:[^,]+,/, '');
    const buffer = Buffer.from(normalized, 'base64');
    return this.normalizeAndValidateImageBuffer(buffer, sourceLabel).toString('base64');
  }

  private normalizeAndValidateImageBuffer(buffer: Buffer, sourceLabel: string, cloneBuffer = true): Buffer {
    const normalized = cloneBuffer ? Buffer.from(buffer) : buffer;
    if (!normalized.length) throw new Error(`图片为空: ${sourceLabel}`);
    if (normalized.length > SEND_IMAGE_MAX_BYTES) {
      throw new Error(`图片过大(${normalized.length} bytes): ${sourceLabel}`);
    }
    if (!isSupportedImageBuffer(normalized)) {
      throw new Error(`不支持的图片格式: ${sourceLabel}`);
    }
    return normalized;
  }
}
