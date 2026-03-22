#!/usr/bin/env tsx
/**
 * 按文档列出的 URL 做最小化实机探测（只读 GET / 安全 POST 试探），输出 HTTP 状态、体长、业务 code。
 * 用法: npx tsx scripts/probe-doc-endpoints.ts
 */
import 'dotenv/config';
import type { AxiosRequestConfig } from 'axios';
import { QzoneClient } from '../src/qzone/client.js';
import { parseJsonp } from '../src/qzone/utils.js';
import { USER_AGENTS, getRandomAcceptLanguage, getRandomUserAgent } from '../src/qzone/config/constants.js';

/** 与 client.ts pcHeaders / mobileHeaders 对齐（脚本内联，避免依赖私有方法） */
function makePcHeaders(referrer: string): Record<string, string> {
  return {
    'User-Agent': getRandomUserAgent(),
    'Referer': referrer,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': getRandomAcceptLanguage(),
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': USER_AGENTS.secChUa,
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-site',
    'Cache-Control': 'max-age=0',
  };
}

function makeMobileHeaders(): Record<string, string> {
  return {
    'User-Agent': USER_AGENTS.mobile,
    'Referer': 'https://mobile.qzone.qq.com',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': getRandomAcceptLanguage(),
    'Accept-Encoding': 'gzip, deflate, br',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

function summarizeJson(text: string, isJsonp: boolean): string {
  let raw = text.trim();
  if (!raw) return '(empty)';
  try {
    const o = (isJsonp ? parseJsonp(raw) : JSON.parse(raw)) as Record<string, unknown>;
    const code = o['code'] ?? o['ret'];
    const msg = o['message'] ?? o['msg'] ?? o['subcode'];
    return `code=${JSON.stringify(code)} msg=${String(msg ?? '').slice(0, 80)}`;
  } catch {
    return raw.slice(0, 120).replace(/\s+/g, ' ');
  }
}

async function probe(
  client: QzoneClient,
  label: string,
  method: 'GET' | 'POST',
  url: string,
  opt?: AxiosRequestConfig,
  jsonp = true,
): Promise<void> {
  const { status, text } = await client.request(method, url, opt ?? {});
  const sum = summarizeJson(text, jsonp);
  console.log(`${status}\t${text.length}\t${label}\t${sum}`);
}

async function main(): Promise<void> {
  const cookie = process.env['QZONE_COOKIE'];
  if (!cookie) {
    console.error('缺少 QZONE_COOKIE');
    process.exit(1);
  }
  const client = new QzoneClient();
  await client.loginWithCookieString(cookie);
  const uin = client.qqNumber!;
  const gtk = client.getGtk();
  const ref = `https://user.qzone.qq.com/${uin}/main`;

  // 取一条 tid（走公开 API）
  const el = await client.getEmotionList(uin, 0, 3);
  const ml = el['msglist'] as Array<Record<string, unknown>> | undefined;
  const tid = ml?.[0]?.['tid'] ? String(ml[0]!['tid']) : '';

  console.log(`# probe_date=2026-03-22 uin=${uin} sample_tid=${tid || '(none)'}`);
  console.log('# format: HTTP_STATUS\tBODY_LEN\tLABEL\tPARSED_SUMMARY');

  const hPc = makePcHeaders('https://qzs.qzone.qq.com/');
  const hPcRef = makePcHeaders(ref);
  const hMob = makeMobileHeaders();

  // ── emotion-api.md ──
  await probe(
    client,
    'emotion_cgi_msglist_v6 GET',
    'GET',
    `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?g_tk=${gtk}&uin=${uin}&pos=0&num=5&ftype=0&sort=0&replynum=0&code_version=1&format=json`,
    { headers: hPcRef },
  );

  await probe(
    client,
    'mobile get_mood_list GET',
    'GET',
    `https://mobile.qzone.qq.com/get_mood_list?g_tk=${gtk}&uin=${uin}&pos=0&num=5&format=json`,
    { headers: hMob },
    false,
  );

  await probe(
    client,
    'feeds3_html_more GET (minimal)',
    'GET',
    `https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more?g_tk=${gtk}&uin=${uin}&scope=1&view=1&filter=all&applist=all&refresh=1&pagenum=1&outputhtmlfeed=1&useutf8=1`,
    { headers: hPc },
  );

  if (tid) {
    await probe(
      client,
      'emotion_cgi_getdetailv6 POST',
      'POST',
      `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getdetailv6?g_tk=${gtk}`,
      {
        headers: { ...hPcRef, 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          uin,
          tid,
          format: 'json',
          hostuin: uin,
          qzreferrer: ref,
        }),
      },
    );

    await probe(
      client,
      'emotion_cgi_getdetailv6 GET base',
      'GET',
      `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getdetailv6?g_tk=${gtk}&uin=${uin}&tid=${tid}&format=json`,
      { headers: hPcRef },
    );

    await probe(
      client,
      'mobile.qzone detail GET',
      'GET',
      `https://mobile.qzone.qq.com/detail?g_tk=${gtk}&uin=${uin}&cellid=${tid}&format=json`,
      { headers: hMob },
      false,
    );

    await probe(
      client,
      'emotion_cgi_getcmtreply_v6 GET',
      'GET',
      `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6?g_tk=${gtk}&uin=${uin}&tid=${tid}&num=5&pos=0&format=json`,
      { headers: hPcRef },
    );

    await probe(
      client,
      'mobile get_comment_list GET',
      'GET',
      `https://mobile.qzone.qq.com/get_comment_list?g_tk=${gtk}&uin=${uin}&cellid=${tid}&num=5&pos=0&format=json`,
      { headers: hMob },
      false,
    );

    await probe(
      client,
      'get_like_list GET',
      'GET',
      `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/get_like_list?g_tk=${gtk}&uin=${uin}&tid=${tid}&format=json`,
      { headers: hPcRef },
    );
  }

  // mobile like：仅探测路由是否存在（POST 空体可能 4xx，不触发业务）
  await probe(
    client,
    'mobile like POST (empty probe)',
    'POST',
    `https://mobile.qzone.qq.com/like?g_tk=${gtk}`,
    { headers: { ...hMob, 'Content-Type': 'application/x-www-form-urlencoded' }, data: '' },
    false,
  );

  // h5 域名 re_feeds（文档 feeds3-parser.md）
  await probe(
    client,
    'h5 emotion_cgi_re_feeds GET (route check)',
    'GET',
    `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${gtk}`,
    { headers: hPc },
  );

  // user-api.md
  await probe(
    client,
    'cgi_personal_card GET',
    'GET',
    `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/cgi_personal_card?g_tk=${gtk}&uin=${uin}&format=json`,
    { headers: hPcRef },
  );

  await probe(
    client,
    'mobile list GET',
    'GET',
    `https://mobile.qzone.qq.com/list`,
    { headers: hMob },
    false,
  );

}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
