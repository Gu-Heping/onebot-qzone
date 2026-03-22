/**
 * 拉一页 feeds3，写出原始 HTML、按 feed_data 切段样本，以及各解析器 JSON，供人工对照。
 *
 *   QZONE_CACHE_PATH=test_cache npx tsx scripts/dump-html-vs-parse-audit.ts
 *
 * 输出目录: $QZONE_CACHE_PATH/parse_audit/
 */
import fs from 'node:fs';
import path from 'node:path';
import { QzoneClient } from '../src/qzone/client.js';

/** 脚本调试用：与 getFriendFeeds(fast) 同款单页 HTML */
async function fetchFeeds3HtmlPage(client: QzoneClient, uin: string): Promise<string> {
  const c = client as unknown as {
    fetchFeeds3Html(
      uin: string,
      forceRefresh: boolean,
      scope: number,
      count: number,
    ): Promise<string>;
  };
  return c.fetchFeeds3Html(uin, true, 1, 50);
}
import { preprocessHtml } from '../src/qzone/feeds3/preprocess.js';
import {
  parseFeeds3Items,
  parseFeeds3Comments,
  parseFeeds3CommentsScoped,
  parseFeeds3Likes,
  parseFeeds3PostMeta,
  extractExternparam,
  extractDeviceInfo,
  extractVideos,
  extractFriendsFromFeeds3FromText,
  parseMentions,
} from '../src/qzone/feeds3Parser.js';

function dataAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`));
  return m?.[1] ?? '';
}

async function main(): Promise<void> {
  const cachePath = process.env.QZONE_CACHE_PATH ?? './test_cache';
  const outDir = path.join(cachePath, 'parse_audit');
  fs.mkdirSync(outDir, { recursive: true });

  const client = new QzoneClient({ cachePath });
  if (!client.loggedIn || !client.qqNumber) {
    console.error('未登录');
    process.exit(2);
  }

  const htmlRaw = await fetchFeeds3HtmlPage(client, client.qqNumber);
  const { text: processed } = preprocessHtml(htmlRaw);

  fs.writeFileSync(path.join(outDir, '01_raw_feeds3_response_body.txt'), htmlRaw, 'utf8');
  fs.writeFileSync(path.join(outDir, '02_after_preprocess.html'), processed, 'utf8');

  const items = parseFeeds3Items(htmlRaw, undefined, undefined, 100);
  const commentsMap = parseFeeds3Comments(htmlRaw);
  const scopedComments = parseFeeds3CommentsScoped(processed);
  const likesMap = parseFeeds3Likes(htmlRaw);
  const metaMap = parseFeeds3PostMeta(htmlRaw);

  const extern = extractExternparam(htmlRaw);
  /** 设备 / 视频 字段来自「已解析的 item 对象」，不是直接扫 HTML */
  const deviceFromItems = items
    .slice(0, 10)
    .map((it) => extractDeviceInfo(it as Record<string, unknown>))
    .filter((x): x is NonNullable<typeof x> => x != null);
  const videosFromItems = items.flatMap((it) => extractVideos(it as Record<string, unknown>)).slice(0, 12);
  const friends = extractFriendsFromFeeds3FromText(htmlRaw, client.qqNumber);

  const feedDataRe = /name="feed_data"\s*([^>]*)>/g;
  const fdMatches: { index: number; attrs: string }[] = [];
  let fm: RegExpExecArray | null;
  while ((fm = feedDataRe.exec(processed)) !== null) {
    fdMatches.push({ index: fm.index, attrs: fm[1]! });
  }

  for (let i = 0; i < Math.min(5, fdMatches.length); i++) {
    const start = fdMatches[i]!.index;
    const end = i + 1 < fdMatches.length ? fdMatches[i + 1]!.index : processed.length;
    const slice = processed.slice(start, Math.min(start + 12000, end));
    const tid = dataAttr(fdMatches[i]!.attrs, 'tid');
    const fkey = dataAttr(fdMatches[i]!.attrs, 'fkey');
    fs.writeFileSync(
      path.join(outDir, `03_segment_${i}_tid_${(fkey || tid || 'x').replace(/[^\w.-]+/g, '_').slice(0, 40)}.html`),
      slice,
      'utf8',
    );
  }

  const report: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    loginUin: client.qqNumber,
    sizes: { raw: htmlRaw.length, processed: processed.length, feedDataBlocks: fdMatches.length },
    parseFeeds3Items: items,
    parseFeeds3Comments_keys: [...commentsMap.keys()],
    parseFeeds3Comments: Object.fromEntries(commentsMap),
    parseFeeds3CommentsScoped_keys: [...scopedComments.keys()],
    parseFeeds3CommentsScoped_counts: Object.fromEntries(
      [...scopedComments.entries()].map(([k, v]) => [k, v.length]),
    ),
    parseFeeds3Likes_keys: [...likesMap.keys()],
    parseFeeds3Likes: Object.fromEntries(likesMap),
    parseFeeds3PostMeta_keys: [...metaMap.keys()],
    parseFeeds3PostMeta: Object.fromEntries(metaMap),
    extractExternparam: extern,
    extractDeviceInfo_fromItems_count: deviceFromItems.length,
    extractDeviceInfo_fromItems_sample: deviceFromItems.slice(0, 8),
    extractVideos_fromItems_count: videosFromItems.length,
    extractVideos_fromItems_sample: videosFromItems.slice(0, 6),
    extractFriendsFromFeeds3FromText_count: friends.length,
    extractFriendsFromFeeds3FromText_sample: friends.slice(0, 10),
    parseMentions_on_first_item_content:
      items[0] && typeof items[0]['content'] === 'string'
        ? parseMentions(items[0]['content'] as string)
        : [],
  };

  fs.writeFileSync(path.join(outDir, '04_full_parse_report.json'), JSON.stringify(report, null, 2), 'utf8');

  const perItem: Record<string, unknown>[] = [];
  for (const it of items.slice(0, 8)) {
    const tid = String(it.tid ?? '');
    perItem.push({
      tid,
      itemFields: {
        uin: it.uin,
        nickname: it.nickname,
        content: typeof it.content === 'string' ? (it.content as string).slice(0, 200) : it.content,
        created_time: it.created_time,
        cmtnum: it.cmtnum,
        likenum: it.likenum,
        appid: it.appid,
        typeid: it.typeid,
        appShareTitle: it.appShareTitle,
      },
      comments_count: commentsMap.get(tid)?.length ?? 0,
      comments_sample: (commentsMap.get(tid) ?? []).slice(0, 4),
      likes_count: likesMap.get(tid)?.length ?? 0,
      likes_sample: (likesMap.get(tid) ?? []).slice(0, 6),
      postMeta_lookup_canonical_tid: metaMap.get(tid) ?? null,
      postMeta_note:
        'parseFeeds3PostMeta 按「相邻 t1_tid 引用」划块，键多为 data-param 内 t1_tid，常与 items 的 canonical tid（fkey）不一致',
    });
  }
  fs.writeFileSync(path.join(outDir, '05_per_item_alignment.json'), JSON.stringify(perItem, null, 2), 'utf8');

  console.log('Wrote', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
