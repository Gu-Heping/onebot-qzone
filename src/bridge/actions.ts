import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { QzoneClient } from '../qzone/client.js';
import type { BridgeConfig } from './config.js';
import type { EventHub } from './hub.js';
import type { EventPoller } from './poller.js';
import { safeInt } from './utils.js';
import type { OneBotResponse } from '../qzone/types.js';

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
    let nickname = this.client.getNicknameFromCookie();
    if (!nickname) {
      try {
        const portrait = await this.client.getPortrait(this.client.qqNumber!);
        nickname = portrait.nickname;
      } catch { /* ignore */ }
    }
    return ok({ user_id: safeInt(this.client.qqNumber!), nickname: nickname || 'QZone用户' }, echo);
  }

  async action_get_status(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    const pollerStatus = this.poller.getStatus();
    return ok({
      online: this.client.loggedIn && (pollerStatus['online'] as boolean ?? false),
      good: this.client.loggedIn,
      ...pollerStatus,
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
    const images: string[] = [];
    for (const seg of segs) {
      if (seg.type === 'text') text += seg.data['text'] ?? '';
      else if (seg.type === 'image') {
        const url = seg.data['url'] ?? seg.data['file'] ?? '';
        if (url.startsWith('base64://') || url.startsWith('data:')) images.push(url.replace(/^base64:\/\//, '').replace(/^data:[^,]+,/, ''));
        else if (isSafeUrl(url)) images.push(await this.fetchImageBase64(url));
        else if (url && !url.startsWith('http')) {
          // local file path
          const safePath = path.resolve(this.config.cachePath, path.basename(url));
          if (fs.existsSync(safePath)) images.push(fs.readFileSync(safePath, 'base64'));
        }
      }
    }

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
    const ouin = String(p['user_id'] ?? '');
    const tid = String(p['tid'] ?? '');
    if (!ouin || !tid) return fail(1400, '缺少 user_id 或 tid', echo);
    const abstime = safeInt(p['abstime'] ?? 0);
    const res = await this.client.likeEmotion(ouin, tid, abstime);
    return (res as Record<string, unknown>)['code'] != null && (res as Record<string, unknown>)['code'] !== 0
      ? fail(1500, String((res as Record<string, unknown>)['message'] ?? ''), echo)
      : ok(null, echo);
  }

  async action_unlike(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const ouin = String(p['user_id'] ?? '');
    const tid = String(p['tid'] ?? '');
    if (!ouin || !tid) return fail(1400, '缺少 user_id 或 tid', echo);
    const abstime = safeInt(p['abstime'] ?? 0);
    const res = await this.client.unlikeEmotion(ouin, tid, abstime);
    return (res as Record<string, unknown>)['code'] === 0 || (res as Record<string, unknown>)['ret'] === 0
      ? ok(null, echo) : fail(1500, String((res as Record<string, unknown>)['message'] ?? ''), echo);
  }

  // ── comment ───────────────────────────────────
  async action_send_comment(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const ouin = String(p['target_uin'] ?? p['user_id'] ?? '');
    const tid = String(p['target_tid'] ?? p['tid'] ?? '');
    const content = String(p['content'] ?? '');
    if (!ouin || !tid || !content) return fail(1400, '缺少 target_uin / target_tid / content', echo);
    const replyId = p['reply_comment_id'] ? String(p['reply_comment_id']) : undefined;
    const replyUin = p['reply_uin'] ? String(p['reply_uin']) : undefined;
    const res = await this.client.commentEmotion(ouin, tid, content, replyId, replyUin);
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
    const uin = String(p['uin'] ?? '');
    const tid = String(p['tid'] ?? '');
    const commentId = String(p['comment_id'] ?? '');
    if (!uin || !tid || !commentId) return fail(1400, '缺少 uin / tid / comment_id', echo);
    const res = await this.client.deleteComment(uin, tid, commentId);
    return (res as Record<string, unknown>)['code'] === 0
      ? ok(null, echo) : fail(1500, String((res as Record<string, unknown>)['message'] ?? ''), echo);
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

  async action_get_emotion_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = p['user_id'] ? String(p['user_id']) : this.client.qqNumber!;
    const pos = safeInt(p['pos'] ?? 0);
    const num = safeInt(p['num'] ?? 20);
    const res = await this.client.getEmotionList(uin, pos, num);
    return ok(res, echo);
  }

  async action_get_comment_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['user_id'] ?? this.client.qqNumber!);
    const tid = String(p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 tid', echo);
    const num = safeInt(p['num'] ?? 20);
    const pos = safeInt(p['pos'] ?? 0);
    const res = await this.client.getCommentsBestEffort(uin, tid, num, pos);
    return ok(res, echo);
  }

  async action_get_like_list(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const uin = String(p['user_id'] ?? this.client.qqNumber!);
    const tid = String(p['tid'] ?? '');
    if (!tid) return fail(1400, '缺少 tid', echo);
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
    b64 = b64.replace(/^base64:\/\//, '').replace(/^data:[^,]+,/, '');
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
    let nickname = this.client.getNicknameFromCookie();
    if (!nickname) {
      try {
        const portrait = await this.client.getPortrait(this.client.qqNumber!);
        nickname = portrait.nickname;
      } catch { /* ignore */ }
    }
    return ok({ user_id: safeInt(this.client.qqNumber!), nickname: nickname || 'QZone用户' }, echo);
  }

  async action_login_cookie(p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    const cookieStr = String(p['cookie'] ?? p['cookie_string'] ?? '');
    if (!cookieStr) return fail(1400, '缺少 cookie', echo);
    await this.client.loginWithCookieString(cookieStr);
    let nickname = this.client.getNicknameFromCookie();
    if (!nickname) {
      try {
        const portrait = await this.client.getPortrait(this.client.qqNumber!);
        nickname = portrait.nickname;
      } catch { /* ignore */ }
    }
    return ok({ user_id: safeInt(this.client.qqNumber!), nickname: nickname || 'QZone用户' }, echo);
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

  async action_get_friend_feeds(_p: Record<string, unknown>, echo?: string): Promise<OneBotResponse> {
    if (!this.client.loggedIn) return fail(1401, '未登录', echo);
    const res = await this.client.getFriendFeeds(20);
    return ok(res, echo);
  }

  // ── util ─────────────────────────────────────────
  private fetchImageBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : (require('node:http') as typeof https);
      mod.get(url, { timeout: 15000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}
