/* ─────────────────────────────────────────────
   Playwright 启动辅助 — 统一动态导入 + 启动配置
   ───────────────────────────────────────────── */

import fs from 'node:fs';
import { env } from './config/env.js';

export interface PlaywrightHandle {
  browser: any;
  chromium: any;
}

const SYSTEM_CHROME_PATHS = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
];

function findSystemChrome(): string | undefined {
  for (const p of SYSTEM_CHROME_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return undefined;
}

/**
 * 动态导入 Playwright 并启动 Chromium 浏览器。
 *
 * 查找顺序：
 *  1. QZONE_PLAYWRIGHT_EXECUTABLE 环境变量
 *  2. QZONE_PLAYWRIGHT_CHANNEL 环境变量（默认 'chrome'）
 *  3. 系统 Chrome（/usr/bin/google-chrome-stable 等）
 *  4. Playwright 内置 Chromium
 *
 * @param opts.headless       无头模式，默认 true
 * @param opts.throwOnMissing 找不到 Playwright 时抛出而非返回 null
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

  const launchOpts: Record<string, unknown> = {
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  if (executable) {
    launchOpts.executablePath = executable;
  } else if (channel) {
    launchOpts.channel = channel;
  }

  try {
    const browser = await chromium.launch(launchOpts);
    return { browser, chromium };
  } catch (firstErr: unknown) {
    // channel 模式失败时，尝试系统 Chrome 路径
    if (!executable) {
      const systemChrome = findSystemChrome();
      if (systemChrome) {
        try {
          delete launchOpts.channel;
          launchOpts.executablePath = systemChrome;
          const browser = await chromium.launch(launchOpts);
          return { browser, chromium };
        } catch { /* fall through to original error */ }
      }
    }
    throw firstErr;
  }
}
