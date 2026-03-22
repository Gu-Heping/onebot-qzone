/**
 * feeds3 / data-param 中的 t1_tid 取值。
 * 实际抓包既有 16+ 位 hex（如 21a69594…），也有 d{uin}_{时间戳}_… 复合串，含下划线；
 * 旧正则 [a-z0-9]+ 会在第一个下划线处截断，导致评论、点赞、meta 归错帖。
 */
const T1_TID_CAPTURE = /t1_tid=([^&"'<>\s]+)/i;

/** 全文扫描，供评论「取评论前最近 t1」等启发式使用 */
export function collectT1TidRefs(text: string): { index: number; postTid: string }[] {
  const out: { index: number; postTid: string }[] = [];
  const re = /t1_tid=([^&"'<>\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[1]!.trim();
    if (v) out.push({ index: m.index, postTid: v });
  }
  return out;
}

/** 从片段中取出首个 t1_tid（评论块内回复链路等） */
export function firstT1TidIn(snippet: string): string {
  const m = snippet.match(T1_TID_CAPTURE);
  return m?.[1]?.trim() ?? '';
}
