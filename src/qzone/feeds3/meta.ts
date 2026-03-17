/**
 * feeds3 说说正文和元数据提取
 */

import { preprocessHtml } from './preprocess.js';

/** 单条说说的元数据（正文、浏览次数、点赞数等） */
export interface PostMeta {
  tid: string;
  uin: string;
  content: string;
  views: number;
  likeCount: number;
  commentCount: number;
  createTime?: number;
  _source: 'feeds3_html';
}

/**
 * 从 feeds3 HTML 中提取说说正文和元数据。
 * 支持单条说说格式和流格式。
 */
export function parseFeeds3PostMeta(
  text: string,
  processedText?: string,
): Map<string, PostMeta> {
  const result = new Map<string, PostMeta>();
  const html = processedText ?? preprocessHtml(text).text;

  const tidPattern = /t1_tid=([a-z0-9]+)/g;
  const tidPositions: { tid: string; index: number }[] = [];
  let tm: RegExpExecArray | null;

  while ((tm = tidPattern.exec(html)) !== null) {
    if (!tidPositions.some(t => t.tid === tm![1])) {
      tidPositions.push({ tid: tm[1], index: tm.index });
    }
  }

  for (let i = 0; i < tidPositions.length; i++) {
    const { tid } = tidPositions[i];
    const startIdx = tidPositions[i].index;
    const endIdx = i < tidPositions.length - 1 ? tidPositions[i + 1].index : html.length;
    const block = html.slice(startIdx, endIdx);

    const uinMatch = block.match(/t1_uin=(\d+)/);
    const uin = uinMatch?.[1] ?? '';

    let content = '';
    const fInfoMatch = block.match(/class="f-info[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (fInfoMatch) {
      content = fInfoMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (!content) {
      const preMatch = block.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
      if (preMatch) {
        content = preMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    let views = 0;
    const viewMatch = block.match(/浏览\s*(\d+)\s*次/);
    if (viewMatch) views = parseInt(viewMatch[1], 10);

    let likeCount = 0;
    const likeCntMatch = block.match(/class="f-like-cnt"[^>]*>(\d+)</)
      || block.match(/\\x3C[^>]*f-like-cnt[^>]*>(\d+)\\x3C/i);
    if (likeCntMatch) likeCount = parseInt(likeCntMatch[1], 10);

    let commentCount = 0;
    const cmtMatch = block.match(/cmtnum[=:]\s*["']?(\d+)/i);
    if (cmtMatch) commentCount = parseInt(cmtMatch[1], 10);

    let createTime: number | undefined;
    const abstimeMatch = block.match(/data-abstime="(\d+)"/);
    if (abstimeMatch) createTime = parseInt(abstimeMatch[1], 10);

    if (content || views > 0 || likeCount > 0) {
      result.set(tid, {
        tid,
        uin,
        content,
        views,
        likeCount,
        commentCount,
        createTime,
        _source: 'feeds3_html',
      });
    }
  }

  return result;
}
