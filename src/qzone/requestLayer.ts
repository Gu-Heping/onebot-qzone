/* ─────────────────────────────────────────────
   统一请求拦截与 JSONP 解析底座
   自动 JSONP 剥壳 + 状态码拦截 + 反爬检测 + 可选 Zod 校验
   ───────────────────────────────────────────── */

import type { ApiResponse } from './types.js';
import type { SchemaName } from './schemas.js';
import { parseJsonp, log } from './utils.js';
import { validateApiResponse, type ValidationResult } from './validate.js';
import { dumpRawResponse } from './rawLogger.js';
import {
  ANTI_CRAWL_PATTERNS,
  AUTH_FAILURE_CODES,
  RATE_LIMIT_CODES,
} from './config/constants.js';

// ── 结果类型 ──

export interface ParsedApiResult {
  /** HTTP 状态码 */
  httpStatus: number;
  /** JSONP 解壳后的对象 */
  payload: ApiResponse;
  /** 原始 HTTP 响应体 */
  rawText: string;
  /** 是否被识别为反爬/空壳 */
  isAntiCrawl: boolean;
  /** 是否鉴权失败 */
  isAuthFailure: boolean;
  /** 是否被限流 */
  isRateLimited: boolean;
  /** 业务码 */
  bizCode: number | undefined;
  /** Zod 校验结果（仅传入 schemaName 时） */
  validation?: ValidationResult;
}

/**
 * 将原始 HTTP 响应解析成结构化结果
 */
export function parseRawResponse(
  httpStatus: number,
  rawText: string,
  opts?: { schemaName?: SchemaName; apiLabel?: string; jsonpCallback?: string },
): ParsedApiResult {
  const label = opts?.apiLabel ?? 'unknown';

  // 1. HTTP 级别判断
  if (httpStatus >= 400) {
    log('WARNING', `[${label}] HTTP ${httpStatus}`);
    dumpRawResponse(label, rawText, [`HTTP ${httpStatus}`]);
    return {
      httpStatus,
      payload: { code: -httpStatus, _empty: true, http_status: httpStatus },
      rawText,
      isAntiCrawl: false,
      isAuthFailure: httpStatus === 401 || httpStatus === 403,
      isRateLimited: httpStatus === 429,
      bizCode: undefined,
    };
  }

  // 2. 反爬检测（在 JSONP 解析前，直接对原始文本扫描）
  const isAntiCrawl = ANTI_CRAWL_PATTERNS.some((re) => re.test(rawText));
  if (isAntiCrawl) {
    log('WARNING', `[${label}] 检测到反爬特征`);
    dumpRawResponse(label, rawText, ['anti-crawl-detected']);
  }

  // 3. JSONP 剥壳
  let payload: ApiResponse;
  try {
    const parsed = parseJsonp(rawText, opts?.jsonpCallback);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as ApiResponse;
    } else {
      payload = { _empty: true, raw: rawText.slice(0, 200) };
    }
  } catch (e) {
    log('WARNING', `[${label}] JSONP 解析失败: ${e}`);
    dumpRawResponse(label, rawText, [`parse-error: ${e}`]);
    payload = { _empty: true, raw: rawText.slice(0, 200) };
  }

  // 4. 业务码提取
  const bizCode = typeof payload.code === 'number'
    ? payload.code
    : typeof payload.ret === 'number'
      ? payload.ret as number
      : undefined;
  const isAuthFailure = bizCode !== undefined && AUTH_FAILURE_CODES.has(bizCode);
  const isRateLimited = bizCode !== undefined && RATE_LIMIT_CODES.has(bizCode);

  // 5. 可选 Zod 校验
  let validation: ValidationResult | undefined;
  if (opts?.schemaName) {
    validation = validateApiResponse(opts.schemaName, payload, rawText);
  }

  return {
    httpStatus,
    payload,
    rawText,
    isAntiCrawl,
    isAuthFailure,
    isRateLimited,
    bizCode,
    validation,
  };
}

/**
 * 判断是否为"真正有效"的业务响应
 */
export function isGenuineSuccess(result: ParsedApiResult): boolean {
  if (result.isAntiCrawl) return false;
  if (result.isAuthFailure) return false;
  if (result.isRateLimited) return false;
  if (result.payload._empty) return false;
  if (result.bizCode !== undefined && result.bizCode !== 0) return false;
  if (result.validation && !result.validation.ok) return false;
  return true;
}
