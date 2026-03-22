/**
 * feeds3 HTML 评论的 data-tid 常为帖内短序号（1、2、3），解析路径变化时同一物理评论可能对应不同字符串。
 * 在无法使用 PC/mobile JSON 评论接口时，用「非歧义 id 优先 + 内容指纹兜底」做稳定去重。
 */
import { createHash } from 'node:crypto';
import type { QzoneComment } from '../qzone/types.js';

/** 纯数字且偏短：视为楼层号，不作为全局稳定键 */
export function feeds3CommentIdIsAmbiguous(commentId: string): boolean {
  const s = commentId.trim();
  if (!s) return true;
  if (/^\d+$/.test(s)) return s.length <= 6;
  return false;
}

/**
 * 生成用于 seenCommentIds 的键；事件里的 comment_id 仍为原始值（供回复等场景）。
 */
export function buildFeedCommentDedupKey(tid: string, c: QzoneComment): string {
  const raw = c.commentId.trim();
  if (raw && !feeds3CommentIdIsAmbiguous(raw)) {
    return `id:${tid}:${raw}`;
  }
  const content = (c.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const basisParts = [
    tid,
    c.uin,
    String(c.createdTime),
    content,
    c.parentCommentId ?? '',
    c.replyToCommentId ?? '',
    c.replyToUin ?? '',
    c.isReply ? '1' : '0',
  ];
  if (c.createdTime <= 0 && c.feeds3ParseSeq != null) {
    basisParts.push(String(c.feeds3ParseSeq));
  }
  const basis = basisParts.join('\x1e');
  return `h:${tid}:${createHash('sha256').update(basis, 'utf8').digest('hex').slice(0, 32)}`;
}

export function commentDedupSeen(seen: Set<string>, tid: string, c: QzoneComment): boolean {
  if (!c.commentId) return true;
  if (seen.has(c.commentId)) return true;
  return seen.has(buildFeedCommentDedupKey(tid, c));
}

export function commentDedupMark(seen: Set<string>, tid: string, c: QzoneComment): void {
  seen.add(buildFeedCommentDedupKey(tid, c));
  if (c.commentId) seen.add(c.commentId);
}
