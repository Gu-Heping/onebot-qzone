/**
 * feeds3 辅助解析（Mention、Video、Reply、Device、好友、翻页参数）
 */

import { log, htmlUnescape, parseJsonp } from '../utils.js';
import { processEmojis, parseEmojis } from '../emoji.js';
import type { EmojiInfo } from '../types.js';

/** 解析艾特格式 @{} */
export interface Mention {
  uin: string;
  nick: string;
  who: number;
  auto: number;
}

export function parseMentions(
  content: string,
  options: { processEmojis?: boolean } = { processEmojis: true }
): { text: string; mentions: Mention[] } {
  const mentions: Mention[] = [];
  const mentionPattern = /@\{uin:(\d+),nick:([^,]+),who:(\d+),auto:(\d+)\}/g;

  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(content)) !== null) {
    mentions.push({
      uin: match[1],
      nick: match[2],
      who: parseInt(match[3], 10),
      auto: parseInt(match[4], 10),
    });
  }

  let text = content.replace(mentionPattern, '').trim();
  if (options.processEmojis) {
    text = processEmojis(text, { mode: 'name' });
  }

  return { text, mentions };
}

/** 视频信息结构 */
export interface VideoInfo {
  videoId: string;
  coverUrl: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  duration: number;
  width: number;
  height: number;
}

export function extractVideos(raw: Record<string, unknown>): VideoInfo[] {
  const videos: VideoInfo[] = [];
  const videoList = raw['video'] as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(videoList)) return videos;

  for (const v of videoList) {
    if (!v['video_id']) continue;

    videos.push({
      videoId: String(v['video_id']),
      coverUrl: String(v['pic_url'] || ''),
      thumbnailUrl: v['url1'] as string | undefined,
      videoUrl: v['url3'] as string | undefined,
      duration: parseInt(String(v['video_time'] || '0'), 10),
      width: parseInt(String(v['cover_width'] || '0'), 10),
      height: parseInt(String(v['cover_height'] || '0'), 10),
    });
  }

  return videos;
}

/** 二级回复结构 */
export interface ReplyComment {
  commentid: string;
  uin: string;
  name: string;
  content: string;
  createtime: number;
  mentions: Mention[];
  reply_to_mention?: Mention;
  _source: 'reply_list';
}

export function parseReplyComments(
  list3: Array<Record<string, unknown>>,
  parentCommentId: string,
): ReplyComment[] {
  const replies: ReplyComment[] = [];

  for (const item of list3) {
    const rawContent = String(item['content'] || '');
    const { text: content, mentions } = parseMentions(rawContent);
    const { emojis } = parseEmojis(rawContent);
    const replyToMention = mentions.length > 0 ? mentions[0] : undefined;

    const reply: ReplyComment = {
      commentid: `${parentCommentId}_r_${item['tid']}`,
      uin: String(item['uin'] || ''),
      name: String(item['name'] || ''),
      content,
      createtime: parseInt(String(item['create_time'] || '0'), 10),
      mentions,
      reply_to_mention: replyToMention,
      _source: 'reply_list',
      ...(emojis.length > 0 && { emojis }),
    };

    replies.push(reply);
  }

  return replies;
}

/** 增强的评论结构（feeds3 专用） */
export interface EnhancedComment {
  commentid: string;
  uin: string;
  name: string;
  content: string;
  createtime: number;
  createTime: string;
  createTime2: string;
  reply_num: number;
  replies?: ReplyComment[];
  mentions?: Mention[];
  source_name?: string;
  source_url?: string;
  t2_source?: number;
  t2_subtype?: number;
  t2_termtype?: number;
  abledel?: number;
  private?: number;
  _source: 'h5_json' | 'feeds3_html';
  emojis?: EmojiInfo[];
}

