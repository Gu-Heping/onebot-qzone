/**
 * feeds3 内容提取（表情、标签清理、正文文本）
 * 供 items（正文）、comments（评论正文）使用
 */

import { processEmojis } from '../emoji.js';

/**
 * 从 HTML 中提取表情 img 标签并转换为 [em]eXXX[/em] 格式
 * 支持格式：<img src=".../qzone/em/e103.png" ...>
 */
export function extractEmojisFromHtml(html: string): string {
  return html.replace(/<img[^>]+src=["'][^"']*\/qzone\/em\/(e\d+)\.[^"']*["'][^>]*>/gi, (_, code) => {
    return `[em]${code}[/em]`;
  });
}

/**
 * 清理 HTML 标签，但保留已转换的表情标记
 */
export function stripHtmlTags(html: string): string {
  const withEmojis = extractEmojisFromHtml(html);
  return withEmojis.replace(/<[^>]+>/g, '');
}

/**
 * 从正文 HTML 中提取可展示文本（含 QQ 表情 img → [em]eXXX[/em] → 转名如 [微笑]）
 * 用于说说正文、转发原文等，避免纯 emoji 被当成无正文。
 */
export function extractFeedContentFromHtml(html: string): string {
  const withEmoji = extractEmojisFromHtml(html);
  const noTags = withEmoji
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\\[trn]/g, '')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
  return processEmojis(noTags, { mode: 'name' });
}
