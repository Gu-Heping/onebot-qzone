/**
 * feeds3 说说列表解析（parseFeeds3Items）
 * 依赖 preprocess、content
 */

import fs from 'node:fs';
import path from 'node:path';
import { log, htmlUnescape } from '../utils.js';
import { preprocessHtml } from './preprocess.js';
import { extractFeedContentFromHtml } from './content.js';

// #region agent log
const DEBUG_LOG_PATH = path.join(process.cwd(), '.cursor', 'debug.log');
function debugIngest(message: string, data: Record<string, unknown>, hypothesisId?: string): void {
  try {
    const line = JSON.stringify({
      location: 'feeds3/items.ts',
      message,
      data: { ...data, hypothesisId: hypothesisId ?? null },
      timestamp: Date.now(),
    }) + '\n';
    fs.appendFileSync(DEBUG_LOG_PATH, line);
  } catch (_) {}
}
// #endregion

/** 单次解析统计信息 */
interface ParseStats {
  strategy: string;
  totalFound: number;
  validItems: number;
  invalidItems: number;
  errors: string[];
  durationMs: number;
}

/** 验证单个说说条目的关键字段 */
function validateFeedItem(item: Record<string, unknown>, source: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!item['tid'] || typeof item['tid'] !== 'string' || item['tid'].length === 0) {
    errors.push(`missing or invalid tid`);
  }
  if (!item['uin'] || typeof item['uin'] !== 'string' || item['uin'].length === 0) {
    errors.push(`missing or invalid uin`);
  }
  if (typeof item['content'] !== 'string') {
    errors.push(`missing or invalid content type`);
  }
  if (typeof item['created_time'] !== 'number' || item['created_time'] <= 0) {
    errors.push(`missing or invalid created_time`);
  }

  if (errors.length > 0) {
    log('DEBUG', `validateFeedItem [${source}]: tid=${item['tid']}, errors=[${errors.join(', ')}]`);
  }

  return { valid: errors.length === 0, errors };
}

/** 将秒级/毫秒级时间戳格式化为便于阅读的日期时间（YYYY-MM-DD HH:mm） */
function formatTimestampToReadable(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** 多重正则匹配器：尝试多个模式直到成功 */
function tryMultiplePatterns<T>(
  text: string,
  patterns: { pattern: RegExp; name: string }[],
  extractFn: (match: RegExpExecArray) => T | null,
): { result: T | null; matchedPattern: string; attempts: string[] } {
  const attempts: string[] = [];
  for (const { pattern, name } of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const result = extractFn(match);
      if (result !== null) {
        return { result, matchedPattern: name, attempts };
      }
    }
    attempts.push(name);
  }
  return { result: null, matchedPattern: 'none', attempts };
}

/**
 * 从 feeds3 HTML 响应中提取说说列表。
 * 先用 feed_data `<i>` 标签策略，无结果时 fallback 到 JS data 数组。
 */
