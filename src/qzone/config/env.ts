/* ─────────────────────────────────────────────
   环境变量统一入口 (Unified Environment)
   所有 QZONE_* 环境变量在此集中读取，
   其余代码通过 `env` 对象访问，不再直接 process.env
   ───────────────────────────────────────────── */

function str(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).trim();
}

function bool(key: string, fallback = false): boolean {
  const v = str(key);
  if (!v) return fallback;
  return ['1', 'true', 'yes'].includes(v.toLowerCase());
}

function int(key: string, fallback: number): number {
  const v = parseInt(str(key), 10);
  return Number.isNaN(v) ? fallback : v;
}

/**
 * QZone 相关环境变量。
 * 每次访问属性都会实时读取 process.env，所以 .env 热重载也能生效。
 */
export const env = {
  // ── Playwright ────────────────────────────
  get playwrightExecutable() { return str('QZONE_PLAYWRIGHT_EXECUTABLE'); },
  get playwrightChannel() { return str('QZONE_PLAYWRIGHT_CHANNEL', 'chrome'); },
  get playwrightTimeoutMs() { return int('QZONE_PLAYWRIGHT_TIMEOUT_MS', 15_000); },
  /** 强制 headless 模式（'1'/'true'=强制 headless，'0'/'false'=强制 headed，空=自动检测 DISPLAY） */
  get playwrightHeadless(): boolean | null {
    const v = str('QZONE_PLAYWRIGHT_HEADLESS');
    if (!v) return null;
    if (['1', 'true', 'yes'].includes(v.toLowerCase())) return true;
    if (['0', 'false', 'no'].includes(v.toLowerCase())) return false;
    return null;
  },

  // ── Cookie ────────────────────────────────
  /** QZONE_COOKIE_STRING 或 QZONE_COOKIE（兼容两种写法） */
  get cookieString() {
    return str('QZONE_COOKIE_STRING') || str('QZONE_COOKIE');
  },

  // ── 调试 / 特性开关 ──────────────────────
  get debugDump() { return bool('QZONE_DEBUG_DUMP'); },
  get friendPlaywright() { return bool('QZONE_FRIEND_PLAYWRIGHT'); },

  // ── 路径 ──────────────────────────────────
  get cachePath() { return str('QZONE_CACHE_PATH', './test_cache'); },
} as const;
