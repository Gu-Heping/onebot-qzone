#!/usr/bin/env tsx
// @ts-nocheck
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { QzoneClient } from '../src/qzone/client.js';
import { launchPlaywright } from '../src/qzone/playwrightHelper.js';

// ── 配置 ──
const CACHE_DIR = path.resolve('test_cache');
const STATE_PATH = path.join(CACHE_DIR, 'like-browser-state.json');
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const ONCE = ARGS.includes('--once');
const MAX_LIKES = (() => {
  const idx = ARGS.findIndex(a => a.startsWith('--max='));
  return idx >= 0 ? parseInt(ARGS[idx]!.split('=')[1]!, 10) : 50;
})();
const INTERVAL_MS = (() => {
  const idx = ARGS.findIndex(a => a.startsWith('--interval='));
  return idx >= 0 ? parseInt(ARGS[idx]!.split('=')[1]!, 10) * 1000 : 10_000;
})();
const HEADLESS = ARGS.includes('--headless');
const MAX_AGE_SEC = (() => {
  const idx = ARGS.findIndex(a => a.startsWith('--max-age='));
  return idx >= 0 ? parseInt(ARGS[idx]!.split('=')[1]!, 10) : 3600;
})();

interface SeenMap { [key: string]: number }
function loadSeen(): SeenMap {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveSeen(s: SeenMap) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── 主逻辑 ──
async function main() {
  // 1. 登录 & 拉取候选
  const client = new QzoneClient();
  const cookieJson = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'cookies.json'), 'utf8'));
  const cookieMap = cookieJson.cookies as Record<string, string>;
  const cookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

  await client.loginWithCookieString(cookieStr);
  if (!client.loggedIn || !client.qqNumber) throw new Error('Cookie 登录失败');
  const selfUin = client.qqNumber;
    console.log(`[browser-like] QQ=${selfUin} headless=${HEADLESS} interval=${INTERVAL_MS / 1000}s maxAge=${MAX_AGE_SEC}s once=${ONCE}`);

  // 2. 启动浏览器（只开一次）
  console.log('[browser-like] 启动浏览器...');
  const pw = await launchPlaywright({ headless: HEADLESS, throwOnMissing: true });
  const browser = pw!.browser;
  let likedCount = 0;

  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    await ctx.addCookies(
      Object.entries(cookieMap).map(([name, value]) => ({ name, value, domain: '.qq.com', path: '/' })),
    );

    const page = await ctx.newPage();

    // 打开 QZone 主页（只需一次，建立会话）
    console.log('[browser-like] 打开 QZone...');
    await page.goto(`https://user.qzone.qq.com/${selfUin}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(4000);

    const seen = loadSeen();

    // ── 轮询 ──
    let round = 0;
    do {
      round++;
      console.log(`[browser-like] ── 第 ${round} 轮 ──`);
      const likedCount = await runRound(client, page, selfUin, seen, MAX_LIKES);
      console.log(`[browser-like] 第 ${round} 轮: liked=${likedCount}`);
      if (ONCE) break;
      if (round === 1 && likedCount === 0) {
        console.log(`[browser-like] 首轮无可赞，${INTERVAL_MS / 1000}s 后重试...`);
      }
      await sleep(INTERVAL_MS);
    } while (true);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── 单轮执行 ──
async function runRound(
  client: QzoneClient,
  page: any,
  selfUin: string,
  seen: SeenMap,
  maxLikes: number,
): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);
  const feed = await client.getFriendFeedsBestEffort('', 50, { fastMode: true });
  if (!feed.ok) {
    console.log(`[browser-like] 拉取失败: ${feed.details.message}`);
    return 0;
  }
  const allPosts = feed.data.posts as Record<string, unknown>[];

  const moods: Record<string, unknown>[] = [];
  const shares: Record<string, unknown>[] = [];
  let filtSelf = 0, filtLiked = 0, filtSeen = 0, filtOld = 0, filtNoId = 0;
  for (const p of allPosts) {
    const uin = String(p['uin'] ?? p['opuin'] ?? '');
    const tid = String(p['tid'] ?? p['cellid'] ?? '');
    if (!uin || !tid) { filtNoId++; continue; }
    if (uin === selfUin) { filtSelf++; continue; }
    if (Boolean(p['isLiked'])) { filtLiked++; continue; }
    if (seen[`${uin}:${tid}`]) { filtSeen++; continue; }
    const created = Number(p['created_time'] ?? p['createTime'] ?? 0);
    if (MAX_AGE_SEC > 0 && created > 0 && nowSec - created > MAX_AGE_SEC) { filtOld++; continue; }
    (Number(p['appid'] ?? 0) === 311 ? moods : shares).push(p);
  }
  const candidates = [...moods, ...shares].slice(0, maxLikes);
  const filtered = filtSelf + filtLiked + filtSeen + filtOld + filtNoId;
  if (filtered > 0) {
    console.log(`[browser-like] 过滤: 自己${filtSelf} 已赞${filtLiked} 已点${filtSeen} 超时${filtOld} 无ID${filtNoId}`);
  }
  console.log(`[browser-like] 候选: mood=${moods.length} share=${shares.length} (限额 ${maxLikes}, ${MAX_AGE_SEC}s内)`);

  if (candidates.length === 0) return 0;

  let likedCount = 0;
  let pageBtnCount = 0;

  for (const post of candidates) {
    if (likedCount >= maxLikes) break;

    const uin = String(post['uin'] ?? post['opuin'] ?? '');
    const tid = String(post['tid'] ?? post['cellid'] ?? '');
    const nickname = String(post['nickname'] ?? post['name'] ?? uin);

    console.log(`  ${nickname} tid=${tid} appid=${post['appid']}`);

    if (DRY_RUN) {
      seen[`${uin}:${tid}`] = nowSec; pageBtnCount++;
      continue;
    }

    try {
      // 策略1: 页面点击
      const clicked = await page.evaluate(({ tid }: { tid: string }) => {
        const btns = document.querySelectorAll('[data-islike="0"]');
        for (const btn of btns) {
          const uk = btn.getAttribute('data-unikey') ?? '';
          const ck = btn.getAttribute('data-curkey') ?? '';
          const du = btn.getAttribute('data-detailurl') ?? '';
          const pt = (btn.closest('[data-tid]') as HTMLElement | null)?.getAttribute('data-tid') ?? '';
          if (uk.includes(`mood/${tid}`) || ck.includes(tid) || du.includes(tid) || pt === tid) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, { tid });

      if (clicked) {
        await page.waitForTimeout(700); pageBtnCount++; likedCount++;
        seen[`${uin}:${tid}`] = nowSec; saveSeen(seen);
        console.log(`    [✓] 页面点击`);
        await sleep(800 + Math.random() * 1200);
        continue;
      }

      // 策略2: 浏览器内 fetch API
      const apiOk = await likeViaFetch(page, post, selfUin, client.getGtk());
      if (apiOk) {
        likedCount++;
        seen[`${uin}:${tid}`] = nowSec; saveSeen(seen);
        console.log(`    [✓] API`);
        await sleep(800 + Math.random() * 1200);
        continue;
      }

      console.log(`    [✗] 失败`);
      seen[`${uin}:${tid}`] = nowSec; saveSeen(seen);
    } catch (err) {
      console.log(`    [✗] 异常: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return likedCount;
}

