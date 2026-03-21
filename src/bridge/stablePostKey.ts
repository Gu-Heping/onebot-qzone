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

/** 与 normalizeEmotion 输出一致，避免 raw 缺字段时 stable key 为空、Hub 退化成易变的 legacy 指纹 */
export function buildStablePostKeyFromItem(item: { uin: string; tid: string }): string {
  const u = String(item.uin ?? '').trim();
  const t = String(item.tid ?? '').trim();
  if (!u || !t) return '';
  return `${u}:${t}`;
}

/**
 * 合并「归一化 item + 原始 raw」两套键：不同接口/版本下 uin、tid、cellid 可能只填其一，
 * 漏合并会导致 seen 与 Hub `_stable_post_key` 不一致 → 重复推送。
 */
export function seenLookupKeysForPost(
  item: { uin: string; tid: string },
  raw: Record<string, unknown>,
): string[] {
  const cellid = String(raw['cellid'] ?? '').trim() || undefined;
  const merged = new Set<string>();
  for (const k of collectSeenLookupKeys(String(item.uin).trim(), String(item.tid).trim(), cellid)) {
    merged.add(k);
  }
  const ra = authorUinFromRaw(raw);
  const rt = stableTidFromRaw(raw);
  if (ra || rt) {
    for (const k of collectSeenLookupKeys(ra || String(item.uin).trim(), rt || String(item.tid).trim(), cellid)) {
      merged.add(k);
    }
  }
  return [...merged].filter(Boolean);
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
