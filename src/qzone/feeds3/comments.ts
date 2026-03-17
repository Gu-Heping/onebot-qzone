/**
 * feeds3 评论解析（parseFeeds3Comments）
 * 依赖 preprocess、content
 */

import { log, htmlUnescape } from '../utils.js';
import { preprocessHtml } from './preprocess.js';
import { stripHtmlTags } from './content.js';

export interface Feeds3Comment {
  commentid: string;
  uin: string;
  name: string;
  content: string;
  createtime: number;
  /** 评论中的图片 URL 列表（qpic.cn / photo.store.qq.com） */
  pic?: string[];
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

/** 评论内容 HTML 中排除的图片（表情、头像等） */
const COMMENT_IMG_EXCLUDED = [
  /qzonestyle\.gtimg\.cn\/qzone\/em\//,
  /qzonestyle\.gtimg\.cn\/qzone\/space\//,
  /\/ac\/b\.gif$/,
  /qlogo\.cn/,
  /qzapp\.qlogo\.cn/,
  /qzonestyle\.gtimg\.cn\/act/,
];

function extractImagesFromCommentHtml(html: string): string[] {
  const urls: string[] = [];
  const isUserPic = (u: string) => u.startsWith('http') && !COMMENT_IMG_EXCLUDED.some((p) => p.test(u));
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    const dataSrc = tag.match(/data-src=["']([^"']+)["']/i)?.[1];
    const dataOrig = tag.match(/data-original=["']([^"']+)["']/i)?.[1];
    for (const url of [src, dataSrc, dataOrig]) {
      if (!url || urls.includes(url)) continue;
      if ((url.includes('qpic.cn') || url.includes('photo.store.qq.com')) && isUserPic(url)) urls.push(url);
    }
  }
  return urls;
}

