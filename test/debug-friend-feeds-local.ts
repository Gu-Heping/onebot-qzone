#!/usr/bin/env npx tsx
/**
 * 本地调试：直接调用 action_get_friend_feeds(include_image_data: true)，
 * 不启动 HTTP 服务，输出含图条数与 base64 覆盖情况，用于确认图片拉取是否正常。
 *
 * 用法:
 *   npx tsx test/debug-friend-feeds-local.ts
 *
 * 依赖 .env 或 QZONE_COOKIE_STRING、QZONE_CACHE_PATH（可选）。
 */
import 'dotenv/config';
import { fromEnv, buildClient } from '../src/bridge/config.js';
import { EventHub } from '../src/bridge/hub.js';
import { EventPoller } from '../src/bridge/poller.js';
import { ActionHandler } from '../src/bridge/actions.js';
import { env } from '../src/qzone/config/env.js';

async function main(): Promise<void> {
  const cookieStr = env.cookieString;
  if (!cookieStr) {
    console.error('缺少 QZONE_COOKIE_STRING，请在 .env 或环境变量中设置');
    process.exit(1);
  }

  const config = fromEnv();
  const client = buildClient(config);
  await client.loginWithCookieString(cookieStr);
  if (!client.loggedIn) {
    console.error('登录失败');
    process.exit(1);
  }

  const hub = new EventHub();
  const poller = new EventPoller(client, hub, config);
  const handler = new ActionHandler(client, hub, poller, config);

  const res = await handler.action_get_friend_feeds(
    { include_image_data: true, num: 20 },
    undefined,
  ) as { retcode: number; data?: { msglist?: unknown[] } };

  if (res.retcode !== 0) {
    console.error('action_get_friend_feeds 失败 retcode:', res.retcode);
    process.exit(1);
  }

  const msglist = res.data?.msglist ?? [];
  let withPic = 0;
  let withBase64 = 0;
  for (const item of msglist) {
    const pic = (item as Record<string, unknown>)['pic'];
    if (Array.isArray(pic) && pic.length > 0) {
      withPic++;
      const first = pic[0];
      const hasB64 = (typeof first === 'object' && first && (first as Record<string, unknown>)['base64']) || false;
      if (hasB64) withBase64++;
    }
  }

  console.log(`msglist: ${msglist.length} 条，含图: ${withPic} 条，图带 base64: ${withBase64} 条`);
  if (withPic > 0 && withBase64 === 0) {
    console.log('未取到 base64：请检查图片 CDN 网络/代理，详见 docs/SERVER_DEBUG.md');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
