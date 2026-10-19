#!/usr/bin/env tsx
/**
 * 二维码扫码登录（Playwright 有头模式）。
 *
 * - 默认非破坏性：已存在有效缓存 Cookie 时直接退出，不覆盖登录状态。
 * - --force       先清除缓存 Cookie，再强制重新扫码。
 * - --no-write-env 登录成功后不把 Cookie 同步写入 .env。
 *
 * 会弹出真实浏览器窗口，适合本机使用；服务器无头环境请用 `npm run dev` 的
 * QZONE_ENABLE_QR=1 流程（二维码保存为图片）。
 */
import 'dotenv/config';
import { QzoneClient } from '../src/qzone/client.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const writeEnv = !args.includes('--no-write-env');

  const client = new QzoneClient();
  if (client.loggedIn && !force) {
    console.log('[qr-login] 已检测到缓存 Cookie；如需重新扫码请加 --force');
    return;
  }
  if (client.loggedIn && force) {
    console.log('[qr-login] --force：清除缓存 Cookie 后重新登录...');
    client.logout();
  }

  console.log('[qr-login] 启动浏览器扫码登录（非 headless 模式，会弹出窗口）...');
  await client.loginWithPlaywright(300, false);

  if (!client.loggedIn || !client.qqNumber) {
    throw new Error('登录失败');
  }

  if (writeEnv) {
    client.syncCookieToEnvFile();
    console.log('[qr-login] Cookie 已同步到 .env');
  } else {
    console.log('[qr-login] 已跳过 .env 写入（--no-write-env）');
  }
  console.log(`[qr-login] 登录成功！QQ号: ${client.qqNumber}`);
}

main().catch((error) => {
  console.error(`[qr-login] 失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
