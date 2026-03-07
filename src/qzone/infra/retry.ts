/* ─────────────────────────────────────────────
   通用重试工具 (Retry Utility)
   指数退避 + RateLimitError 感知 + 可选 jitter
   ───────────────────────────────────────────── */

import { isRetryable, RateLimitError } from './errors.js';
import { log } from '../utils.js';

export interface RetryOptions {
  /** 最大重试次数（不含首次） */
  maxRetries?: number;
  /** 初始退避毫秒 */
  baseDelayMs?: number;
  /** 最大退避毫秒 */
  maxDelayMs?: number;
  /** 是否加入随机 jitter（默认 true） */
  jitter?: boolean;
  /** 每次执行的标签（用于日志） */
  label?: string;
  /** 自定义判断是否可重试 */
  shouldRetry?: (err: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'label' | 'shouldRetry'>> = {
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitter: true,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 带指数退避的重试包装器。
 *
 * - 如果错误是 `RateLimitError`，使用其 `retryAfterMs` 作为等待时间
 * - 其它可重试错误使用指数退避
 * - 不可重试错误立即抛出
 *
 * @example
 * const data = await withRetry(() => client.fetchFeeds(), { maxRetries: 3, label: 'fetchFeeds' });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    jitter,
  } = { ...DEFAULT_OPTIONS, ...opts };

  const shouldRetry = opts?.shouldRetry ?? isRetryable;
  const label = opts?.label ?? 'withRetry';

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !shouldRetry(err)) {
        throw err;
      }

      let delayMs: number;
      if (err instanceof RateLimitError) {
        // 频率限制：使用服务端建议的等待时间
        delayMs = err.retryAfterMs;
      } else {
        // 指数退避: baseDelay * 2^attempt
        delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      }

      if (jitter) {
        // 加入 ±25% 的随机抖动
        delayMs = delayMs * (0.75 + Math.random() * 0.5);
      }

      delayMs = Math.round(delayMs);
      log('DEBUG', `[${label}] 第 ${attempt + 1}/${maxRetries} 次重试，等待 ${delayMs}ms — ${err}`);
      await sleep(delayMs);
    }
  }

  // 不应到这里，但保险起见
  throw lastError;
}
