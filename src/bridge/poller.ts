import { QzoneClient } from '../qzone/client.js';
import type { BridgeConfig } from './config.js';
import { EventHub } from './hub.js';
import { safeInt } from './utils.js';
import { htmlUnescape } from '../qzone/utils.js';
import { env } from '../qzone/config/env.js';
import { AuthError, isQzoneError } from '../qzone/infra/errors.js';
import pLimit from 'p-limit';
import type {
  OneBotEvent, NormalizedItem, QzoneComment, QzoneLike,
} from '../qzone/types.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

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

  const appid = String(raw['appid'] ?? '');
  const typeid = String(raw['typeid'] ?? '');
  const appName = String(raw['appName'] ?? '');
  const appShareTitle = String(raw['appShareTitle'] ?? '');
  let likeUnikey = String(raw['likeUnikey'] ?? '');
  let likeCurkey = String(raw['likeCurkey'] ?? '');

  // 预计算 likeUnikey / likeCurkey（若解析阶段未提取到）
  if (!likeUnikey) {
    if (typeid === '5' && forwardUin && forwardTid) {
      // 转发帖：unikey = 原帖 URL，curkey = 转发帖 URL（抓包验证）
      likeUnikey = `http://user.qzone.qq.com/${forwardUin}/mood/${forwardTid}`;
      likeCurkey = `http://user.qzone.qq.com/${uin}/mood/${tid}`;
    } else if (appid === '311' || appid === '') {
      // 普通说说：unikey = curkey = mood URL
      likeUnikey = `http://user.qzone.qq.com/${uin}/mood/${tid}`;
      likeCurkey = likeUnikey;
    }
    // app 分享（appid=202 等）的 likeUnikey 由 feeds3Parser 提取，若未提取到则留空
  }

  return {
    tid, uin, nickname, content, createdTime, cmtnum, fwdnum, pics,
    videos: videoUrls, forwardContent, forwardUin, forwardTid, forwardNickname,
    appid, typeid, appName, appShareTitle, likeUnikey, likeCurkey,
  };
}

function normalizeComment(raw: Record<string, unknown>): QzoneComment {
  const commentId = String(raw['commentid'] ?? raw['comment_id'] ?? raw['id'] ?? '');
  const uin = String(raw['uin'] ?? raw['commentuin'] ?? '');
  const nickname = stripHtml(String(raw['name'] ?? raw['nick'] ?? ''));
  const content = stripHtml(String(raw['content'] ?? raw['con'] ?? ''));
  const createdTime = safeInt(raw['createtime'] ?? raw['create_time'] ?? raw['time'] ?? 0);
  const isReply = !!(raw['is_reply'] ?? raw['isReply']);
  const replyToUin = raw['reply_to_uin'] != null ? String(raw['reply_to_uin']) : (raw['replyToUin'] != null ? String(raw['replyToUin']) : undefined);
  const replyToNickname = raw['reply_to_nickname'] != null ? stripHtml(String(raw['reply_to_nickname'])) : (raw['replyToNickname'] != null ? stripHtml(String(raw['replyToNickname'])) : undefined);
  const replyToCommentId = raw['reply_to_comment_id'] != null ? String(raw['reply_to_comment_id']) : (raw['replyToCommentId'] != null ? String(raw['replyToCommentId']) : undefined);
  const parentCommentId = raw['parent_comment_id'] != null ? String(raw['parent_comment_id']) : (raw['parentCommentId'] != null ? String(raw['parentCommentId']) : undefined);
  return {
    commentId, uin, nickname, content, createdTime,
    ...(isReply && { isReply: true }),
    ...(replyToUin && { replyToUin }),
    ...(replyToNickname && { replyToNickname }),
    ...(replyToCommentId && { replyToCommentId }),
    ...(parentCommentId && { parentCommentId }),
  };
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
/** 已知 appid → 中文名映射（appid 来自 feeds3 HTML）*/
const APPID_LABELS: Record<string, string> = {
  '311':  '说说',
  '2':    '相册',
  '4':    '转发',
  '202':  '网易云音乐',
  '217':  '点赞记录',
  '2160': 'QQ音乐',
  '268':  'QQ音乐',
  '3168': '哔哩哔哩',
};

function buildPostEvent(item: NormalizedItem, selfId: string): OneBotEvent {
  const segments: Record<string, unknown>[] = [];

  // 第三方应用分享：前缀标签
  const appLabel = item.appid && item.appid !== '311'
    ? (APPID_LABELS[item.appid] ?? item.appName ?? `App(${item.appid})`)
    : '';

  if (appLabel) segments.push({ type: 'text', data: { text: `[${appLabel}] ` } });
  if (item.content) segments.push({ type: 'text', data: { text: item.content } });
  // 应用分享标题（歌曲名/视频标题等），仅当与 content 不同时附加
  if (item.appShareTitle && item.appShareTitle !== item.content) {
    segments.push({ type: 'text', data: { text: item.content ? `\n${item.appShareTitle}` : item.appShareTitle } });
  }
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
    _abstime: item.createdTime,
    _cmtnum: item.cmtnum,
    _fwdnum: item.fwdnum,
    _pics: item.pics,
    _videos: item.videos ?? [],
    _forward_content: item.forwardContent,
    _forward_uin: item.forwardUin,
    _forward_tid: item.forwardTid,
    _forward_nickname: item.forwardNickname,
    _appid: item.appid ?? '',
    _typeid: item.typeid ?? '',
    _app_name: item.appName ?? '',
    _app_share_title: item.appShareTitle ?? '',
    _like_unikey: item.likeUnikey ?? '',
    _like_curkey: item.likeCurkey ?? '',
  };
}

