/**
 * 说说稳定标识：用于跨数据源、重启后的 seen 与 Hub 去重指纹。
 */

export function stableTidFromRaw(raw: Record<string, unknown>): string {
  return String(raw['tid'] ?? raw['cellid'] ?? '').trim();
}

export function authorUinFromRaw(raw: Record<string, unknown>): string {
  return String(raw['opuin'] ?? raw['uin'] ?? raw['frienduin'] ?? '').trim();
}

/** 作者 UIN + 稳定 tid，形如 `1234567890:abc...` */
export function buildStablePostKey(raw: Record<string, unknown>): string {
  const author = authorUinFromRaw(raw);
  const tid = stableTidFromRaw(raw);
  if (!author || !tid) return '';
  return `${author}:${tid}`;
}

/**
 * seen_post_tids 兼容：历史版本曾存 tid、`uin_tid` 等，检查任一则视为已见。
 * 写入时也应把本列表全部加入内存 Set，避免旧键残留导致重复推送。
 */
export function collectSeenLookupKeys(
  authorUin: string,
  stableTid: string,
  cellid?: string,
): string[] {
  const keys = new Set<string>();
  if (!stableTid) return [];
  const canon = authorUin ? `${authorUin}:${stableTid}` : '';
  if (canon) keys.add(canon);
  if (authorUin) keys.add(`${authorUin}_${stableTid}`);
  keys.add(stableTid);
  const cid = (cellid ?? '').trim();
  if (cid && cid !== stableTid) {
    if (authorUin) keys.add(`${authorUin}:${cid}`);
    if (authorUin) keys.add(`${authorUin}_${cid}`);
    keys.add(cid);
  }
  return [...keys].filter(Boolean);
}
