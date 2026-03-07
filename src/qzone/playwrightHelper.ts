/* ─────────────────────────────────────────────
   Playwright 启动辅助 — 统一动态导入 + 启动配置
   ───────────────────────────────────────────── */

import { env } from './config/env.js';

export interface PlaywrightHandle {
  browser: any;
  chromium: any;
}

/**
 * 动态导入 Playwright 并启动 Chromium 浏览器。
 *
 * @param opts.headless      无头模式，默认 true
 * @param opts.throwOnMissing  找不到 Playwright 时抛出而非返回 null
 * @returns `{ browser, chromium }` 或 `null`（未安装时）
 */
export async function launchPlaywright(
  opts?: { headless?: boolean; throwOnMissing?: boolean },
): Promise<PlaywrightHandle | null> {
  const { headless = true, throwOnMissing = false } = opts ?? {};

  let chromium: any;
  try {
    const pw = await import(/* webpackIgnore: true */ 'playwright');
    chromium = pw.chromium;
  } catch {
    if (throwOnMissing) {
      throw new Error('Playwright 未安装，请运行: npm install playwright');
    }
    return null;
  }

  const executable = env.playwrightExecutable;
  const channel = env.playwrightChannel;

  const launchOpts: Record<string, unknown> = { headless };
  if (executable) launchOpts.executablePath = executable;
  else if (channel) launchOpts.channel = channel;

  const browser = await chromium.launch(launchOpts);
  return { browser, chromium };
}