function buildCommentEvent(comment: QzoneComment, postUin: string, postTid: string, selfId: string): OneBotEvent {
  const ev: OneBotEvent = {
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
  if (comment.isReply) ev._is_reply = true;
  if (comment.replyToUin) ev._reply_to_uin = comment.replyToUin;
  if (comment.replyToNickname) ev._reply_to_nickname = comment.replyToNickname;
  if (comment.parentCommentId) ev._parent_comment_id = comment.parentCommentId;
  return ev;
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
  private lastError = 0;
  private backoff = 0;
  private statusOk = false;
  private seenTidsDirty = false;
  private seenTidsSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: QzoneClient,
    private readonly hub: EventHub,
    private readonly config: BridgeConfig,
  ) {}

  private get seenTidsFile(): string {
    return join(this.config.cachePath, 'seen_post_tids.json');
  }

  private loadSeenTids(): void {
    try {
      mkdirSync(this.config.cachePath, { recursive: true });
      const raw = readFileSync(this.seenTidsFile, 'utf-8');
      const arr = JSON.parse(raw) as string[];
      for (const t of arr) this.seenPostTids.add(t);
    } catch { /* 首次运行或文件不存在，忽略 */ }
  }

  private saveSeenTids(): void {
    try {
      // 最多保留最近 2000 条，防止无限增长
      const arr = [...this.seenPostTids].slice(-2000);
      writeFileSync(this.seenTidsFile, JSON.stringify(arr), 'utf-8');
    } catch { /* 忽略写入错误 */ }
    this.seenTidsDirty = false;
  }

  private markSeenTid(tid: string): void {
    this.seenPostTids.add(tid);
    this.seenTidsDirty = true;
    // 防抖：5 秒后批量写入
    if (!this.seenTidsSaveTimer) {
      this.seenTidsSaveTimer = setTimeout(() => {
        this.seenTidsSaveTimer = null;
        if (this.seenTidsDirty) this.saveSeenTids();
      }, 5000);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // 加载持久化的已见 tid，防止重启后重复推送
    this.loadSeenTids();
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
      if (this.client.loggedIn) {
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
      if (this.client.loggedIn) {
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
            const valid = await this.client.validateSession(true);
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

    if (source === 'mobile' || source === 'auto') {
      try {
        const res = await this.client.getMobileMoodList(selfId, 0, 20);
        const raw = Array.isArray(res['data'])
          ? (res['data'] as Record<string, unknown>[])
          : Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
        items = raw.map(r => normalizeEmotion(r, selfId));
      } catch { /* try pc */ }
    }

    if ((source === 'pc' || (source === 'auto' && items.length === 0))) {
      try {
        const res = await this.client.getEmotionList(selfId, 0, 20);
        const raw = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
        items = raw.map(r => normalizeEmotion(r, selfId));
      } catch { /* skip */ }
    }

    for (const item of items) {
      if (!item.tid) continue;
      this.cacheNormalizedItem(item);
      if (!this.seenPostTids.has(item.tid)) {
        this.markSeenTid(item.tid);
        this.trackTids.add(item.tid);
        const event = buildPostEvent(item, selfId);
        await this.hub.publish(event);
      }
    }

    this._pruneTrackingDicts(items.map(i => i.tid).filter((t): t is string => t !== null));
  }

  private async pollFriendFeeds(): Promise<void> {
    if (!this.client.loggedIn) return;
    const selfId = this.client.qqNumber!;
    try {
      const res = await this.client.getFriendFeeds('', 20);
      const raw = Array.isArray(res['msglist']) ? (res['msglist'] as Record<string, unknown>[]) : [];
      for (const r of raw) {
        const item = normalizeEmotion(r, String(r['uin'] ?? ''));
        if (!item.tid || !item.uin) continue;
        this.cacheNormalizedItem(item);
        const key = `${item.uin}_${item.tid}`;
        if (!this.seenPostTids.has(key)) {
          this.markSeenTid(key);
          const event = buildPostEvent(item, selfId);
          (event as Record<string, unknown>)['_from_friend'] = true;
          await this.hub.publish(event);
        }
      }
    } catch { /* skip */ }
  }

  private cacheNormalizedItem(item: NormalizedItem): void {
    if (!item.tid) return;
    this.client.cachePostMeta(item.tid, {
      uin: item.uin ?? '',
      appid: item.appid ?? '311',
      typeid: item.typeid ?? '0',
      likeUnikey: item.likeUnikey ?? '',
      likeCurkey: item.likeCurkey ?? '',
      abstime: item.createdTime,
    });
  }

  private async pollComments(selfUin: string, tid: string): Promise<void> {
    const res = await this.client.getCommentsBestEffort(selfUin, tid, 50, 0);
    const rawComments: Record<string, unknown>[] = [];

    for (const key of ['commentlist', 'comment_list', 'data', 'comments']) {
      const v = res[key];
      if (Array.isArray(v)) { rawComments.push(...(v as Record<string, unknown>[])); break; }
    }

    if (rawComments.length > 0) {
      for (const raw of rawComments) {
        const comment = normalizeComment(raw);
        if (!comment.commentId) continue;
        if (!this.seenCommentIds.has(tid)) this.seenCommentIds.set(tid, new Set());
        if (!this.seenCommentIds.get(tid)!.has(comment.commentId)) {
          this.seenCommentIds.get(tid)!.add(comment.commentId);
          const event = buildCommentEvent(comment, selfUin, tid, selfUin);
          await this.hub.publish(event);
        }
      }
    } else {
      await this.pollCountsDelta(selfUin, tid, 'comment');
    }
  }

  private async pollLikes(selfUin: string, tid: string): Promise<void> {
    const rawLikes = await this.client.getLikeList(selfUin, tid);
    if (rawLikes.length > 0) {
      for (const raw of rawLikes) {
        const like = normalizeLike(raw);
        if (!like.uin) continue;
        if (!this.seenLikeUins.has(tid)) this.seenLikeUins.set(tid, new Set());
        if (!this.seenLikeUins.get(tid)!.has(like.uin)) {
          this.seenLikeUins.get(tid)!.add(like.uin);
          const event = buildLikeEvent(like, selfUin, tid, selfUin);
          await this.hub.publish(event);
        }
      }
    } else {
      await this.pollCountsDelta(selfUin, tid, 'like');
    }
  }

  private async pollCountsDelta(selfUin: string, tid: string, type: 'comment' | 'like'): Promise<void> {
    try {
      const traffic = await this.client.getTrafficData(selfUin, tid);
      const count = type === 'comment' ? traffic.comment : traffic.like;
      if (count < 0) return;

      const prev = this.knownCounts.get(tid);
      if (!prev) {
        this.knownCounts.set(tid, { comment: traffic.comment, like: traffic.like });
        return;
      }

      const prevCount = type === 'comment' ? prev.comment : prev.like;
      const delta = count - prevCount;

      if (delta > 0) {
        if (type === 'comment') {
          prev.comment = count;
          for (let i = 0; i < delta; i++) {
            const event = buildCommentEvent(
              { commentId: `opcnt_${Date.now()}_${i}`, uin: '', nickname: '', content: '', createdTime: now() },
              selfUin, tid, selfUin,
            );
            await this.hub.publish(event);
          }
        } else {
          prev.like = count;
          for (let i = 0; i < delta; i++) {
            const event = buildLikeEvent(
              { uin: '', nickname: '', createdTime: now() },
              selfUin, tid, selfUin,
            );
            await this.hub.publish(event);
          }
        }
      } else {
        if (type === 'comment') prev.comment = count;
        else prev.like = count;
      }
    } catch { /* qz_opcnt2 also failed, skip */ }
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
