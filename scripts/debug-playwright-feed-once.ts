#!/usr/bin/env tsx
import 'dotenv/config';
import { env } from '../src/qzone/config/env.js';
import { QzoneClient } from '../src/qzone/client.js';

async function main(): Promise<void> {
  const cookie = env.cookieString;
  if (!cookie) throw new Error('missing QZONE_COOKIE or QZONE_COOKIE_STRING');

  const client = new QzoneClient();
  try {
    await client.loginWithCookieString(cookie);
    if (!client.qqNumber) throw new Error('failed to resolve QQ number from cookie');

    console.log(`[debug-playwright-feed] login ok qq=${client.qqNumber}`);
    const snapshot = await client.getPlaywrightFriendFeedSnapshot(10);
    console.log(
      `[debug-playwright-feed] posts=${snapshot.posts.length} network=${snapshot.networkIntercepted ? 1 : 0} dom=${snapshot.domFallbackUsed ? 1 : 0} responses=${snapshot.interceptedResponseCount} url=${snapshot.pageUrl}`,
    );

    for (const item of snapshot.posts.slice(0, 10)) {
      const nick = String(item['nickname'] ?? item['name'] ?? item['uin'] ?? '');
      const tid = String(item['tid'] ?? item['cellid'] ?? '');
      const uin = String(item['uin'] ?? item['opuin'] ?? '');
      const appid = String(item['appid'] ?? '');
      const liked = Boolean(item['isLiked']) ? 1 : 0;
      const hasLikeKeys = item['likeUnikey'] && item['likeCurkey'] ? 1 : 0;
      console.log(`[debug-playwright-feed] candidate nick=${nick} uin=${uin} tid=${tid} appid=${appid} liked=${liked} likeKeys=${hasLikeKeys}`);
    }
  } finally {
    await client.closeTransientSessions().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[debug-playwright-feed] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
