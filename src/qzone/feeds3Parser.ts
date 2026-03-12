/* ─────────────────────────────────────────────
   feeds3 HTML 解析器 (Feeds3 Parser)
   从 feeds3_html_more 的 HTML/JS 混合响应中
   提取说说列表、好友列表、翻页参数
   ───────────────────────────────────────────── */

import { log, htmlUnescape, parseJsonp } from './utils.js';
import { processEmojis, parseEmojis } from './emoji.js';
import type { EmojiInfo } from './types.js';

// ── 解析统计与验证 ─────────────────────────────

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

  // 关键字段验证
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

/** HTML 预处理：统一清理和规范化 */
function preprocessHtml(text: string): {
  text: string;
  stats: { originalLength: number; processedLength: number; replacements: number };
} {
  const startTime = Date.now();
  const originalLength = text.length;
  let replacements = 0;

  // 1. 统一换行符
  let processed = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. 处理常见 HTML 实体（除了 htmlUnescape 已处理的）
  processed = processed.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  replacements += (text.match(/&amp;|&lt;|&gt;/g) || []).length;

  // 3. 清理多余的空白字符（保留结构需要的）
  processed = processed.replace(/>\s+</g, '><');

  // 4. 处理 data-pickey 中可能的转义
  processed = processed.replace(/\\x22/g, '"').replace(/\\x3C/g, '<').replace(/\\x3E/g, '>').replace(/\\\//g, '/');

  const duration = Date.now() - startTime;
  log('DEBUG', `preprocessHtml: ${originalLength} -> ${processed.length} chars, ${replacements} replacements, ${duration}ms`);

  return {
    text: processed,
    stats: { originalLength, processedLength: processed.length, replacements },
  };
}

/** 多重正则匹配器：尝试多个模式直到成功 */
function tryMultiplePatterns<T>(
  text: string,
  patterns: { pattern: RegExp; name: string }[],
  extractFn: (match: RegExpExecArray) => T | null,
): { result: T | null; matchedPattern: string; attempts: string[] } {
  const attempts: string[] = [];

  for (const { pattern, name } of patterns) {
    pattern.lastIndex = 0; // 重置正则状态
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

// ── feeds3 说说解析 ─────────────────────────────

/**
 * 从 feeds3 HTML 响应中提取说说列表。
 * 先用 feed_data `<i>` 标签策略，无结果时 fallback 到 JS data 数组。
 *
 * @param text          feeds3_html_more 原始响应文本（已 unescape）
 * @param filterUin     只保留该 UIN 的说说（可选）
 * @param filterAppid   只保留该 appid 的说说（可选）
 * @param maxItems      最大返回条数
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

  // HTML 预处理
  const { text: processedText, stats: preprocessStats } = preprocessHtml(text);

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

  // ---- 策略 1：feed_data <i> 标签（最可靠）----
  const feedDataPat = /name="feed_data"\s*([^>]*)>/g;
  const dataAttr = (attrs: string, name: string): string => {
    const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`));
    return m?.[1] ?? '';
  };

  // feed block: id="feed_{opuin}_{appid}_{typeid}_{timestamp}_{x}_{x}"
  const feedIdPat = /id="feed_(\d+)_(\d+)_(\d+)_(\d+)_\d+_\d+"[^>]*?>([\s\S]*?)(?=<div class="qz_summary|<li class="f-single|$)/g;

  interface FeedBlock { opuin: string; appid: string; typeid: string; timestamp: number; block: string; }
  const feedBlocks: FeedBlock[] = [];
  let fb: RegExpExecArray | null;
  while ((fb = feedIdPat.exec(text)) !== null) {
    feedBlocks.push({
      opuin: fb[1]!, appid: fb[2]!, typeid: fb[3]!,
      timestamp: parseInt(fb[4]!, 10), block: fb[5]!,
    });
  }

  const contentPat = /class="txt-box-title[^"]*"[^>]*>([\s\S]*?)<\/p>/;
  const contentPatAlt = /class="txt-box\s[^"]*"[^>]*>([\s\S]*?)(?:<div\s+class="f-single-foot|<div\s+class="f-ct-b|<\/li>)/;
  const nicknamePat = /class="f-name[^"]*"[^>]*>([\s\S]*?)<\/a>/;
  const cmtnumPat = /class="f-ct[^"]*"[^>]*>(\d+)/;

  let fdm: RegExpExecArray | null;
  while ((fdm = feedDataPat.exec(text)) !== null) {
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
      const blkStart = text.indexOf(`id="feed_${blk.opuin}_${blk.appid}_${blk.typeid}_${blk.timestamp}_`);
      if (blkStart >= 0 && blkStart < fdPos) {
        const dist = fdPos - blkStart;
        if (dist < closestDist) {
          closestDist = dist;
          matchedBlock = blk;
        }
      }
    }

    // 指定用户时：必须同时满足 feed 块的 opuin（发布者）= filterUin，避免 feed_data 匹配错位导致混入他人内容
    if (filterUin && (!matchedBlock || matchedBlock.opuin !== filterUin)) continue;
    if (filterAppid && matchedBlock && matchedBlock.appid !== filterAppid) continue;

    const searchAfter = text.substring(fdPos, Math.min(fdPos + 5000, text.length));
    const searchBefore = text.substring(Math.max(0, fdPos - 5000), fdPos);

    let content = '';
    let nickname = '';
    let cmtnum = 0;
    const images: string[] = [];
    const picsMeta: Array<{ url: string; originalUrl?: string; width?: number; height?: number }> = [];

    // 从 matchedBlock 提前获取 typeid（用于转发检测）
    const blockTypeid = matchedBlock?.typeid ?? '';
    // 转发检测：优先检查 typeid=5，同时检查 origTid 差异
    const isForward = blockTypeid === '5' || !!(origTid && origTid !== tid && origUin && origUin !== dataUin);
    let rt_tid = '';
    let rt_uin = '';
    let rt_uinname = '';
    let rt_con = '';

    // 1) scope=1: txt-box-title（AFTER）
    const cmAfter = searchAfter.match(contentPat);

    // 2) scope=0: f-info（BEFORE，取最后一个匹配）
    const fInfoPat = /<div class="f-info">([\s\S]*?)<\/div>/g;
    const allFInfo = [...searchBefore.matchAll(fInfoPat)];
    const cmFInfo = allFInfo.length > 0 ? allFInfo[allFInfo.length - 1]! : null;

    // 3) scope=0: txt-box（AFTER，用于转发原始内容）
    const cmTxtBoxAfter = searchAfter.match(contentPatAlt);

    if (cmAfter) {
      const rawHtml = cmAfter[1]!;

      if (isForward || rawHtml.includes('>转发')) {
        const sections = rawHtml.split(/<a\s+class="nickname/);

        if (sections.length >= 3) {
          const fwdSection = sections[1]!;
          const fwdNickMatch = fwdSection.match(/>([^<]+)<\/a>/);
          nickname = fwdNickMatch ? fwdNickMatch[1]!.trim() : '';

          const fwdTextClean = fwdSection
            .replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
            .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
          const fwdColonIdx = fwdTextClean.indexOf('：');
          const fwdContent = fwdColonIdx >= 0 ? fwdTextClean.substring(fwdColonIdx + 1).trim() : fwdTextClean;

          const origSection = sections[2]!;
          const origNickMatch = origSection.match(/>([^<]+)<\/a>/);
          rt_uinname = origNickMatch ? origNickMatch[1]!.trim() : '';

          const origTextClean = origSection
            .replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
            .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
          const origColonIdx = origTextClean.indexOf('：');
          rt_con = origColonIdx >= 0 ? origTextClean.substring(origColonIdx + 1).trim() : origTextClean;

          rt_tid = origTid || tid;
          rt_uin = origUin || dataUin;
          content = fwdContent;
        } else if (sections.length === 2) {
          const rawText = rawHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
            .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
          const colonIdx = rawText.indexOf('：');
          content = colonIdx >= 0 ? rawText.substring(colonIdx + 1).trim() : rawText;
          rt_tid = origTid || '';
          rt_uin = origUin || '';
        }
      } else {
        const rawText = rawHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
          .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
        const colonIdx = rawText.indexOf('：');
        if (colonIdx >= 0) {
          content = rawText.substring(colonIdx + 1).trim();
          if (!nickname) nickname = rawText.substring(0, colonIdx).trim();
        } else {
          content = rawText;
        }
      }
    } else if (cmFInfo) {
      const rawText = cmFInfo[1]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
        .replace(/\\[trn]/g, '').replace(/[\t\r\n]+/g, ' ').trim();
      content = rawText;

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

    if (!nickname) {
      const searchRegion = searchAfter + searchBefore;
      const nm = searchRegion.match(nicknamePat);
      if (nm) nickname = nm[1]!.replace(/<[^>]+>/g, '').trim();
    }

    const cm2 = searchAfter.match(cmtnumPat);
    if (cm2) cmtnum = parseInt(cm2[1]!, 10);

    const fullRegion = searchBefore + searchAfter;
    const regionDecoded = htmlUnescape(fullRegion);

    // ── 增强图片提取：优先从 data-pickey 提取原始 URL 和尺寸元数据 ──
    // data-pickey 格式："{tid},{photo.store.qq.com 原始URL}"
    const picKeyPat = /<a[^>]+class="img-item[^"]*"[^>]*data-pickey="([^,]+),([^"]+)"[^>]*>/gi;
    let picKeyMatch: RegExpExecArray | null;
    while ((picKeyMatch = picKeyPat.exec(regionDecoded)) !== null) {
      const originalUrl = picKeyMatch[2]!;
      if (!images.includes(originalUrl)) {
        images.push(originalUrl);
        // 提取尺寸元数据
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

    // Fallback：从 <img src> 提取（排除已提取的）
    for (const im of regionDecoded.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
      const src = im[1]!;
      if ((src.includes('qpic.cn') || src.includes('photo.store.qq.com') ||
           /\.(jpg|jpeg|png|gif|webp)$/i.test(src)) &&
          !src.includes('qlogo') && !images.includes(src)) {
        images.push(src);
        picsMeta.push({ url: src });
      }
    }

    // ── 第三方应用分享：提取 appName / appShareTitle / unikey / curkey ──
    const appid = matchedBlock?.appid ?? '';
    const typeid = matchedBlock?.typeid ?? '';
    let appName = '';
    let appShareTitle = '';
    let likeUnikey = '';
    let likeCurkey = '';
    let musicShare: { songName: string; artistName?: string; coverUrl?: string; playUrl?: string } | undefined;

    if (appid && appid !== '311') {
      const searchAll = searchBefore + searchAfter;

      // appName：data-appname 属性 或 class 含 app-name 的元素文本
      const appNameM = searchAll.match(/data-appname="([^"]+)"/i)
        ?? searchAll.match(/<[^>]+class="[^"]*(?:app-name|f-app-name)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
      if (appNameM) appName = appNameM[1]!.replace(/<[^>]+>/g, '').trim();

      // ── 音乐分享专用解析（appid=202=网易云音乐，appid=2100=QQ音乐等）──
      if (appid === '202' || appid === '2100') {
        // 提取歌曲名：<h4 class="txt-box-title"><a>{歌曲名}</a></h4>
        const songNameM = searchAll.match(/<h4[^>]+class="[^"]*txt-box-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
        // 提取歌手名：<a class="f-name info state ellipsis-two">{歌手名}</a>
        const artistNameM = searchAll.match(/<a[^>]+class="[^"]*f-name[^"]*info[^"]*"[^>]*>([^<]+)<\/a>/i);
        // 提取封面图：<img trueSrc="{封面URL}">（JS 延迟加载）
        const coverM = searchAll.match(/<img[^>]+trueSrc="([^"]+)"/i);
        // 提取播放链接：<a href="{播放链接}"> 在 img-box 内
        const playUrlM = searchAll.match(/<div[^>]+class="[^"]*img-box[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i);

        if (songNameM) {
          musicShare = {
            songName: songNameM[1]!.trim(),
            artistName: artistNameM?.[1]?.trim(),
            coverUrl: coverM?.[1],
            playUrl: playUrlM?.[1],
          };
          // 音乐分享的 appShareTitle 设为「歌曲名 - 歌手名」格式
          appShareTitle = musicShare.songName + (musicShare.artistName ? ` - ${musicShare.artistName}` : '');
          log('DEBUG', `parseFeeds3Items: music share detected, song=${musicShare.songName}, artist=${musicShare.artistName ?? '(unknown)'}`);
        }
      }

      // 非 musicShare 情况下的 appShareTitle 提取
      if (!musicShare) {
        // appShareTitle：<p class="ell">、f-ct-title、app-title 等区域
        const titleM = searchAll.match(/<p[^>]*class="[^"]*ell[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
          ?? searchAll.match(/<[^>]+class="[^"]*(?:f-ct-title|app-title|app-content-title)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
        if (titleM) appShareTitle = titleM[1]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
      }

      // unikey：优先从 data-unikey 属性提取（点赞按钮上）
      const unM = searchAll.match(/data-unikey="([^"]+)"/i)
        ?? searchAll.match(/unikey\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (unM) likeUnikey = unM[1]!;

      // unikey 也可能直接是分享 href（如网易云、B站链接）
      if (!likeUnikey) {
        const hrefM = searchAll.match(/href="(https?:\/\/(?:y\.music\.163\.com|music\.163\.com|www\.bilibili\.com|b23\.tv)[^"]+)"/i);
        if (hrefM) likeUnikey = hrefM[1]!;
      }

      // curkey：优先从 HTML 的 data-curkey 属性提取（不再推算）
      const ckM = searchAll.match(/data-curkey="([^"]+)"/i)
        ?? searchAll.match(/curkey\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (ckM) likeCurkey = ckM[1]!;

      // 仅在无法从 HTML 提取时才按公式推算 curkey
      if (!likeCurkey && dataUin && abstime) {
        const ts = abstime || (matchedBlock?.timestamp ?? 0);
        if (ts) {
          likeCurkey = '00' + dataUin.padStart(10, '0') + '00' + String(ts).padStart(10, '0');
          log('DEBUG', `parseFeeds3Items: curkey calculated from formula: ${likeCurkey}`);
        }
      }
    }

    const timestamp = abstime || (matchedBlock?.timestamp ?? 0);

    // 评论/拉评论接口需要 key（hex 或短 key）；当 data-tid 为纯数字（abstime）时优先用 data-fkey，否则块内 data-key/key:
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

    // 当前用户是否已点赞：点赞按钮在 feed 底部，用 searchAfter 检测 data-islike="1" 或 class 含 item-on
    const isLiked = /data-islike="1"/.test(searchAfter) || /qz_like_btn[^"]*item-on|item-on[^"]*qz_like_btn/.test(searchAfter);

    const item: Record<string, unknown> = {
      tid: canonicalTid, uin: dataUin, nickname, content,
      created_time: timestamp, createTime: String(timestamp),
      cmtnum, fwdnum: isForward ? 1 : 0,
      pic: images.map(u => ({ url: u })),
      picsMeta: picsMeta.length > 0 ? picsMeta : undefined,
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

  // 按创建时间降序
  msglist.sort((a, b) => {
    const ta = (a['created_time'] as number) || 0;
    const tb = (b['created_time'] as number) || 0;
    return tb - ta;
  });

  log('DEBUG', `parseFeeds3Items: feed_data strategy found ${msglist.length} items`);

  // ---- 策略 2：JS data 数组 fallback ----
  // skipFeedData=true 时强制走 JS 数组（如 scope=1 综合流：feed_data 段只有自己的帖子，JS 数组才有全部好友帖子）
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
        created_time: jsAbstime, createTime: String(jsAbstime),
        cmtnum: 0, fwdnum: jsIsForward ? 1 : 0, pic: [],
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
  } // end JS fallback block

  // ── 最终验证和统计 ──
  stats.durationMs = Date.now() - startTime;

  // 验证所有解析出的条目
  for (const item of msglist) {
    const validation = validateFeedItem(item, stats.strategy);
    if (validation.valid) {
      stats.validItems++;
    } else {
      stats.invalidItems++;
      if (stats.errors.length < 5) { // 限制错误日志数量
        stats.errors.push(`tid=${item['tid']}: ${validation.errors.join(', ')}`);
      }
    }
  }

  stats.totalFound = msglist.length;

  // 输出解析统计
  log('INFO', `parseFeeds3Items: strategy=${stats.strategy}, total=${stats.totalFound}, valid=${stats.validItems}, invalid=${stats.invalidItems}, duration=${stats.durationMs}ms`);
  if (stats.errors.length > 0) {
    log('DEBUG', `parseFeeds3Items validation errors: ${stats.errors.join('; ')}`);
  }

  // 如果有效条目比例过低，发出警告
  if (stats.totalFound > 0 && stats.validItems / stats.totalFound < 0.5) {
    log('WARNING', `parseFeeds3Items: low validation rate ${stats.validItems}/${stats.totalFound} (${Math.round(stats.validItems / stats.totalFound * 100)}%)`);
  }

  return msglist;
}

// ── 深度逆向新发现：辅助解析函数 ─────────────────────────────

/** 解析艾特格式 @{} */
export interface Mention {
  uin: string;
  nick: string;
  who: number;
  auto: number;
}

/**
 * 解析艾特格式内容
 * @param content 原始内容
 * @param options 表情处理选项
 * @returns 解析后的纯文本和艾特列表
 */
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

  // 清理艾特标记，完全移除
  let text = content.replace(mentionPattern, '').trim();

  // 可选：处理表情
  if (options.processEmojis) {
    text = processEmojis(text, { mode: 'name' });
  }

  return { text, mentions };
}

/** 视频信息结构 */
export interface VideoInfo {
  videoId: string;
  coverUrl: string;
  /** 缩略图 URL */
  thumbnailUrl?: string;
  videoUrl?: string;
  duration: number; // 毫秒
  width: number;
  height: number;
}

/**
 * 从说说数据中提取视频信息
 * @param raw 原始说说数据
 * @returns 视频信息数组
 */
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
  /** 被艾特的用户 */
  reply_to_mention?: Mention;
  _source: 'reply_list';
}

/**
 * 解析二级回复（list_3）
 * @param list3 原始 list_3 数组
 * @param parentCommentId 父评论 ID
 * @returns 解析后的二级回复列表
 */
export function parseReplyComments(
  list3: Array<Record<string, unknown>>,
  parentCommentId: string,
): ReplyComment[] {
  const replies: ReplyComment[] = [];

  for (const item of list3) {
    const rawContent = String(item['content'] || '');
    const { text: content, mentions } = parseMentions(rawContent);

    // 提取表情信息
    const { emojis } = parseEmojis(rawContent);

    // 提取被艾特的用户（第一个艾特）
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

/** 增强的评论结构（feeds3 专用，使用下划线命名保持兼容） */
export interface EnhancedComment {
  commentid: string;
  uin: string;
  name: string;
  content: string;
  createtime: number;
  createTime: string;
  createTime2: string;
  reply_num: number;
  /** 二级回复列表 */
  replies?: ReplyComment[];
  /** 艾特的用户列表 */
  mentions?: Mention[];
  source_name?: string;
  source_url?: string;
  t2_source?: number;
  t2_subtype?: number;
  t2_termtype?: number;
  abledel?: number;
  private?: number;
  _source: 'h5_json' | 'feeds3_html';
  /** 包含的表情列表 */
  emojis?: EmojiInfo[];
}

/**
 * 从 h5-json 评论数据解析增强评论
 * @param raw 原始评论数据
 * @returns 增强评论对象
 */
export function parseEnhancedComment(raw: Record<string, unknown>): EnhancedComment {
  const rawContent = String(raw['content'] || '');
  const { text: content, mentions } = parseMentions(rawContent);

  // 提取表情信息
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

  // 解析二级回复
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

/**
 * 提取设备信息
 * @param raw 原始说说数据
 * @returns 设备信息
 */
export function extractDeviceInfo(raw: Record<string, unknown>): DeviceInfo | undefined {
  const name = raw['source_name'] as string;
  if (!name) return undefined;

  return {
    name,
    url: raw['source_url'] as string | undefined,
    termtype: raw['t1_termtype'] as number | undefined,
  };
}

// ── feeds3 评论提取 ─────────────────────────────

/** feeds3 HTML 中解析出来的单条评论 */
export interface Feeds3Comment {
  commentid: string;
  uin: string;
  name: string;
  content: string;
  createtime: number;
  /** 回复目标用户 QQ 号（二级评论） */
  reply_to_uin?: string;
  /** 回复目标用户昵称（二级评论，从 HTML 回复链接提取） */
  reply_to_nickname?: string;
  /** 回复目标评论 ID（二级评论） */
  reply_to_comment_id?: string;
  /** 父评论 ID（二级评论所属的一级评论） */
  parent_comment_id?: string;
  /** 是否为二级评论（回复） */
  is_reply?: boolean;
  _source: 'feeds3_html';
}

/** 验证单条评论的关键字段 */
function validateComment(comment: Record<string, unknown>, source: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!comment['commentid'] || typeof comment['commentid'] !== 'string' || comment['commentid'].length === 0) {
    errors.push('missing or invalid commentid');
  }
  if (!comment['uin'] || typeof comment['uin'] !== 'string' || comment['uin'].length === 0) {
    errors.push('missing or invalid uin');
  }
  if (!comment['name'] || typeof comment['name'] !== 'string' || comment['name'].length === 0) {
    errors.push('missing or invalid name');
  }
  if (typeof comment['content'] !== 'string') {
    errors.push('missing or invalid content type');
  }
  if (typeof comment['createtime'] !== 'number' || comment['createtime'] <= 0) {
    errors.push('missing or invalid createtime');
  }

  if (errors.length > 0 && source === 'root') {
    log('DEBUG', `validateComment [${source}]: commentid=${comment['commentid']}, errors=[${errors.join(', ')}]`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 从文本中提取回复目标昵称。
 * 回复格式：`{昵称}&nbsp;回复<a class="nickname">{目标昵称}</a>&nbsp;:&nbsp;{内容}`
 * 或简化格式：`{昵称} 回复 @{目标昵称} : {内容}`
 */
function extractReplyToNickname(body: string): string | null {
  // 模式1：<a class="nickname">评论者</a>&nbsp;回复<a class="nickname">目标昵称</a>
  // 注意：回复后面可能没有空格，直接紧跟 <a> 标签
  const htmlPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*回复(?:&nbsp;|\s)*<a[^>]*class="[^"]*nickname[^"]*"[^>]*>([^<]+)<\/a>/i;
  const htmlMatch = body.match(htmlPattern);
  if (htmlMatch) {
    return htmlUnescape(htmlMatch[1]!.trim());
  }

  // 模式2：纯文本 "回复 @目标昵称 :"
  const textPattern = /回复\s*[@＠]([^:：\s]+)/i;
  const textMatch = body.match(textPattern);
  if (textMatch) {
    return htmlUnescape(textMatch[1]!.trim());
  }

  return null;
}

/**
 * 从 HTML 中提取表情 img 标签并转换为 [em]eXXX[/em] 格式
 * 支持格式：<img src=".../qzone/em/e103.png" ...>
 */
function extractEmojisFromHtml(html: string): string {
  // 匹配表情图片标签：提取 e103 这样的表情代码
  return html.replace(/<img[^>]+src=["'][^"']*\/qzone\/em\/(e\d+)\.[^"']*["'][^>]*>/gi, (_, code) => {
    return `[em]${code}[/em]`;
  });
}

/**
 * 清理 HTML 标签，但保留已转换的表情标记
 */
function stripHtmlTags(html: string): string {
  // 先转换表情标签
  const withEmojis = extractEmojisFromHtml(html);
  // 再清理所有 HTML 标签
  return withEmojis.replace(/<[^>]+>/g, '');
}

/**
 * 解析评论内容，支持一级评论和二级回复两种格式。
 * - 一级评论：`<a class="nickname">昵称</a>&nbsp;:&nbsp;内容`
 * - 二级回复：`<a class="nickname">昵称</a>&nbsp;回复<a class="nickname">目标</a>&nbsp;:&nbsp;内容`
 */
function extractCommentContent(body: string, isReply: boolean): string {
  // 二级回复：提取 "回复 ... :" 之后的内容
  if (isReply && body.includes('回复')) {
    // 模式：<a>昵称</a>&nbsp;回复<a>目标</a>&nbsp;:&nbsp;内容
    // 注意：回复后面可能没有空格，直接紧跟 <a> 标签
    const replyPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*回复(?:&nbsp;|\s)*<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*[:：](?:&nbsp;|\s)*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|$)/i;
    const replyMatch = body.match(replyPattern);
    if (replyMatch) {
      return htmlUnescape(stripHtmlTags(replyMatch[1]!)).trim();
    }

    // Fallback：简化匹配 "回复 ... : 内容"
    const simplePattern = /回复[\s\S]*?[:：]\s*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|$)/i;
    const simpleMatch = body.match(simplePattern);
    if (simpleMatch) {
      return htmlUnescape(stripHtmlTags(simpleMatch[1]!)).trim();
    }
  }

  // 一级评论：<a class="nickname">昵称</a>&nbsp;:&nbsp;内容
  // 策略1：标准模式，匹配到 comments-op 或 mod-comments-sub
  const rootPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*[:：](?:&nbsp;|\s)*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|<\/div>\s*<div|$)/i;
  const rootMatch = body.match(rootPattern);
  if (rootMatch) {
    return htmlUnescape(stripHtmlTags(rootMatch[1]!)).trim();
  }

  // 策略2：宽松模式，只匹配昵称链接后的冒号和内容
  const loosePattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>\s*[:：]\s*([^<]+)/i;
  const looseMatch = body.match(loosePattern);
  if (looseMatch) {
    return htmlUnescape(looseMatch[1]!.trim());
  }

  // 策略3：从 comments-content div 中提取纯文本（去掉昵称部分）
  const contentPattern = /<div[^>]*class="[^"]*comments-content[^"]*"[^>]*>[\s\S]*?<\/a>\s*[:：]\s*([^<]+(?:<[^>]+>[^<]*)*)/i;
  const contentMatch = body.match(contentPattern);
  if (contentMatch) {
    return htmlUnescape(stripHtmlTags(contentMatch[1]!)).trim();
  }

  return '';
}

/**
 * 解析评论时间戳。
 * 支持格式：「HH:mm」「昨天 HH:mm」「前天 HH:mm」「MM-DD」「YYYY-MM-DD」
 */
function parseCommentTime(body: string): number {
  const timeMatch = body.match(/class="[^"]*\bstate\b[^"]*"[^>]*>\s*([^<]+)/);
  if (!timeMatch) return Math.floor(Date.now() / 1000);

  const ts = timeMatch[1]!.trim();
  const d = new Date();

  // HH:mm（今天）
  const hm = ts.match(/(\d{1,2}):(\d{2})/);
  if (hm) {
    if (ts.includes('昨天')) d.setDate(d.getDate() - 1);
    else if (ts.includes('前天')) d.setDate(d.getDate() - 2);
    else if (!ts.includes('月') && !ts.includes('-')) {
      // 纯时间，默认今天
    }
    d.setHours(parseInt(hm[1]!, 10), parseInt(hm[2]!, 10), 0, 0);
    return Math.floor(d.getTime() / 1000);
  }

  // MM-DD 或 MM月DD日
  const md = ts.match(/(\d{1,2})[-月](\d{1,2})/);
  if (md) {
    d.setMonth(parseInt(md[1]!, 10) - 1, parseInt(md[2]!, 10));
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }

  // YYYY-MM-DD
  const ymd = ts.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/);
  if (ymd) {
    d.setFullYear(parseInt(ymd[1]!, 10), parseInt(ymd[2]!, 10) - 1, parseInt(ymd[3]!, 10));
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }

  return Math.floor(Date.now() / 1000);
}

/**
 * 从 text 的 start 位置起，找到与当前「comments-item」<li> 平衡的 </li> 的结束位置（含 </li>）。
 * 只统计同类的 <li class="comments-item">，避免把 feed 的 <li class="f-single"> 算进去导致越界。
 */
function findMatchingClosingCommentsItemLi(text: string, start: number): number {
  const liCommentsOpen = /<li\s+class="comments-item/g;
  let depth = 1;
  let pos = start;
  while (depth > 0 && pos < text.length) {
    const nextClose = text.indexOf('</li>', pos);
    if (nextClose < 0) return -1;
    liCommentsOpen.lastIndex = pos;
    const openMatch = liCommentsOpen.exec(text);
    const nextOpen = openMatch !== null && openMatch.index < nextClose ? openMatch.index : -1;
    if (nextOpen >= 0) {
      depth++;
      pos = nextOpen + 1;
    } else {
      depth--;
      if (depth === 0) return nextClose + 6;
      pos = nextClose + 1;
    }
  }
  return -1;
}

/**
 * 从 feeds3 HTML 中提取评论详情（含多级评论：commentroot + replyroot）。
 *
 * ## 评论 HTML 结构
 *
 * 一级评论（commentroot）：
 * ```html
 * <li class="comments-item bor3" data-type="commentroot" data-tid="1" data-uin="2849419010" data-nick="go on." data-who="1">
 *   <div class="comments-item-bd">
 *     <div class="comments-content">
 *       <a class="nickname c_tx">go on.</a>&nbsp;:&nbsp;评论内容
 *     </div>
 *     <div class="comments-op">
 *       <span class="state">14:20</span>
 *       <a class="reply" data-param="t1_source=...&t1_tid=xxx&t1_uin=xxx">回复</a>
 *     </div>
 *   </div>
 *   <!-- 子评论区域 -->
 *   <div class="comments-list mod-comments-sub">
 *     <ul>...</ul>
 *   </div>
 * </li>
 * ```
 *
 * 二级回复（replyroot）嵌套在一级评论的 `mod-comments-sub` 中：
 * ```html
 * <li class="comments-item bor3" data-type="replyroot" data-tid="1" data-uin="48166892" data-nick="像风一样的速度">
 *   <div class="comments-content">
 *     <a class="nickname c_tx">像风一样的速度</a>&nbsp;回复&nbsp;<a class="nickname c_tx">go on.</a>&nbsp;:&nbsp;回复内容
 *   </div>
 *   <div class="comments-op">
 *     <a class="reply" data-param="t1_tid=xxx&t2_uin=2849419010&t2_tid=1">回复</a>
 *   </div>
 * </li>
 * ```
 *
 * ## 参数说明
 * - `data-tid`  = 评论序号（在该帖子内从 1 递增）
 * - `data-uin`  = 评论者 QQ
 * - `data-nick` = 评论者昵称
 * - `t1_tid`    = 帖子 TID
 * - `t1_uin`    = 帖子主人 QQ
 * - `t2_uin`    = 被回复者 QQ（二级评论）
 * - `t2_tid`    = 被回复评论的序号（二级评论）
 *
 * 返回 Map<postTid, commentRecords[]>，可直接传给 normalizeComment()。
 * @param text  feeds3_html_more 原始文本（已 unescape）
 */
export function parseFeeds3Comments(
  text: string,
): Map<string, Record<string, unknown>[]> {
  const startTime = Date.now();
  const result = new Map<string, Record<string, unknown>[]>();
  const stats = {
    rootComments: 0,
    replyComments: 0,
    validComments: 0,
    invalidComments: 0,
    errors: [] as string[],
    durationMs: 0,
  };

  // HTML 预处理
  const { text: processedText } = preprocessHtml(text);

  // 先收集全文所有 t1_tid 出现位置，用于关联评论到帖子
  const tidRefs: { index: number; postTid: string }[] = [];
  const tidPat = /t1_tid=([a-z0-9]+)/gi;
  let tidM: RegExpExecArray | null;
  while ((tidM = tidPat.exec(processedText)) !== null) {
    tidRefs.push({ index: tidM.index, postTid: tidM[1]! });
  }

  // 匹配一级评论（data-type="commentroot"）
  const rootCommentPat = /<li\s+class="comments-item[^"]*"[^>]*data-type="commentroot"[^>]*>/gi;
  let rootMatch: RegExpExecArray | null;

  while ((rootMatch = rootCommentPat.exec(processedText)) !== null) {
    const openTag = rootMatch[0];
    const openEnd = rootMatch.index + openTag.length;
    const closeEnd = findMatchingClosingCommentsItemLi(processedText, openEnd);
    if (closeEnd < 0) continue;

    const fullBlock = processedText.slice(rootMatch.index, closeEnd);
    const body = processedText.slice(openEnd, closeEnd - 6);

    // 提取一级评论属性
    const rootTid = openTag.match(/data-tid="([^"]*)"/)?.[1] ?? '';
    const rootUin = openTag.match(/data-uin="([^"]*)"/)?.[1] ?? '';
    const rootNick = openTag.match(/data-nick="([^"]*)"/)?.[1] ?? '';
    if (!rootTid) continue;

    // 提取帖子 TID（t1_tid）
    let postTid = fullBlock.match(/t1_tid=([a-z0-9]+)/i)?.[1] ?? '';
    if (!postTid && tidRefs.length) {
      const next = tidRefs.find((r) => r.index >= closeEnd);
      if (next) postTid = next.postTid;
      else postTid = tidRefs[tidRefs.length - 1]!.postTid;
    }
    if (!postTid) continue;

    // 解析一级评论内容
    const rootContent = extractCommentContent(body, false);
    const rootTime = parseCommentTime(body);

    // 构建一级评论对象
    const rootComment: Record<string, unknown> = {
      commentid: rootTid,
      uin: rootUin,
      name: rootNick,
      content: rootContent,
      createtime: rootTime,
      is_reply: false,
      _source: 'feeds3_html',
    };

    if (!result.has(postTid)) result.set(postTid, []);
    result.get(postTid)!.push(rootComment);

    // ── 解析嵌套的二级回复 ──
    // 二级回复在 <div class="comments-list mod-comments-sub"> 内
    const subCommentsPat = /<div[^>]*class="[^"]*mod-comments-sub[^"]*"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>[\s\S]*?<\/div>/gi;
    let subBlockMatch: RegExpExecArray | null;
    while ((subBlockMatch = subCommentsPat.exec(fullBlock)) !== null) {
      const subUl = subBlockMatch[1]!;

      // 匹配二级回复（data-type="replyroot"）
      const replyPat = /<li\s+class="comments-item[^"]*"[^>]*data-type="replyroot"[^>]*>/gi;
      let replyMatch: RegExpExecArray | null;
      while ((replyMatch = replyPat.exec(subUl)) !== null) {
        const replyOpenTag = replyMatch[0];
        const replyOpenEnd = replyMatch.index + replyOpenTag.length;

        // 二级回复的 </li>（在 subUl 范围内查找）
        const replyCloseEnd = findMatchingClosingCommentsItemLi(subUl, replyOpenEnd);
        if (replyCloseEnd < 0) continue;

        const replyBody = subUl.slice(replyOpenEnd, replyCloseEnd - 6);

        // 提取二级回复属性
        const replyTid = replyOpenTag.match(/data-tid="([^"]*)"/)?.[1] ?? '';
        const replyUin = replyOpenTag.match(/data-uin="([^"]*)"/)?.[1] ?? '';
        const replyNick = replyOpenTag.match(/data-nick="([^"]*)"/)?.[1] ?? '';
        if (!replyTid) continue;

        // 提取 t2_uin（被回复者）和 t2_tid（被回复评论序号）
        const t2Uin = replyBody.match(/t2_uin=(\d+)/i)?.[1] ?? '';
        const t2Tid = replyBody.match(/t2_tid=([^&"\s]+)/i)?.[1] ?? '';

        // 提取回复目标昵称（从 HTML 内容）
        const replyToNickname = extractReplyToNickname(replyBody);

        // 解析二级回复内容
        const replyContent = extractCommentContent(replyBody, true);
        const replyTime = parseCommentTime(replyBody);

        // 构建二级回复对象
        // commentid 格式：{父评论tid}_{回复序号}_{回复者uin}
        const finalReplyId = t2Tid
          ? `${rootTid}_r_${replyTid}_${replyUin}`
          : `${rootTid}_${replyTid}_${replyUin}`;

        const replyComment: Record<string, unknown> = {
          commentid: finalReplyId,
          uin: replyUin,
          name: replyNick,
          content: replyContent,
          createtime: replyTime,
          is_reply: true,
          parent_comment_id: rootTid,
          _source: 'feeds3_html',
        };

        if (t2Uin) replyComment['reply_to_uin'] = t2Uin;
        if (replyToNickname) replyComment['reply_to_nickname'] = replyToNickname;
        if (t2Tid) replyComment['reply_to_comment_id'] = t2Tid;

        result.get(postTid)!.push(replyComment);
        stats.replyComments++;
      }
    }
    stats.rootComments++;
  }

  // ── Fallback：处理没有 data-type 属性的旧格式评论 ──
  // 某些旧版页面可能不区分 commentroot/replyroot
  const legacyCommentPat = /<li\s+class="comments-item[^"]*"([^>]*)>/g;
  let legacyMatch: RegExpExecArray | null;
  const seenCommentIds = new Set<string>();

  // 收集已解析的评论 ID，避免重复
  for (const comments of result.values()) {
    for (const c of comments) {
      seenCommentIds.add(c['commentid'] as string);
    }
  }

  while ((legacyMatch = legacyCommentPat.exec(text)) !== null) {
    const attrs = legacyMatch[1]!;
    // 跳过已处理的 commentroot/replyroot
    if (attrs.includes('data-type="commentroot"') || attrs.includes('data-type="replyroot"')) {
      continue;
    }

    const openEnd = legacyMatch.index + legacyMatch[0].length;
    const closeEnd = findMatchingClosingCommentsItemLi(text, openEnd);
    if (closeEnd < 0) continue;
    const body = text.slice(openEnd, closeEnd - 6);

    const commentId = attrs.match(/data-tid="([^"]*)"/)?.[1] ?? '';
    const uin = attrs.match(/data-uin="([^"]*)"/)?.[1] ?? '';
    const nick = attrs.match(/data-nick="([^"]*)"/)?.[1] ?? '';
    if (!commentId || seenCommentIds.has(commentId)) continue;
    seenCommentIds.add(commentId);

    let postTid = body.match(/t1_tid=([a-z0-9]+)/i)?.[1] ?? '';
    if (!postTid && tidRefs.length) {
      const next = tidRefs.find((r) => r.index >= closeEnd);
      if (next) postTid = next.postTid;
      else postTid = tidRefs[tidRefs.length - 1]!.postTid;
    }
    if (!postTid) continue;

    const isReply = body.includes('回复');
    const content = extractCommentContent(body, isReply);
    const createdTime = parseCommentTime(body);
    const t2Uin = body.match(/t2_uin=(\d+)/i)?.[1] ?? '';
    const t2Tid = body.match(/t2_tid=([^&"\s]+)/i)?.[1] ?? '';
    const replyToNickname = isReply ? extractReplyToNickname(body) : null;

    const comment: Record<string, unknown> = {
      commentid: commentId,
      uin,
      name: nick,
      content,
      createtime: createdTime,
      is_reply: isReply,
      _source: 'feeds3_html',
    };

    if (isReply) {
      if (t2Uin) comment['reply_to_uin'] = t2Uin;
      if (replyToNickname) comment['reply_to_nickname'] = replyToNickname;
      if (t2Tid) comment['reply_to_comment_id'] = t2Tid;
    }

    if (!result.has(postTid)) result.set(postTid, []);
    result.get(postTid)!.push(comment);
  }

  // ── 最终验证和统计 ──
  stats.durationMs = Date.now() - startTime;

  // 验证所有解析出的评论
  for (const comments of result.values()) {
    for (const comment of comments) {
      const validation = validateComment(comment, 'root');
      if (validation.valid) {
        stats.validComments++;
      } else {
        stats.invalidComments++;
        if (stats.errors.length < 10) {
          stats.errors.push(`cid=${comment['commentid']}: ${validation.errors.join(', ')}`);
        }
      }
    }
  }

  const total = stats.rootComments + stats.replyComments;
  log('INFO', `parseFeeds3Comments: posts=${result.size}, root=${stats.rootComments}, replies=${stats.replyComments}, valid=${stats.validComments}, invalid=${stats.invalidComments}, duration=${stats.durationMs}ms`);

  if (stats.errors.length > 0) {
    log('DEBUG', `parseFeeds3Comments validation errors: ${stats.errors.slice(0, 5).join('; ')}${stats.errors.length > 5 ? '...' : ''}`);
  }

  return result;
}

// ── feeds3 点赞提取 ─────────────────────────────

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

/**
 * 从 feeds3 HTML 中提取点赞详情。
 *
 * feeds3 的 feedstype="101" 项就是点赞通知，结构：
 * - `<a href="http://user.qzone.qq.com/{likerUin}" link="nameCard_{likerUin}">{昵称}</a>`
 * - `<i name="feed_data" data-tid="{postTid}" data-uin="{ownerUin}" data-feedstype="101" data-abstime="{timestamp}">`
 * - `<img data-custom_itemid="{iconId}" class="f-like-icon">`
 *
 * 返回 Map<postTid, Feeds3Like[]>，按帖子分组。
 * @param text  feeds3_html_more 原始文本（已 unescape）
 */
export function parseFeeds3Likes(
  text: string,
): Map<string, Feeds3Like[]> {
  const result = new Map<string, Feeds3Like[]>();

  // 匹配每个 feed item div 并提取 feed_data
  const feedItemPat = /<div\s+class="f-item[^"]*f-item-passive"\s+id="feed_(\d+)_(\d+)_(\d+)_(\d+)_\d+_\d+"[\s\S]*?name="feed_data"\s*([^>]*)>[\s\S]*?(?=<div\s+class="f-item|<\/ul>|$)/g;
  const dataAttr = (attrs: string, name: string): string => {
    const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`));
    return m?.[1] ?? '';
  };

  let fm: RegExpExecArray | null;
  while ((fm = feedItemPat.exec(text)) !== null) {
    const feedDataAttrs = fm[5]!;
    const feedstype = dataAttr(feedDataAttrs, 'feedstype');
    if (feedstype !== '101') continue;

    const likerUin = fm[1]!;
    const tid = dataAttr(feedDataAttrs, 'tid');
    const ownerUin = dataAttr(feedDataAttrs, 'uin');
    const abstime = parseInt(dataAttr(feedDataAttrs, 'abstime') || '0', 10);
    if (!tid || !likerUin || likerUin === '0') continue;

    // 提取昵称：在 feed item 之前的 user-info 区域
    const blockStart = Math.max(0, fm.index - 600);
    const preceding = text.substring(blockStart, fm.index);
    let nickname = '';
    const nickMatch = preceding.match(/link="nameCard_\d+"[^>]*>([^<]+)<\/a>/);
    if (nickMatch) {
      nickname = htmlUnescape(nickMatch[1]!.trim());
    }

    // 个性赞图标 ID
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
    result.get(tid)!.push(like);
  }

  // 去重（同一 tid 下同一 uin 只保留最新）
  for (const [tid, likes] of result) {
    const byUin = new Map<string, Feeds3Like>();
    for (const like of likes) {
      const existing = byUin.get(like.uin);
      if (!existing || like.abstime > existing.abstime) {
        byUin.set(like.uin, like);
      }
    }
    result.set(tid, [...byUin.values()]);
  }

  const total = [...result.values()].reduce((s, a) => s + a.length, 0);
  log('DEBUG', `parseFeeds3Likes: found ${total} likes for ${result.size} posts`);
  return result;
}

// ── feeds3 好友提取 ─────────────────────────────

/**
 * 从 feeds3 HTML 文本中提取好友 UIN / 昵称 / 头像。
 * 两层策略：JS opuin 数据 → HTML f-nick 标签。
 *
 * @param text      feeds3 HTML 响应
 * @param selfUin   自身 QQ 号（会被排除）
 */
export function extractFriendsFromFeeds3FromText(
  text: string,
  selfUin: string,
): Array<{ uin: string; nickname: string; avatar: string }> {
  const byUin = new Map<string, { uin: string; nickname: string; avatar: string }>();

  // 1) JS 数据：opuin/uin/nickname/logimg
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

  // 2) HTML f-nick 标签
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

// ── 翻页参数提取 ─────────────────────────────────

/** 从 feeds3 响应中提取 externparam 翻页参数（支持 _Callback JSONP、data.main 或内联） */
export function extractExternparam(text: string): string {
  try {
    const o = (text.trim().startsWith('{') ? JSON.parse(text) : parseJsonp(text)) as Record<string, unknown>;
    const data = o?.data as Record<string, unknown> | undefined;
    const main = data?.main as Record<string, unknown> | undefined;
    const v = (main?.externparam ?? data?.externparam ?? o?.externparam) as string | undefined;
    if (typeof v === 'string' && v.length > 0) return v;
  } catch {
    // 非 JSON/JSONP 或解析失败，用正则
  }
  const m = text.match(/externparam:'([^']+)'/);
  if (m) return m[1]!;
  const m2 = text.match(/"externparam"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m2) return m2[1]!.replace(/\\"/g, '"');
  return '';
}
