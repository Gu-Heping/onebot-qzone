/**
 * feeds3 点赞提取
 */

import { log, htmlUnescape } from '../utils.js';
import { preprocessHtml } from './preprocess.js';

/** feeds3 HTML 中解析出来的单条点赞 */
export interface Feeds3Like {
  uin: string;
  nickname: string;
  tid: string;
  ownerUin: string;
  abstime: number;
  customItemId: string;
  _source: 'feeds3_html';
}

function parseSinglePostLikes(
  html: string,
  tid: string,
  ownerUin: string,
): Feeds3Like[] {
  const likes: Feeds3Like[] = [];
  const userListMatch = html.match(/class="user-list"[^>]*>([\s\S]*?)<\/div>/i);
  if (!userListMatch) return likes;

  const userListHtml = userListMatch[1];
  const linkPattern = /<a[^>]*href="http:\/\/user\.qzone\.qq\.com\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;

  while ((m = linkPattern.exec(userListHtml)) !== null) {
    const uin = m[1];
    const innerHtml = m[2];
    const nickname = htmlUnescape(innerHtml.replace(/<[^>]+>/g, '').replace(/、/g, '').trim());

    if (uin && nickname) {
      likes.push({
        uin,
        nickname,
        tid,
        ownerUin,
        abstime: 0,
        customItemId: '',
        _source: 'feeds3_html',
      });
    }
  }

  return likes;
}

/**
 * 从 feeds3 HTML 中提取点赞详情。
 */
export function parseFeeds3Likes(
  text: string,
  processedText?: string,
): Map<string, Feeds3Like[]> {
  const result = new Map<string, Feeds3Like[]>();
  const html = processedText ?? preprocessHtml(text).text;

  const tidPattern = /t1_tid=([a-z0-9]+)/g;
  const tidPositions: { tid: string; index: number }[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = tidPattern.exec(html)) !== null) {
    tidPositions.push({ tid: tm[1], index: tm.index });
  }

  for (let i = 0; i < tidPositions.length; i++) {
    const { tid } = tidPositions[i];
    const startIdx = tidPositions[i].index;
    const endIdx = i < tidPositions.length - 1 ? tidPositions[i + 1].index : html.length;
    const block = html.slice(startIdx, endIdx);

    if (block.includes('user-list')) {
      const ownerMatch = block.match(/t1_uin=(\d+)/);
      const ownerUin = ownerMatch?.[1] ?? '';
      const likes = parseSinglePostLikes(block, tid, ownerUin);
      if (likes.length > 0) result.set(tid, likes);
    }
  }

  const feedItemPat = /<div\s+class="f-item[^"]*f-item-passive"\s+id="feed_(\d+)_(\d+)_(\d+)_(\d+)_\d+_\d+"[\s\S]*?name="feed_data"\s*([^>]*)>[\s\S]*?(?=<div\s+class="f-item|<\/ul>|$)/g;
  const dataAttr = (attrs: string, name: string): string => {
    const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`));
    return m?.[1] ?? '';
  };

  let fm: RegExpExecArray | null;
  while ((fm = feedItemPat.exec(html)) !== null) {
    const feedDataAttrs = fm[5]!;
    const feedstype = dataAttr(feedDataAttrs, 'feedstype');
    if (feedstype !== '101') continue;

    const likerUin = fm[1]!;
    const tid = dataAttr(feedDataAttrs, 'tid');
    const ownerUin = dataAttr(feedDataAttrs, 'uin');
    const abstime = parseInt(dataAttr(feedDataAttrs, 'abstime') || '0', 10);
    if (!tid || !likerUin || likerUin === '0') continue;

    const blockStart = Math.max(0, fm.index - 600);
    const preceding = html.substring(blockStart, fm.index);
    let nickname = '';
    const nickMatch = preceding.match(/link="nameCard_\d+"[^>]*>([^<]+)<\/a>/);
    if (nickMatch) nickname = htmlUnescape(nickMatch[1]!.trim());

    const blockContent = fm[0];
    const customMatch = blockContent.match(/data-custom_itemid="(\d+)"/);
    const customItemId = customMatch?.[1] ?? '';

    const like: Feeds3Like = {
      uin: likerUin,
      nickname,
      tid,
      ownerUin,
      abstime,
      customItemId,
      _source: 'feeds3_html',
    };

    if (!result.has(tid)) result.set(tid, []);
    const existing = result.get(tid)!.find(l => l.uin === likerUin);
    if (!existing) result.get(tid)!.push(like);
  }

  for (const [tid, likes] of result) {
    const byUin = new Map<string, Feeds3Like>();
    for (const like of likes) {
      const existing = byUin.get(like.uin);
      if (!existing || like.abstime > existing.abstime) byUin.set(like.uin, like);
    }
    result.set(tid, [...byUin.values()]);
  }

  const total = [...result.values()].reduce((s, a) => s + a.length, 0);
  log('DEBUG', `parseFeeds3Likes: found ${total} likes for ${result.size} posts`);
  return result;
}
