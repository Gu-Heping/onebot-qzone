import { QzoneClient } from '../qzone/client.js';
import type { BridgeConfig } from './config.js';
import { EventHub } from './hub.js';
import { safeInt } from './utils.js';
import { htmlUnescape, log } from '../qzone/utils.js';
import { env } from '../qzone/config/env.js';
import { AuthError, isQzoneError } from '../qzone/infra/errors.js';
import pLimit from 'p-limit';
import type {
  OneBotEvent, NormalizedItem, QzoneComment, QzoneLike,
} from '../qzone/types.js';

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────
function now(): number { return Math.floor(Date.now() / 1000); }

/**
 * 安全执行轮询回调：捕获异常并返回是否成功。
 * AuthError 会被上报为 statusOk=false 但不 throw。
 */
async function safePoll(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(`[Poller] ${label}: 认证失败 — ${err.message}`);
    } else if (isQzoneError(err)) {
      console.error(`[Poller] ${label}: ${err.name} — ${err.message}`);
    } else {
      console.error(`[Poller] ${label}: ${err}`);
    }
    return false;
  }
}

function makeLocalId(): string {
  // pseudo-incremental (non-persistent over restarts)
  return String(Date.now());
}

export function stripHtml(s: string): string {
  return htmlUnescape(s.replace(/<[^>]+>/g, ''));
}

export function extractImages(pics: unknown): string[] {
  if (!Array.isArray(pics)) return [];
  const urls: string[] = [];
  for (const p of pics) {
    if (typeof p === 'object' && p) {
      const obj = p as Record<string, unknown>;
      // 优先级: url2 → url3 → url1 → smallurl → url（参照 astrbot_plugin_qzone）
      let found = false;
      for (const key of ['url2', 'url3', 'url1', 'smallurl', 'url']) {
        const v = obj[key];
        if (typeof v === 'string' && v) { urls.push(v); found = true; break; }
      }
      if (!found) {
        // fallback: any string-valued url-like key
        for (const v of Object.values(obj)) {
          if (typeof v === 'string' && v.startsWith('http')) { urls.push(v); break; }
        }
      }
    } else if (typeof p === 'string') {
      urls.push(p);
    }
  }
  return urls;
}

/**
 * 从说说的 video 字段提取视频播放 URL（url3）和封面（url1/pic_url）。
 * 参照 astrbot_plugin_qzone parser.py 的视频提取逻辑。
 */
export function extractVideos(raw: Record<string, unknown>): { videoUrls: string[]; videoCoverUrls: string[] } {
  const videoUrls: string[] = [];
  const videoCoverUrls: string[] = [];
  const videos = raw['video'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(videos)) return { videoUrls, videoCoverUrls };
  for (const v of videos) {
    const playUrl = String(v['url3'] ?? v['video_url'] ?? v['url'] ?? '');
    if (playUrl) videoUrls.push(playUrl);
    const coverUrl = String(v['url1'] ?? v['pic_url'] ?? v['cover'] ?? '');
    if (coverUrl) videoCoverUrls.push(coverUrl);
  }
  return { videoUrls, videoCoverUrls };
}

// ─────────────────────────────────────────────────────────
/**
 * 从 conlist 重建内容文本。
 * conlist 是 QZone API 的富文本数组：
 *   type 0: @某人 (有 uin/nick 属性)
 *   type 1: 纯文本
 *   type 2: 含表情的文本 (如 "[em]e10271[/em]")
 */
export function rebuildContentFromConlist(conlist: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const item of conlist) {
    const type = Number(item['type'] ?? -1);
    if (type === 0) {
      // @人
      const nick = String(item['nick'] ?? item['name'] ?? '');
      parts.push(`@${nick}`);
    } else {
      // type 1 (text) / type 2 (text with emoji) / others
      const con = String(item['con'] ?? item['content'] ?? '');
      if (con) parts.push(con);
    }
  }
  return stripHtml(parts.join(''));
}

