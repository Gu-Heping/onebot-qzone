/* ─────────────────────────────────────────────
   自定义错误层级 (Custom Error Hierarchy)
   所有 QZone 业务错误均继承自 QzoneError，
   便于 catch 分支精确判断、retry 策略区分
   ───────────────────────────────────────────── */

/** 基类：所有 QZone 相关错误 */
export class QzoneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'QzoneError';
  }
}

/** 网络层错误（DNS / 超时 / 连接中断 等） */
export class NetworkError extends QzoneError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

/** 身份验证失败（Cookie 过期、p_skey 无效等） */
export class AuthError extends QzoneError {
  readonly bizCode?: number;
  constructor(message: string, bizCode?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthError';
    this.bizCode = bizCode;
  }
}

/** 会话已失效，需要重新登录 */
export class SessionExpiredError extends AuthError {
  constructor(message = '会话已过期，需要重新登录', options?: ErrorOptions) {
    super(message, undefined, options);
    this.name = 'SessionExpiredError';
  }
}

/** 频率限制（code = -10000 / -2） */
export class RateLimitError extends QzoneError {
  readonly bizCode?: number;
  readonly retryAfterMs: number;
  constructor(message: string, bizCode?: number, retryAfterMs = 5_000, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RateLimitError';
    this.bizCode = bizCode;
    this.retryAfterMs = retryAfterMs;
  }
}

/** 反爬/验证码拦截 */
export class AntiCrawlError extends QzoneError {
  constructor(message = '触发反爬机制（验证码/频率限制页）', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AntiCrawlError';
  }
}

/** API 业务码非 0 的通用错误 */
export class ApiBusinessError extends QzoneError {
  readonly bizCode: number;
  readonly payload: unknown;
  constructor(message: string, bizCode: number, payload?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiBusinessError';
    this.bizCode = bizCode;
    this.payload = payload;
  }
}

/** JSON / JSONP 解析失败 */
export class ParseError extends QzoneError {
  readonly rawSnippet?: string;
  constructor(message: string, rawSnippet?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ParseError';
    this.rawSnippet = rawSnippet;
  }
}

// ── 类型守卫 ──────────────────────────────────

export function isQzoneError(err: unknown): err is QzoneError {
  return err instanceof QzoneError;
}

/** 判断是否可安全重试（网络 / 频率限制 可重试；认证 / 反爬 不重试） */
export function isRetryable(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof NetworkError) return true;
  if (err instanceof AuthError) return false;
  if (err instanceof AntiCrawlError) return false;
  // 未知错误默认可重试
  return !(err instanceof QzoneError);
}