// ── 浏览器内 fetch 发 like ──
async function likeViaFetch(
  page: any,
  post: Record<string, unknown>,
  selfUin: string,
  gtk: number,
): Promise<boolean> {
  const uin = String(post['uin'] ?? post['opuin'] ?? '');
  const tid = String(post['tid'] ?? post['cellid'] ?? '');
  const appid = Number(post['appid'] ?? 311);
  const typeid = Number(post['typeid'] ?? 0);
  const abstime = Number(post['created_time'] ?? post['createTime'] ?? Math.floor(Date.now() / 1000));

  // unikey / curkey
  let unikey = String(post['likeUnikey'] ?? '');
  let curkey = String(post['likeCurkey'] ?? '');
  if (!unikey) unikey = `http://user.qzone.qq.com/${uin}/mood/${tid}`;
  if (!curkey) curkey = unikey;

  const body = new URLSearchParams({
    qzreferrer: `https://user.qzone.qq.com/${selfUin}/main`,
    opuin: selfUin,
    unikey,
    curkey,
    appid: String(appid),
    typeid: String(typeid),
    fid: tid,
    from: '1',
    active: '0',
    fupdate: '1',
    abstime: String(abstime),
    format: 'json',
  }).toString();

  // 方法1: internal_dolike_app
  const url1 = `https://user.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app?g_tk=${gtk}`;

  const result1 = await page.evaluate(async ({ url, body }: { url: string; body: string }) => {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body,
        credentials: 'include',
      });
      const json = await resp.json();
      return { ok: Number(json.code ?? -1) === 0 || Number(json.ret ?? -1) === 0, code: json.code };
    } catch (e) {
      return { ok: false, code: -1, error: String(e) };
    }
  }, { url: url1, body });

  if (result1.ok) return true;

  // 方法2: like_cgi_likev6
  const url2 = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/like_cgi_likev6?g_tk=${gtk}`;
  const body2 = new URLSearchParams({
    opuin: selfUin,
    ouin: uin,
    fid: tid,
    abstime: String(abstime),
    appid: String(appid),
    typeid: String(typeid),
    key: '',
    format: 'json',
    qzreferrer: `https://user.qzone.qq.com/${selfUin}/main`,
  }).toString();

  const result2 = await page.evaluate(async ({ url, body }: { url: string; body: string }) => {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body,
        credentials: 'include',
      });
      const json = await resp.json();
      return { ok: Number(json.code ?? -1) === 0 || Number(json.ret ?? -1) === 0, code: json.code };
    } catch (e) {
      return { ok: false, code: -1, error: String(e) };
    }
  }, { url: url2, body: body2 });

  if (result2.ok) return true;

  // 方法3: mobile
  const url3 = `https://mobile.qzone.qq.com/like?g_tk=${gtk}`;
  const body3 = new URLSearchParams({
    unikey,
    curkey: unikey,
    appid: String(appid),
    typeid: String(typeid),
    active: '0',
    fupdate: '1',
  }).toString();

  const result3 = await page.evaluate(async ({ url, body }: { url: string; body: string }) => {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'include',
      });
      const json = await resp.json();
      return { ok: Number(json.code ?? -1) === 0 || Number(json.ret ?? -1) === 0, code: json.code };
    } catch (e) {
      return { ok: false, code: -1, error: String(e) };
    }
  }, { url: url3, body: body3 });

  return result3.ok;
}

main().catch((error) => {
  console.error(`[browser-like] 致命: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
