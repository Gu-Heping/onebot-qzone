/* ─────────────────────────────────────────────
   QzoneClient – TypeScript 移植自 Python qzone_api/client.py
   ───────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import {
  calcGtk,
  parseJsonp,
  safeDecodeJsonResponse,
  log,
  htmlUnescape,
} from './utils.js';
import { saveCookies, loadCookies, deleteCookies } from './cookieStore.js';
import type { ApiResponse, NormalizedItem, PostMeta, UploadImageResult, Routes } from './types.js';
import { parseRawResponse, isGenuineSuccess, type ParsedApiResult } from './requestLayer.js';
import { validateApiResponse } from './validate.js';
import type { SchemaName } from './schemas.js';
import { CACHE_TTL, AUTH_FAILURE_CODES, USER_AGENTS } from './config/constants.js';
import { env } from './config/env.js';
import {
  parseFeeds3Items as _parseFeeds3Items,
  parseFeeds3Comments as _parseFeeds3Comments,
  parseFeeds3Likes as _parseFeeds3Likes,
  extractFriendsFromFeeds3FromText as _extractFriendsFromFeeds3FromText,
  extractExternparam as _extractExternparam,
} from './feeds3Parser.js';
import type { Feeds3Like } from './feeds3Parser.js';
import { launchPlaywright } from './playwrightHelper.js';

// ──────────────────────────────────────────────
// QzoneConfig
// ──────────────────────────────────────────────
export interface QzoneConfig {
  cachePath: string;
}

function defaultConfig(cfg?: Partial<QzoneConfig>): QzoneConfig {
  return { cachePath: './test_cache', ...cfg };
}

// ──────────────────────────────────────────────
// QzoneClient
// ──────────────────────────────────────────────
export class QzoneClient {
  readonly config: QzoneConfig;
  cookies: Record<string, string> = {};
  cookiesLastUsed: Date | null = null;
  qqNumber: string | null = null;

  private jar: CookieJar;
  private http: AxiosInstance;

  // caches
  private qzonetokenCache: string | null = null;
  private qzonetokenCacheTime = 0;
  private qzonetokenTtl = CACHE_TTL.qzonetoken;
  private qzonetokenFailTime = 0;
  private qzonetokenFailTtl = CACHE_TTL.qzonetokenFail;
  private playwrightFailTime = 0;
  private playwrightCooldown = CACHE_TTL.playwrightFail;

  private commentsWinningVariant: number | null = null;
  private detailWinningVariant: number | null = null;
  private commentsAllFailTime = 0;
  private commentsAllFailTtl = CACHE_TTL.commentsAllFail;
  private detailAllFailTime = 0;
  private detailAllFailTtl = CACHE_TTL.detailAllFail;

  private feeds3Cache: Map<string, string> = new Map();
  private feeds3CacheTime: Map<string, number> = new Map();
  private feeds3CacheTtl = CACHE_TTL.feeds3;

  /** feeds3 HTML 中解析出的评论：postTid → comment records（每次 getEmotionListViaFeeds3 刷新） */
  feeds3Comments = new Map<string, Record<string, unknown>[]>();

  /** feeds3 HTML 中解析出的点赞：postTid → Feeds3Like[]（每次 getEmotionListViaFeeds3 刷新） */
  feeds3Likes = new Map<string, Feeds3Like[]>();

  /**
   * 帖子元数据缓存：tid → { uin, appid, typeid, likeUnikey, likeCurkey, abstime }
   * 由 getFriendFeeds / getEmotionListViaFeeds3 / poller 填充，
   * likeEmotion / commentEmotion 在缺失参数时自动查询。
   */
  readonly postMetaCache = new Map<string, PostMeta>();
  private static readonly POST_META_CAPACITY = 1000;

  cachePostMeta(tid: string, meta: PostMeta): void {
    if (!tid) return;
    this.postMetaCache.set(tid, meta);
    if (this.postMetaCache.size > QzoneClient.POST_META_CAPACITY) {
      const oldest = this.postMetaCache.keys().next().value;
      if (oldest) this.postMetaCache.delete(oldest);
    }
  }

  getPostMeta(tid: string): PostMeta | undefined {
    return this.postMetaCache.get(tid);
  }

  /**
   * 若传入的 tid 实为 abstime（纯数字），用 postMetaCache 反查对应的 key（hex tid），
   * 评论接口 PC/mobile 需要 key 格式，用 abstime 会返回空或 -3。
   */
  resolveTidForComments(tid: string): string {
    if (!tid || !/^\d+$/.test(tid)) return tid;
    const abstime = Number(tid);
    for (const [key, meta] of this.postMetaCache) {
      if (meta.abstime === abstime) {
        log('DEBUG', `resolveTidForComments: abstime ${tid} -> key ${key}`);
        return key;
      }
    }
    return tid;
  }

  /** 从 feeds3 解析结果（Record）中提取元数据并写入缓存 */
  cachePostMetaFromRaw(item: Record<string, unknown>): void {
    const tid = String(item['tid'] ?? '');
    if (!tid) return;
    const uin = String(item['uin'] ?? '');
    const appid = String(item['appid'] ?? '311');
    const typeid = String(item['typeid'] ?? '0');
    const likeUnikey = String(item['likeUnikey'] ?? '');
    const likeCurkey = String(item['likeCurkey'] ?? '');
    const abstime = Number(item['created_time'] ?? item['createTime'] ?? 0);
    this.cachePostMeta(tid, { uin, appid, typeid, likeUnikey, likeCurkey, abstime });
  }

  /** 好友缓存：uin -> { uin, nickname, avatar, lastSeen }，持久化到 friends.json */
  private friendCache: Map<string, { uin: string; nickname: string; avatar: string; lastSeen: number }> = new Map();

  routes: Routes = {
    comments: 'pc',
    detail: 'pc',
    delete_comment: 'pc',
    unlike: 'mobile_like_active_1',
  };

  constructor(config?: Partial<QzoneConfig>) {
    this.config = defaultConfig(config);
    this.jar = new CookieJar();
    const baseInstance = axios.create({
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,  // 不抛出 HTTP 错误
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.http = wrapper(baseInstance as any) as AxiosInstance;
    (this.http.defaults as Record<string, unknown>).jar = this.jar;
    this.loadCookies();
    this.loadFriendCache();
  }

  get loggedIn(): boolean {
    return this.qqNumber !== null;
  }

  // ──────────────────────────────────────────────
  // Cookie helpers
  // ──────────────────────────────────────────────
  private get cookiePath(): string {
    return path.join(this.config.cachePath, 'cookies.json');
  }

  private get qrcodePath(): string {
    return path.join(this.config.cachePath, 'qrcode.png');
  }

  private get friendCachePath(): string {
    return path.join(this.config.cachePath, 'friends.json');
  }

  loadCookies(): void {
    const result = loadCookies(this.cookiePath);
    if (!result) return;
    this.cookies = result.cookies;
    this.cookiesLastUsed = result.lastUsed;
    this._syncJarFromMap();
    const rawUin = this.cookies['uin'] ?? '';
    this.qqNumber = rawUin.replace(/^[oO]/, '') || null;
  }

  loadFriendCache(): void {
    try {
      const raw = fs.readFileSync(this.friendCachePath, 'utf8');
      const arr = JSON.parse(raw) as Array<{ uin: string; nickname: string; avatar: string; lastSeen?: number }>;
      if (Array.isArray(arr)) {
        this.friendCache.clear();
        const now = Math.floor(Date.now() / 1000);
        for (const o of arr) {
          if (o && o.uin) {
            this.friendCache.set(o.uin, {
              uin: o.uin,
              nickname: o.nickname ?? '',
              avatar: o.avatar ?? '',
              lastSeen: o.lastSeen ?? now,
            });
          }
        }
        log('DEBUG', `loadFriendCache: ${this.friendCache.size} friends`);
      }
    } catch {
      // 无文件或解析失败则保持空缓存
    }
  }

  saveFriendCache(): void {
    try {
      const arr = Array.from(this.friendCache.values());
      fs.writeFileSync(this.friendCachePath, JSON.stringify(arr, null, 2), 'utf8');
      log('DEBUG', `saveFriendCache: ${arr.length} friends`);
    } catch (e) {
      log('WARNING', `saveFriendCache failed: ${e}`);
    }
  }

  /**
   * 将本次提取的好友列表合并进内存缓存并持久化。仅更新 lastSeen；昵称/头像以新数据覆盖旧。
   */
  private mergeFriendCache(
    items: Array<{ uin: string; nickname: string; avatar: string }>,
  ): void {
    if (!items.length) return;
    const now = Math.floor(Date.now() / 1000);
    for (const it of items) {
      const existing = this.friendCache.get(it.uin);
      this.friendCache.set(it.uin, {
        uin: it.uin,
        nickname: (it.nickname || existing?.nickname) ?? '',
        avatar: (it.avatar || existing?.avatar) ?? '',
        lastSeen: now,
      });
    }
    this.saveFriendCache();
  }

  private saveCookies(): void {
    this.cookiesLastUsed = new Date();
    saveCookies(this.cookiePath, this.cookies);
  }

  /** 将当前 cookies 序列化为 Cookie 字符串（可直接写入 .env / 浏览器） */
  getCookieString(): string {
    return Object.entries(this.cookies)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * 将最新 Cookie 自动写回 .env 文件的 QZONE_COOKIE 字段。
   * 这样即使进程重启，.env 里也是最新的 Cookie，无需手动更新。
   */
  syncCookieToEnvFile(envPath?: string): void {
    const target = envPath ?? path.join(process.cwd(), '.env');
    try {
      if (!fs.existsSync(target)) return;
      let content = fs.readFileSync(target, 'utf8');
      const newCookie = this.getCookieString();
      if (!newCookie) return;

      // 替换 QZONE_COOKIE=... 行
      const re = /^QZONE_COOKIE=.*/m;
      if (re.test(content)) {
        content = content.replace(re, `QZONE_COOKIE=${newCookie}`);
      } else {
        content += `\nQZONE_COOKIE=${newCookie}\n`;
      }
      fs.writeFileSync(target, content, 'utf8');
      log('INFO', '.env 文件 QZONE_COOKIE 已自动更新');
    } catch (e) {
      log('WARNING', `同步 Cookie 到 .env 失败: ${e}`);
    }
  }

  private deleteCookies(): void {
    this.cookies = {};
    this.jar = new CookieJar();
    (this.http.defaults as Record<string, unknown>).jar = this.jar;
    deleteCookies(this.cookiePath);
  }

  /** 把 cookies map 注入 tough-cookie jar（.qq.com 域 + ptlogin2 域） */
  private _syncJarFromMap(): void {
    for (const [name, value] of Object.entries(this.cookies)) {
      for (const domain of ['.qq.com', '.qzone.qq.com', '.ptlogin2.qq.com']) {
        this.jar.setCookieSync(`${name}=${value}; Domain=${domain}; Path=/`, `https://${domain.replace(/^\./, '')}/`);
      }
    }
  }

  /** 从 jar 里同步回 cookies map（.qq.com + ptlogin2 子域） */
  private _syncMapFromJar(): void {
    const urls = [
      'https://qq.com/',
      'https://ptlogin2.qq.com/',
      'https://ssl.ptlogin2.qq.com/',
      'https://xui.ptlogin2.qq.com/',
      'https://qzone.qq.com/',
    ];
    for (const u of urls) {
      const allCookies = this.jar.getCookiesSync(u, { allPaths: true });
      for (const c of allCookies) {
        this.cookies[c.key] = c.value;
      }
    }
  }

  // ──────────────────────────────────────────────
  // HTTP 封装
  // ──────────────────────────────────────────────
  async request(
    method: 'GET' | 'POST',
    url: string,
    options: AxiosRequestConfig = {},
  ): Promise<{ status: number; data: Buffer; text: string }> {
    // 手动注入 cookies
    if (this.cookies && Object.keys(this.cookies).length > 0) {
      const cookieStr = Object.entries(this.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      if (cookieStr) {
        options.headers = { ...options.headers, Cookie: cookieStr };
      }
    }

    options.responseType = 'arraybuffer';

    const resp = await this.http.request({ method, url, ...options });

    // 同步 cookie（仅 .qq.com 相关域）
    this._syncMapFromJar();

    const data = Buffer.from(resp.data as ArrayBuffer);
    const text = data.toString('utf8');

    if (data.length === 0 && resp.status === 200) {
      log('DEBUG', `[empty-200] ${method} ${url.slice(0, 120)}`);
    } else if (resp.status >= 400) {
      log('WARNING', `[http-${resp.status}] ${method} ${url.slice(0, 120)}`);
    }

    return { status: resp.status, data, text };
  }

  async get(url: string, options: AxiosRequestConfig = {}) {
    return this.request('GET', url, options);
  }

  /**
   * 增强型请求：自动 JSONP 解壳 + 反爬检测 + 可选 Zod 校验
   */
  async requestParsed(
    method: 'GET' | 'POST',
    url: string,
    options: AxiosRequestConfig = {},
    opts?: { schemaName?: SchemaName; apiLabel?: string; jsonpCallback?: string },
  ): Promise<ParsedApiResult> {
    const resp = await this.request(method, url, options);
    return parseRawResponse(resp.status, resp.text, opts);
  }

  /** 便捷 GET → ParsedApiResult */
  async getParsed(
    url: string,
    options: AxiosRequestConfig = {},
    opts?: { schemaName?: SchemaName; apiLabel?: string; jsonpCallback?: string },
  ): Promise<ParsedApiResult> {
    return this.requestParsed('GET', url, options, opts);
  }

  /** 便捷 POST → ParsedApiResult */
  async postParsed(
    url: string,
    options: AxiosRequestConfig = {},
    opts?: { schemaName?: SchemaName; apiLabel?: string; jsonpCallback?: string },
  ): Promise<ParsedApiResult> {
    return this.requestParsed('POST', url, options, opts);
  }

  async post(url: string, options: AxiosRequestConfig = {}) {
    // 自动注入 Origin
    const headers = (options.headers ?? {}) as Record<string, string>;
    if (!headers['Origin']) {
      if (url.includes('user.qzone.qq.com') || url.includes('taotao.qzone.qq.com') || url.includes('sns.qzone.qq.com')) {
        headers['Origin'] = 'https://user.qzone.qq.com';
      } else if (url.includes('up.qzone.qq.com')) {
        headers['Origin'] = 'https://up.qzone.qq.com';
      } else if (url.includes('mobile.qzone.qq.com') || url.includes('h5.qzone.qq.com')) {
        headers['Origin'] = 'https://mobile.qzone.qq.com';
      } else {
        headers['Origin'] = 'https://qzs.qzone.qq.com';
      }
    }
    options.headers = headers;
    return this.request('POST', url, options);
  }

  // ──────────────────────────────────────────────
  // Header 工厂
  // ──────────────────────────────────────────────
  private static UA = USER_AGENTS.desktop;
  private static SEC_CH_UA = USER_AGENTS.secChUa;

  private pcHeaders(referrer?: string, origin?: string): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': QzoneClient.UA,
      'Referer': referrer ?? 'https://qzs.qzone.qq.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Sec-Ch-Ua': QzoneClient.SEC_CH_UA,
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
    };
    if (origin) h['Origin'] = origin;
    return h;
  }

  private mobileHeaders(origin?: string): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': USER_AGENTS.mobile,
      'Referer': 'https://mobile.qzone.qq.com',
    };
    if (origin) h['Origin'] = origin;
    return h;
  }



  // ──────────────────────────────────────────────
  // CSRF / Auth
  // ──────────────────────────────────────────────
  getGtk(): number {
    const pSkey = this.cookies['p_skey'] ?? '';
    if (pSkey) return calcGtk(pSkey);
    const skey = this.cookies['skey'] ?? '';
    if (skey) return calcGtk(skey);
    log('WARNING', 'p_skey 和 skey 均为空，g_tk 将为 5381');
    return calcGtk('');
  }

  private getQzreferrer(): string {
    return `https://user.qzone.qq.com/${this.qqNumber}`;
  }

  isAuthFailure(payload: ApiResponse): boolean {
    const code = payload.code as number | undefined;
    return code !== undefined && AUTH_FAILURE_CODES.has(code);
  }

  private requireLogin(): void {
    if (!this.loggedIn) throw new Error('未登录');
  }

  dumpDebugPayload(name: string, content: string): void {
    if (!env.debugDump) return;
    const dir = path.join(this.config.cachePath, 'debug');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.TZ]/g, '').slice(0, 15);
    fs.writeFileSync(path.join(dir, `${name}_${ts}.txt`), content, 'utf8');
  }

  // ──────────────────────────────────────────────
  // Login helpers
  // ──────────────────────────────────────────────

  async loginWithCookieString(cookieStr: string): Promise<void> {
    const parsed: Record<string, string> = {};
    for (const part of cookieStr.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      parsed[k] = v;
    }
    const required = ['uin', 'p_skey', 'skey', 'p_uin'];
    if (!required.some(k => k in parsed)) {
      throw new Error('Cookie 字符串缺少关键字段（uin/p_skey/skey/p_uin）');
    }

    this.jar = new CookieJar();
    (this.http.defaults as Record<string, unknown>).jar = this.jar;
    this.cookies = {};
    for (const [k, v] of Object.entries(parsed)) {
      this.cookies[k] = v;
    }
    this._syncJarFromMap();

    let uin = parsed['uin'] ?? parsed['p_uin'] ?? '';
    if (/^[oO]/.test(uin)) uin = uin.slice(1);
    this.qqNumber = uin || null;
    if (!this.qqNumber) throw new Error('无法从 Cookie 中解析 QQ 号');

    try {
      const resp = await this.get(`https://user.qzone.qq.com/${this.qqNumber}`);
      if (resp.status >= 400 && resp.status !== 501) {
        throw new Error(`Cookie 登录校验失败，HTTP ${resp.status}`);
      }
      if (resp.text.includes('ptlogin2.qq.com') && resp.text.toLowerCase().includes('login') && !resp.text.includes(this.qqNumber)) {
        log('WARNING', 'Cookie 可能已过期，但仍尝试继续');
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith('Cookie 登录校验失败')) throw e;
      log('WARNING', `Cookie 登录校验请求失败: ${e}，跳过校验继续`);
    }

    this.saveCookies();
    log('INFO', `Cookie 登录成功，QQ号: ${this.qqNumber}`);
  }


  // 
  // Playwright QR login（真实浏览器扫码）
  // 
  async loginWithPlaywright(
    timeoutSeconds = 300,
    headless = false,
  ): Promise<void> {
    if (this.loggedIn) return;

    log('INFO', 'Playwright QR 登录：启动浏览器...');
    const pw = await launchPlaywright({ headless, throwOnMissing: true });
    const browser = pw!.browser;
    try {
      const ctx = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 400, height: 320 },
      });
      const page = await ctx.newPage();

      const xloginUrl =
        'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=549000912&daid=5&style=40&target=self' +
        '&s_url=https%3A%2F%2Fqzs.qzone.qq.com%2Fqzone%2Fv5%2Floginsucc.html%3Fpara%3Dizone' +
        '&pt_3rd_aid=0&hide_title_bar=1&hide_border=1';

      await page.goto(xloginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // 保存 QR 码图片到磁盘
      const cacheDir = this.config.cachePath;
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      const absQrPath = path.resolve(this.qrcodePath);
      await this._saveQrCode(page, absQrPath);

      if (headless) {
        log('INFO', `请用手机 QQ 扫描二维码文件: ${absQrPath}`);
        log('INFO', '扫码后请在手机上确认登录，等待自动跳转');
      } else {
        log('INFO', `浏览器已打开，请用手机 QQ 扫描屏幕上的二维码（文件: ${absQrPath}）`);
      }

      // 等待登录成功（页面会经历多级跳转：ptlogin → check_sig → loginsucc → qzone）
      const deadline = Date.now() + timeoutSeconds * 1000;
      let loggedIn = false;

      while (Date.now() < deadline) {

        const currentUrl = page.url();
        // 用 URL 的 pathname+host 来判断，避免 s_url 参数里的 loginsucc/qzone 字样误匹配
        let parsedHost = '';
        let parsedPath = '';
        try {
          const u = new URL(currentUrl);
          parsedHost = u.hostname;
          parsedPath = u.pathname;
        } catch { /* ignore */ }

        log('DEBUG', `Playwright 当前: ${parsedHost}${parsedPath}`);

        // loginsucc 页面说明身份验证已通过（pathname 中含 loginsucc）
        if (parsedPath.includes('loginsucc')) {
          log('INFO', '检测到 loginsucc 页面，等待 Cookie 完全种入...');
          await page.waitForTimeout(3000);
          try {
            await page.goto('https://user.qzone.qq.com/', {
              waitUntil: 'domcontentloaded',
              timeout: 15000,
            });
          } catch { /* timeout is ok, cookies should be set by now */ }
          await page.waitForTimeout(2000);
          loggedIn = true;
          break;
        }

        // 如果已经到了 user.qzone.qq.com 主页
        if (
          parsedHost.includes('user.qzone.qq.com') &&
          !parsedHost.includes('ptlogin2')
        ) {
          log('INFO', '已到达 QZone 主页');
          await page.waitForTimeout(3000);
          loggedIn = true;
          break;
        }

        await page.waitForTimeout(2000);
      }

      if (!loggedIn) {
        throw new Error(`Playwright 扫码登录超时（${timeoutSeconds} 秒）`);
      }

      log('INFO', '扫码成功，正在提取 Cookie...');

      // 从浏览器提取所有域的 cookie（确保拿到 p_skey、skey 等关键字段）
      const browserCookies = await ctx.cookies([
        'https://qq.com',
        'https://qzone.qq.com',
        'https://user.qzone.qq.com',
        'https://qzs.qzone.qq.com',
        'https://ptlogin2.qq.com',
        'https://ssl.ptlogin2.qq.com',
      ]);
      log('DEBUG', `提取到 ${browserCookies.length} 个 Cookie: ${browserCookies.map((c: any) => c.name).join(', ')}`);

      this.jar = new CookieJar();
      (this.http.defaults as Record<string, unknown>).jar = this.jar;
      this.cookies = {};

      for (const c of browserCookies) {
        this.cookies[c.name] = c.value;
      }
      this._syncJarFromMap();

      const rawUin = this.cookies['uin'] ?? '';
      this.qqNumber = rawUin.replace(/^[oO]/, '') || null;
      if (!this.qqNumber) {
        // 尝试从 p_uin 获取
        const pUin = this.cookies['p_uin'] ?? '';
        this.qqNumber = pUin.replace(/^[oO]/, '') || null;
      }
      if (!this.qqNumber) throw new Error('登录成功但未获取到 QQ 号');

      this.saveCookies();
      try { fs.unlinkSync(absQrPath); } catch { /* ignore */ }
      log('INFO', `Playwright QR 登录成功，QQ号: ${this.qqNumber}`);

      await ctx.close();
    } finally {
      await browser.close();
    }
  }

  logout(): void {
    this.qqNumber = null;
    this.deleteCookies();
  }

  /**
   * 保存 QR 码到文件。优先提取 img.src 直接下载（绕过截图字体渲染问题），
   * 失败则尝试元素截图，最后回退到整页截图。
   */
  private async _saveQrCode(page: any, absQrPath: string): Promise<void> {
    const selectors = '#qrlogin_img, img[src*="ptqrshow"]';

    // 方案 1: 提取 QR 图片 src 直接下载（最可靠）
    try {
      const qrImg = page.locator(selectors).first();
      await qrImg.waitFor({ state: 'visible', timeout: 15000 });
      const src: string = await qrImg.getAttribute('src', { timeout: 5000 });
      if (src && (src.startsWith('http') || src.startsWith('//'))) {
        const imgUrl = src.startsWith('//') ? `https:${src}` : src;
        const resp = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(absQrPath, buf);
          log('INFO', `QR 码已保存到: ${absQrPath}（直接下载）`);
          return;
        }
      }
    } catch { /* fall through */ }

    // 方案 2: 元素截图
    try {
      const qrImg = page.locator(selectors).first();
      const isVisible = await qrImg.isVisible().catch(() => false);
      if (isVisible) {
        await qrImg.screenshot({ path: absQrPath, timeout: 10000 });
        log('INFO', `QR 码已保存到: ${absQrPath}（元素截图）`);
        return;
      }
    } catch { /* fall through */ }

    // 方案 3: 整页截图
    try {
      await page.screenshot({ path: absQrPath, timeout: 15000 });
      log('INFO', `QR 码截图已保存到: ${absQrPath}（整页截图）`);
    } catch {
      log('WARNING', `QR 码截图全部失败，请手动访问缓存目录: ${path.dirname(absQrPath)}`);
    }
  }

  // ──────────────────────────────────────────────
  // 静默会话续期（Playwright headless，无需扫码）
  // ──────────────────────────────────────────────
  private lastRefreshTime = 0;

  /**
   * 使用 headless Playwright 静默刷新 Cookie。
   * 注入当前 Cookie → 打开 QZone 页面 → 提取刷新后的 Cookie。
   * 不弹出登录窗口，不需要扫码。
   * @returns true=刷新成功 / false=刷新失败（Cookie 可能已过期）
   */
  async refreshSession(): Promise<boolean> {
    if (!this.loggedIn || !this.qqNumber) return false;

    log('INFO', '静默刷新 Cookie（headless Playwright）...');
    const pw = await launchPlaywright();
    if (!pw) {
      log('WARNING', 'refreshSession: Playwright 未安装，跳过静默续期');
      return false;
    }
    let browser: any = pw.browser;
    try {
      const ctx = await browser.newContext({
        userAgent: QzoneClient.UA,
        viewport: { width: 1280, height: 800 },
      });

      // 注入当前 cookies
      const cookieArray: Array<{ name: string; value: string; domain: string; path: string }> = [];
      for (const [name, value] of Object.entries(this.cookies)) {
        for (const domain of ['.qq.com', '.qzone.qq.com', '.ptlogin2.qq.com']) {
          cookieArray.push({ name, value, domain, path: '/' });
        }
      }
      await ctx.addCookies(cookieArray);

      const page = await ctx.newPage();

      // 访问 QZone 主页，触发服务端 Cookie 刷新
      await page.goto(`https://user.qzone.qq.com/${this.qqNumber}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForTimeout(3000);
      try {
        await page.goto(`https://user.qzone.qq.com/${this.qqNumber}/311`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);
      } catch { /* timeout ok */ }

      // 检查是否跳到了登录页（Cookie 已失效）
      const currentUrl = page.url();
      if (currentUrl.includes('ptlogin2.qq.com') || currentUrl.includes('xui.ptlogin2')) {
        log('WARNING', 'refreshSession: 被重定向到登录页，Cookie 已真正过期');
        await ctx.close();
        await browser.close();
        return false;
      }

      // 提取刷新后的 cookies
      const browserCookies = await ctx.cookies([
        'https://qq.com',
        'https://qzone.qq.com',
        'https://user.qzone.qq.com',
        'https://qzs.qzone.qq.com',
        'https://ptlogin2.qq.com',
        'https://ssl.ptlogin2.qq.com',
      ]);

      // 合并新 cookies（保留旧的，覆盖有新值的）
      let updated = 0;
      for (const c of browserCookies) {
        if (c.value && c.value !== this.cookies[c.name]) {
          updated++;
        }
        if (c.value) this.cookies[c.name] = c.value;
      }

      await ctx.close();
      await browser.close();
      browser = null;

      // 重新同步到 jar
      this.jar = new CookieJar();
      (this.http.defaults as Record<string, unknown>).jar = this.jar;
      this._syncJarFromMap();

      this.saveCookies();
      this.lastRefreshTime = Date.now();
      this.resetApiCaches();

      // 续期成功后自动写回 .env
      this.syncCookieToEnvFile();

      const hasPskey = !!this.cookies['p_skey'];
      const hasSkey = !!this.cookies['skey'];
      log('INFO', `静默续期完成: ${updated} cookie(s) 更新, p_skey=${hasPskey ? '✓' : '✗'}, skey=${hasSkey ? '✓' : '✗'}`);
      return hasPskey && hasSkey;
    } catch (exc) {
      log('WARNING', `refreshSession 失败: ${exc}`);
      if (browser) try { await browser.close(); } catch {}
      return false;
    }
  }

  /** 距上次静默刷新的秒数 */
  get secondsSinceLastRefresh(): number {
    if (!this.lastRefreshTime) return Infinity;
    return (Date.now() - this.lastRefreshTime) / 1000;
  }

  resetApiCaches(): void {
    this.qzonetokenCache = null;
    this.qzonetokenCacheTime = 0;
    this.qzonetokenFailTime = 0;
    this.playwrightFailTime = 0;
    this.commentsWinningVariant = null;
    this.detailWinningVariant = null;
    this.commentsAllFailTime = 0;
    this.detailAllFailTime = 0;
    this.feeds3Cache.clear();
    this.feeds3CacheTime.clear();
    this.feeds3Comments.clear();
    this.feeds3Likes.clear();
  }

  // ──────────────────────────────────────────────
  // Session validation
  // ──────────────────────────────────────────────

  /**
   * 校验当前 Cookie 是否仍然有效。
   * 依次尝试多种轻量探针，任一成功即认为有效。
   * 逻辑：快速探针 → 中量探针 → 重量级探针，early-return。
   */
  async validateSession(): Promise<boolean> {
    if (!this.qqNumber) return false;

    // 方法0: 如果 Cookie 刚保存不久（<5分钟），跳过网络校验直接信任
    if (this.cookiesLastUsed) {
      const ageMs = Date.now() - this.cookiesLastUsed.getTime();
      if (ageMs < 5 * 60 * 1000) {
        log('DEBUG', `validateSession: cookies fresh (${Math.round(ageMs / 1000)}s ago), skip probe`);
        return true;
      }
    }

    // 方法1: 直接用 g_tk 请求 emotion_cgi_msglist_v6（proxy-json）— 最常用 API
    try {
      const gtk = String(this.getGtk());
      const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${this.qqNumber}&hostuin=${this.qqNumber}&num=1&pos=0&format=json&g_tk=${gtk}`;
      const resp = await this.get(url, {
        headers: this.pcHeaders(`https://user.qzone.qq.com/${this.qqNumber}/311`),
      });
      const result = parseJsonp(resp.text) as ApiResponse;
      const code = result['code'] as number | undefined;
      // code=0 明确成功; code=-10000 限流但 Cookie 有效; code=-2/-3/-3000 才是真失败
      if (code === 0 || code === -10000) {
        log('DEBUG', `validateSession: emotion_cgi_msglist_v6 OK (code=${code})`);
        return true;
      }
    } catch { /* try next */ }

    // 方法2: feeds3 首页请求 — 几乎不被限流
    try {
      const feeds3Url = `https://user.qzone.qq.com/${this.qqNumber}/311`;
      const resp = await this.get(feeds3Url, { headers: this.pcHeaders() });
      // 如果返回了包含用户数据的页面（非登录跳转），则有效
      if (resp.status === 200 && resp.text.length > 5000 &&
          !resp.text.includes('ptlogin2.qq.com') && resp.text.includes(this.qqNumber!)) {
        log('DEBUG', 'validateSession: feeds3 page OK');
        return true;
      }
    } catch { /* try next */ }

    // 方法3: visitor list (之前用的探针)
    try {
      const res = await this.getVisitorList(this.qqNumber);
      if (res && !res['_empty'] && (res['code'] as number | undefined) !== -3000) {
        log('DEBUG', 'validateSession: visitor list OK');
        return true;
      }
    } catch { /* try next */ }

    // 方法4: qzonetoken (最慢，如果 Playwright 冷却中会直接跳过)
    try {
      const token = await this.getQzonetoken();
      if (token) {
        log('DEBUG', 'validateSession: qzonetoken OK');
        return true;
      }
    } catch { /* fail */ }

    log('WARNING', 'validateSession: all probes failed');
    return false;
  }

  // ──────────────────────────────────────────────
  // Playwright: 浏览器内获取说说列表（绕过 API 限流）
  // ──────────────────────────────────────────────

  /**
   * 使用 Playwright 打开用户说说页面，拦截 emotion_cgi_msglist_v6 的 XHR 响应。
   * 浏览器内请求不受 IP 级限流影响。
   */
  async getEmotionListViaPlaywright(
    targetUin: string, pos = 0, num = 20, timeout = 30000,
  ): Promise<ApiResponse | null> {
    const now = Date.now() / 1000;
    if (now - this.playwrightFailTime < this.playwrightCooldown) return null;

    const pw = await launchPlaywright();
    if (!pw) return null;

    log('INFO', 'Playwright fetching emotion list...');
    let browser: any = pw.browser;
    try {
      const ctx = await browser.newContext({
        userAgent: QzoneClient.UA,
        viewport: { width: 1280, height: 800 },
      });

      // 注入 cookies
      const cookieArray: any[] = [];
      for (const [name, value] of Object.entries(this.cookies)) {
        for (const domain of ['.qq.com', '.qzone.qq.com']) {
          cookieArray.push({ name, value, domain, path: '/' });
        }
      }
      await ctx.addCookies(cookieArray);

      const page = await ctx.newPage();

      // 拦截 emotion_cgi_msglist_v6 响应
      let apiResult: ApiResponse | null = null;
      page.on('response', async (response: any) => {
        const url = response.url() as string;
        if (url.includes('emotion_cgi_msglist_v6') && !apiResult) {
          try {
            const text = await response.text();
            const parsed = parseJsonp(text) as ApiResponse;
            if (parsed && typeof parsed === 'object' && (parsed as any).code === 0) {
              apiResult = parsed as ApiResponse;
              log('INFO', `Playwright 拦截到 emotion_cgi_msglist_v6 成功响应`);
            } else {
              log('DEBUG', `Playwright emotion_cgi_msglist_v6 code=${(parsed as any)?.code}`);
            }
          } catch (e) {
            log('DEBUG', `Playwright response parse error: ${e}`);
          }
        }
      });

      // 导航到说说页面
      const shuoshuoUrl = `https://user.qzone.qq.com/${targetUin}/311`;
      await page.goto(shuoshuoUrl, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForTimeout(3000);

      // 等待 API 响应被拦截
      const deadline = Date.now() + 10000;
      while (!apiResult && Date.now() < deadline) {
        await page.waitForTimeout(500);
      }

      await ctx.close();
      await browser.close();
      browser = null;

      if (apiResult) {
        log('INFO', `Playwright 成功获取说说列表`);
        return apiResult;
      } else {
        log('WARNING', 'Playwright 未拦截到有效 API 响应');
        this.playwrightFailTime = Date.now() / 1000;
        return null;
      }
    } catch (exc) {
      log('WARNING', `Playwright 获取说说失败: ${exc}`);
      this.playwrightFailTime = Date.now() / 1000;
      if (browser) try { await browser.close(); } catch {}
      return null;
    }
  }

  // ──────────────────────────────────────────────
  // qzonetoken
  // ──────────────────────────────────────────────
  async getQzonetoken(): Promise<string | null> {
    this.requireLogin();
    const now = Date.now() / 1000;

    if (this.qzonetokenCache && now - this.qzonetokenCacheTime < this.qzonetokenTtl) {
      return this.qzonetokenCache;
    }
    if (now - this.qzonetokenFailTime < this.qzonetokenFailTtl) {
      return null;
    }

    const appendParams = (url: string, params: Record<string, string>): string => {
      const u = new URL(url);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u.toString();
    };

    const urls = [
      'https://qzs.qzone.qq.com/qzone/v5/loginsucc.html?para=izone',
      'https://qzs.qzone.qq.com/qzone/v5/loginsucc.html',
      `https://user.qzone.qq.com/${this.qqNumber}`,
      `https://user.qzone.qq.com/${this.qqNumber}/main`,
    ];
    const patterns = [
      /g_qzonetoken\s*=\s*\(function\(\)\{[\s\S]*?return\s*['"]([^'"]+)['"]/,
      /g_qzonetoken\s*=\s*['"]([^'"]+)['"]/,
      /"g_qzonetoken"\s*:\s*"([^"]+)"/,
      /qzonetoken"\s*:\s*"([^"]+)"/,
      /[?&]qzonetoken=([A-Za-z0-9]+)/,
    ];
    const iframePattern = /id="QM_Feeds_Iframe"[^>]*?src="([^"]+)"/i;

    for (const url of urls) {
      try {
        const resp = await this.get(url, { headers: this.pcHeaders() });
        const html = resp.text;
        for (const pat of patterns) {
          const m = html.match(pat);
          if (m?.[1]) {
            const token = m[1].trim();
            if (token) {
              this.qzonetokenCache = token;
              this.qzonetokenCacheTime = Date.now() / 1000;
              return token;
            }
          }
        }
        const iframeMatch = html.match(iframePattern);
        if (iframeMatch) {
          let iframeSrc = htmlUnescape(iframeMatch[1]!);
          if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
          iframeSrc = appendParams(iframeSrc, { g_tk: String(this.getGtk()) });
          try {
            const iResp = await this.get(iframeSrc, {
              headers: this.pcHeaders(`https://user.qzone.qq.com/${this.qqNumber}/main`),
            });
            for (const pat of patterns) {
              const m = iResp.text.match(pat);
              if (m?.[1]) {
                const token = m[1].trim();
                if (token) {
                  this.qzonetokenCache = token;
                  this.qzonetokenCacheTime = Date.now() / 1000;
                  return token;
                }
              }
            }
          } catch { /* ignore */ }
        }
      } catch { /* continue */ }
    }

    // NOTE: 不再使用 Playwright 兜底提取 qzonetoken。
    // qzonetoken 在所有 API 调用中均为可选参数；弹出浏览器的 UX 代价远大于收益。
    // Playwright 仅保留用于登录流程 (loginWithPlaywright)。

    this.qzonetokenFailTime = Date.now() / 1000;
    log('DEBUG', `qzonetoken HTTP 提取失败，${this.qzonetokenFailTtl}s 内不再重试（不触发浏览器）`);
    return null;
  }

  private async getQzonetokenPlaywright(): Promise<string | null> {
    const { Worker } = await import('node:worker_threads');
    const timeoutMs = env.playwrightTimeoutMs;
    const channel = env.playwrightChannel;
    const executable = env.playwrightExecutable;
    const targetUrl = `https://user.qzone.qq.com/${this.qqNumber}/main`;
    const cookies = Object.entries(this.cookies).map(([name, value]) => ({
      name, value, domain: '.qq.com', path: '/',
    }));

    const workerCode = `
      const { workerData, parentPort } = require('worker_threads');
      const { execSync } = require('child_process');
      async function run() {
        try {
          const { chromium } = require('playwright');
          const launchOpts = { headless: true };
          if (workerData.executable) launchOpts.executablePath = workerData.executable;
          else if (workerData.channel) launchOpts.channel = workerData.channel;
          const browser = await chromium.launch(launchOpts);
          const ctx = await browser.newContext();
          await ctx.addCookies(workerData.cookies);
          const page = await ctx.newPage();
          await page.goto(workerData.targetUrl, { waitUntil: 'domcontentloaded', timeout: workerData.timeoutMs });
          await new Promise(r => setTimeout(r, 3000));
          const token = await page.evaluate(() => {
            try {
              if (window.g_qzonetoken) {
                const g = window.g_qzonetoken;
                if (typeof g === 'function') return g();
                if (typeof g === 'string') return g;
              }
              const html = document.documentElement.innerHTML;
              const m = html.match(/g_qzonetoken\\s*=\\s*(?:function\\(\\)\\s*{\\s*return\\s*)?['"]([^'"]+)['"]/);
              if (m) return m[1];
            } catch(e) {}
            return null;
          });
          await ctx.close();
          await browser.close();
          parentPort.postMessage({ token });
        } catch(e) {
          parentPort.postMessage({ error: String(e) });
        }
      }
      run();
    `;

    return new Promise(resolve => {
      const w = new Worker(workerCode, {
        eval: true,
        workerData: { cookies, targetUrl, timeoutMs, channel, executable },
      });
      const timer = setTimeout(() => { w.terminate(); resolve(null); }, 60000);
      w.on('message', (msg: { token?: string; error?: string }) => {
        clearTimeout(timer);
        resolve(typeof msg.token === 'string' ? msg.token.trim() || null : null);
      });
      w.on('error', () => { clearTimeout(timer); resolve(null); });
    });
  }

  // ──────────────────────────────────────────────
  // API 有效性判断
  // ──────────────────────────────────────────────
  private isValidApiResponse(payload: ApiResponse): boolean {
    if (payload['_empty']) return false;
    if ((payload['http_status'] as number | undefined) != null && (payload['http_status'] as number) >= 400) return false;
    const code = payload['code'] as number | undefined;
    if (code !== undefined && code !== 0) return false;
    return true;
  }

  // ──────────────────────────────────────────────
  // feeds3 缓存
  // ──────────────────────────────────────────────
  private async fetchFeeds3Html(
    uin: string,
    forceRefresh = false,
    scope = 0,
    count = 0,
    externparam = '',
    uinlist?: string,
    filter = 'all',
    applist = 'all',
  ): Promise<string> {
    // externparam 翻页时需要不同的缓存 key；uinlist 指定「只看某用户」时也要区分
    const cacheKey = externparam
      ? `${uin}_${scope}_page_${externparam.substring(0, 30)}`
      : uinlist
        ? `${uin}_${scope}_${count}_ul_${uinlist}`
        : `${uin}_${scope}_${count}_f${filter}`;
    const now = Date.now() / 1000;
    if (!forceRefresh && this.feeds3Cache.has(cacheKey)) {
      if (now - (this.feeds3CacheTime.get(cacheKey) ?? 0) < this.feeds3CacheTtl) {
        return this.feeds3Cache.get(cacheKey)!;
      }
    }

    // 从 externparam（翻页 cursor）里同步 pagenum 和 basetime → begintime
    // 浏览器请求结构：pagenum 在 URL 顶层 + externparam 里各出现一次，缺一不可
    const epBasetime = externparam ? (new URLSearchParams(externparam).get('basetime') ?? '') : '';
    const epPagenum  = externparam ? (new URLSearchParams(externparam).get('pagenum')  ?? '1') : '1';

    const params = new URLSearchParams({
      uin,
      scope: String(scope),
      view: '1',
      daylist: '',
      uinlist: uinlist ?? '',
      gid: '',
      flag: '1',
      filter,
      applist,
      refresh: externparam ? '0' : '1',   // 首页 refresh=1，续页 refresh=0
      aisortEndTime: '0',
      aisortOffset: '0',
      getAisort: '0',
      aisortBeginTime: '0',
      pagenum: epPagenum,                  // 顶层 pagenum 与 externparam 里保持一致
      firstGetGroup: '0',
      icServerTime: '0',
      mixnocache: '0',
      scene: '0',
      begintime: epBasetime,               // = externparam 里的 basetime
      dayspac: '5',                        // 往回查 5 天
      sidomain: 'qzonestyle.gtimg.cn',
      useutf8: '1',
      outputhtmlfeed: '1',                 // 强制 HTML feed 格式，确保 feed_data 元素存在
      rd: String(Math.random()),
      usertime: String(Date.now()),
      windowId: String(Math.random()),     // 与浏览器抓包一致
      g_tk: String(this.getGtk()),
      format: 'json',
    });
    if (count > 0) params.set('count', String(count));
    if (externparam) params.set('externparam', externparam);

    const url =
      `https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more?${params.toString()}`;
    const resp = await this.get(url, { headers: this.pcHeaders(this.getQzreferrer()) });
    log('DEBUG', `feeds3 raw response length=${resp.text.length}, status=${resp.status}`);
    let text = resp.text.replace(/\\x22/g, '"').replace(/\\x3C/g, '<').replace(/\\\//g, '/');
    log('DEBUG', `feeds3 decoded text length=${text.length}`);
    // Dump to file for debug
    if (env.debugDump) {
      try {
        const fs = await import('node:fs');
        fs.writeFileSync(`test_cache/feeds3_${uin}_${scope}.html`, text, 'utf8');
        log('DEBUG', `feeds3 dumped to test_cache/feeds3_${uin}_${scope}.html`);
      } catch {}
    }
    // LRU: delete-then-set 使 Map 保持按最近访问排序（最旧在前）
    this.feeds3Cache.delete(cacheKey);
    this.feeds3Cache.set(cacheKey, text);
    this.feeds3CacheTime.delete(cacheKey);
    this.feeds3CacheTime.set(cacheKey, now);

    // O(1) 逐出：Map 迭代器按插入序，第一个即最旧
    while (this.feeds3Cache.size > 50) {
      const oldest = this.feeds3Cache.keys().next().value as string;
      this.feeds3Cache.delete(oldest);
      this.feeds3CacheTime.delete(oldest);
    }
    return text;
  }

  parseFeeds3Items(
    text: string,
    filterUin?: string,
    filterAppid?: string,
    maxItems = 50,
    skipFeedData = false,
  ): Record<string, unknown>[] {
    return _parseFeeds3Items(text, filterUin, filterAppid, maxItems, skipFeedData);
  }

  // ──────────────────────────────────────────────
  // Emotion list
  // ──────────────────────────────────────────────
  async getEmotionList(
    uin?: string, pos = 0, num = 50, ftype = 0, sort = 0, replynum = 10, maxPages = 15,
  ): Promise<ApiResponse> {
    this.requireLogin();
    const targetUin = uin ?? this.qqNumber!;
    const gtk = String(this.getGtk());
    const referer = `https://user.qzone.qq.com/${targetUin}/311`;

    // 尝试获取 qzonetoken
    let qzonetoken = '';
    try {
      qzonetoken = (await this.getQzonetoken()) ?? '';
      log('DEBUG', `qzonetoken: ${qzonetoken ? qzonetoken.substring(0, 20) + '...' : '(empty)'}`);
    } catch (e) { log('DEBUG', `qzonetoken fetch failed: ${e}`); }

    // 尝试多个 URL 路径
    const baseParams: Record<string, string> = {
      uin: targetUin,
      hostuin: this.qqNumber!,
      ftype: String(ftype),
      sort: String(sort),
      pos: String(pos),
      num: String(num),
      replynum: String(replynum),
      g_tk: gtk,
      code_version: '1',
      need_private_comment: '1',
    };
    if (qzonetoken) baseParams['qzonetoken'] = qzonetoken;

    const urlVariants = [
      // 标准 proxy 路径 (无 callback)
      {
        url: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6`,
        params: { ...baseParams, format: 'json' },
        headers: this.pcHeaders(referer, 'https://user.qzone.qq.com'),
        label: 'proxy-json',
      },
      // 标准 proxy 路径 (JSONP with callback)
      {
        url: `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6`,
        params: { ...baseParams, format: 'jsonp', callback: '_preloadCallback' },
        headers: this.pcHeaders(referer, 'https://user.qzone.qq.com'),
        label: 'proxy-jsonp',
      },
      // h5 路径 — 有时参与不同的限流策略
      {
        url: `https://h5.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6`,
        params: { ...baseParams, format: 'json' },
        headers: this.pcHeaders('https://h5.qzone.qq.com/', 'https://h5.qzone.qq.com'),
        label: 'h5-json',
      },
    ];

    for (const variant of urlVariants) {
      try {
        const qs = new URLSearchParams(variant.params).toString();
        const fullUrl = `${variant.url}?${qs}`;
        log('DEBUG', `emotion_cgi_msglist_v6 [${variant.label}] request: uin=${targetUin} pos=${pos} num=${num}`);
        const resp = await this.get(fullUrl, { headers: variant.headers });
        log('DEBUG', `emotion_cgi_msglist_v6 [${variant.label}] raw response (${resp.text.length} bytes): ${resp.text.substring(0, 300)}`);
        const result = parseJsonp(resp.text) as ApiResponse;
        if (typeof result === 'object' && result) {
          const code = (result as ApiResponse)['code'] as number | undefined;
          const msg = (result as ApiResponse)['message'] ?? '';
          log('DEBUG', `emotion_cgi_msglist_v6 [${variant.label}] response code=${code} message=${msg}`);
          // 成功
          if (code === 0) {
            validateApiResponse('emotion_list', result, resp.text);
            return result;
          }
          // 限流/认证失败 → 试下一个 variant
          if (code === -10000 || code === -2 || code === -3000 || this.isAuthFailure(result)) {
            log('WARNING', `emotion_cgi_msglist_v6 [${variant.label}] 失败 (code=${code})，尝试下一种`);
            continue;
          }
          // 其它错误也继续尝试
          if (code !== undefined && code !== 0) {
            log('WARNING', `emotion_cgi_msglist_v6 [${variant.label}] 返回错误 (code=${code})`);
            continue;
          }
        }
        // result 不是有效对象（如 HTML 403 页面），跳过
        log('WARNING', `emotion_cgi_msglist_v6 [${variant.label}] 返回非 JSON 对象，跳过`);
        continue;
      } catch (exc) {
        log('WARNING', `emotion_cgi_msglist_v6 [${variant.label}] 请求失败: ${exc}`);
        continue;
      }
    }

    // 所有 HTTP API variant 都失败 → 直接 feeds3 fallback
    // NOTE: 不再启动 Playwright 浏览器拦截 API。Playwright 仅用于登录和静默续期。
    log('WARNING', 'emotion_cgi_msglist_v6 所有路径均失败，最终使用 feeds3 fallback');
    return this.getEmotionListViaFeeds3(targetUin, num, pos, maxPages);
  }

  private async getEmotionListViaFeeds3(uin: string, num = 50, pos = 0, maxPages = 15): Promise<ApiResponse> {
    try {
      const isOwn = uin === this.qqNumber;
      let text = '';
      let msglist: Record<string, unknown>[];
      let usedScope = 1;
      /** 是否用 scope=0 + uinlist=目标用户 拉取 */
      let useUinlist = false;
      /** 是否用「好友动态流 scope=0 无 uinlist + 按 uin 过滤」拉取（与 getFriendFeeds 同款请求，唯一稳定有数据的路径） */
      let useFilterFromStream = false;

      if (!isOwn) {
        // 策略 0（指定用户优先）：用 scope=0 好友说说流（与 getFriendFeeds 同款请求），按 opuin 过滤
        // 注意：scope=1 的 JS 数组含「活动记录」（如好友点赞），uin 是活动者而非帖子作者，
        //       会把 bot 自己的帖子误判为目标好友的帖子。scope=0 feed_data 用 opuin 严格校验，更可靠。
        log('DEBUG', `feeds3 fallback: for friend uin=${uin}, trying scope=0 stream then filter by opuin`);
        text = await this.fetchFeeds3Html(this.qqNumber!, false, 0, 20, '', undefined, 'all', 'all');
        const friends = this.extractFriendsFromFeeds3FromText(text);
        if (friends.length) this.mergeFriendCache(friends);
        msglist = this.parseFeeds3Items(text, uin, undefined, pos + num, false);
        if (msglist.length > 0) {
          usedScope = 0;
          useFilterFromStream = true;
        }
      } else {
        msglist = [];
      }

      if (msglist.length === 0) {
        // 策略 1：scope=1（个人说说模式）；自己时可靠，好友时后端常返回空
        log('DEBUG', `feeds3 fallback: trying scope=1 for uin=${uin}`);
        text = await this.fetchFeeds3Html(uin, true, 1, 50);
        msglist = this.parseFeeds3Items(text, uin, undefined, pos + num);
        usedScope = 1;
      }

      if (msglist.length === 0 && !isOwn) {
        // 策略 2：scope=0 + uinlist=好友（后端可能不支持或返回空）
        log('DEBUG', `feeds3 fallback: scope=1 empty for friend, trying scope=0 with uinlist=${uin}`);
        text = await this.fetchFeeds3Html(this.qqNumber!, true, 0, 50, '', uin);
        const friends = this.extractFriendsFromFeeds3FromText(text);
        if (friends.length) this.mergeFriendCache(friends);
        msglist = this.parseFeeds3Items(text, uin, undefined, pos + num);
        if (msglist.length > 0) {
          usedScope = 0;
          useUinlist = true;
        }
      }

      if (msglist.length === 0) {
        // 策略 3：scope=0 无 uinlist，uin=目标，再按 uin 过滤
        log('DEBUG', 'feeds3 fallback: trying scope=0 without uinlist');
        text = await this.fetchFeeds3Html(uin, true, 0, 50);
        const friends = this.extractFriendsFromFeeds3FromText(text);
        if (friends.length) this.mergeFriendCache(friends);
        msglist = this.parseFeeds3Items(text, uin, undefined, pos + num);
        usedScope = 0;
      }

      // ── 从 feeds3 HTML 中提取内嵌评论 ──
      // 所有翻页的 HTML 都会累积到 allHtmlTexts 以合并评论
      const allHtmlTexts: string[] = [text];

      const seenTids = new Set(msglist.map(m => m['tid'] as string));

      // 如果不够，尝试翻页（最多 maxPages 页，每页约 50 条）
      const cappedPages = Math.max(1, Math.min(30, maxPages));
      let remainingPages = cappedPages;
      if (cappedPages > 3) log('DEBUG', `feeds3 pagination: max_pages=${cappedPages}`);
      let currentText = text;
      while (msglist.length < pos + num && remainingPages > 0) {
        const externparam = this.extractExternparam(currentText);
        if (!externparam) {
          log('DEBUG', 'feeds3 pagination: no externparam found, stopping');
          break;
        }
        log('DEBUG', `feeds3 pagination: got ${msglist.length}, need ${pos + num}, scope=${usedScope}`);
        
        remainingPages--;
        currentText = useFilterFromStream
          ? await this.fetchFeeds3Html(this.qqNumber!, true, 0, 20, externparam, undefined, 'all', 'all')
          : useUinlist
            ? await this.fetchFeeds3Html(this.qqNumber!, true, 0, 50, externparam, uin)
            : await this.fetchFeeds3Html(uin, true, usedScope, 50, externparam);
        allHtmlTexts.push(currentText);
        const page = this.parseFeeds3Items(currentText, uin, undefined, 50);
        
        // 跨页去重
        let added = 0;
        for (const item of page) {
          const tid = item['tid'] as string;
          if (!seenTids.has(tid)) {
            seenTids.add(tid);
            msglist.push(item);
            added++;
          }
        }
        log('DEBUG', `feeds3 pagination: page returned ${page.length} items, ${added} new after dedup`);
        if (added === 0) break;
      }

      // ── 解析并缓存 feeds3 内嵌评论 ──
      this.feeds3Comments.clear();
      for (const htmlText of allHtmlTexts) {
        const comments = _parseFeeds3Comments(htmlText);
        for (const [tid, cmts] of comments) {
          const existing = this.feeds3Comments.get(tid);
          if (existing) {
            // 去重合并（按 commentid）
            const seenIds = new Set(existing.map(c => String(c['commentid'])));
            for (const c of cmts) {
              if (!seenIds.has(String(c['commentid']))) existing.push(c);
            }
          } else {
            this.feeds3Comments.set(tid, cmts);
          }
        }
      }

      // ── 解析并缓存 feeds3 内嵌点赞 ──
      this.feeds3Likes.clear();
      for (const htmlText of allHtmlTexts) {
        const likes = _parseFeeds3Likes(htmlText);
        for (const [tid, likeArr] of likes) {
          const existing = this.feeds3Likes.get(tid);
          if (existing) {
            // 去重合并（同 tid 下同 uin 只保留最新）
            const seenUins = new Set(existing.map(l => l.uin));
            for (const l of likeArr) {
              if (!seenUins.has(l.uin)) { seenUins.add(l.uin); existing.push(l); }
            }
          } else {
            this.feeds3Likes.set(tid, [...likeArr]);
          }
        }
      }

      // 合并翻页后重新排序（最新在前）
      msglist.sort((a, b) => {
        const ta = (a['created_time'] as number) || 0;
        const tb = (b['created_time'] as number) || 0;
        return tb - ta;
      });

      if (pos > 0) msglist = msglist.slice(pos);
      if (msglist.length > num) msglist = msglist.slice(0, num);
      for (const item of msglist) this.cachePostMetaFromRaw(item);
      const scopeLabel = useFilterFromStream ? 'scope=0+filter' : useUinlist ? 'scope=0+uinlist' : `scope=${usedScope}`;
      log('INFO', `feeds3 fallback (${scopeLabel}) 获取到 ${msglist.length} 条说说`);
      return { code: 0, message: `ok (feeds3 fallback, ${scopeLabel})`, msglist, _source: 'feeds3' };
    } catch (exc) {
      log('ERROR', `feeds3 fallback 失败: ${exc}`);
      return { code: -10000, message: String(exc), msglist: [] };
    }
  }

  /** Extract externparam from feeds3 JSON response for pagination */
  private extractExternparam(text: string): string {
    return _extractExternparam(text);
  }

  /**
   * 获取好友说说动态（scope=0 filter=all，仅展示原创说说）。
   * 使用完整的浏览器参数（outputhtmlfeed=1, pagenum, begintime, dayspac 等）使翻页正常工作。
   * cursor 为上次返回的 externparam 字符串；首页不传。
   * 通过 main.hasMoreFeeds 判断是否还有下一页。
   */
  async getFriendFeeds(cursor = '', num = 50): Promise<ApiResponse> {
    this.requireLogin();
    try {
      const want = Math.max(1, Math.min(200, num));
      const text = await this.fetchFeeds3Html(
        this.qqNumber!, true, 0, 20, cursor,
        undefined, 'all', 'all',
      );
      const friends = this.extractFriendsFromFeeds3FromText(text);
      if (friends.length) this.mergeFriendCache(friends);

      // 检查是否还有更多（main.hasMoreFeeds）
      const hasMore = !/hasMoreFeeds\s*:\s*false/.test(text);
      const nextCursor = hasMore ? _extractExternparam(text) : '';

      // cursor 不推进 → 真到末尾
      if (cursor && nextCursor === cursor) {
        log('DEBUG', 'getFriendFeeds: cursor unchanged, marking end of feed');
        return { code: 0, message: 'ok (end of feed)', msglist: [], next_cursor: '' };
      }

      // 过滤：排除纯活动记录（appid=217 = 好友点赞动态），保留说说/应用分享等
      // appid=311 原创说说，2100=网易云，2160=QQ音乐，2=相册，3168=B站 等均放行
      const EXCLUDED_APPIDS = new Set(['217']);
      const all = this.parseFeeds3Items(text, undefined, undefined, want, false);
      const msglist = all.filter(item => !EXCLUDED_APPIDS.has(String(item['appid'] ?? '')));
      for (const item of msglist) this.cachePostMetaFromRaw(item);
      log('DEBUG', `getFriendFeeds: scope=0 found ${all.length} total → ${msglist.length} posts (excl. activity), hasMore=${hasMore}`);
      return { code: 0, message: 'ok', msglist: msglist.slice(0, want), next_cursor: nextCursor };
    } catch (exc) {
      log('ERROR', `friend feeds 获取失败: ${exc}`);
      return { code: -1, message: String(exc), msglist: [] };
    }
  }

  /**
   * 从 feeds3 原始文本中提取好友四元组（opuin/uin/nickname/logimg）及 f-nick HTML 昵称，去重合并，不排除任何人。
   * 排除自身 UIN 由调用方在 getFriendList 等处处理。
   */
  extractFriendsFromFeeds3FromText(text: string): Array<{ uin: string; nickname: string; avatar: string }> {
    return _extractFriendsFromFeeds3FromText(text, this.qqNumber ?? '');
  }

  /**
   * 请求 feeds3 scope=0（好友动态流），提取好友并可选翻页以获取更多历史中的好友。
   * 不写入缓存，由调用方 mergeFriendCache。
   */
  async extractFriendsFromFeeds3(maxPages = 3): Promise<Array<{ uin: string; nickname: string; avatar: string }>> {
    this.requireLogin();
    const uin = this.qqNumber!;
    const all = new Map<string, { uin: string; nickname: string; avatar: string }>();

    let text = await this.fetchFeeds3Html(uin, true, 0, 50);
    let pageCount = 0;
    while (pageCount < maxPages) {
      const batch = this.extractFriendsFromFeeds3FromText(text);
      for (const f of batch) {
        if (!all.has(f.uin)) all.set(f.uin, { ...f });
        else {
          const cur = all.get(f.uin)!;
          if (f.nickname) cur.nickname = f.nickname;
          if (f.avatar) cur.avatar = f.avatar;
        }
      }
      pageCount++;
      const externparam = this.extractExternparam(text);
      if (!externparam || pageCount >= maxPages) break;
      text = await this.fetchFeeds3Html(uin, true, 0, 50, externparam);
    }

    return Array.from(all.values());
  }

  async getMobileMoodList(uin?: string, pos = 0, num = 20): Promise<ApiResponse> {
    this.requireLogin();
    const targetUin = uin ?? this.qqNumber!;
    const url = `https://mobile.qzone.qq.com/get_mood_list?g_tk=${this.getGtk()}&uin=${targetUin}&pos=${pos}&num=${num}&format=json`;
    const resp = await this.get(url, { headers: this.mobileHeaders() });
    return safeDecodeJsonResponse(resp.data);
  }

  async getFeedImages(uin: string, tid: string): Promise<string[]> {
    this.requireLogin();
    try {
      const text = await this.fetchFeeds3Html(uin);
      const pattern = new RegExp(`data-key="${tid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"([\\s\\S]*?)(?=data-key="|$)`);
      const m = text.match(pattern);
      if (!m) return [];
      const block = htmlUnescape(m[1]!);
      const urls: string[] = [];
      for (const im of block.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
        const src = im[1]!;
        if (src.includes('qpic.cn') || src.includes('qlogo.cn') || /\.(jpg|jpeg|png|gif|webp)$/.test(src)) {
          if (!urls.includes(src)) urls.push(src);
        }
      }
      return urls;
    } catch (exc) {
      log('ERROR', `feeds3 图片提取失败: ${exc}`);
      return [];
    }
  }

  // ──────────────────────────────────────────────
  // Shuoshuo detail
  // ──────────────────────────────────────────────
  async getShuoshuoDetail(uin: string, tid: string): Promise<ApiResponse> {
    this.requireLogin();

    if (this.routes['detail'] === 'mobile') {
      const url = `https://mobile.qzone.qq.com/detail?g_tk=${this.getGtk()}&uin=${uin}&cellid=${tid}&format=json`;
      const resp = await this.get(url, { headers: this.mobileHeaders() });
      this.dumpDebugPayload('detail_mobile', resp.text);
      return safeDecodeJsonResponse(resp.data);
    }

    const now = Date.now() / 1000;
    const skipPc = this.detailAllFailTime > 0 && now - this.detailAllFailTime < this.detailAllFailTtl;
    let lastPayload: ApiResponse = {};

    if (!skipPc) {
      // POST
      const postUrl = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getdetailv6?g_tk=${this.getGtk()}`;
      try {
        const resp = await this.post(postUrl, {
          data: new URLSearchParams({ uin, tid, format: 'json', hostuin: this.qqNumber!, qzreferrer: this.getQzreferrer() }),
          headers: this.pcHeaders(this.getQzreferrer()),
        });
        this.dumpDebugPayload('detail_pc_post', resp.text);
        const payload = safeDecodeJsonResponse(resp.data);
        if (this.isValidApiResponse(payload)) { this.detailWinningVariant = -1; return payload; }
        lastPayload = payload;
      } catch (exc) { log('DEBUG', `Detail POST failed: ${exc}`); }

      // GET 变体
      const base = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getdetailv6?g_tk=${this.getGtk()}&uin=${uin}&tid=${tid}&format=json`;
      const qzonetoken = await this.getQzonetoken() ?? String(this.getGtk());
      const variants = [
        '',
        `qzonetoken=${qzonetoken}`,
        `qzonetoken=${qzonetoken}&qzreferrer=${this.getQzreferrer()}`,
        `qzonetoken=${qzonetoken}&hostuin=${this.qqNumber}`,
        `qzonetoken=${qzonetoken}&hostuin=${this.qqNumber}&qzreferrer=${this.getQzreferrer()}`,
      ];
      const order = [...Array(variants.length).keys()];
      if (this.detailWinningVariant !== null && this.detailWinningVariant >= 0) {
        const idx = order.indexOf(this.detailWinningVariant);
        if (idx !== -1) { order.splice(idx, 1); order.unshift(this.detailWinningVariant); }
      }
      for (const index of order) {
        const suffix = variants[index]!;
        const url = base + (suffix ? '&' + suffix : '');
        try {
          const resp = await this.get(url, { headers: this.pcHeaders(this.getQzreferrer()) });
          this.dumpDebugPayload(`detail_pc_${index}`, resp.text);
          const payload = safeDecodeJsonResponse(resp.data);
          if (this.isValidApiResponse(payload)) { this.detailWinningVariant = index; return payload; }
          if (!payload['_empty']) lastPayload = payload;
        } catch (exc) { log('DEBUG', `Detail GET variant ${index} failed: ${exc}`); }
      }
      this.detailAllFailTime = Date.now() / 1000;
    }

    // Mobile fallback
    try {
      const url = `https://mobile.qzone.qq.com/detail?g_tk=${this.getGtk()}&uin=${uin}&cellid=${tid}&format=json`;
      const resp = await this.get(url, { headers: this.mobileHeaders() });
      this.dumpDebugPayload('detail_mobile', resp.text);
      const p = safeDecodeJsonResponse(resp.data);
      if (this.isValidApiResponse(p)) return p;
    } catch (exc) { log('DEBUG', `Detail mobile fallback failed: ${exc}`); }

    // emotion_list fallback
    try {
      const elist = await this.getEmotionList(uin, 0, 20);
      const msglist = Array.isArray(elist['msglist']) ? elist['msglist'] as Record<string, unknown>[] : [];
      for (const msg of msglist) {
        if (msg['tid'] === tid) return { code: 0, data: msg, message: 'success (from list)' };
      }
    } catch { /* ignore */ }

    return lastPayload;
  }

  // ──────────────────────────────────────────────
  // Comments
  // ──────────────────────────────────────────────
  /** 从评论 API 响应中取评论条数（用于调试日志） */
  private commentCount(p: ApiResponse): number {
    if (!p || p['_empty']) return -1;
    for (const key of ['commentlist', 'comment_list', 'comments', 'data']) {
      const v = p[key];
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>)['list'])) return ((v as Record<string, unknown>)['list'] as unknown[]).length;
    }
    return -1;
  }

  async getComments(
    uin: string, tid: string, num = 20, pos = 0,
    t1Source?: number, t1Uin?: string, t1Tid?: string,
  ): Promise<ApiResponse> {
    this.requireLogin();

    const mobileUrl = `https://mobile.qzone.qq.com/get_comment_list?g_tk=${this.getGtk()}&uin=${uin}&cellid=${tid}&num=${num}&pos=${pos}&format=json`;

    if (this.routes['comments'] === 'mobile') {
      log('DEBUG', `getComments: 使用 mobile 路径 (routes.comments=mobile)`);
      const resp = await this.get(mobileUrl, { headers: this.mobileHeaders() });
      this.dumpDebugPayload('comments_mobile', resp.text);
      const out = safeDecodeJsonResponse(resp.data);
      log('DEBUG', `getComments(mobile): code=${(out as ApiResponse)['code']} comments≈${this.commentCount(out as ApiResponse)}`);
      return out;
    }

    const now = Date.now() / 1000;
    if (this.commentsAllFailTime > 0 && now - this.commentsAllFailTime < this.commentsAllFailTtl) {
      log('DEBUG', `getComments: 在 commentsAllFail 冷却期内，直接走 mobile`);
      const resp = await this.get(mobileUrl, { headers: this.mobileHeaders() });
      this.dumpDebugPayload('comments_mobile', resp.text);
      return safeDecodeJsonResponse(resp.data);
    }

    // POST
    const postUrl = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6?g_tk=${this.getGtk()}`;
    const postData: Record<string, string> = {
      uin, tid, num: String(num), pos: String(pos), format: 'json',
      hostuin: this.qqNumber!, qzreferrer: this.getQzreferrer(),
    };
    if (t1Source !== undefined) postData['t1_source'] = String(t1Source);
    if (t1Uin) postData['t1_uin'] = t1Uin;
    if (t1Tid) postData['t1_tid'] = t1Tid;
    try {
      log('DEBUG', `getComments: 尝试 PC POST (t1_source=${t1Source ?? 'none'})`);
      const resp = await this.post(postUrl, {
        data: new URLSearchParams(postData),
        headers: this.pcHeaders(this.getQzreferrer()),
      });
      this.dumpDebugPayload('comments_pc_post', resp.text);
      const raw = resp.text.trim();
      if (raw) {
        const payload = parseJsonp(raw) as ApiResponse;
        const code = payload?.['code'] as number | undefined;
        log('DEBUG', `getComments(PC POST): code=${code} comments≈${payload ? this.commentCount(payload) : 0}`);
        if (payload && (code === undefined || code === 0)) {
          this.commentsWinningVariant = -1;
          validateApiResponse('comment_list', payload, raw);
          return payload;
        }
      }
    } catch (exc) { log('DEBUG', `Comments POST failed: ${exc}`); }

    // GET 变体
    const base = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6?g_tk=${this.getGtk()}&uin=${uin}&tid=${tid}&num=${num}&pos=${pos}&format=json`;
    const qzonetoken = await this.getQzonetoken();
    const extras: string[] = [];
    if (t1Source !== undefined) extras.push(`t1_source=${t1Source}`);
    if (t1Uin) extras.push(`t1_uin=${t1Uin}`);
    if (t1Tid) extras.push(`t1_tid=${t1Tid}`);
    const tokenCands = qzonetoken ? [qzonetoken] : [String(this.getGtk())];
    const variants: string[] = [
      extras.join('&'), 't1_source=0',
      `hostuin=${this.qqNumber}`, `qzreferrer=${this.getQzreferrer()}`,
      `hostuin=${this.qqNumber}&qzreferrer=${this.getQzreferrer()}`,
      ...tokenCands.flatMap(t => [
        `qzonetoken=${t}`,
        `qzonetoken=${t}&qzreferrer=${this.getQzreferrer()}`,
        `qzonetoken=${t}&hostuin=${this.qqNumber}`,
        `qzonetoken=${t}&hostuin=${this.qqNumber}&qzreferrer=${this.getQzreferrer()}`,
      ]),
      '',
    ];

    const order = [...Array(variants.length).keys()];
    if (this.commentsWinningVariant !== null && this.commentsWinningVariant >= 0) {
      const idx = order.indexOf(this.commentsWinningVariant);
      if (idx !== -1) { order.splice(idx, 1); order.unshift(this.commentsWinningVariant); }
    }

    let lastPayload: ApiResponse = {};
    for (const index of order) {
      const suffix = variants[index]!;
      const url = base + (suffix ? '&' + suffix : '');
      try {
        const resp = await this.get(url, { headers: this.pcHeaders(this.getQzreferrer()) });
        this.dumpDebugPayload(`comments_pc_${index}`, resp.text);
        const raw = resp.text.trim();
        if (!raw) { log('DEBUG', `getComments(PC GET #${index}): 空响应`); continue; }
        const payload = parseJsonp(raw) as ApiResponse;
        lastPayload = payload ?? { raw: raw.slice(0, 200) };
        const code = payload?.['code'] as number | undefined;
        log('DEBUG', `getComments(PC GET #${index}): code=${code} comments≈${payload ? this.commentCount(payload) : 0}`);
        if (payload && (code === undefined || code === 0)) {
          this.commentsWinningVariant = index;
          validateApiResponse('comment_list', payload, raw);
          return payload;
        }
      } catch (exc) { log('DEBUG', `Comments GET variant ${index} failed: ${exc}`); }
    }

    this.commentsAllFailTime = Date.now() / 1000;
    log('INFO', `getComments: PC 全部失败，回退 mobile (uin=${uin} tid=${tid})`);
    try {
      const resp = await this.get(mobileUrl, { headers: this.mobileHeaders() });
      this.dumpDebugPayload('comments_mobile_fallback', resp.text);
      const p = safeDecodeJsonResponse(resp.data);
      log('DEBUG', `getComments(mobile fallback): valid=${this.isValidApiResponse(p)} comments≈${this.commentCount(p)}`);
      if (this.isValidApiResponse(p)) return p;
    } catch { /* ignore */ }
    return lastPayload;
  }

  async getCommentsBestEffort(uin: string, tid: string, num = 20, pos = 0): Promise<ApiResponse> {
    log('DEBUG', `getCommentsBestEffort: uin=${uin} tid=${tid} num=${num} pos=${pos}`);
    try {
      const p = await this.getComments(uin, tid, num, pos, 1, uin, tid);
      if (p && !p['_empty'] && (p['code'] === undefined || p['code'] === 0)) {
        log('INFO', `getCommentsBestEffort: 成功 (t1_source=1) 评论数≈${this.commentCount(p)}`);
        return p;
      }
    } catch (e) { log('DEBUG', `getCommentsBestEffort t1_source=1 异常: ${e}`); }
    try {
      const p = await this.getComments(uin, tid, num, pos, 0);
      if (p && !p['_empty'] && (p['code'] === undefined || p['code'] === 0)) {
        log('INFO', `getCommentsBestEffort: 成功 (t1_source=0) 评论数≈${this.commentCount(p)}`);
        return p;
      }
    } catch (e) { log('DEBUG', `getCommentsBestEffort t1_source=0 异常: ${e}`); }
    try {
      const p = await this.getCommentsMobile(uin, tid, num, pos);
      log('INFO', `getCommentsBestEffort: 使用 mobile 评论数≈${this.commentCount(p)}`);
      return p;
    } catch (e) { log('DEBUG', `getCommentsBestEffort mobile 异常: ${e}`); }

    // 兜底：使用 feeds3 拉取说说时已解析出的评论（仅覆盖最近通过 getEmotionList/getFriendFeeds 拉过的说说）
    const feeds3List = this.feeds3Comments.get(tid);
    if (feeds3List && feeds3List.length > 0) {
      const slice = feeds3List.slice(pos, pos + num);
      log('INFO', `getCommentsBestEffort: 使用 feeds3 兜底 评论数=${slice.length}/${feeds3List.length}`);
      return {
        code: 0,
        commentlist: slice,
        _source: 'feeds3',
        _feeds3_total: feeds3List.length,
      };
    }

    log('WARNING', `getCommentsBestEffort: 全部失败 (含无 feeds3 兜底)`);
    return { code: -1, message: 'all comment methods failed' };
  }

  /**
   * 轻量评论获取 — 仅发一次 POST 请求，不穷举变体。
   * 用于 Poller 在 qz_opcnt2 检测到增量后做可选富化，
   * 降低触发 -10000 限流的概率（旧 getCommentsBestEffort 会尝试 15+ 变体）。
   */
  async getCommentsLite(uin: string, tid: string, num = 20): Promise<ApiResponse> {
    this.requireLogin();
    const postUrl = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6?g_tk=${this.getGtk()}`;
    const resp = await this.post(postUrl, {
      data: new URLSearchParams({
        uin, tid, num: String(num), pos: '0', format: 'json',
        hostuin: this.qqNumber!, qzreferrer: this.getQzreferrer(),
        t1_source: '1', t1_uin: uin, t1_tid: tid,
      }),
      headers: this.pcHeaders(this.getQzreferrer()),
    });
    this.dumpDebugPayload('comments_lite', resp.text);
    const raw = resp.text.trim();
    if (!raw) return { code: -1, _empty: true };
    const payload = parseJsonp(raw) as ApiResponse;
    if (payload && (payload['code'] === undefined || payload['code'] === 0)) {
      return payload;
    }
    return payload ?? { code: -1, raw: raw.slice(0, 200) };
  }

  async getCommentsMobile(uin: string, tid: string, num = 20, pos = 0): Promise<ApiResponse> {
    this.requireLogin();
    const url = `https://mobile.qzone.qq.com/get_comment_list?g_tk=${this.getGtk()}&uin=${uin}&cellid=${tid}&num=${num}&pos=${pos}&format=json`;
    const resp = await this.get(url, { headers: this.mobileHeaders() });
    this.dumpDebugPayload('comments_mobile', resp.text);
    return safeDecodeJsonResponse(resp.data);
  }

  // ──────────────────────────────────────────────
  // Image upload
  // ──────────────────────────────────────────────
  async uploadImage(imageBase64: string, albumId?: string): Promise<UploadImageResult> {
    this.requireLogin();
    const albumtype = albumId ? 0 : 7;
    const refer = albumId ? 'album' : 'shuoshuo';

    const params = new URLSearchParams({
      qzreferrer: this.getQzreferrer(),
      filename: 'filename',
      zzpanelkey: '',
      qzonetoken: '',
      uploadtype: '1',
      albumtype: String(albumtype),
      exttype: '0',
      refer,
      output_type: 'jsonhtml',
      charset: 'utf-8',
      output_charset: 'utf-8',
      upload_hd: '1',
      hd_width: '2048',
      hd_height: '10000',
      hd_quality: '96',
      backUrls: 'http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image',
      url: `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${this.getGtk()}`,
      base64: '1',
      skey: this.cookies['skey'] ?? '',
      zzpaneluin: this.qqNumber!,
      uin: this.qqNumber!,
      p_skey: this.cookies['p_skey'] ?? '',
      jsonhtml_callback: 'callback',
      p_uin: this.qqNumber!,
      picfile: imageBase64,
    });
    if (albumId) params.set('albumid', albumId);

    const url = `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, { data: params });
    if (resp.status >= 400) throw new Error(`图片上传 HTTP ${resp.status}`);
    const html = resp.text;

    // 方式 0: parseJsonp（最通用）
    try {
      const parsed = parseJsonp(html, 'callback') as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        const dataObj = parsed['data'];
        if (dataObj && typeof dataObj === 'object' && ('lloc' in dataObj || 'albumid' in dataObj)) {
          return dataObj as UploadImageResult;
        }
        if ('lloc' in parsed || 'albumid' in parsed) return parsed as UploadImageResult;
      }
    } catch { /* fall through */ }

    // 方式 1: 正则提取扁平 JSON
    const jsonMatch = html.match(/\{[^{}]*"albumid"[^{}]*\}/s);
    if (jsonMatch) {
      try {
        const c = JSON.parse(jsonMatch[0]) as UploadImageResult;
        if (c.lloc || c.albumid) return c;
      } catch { /* ignore */ }
    }

    // 方式 2: data/ret 切片
    try {
      const si = html.indexOf('"data"') + 7;
      const ei = html.indexOf('"ret"') - 1;
      if (si >= 7 && ei > si) {
        const s = html.slice(si, ei).replace(/,\s*$/, '').trim();
        return JSON.parse(s) as UploadImageResult;
      }
    } catch { /* ignore */ }

    throw new Error(`图片上传解析失败，响应内容: ${html.slice(0, 300)}`);
  }

  // ──────────────────────────────────────────────
  // Publish
  // ──────────────────────────────────────────────
  async publish(
    content = '',
    images?: string[],
    whoCanSee?: number,
  ): Promise<[string, string[]]> {
    this.requireLogin();
    const picId: string[] = [];

    let data: Record<string, unknown>;

    if (!images || images.length === 0) {
      data = {
        syn_tweet_version: 1, paramstr: 1, pic_template: '', richtype: '', richval: '',
        special_url: '', subrichtype: '', con: content, feedversion: 1, ver: 1,
        ugc_right: 1, to_sign: 0, hostuin: this.qqNumber, code_version: 1,
        format: 'fs', qzreferrer: this.getQzreferrer(),
      };
    } else {
      const richval: string[] = [];
      const picBo: string[] = [];
      for (let i = 0; i < images.length; i++) {
        let ret: UploadImageResult;
        try { ret = await this.uploadImage(images[i]!); }
        catch (exc) { throw new Error(`第 ${i + 1}/${images.length} 张图片上传失败: ${exc}`); }

        const albumid = ret.albumid ?? '';
        const lloc = ret.lloc ?? '';
        const sloc = ret.sloc ?? lloc;
        const picType = ret.type ?? '0';
        const height = ret.height ?? 0;
        const width = ret.width ?? 0;
        richval.push(`,${albumid},${lloc},${sloc},${picType},${height},${width},,${height},${width}`);

        const preUrl = ret.pre ?? '';
        const boIdx = preUrl.indexOf('bo=');
        if (boIdx !== -1) {
          const boStart = boIdx + 3;
          const boEnd = preUrl.indexOf('&', boStart);
          picBo.push(boEnd !== -1 ? preUrl.slice(boStart, boEnd) : preUrl.slice(boStart));
        }
        picId.push(lloc);
      }
      data = {
        syn_tweet_version: 1, paramstr: 1,
        pic_template: `tpl-${images.length}-1`, richtype: 1,
        richval: richval.join('\t'), special_url: '', subrichtype: 1,
        con: content, feedversion: 1, ver: 1, ugc_right: 1, to_sign: 0,
        hostuin: this.qqNumber, code_version: 1, format: 'fs',
        qzreferrer: this.getQzreferrer(),
        pic_bo: picBo.length > 0 ? `{0}\t{0}`.replace('{0}', picBo.join(',')) : '',
      };
    }

    if (whoCanSee !== undefined) {
      data['who_can_see'] = whoCanSee;
      if (whoCanSee === 2) data['secret'] = 1;
    }

    const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, { data: new URLSearchParams(data as Record<string, string>) });
    const result = safeDecodeJsonResponse(resp.data);
    const dataObj = typeof result['data'] === 'object' && result['data'] ? result['data'] as Record<string, unknown> : {};
    const tid = result['t1_tid'] ?? result['tid'] ?? dataObj['tid'];

    if (!tid) {
      throw new Error(`发布说说未返回 tid: code=${result['code']}, message=${String(result['message']).slice(0, 200)}`);
    }
    return [String(tid), picId];
  }

  // ──────────────────────────────────────────────
  // Social actions
  // ──────────────────────────────────────────────
  async deleteEmotion(tid: string, topicId = ''): Promise<ApiResponse> {
    this.requireLogin();
    const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, {
      data: new URLSearchParams({ hostuin: this.qqNumber!, tid, topicId, code_version: '1', format: 'json', qzreferrer: this.getQzreferrer() }),
    });
    const result = parseJsonp(resp.text) as ApiResponse;
    validateApiResponse('social_action', result, resp.text);
    return result;
  }

  /** appid=311 用 /mood/ 路径；其他 app 分享传入实际 unikey（从 feeds3 HTML 提取）才准确 */
  private buildUnikey(ouin: string, tid: string, appid: number): string {
    return appid === 311
      ? `http://user.qzone.qq.com/${ouin}/mood/${tid}`
      : `http://user.qzone.qq.com/${ouin}/app/${tid}`;  // fallback，通常不准
  }

  /**
   * 给帖子点赞。缺失参数时自动从 postMetaCache 补全。
   */
  async likeEmotion(
    ouin: string, tid: string, abstime: number, appid = 0, typeid = 0,
    unikeyOverride?: string, curkeyOverride?: string,
  ): Promise<ApiResponse> {
    this.requireLogin();
    // 自动从缓存补全缺失参数
    const meta = this.getPostMeta(tid);
    if (meta) {
      if (!ouin && meta.uin) ouin = meta.uin;
      if (!appid && meta.appid) appid = Number(meta.appid) || 311;
      if (!typeid && meta.typeid) typeid = Number(meta.typeid) || 0;
      if (!abstime && meta.abstime) abstime = meta.abstime;
      if (!unikeyOverride && meta.likeUnikey) unikeyOverride = meta.likeUnikey;
      if (!curkeyOverride && meta.likeCurkey) curkeyOverride = meta.likeCurkey;
    }
    if (!appid) appid = 311;
    const unikey = unikeyOverride || this.buildUnikey(ouin, tid, appid);
    const curkey = curkeyOverride || unikey;

    // 方法1: internal_dolike_app（真实请求抓包验证）
    try {
      const url1 = `https://user.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app?g_tk=${this.getGtk()}`;
      const resp1 = await this.post(url1, {
        data: new URLSearchParams({
          qzreferrer: this.getQzreferrer(), opuin: this.qqNumber!, unikey, curkey,
          appid: String(appid), typeid: String(typeid), fid: tid,
          from: '1', active: '0', fupdate: '1', abstime: String(abstime), format: 'json',
        }),
        headers: this.pcHeaders(this.getQzreferrer()),
      });
      const p1 = safeDecodeJsonResponse(resp1.data);
      if ((p1['ret'] as number) === 0 || ((p1['code'] as number) === 0 && (p1['http_status'] as number | undefined ?? 0) < 400)) return p1;
    } catch { /* try next */ }

    // 方法2: like_cgi_likev6
    try {
      const url2 = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/like_cgi_likev6?g_tk=${this.getGtk()}`;
      const resp2 = await this.post(url2, {
        data: new URLSearchParams({ opuin: this.qqNumber!, ouin, fid: tid, abstime: String(abstime), appid: String(appid), typeid: String(typeid), key: '', format: 'json', qzreferrer: this.getQzreferrer() }),
      });
      const p2 = parseJsonp(resp2.text, '_Callback') as ApiResponse;
      if ((p2['code'] as number) === 0 || (p2['ret'] as number) === 0) return p2;
    } catch { /* try next */ }

    // 方法3: mobile
    return this.likeMobileFeed(ouin, tid, appid, typeid, 0);
  }

  async unlikeEmotion(
    ouin: string, tid: string, abstime: number, appid = 0, typeid = 0,
    unikeyOverride?: string, curkeyOverride?: string,
  ): Promise<ApiResponse> {
    this.requireLogin();
    const meta = this.getPostMeta(tid);
    if (meta) {
      if (!ouin && meta.uin) ouin = meta.uin;
      if (!appid && meta.appid) appid = Number(meta.appid) || 311;
      if (!typeid && meta.typeid) typeid = Number(meta.typeid) || 0;
      if (!abstime && meta.abstime) abstime = meta.abstime;
      if (!unikeyOverride && meta.likeUnikey) unikeyOverride = meta.likeUnikey;
      if (!curkeyOverride && meta.likeCurkey) curkeyOverride = meta.likeCurkey;
    }
    if (!appid) appid = 311;
    const unikey = unikeyOverride || this.buildUnikey(ouin, tid, appid);
    const curkey = curkeyOverride || unikey;

    // 方法1: internal_dolike_app
    const url1 = `https://user.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app?g_tk=${this.getGtk()}`;
    const resp1 = await this.post(url1, {
      data: new URLSearchParams({ qzreferrer: this.getQzreferrer(), opuin: this.qqNumber!, unikey, curkey, appid: String(appid), typeid: String(typeid), fid: tid, from: '1', active: '0', fupdate: '1', format: 'json' }),
      headers: this.pcHeaders(this.getQzreferrer()),
    });
    const p1 = safeDecodeJsonResponse(resp1.data);
    if ((p1['ret'] as number) === 0 || ((p1['code'] as number) === 0 && (p1['http_status'] as number | undefined ?? 0) < 400)) return p1;

    // 方法2: like_cgi_likev6 optype=1
    const url2 = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/like_cgi_likev6?g_tk=${this.getGtk()}`;
    const resp2 = await this.post(url2, {
      data: new URLSearchParams({ opuin: this.qqNumber!, ouin, fid: tid, abstime: String(abstime), appid: String(appid), typeid: String(typeid), optype: '1', format: 'json', qzreferrer: this.getQzreferrer() }),
    });
    const p2 = safeDecodeJsonResponse(resp2.data);
    if ((p2['code'] as number) === 0) return p2;

    // 方法3: mobile
    return this.likeMobileFeed(ouin, tid, appid, typeid, 1);
  }

  async likeMobileFeed(friendUin: string, cellid: string, appid = 311, typeid = 0, active = 0): Promise<ApiResponse> {
    this.requireLogin();
    const unikey = `http://user.qzone.qq.com/${friendUin}/mood/${cellid}`;
    const url = `https://mobile.qzone.qq.com/like?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, {
      data: new URLSearchParams({ unikey, curkey: unikey, appid: String(appid), typeid: String(typeid), active: String(active), fupdate: '1' }),
      headers: this.mobileHeaders(),
    });
    return safeDecodeJsonResponse(resp.data);
  }

  async commentEmotion(ouin: string, tid: string, content: string, replyCommentId?: string, replyUin?: string, appid = 0, abstime = 0): Promise<ApiResponse> {
    this.requireLogin();
    // 自动从缓存补全缺失参数
    const meta = this.getPostMeta(tid);
    if (meta) {
      if (!ouin && meta.uin) ouin = meta.uin;
      if (!appid && meta.appid) appid = Number(meta.appid) || 311;
      if (!abstime && meta.abstime) abstime = meta.abstime;
    }
    if (!appid) appid = 311;

    const shareUrl = `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshareaddcomment?&g_tk=${this.getGtk()}`;

    // 回复评论：优先 sns cgi_qzshareaddcomment（抓包：paramstr=2, commentId, commentUin）
    if (replyCommentId && replyUin) {
      try {
        const topicId = appid === 311 ? `${ouin}_${tid}` : `${ouin}_${abstime}`;
        const shareData: Record<string, string> = {
          topicId,
          feedsType: '100',
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          plat: 'qzone',
          source: 'ic',
          hostUin: ouin,
          isSignIn: '',
          platformid: '50',
          uin: this.qqNumber!,
          format: 'fs',
          ref: 'feeds',
          content,
          commentId: replyCommentId,
          commentUin: replyUin,
          richval: '',
          richtype: '',
          private: '0',
          paramstr: '2',
          qzreferrer: this.getQzreferrer(),
        };
        const shareResp = await this.post(shareUrl, { data: new URLSearchParams(shareData), headers: this.pcHeaders(this.getQzreferrer()) });
        const shareResult = parseJsonp(shareResp.text) as ApiResponse;
        if ((shareResult['code'] as number) === 0) return shareResult;
      } catch { /* fall through to emotion_cgi_re_feeds */ }
    }

    // app 分享（appid != 311）非回复时优先 sns，topicId = {hostUin}_{abstime}
    if (appid !== 311 && abstime && !replyCommentId) {
      try {
        const shareData: Record<string, string> = {
          topicId: `${ouin}_${abstime}`, feedsType: '100', inCharset: 'utf-8', outCharset: 'utf-8',
          plat: 'qzone', source: 'ic', hostUin: ouin, isSignIn: '', platformid: '50',
          uin: this.qqNumber!, format: 'fs', ref: 'feeds', content, richval: '', richtype: '', private: '0',
          paramstr: '1', qzreferrer: this.getQzreferrer(),
        };
        const shareResp = await this.post(shareUrl, { data: new URLSearchParams(shareData), headers: this.pcHeaders(this.getQzreferrer()) });
        const shareResult = parseJsonp(shareResp.text) as ApiResponse;
        if ((shareResult['code'] as number) === 0) return shareResult;
      } catch { /* fall through */ }
    }

    // 普通说说 / 回退：emotion_cgi_re_feeds，topicId = {ouin}_{tid}
    const data: Record<string, string> = {
      hostUin: ouin, topicId: `${ouin}_${tid}`, content, format: 'json', qzreferrer: this.getQzreferrer(),
      appid: String(appid),
    };
    if (replyCommentId && replyUin) { data['commentId'] = replyCommentId; data['replyUin'] = replyUin; }
    const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, { data: new URLSearchParams(data) });
    return parseJsonp(resp.text) as ApiResponse;
  }

  async deleteComment(uin: string, tid: string, commentId: string, commentUin?: string): Promise<ApiResponse> {
    this.requireLogin();
    if (this.routes['delete_comment'] === 'mobile') {
      const url = `https://mobile.qzone.qq.com/del_comment?g_tk=${this.getGtk()}`;
      const resp = await this.post(url, {
        data: new URLSearchParams({ cellid: tid, comment_id: commentId, format: 'json' }),
        headers: this.mobileHeaders(),
      });
      return safeDecodeJsonResponse(resp.data);
    }
    // 优先 sns 删除评论接口（与空间页删除一致，返回 frameElement.callback({ ret, code, msg })）
    const topicId = `${uin}_${tid}`;
    const snsData: Record<string, string> = {
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      plat: 'qzone',
      source: 'ic',
      hostUin: uin,
      uin,
      topicId,
      feedsType: '100',
      commentId,
      commentUin: commentUin ?? uin,
      format: 'fs',
      ref: 'feeds',
      paramstr: '2',
      qzreferrer: this.getQzreferrer(),
    };
    try {
      const snsUrl = `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzsharedeletecomment?&g_tk=${this.getGtk()}`;
      const snsResp = await this.post(snsUrl, {
        data: new URLSearchParams(snsData),
        headers: this.pcHeaders(this.getQzreferrer()),
      });
      const snsResult = parseJsonp(snsResp.text) as ApiResponse;
      const ret = (snsResult['ret'] as number | undefined) ?? (snsResult['code'] as number | undefined);
      if (ret === 0) return { code: 0, message: (snsResult['msg'] as string) ?? 'ok', ...snsResult };
      // 非 0 视为失败，继续尝试 taotao
    } catch { /* fall through */ }
    const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delcomment_ugc?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, {
      data: new URLSearchParams({ hostuin: this.qqNumber!, uin, tid, comment_id: commentId, format: 'json', qzreferrer: this.getQzreferrer() }),
    });
    return parseJsonp(resp.text) as ApiResponse;
  }

  async forwardEmotion(ouin: string, tid: string, content = ''): Promise<ApiResponse> {
    this.requireLogin();
    const topicId = `${ouin}_${tid}`;
    const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_forward_v6?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, {
      data: new URLSearchParams({ tid, ouin, opuin: this.qqNumber!, hostUin: ouin, topicId, con: content || '转发', feedversion: '1', ver: '1', code_version: '1', appid: '311', format: 'json', qzreferrer: this.getQzreferrer() }),
    });
    const p = safeDecodeJsonResponse(resp.data);
    if ((p['code'] as number) === 0) return p;
    // fallback re_feeds
    const resp2 = await this.post(
      `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${this.getGtk()}`,
      { data: new URLSearchParams({ hostUin: ouin, topicId, content: content || '转发', forward: '1', format: 'json', qzreferrer: this.getQzreferrer() }) },
    );
    return safeDecodeJsonResponse(resp2.data);
  }

  // ──────────────────────────────────────────────
  // User / Social info
  // ──────────────────────────────────────────────
  async getUserInfo(uin: string): Promise<ApiResponse> {
    this.requireLogin();
    const url = `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/cgi_personal_card?uin=${uin}&g_tk=${this.getGtk()}`;
    const resp = await this.get(url);
    const result = safeDecodeJsonResponse(resp.data, '_Callback');
    validateApiResponse('user_info', result, resp.text);
    return result;
  }

  async getFriendList(start = 0, num = 50): Promise<ApiResponse> {
    this.requireLogin();
    const selfUin = this.qqNumber!;

    // 第一级：原有 cgi_get_friend_list API（若 QQ 恢复则自动受益）
    try {
      const url = `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/qzone/cgi_get_friend_list?g_tk=${this.getGtk()}&uin=${selfUin}&start=${start}&num=${num}&format=json`;
      const resp = await this.get(url);
      log('DEBUG', `getFriendList raw (${resp.text.length} bytes): ${resp.text.substring(0, 300)}`);
      const parsed = parseJsonp(resp.text, '_Callback') as ApiResponse;
      if (parsed && (parsed as { code?: number }).code === 0) {
        const data = parsed.data as { items?: Array<{ uin?: string; nickname?: string; figureurl?: string }>; total?: number } | undefined;
        const items = data?.items ?? (parsed as { items?: unknown[] }).items;
        if (Array.isArray(items) && items.length > 0) {
          const list = items.map((f: Record<string, unknown>) => ({
            uin: String(f.uin ?? f.fuin ?? ''),
            nickname: String(f.nickname ?? f.name ?? f.remark ?? ''),
            avatar: String(f.figureurl ?? f.logimg ?? f.avatar ?? ''),
          })).filter((f: { uin: string }) => f.uin && f.uin !== selfUin);
          if (list.length) {
            this.mergeFriendCache(list);
            return {
              code: 0,
              message: 'ok',
              data: { items: list, total: list.length, source: 'api' as const },
            };
          }
        }
      }
    } catch (e) {
      log('DEBUG', `getFriendList API failed: ${e}`);
    }

    // 第二级：feeds3 scope=0 提取，合并缓存后返回缓存结果
    try {
      const extracted = await this.extractFriendsFromFeeds3(3);
      if (extracted.length) this.mergeFriendCache(extracted);
      const fromCache = Array.from(this.friendCache.values()).filter((f) => f.uin !== selfUin);
      const items = fromCache
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(start, start + num)
        .map((f) => ({ uin: f.uin, nickname: f.nickname, avatar: f.avatar }));
      if (items.length || fromCache.length) {
        return {
          code: 0,
          message: 'ok',
          data: { items, total: fromCache.length, source: 'feeds3' as const },
        };
      }
    } catch (e) {
      log('WARNING', `getFriendList feeds3 failed: ${e}`);
    }

    // 第三级（可选）：Playwright 好友管理页
    const usePlaywright = env.friendPlaywright;
    if (usePlaywright) {
      try {
        const pwList = await this.getFriendListViaPlaywright();
        if (pwList && pwList.length) {
          this.mergeFriendCache(pwList);
          const fromCache = Array.from(this.friendCache.values()).filter((f) => f.uin !== selfUin);
          const items = fromCache
            .sort((a, b) => b.lastSeen - a.lastSeen)
            .slice(start, start + num)
            .map((f) => ({ uin: f.uin, nickname: f.nickname, avatar: f.avatar }));
          return {
            code: 0,
            message: 'ok',
            data: { items, total: fromCache.length, source: 'playwright' as const },
          };
        }
      } catch (e) {
        log('WARNING', `getFriendList Playwright failed: ${e}`);
      }
    }

    // 仅返回已有缓存（可能为空）
    const fromCache = Array.from(this.friendCache.values()).filter((f) => f.uin !== selfUin);
    const items = fromCache
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(start, start + num)
      .map((f) => ({ uin: f.uin, nickname: f.nickname, avatar: f.avatar }));
    return {
      code: 0,
      message: fromCache.length ? 'ok (cache only)' : 'no friends',
      data: { items, total: fromCache.length, source: 'feeds3' as const },
    };
  }

  /**
   * 可选：Playwright 打开好友管理页提取完整好友列表。受 cooldown 限制。
   */
  async getFriendListViaPlaywright(): Promise<Array<{ uin: string; nickname: string; avatar: string }> | null> {
    const now = Date.now() / 1000;
    if (now - this.playwrightFailTime < this.playwrightCooldown) return null;
    this.requireLogin();
    const uin = this.qqNumber!;
    const pw = await launchPlaywright();
    if (!pw) return null;
    log('INFO', 'Playwright fetching friend list...');
    let browser: { close: () => Promise<void> } | null = pw.browser;
    try {
      const ctx = await (browser as any).newContext({
        userAgent: QzoneClient.UA,
        viewport: { width: 1280, height: 800 },
      });
      const cookieArray: any[] = [];
      for (const [name, value] of Object.entries(this.cookies)) {
        for (const domain of ['.qq.com', '.qzone.qq.com']) {
          cookieArray.push({ name, value, domain, path: '/' });
        }
      }
      await ctx.addCookies(cookieArray);
      const page = await ctx.newPage();
      const url = `https://user.qzone.qq.com/${uin}/friends/manage`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      const list = await page.$$eval(
        '[class*="friend"] a[href*="qzone.qq.com"]',
        (links: Element[]) => {
          const seen = new Set<string>();
          const result: Array<{ uin: string; nickname: string; avatar: string }> = [];
          for (const a of links) {
            const href = (a as HTMLAnchorElement).href || '';
            const match = href.match(/qzone\.qq\.com\/(\d+)/);
            if (!match) continue;
            const uin = match[1];
            if (uin === '0' || seen.has(uin)) continue;
            seen.add(uin);
            const nickname = (a.textContent || '').trim();
            const img = a.querySelector('img');
            const avatar = img ? (img as HTMLImageElement).src || '' : '';
            result.push({ uin, nickname, avatar });
          }
          return result;
        },
      );
      await ctx.close();
      await browser.close();
      browser = null;
      if (list.length) {
        log('INFO', `Playwright friend list: ${list.length} friends`);
        return list;
      }
      this.playwrightFailTime = Date.now() / 1000;
      return null;
    } catch (exc) {
      log('WARNING', `Playwright friend list failed: ${exc}`);
      this.playwrightFailTime = Date.now() / 1000;
      if (browser) try { await browser.close(); } catch {}
      return null;
    }
  }

  async getVisitorList(uin?: string): Promise<ApiResponse> {
    this.requireLogin();
    const targetUin = uin ?? this.qqNumber!;
    const url = `https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/cgi_right_get_visitor_more?g_tk=${this.getGtk()}&uin=${targetUin}&mask=7&format=json`;
    const resp = await this.get(url);
    const result = parseJsonp(resp.text, '_Callback') as ApiResponse;
    validateApiResponse('visitor', result, resp.text);
    return result;
  }

  async getLikeList(uin: string, tid: string): Promise<Record<string, unknown>[]> {
    const detail = await this.getShuoshuoDetail(uin, tid);
    for (const key of ['like', 'likes', 'likeList', 'likelist']) {
      if (Array.isArray(detail[key])) return detail[key] as Record<string, unknown>[];
    }
    const dataObj = detail['data'] && typeof detail['data'] === 'object' ? detail['data'] as Record<string, unknown> : {};
    for (const key of ['like', 'likes', 'likeList', 'likelist']) {
      if (Array.isArray(dataObj[key])) return dataObj[key] as Record<string, unknown>[];
    }
    return [];
  }

  // ──────────────────────────────────────────────
  // Traffic data (qz_opcnt2) — 参考 OpenCamwall
  // ──────────────────────────────────────────────

  /**
   * 获取说说的流量统计数据（点赞/浏览/评论/转发次数）。
   * API: r.qzone.qq.com/cgi-bin/user/qz_opcnt2
   */
  async getTrafficData(uin: string, tid: string): Promise<{ like: number; read: number; comment: number; forward: number }> {
    const stp = Date.now();
    const unikey = `http://user.qzone.qq.com/${uin}/mood/${tid}`;
    const url = `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2?_stp=${stp}&unikey=${encodeURIComponent(unikey)}&face=0&fupdate=1&g_tk=${this.getGtk()}`;
    const resp = await this.get(url, { headers: this.pcHeaders(this.getQzreferrer()) });
    const parsed = parseJsonp(resp.text, '_Callback') as Record<string, unknown>;
    validateApiResponse('traffic_data', parsed, resp.text);
    const dataArr = parsed['data'] as Array<Record<string, unknown>> | undefined;
    if (!dataArr || !dataArr.length) return { like: -1, read: -1, comment: -1, forward: -1 };
    const current = dataArr[0]?.['current'] as Record<string, unknown> | undefined;
    const newdata = current?.['newdata'] as Record<string, unknown> | undefined;
    if (!newdata || !('LIKE' in newdata)) return { like: -1, read: -1, comment: -1, forward: -1 };
    return {
      like:    Number(newdata['LIKE'] ?? -1),
      read:    Number(newdata['PRD']  ?? -1),
      comment: Number(newdata['CS']   ?? -1),
      forward: Number(newdata['ZS']   ?? -1),
    };
  }

  // ──────────────────────────────────────────────
  // Privacy (emotion_cgi_update) — 参考 OpenCamwall
  // ──────────────────────────────────────────────

  /**
   * 设置说说的隐私权限（公开/私密）。
   * ugc_right: 1=公开，64=私密
   */
  async setEmotionPrivacy(tid: string, privacy: 'private' | 'public'): Promise<ApiResponse> {
    this.requireLogin();
    // 先获取原始说说数据
    const detail = await this.getShuoshuoDetail(this.qqNumber!, tid);
    const content = String(detail['content'] ?? detail['con'] ?? '');

    const body: Record<string, string> = {
      syn_tweet_verson: '1',
      tid,
      paramstr: '1',
      pic_template: '',
      richtype: '',
      richval: '',
      special_url: '',
      subrichtype: '',
      con: content,
      feedversion: '1',
      ver: '1',
      ugc_right: privacy === 'private' ? '64' : '1',
      to_sign: '0',
      ugcright_id: tid,
      hostuin: this.qqNumber!,
      code_version: '1',
      format: 'fs',
      qzreferrer: this.getQzreferrer(),
    };

    // 如果有图片，需重组 richval / pic_bo
    const pics = detail['pic'] as Array<Record<string, unknown>> | undefined;
    if (pics && pics.length > 0) {
      const richvals: string[] = [];
      const picBos: string[] = [];
      for (const pic of pics) {
        const picId = String(pic['pic_id'] ?? '').split(',');
        if (picId.length >= 3) {
          richvals.push(`,${picId[1]},${picId[2]},${picId[2]},${pic['pictype'] ?? 0},${pic['height'] ?? 0},${pic['width'] ?? 0},,0,0`);
        }
        const smallurl = String(pic['smallurl'] ?? pic['url1'] ?? '');
        const boMatch = smallurl.match(/bo=([^&]+)/);
        if (boMatch) picBos.push(boMatch[1]!);
      }
      if (richvals.length) {
        body['richtype'] = '1';
        body['subrichtype'] = '1';
        body['richval'] = richvals.join('\t');
        body['pic_bo'] = picBos.join('\t');
      }
    }

    const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_update?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, {
      data: new URLSearchParams(body),
      headers: this.pcHeaders(this.getQzreferrer()),
    });
    return safeDecodeJsonResponse(resp.data);
  }

  // ──────────────────────────────────────────────
  // Portrait / Nickname — 参考 OpenCamwall
  // ──────────────────────────────────────────────

  /**
   * 通过 cgi_get_portrait.fcg 获取用户头像和昵称。
   * 响应编码为 GBK，JSONP 回调为 portraitCallBack。
   */
  async getPortrait(uin: string): Promise<{ nickname: string; avatarUrl: string }> {
    const url = `https://r.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg?uins=${uin}`;
    const resp = await this.get(url);
    // 响应是 GBK 编码，需要从原始 buffer 解码
    let text: string;
    if (resp.data instanceof Buffer || resp.data instanceof Uint8Array) {
      const decoder = new TextDecoder('gbk');
      text = decoder.decode(resp.data);
    } else {
      text = resp.text;
    }
    // 格式: portraitCallBack({"uin": [...]})
    const jsonStr = text.replace(/^portraitCallBack\(/, '').replace(/\)\s*$/, '');
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown[]>;
      const arr = data[String(uin)];
      if (Array.isArray(arr)) {
        return {
          nickname: String(arr[6] ?? ''),
          avatarUrl: String(arr[0] ?? ''),
        };
      }
    } catch (e) {
      log('WARNING', `getPortrait parse failed: ${e}`);
    }
    return { nickname: '', avatarUrl: '' };
  }

  /**
   * 从 Cookie 中提取昵称（ptnick_xxx 字段，值为 hex 编码的 UTF-8 字符串）。
   * 如 Cookie 中无此字段，返回空字符串。
   */
  getNicknameFromCookie(): string {
    if (!this.qqNumber) return '';
    const raw = this.cookies[`ptnick_${this.qqNumber}`];
    if (!raw) return '';
    try {
      // ptnick 值可能是 hex 编码的 UTF-8
      if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
        const bytes = Buffer.from(raw, 'hex');
        return bytes.toString('utf8');
      }
      // 也可能是 URL 编码
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  // ──────────────────────────────────────────────
  // Albums / Photos
  // ──────────────────────────────────────────────
  async getAlbumList(uin?: string): Promise<ApiResponse> {
    this.requireLogin();
    const targetUin = uin ?? this.qqNumber!;
    const url = `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_list_album?g_tk=${this.getGtk()}&uin=${targetUin}&hostUin=${targetUin}&inCharset=utf-8&outCharset=utf-8&format=json`;
    const resp = await this.get(url, { headers: this.pcHeaders(this.getQzreferrer()) });
    const p = safeDecodeJsonResponse(resp.data, '_Callback');
    if (!p['_empty'] && (p['http_status'] as number | undefined ?? 0) < 400) {
      validateApiResponse('album_list', p, resp.text);
      return p;
    }
    const url2 = `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_list_photo?g_tk=${this.getGtk()}&uin=${targetUin}&hostUin=${targetUin}&inCharset=utf-8&outCharset=utf-8&format=json`;
    const resp2 = await this.get(url2, { headers: this.pcHeaders(this.getQzreferrer()) });
    const albumResult = safeDecodeJsonResponse(resp2.data, '_Callback');
    validateApiResponse('album_list', albumResult, resp2.text);
    return albumResult;
  }

  async getPhotoList(uin?: string, topicId = '', num = 30): Promise<ApiResponse> {
    this.requireLogin();
    const targetUin = uin ?? this.qqNumber!;
    const url = `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_floatview_photo_list_v2?g_tk=${this.getGtk()}&uin=${targetUin}&topicId=${topicId}&picKey=&fupdate=1&num=${num}&pageStart=0&inCharset=utf-8&outCharset=utf-8&format=json`;
    const resp = await this.get(url, { headers: this.pcHeaders(this.getQzreferrer()) });
    return safeDecodeJsonResponse(resp.data, '_Callback');
  }

  async createAlbum(name: string, desc = '', priv = 1): Promise<ApiResponse> {
    this.requireLogin();
    const url = `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_create_album?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, { data: new URLSearchParams({ hostUin: this.qqNumber!, albumname: name, albumdesc: desc, priv: String(priv), format: 'json', qzreferrer: this.getQzreferrer() }) });
    return safeDecodeJsonResponse(resp.data, '_Callback');
  }

  async deleteAlbum(albumId: string): Promise<ApiResponse> {
    this.requireLogin();
    const url = `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_del_album?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, { data: new URLSearchParams({ hostUin: this.qqNumber!, topicId: albumId, format: 'json', qzreferrer: this.getQzreferrer() }) });
    return safeDecodeJsonResponse(resp.data, '_Callback');
  }

  async deletePhoto(uin?: string, albumId = '', photoId = ''): Promise<ApiResponse> {
    this.requireLogin();
    const targetUin = uin ?? this.qqNumber!;
    const url = `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/cgi_del_photo?g_tk=${this.getGtk()}`;
    const resp = await this.post(url, { data: new URLSearchParams({ hostUin: targetUin, topicId: albumId, lloc: photoId, format: 'json', qzreferrer: this.getQzreferrer() }) });
    return safeDecodeJsonResponse(resp.data, '_Callback');
  }

  // ──────────────────────────────────────────────
  // API route probe
  // ──────────────────────────────────────────────
  async probeApiRoutes(uin: string, tid: string): Promise<Routes> {
    this.requireLogin();
    const gtk = this.getGtk();
    let detailPcOk = false;
    try {
      const r = parseJsonp((await this.get(`https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getdetailv6?g_tk=${gtk}&uin=${uin}&tid=${tid}&format=json`)).text) as Record<string, unknown>;
      detailPcOk = r != null && ('code' in r || 'msg' in r);
    } catch { /* ignore */ }

    let detailMobileOk = false;
    try {
      const r = JSON.parse((await this.get(`https://mobile.qzone.qq.com/detail?g_tk=${gtk}&uin=${uin}&cellid=${tid}&format=json`, { headers: this.mobileHeaders() })).text) as Record<string, unknown>;
      detailMobileOk = r != null && ('code' in r || 'msg' in r);
    } catch { /* ignore */ }

    let commentsPcOk = false;
    try {
      const r = parseJsonp((await this.get(`https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6?g_tk=${gtk}&uin=${uin}&tid=${tid}&num=5&pos=0&format=json`)).text) as Record<string, unknown>;
      commentsPcOk = r != null && ('code' in r || 'msg' in r);
    } catch { /* ignore */ }

    let commentsMobileOk = false;
    try {
      const r = JSON.parse((await this.get(`https://mobile.qzone.qq.com/get_comment_list?g_tk=${gtk}&uin=${uin}&cellid=${tid}&num=5&pos=0&format=json`, { headers: this.mobileHeaders() })).text) as Record<string, unknown>;
      commentsMobileOk = r != null && ('code' in r || 'msg' in r);
    } catch { /* ignore */ }

    const discovered: Routes = {
      ...this.routes,
      detail: detailPcOk ? 'pc' : (detailMobileOk ? 'mobile' : this.routes['detail']),
      comments: commentsPcOk ? 'pc' : (commentsMobileOk ? 'mobile' : this.routes['comments']),
    };
    Object.assign(this.routes, discovered);
    return discovered;
  }
}