export function parseFeeds3Items(
  text: string,
  filterUin?: string,
  filterAppid?: string,
  maxItems = 50,
  skipFeedData = false,
): Record<string, unknown>[] {
  const startTime = Date.now();
  log('DEBUG', `parseFeeds3Items: text length=${text.length}, filterUin=${filterUin}, filterAppid=${filterAppid ?? '(any)'}, maxItems=${maxItems}, skipFeedData=${skipFeedData}`);

  const { text: processedText } = preprocessHtml(text);

  const msglist: Record<string, unknown>[] = [];
  const seenTids = new Set<string>();
  const stats: ParseStats = {
    strategy: 'feed_data',
    totalFound: 0,
    validItems: 0,
    invalidItems: 0,
    errors: [],
    durationMs: 0,
  };

  const feedDataPat = /name="feed_data"\s*([^>]*)>/g;
  const dataAttr = (attrs: string, name: string): string => {
    const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`));
    return m?.[1] ?? '';
  };

  const feedIdPat = /id="feed_(\d+)_(\d+)_(\d+)_(\d+)_\d+_\d+"[^>]*?>([\s\S]*?)(?=<div class="qz_summary|<li class="f-single|$)/g;

  interface FeedBlock { opuin: string; appid: string; typeid: string; timestamp: number; block: string; }
  const feedBlocks: FeedBlock[] = [];
  let fb: RegExpExecArray | null;
  while ((fb = feedIdPat.exec(processedText)) !== null) {
    feedBlocks.push({
      opuin: fb[1]!, appid: fb[2]!, typeid: fb[3]!,
      timestamp: parseInt(fb[4]!, 10), block: fb[5]!,
    });
  }

  const contentPat = /class="txt-box(?:-title)?[^"]*"[^>]*>([\s\S]*?)(?:<\/p>|<\/div>)/;
  const contentPatAlt = /class="txt-box\s[^"]*"[^>]*>([\s\S]*?)(?:<div\s+class="f-single-foot|<div\s+class="f-ct-b|<\/li>)/;
  const nicknamePat = /class="f-name[^"]*"[^>]*>([\s\S]*?)<\/a>/;
  const cmtnumPat = /class="f-ct[^"]*"[^>]*>(\d+)/;
  const cmtnumFromBlockPat = /cmtnum["']?\s*[=:]\s*["']?(\d+)/i;
  const cmtNumFromDataAttrPat = /data-cmtnum="(\d+)"/i;

  let fdm: RegExpExecArray | null;
  while ((fdm = feedDataPat.exec(processedText)) !== null) {
    const attrs = fdm[1]!;
    const tid = dataAttr(attrs, 'tid');
    const dataUin = dataAttr(attrs, 'uin');
    const origTid = dataAttr(attrs, 'origtid');
    const origUin = dataAttr(attrs, 'origuin');
    const abstime = parseInt(dataAttr(attrs, 'abstime') || '0', 10);

    if (tid === 'advertisement_app' || dataUin === '0' || !tid) continue;
    if (filterUin && dataUin !== filterUin) continue;
    if (seenTids.has(tid)) continue;
    seenTids.add(tid);

    const fdPos = fdm.index;
    let matchedBlock: FeedBlock | undefined;
    let closestDist = Infinity;
    for (const blk of feedBlocks) {
      const blkStart = processedText.indexOf(`id="feed_${blk.opuin}_${blk.appid}_${blk.typeid}_${blk.timestamp}_`);
      if (blkStart >= 0 && blkStart < fdPos) {
        const dist = fdPos - blkStart;
        if (dist < closestDist) {
          closestDist = dist;
          matchedBlock = blk;
        }
      }
    }

    if (filterUin && (!matchedBlock || matchedBlock.opuin !== filterUin)) continue;
    if (filterAppid && matchedBlock && matchedBlock.appid !== filterAppid) continue;

    const blockTypeidForLog = matchedBlock?.typeid ?? '';
    debugIngest('feed_data matchedBlock', {
      tid,
      dataUin,
      hasMatchedBlock: !!matchedBlock,
      blockOpuin: matchedBlock?.opuin ?? null,
      blockAppid: matchedBlock?.appid ?? null,
      blockTypeid: blockTypeidForLog,
      isForwardLike: blockTypeidForLog === '5' || !!(origTid && origTid !== tid && origUin && origUin !== dataUin),
    }, 'H1');

    const nextFdPos = processedText.indexOf('name="feed_data"', fdPos + 1);
    const prevFdPos = fdPos > 0 ? processedText.lastIndexOf('name="feed_data"', fdPos - 1) : -1;
    const afterEnd = nextFdPos >= 0 ? Math.min(nextFdPos, fdPos + 8000) : Math.min(fdPos + 5000, processedText.length);
    const beforeStart = prevFdPos >= 0 ? Math.max(prevFdPos, fdPos - 8000) : Math.max(0, fdPos - 5000);
    const searchAfter = processedText.substring(fdPos, afterEnd);
    const searchBefore = processedText.substring(beforeStart, fdPos);

    debugIngest('search range', {
      tid,
      nextFdPos: nextFdPos >= 0 ? nextFdPos : -1,
      afterEndOffset: afterEnd - fdPos,
      searchAfterLen: searchAfter.length,
      nextFeedDataInAfter: searchAfter.indexOf('name="feed_data"'),
    }, 'H2');

    let content = '';
    let nickname = '';
    let cmtnum = 0;
    const images: string[] = [];
    const picsMeta: Array<{ url: string; originalUrl?: string; width?: number; height?: number }> = [];

    const blockTypeid = matchedBlock?.typeid ?? '';
    const isForward = blockTypeid === '5' || !!(origTid && origTid !== tid && origUin && origUin !== dataUin);

    let rt_tid = '';
    let rt_uin = '';
    let rt_uinname = '';
    let rt_con = '';

    const cmAfter = searchAfter.match(contentPat);
    const fInfoPat = /<div class="f-info">([\s\S]*?)<\/div>/g;
    const allFInfo = [...searchBefore.matchAll(fInfoPat)];
    const cmFInfo = allFInfo.length > 0 ? allFInfo[allFInfo.length - 1]! : null;
    const cmTxtBoxAfter = searchAfter.match(contentPatAlt);

    if (cmAfter) {
      const rawHtml = cmAfter[1]!;
      const trimmedHtml = rawHtml.trim();

      if ((!trimmedHtml || trimmedHtml === '' || /^\s*$/.test(trimmedHtml)) && cmFInfo) {
        content = extractFeedContentFromHtml(cmFInfo[1]!);
        if (isForward) {
          rt_tid = origTid || tid;
          rt_uin = origUin || dataUin;
          if (cmTxtBoxAfter) {
            const origHtml = cmTxtBoxAfter[1]!;
            const origNickMatch = origHtml.match(/<a[^>]*class="nickname[^"]*"[^>]*>([^<]+)<\/a>/);
            rt_uinname = origNickMatch ? origNickMatch[1]!.trim() : '';
            const origText = extractFeedContentFromHtml(origHtml);
            const origColonIdx = origText.indexOf('：');
            rt_con = origColonIdx >= 0 ? origText.substring(origColonIdx + 1).trim() : origText;
          }
        }
      } else if (isForward || rawHtml.includes('>转发')) {
        const sections = rawHtml.split(/<a\s+class="nickname/);
        if (sections.length >= 3) {
          const fwdSection = sections[1]!;
          const fwdNickMatch = fwdSection.match(/>([^<]+)<\/a>/);
          nickname = fwdNickMatch ? fwdNickMatch[1]!.trim() : '';
          const fwdTextClean = extractFeedContentFromHtml(fwdSection);
          const fwdColonIdx = fwdTextClean.indexOf('：');
          const fwdContent = fwdColonIdx >= 0 ? fwdTextClean.substring(fwdColonIdx + 1).trim() : fwdTextClean;
          const origSection = sections[2]!;
          const origNickMatch = origSection.match(/>([^<]+)<\/a>/);
          rt_uinname = origNickMatch ? origNickMatch[1]!.trim() : '';
          const origTextClean = extractFeedContentFromHtml(origSection);
          const origColonIdx = origTextClean.indexOf('：');
          rt_con = origColonIdx >= 0 ? origTextClean.substring(origColonIdx + 1).trim() : origTextClean;
          rt_tid = origTid || tid;
          rt_uin = origUin || dataUin;
          content = fwdContent;
        } else if (sections.length === 2) {
          const origSection = sections[1]!;
          const origNickMatch = origSection.match(/>([^<]+)<\/a>/);
          rt_uinname = origNickMatch ? origNickMatch[1]!.trim() : '';
          const origTextClean = extractFeedContentFromHtml(origSection);
          const origColonIdx = origTextClean.indexOf('：');
          rt_con = origColonIdx >= 0 ? origTextClean.substring(origColonIdx + 1).trim() : origTextClean;
          rt_tid = origTid || '';
          rt_uin = origUin || '';
          content = '';
        }
      } else {
        const rawText = extractFeedContentFromHtml(rawHtml);
        const colonIdx = rawText.indexOf('：');
        if (colonIdx >= 0) {
          content = rawText.substring(colonIdx + 1).trim();
          if (!nickname) nickname = rawText.substring(0, colonIdx).trim();
        } else {
          content = rawText;
        }
      }
    } else if (cmFInfo) {
      content = extractFeedContentFromHtml(cmFInfo[1]!);
      if (isForward) {
        rt_tid = origTid || tid;
        rt_uin = origUin || dataUin;
        if (cmTxtBoxAfter) {
          const origHtml = cmTxtBoxAfter[1]!;
          const origNickMatch = origHtml.match(/<a[^>]*class="nickname[^"]*"[^>]*>([^<]+)<\/a>/);
          rt_uinname = origNickMatch ? origNickMatch[1]!.trim() : '';
          const origText = origHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
            .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
          const origColonIdx = origText.indexOf('：');
          rt_con = origColonIdx >= 0 ? origText.substring(origColonIdx + 1).trim() : origText;
        }
      }
    }

    if (isForward && !rt_con) {
      if (cmTxtBoxAfter) {
        const origHtml = cmTxtBoxAfter[1]!;
        const origText = extractFeedContentFromHtml(origHtml);
        if (origText.length > 0) {
          const idx = origText.indexOf('：');
          rt_con = idx >= 0 ? origText.substring(idx + 1).trim() : origText;
        }
      }
      if (!rt_con && matchedBlock?.block) {
        const block = matchedBlock.block;
        const origPat = /(?:txt-box|f-info|ellipsis|content-box)[^>]*>([\s\S]*?)(?:<\/p>|<\/div>|<\/span>)/gi;
        let om: RegExpExecArray | null;
        while ((om = origPat.exec(block)) !== null) {
          const raw = extractFeedContentFromHtml(om[1]!);
          if (raw.length > 0 && !/^[\d\s·]+$/.test(raw)) {
            rt_con = raw.includes('：') ? raw.substring(raw.indexOf('：') + 1).trim() : raw;
            if (rt_con.length > 0) break;
          }
        }
      }
    }

    if (!nickname) {
      const searchRegion = searchAfter + searchBefore;
      const nm = searchRegion.match(nicknamePat);
      if (nm) nickname = nm[1]!.replace(/<[^>]+>/g, '').trim();
    }

    if (!content && matchedBlock?.block) {
      const block = matchedBlock.block;
      const looseContentPat = /(?:txt-box-title|txt-box|f-info|ellipsis|content-box)[^>]*>([\s\S]*?)(?:<\/p>|<\/div>|<\/span>)/gi;
      let looseMatch: RegExpExecArray | null;
      while ((looseMatch = looseContentPat.exec(block)) !== null) {
        const raw = extractFeedContentFromHtml(looseMatch[1]!);
        if (raw.length > 0 && !/^[\d\s·]+$/.test(raw) && !/^https?:\/\//.test(raw)) {
          const afterColon = raw.includes('：') ? raw.substring(raw.indexOf('：') + 1).trim() : raw;
          if (afterColon.length > 0) {
            content = afterColon;
            break;
          }
        }
      }
    }

    if (isForward && !content && rt_con) {
      content = rt_con;
    }

    debugIngest('content source', {
      tid,
      contentLen: content.length,
      contentSnippet: content.slice(0, 80),
      hadCmAfter: !!cmAfter,
      hadCmFInfo: !!cmFInfo,
      sectionsLength: cmAfter ? (cmAfter[1]!.split(/<a\s+class="nickname/).length) : 0,
    }, 'H4');

    if (matchedBlock?.block) {
      const cmtFromBlock = matchedBlock.block.match(cmtnumFromBlockPat);
      if (cmtFromBlock) cmtnum = parseInt(cmtFromBlock[1]!, 10);
    }
    if (cmtnum === 0) {
      const cmtFromAttr = searchAfter.match(cmtNumFromDataAttrPat);
      if (cmtFromAttr) cmtnum = parseInt(cmtFromAttr[1]!, 10);
    }
    if (cmtnum === 0) {
      const cm2 = searchAfter.match(cmtnumPat);
      if (cm2) cmtnum = parseInt(cm2[1]!, 10);
    }
    if (cmtnum === 0 && matchedBlock?.block) {
      const cmtFromJson = matchedBlock.block.match(/"cmtnum":\s*(\d+)/)
        || matchedBlock.block.match(/'cmtnum':\s*(\d+)/)
        || matchedBlock.block.match(/cmtnum\s*:\s*(\d+)/);
      if (cmtFromJson) cmtnum = parseInt(cmtFromJson[1]!, 10);
    }
    if (cmtnum === 0 && matchedBlock?.block) {
      const block = matchedBlock.block;
      const commentItems = block.match(/<li\s+class="comments-item/gi);
      if (commentItems) cmtnum = commentItems.length;
    }

    let likenum = 0;
    if (matchedBlock?.block) {
      const likeFromBlock = matchedBlock.block.match(/"likenum":\s*(\d+)/i)
        || matchedBlock.block.match(/'likenum':\s*(\d+)/i)
        || matchedBlock.block.match(/likenum["']?\s*[=:]\s*["']?(\d+)/i)
        || matchedBlock.block.match(/"like_count":\s*(\d+)/)
        || matchedBlock.block.match(/likecount[=:]\s*(\d+)/i);
      if (likeFromBlock) likenum = parseInt(likeFromBlock[1]!, 10);
    }
    if (likenum === 0) {
      const likeMatch = searchAfter.match(/class="f-like-cnt"[^>]*>(\d+)</i)
        || searchAfter.match(/data-likecount="(\d+)"/i)
        || searchAfter.match(/data-likecnt="(\d+)"/i)
        || searchAfter.match(/like_num["']?\s*[=:]\s*["']?(\d+)/i)
        || searchAfter.match(/"like_num":\s*(\d+)/)
        || searchAfter.match(/\\x3Cspan class=\\x22f-like-cnt\\x22[^>]*>(\d+)\\x3C/i)
        || searchAfter.match(/\\x3C[^>]*f-like-cnt[^>]*>(\d+)\\x3C/i);
      if (likeMatch) likenum = parseInt(likeMatch[1]!, 10);
    }
    if (likenum === 0) {
      const likeFromStats = searchAfter.match(/<a[^>]*class="[^"]*f-like[^"]*"[^>]*>[\s\S]*?<\/a>/gi);
      if (likeFromStats) {
        for (const likeElem of likeFromStats) {
          const numMatch = likeElem.match(/>(\d+)</);
          if (numMatch) {
            likenum = parseInt(numMatch[1]!, 10);
            break;
          }
        }
      }
    }

    const fullRegion = searchBefore + searchAfter;
    const regionDecoded = htmlUnescape(fullRegion);
    const nextFeedDataInAfter = searchAfter.indexOf('name="feed_data"');
    const searchAfterCurrentOnly = nextFeedDataInAfter >= 0 ? searchAfter.substring(0, nextFeedDataInAfter) : searchAfter;
    const regionCurrentFeedOnly = searchBefore + searchAfterCurrentOnly;
    const regionCurrentDecoded = htmlUnescape(regionCurrentFeedOnly);

    const picKeyPat = /<a[^>]+class="img-item[^"]*"[^>]*data-pickey="([^,]+),([^"]+)"[^>]*>/gi;
    const validTidLike = (s: string) => /^[a-zA-Z0-9_-]{6,64}$/.test(s);
    let picKeyMatch: RegExpExecArray | null;
    while ((picKeyMatch = picKeyPat.exec(regionDecoded)) !== null) {
      const pickeyTid = picKeyMatch[1]!;
      const originalUrl = picKeyMatch[2]!;
      if (!validTidLike(pickeyTid)) {
        debugIngest('pickey tid skip', { tid, pickeyTid, dataUin, reason: 'invalid_tid_format' }, 'H3');
        continue;
      }
      if (pickeyTid !== tid) {
        debugIngest('pickey tid skip', { tid, pickeyTid, dataUin }, 'H3');
        continue;
      }
      if (!images.includes(originalUrl)) {
        images.push(originalUrl);
        const imgItemTag = picKeyMatch[0];
        const widthM = imgItemTag.match(/data-width="(\d+)"/);
        const heightM = imgItemTag.match(/data-height="(\d+)"/);
        picsMeta.push({
          url: originalUrl,
          originalUrl,
          width: widthM ? parseInt(widthM[1]!, 10) : undefined,
          height: heightM ? parseInt(heightM[1]!, 10) : undefined,
        });
      }
    }

    const EXCLUDED_IMAGE_PATTERNS = [
      /qzonestyle\.gtimg\.cn\/qzone\/em\//,
      /qzonestyle\.gtimg\.cn\/qzone\/space\//,
      /\/ac\/b\.gif$/,
      /qlogo\.cn/,
      /qzapp\.qlogo\.cn/,
      /qzonestyle\.gtimg\.cn\/act/,
    ];
    function isUserUploadedImage(url: string): boolean {
      return !EXCLUDED_IMAGE_PATTERNS.some(pat => pat.test(url));
    }

    for (const im of regionCurrentDecoded.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
      const src = im[1]!;
      if ((src.includes('qpic.cn') || src.includes('photo.store.qq.com') ||
           /\.(jpg|jpeg|png|gif|webp)$/i.test(src)) &&
          !src.includes('qlogo') && !images.includes(src) &&
          isUserUploadedImage(src)) {
        images.push(src);
        picsMeta.push({ url: src });
      }
    }
    for (const tag of regionCurrentDecoded.matchAll(/<img[^>]+>/gi)) {
      const tagStr = tag[0];
      const dataSrc = tagStr.match(/data-src=["']([^"']+)["']/i)?.[1];
      const dataOriginal = tagStr.match(/data-original=["']([^"']+)["']/i)?.[1];
      for (const url of [dataSrc, dataOriginal]) {
        if (!url || images.includes(url)) continue;
        if ((url.includes('qpic.cn') || url.includes('photo.store.qq.com') ||
             /\.(jpg|jpeg|png|gif|webp)$/i.test(url)) &&
            !url.includes('qlogo') && isUserUploadedImage(url)) {
          images.push(url);
          picsMeta.push({ url });
        }
      }
    }

    let videos: Array<{ videoId: string; coverUrl: string; videoUrl?: string; duration?: number; width?: number; height?: number }> = [];
    const videoCoverUrls: string[] = [];

    const videoPat = /data-vid="(\d+)"|<video[^>]*data-src="([^"]+)"|<div[^>]*class="[^"]*video[^"]*"[^>]*data-vid="(\d+)"/gi;
    const videoMatches = [...regionDecoded.matchAll(videoPat)];
    for (const vm of videoMatches) {
      const vid = vm[1] || vm[3];
      const videoUrl = vm[2];
      if (vid && !videos.some(v => v.videoId === vid)) {
        const coverMatch = regionDecoded.match(new RegExp(`data-vid="${vid}"[^>]*data-pic="([^"]+)"`, 'i'))
          || regionDecoded.match(new RegExp(`data-pic="([^"]+)"[^>]*data-vid="${vid}"`, 'i'));
        const coverUrl = coverMatch?.[1] || '';
        if (coverUrl) videoCoverUrls.push(coverUrl);
        videos.push({
          videoId: vid,
          coverUrl: coverUrl,
          videoUrl: videoUrl || undefined,
        });
      }
    }

    const videoTagPat = /<video[^>]*src="([^"]+)"[^>]*>/gi;
    for (const vtm of regionDecoded.matchAll(videoTagPat)) {
      const src = vtm[1]!;
      if (!videos.some(v => v.videoUrl === src)) {
        const posterMatch = vtm[0].match(/poster="([^"]+)"/);
        const coverUrl = posterMatch?.[1] || '';
        if (coverUrl) videoCoverUrls.push(coverUrl);
        videos.push({
          videoId: `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          coverUrl: coverUrl,
          videoUrl: src,
        });
      }
    }

    const qqVideoPat = /qqvideo\.qq\.com|v\.qq\.com|data-src="[^"]*video/gi;
    if (qqVideoPat.test(regionDecoded) && videos.length === 0) {
      const qvideoPat = /class="[^"]*(?:qvideo|video-box|video-container)[^"]*"/gi;
      const qvideoMatch = regionDecoded.match(qvideoPat);
      if (qvideoMatch) {
        for (const container of qvideoMatch) {
          const containerMatch = regionDecoded.match(new RegExp(`${container.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?<img[^>]+src="([^"]+)"`, 'i'));
          if (containerMatch && !videoCoverUrls.includes(containerMatch[1]!)) {
            videoCoverUrls.push(containerMatch[1]!);
            videos.push({
              videoId: `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              coverUrl: containerMatch[1]!,
            });
          }
        }
      }
    }

    const appid = matchedBlock?.appid ?? '';
    const typeid = matchedBlock?.typeid ?? '';
    let appName = '';
    let appShareTitle = '';
    let likeUnikey = '';
    let likeCurkey = '';
    let musicShare: { songName: string; artistName?: string; coverUrl?: string; playUrl?: string } | undefined;

    if (appid && appid !== '311') {
      const searchAll = searchBefore + searchAfter;
      const isBilibili = /bilibili\.com|b23\.tv/i.test(searchAll);

      const appNameM = searchAll.match(/data-appname="([^"]+)"/i)
        ?? searchAll.match(/<[^>]+class="[^"]*(?:app-name|f-app-name)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
      if (appNameM) appName = appNameM[1]!.replace(/<[^>]+>/g, '').trim();

      if ((appid === '202' || appid === '2100') && !isBilibili) {
        const songNameM = searchAll.match(/<h4[^>]+class="[^"]*txt-box-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
        const artistNameM = searchAll.match(/<a[^>]+class="[^"]*f-name[^"]*info[^"]*"[^>]*>([^<]+)<\/a>/i);
        const artistStr = artistNameM?.[1]?.trim() ?? '';
        const looksLikeVideoStats = /\d+播放|点赞|弹幕/.test(artistStr);
        if (!looksLikeVideoStats) {
          const coverM = searchAll.match(/<img[^>]+trueSrc=["']([^"']+)["']/i)
            ?? searchAll.match(/trueSrc:['"]([^'"]+)['"]/i);
          const playUrlM = searchAll.match(/<div[^>]+class="[^"]*img-box[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i);
          if (songNameM) {
            musicShare = {
              songName: songNameM[1]!.trim(),
              artistName: artistStr || undefined,
              coverUrl: coverM?.[1],
              playUrl: playUrlM?.[1],
            };
            appShareTitle = musicShare.songName + (musicShare.artistName ? ` - ${musicShare.artistName}` : '');
            log('DEBUG', `parseFeeds3Items: music share detected, song=${musicShare.songName}, artist=${musicShare.artistName ?? '(unknown)'}`);
          }
        } else if (songNameM) {
          appShareTitle = (songNameM[1]!.trim() + ' ' + artistStr).trim();
        }
      }

      if (!musicShare) {
        const titleM = searchAll.match(/<p[^>]*class="[^"]*ell[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
          ?? searchAll.match(/<[^>]+class="[^"]*(?:f-ct-title|app-title|app-content-title)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
        if (titleM) appShareTitle = titleM[1]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
      }

      const looksLikeVideoTitle = (s: string) => typeof s === 'string' && s.length > 0 && (/\d+播放|点赞|弹幕/.test(s));
      if (!musicShare && (isBilibili || looksLikeVideoTitle(content))) {
        if (looksLikeVideoTitle(content)) {
          if (!appShareTitle) appShareTitle = content.trim();
          content = '';
        }
        let userText = '';
        if (cmFInfo) {
          const raw = extractFeedContentFromHtml(cmFInfo[1]!);
          if (raw && !looksLikeVideoTitle(raw)) userText = raw;
        }
        if (!userText && matchedBlock?.block) {
          const block = matchedBlock.block;
          const pat = /(?:txt-box|f-info|ellipsis|content-box)[^>]*>([\s\S]*?)(?:<\/p>|<\/div>|<\/span>)/gi;
          let m: RegExpExecArray | null;
          while ((m = pat.exec(block)) !== null) {
            const raw = extractFeedContentFromHtml(m[1]!);
            if (raw.length > 0 && raw.length < 300 && !looksLikeVideoTitle(raw) && !/^[\d\s·]+$/.test(raw)) {
              userText = raw;
              break;
            }
          }
        }
        if (!userText) {
          for (const region of [searchAfter, searchBefore]) {
            const pat2 = /(?:txt-box|f-info|f-ct)[^>]*>([\s\S]*?)(?:<\/p>|<\/div>|<\/span>|<\/a>)/gi;
            let m2: RegExpExecArray | null;
            while ((m2 = pat2.exec(region)) !== null) {
              const raw = extractFeedContentFromHtml(m2[1]!);
              if (raw.length > 0 && raw.length < 100 && !looksLikeVideoTitle(raw) && !/^[\d\s·]+$/.test(raw)) {
                userText = raw;
                break;
              }
            }
            if (userText) break;
          }
        }
        if (userText) content = userText;
      }

      const unM = searchAll.match(/data-unikey="([^"]+)"/i)
        ?? searchAll.match(/unikey\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (unM) likeUnikey = unM[1]!;

      if (!likeUnikey) {
        const hrefM = searchAll.match(/href="(https?:\/\/(?:y\.music\.163\.com|music\.163\.com|www\.bilibili\.com|b23\.tv)[^"]+)"/i);
        if (hrefM) likeUnikey = hrefM[1]!;
      }

      const ckM = searchAll.match(/data-curkey="([^"]+)"/i)
        ?? searchAll.match(/curkey\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (ckM) likeCurkey = ckM[1]!;

      if (!likeCurkey && dataUin && abstime) {
        const ts = abstime || (matchedBlock?.timestamp ?? 0);
        if (ts) {
          likeCurkey = '00' + dataUin.padStart(10, '0') + '00' + String(ts).padStart(10, '0');
          log('DEBUG', `parseFeeds3Items: curkey calculated from formula: ${likeCurkey}`);
        }
      }

      if (isBilibili && videos.length === 0 && likeUnikey) {
        videos.push({
          videoId: 'bilibili_link',
          coverUrl: '',
          videoUrl: likeUnikey,
        });
      }
    }

    const timestamp = abstime || (matchedBlock?.timestamp ?? 0);

    let filteredImages = images.filter((url: string) =>
      url.startsWith('http') && !videoCoverUrls.some(cover => url.includes(cover) || cover.includes(url))
    );
    if (filteredImages.some((u) => u.includes('a1.qpic.cn'))) {
      filteredImages = filteredImages.filter((u) => u.includes('a1.qpic.cn'));
    }
    let filteredPicsMeta = picsMeta.filter((p) =>
      p.url?.startsWith('http') && !videoCoverUrls.some(cover => p.url!.includes(cover) || cover.includes(p.url!))
    );
    if (filteredImages.some((u) => u.includes('a1.qpic.cn'))) {
      filteredPicsMeta = filteredPicsMeta.filter((p) => p.url?.includes('a1.qpic.cn'));
    }

    const photoStoreCount = filteredImages.filter((u) => u.includes('photo.store.qq.com')).length;
    const a1qpicCount = filteredImages.filter((u) => u.includes('a1.qpic.cn')).length;
    debugIngest('img url source', {
      tid,
      imagesRaw: images.length,
      filteredPicCount: filteredImages.length,
      domainPhotoStore: photoStoreCount,
      domainA1qpic: a1qpicCount,
      sampleUrls: filteredImages.slice(0, 2).map((u) => (u.length > 80 ? u.slice(0, 80) + '...' : u)),
    }, 'IMG');
    debugIngest('item summary', {
      tid,
      uin: dataUin,
      contentLen: content.length,
      contentSnippet: content.slice(0, 60),
      imagesRaw: images.length,
      filteredPicCount: filteredImages.length,
      videoCount: videos.length,
      regionCurrentLen: regionCurrentDecoded.length,
    }, 'H5');

    let canonicalTid = tid;
    if (/^\d+$/.test(tid)) {
      const fkey = dataAttr(attrs, 'fkey');
      if (fkey) {
        canonicalTid = fkey;
        seenTids.add(canonicalTid);
        log('DEBUG', `parseFeeds3Items: tid ${tid} (abstime) -> fkey ${canonicalTid}`);
      } else {
        const combined = `${searchBefore} ${attrs} ${searchAfter.slice(0, 4000)}`;
        let keyMatch = combined.match(/data-key="([a-z0-9]{6,})"/i);
        if (!keyMatch) keyMatch = combined.match(/key:\s*['"]([a-z0-9]{6,})['"]/i);
        if (keyMatch) {
          canonicalTid = keyMatch[1]!;
          seenTids.add(canonicalTid);
          log('DEBUG', `parseFeeds3Items: tid ${tid} (abstime) -> key ${canonicalTid}`);
        }
      }
    }

    const isLiked = /data-islike="1"/.test(searchAfter) || /qz_like_btn[^"]*item-on|item-on[^"]*qz_like_btn/.test(searchAfter);

    const item: Record<string, unknown> = {
      tid: canonicalTid, uin: dataUin, nickname, content,
      created_time: timestamp, createTime: formatTimestampToReadable(timestamp), createTime2: formatTimestampToReadable(timestamp),
      cmtnum, likenum, fwdnum: isForward ? 1 : 0,
      pic: filteredImages.map(u => ({ url: u })),
      picsMeta: filteredPicsMeta.length > 0 ? filteredPicsMeta : undefined,
      video: videos.length > 0 ? videos : undefined,
      appid,
      typeid,
      appName,
      appShareTitle,
      likeUnikey,
      likeCurkey,
      musicShare,
      isLiked,
      _source: 'feeds3',
    };

    if (isForward || rt_tid) {
      item['rt_tid'] = rt_tid;
      item['rt_uin'] = rt_uin;
      item['rt_uinname'] = rt_uinname;
      item['rt_con'] = rt_con;
    }

    msglist.push(item);

    if (msglist.length >= maxItems) break;
  }

  msglist.sort((a, b) => {
    const ta = (a['created_time'] as number) || 0;
    const tb = (b['created_time'] as number) || 0;
    return tb - ta;
  });

  log('DEBUG', `parseFeeds3Items: feed_data strategy found ${msglist.length} items`);

  if (msglist.length === 0 || skipFeedData) {
    if (skipFeedData) { msglist.length = 0; seenTids.clear(); }
    log('DEBUG', 'parseFeeds3Items: feed_data strategy found 0, trying JS data array');
    const jsItemPat = /\{[^{}]*?appid:'(\d+)'[^{}]*?key:'([^']*)'[^{}]*?abstime:'(\d+)'[^{}]*?uin:'(\d+)'[^{}]*?nickname:'([^']*)'/g;
    let jsm: RegExpExecArray | null;
    while ((jsm = jsItemPat.exec(text)) !== null) {
      const appid = jsm[1]!;
      const tid = jsm[2]!;
      const jsAbstime = parseInt(jsm[3]!, 10);
      const feedUin = jsm[4]!;
      const jsNickname = jsm[5]!;

      if (filterAppid && appid !== filterAppid) continue;
      if (feedUin === '0') continue;
      if (filterUin && feedUin !== filterUin) continue;
      if (seenTids.has(tid)) continue;
      seenTids.add(tid);

      let jsContent = '';
      let jsRtTid = '';
      let jsRtUin = '';
      let jsRtUinname = '';
      let jsRtCon = '';
      let jsIsForward = false;

      const afterItem = text.substring(jsm.index, Math.min(jsm.index + 20000, text.length));
      const htmlFieldMatch = afterItem.match(/html:'((?:[^'\\]|\\.)*)'/);
      if (htmlFieldMatch) {
        const decoded = htmlFieldMatch[1]!.replace(/\\x([0-9a-fA-F]{2})/g,
          (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
        const titleMatch = decoded.match(/class="txt-box-title[^"]*"[^>]*>([\s\S]*?)<\/p>/);
        if (titleMatch) {
          const rawHtml = titleMatch[1]!;
          if (rawHtml.includes('>转发')) {
            jsIsForward = true;
            const sections = rawHtml.split(/<a\s+class="nickname/);
            if (sections.length >= 3) {
              const fwdText = sections[1]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
                .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
              const fwdColonIdx = fwdText.indexOf('：');
              jsContent = fwdColonIdx >= 0 ? fwdText.substring(fwdColonIdx + 1).trim() : fwdText;

              const origText = sections[2]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
                .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
              const origNickMatch = sections[2]!.match(/>([^<]+)<\/a>/);
              jsRtUinname = origNickMatch ? origNickMatch[1]!.trim() : '';
              const origColonIdx = origText.indexOf('：');
              jsRtCon = origColonIdx >= 0 ? origText.substring(origColonIdx + 1).trim() : origText;
              jsRtTid = tid;
              jsRtUin = feedUin;
            }
          } else {
            const rawText = rawHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
              .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
            const colonIdx = rawText.indexOf('：');
            jsContent = colonIdx >= 0 ? rawText.substring(colonIdx + 1).trim() : rawText;
          }
        }
      }

      const jsItem: Record<string, unknown> = {
        tid, uin: feedUin, nickname: jsNickname, content: jsContent,
        created_time: jsAbstime, createTime: formatTimestampToReadable(jsAbstime), createTime2: formatTimestampToReadable(jsAbstime),
        cmtnum: 0, likenum: 0, fwdnum: jsIsForward ? 1 : 0, pic: [],
        appid,
        _source: 'feeds3',
      };
      if (jsIsForward) {
        jsItem['rt_tid'] = jsRtTid;
        jsItem['rt_uin'] = jsRtUin;
        jsItem['rt_uinname'] = jsRtUinname;
        jsItem['rt_con'] = jsRtCon;
      }

      msglist.push(jsItem);

      if (msglist.length >= maxItems) break;
    }

    msglist.sort((a, b) => {
      const ta = (a['created_time'] as number) || 0;
      const tb = (b['created_time'] as number) || 0;
      return tb - ta;
    });
    log('DEBUG', `parseFeeds3Items: JS fallback found ${msglist.length} items`);
    stats.strategy = 'js_fallback';
  }

  stats.durationMs = Date.now() - startTime;

  for (const item of msglist) {
    const validation = validateFeedItem(item, stats.strategy);
    if (validation.valid) {
      stats.validItems++;
    } else {
      stats.invalidItems++;
      if (stats.errors.length < 5) {
        stats.errors.push(`tid=${item['tid']}: ${validation.errors.join(', ')}`);
      }
    }
  }

  stats.totalFound = msglist.length;

  log('INFO', `parseFeeds3Items: strategy=${stats.strategy}, total=${stats.totalFound}, valid=${stats.validItems}, invalid=${stats.invalidItems}, duration=${stats.durationMs}ms`);
  if (stats.errors.length > 0) {
    log('DEBUG', `parseFeeds3Items validation errors: ${stats.errors.join('; ')}`);
  }

  if (stats.totalFound > 0 && stats.validItems / stats.totalFound < 0.5) {
    log('WARNING', `parseFeeds3Items: low validation rate ${stats.validItems}/${stats.totalFound} (${Math.round(stats.validItems / stats.totalFound * 100)}%)`);
  }

  return msglist;
}
