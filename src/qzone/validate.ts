/* ─────────────────────────────────────────────
   运行时校验层 (Runtime Validation)
   在 parseJsonp 之后、业务逻辑之前用 Zod 强校验
   ───────────────────────────────────────────── */

import { type ZodSchema, ZodError } from 'zod';
import { type SchemaName, SCHEMA_REGISTRY } from './schemas.js';
import { dumpRawResponse } from './rawLogger.js';
import { log } from './utils.js';

export interface ValidationResult<T = unknown> {
  ok: boolean;
  data: T | null;
  /** Zod issues（仅校验失败时） */
  issues: string[];
  /** 原始未校验数据（始终保留） */
  raw: unknown;
}

/**
 * 校验单个 API 响应
 * @param schemaName  已注册的 schema 名称
 * @param payload     parseJsonp 后的原始对象
 * @param rawText     HTTP 原始响应文本（用于落盘）
 * @returns           校验结果（不 throw）
 */
export function validateApiResponse<T>(
  schemaName: SchemaName,
  payload: unknown,
  rawText?: string,
): ValidationResult<T> {
  const schema = SCHEMA_REGISTRY[schemaName] as ZodSchema;
  if (!schema) {
    log('WARNING', `未注册的 schema: ${schemaName}，跳过校验`);
    return { ok: true, data: payload as T, issues: [], raw: payload };
  }

  const result = schema.safeParse(payload);
  if (result.success) {
    return { ok: true, data: result.data as T, issues: [], raw: payload };
  }

  // 校验失败：落盘 + 日志
  const issues = result.error.issues.map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );
  log('WARNING', `[validate:${schemaName}] 校验失败: ${issues.join('; ')}`);

  if (rawText) {
    dumpRawResponse(schemaName, rawText, issues);
  }

  return { ok: false, data: null, issues, raw: payload };
}

/**
 * 严格模式：校验失败直接 throw（适用于核心路径）
 */
export function validateOrThrow<T>(
  schemaName: SchemaName,
  payload: unknown,
  rawText?: string,
): T {
  const res = validateApiResponse<T>(schemaName, payload, rawText);
  if (!res.ok) {
    throw new ZodValidationError(schemaName, res.issues);
  }
  return res.data!;
}

export class ZodValidationError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly issues: string[],
  ) {
    super(`[${schemaName}] 数据校验失败: ${issues.join('; ')}`);
    this.name = 'ZodValidationError';
  }
}