export function parseEnhancedComment(raw: Record<string, unknown>): EnhancedComment {
  const rawContent = String(raw['content'] || '');
  const { text: content, mentions } = parseMentions(rawContent);
  const { emojis } = parseEmojis(rawContent);

  const comment: EnhancedComment = {
    commentid: String(raw['tid'] || ''),
    uin: String(raw['uin'] || ''),
    name: String(raw['name'] || ''),
    content,
    createtime: parseInt(String(raw['create_time'] || '0'), 10),
    createTime: String(raw['createTime'] || ''),
    createTime2: String(raw['createTime2'] || ''),
    reply_num: parseInt(String(raw['reply_num'] || '0'), 10),
    mentions: mentions.length > 0 ? mentions : undefined,
    source_name: raw['source_name'] as string | undefined,
    source_url: raw['source_url'] as string | undefined,
    t2_source: raw['t2_source'] as number | undefined,
    t2_subtype: raw['t2_subtype'] as number | undefined,
    t2_termtype: raw['t2_termtype'] as number | undefined,
    abledel: raw['abledel'] as number | undefined,
    private: raw['private'] as number | undefined,
    _source: 'h5_json',
    emojis: emojis.length > 0 ? emojis : undefined,
  };

  const list3 = raw['list_3'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(list3) && list3.length > 0) {
    comment.replies = parseReplyComments(list3, comment.commentid);
  }

  return comment;
}

/** 设备信息 */
export interface DeviceInfo {
  name: string;
  url?: string;
  termtype?: number;
}

export function extractDeviceInfo(raw: Record<string, unknown>): DeviceInfo | undefined {
  const name = raw['source_name'] as string;
  if (!name) return undefined;

  return {
    name,
    url: raw['source_url'] as string | undefined,
    termtype: raw['t1_termtype'] as number | undefined,
  };
}

/**
 * 从 feeds3 HTML 文本中提取好友 UIN / 昵称 / 头像。
 */
export function extractFriendsFromFeeds3FromText(
  text: string,
  selfUin: string,
): Array<{ uin: string; nickname: string; avatar: string }> {
  const byUin = new Map<string, { uin: string; nickname: string; avatar: string }>();

  const opuinRe = /\bopuin:'(\d+)'/g;
  let m: RegExpExecArray | null;
  while ((m = opuinRe.exec(text)) !== null) {
    const opuin = m[1]!;
    if (opuin === '0') continue;
    const start = m.index;
    const nextOpuin = text.indexOf("opuin:'", start + 1);
    const end = nextOpuin >= 0 ? nextOpuin : text.length;
    const block = text.slice(start, end);
    const uinM = block.match(/\buin:'(\d+)'/);
    const uin = uinM ? uinM[1]! : opuin;
    const nickM = block.match(/\bnickname:'((?:[^'\\]|\\.)*)'/);
    const nickname = nickM ? nickM[1]!.replace(/\\'/g, "'") : '';
    const logM = block.match(/\blogimg:'((?:[^'\\]|\\.)*)'/);
    const avatar = logM ? logM[1]!.replace(/\\'/g, "'") : '';
    if (!byUin.has(uin)) {
      byUin.set(uin, { uin, nickname, avatar });
    } else {
      const cur = byUin.get(uin)!;
      if (nickname) cur.nickname = nickname;
      if (avatar) cur.avatar = avatar;
    }
  }

  const fNickRe = /<div\s+class="f-nick"[^>]*>[\s\S]*?<a[^>]+href="[^"]*\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = fNickRe.exec(text)) !== null) {
    const uin = m[1]!;
    let nickname = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
    nickname = htmlUnescape(nickname);
    if (!uin || uin === '0') continue;
    if (!byUin.has(uin)) {
      byUin.set(uin, { uin, nickname, avatar: '' });
    } else {
      const cur = byUin.get(uin)!;
      if (nickname && !cur.nickname) cur.nickname = nickname;
    }
  }

  const list = Array.from(byUin.values()).filter((f) => f.uin !== selfUin);
  log('DEBUG', `extractFriendsFromFeeds3FromText: ${list.length} friends (excluded self ${selfUin})`);
  return list;
}

/** 从 feeds3 响应中提取 externparam 翻页参数 */
export function extractExternparam(text: string): string {
  try {
    const o = (text.trim().startsWith('{') ? JSON.parse(text) : parseJsonp(text)) as Record<string, unknown>;
    const data = o?.data as Record<string, unknown> | undefined;
    const main = data?.main as Record<string, unknown> | undefined;
    const v = (main?.externparam ?? data?.externparam ?? o?.externparam) as string | undefined;
    if (typeof v === 'string' && v.length > 0) return v;
  } catch {
    //
  }
  const m = text.match(/externparam:'([^']+)'/);
  if (m) return m[1]!;
  const m2 = text.match(/"externparam"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m2) return m2[1]!.replace(/\\"/g, '"');
  return '';
}
