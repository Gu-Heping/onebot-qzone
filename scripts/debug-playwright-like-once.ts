#!/usr/bin/env tsx
import 'dotenv/config';
import { env } from '../src/qzone/config/env.js';
import { QzoneClient } from '../src/qzone/client.js';

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function isSameFeedItem(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftTid = normalizeText(left['tid'] ?? left['cellid']);
  const rightTid = normalizeText(right['tid'] ?? right['cellid']);
  const leftUin = normalizeText(left['uin'] ?? left['opuin']);
  const rightUin = normalizeText(right['uin'] ?? right['opuin']);
  return Boolean(leftTid && rightTid && leftUin && rightUin && leftTid === rightTid && leftUin === rightUin);
}

async function verifyLiked(client: QzoneClient, candidate: Record<string, unknown>): Promise<boolean> {
  const selfUin = client.qqNumber ?? '';
  const targetUin = normalizeText(candidate['uin'] ?? candidate['opuin']);
  const targetTid = normalizeText(candidate['tid'] ?? candidate['cellid']);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await client.verifyLikeInPlaywrightContext(candidate)) return true;
    const snapshot = await client.getPlaywrightFriendFeedSnapshot(10);
    const matched = snapshot.posts.find((item) => isSameFeedItem(item, candidate));
    if (matched && Boolean(matched['isLiked'])) return true;

    try {
      const likes = await client.getLikeListBestEffort(targetUin, targetTid);
      if (likes.some((entry) => normalizeText((entry as Record<string, unknown>)['uin']) === selfUin)) return true;
    } catch {
      // ignore and continue
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  return false;
}

async function main(): Promise<void> {
  const cookie = env.cookieString;
  if (!cookie) throw new Error('missing QZONE_COOKIE or QZONE_COOKIE_STRING');

  const client = new QzoneClient();
  try {
    await client.loginWithCookieString(cookie);
    if (!client.qqNumber) throw new Error('failed to resolve QQ number from cookie');
    console.log(`[debug-playwright-like] login ok qq=${client.qqNumber}`);

    const snapshot = await client.getPlaywrightFriendFeedSnapshot(10);
    console.log(
      `[debug-playwright-like] posts=${snapshot.posts.length} network=${snapshot.networkIntercepted ? 1 : 0} dom=${snapshot.domFallbackUsed ? 1 : 0} responses=${snapshot.interceptedResponseCount}`,
    );

    const candidate = snapshot.posts.find((item) => !Boolean(item['isLiked']));
    if (!candidate) {
      console.log('[debug-playwright-like] no unliked candidate found');
      return;
    }

    const nick = normalizeText(candidate['nickname'] ?? candidate['name'] ?? candidate['uin']);
    const tid = normalizeText(candidate['tid'] ?? candidate['cellid']);
    const uin = normalizeText(candidate['uin'] ?? candidate['opuin']);
    console.log(`[debug-playwright-like] trying nick=${nick} uin=${uin} tid=${tid}`);

    const result = await client.likeWithPlaywrightContext(candidate);
    console.log(`[debug-playwright-like] like result code=${String(result?.['code'] ?? result?.['ret'] ?? 'null')} message=${String(result?.['message'] ?? result?.['msg'] ?? '')}`);

    const verified = await verifyLiked(client, candidate);
    console.log(`[debug-playwright-like] verified=${verified ? 1 : 0}`);
  } finally {
    await client.closeTransientSessions().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[debug-playwright-like] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