// NormalizedItem builder
// ─────────────────────────────────────────────────────────
export function normalizeEmotion(raw: Record<string, unknown>, selfUin: string): NormalizedItem {
  const tid = String(raw['tid'] ?? raw['cellid'] ?? '');
  const uin = String(raw['uin'] ?? raw['frienduin'] ?? selfUin);
  const nickname = stripHtml(String(raw['nickname'] ?? raw['name'] ?? ''));

  // 内容提取：优先 content 字段，fallback 到 conlist 重建
  let content = stripHtml(String(
    raw['content'] ?? raw['con'] ?? raw['cellcontent'] ?? '',
  ));
  // 当 content 为空但 conlist 存在时，从 conlist 重建内容文本
  if (!content && Array.isArray(raw['conlist'])) {
    content = rebuildContentFromConlist(raw['conlist'] as Array<Record<string, unknown>>);
  }

  const createdTime = safeInt(raw['createTime'] ?? raw['created_time'] ?? raw['ctime'] ?? raw['pubtime'] ?? 0);
  const cmtnum = safeInt(raw['cmtnum'] ?? raw['commentcnt'] ?? 0);
  const fwdnum = safeInt(raw['fwdnum'] ?? raw['forwardcnt'] ?? 0);
  const pics: string[] = extractImages(raw['pic'] ?? raw['media'] ?? []);

  // 视频提取
  const { videoUrls, videoCoverUrls } = extractVideos(raw);
  // 视频封面也加入图片列表（如果没有重复）
  for (const cover of videoCoverUrls) {
    if (!pics.includes(cover)) pics.push(cover);
  }

  // 转发字段：rt_tid / rt_uin / rt_uinname / rt_con 是独立顶层字段
  // 也兼容旧的 rt_con 作为嵌套对象的情况
  let forwardContent: string | undefined;
  let forwardUin: string | undefined;
  let forwardTid: string | undefined;
  let forwardNickname: string | undefined;

  const rtTid = raw['rt_tid'];
  const rtUin = raw['rt_uin'];
  const rtCon = raw['rt_con'];

  if (typeof rtTid === 'string' && rtTid) {
    // 独立顶层字段形式
    forwardTid = rtTid;
    forwardUin = String(rtUin ?? '');
    forwardNickname = String(raw['rt_uinname'] ?? '');
    if (typeof rtCon === 'string') {
      forwardContent = stripHtml(rtCon);
    } else if (typeof rtCon === 'object' && rtCon) {
      const rc = rtCon as Record<string, unknown>;
      forwardContent = stripHtml(String(rc['content'] ?? rc['con'] ?? ''));
    }
  } else if (typeof rtCon === 'object' && rtCon) {
    // 旧的嵌套对象形式
    const rc = rtCon as Record<string, unknown>;
    forwardContent = stripHtml(String(rc['content'] ?? rc['con'] ?? ''));
    forwardUin = String(rc['uin'] ?? '');
    forwardTid = String(rc['tid'] ?? '');
  }

  return {
    tid, uin, nickname, content, createdTime, cmtnum, fwdnum, pics,
    videos: videoUrls, forwardContent, forwardUin, forwardTid, forwardNickname,
  };
}

function normalizeComment(raw: Record<string, unknown>): QzoneComment {
  const commentId = String(raw['commentid'] ?? raw['comment_id'] ?? raw['id'] ?? '');
  const uin = String(raw['uin'] ?? raw['commentuin'] ?? '');
  const nickname = stripHtml(String(raw['name'] ?? raw['nick'] ?? ''));
  const content = stripHtml(String(raw['content'] ?? raw['con'] ?? ''));
  const createdTime = safeInt(raw['createtime'] ?? raw['create_time'] ?? raw['time'] ?? 0);
  return { commentId, uin, nickname, content, createdTime };
}

function normalizeLike(raw: Record<string, unknown>): QzoneLike {
  const uin = String(raw['uin'] ?? raw['fuin'] ?? '');
  const nickname = stripHtml(String(raw['name'] ?? raw['nick'] ?? ''));
  const createdTime = safeInt(raw['time'] ?? raw['likeTime'] ?? 0);
  return { uin, nickname, createdTime };
}

