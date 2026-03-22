/**
 * 调试用：拉一页 feeds3，打印某 data-tid 附近的 HTML 片段（查 nameCard / data-uin）。
 * QZONE_CACHE_PATH=test_cache npx tsx scripts/inspect-feed-html-slice.ts [tid]
 */
import { QzoneClient } from '../src/qzone/client.js';

const tidArg = process.argv[2] ?? '1774139725';

async function main() {
  const client = new QzoneClient({ cachePath: process.env.QZONE_CACHE_PATH ?? 'test_cache' });
  if (!client.loggedIn) {
    console.error('未登录');
    process.exit(2);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = await (client as any).fetchFeeds3Html(client.qqNumber, true, 0, 20, '', undefined, 'all', 'all') as string;
  const needle = `data-tid="${tidArg}"`;
  let i = text.indexOf(needle);
  if (i < 0) i = text.indexOf(`data-tid='${tidArg}'`);
  console.log('found at', i, 'response len', text.length);
  if (i < 0) process.exit(1);
  const slice = text.slice(Math.max(0, i - 1200), Math.min(text.length, i + 4500));
  console.log(slice.replace(/\s+/g, ' '));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
