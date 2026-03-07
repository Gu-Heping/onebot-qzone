/* ─────────────────────────────────────────────
   Cookie 持久化 – 与 Python _save_cookies/_load_cookies 格式兼容
   ───────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils.js';

export interface CookieData {
  last_used: number;        // Unix 时间戳（秒）
  cookies: Record<string, string>;
}

/** Python 版 cookie_refresh_time = 14 天（单位毫秒） */
const COOKIE_REFRESH_MS = 14 * 24 * 60 * 60 * 1000;

export function saveCookies(cookiePath: string, cookies: Record<string, string>): void {
  try {
    const dir = path.dirname(cookiePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: CookieData = {
      last_used: Date.now() / 1000,
      cookies,
    };
    fs.writeFileSync(cookiePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    log('WARNING', `saveCookies 失败: ${e}`);
  }
}

/**
 * 返回已加载的 cookies map，或 null（文件不存在/已过期/损坏）
 */
export function loadCookies(cookiePath: string): { cookies: Record<string, string>; lastUsed: Date } | null {
  if (!fs.existsSync(cookiePath)) return null;
  try {
    const raw = fs.readFileSync(cookiePath, 'utf8');
    const data: CookieData = JSON.parse(raw);
    const lastUsedMs = data.last_used * 1000;
    if (Date.now() - lastUsedMs > COOKIE_REFRESH_MS) {
      log('INFO', 'Cookie 文件已超过 14 天，将删除');
      fs.unlinkSync(cookiePath);
      return null;
    }
    return {
      cookies: data.cookies ?? {},
      lastUsed: new Date(lastUsedMs),
    };
  } catch {
    try { fs.unlinkSync(cookiePath); } catch { /* ignore */ }
    return null;
  }
}

export function deleteCookies(cookiePath: string): void {
  try {
    if (fs.existsSync(cookiePath)) fs.unlinkSync(cookiePath);
  } catch { /* ignore */ }
}
