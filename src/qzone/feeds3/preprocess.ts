/**
 * feeds3 HTML 预处理
 * 供 items / comments / meta / likes 使用
 */

import { log } from '../utils.js';

/** HTML 预处理：统一清理和规范化 */
export function preprocessHtml(text: string): {
  text: string;
  stats: { originalLength: number; processedLength: number; replacements: number };
} {
  const startTime = Date.now();
  const originalLength = text.length;
  let replacements = 0;

  // 1. 统一换行符
  let processed = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. 常见实体与不间断空格（feeds3 正文里 &nbsp; 极常见）
  processed = processed
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  replacements += (text.match(/&amp;|&lt;|&gt;|&nbsp;|\u00a0/gi) || []).length;

  // 3. 清理多余的空白字符（保留结构需要的）
  processed = processed.replace(/>\s+</g, '><');

  // 4. 处理 JS 转义序列：\\\\/ -> /，\\x27 -> '
  // '\\\\\\\\/' (4 backslashes) creates regex \\\/ which matches \\
  processed = processed.replace(new RegExp('\\\\\\\\/', 'g'), '/')
    .replace(new RegExp('\\\\x27', 'g'), "'");

  const duration = Date.now() - startTime;
  log('DEBUG', `preprocessHtml: ${originalLength} -> ${processed.length} chars, ${replacements} replacements, ${duration}ms`);

  return {
    text: processed,
    stats: { originalLength, processedLength: processed.length, replacements },
  };
}
