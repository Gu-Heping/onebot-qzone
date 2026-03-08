/* ─────────────────────────────────────────────
   feeds3 HTML 解析器 (Feeds3 Parser)
   从 feeds3_html_more 的 HTML/JS 混合响应中
   提取说说列表、好友列表、翻页参数
   ───────────────────────────────────────────── */

import { log, htmlUnescape, parseJsonp } from './utils.js';

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
  log('DEBUG', `parseFeeds3Items: text length=${text.length}, filterUin=${filterUin}, filterAppid=${filterAppid ?? '(any)'}, maxItems=${maxItems}, skipFeedData=${skipFeedData}`);

  const msglist: Record<string, unknown>[] = [];
  const seenTids = new Set<string>();

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

    const isForward = !!(origTid && origTid !== tid);
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
    for (const im of regionDecoded.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
      const src = im[1]!;
      if ((src.includes('qpic.cn') || src.includes('photo.store.qq.com') ||
           /\.(jpg|jpeg|png|gif|webp)$/i.test(src)) &&
          !src.includes('qlogo') && !images.includes(src)) {
        images.push(src);
      }
    }

    // ── 第三方应用分享：提取 appName / appShareTitle / unikey / curkey ──
    const appid = matchedBlock?.appid ?? '';
    const typeid = matchedBlock?.typeid ?? '';
    let appName = '';
    let appShareTitle = '';
    let likeUnikey = '';
    let likeCurkey = '';

    if (appid && appid !== '311') {
      const searchAll = searchBefore + searchAfter;

      // appName：data-appname 属性 或 class 含 app-name 的元素文本
      const appNameM = searchAll.match(/data-appname="([^"]+)"/i)
        ?? searchAll.match(/<[^>]+class="[^"]*(?:app-name|f-app-name)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
      if (appNameM) appName = appNameM[1]!.replace(/<[^>]+>/g, '').trim();

      // appShareTitle：<p class="ell">、f-ct-title、app-title 等区域
      const titleM = searchAll.match(/<p[^>]*class="[^"]*ell[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
        ?? searchAll.match(/<[^>]+class="[^"]*(?:f-ct-title|app-title|app-content-title)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
      if (titleM) appShareTitle = titleM[1]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();

      // unikey：data-unikey 属性（点赞按钮上）或直接是分享链接
      const unM = searchAll.match(/data-unikey="([^"]+)"/i)
        ?? searchAll.match(/unikey\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (unM) likeUnikey = unM[1]!;

      // unikey 也可能直接是分享 href（如网易云、B站链接）
      if (!likeUnikey) {
        const hrefM = searchAll.match(/href="(https?:\/\/(?:y\.music\.163\.com|music\.163\.com|www\.bilibili\.com|b23\.tv)[^"]+)"/i);
        if (hrefM) likeUnikey = hrefM[1]!;
      }

      // curkey：data-curkey 属性 或 JS 数据中的 curkey 字段
      const ckM = searchAll.match(/data-curkey="([^"]+)"/i)
        ?? searchAll.match(/curkey\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (ckM) likeCurkey = ckM[1]!;

      // 如果 curkey 未从 HTML 提取到，按已知公式推算：00{ouin}00{abstime}
      if (!likeCurkey && dataUin && abstime) {
        const ts = abstime || (matchedBlock?.timestamp ?? 0);
        if (ts) {
          likeCurkey = '00' + dataUin.padStart(10, '0') + '00' + String(ts).padStart(10, '0');
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
      appid,
      typeid,
      appName,
      appShareTitle,
      likeUnikey,
      likeCurkey,
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
  } // end JS fallback block
  return msglist;
}

// ── feeds3 评论提取 ─────────────────────────────

/** feeds3 HTML 中解析出来的单条评论 */
export interface Feeds3Comment {
  commentid: string;
  uin: string;
  name: string;
  content: string;
  createtime: number;
  _source: 'feeds3_html';
}

/**
 * 从 text 的 start 位置起，找到与当前 <li> 平衡的 </li> 的结束位置（含 </li> 这 6 个字符）。
 */
function findMatchingClosingLi(text: string, start: number): number {
  let depth = 1;
  let pos = start;
  while (depth > 0 && pos < text.length) {
    const nextClose = text.indexOf('</li>', pos);
    if (nextClose < 0) return -1;
    const nextOpen = text.indexOf('<li ', pos);
    if (nextOpen >= 0 && nextOpen < nextClose) {
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
 * feeds3 的评论嵌在 `<li class="comments-item">` 内，含 data-type="commentroot"（一级）或 "replyroot"（回复）。
 * - `data-tid`  = 评论 ID
 * - `data-uin`  = 评论者 QQ
 * - `data-nick` = 评论者昵称
 * - 一级正文格式：nickname : TEXT；回复格式：nickname 回复 target : TEXT
 * - 所属说说 TID 在同条块 `data-param` 的 `t1_tid=` 中；回复的被回复人/评论在 `t2_uin`/`t2_tid` 中
 *
 * 返回 Map<postTid, commentRecords[]>，可直接传给 normalizeComment()。
 * @param text  feeds3_html_more 原始文本（已 unescape）
 */
export function parseFeeds3Comments(
  text: string,
): Map<string, Record<string, unknown>[]> {
  const result = new Map<string, Record<string, unknown>[]>();

  // 先收集全文所有 t1_tid 出现位置
  const tidRefs: { index: number; postTid: string }[] = [];
  const tidPat = /t1_tid=([a-z0-9]+)/gi;
  let tidM: RegExpExecArray | null;
  while ((tidM = tidPat.exec(text)) !== null) {
    tidRefs.push({ index: tidM.index, postTid: tidM[1]! });
  }

  const itemStartPat = /<li\s+class="comments-item[^"]*"([^>]*)>/g;
  let m: RegExpExecArray | null;

  while ((m = itemStartPat.exec(text)) !== null) {
    const attrs = m[1]!;
    const openEnd = m.index + m[0].length;
    const closeEnd = findMatchingClosingLi(text, openEnd);
    if (closeEnd < 0) continue;
    const body = text.slice(openEnd, closeEnd - 6);

    const commentId = attrs.match(/data-tid="([^"]*)"/) ?.[1] ?? '';
    const uin       = attrs.match(/data-uin="([^"]*)"/) ?.[1] ?? '';
    const nick      = attrs.match(/data-nick="([^"]*)"/) ?.[1] ?? '';
    const dataType  = attrs.match(/data-type="([^"]*)"/) ?.[1] ?? '';
    if (!commentId) continue;

    let postTid = body.match(/t1_tid=([a-z0-9]+)/i)?.[1] ?? '';
    if (!postTid && tidRefs.length) {
      const commentEnd = closeEnd;
      const next = tidRefs.find((r) => r.index >= commentEnd);
      if (next) postTid = next.postTid;
      else postTid = tidRefs[tidRefs.length - 1]!.postTid;
    }
    if (!postTid) continue;

    const t2Uin = body.match(/t2_uin=(\d+)/i)?.[1] ?? '';
    const t2Tid = body.match(/t2_tid=([^&"\s]+)/i)?.[1] ?? '';

    let content = '';
    if (dataType === 'replyroot' && body.includes('回复')) {
      const replyMatch = body.match(/回复[\s\S]*?<\/a>\s*:\s*([\s\S]*?)(?:<div\s+class="comments-op|$)/);
      if (replyMatch) {
        content = htmlUnescape(replyMatch[1]!.replace(/<[^>]+>/g, '')).trim();
      }
    }
    if (!content) {
      const contentMatch = body.match(
        /<a\s+class="nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;)?\s*:\s*([\s\S]*?)(?:<div\s+class="comments-op|$)/,
      );
      if (contentMatch) {
        content = htmlUnescape(
          contentMatch[1]!.replace(/<[^>]+>/g, ''),
        ).trim();
      }
    }

    let createdTime = Math.floor(Date.now() / 1000);
    const timeMatch = body.match(/class="[^"]*\bstate\b[^"]*"[^>]*>\s*([^<]+)/);
    if (timeMatch) {
      const ts = timeMatch[1]!.trim();
      const hm = ts.match(/(\d{1,2}):(\d{2})/);
      if (hm) {
        const d = new Date();
        if (ts.includes('昨天')) d.setDate(d.getDate() - 1);
        else if (ts.includes('前天')) d.setDate(d.getDate() - 2);
        d.setHours(parseInt(hm[1]!, 10), parseInt(hm[2]!, 10), 0, 0);
        createdTime = Math.floor(d.getTime() / 1000);
      }
    }

    const isReply = dataType === 'replyroot';
    const finalCommentId = isReply && t2Tid
      ? `${t2Tid}_r_${commentId}_${uin}`
      : commentId;

    const comment: Record<string, unknown> = {
      commentid: finalCommentId,
      uin,
      name: nick,
      content,
      createtime: createdTime,
      _source: 'feeds3_html',
    };
    if (isReply && t2Uin) (comment as Record<string, unknown>)['reply_to_uin'] = t2Uin;
    if (isReply && t2Tid) (comment as Record<string, unknown>)['reply_to_comment_id'] = t2Tid;

    if (!result.has(postTid)) result.set(postTid, []);
    result.get(postTid)!.push(comment);
  }

  const total = [...result.values()].reduce((s, a) => s + a.length, 0);
  log('DEBUG', `parseFeeds3Comments: found ${total} comments for ${result.size} posts`);
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
