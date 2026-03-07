/* ─────────────────────────────────────────────
   原始响应落盘器 (Raw Response Logger)
   校验失败 / 解析异常 / 反爬触发时自动保存原始 HTTP 响应
   ───────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils.js';

const LOG_DIR = path.resolve('logs', 'raw_responses');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 500;

let dirEnsured = false;

function ensureLogDir(): void {
  if (dirEnsured) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    dirEnsured = true;
  } catch (e) {
    log('WARNING', `创建日志目录失败: ${e}`);
  }
}

/** 清理过多的历史文件（按 mtime 最老删除） */
function pruneOldFiles(): void {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .map((f) => {
        try { return { name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }; }
        catch { return null; }
      })
      .filter((f): f is { name: string; mtime: number } => f !== null)
      .sort((a, b) => a.mtime - b.mtime);

    while (files.length > MAX_FILES) {
      const oldest = files.shift()!;
      try { fs.unlinkSync(path.join(LOG_DIR, oldest.name)); } catch { /* ignore */ }
    }
  } catch { /* ignore cleanup errors */ }
}

/**
 * 将原始响应落盘
 * @param apiLabel   接口标识（如 'emotion_list', 'comments_pc_0'）
 * @param rawText    原始 HTTP 响应体
 * @param reasons    落盘原因摘要
 */
export function dumpRawResponse(
  apiLabel: string,
  rawText: string,
  reasons: string[] = [],
): void {
  ensureLogDir();

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = apiLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeLabel}_${ts}.log`;
  const filepath = path.join(LOG_DIR, filename);

  const truncated = rawText.length > MAX_FILE_SIZE
    ? rawText.slice(0, MAX_FILE_SIZE) + `\n\n... [TRUNCATED at ${MAX_FILE_SIZE} bytes, total ${rawText.length}]`
    : rawText;

  const header = [
    `=== Raw Response Dump ===`,
    `API:       ${apiLabel}`,
    `Time:      ${new Date().toISOString()}`,
    `Reasons:   ${reasons.join('; ') || 'N/A'}`,
    `Size:      ${rawText.length} bytes`,
    `===========================`,
    '',
  ].join('\n');

  try {
    fs.writeFileSync(filepath, header + truncated, 'utf-8');
    log('DEBUG', `原始响应已保存: ${filepath}`);
    pruneOldFiles();
  } catch (e) {
    log('WARNING', `原始响应写入失败: ${e}`);
  }
}

/**
 * 高阶函数：包裹异步调用，捕获异常时自动落盘
 */
export function withRawDump<Args extends unknown[], R>(
  apiLabel: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    try {
      return await fn(...args);
    } catch (e) {
      const lastArg = args[args.length - 1];
      const rawText = typeof lastArg === 'string'
        ? lastArg
        : `[no raw text] error: ${e}`;
      dumpRawResponse(apiLabel, rawText, [`exception: ${e}`]);
      throw e;
    }
  };
}
