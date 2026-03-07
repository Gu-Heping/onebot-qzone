/* ─────────────────────────────────────────────
   QZone TypeScript Bridge – utility functions
   ───────────────────────────────────────────── */

import type { ApiResponse } from './types.js';

/** 与 Python calc_gtk 完全一致的 g_tk 计算 */
export function calcGtk(val: string): number {
  let hsh = 5381;
  for (let i = 0; i < val.length; i++) {
    hsh += (hsh << 5) + val.charCodeAt(i);
  }
  return hsh & 0x7fffffff;
}

/** 括号匹配提取 JSONP 内容，fallback 直接 JSON.parse */
export function parseJsonp(text: string, _callback?: string): unknown {
  const s = text.trim();

  // 1. 优先尝试纯 JSON
  if (s.startsWith('{') || s.startsWith('[')) {
    try { return JSON.parse(s); } catch { /* fall through to JSONP extraction */ }
  }

  // 2. 提取 frameElement.callback(...) — publish_v6 返回 HTML 包裹的 JSONP
  const fcbIdx = s.indexOf('frameElement.callback(');
  if (fcbIdx !== -1) {
    const start = fcbIdx + 'frameElement.callback('.length;
    const inner = extractBracketContent(s, start - 1);
    if (inner !== null) {
      try { return JSON.parse(inner); } catch { /* fall through */ }
    }
  }

  // 3. 通用 JSONP: 找第一个 callback(...) 模式
  const open = s.indexOf('(');
  if (open !== -1) {
    const inner = extractBracketContent(s, open);
    if (inner !== null) {
      try { return JSON.parse(inner); } catch { /* fall through */ }
    }
  }

  // 4. 最后尝试原始 JSON.parse
  try {
    return JSON.parse(s);
  } catch {
    return { _empty: true, raw: s.slice(0, 500) };
  }
}

/** 从位置 openIdx 处的 '(' 开始，返回对应 ')' 内部的内容字符串 */
function extractBracketContent(s: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return s.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** 安全解析 JSON/JSONP 响应，处理 GBK/UTF-8 编码差异 */
export function safeDecodeJsonResponse(
  body: Buffer | string,
  jsonpCallback?: string,
): ApiResponse {
  let text: string;
  if (Buffer.isBuffer(body)) {
    // 先尝试 UTF-8，失败则用 latin1（二进制安全，模拟 Python errors='ignore'）
    text = body.toString('utf8');
    if (text.includes('参数错误') || text.includes('\ufffd')) {
      // 尝试 latin1 以保留字节
      const latin = body.toString('latin1');
      if (!latin.includes('\ufffd')) text = latin;
    }
  } else {
    text = body;
  }
  if (!text.trim()) {
    return { _empty: true, http_status: 200 };
  }
  const parsed = parseJsonp(text, jsonpCallback);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as ApiResponse;
  }
  return { _empty: true, raw: text.slice(0, 200) };
}

/** 带时间戳的日志 */
export function log(level: string, msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}

/** URL 转义（等同 Python urllib.parse.quote_plus） */
export function quotePlus(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '+');
}

/** 将 URL 中的 \x26 等转义序列替换为实际字符 */
export function unescapeXHex(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

/** HTML unescape（&amp; &lt; &quot; 等） */
export function htmlUnescape(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}
