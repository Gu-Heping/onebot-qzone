import 'dotenv/config';
import { fromEnv, buildClient } from './bridge/config.js';
import { EventHub } from './bridge/hub.js';
import { EventPoller } from './bridge/poller.js';
import { ActionHandler } from './bridge/actions.js';
import { createApp } from './bridge/server.js';
import { NetworkManager } from './bridge/network.js';
import { log } from './qzone/utils.js';
import { env } from './qzone/config/env.js';

// ── 启动状态面板 ──
function printBanner(lines: string[]): void {
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length));
  const border = '═'.repeat(maxLen + 2);
  console.error(`\n╔${border}╗`);
  for (const l of lines) {
    const pad = ' '.repeat(Math.max(0, maxLen - stripAnsi(l).length));
    console.error(`║ ${l}${pad} ║`);
  }
  console.error(`╚${border}╝\n`);
}
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', W = '\x1b[0m';

async function main(): Promise<void> {
  const config = fromEnv();
  const client = buildClient(config);

  log('INFO', 'QZone Bridge v2.0 (TypeScript) 启动...');

  let loginMethod = '';

  // 1) 若已从缓存加载 Cookie，先校验是否仍有效
  if (client.loggedIn) {
    log('INFO', '检测到已缓存 Cookie，正在校验是否有效...');
    const valid = await client.validateSession();
    if (!valid) {
      // 探针全部失败 → 尝试静默续期（headless Playwright，不弹窗）
      log('WARNING', '探针校验失败，尝试静默续期...');
      const refreshed = await client.refreshSession();
      if (refreshed) {
        log('INFO', `静默续期成功，QQ号: ${client.qqNumber}`);
        loginMethod = '缓存 Cookie + 静默续期';
      } else {
        log('WARNING', '已缓存 Cookie 已失效且续期失败，将清除并重新登录');
        client.logout();
      }
    } else {
      log('INFO', `已登录（缓存有效），QQ号: ${client.qqNumber}`);
      loginMethod = '缓存 Cookie（有效）';
    }
  }

  // 2) 未登录时依次尝试：环境变量 Cookie → 二维码
  if (!client.loggedIn) {
    const cookieStr = env.cookieString;
    if (cookieStr) {
      log('INFO', '使用环境变量 Cookie 登录...');
      try {
        await client.loginWithCookieString(cookieStr);
        if (client.loggedIn) {
          // 环境变量 Cookie 刚设进去，做一次轻量校验
          const valid = await client.validateSession();
          if (!valid) {
            log('WARNING', '环境变量 Cookie 已失效，将清除并尝试其他登录方式');
            client.logout();
          } else {
            log('INFO', `环境变量 Cookie 有效，QQ号: ${client.qqNumber}`);
            loginMethod = '环境变量 Cookie';
            // 同步到 .env（确保下次启动也用最新 Cookie）
            client.syncCookieToEnvFile();
          }
        }
      } catch (e) {
        log('ERROR', `Cookie 登录失败: ${e}`);
        if (config.enableQr) {
          log('INFO', '将尝试二维码登录');
        } else {
          throw e;
        }
      }
    }

    if (!client.loggedIn && config.enableQr) {
      const envHeadless = env.playwrightHeadless;
      const hasDisplay = !!(process.env['DISPLAY'] || process.env['WAYLAND_DISPLAY']);
      const headless = envHeadless !== null ? envHeadless : !hasDisplay;
      if (headless && envHeadless === null) {
        log('INFO', '未检测到图形显示器 ($DISPLAY)，自动切换 headless 模式（二维码保存到文件）');
      }
      log('INFO', `启动 Playwright 浏览器扫码登录 (headless=${headless})...`);
      await client.loginWithPlaywright(300, headless);
      loginMethod = headless ? 'Playwright 扫码 (headless)' : 'Playwright 扫码';
      if (client.loggedIn) client.syncCookieToEnvFile();
    }

    if (!client.loggedIn) {
      log('WARNING', '未登录。请配置 QZONE_COOKIE_STRING 或设置 QZONE_ENABLE_QR=1 后重启。');
    }
  }

  // ── 启动状态面板 ──
  if (client.loggedIn) {
    // 快速读写探测
    let readOk = false, writeOk = false;
    try {
      const r = await client.getEmotionList(client.qqNumber!, 0, 1) as Record<string, unknown>;
      readOk = r?.code === 0 && Array.isArray(r?.msglist) && (r.msglist as unknown[]).length > 0;
    } catch { /* ignore */ }

    try {
      const pubRes: unknown = await client.publish(`[bridge-healthcheck] ${new Date().toISOString()}`);
      let tid: string | undefined;
      if (Array.isArray(pubRes)) tid = pubRes[0] as string;
      else if (pubRes && typeof pubRes === 'object') tid = (pubRes as Record<string, unknown>)?.tid as string;
      if (tid) {
        writeOk = true;
        try { await client.deleteEmotion(tid); } catch { /* cleanup failure ok */ }
      }
    } catch { /* ignore */ }

    const cookieKeys = Object.keys(client.cookies).length;
    const hasPskey = !!client.cookies['p_skey'];
    const hasSkey = !!client.cookies['skey'];
    const hasSuperkey = !!client.cookies['superkey'];

    printBanner([
      `${C}QZone Bridge v2.0${W}  启动状态面板`,
      ``,
      `QQ 号码:    ${G}${client.qqNumber}${W}`,
      `登录方式:    ${loginMethod}`,
      `Cookie 数:   ${cookieKeys} 个  p_skey=${hasPskey ? G + '✓' + W : R + '✗' + W}  skey=${hasSkey ? G + '✓' + W : R + '✗' + W}  superkey=${hasSuperkey ? G + '✓' + W : R + '✗' + W}`,
      ``,
      `读操作测试:  ${readOk ? G + '✓ 成功' + W : R + '✗ 失败' + W}  (getEmotionList)`,
      `写操作测试:  ${writeOk ? G + '✓ 成功' + W : R + '✗ 失败' + W}  (publish + delete)`,
      ``,
      `自动续期:    ${G}已启用${W}  每 4 小时静默刷新（headless，无需扫码）`,
      `.env 同步:   ${G}已启用${W}  续期后自动更新 QZONE_COOKIE`,
      `健康检查:    ${C}http://${config.host}:${config.port}/status${W}`,
    ]);
  } else {
    printBanner([
      `${R}QZone Bridge v2.0  ── 未登录${W}`,
      `请配置 QZONE_COOKIE 或 QZONE_ENABLE_QR=1`,
    ]);
  }

  // Build components
  const hub     = new EventHub();
  const poller  = new EventPoller(client, hub, config);
  const handler = new ActionHandler(client, hub, poller, config);
  const app     = createApp(config, handler, hub, client);
  const network = new NetworkManager(config, handler, hub);

  // Start
  app.start();
  network.start();
  poller.start();

  // Graceful shutdown
  const shutdown = async () => {
    log('INFO', '正在关闭...');
    poller.stop();
    network.stop();
    await app.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
