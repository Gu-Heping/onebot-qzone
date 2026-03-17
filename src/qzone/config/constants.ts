/* ─────────────────────────────────────────────
   集中式常量 (Constants)
   把散落在各文件中的魔法数字 / URL 模板 / 阈值统一管理
   ───────────────────────────────────────────── */

// ── 缓存 TTL（秒） ─────────────────────────────

export const CACHE_TTL = {
  /** qzonetoken 缓存有效期 */
  qzonetoken: 300,          // 5 min
  /** qzonetoken 获取失败后的冷却期 */
  qzonetokenFail: 600,      // 10 min
  /** Playwright 启动失败后的冷却期 */
  playwrightFail: 1800,     // 30 min
  /** 详情接口全部变体失败后的冷却期 */
  detailAllFail: 300,       // 5 min
  /** feeds3 页面缓存有效期 */
  feeds3: 30,               // 30 s
} as const;

// ── HTTP 默认值 ─────────────────────────────────

export const HTTP_DEFAULTS = {
  timeout: 20_000,
  maxRedirects: 5,
  playwrightNavTimeout: 30_000,
  playwrightQrWait: 10_000,
  qrRefreshInterval: 10_000,
} as const;

// ── 反爬 / 业务码集合 ──────────────────────────

/** 反爬页面特征正则（匹配任一即判定为反爬拦截） */
export const ANTI_CRAWL_PATTERNS: readonly RegExp[] = [
  /系统繁忙/,
  /访问过于频繁/,
  /安全验证/,
  /请输入验证码/,
  /tcaptcha/i,
  /需要登录/,
  /请先登录/,
  /g_isSurvey/,
  /<title>QQ空间<\/title>[\s\S]{0,500}<script/,
];

/** 身份验证失败的业务码 */
export const AUTH_FAILURE_CODES: ReadonlySet<number> = new Set([
  -3, -100, -3000, -10001, -10006,
]);

/** 频率限制的业务码 */
export const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([
  -10000, -2,
]);

// ── 浏览器 UA ───────────────────────────────────

export const USER_AGENTS = {
  desktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  mobile:
    'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/95.0.4638.74 Mobile Safari/537.36',
  secChUa:
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
} as const;

/** 随机化 User-Agent 池（用于请求指纹随机化） */
export const USER_AGENT_POOL = [
  // Chrome Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  // Chrome macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  // Edge Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
] as const;

/** 随机化 Accept-Language 池 */
export const ACCEPT_LANGUAGE_POOL = [
  'zh-CN,zh;q=0.9,en;q=0.8',
  'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'zh-CN,zh-TW;q=0.9,zh;q=0.8,en;q=0.7',
  'zh;q=0.9,en;q=0.8',
  'en-US,en;q=0.9,zh-CN;q=0.8',
] as const;

/** 获取随机 User-Agent */
export function getRandomUserAgent(): string {
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)]!;
}

/** 获取随机 Accept-Language */
export function getRandomAcceptLanguage(): string {
  return ACCEPT_LANGUAGE_POOL[Math.floor(Math.random() * ACCEPT_LANGUAGE_POOL.length)]!;
}

// ── API 域名 / 路径模板 ─────────────────────────

export const QZONE_DOMAINS = {
  user: 'https://user.qzone.qq.com',
  mobile: 'https://mobile.qzone.qq.com',
  upload: 'https://up.qzone.qq.com',
  qzs: 'https://qzs.qzone.qq.com',
  xlogin: 'https://xui.ptlogin2.qq.com',
} as const;

/**
 * API 路径模板。
 * 带 `proxy/domain/` 前缀的为 PC 版，直连为移动版。
 */
export const API_PATHS = {
  /** 说说列表 */
  emotionList: '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6',
  /** 说说详情 */
  emotionDetail: '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getdetailv6',
  /** 说说评论 */
  emotionComments: '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6',
  /** 发布说说 */
  emotionPublish: '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6',
  /** 删除说说 */
  emotionDelete: '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6',
  /** PC 版点赞 */
  dolike: '/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app',
  /** taotao 版点赞 */
  likev6: '/proxy/domain/taotao.qzone.qq.com/cgi-bin/like_cgi_likev6',
  /** feeds3 HTML */
  feeds3: '/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more',
  /** 图片上传 */
  uploadImage: '/cgi-bin/upload/cgi_upload_image',
  /** 移动版说说列表 */
  mobileGetMood: '/get_mood_list',
  /** 移动版详情 */
  mobileDetail: '/detail',
  /** 移动版评论 */
  mobileComments: '/get_comment_list',
} as const;

// ── 数量限制 ────────────────────────────────────

export const LIMITS = {
  /** 单次拉取说说条数上限 */
  defaultFeedCount: 20,
  /** 单次拉取评论条数上限 */
  defaultCommentCount: 20,
  /** 响应落盘最大文件大小 */
  rawLogMaxFileSize: 5 * 1024 * 1024,
  /** 响应落盘最大文件数 */
  rawLogMaxFiles: 500,
} as const;
