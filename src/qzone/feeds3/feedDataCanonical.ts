/**
 * feed_data 属性上的 tid 与 parseFeeds3Items / 分段评论共用同一套 canonical 规则，避免各模块漂移。
 */

export function dataAttrFromFeedData(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`));
  return m?.[1] ?? '';
}

/** 与 parseFeeds3Items 一致：数字 tid → fkey / data-key（key 可能在 feed_data 之前的 HTML 里） */
export function canonicalPostTidFromFeedAttrs(
  attrs: string,
  searchBefore: string,
  searchAfterHead: string,
): string {
  let tid = dataAttrFromFeedData(attrs, 'tid') || dataAttrFromFeedData(attrs, 'origtid');
  if (!tid || tid === 'advertisement_app') return '';
  if (/^\d+$/.test(tid)) {
    const fkey = dataAttrFromFeedData(attrs, 'fkey');
    if (fkey) return fkey;
    const combined = `${searchBefore} ${attrs} ${searchAfterHead}`;
    let keyMatch = combined.match(/data-key="([a-z0-9]{6,})"/i);
    if (!keyMatch) keyMatch = combined.match(/key:\s*['"]([a-z0-9]{6,})['"]/i);
    if (keyMatch) return keyMatch[1]!;
  }
  return tid;
}
