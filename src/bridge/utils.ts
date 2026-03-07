/** safeInt – port of Python _safe_int */
export function safeInt(val: unknown, defaultVal = 0): number {
  if (val == null || val === '') return defaultVal;
  const n = Number(val);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.trunc(n);
}

/** 把 16 进制颜色 / 数字字符串 安全转换为整数 */
export function safeHex(val: unknown, defaultVal = 0): number {
  if (val == null || val === '') return defaultVal;
  const s = String(val).trim();
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16) || defaultVal;
  return safeInt(val, defaultVal);
}

/** 转义正则特殊字符 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