// ─────────────────────────────────────────────────────────
// OneBotEvent builders
// ─────────────────────────────────────────────────────────
function buildPostEvent(item: NormalizedItem, selfId: string): OneBotEvent {
  const segments: Record<string, unknown>[] = [];
  if (item.content) segments.push({ type: 'text', data: { text: item.content } });
  // 转发内容作为额外文本段
  if (item.forwardContent) {
    const fwdPrefix = item.forwardNickname ? `[转发自 ${item.forwardNickname}] ` : '[转发] ';
    segments.push({ type: 'text', data: { text: `\n${fwdPrefix}${item.forwardContent}` } });
  }
  for (const url of item.pics) segments.push({ type: 'image', data: { url } });
  if (item.videos) {
    for (const url of item.videos) segments.push({ type: 'video', data: { url } });
  }

  return {
    time: item.createdTime || now(),
    self_id: safeInt(selfId),
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: safeInt(item.tid) || safeInt(makeLocalId()),
    user_id: safeInt(item.uin),
    message: segments,
    raw_message: item.content,
    font: 0,
    sender: { user_id: safeInt(item.uin), nickname: item.nickname },
    // extra
    _tid: item.tid,
    _uin: item.uin,
    _cmtnum: item.cmtnum,
    _fwdnum: item.fwdnum,
    _pics: item.pics,
    _videos: item.videos ?? [],
    _forward_content: item.forwardContent,
    _forward_uin: item.forwardUin,
    _forward_tid: item.forwardTid,
    _forward_nickname: item.forwardNickname,
  };
}

function buildCommentEvent(comment: QzoneComment, postUin: string, postTid: string, selfId: string): OneBotEvent {
  return {
    time: comment.createdTime || now(),
    self_id: safeInt(selfId),
    post_type: 'notice',
    notice_type: 'qzone_comment',
    user_id: safeInt(comment.uin),
    sender_name: comment.nickname,
    comment_id: comment.commentId,
    comment_content: comment.content,
    post_uin: safeInt(postUin),
    post_tid: postTid,
  };
}

function buildLikeEvent(like: QzoneLike, postUin: string, postTid: string, selfId: string): OneBotEvent {
  return {
    time: like.createdTime || now(),
    self_id: safeInt(selfId),
    post_type: 'notice',
    notice_type: 'qzone_like',
    user_id: safeInt(like.uin),
    sender_name: like.nickname,
    post_uin: safeInt(postUin),
    post_tid: postTid,
  };
}

function buildHeartbeatEvent(selfId: string, status: Record<string, unknown>): OneBotEvent {
  return {
    time: now(),
    self_id: safeInt(selfId),
    post_type: 'meta_event',
    meta_event_type: 'heartbeat',
    status,
    interval: 30000,
  };
}

// ─────────────────────────────────────────────────────────
// EventPoller
// ─────────────────────────────────────────────────────────
export class EventPoller {
  private running = false;
  private mainTimer: ReturnType<typeof setTimeout> | null = null;
  private commentTimer: ReturnType<typeof setTimeout> | null = null;
  private likeTimer: ReturnType<typeof setTimeout> | null = null;
  private friendFeedTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seenPostTids = new Set<string>();
  private seenCommentIds = new Map<string, Set<string>>();  // tid → commentIds
  private seenLikeUins = new Map<string, Set<string>>();    // tid → uins
  private trackTids: Set<string> = new Set();
  private knownCounts = new Map<string, { comment: number; like: number }>();  // tid → counts from qz_opcnt2
  /** emotionList 内嵌评论缓存：tid → raw comment records（每次 pollMyPosts 刷新） */
  private emotionComments = new Map<string, Record<string, unknown>[]>();
  private lastError = 0;
  private backoff = 0;
  private statusOk = false;

  // ── 初始化标志：首次轮询只做数据种子，不发射事件 ──
  private postsInitialized = false;
  private friendFeedsInitialized = false;