function extractQpicUrlsFromText(html: string, isUserPic: (u: string) => boolean): string[] {
  const urls: string[] = [];
  const pattern = /https?:\/\/[^"'\s<>]*qpic\.cn\/[^"'\s<>]+|https?:\/\/[^"'\s<>]*photo\.store\.qq\.com\/[^"'\s<>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const url = m[0];
    if (isUserPic(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function extractImagesFromCommentThumbnails(body: string): string[] {
  const startIdx = body.search(/<div[^>]*class="[^"]*comments-thumbnails[^"]*"/i);
  if (startIdx < 0) return [];
  const afterOpen = body.indexOf('>', startIdx) + 1;
  const endIdx = body.indexOf('<div', afterOpen);
  const thumbBlock = endIdx > afterOpen ? body.slice(afterOpen, endIdx) : body.slice(afterOpen, afterOpen + 3000);
  const urls: string[] = [];
  const isUserPic = (u: string) => u.startsWith('http') && !COMMENT_IMG_EXCLUDED.some((p) => p.test(u));
  for (const m of thumbBlock.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    const dataSrc = tag.match(/data-src=["']([^"']+)["']/i)?.[1];
    const dataOrig = tag.match(/data-original=["']([^"']+)["']/i)?.[1];
    for (const url of [src, dataSrc, dataOrig]) {
      if (!url || urls.includes(url)) continue;
      if (isUserPic(url) && (url.includes('qpic.cn') || url.includes('photo.store.qq.com') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url))) urls.push(url);
    }
  }
  if (urls.length === 0) {
    const fromText = extractQpicUrlsFromText(thumbBlock, isUserPic);
    for (const u of fromText) if (!urls.includes(u)) urls.push(u);
  }
  return urls;
}

function getCommentContentFragment(body: string, isReply: boolean): string | null {
  function truncateAtCommentsOp(html: string): string {
    const opMatch = html.match(/<div\s+class="[^"]*comments-op[^"]*"/i);
    if (opMatch) {
      let truncated = html.slice(0, opMatch.index);
      const lastLt = truncated.lastIndexOf('<');
      if (lastLt >= 0) {
        const afterLt = truncated.slice(lastLt);
        const looksLikeTag = /^<[a-zA-Z\/]/.test(afterLt);
        const hasClose = afterLt.includes('>');
        if (looksLikeTag && !hasClose) truncated = truncated.slice(0, lastLt);
      }
      return truncated;
    }
    return html;
  }
  if (isReply) {
    const replyPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*回复(?:\s*<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>)(?:&nbsp;|\s)*[:：](?:&nbsp;|\s)*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|$)/i;
    const replyMatch = body.match(replyPattern);
    if (replyMatch) return truncateAtCommentsOp(replyMatch[1]!);
  }
  const rootPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*[:：](?:&nbsp;|\s)*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|<\/div>\s*<div|$)/i;
  const rootMatch = body.match(rootPattern);
  if (rootMatch) return truncateAtCommentsOp(rootMatch[1]!);
  const loosePattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>\s*[:：]\s*([^<]+)/i;
  const looseMatch = body.match(loosePattern);
  if (looseMatch) return looseMatch[1]!.trim();
  const contentPattern = /<div[^>]*class="[^"]*comments-content[^"]*"[^>]*>[\s\S]*?<\/a>\s*[:：]\s*([^<]+(?:<[^>]+>[^<]*)*)/i;
  const contentMatch = body.match(contentPattern);
  if (contentMatch) return truncateAtCommentsOp(contentMatch[1]!);
  return null;
}

/**
 * 解析评论内容并提取其中的图片 URL。
 */
function extractCommentContentAndImages(body: string, isReply: boolean): { content: string; pic: string[] } {
  const fragment = getCommentContentFragment(body, isReply);
  const content = fragment ? htmlUnescape(stripHtmlTags(fragment)).trim() : '';
  const fromFragment = fragment ? extractImagesFromCommentHtml(fragment) : [];
  const fromBody = extractImagesFromCommentHtml(body);
  const fromThumbnails = extractImagesFromCommentThumbnails(body);
  const pic = [...fromFragment];
  for (const url of [...fromBody, ...fromThumbnails]) {
    if (!pic.includes(url)) pic.push(url);
  }
  if (pic.length === 0 && /comments-thumbnails/i.test(body)) {
    const isUserPic = (u: string) => u.startsWith('http') && !COMMENT_IMG_EXCLUDED.some((p) => p.test(u));
    for (const u of extractQpicUrlsFromText(body, isUserPic)) {
      if (!pic.includes(u)) pic.push(u);
    }
  }
  return { content, pic };
}

/**
 * 解析评论内容，支持一级评论和二级回复两种格式。
 * - 一级评论：`<a class="nickname">昵称</a>&nbsp;:&nbsp;内容`
 * - 二级回复：`<a class="nickname">昵称</a>&nbsp;回复<a class="nickname">目标</a>&nbsp;:&nbsp;内容`
 */
function extractCommentContent(body: string, isReply: boolean): string {
  // 辅助函数：截断 comments-op 开始的位置（处理嵌套在 content 内部的情况）
  function truncateAtCommentsOp(html: string): string {
    // 匹配 comments-op div 的开始（作为子元素或兄弟元素）
    const opMatch = html.match(/<div\s+class="[^"]*comments-op[^"]*"/i);
    if (opMatch) {
      // 截断到 comments-op 开始之前
      let truncated = html.slice(0, opMatch.index);
      // 清理可能残留的未闭合 HTML 标签（如 <a href="..." 这样的不完整标签）
      // 检查截断位置前的最后一个 '<'，如果它看起来像标签开头且未闭合，则移除
      const lastLt = truncated.lastIndexOf('<');
      if (lastLt >= 0) {
        const afterLt = truncated.slice(lastLt);
        // 检查 '<' 后面是否跟着标签名字符（a-z, A-Z, /），且没有闭合的 '>'
        // 这样可以避免误伤内容中的 '<' 符号（如 "3 < 5"）
        const looksLikeTag = /^<[a-zA-Z\/]/.test(afterLt);
        const hasClose = afterLt.includes('>');
        if (looksLikeTag && !hasClose) {
          truncated = truncated.slice(0, lastLt);
        }
      }
      return truncated;
    }
    return html;
  }

  // 二级回复：提取 "回复 ... :" 之后的内容
  // 注意：自己对自己的回复没有"回复"文本，格式同一级评论，需要 fallthrough
  if (isReply) {
    // 先检查是否有真正的"回复某人:"模式（排除按钮上的"回复"文字）
    // 模式：<a>昵称</a>&nbsp;回复<a>目标</a>&nbsp;:&nbsp;内容
    const replyPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*回复(?:\s*<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>)(?:&nbsp;|\s)*[:：](?:&nbsp;|\s)*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|$)/i;
    const replyMatch = body.match(replyPattern);
    if (replyMatch) {
      // 再次截断，防止 comments-op 嵌套在 content 内部
      const truncated = truncateAtCommentsOp(replyMatch[1]!);
      return htmlUnescape(stripHtmlTags(truncated)).trim();
    }
    // 如果没有匹配到，可能是自己对自己的回复，继续执行下面的 root 处理
  }

  // 一级评论：<a class="nickname">昵称</a>&nbsp;:&nbsp;内容
  // 策略1：标准模式，匹配到 comments-op 或 mod-comments-sub
  const rootPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*[:：](?:&nbsp;|\s)*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|<\/div>\s*<div|$)/i;
  const rootMatch = body.match(rootPattern);
  if (rootMatch) {
    // 再次截断，防止 comments-op 嵌套在 content 内部
    const truncated = truncateAtCommentsOp(rootMatch[1]!);
    return htmlUnescape(stripHtmlTags(truncated)).trim();
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
    // 再次截断，防止 comments-op 嵌套在 content 内部
    const truncated = truncateAtCommentsOp(contentMatch[1]!);
    return htmlUnescape(stripHtmlTags(truncated)).trim();
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
      // 找评论开始位置之前的最后一个 tid（tid 在评论容器前面）
      const prevTids = tidRefs.filter((r) => r.index < rootMatch!.index);
      if (prevTids.length > 0) {
        postTid = prevTids[prevTids.length - 1]!.postTid;
      }
    }
    if (!postTid) continue;

    const { content: rootContent, pic: rootPic } = extractCommentContentAndImages(body, false);
    const rootTime = parseCommentTime(body);

    const rootComment: Record<string, unknown> = {
      commentid: rootTid,
      uin: rootUin,
      name: rootNick,
      content: rootContent,
      createtime: rootTime,
      is_reply: false,
      _source: 'feeds3_html',
    };
    if (rootPic.length > 0) rootComment['pic'] = rootPic;
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
        const { content: replyContent, pic: replyPic } = extractCommentContentAndImages(replyBody, true);
        const replyTime = parseCommentTime(replyBody);

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
        if (replyPic.length > 0) replyComment['pic'] = replyPic;

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
    const { content, pic: legacyPic } = extractCommentContentAndImages(body, isReply);
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
    if (legacyPic.length > 0) comment['pic'] = legacyPic;
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