  // ── 评论详情 API circuit breaker ──
  private commentDetailFailCount = 0;
  private commentDetailNextRetry = 0;  // epoch seconds
  private static readonly DETAIL_FAIL_THRESHOLD = 2;
  private static readonly DETAIL_COOLDOWN = 1800;  // 30 min

  constructor(
    private readonly client: QzoneClient,
    private readonly hub: EventHub,
    private readonly config: BridgeConfig,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // add seeded tids
    for (const tid of this.hub.getSeedTids()) this.trackTids.add(tid);

    // 主轮询：我的说说
    this.scheduleMain(0);
    // 独立评论轮询
    this.scheduleComments(this.config.commentPollInterval * 1000);
    // 独立点赞轮询
    this.scheduleLikes(this.config.likePollInterval * 1000);
    // 独立好友动态轮询
    this.scheduleFriendFeeds(this.config.friendFeedPollInterval * 1000);
    // 心跳
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), 30_000);
    // Cookie 保活（每 600 秒，参照 OpenCamwall）
    this.keepaliveTimer = setInterval(() => this.keepaliveCookie(), 600_000);
  }

  stop(): void {
    this.running = false;
    if (this.mainTimer) { clearTimeout(this.mainTimer); this.mainTimer = null; }
    if (this.commentTimer) { clearTimeout(this.commentTimer); this.commentTimer = null; }
    if (this.likeTimer) { clearTimeout(this.likeTimer); this.likeTimer = null; }
    if (this.friendFeedTimer) { clearTimeout(this.friendFeedTimer); this.friendFeedTimer = null; }
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  // ── 独立定时器调度 ──────────────────────────────

  private scheduleMain(delayMs: number): void {
    if (!this.running) return;
    this.mainTimer = setTimeout(async () => {
      const ok = await safePoll('main', () => this.pollMyPosts());
      if (ok) {
        this.statusOk = true;
        this.backoff = 0;
      } else {
        this.statusOk = false;
        this.lastError = now();
        this.backoff = Math.min((this.backoff || 30) * 2, 300);
      }
      this.scheduleMain(this.backoff > 0 ? this.backoff * 1000 : this.config.pollInterval * 1000);
    }, delayMs);
  }

  private scheduleComments(delayMs: number): void {
    if (!this.running || !this.config.emitCommentEvents) return;
    this.commentTimer = setTimeout(async () => {
      // 等待主轮询初始化完成（trackTids 填充后再开始评论轮询）
      if (this.client.loggedIn && this.postsInitialized && this.trackTids.size > 0) {
        const selfId = this.client.qqNumber!;
        const limit = pLimit(3);
        await Promise.all([...this.trackTids].map(tid =>
          limit(() => safePoll(`comments/${tid.slice(0, 8)}`, () => this.pollComments(selfId, tid))),
        ));
      }
      this.scheduleComments(this.config.commentPollInterval * 1000);
    }, delayMs);
  }

  private scheduleLikes(delayMs: number): void {
    if (!this.running || !this.config.emitLikeEvents) return;
    this.likeTimer = setTimeout(async () => {
      // 等待主轮询初始化完成
      if (this.client.loggedIn && this.postsInitialized && this.trackTids.size > 0) {
        const selfId = this.client.qqNumber!;
        const limit = pLimit(3);
        await Promise.all([...this.trackTids].map(tid =>
          limit(() => safePoll(`likes/${tid.slice(0, 8)}`, () => this.pollLikes(selfId, tid))),
        ));
      }
      this.scheduleLikes(this.config.likePollInterval * 1000);
    }, delayMs);
  }

  private scheduleFriendFeeds(delayMs: number): void {
    if (!this.running || !this.config.emitFriendFeedEvents) return;
    this.friendFeedTimer = setTimeout(async () => {
      if (this.client.loggedIn) {
        await safePoll('friendFeeds', () => this.pollFriendFeeds());
      }
      this.scheduleFriendFeeds(this.config.friendFeedPollInterval * 1000);
    }, delayMs);
  }

  // ── Cookie 保活 & 自动重登 ──────────────────────────────
  private reloginLock = false;
  private keepaliveFailCount = 0;
  private static readonly KEEPALIVE_FAIL_THRESHOLD = 3;
  /** 静默续期间隔（秒），默认 4h */
  private static readonly REFRESH_INTERVAL = 4 * 3600;

  private async keepaliveCookie(): Promise<void> {
    if (!this.running || !this.client.loggedIn) return;

    // ── 定期静默续期 ──
    // 每隔 REFRESH_INTERVAL，用 headless Playwright 刷新 Cookie（不弹窗、不扫码）
    const secSinceRefresh = this.client.secondsSinceLastRefresh;
    if (secSinceRefresh >= EventPoller.REFRESH_INTERVAL) {
      console.error(`[Poller] 距上次续期 ${Math.round(secSinceRefresh)}s，触发静默续期...`);
      try {
        const ok = await this.client.refreshSession();
        if (ok) {
          console.error(`[Poller] ✓ 静默续期成功 — Cookie 已刷新，.env 已同步，下次续期 ${EventPoller.REFRESH_INTERVAL}s 后`);
          this.keepaliveFailCount = 0;
          return;
        }
        console.error('[Poller] ✗ 静默续期失败（Cookie 可能已过期），将走探针校验');
      } catch (err) {
        console.error('[Poller] ✗ 静默续期异常:', err);
      }
    }

    // ── 常规探针校验 ──
    try {
      const valid = await this.client.validateSession();
      if (valid) {
        this.keepaliveFailCount = 0;
        return;
      }
      this.keepaliveFailCount++;
      console.error(
        `[Poller] Cookie keepalive: probe failed (${this.keepaliveFailCount}/${EventPoller.KEEPALIVE_FAIL_THRESHOLD})`,
      );
      if (this.keepaliveFailCount >= EventPoller.KEEPALIVE_FAIL_THRESHOLD) {
        console.error('[Poller] Consecutive failures hit threshold, attempting re-login...');
        this.statusOk = false;
        this.keepaliveFailCount = 0;
        await this.attemptRelogin();
      }
    } catch (err) {
      console.error('[Poller] Cookie keepalive error:', err);
    }
  }

  /**
   * 自动重登录。优先级：
   * 1. 静默续期（headless Playwright，无需扫码）
   * 2. 环境变量 Cookie
   * 3. Playwright QR 扫码
   * 4. ptlogin 协议 QR 扫码
   */
  async attemptRelogin(): Promise<boolean> {
    if (this.reloginLock) {
      console.error('[Poller] re-login already in progress, skipping');
      return false;
    }
    this.reloginLock = true;
    try {
      // 方法 1: 静默续期（不 logout，保留现有 Cookie 让 Playwright 刷新）
      console.error('[Poller] 尝试静默续期（不弹窗）...');
      try {
        const refreshOk = await this.client.refreshSession();
        if (refreshOk) {
          const valid = await this.client.validateSession();
          if (valid) {
            console.error(`[Poller] 静默续期成功，QQ号: ${this.client.qqNumber}`);
            this.statusOk = true;
            return true;
          }
        }
      } catch (e) {
        console.error('[Poller] 静默续期失败:', e);
      }

      // 方法 2: 环境变量 Cookie
      const cookieStr = env.cookieString;
      if (cookieStr) {
        console.error('[Poller] 尝试使用环境变量 Cookie 重新登录...');
        try {
          this.client.logout();
          await this.client.loginWithCookieString(cookieStr);
          if (this.client.loggedIn) {
            const valid = await this.client.validateSession();
            if (valid) {
              console.error(`[Poller] 环境变量 Cookie 重登成功，QQ号: ${this.client.qqNumber}`);
              this.statusOk = true;
              return true;
            }
          }
        } catch (e) {
          console.error('[Poller] 环境变量 Cookie 重登失败:', e);
        }
      }

      // 方法 3: Playwright QR 扫码（最后手段）
      this.client.logout();
      console.error('[Poller] 启动 Playwright 浏览器重新登录...');
      await this.client.loginWithPlaywright();
      if (this.client.loggedIn) {
        console.error(`[Poller] 重新登录成功，QQ号: ${this.client.qqNumber}`);
        this.statusOk = true;
        return true;
      }
      console.error('[Poller] 重新登录失败');
      return false;
    } catch (err) {
      console.error('[Poller] re-login error:', err);
      return false;
    } finally {
      this.reloginLock = false;
    }
  }

  // ── 各轮询任务 ──────────────────────────────

  private async pollMyPosts(): Promise<void> {
    if (!this.client.loggedIn) return;
    const selfId = this.client.qqNumber!;

    if (!this.config.emitMessageEvents) return;

    const source = this.config.eventPollSource;
    let items: NormalizedItem[] = [];

    let rawMsglist: Record<string, unknown>[] = [];

    if (source === 'mobile' || source === 'auto') {
      try {
        const res = await this.client.getMobileMoodList(selfId, 0, 20);
        rawMsglist = Array.isArray(res['data'])
          ? (res['data'] as Record<string, unknown>[])
          : Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
        items = rawMsglist.map(r => normalizeEmotion(r, selfId));
      } catch { /* try pc */ }
    }

    if ((source === 'pc' || (source === 'auto' && items.length === 0))) {
      try {
        const res = await this.client.getEmotionList(selfId, 0, 20);
        rawMsglist = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
        items = rawMsglist.map(r => normalizeEmotion(r, selfId));
      } catch { /* skip */ }
    }

    // 从 emotion list 响应中提取内嵌评论（零额外请求）
    this.emotionComments.clear();
    for (const msg of rawMsglist) {
      const tid = String(msg['tid'] ?? '');
      if (!tid) continue;
      const cl = msg['commentlist'] ?? msg['comment_list'];
      if (Array.isArray(cl) && cl.length > 0) {
        this.emotionComments.set(tid, cl as Record<string, unknown>[]);
      }
    }

    // 补充 feeds3 HTML 中解析出的评论（零额外请求 — HTML 已在 getEmotionList 中获取）
    for (const [tid, cmts] of this.client.feeds3Comments) {
      if (!this.emotionComments.has(tid) && cmts.length > 0) {
        this.emotionComments.set(tid, cmts);
      }
    }
    if (this.client.feeds3Comments.size > 0) {
      log('DEBUG', `[Poller] feeds3 内嵌评论: ${this.client.feeds3Comments.size} 条说说有评论`);
    }

    for (const item of items) {
      if (!item.tid) continue;
      if (!this.seenPostTids.has(item.tid)) {
        this.seenPostTids.add(item.tid);
        this.trackTids.add(item.tid);
        // 首次轮询只做数据种子，不发射事件（避免启动洪水）
        if (this.postsInitialized) {
          const event = buildPostEvent(item, selfId);
          await this.hub.publish(event);
          log('INFO', `[Poller] ✦ 新说说: tid=${item.tid.slice(0, 12)}… by ${item.uin} "${(item.content || '').slice(0, 30)}"`);
        }
      }
    }

    if (!this.postsInitialized) {
      this.postsInitialized = true;
      log('INFO', `[Poller] 说说监听初始化完成: 已缓存 ${this.seenPostTids.size} 条，跟踪 ${this.trackTids.size} 个TID`);
    }

    this._pruneTrackingDicts(items.map(i => i.tid).filter((t): t is string => t !== null));
  }

  private async pollFriendFeeds(): Promise<void> {
    if (!this.client.loggedIn) return;
    const selfId = this.client.qqNumber!;
    try {
      const res = await this.client.getFriendFeeds(20);
      const raw = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
      for (const r of raw) {
        const item = normalizeEmotion(r, String(r['uin'] ?? ''));
        if (!item.tid || !item.uin) continue;
        const key = `${item.uin}_${item.tid}`;
        if (!this.seenPostTids.has(key)) {
          this.seenPostTids.add(key);
          // 首次轮询只做数据种子，不发射事件
          if (this.friendFeedsInitialized) {
            const event = buildPostEvent(item, selfId);
            (event as Record<string, unknown>)['_from_friend'] = true;
            await this.hub.publish(event);
            log('INFO', `[Poller] ✦ 好友动态: tid=${item.tid.slice(0, 12)}… by ${item.uin} "${(item.content || '').slice(0, 30)}"`);
          }
        }
      }
      if (!this.friendFeedsInitialized) {
        this.friendFeedsInitialized = true;
        log('INFO', `[Poller] 好友动态监听初始化完成: 已缓存 ${raw.length} 条`);
      }
    } catch (err) {
      log('WARNING', `[Poller] 好友动态轮询失败: ${err}`);
    }
  }

  /**
   * 评论检测 — 三级策略
   *
   * 1. qz_opcnt2 计数检测（1 次请求，可靠）
   * 2. 计数变化时，优先从 emotionComments 缓存取详情（0 额外请求）
   * 3. 缓存缺失时，getCommentsLite 单次 POST（circuit breaker 保护）
   * 4. 全不可用时，发射纯计数事件
   */
  private async pollComments(selfUin: string, tid: string): Promise<void> {
    // 1. qz_opcnt2 计数检测（低成本、可靠）
    let delta = 0;
    try {
      const traffic = await this.client.getTrafficData(selfUin, tid);
      const count = traffic.comment;
      if (count < 0) return; // qz_opcnt2 无数据

      const prev = this.knownCounts.get(tid);
      if (!prev) {
        this.knownCounts.set(tid, { comment: count, like: traffic.like });
        log('DEBUG', `[Poller] 计数初始化: tid=${tid.slice(0, 12)}… comment=${count} like=${traffic.like}`);
        return;
      }

      delta = count - prev.comment;
      prev.comment = count;
      if (delta <= 0) return;
      log('INFO', `[Poller] 评论计数变化 +${delta}: tid=${tid.slice(0, 12)}…`);
    } catch (err) {
      log('DEBUG', `[Poller] qz_opcnt2 评论检测失败 tid=${tid.slice(0, 12)}…: ${err}`);
      return;
    }

    // 2. 优先从 emotionComments 缓存提取详情（含 feeds3 HTML 解析结果，零额外请求）
    const cached = this.emotionComments.get(tid);
    if (cached && cached.length > 0) {
      const emitted = await this._emitNewComments(cached, tid, selfUin, delta);
      if (emitted > 0) {
        const src = (cached[0] as Record<string, unknown>)?.['_source'] === 'feeds3_html' ? 'feeds3' : 'emotion缓存';
        log('INFO', `[Poller] ✦ 新评论(${src}): tid=${tid.slice(0, 12)}… +${emitted}`);
        return;
      }
    }

    // 3. 缓存缺失 — getCommentsLite 单次 POST（circuit breaker 保护）
    if (this.commentDetailNextRetry <= now()) {
      try {
        const res = await this.client.getCommentsLite(selfUin, tid, 50);
        const rawComments = this._extractRawComments(res);
        if (rawComments.length > 0) {
          this.commentDetailFailCount = 0;
          const emitted = await this._emitNewComments(rawComments, tid, selfUin, delta);
          if (emitted > 0) {
            log('INFO', `[Poller] ✦ 新评论(lite): tid=${tid.slice(0, 12)}… +${emitted}`);
            return;
          }
        }
      } catch { /* lite API failed */ }
      this.commentDetailFailCount++;
      if (this.commentDetailFailCount >= EventPoller.DETAIL_FAIL_THRESHOLD) {
        this.commentDetailNextRetry = now() + EventPoller.DETAIL_COOLDOWN;
        log('WARNING', `[Poller] 评论详情API连续${this.commentDetailFailCount}次失败，切换纯计数模式（${EventPoller.DETAIL_COOLDOWN / 60}分钟后重试）`);
      }
    }

    // 4. 详情不可用 — 发射计数事件
    const capped = Math.min(delta, 10);
    for (let i = 0; i < capped; i++) {
      const event = buildCommentEvent(
        { commentId: `opcnt_${Date.now()}_${i}`, uin: '', nickname: '', content: '', createdTime: now() },
        selfUin, tid, selfUin,
      );
      await this.hub.publish(event);
    }
    log('INFO', `[Poller] ✦ 新评论(计数): tid=${tid.slice(0, 12)}… +${delta}`);
  }

  /** 从 API 响应提取原始评论数组 */
  private _extractRawComments(res: Record<string, unknown>): Record<string, unknown>[] {
    for (const key of ['commentlist', 'comment_list', 'data', 'comments']) {
      const v = res[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
    return [];
  }

  /** 去重并发射新评论事件，返回实际发射数 */
  private async _emitNewComments(
    rawComments: Record<string, unknown>[], tid: string, selfUin: string, maxEmit: number,
  ): Promise<number> {
    if (!this.seenCommentIds.has(tid)) this.seenCommentIds.set(tid, new Set());
    const seen = this.seenCommentIds.get(tid)!;
    const comments = rawComments.map(r => normalizeComment(r)).filter(c => c.commentId);
    comments.sort((a, b) => b.createdTime - a.createdTime);
    let emitted = 0;
    for (const comment of comments) {
      if (seen.has(comment.commentId)) continue;
      seen.add(comment.commentId);
      if (emitted < maxEmit) {
        const event = buildCommentEvent(comment, selfUin, tid, selfUin);
        await this.hub.publish(event);
        log('INFO', `[Poller] ✦ 新评论: tid=${tid.slice(0, 12)}… by ${comment.uin} "${(comment.content || '').slice(0, 30)}"`);
        emitted++;
      }
    }
    return emitted;
  }

  /**
   * 点赞检测 — 纯 qz_opcnt2 计数模式
   *
   * 旧链路: getLikeList → getShuoshuoDetail (15+ 变体) → 全失败 → qz_opcnt2
   * 新链路: qz_opcnt2 (1 次) → 直接发射计数事件
   *
   * getLikeList 依赖 getShuoshuoDetail 提取 like 数组，后者的 PC/Mobile 端点
   * 目前全部返回 -10000 或 404，不再浪费请求。
   */
  private async pollLikes(selfUin: string, tid: string): Promise<void> {
    try {
      const traffic = await this.client.getTrafficData(selfUin, tid);
      const count = traffic.like;
      if (count < 0) return;

      const prev = this.knownCounts.get(tid);
      if (!prev) {
        this.knownCounts.set(tid, { comment: traffic.comment, like: count });
        return;
      }

      const delta = count - prev.like;
      prev.like = count;
      if (delta <= 0) return;

      const capped = Math.min(delta, 10);
      for (let i = 0; i < capped; i++) {
        const event = buildLikeEvent(
          { uin: '', nickname: '', createdTime: now() },
          selfUin, tid, selfUin,
        );
        await this.hub.publish(event);
      }
      log('INFO', `[Poller] ✦ 新点赞(计数): tid=${tid.slice(0, 12)}… +${delta}`);
    } catch (err) {
      log('DEBUG', `[Poller] 点赞计数检测失败 tid=${tid.slice(0, 12)}…: ${err}`);
    }
  }

  private _pruneTrackingDicts(recentTids: string[], max = 100): void {
    if (this.trackTids.size <= max) return;
    const toKeep = new Set<string>([...recentTids]);
    for (const tid of [...this.trackTids].reverse()) {
      if (toKeep.size >= max) break;
      toKeep.add(tid);
    }
    for (const tid of [...this.trackTids]) {
      if (!toKeep.has(tid)) {
        this.trackTids.delete(tid);
        this.seenCommentIds.delete(tid);
        this.seenLikeUins.delete(tid);
      }
    }
  }

  private emitHeartbeat(): void {
    if (!this.running) return;
    const selfId = this.client.loggedIn ? safeInt(this.client.qqNumber!) : 0;
    const event = buildHeartbeatEvent(String(selfId), { online: this.statusOk, good: this.statusOk });
    this.hub.publish(event).catch(() => { /* ignore */ });
  }

  getStatus(): Record<string, unknown> {
    return { online: this.statusOk, good: this.statusOk, last_error: this.lastError };
  }
}
