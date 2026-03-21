import type { OneBotEvent } from '../qzone/types.js';

export type EventCallback = (event: OneBotEvent) => void | Promise<void>;

const MAX_SEED_TIDS = 20;
/** 轮询多路（说说+好友流）可能在 60s 内用不同指纹重复到达；过短会误判「去重失败」实为 TTL 过期 */
const EVENT_DEDUP_TTL_MS = 300_000;
const EVENT_DEDUP_MAX = 1000;

export type EventHubOptions = { eventDebug?: boolean };

function getEventFingerprint(event: OneBotEvent): string | null {
  const record = event as Record<string, unknown>;
  const postType = String(record['post_type'] ?? '');

  if (postType === 'message') {
    const stable = String(record['_stable_post_key'] ?? '').trim();
    if (stable) {
      const colon = stable.indexOf(':');
      if (colon > 0) {
        const authorUin = stable.slice(0, colon);
        const stableTid = stable.slice(colon + 1);
        if (stableTid) {
          return `message:${record['self_id'] ?? ''}:${authorUin}:${stableTid}`;
        }
      }
    }
    const tid = String(record['_tid'] ?? record['message_id'] ?? '');
    if (!tid) return null;
    return `message:${record['self_id'] ?? ''}:${tid}`;
  }

  if (postType !== 'notice') return null;

  const noticeType = String(record['notice_type'] ?? '');
  if (noticeType === 'qzone_comment') {
    const postTid = String(record['post_tid'] ?? '');
    const commentId = String(record['comment_id'] ?? '');
    if (!postTid || !commentId) return null;
    return `comment:${record['self_id'] ?? ''}:${postTid}:${commentId}`;
  }

  if (noticeType === 'qzone_like') {
    const postTid = String(record['post_tid'] ?? '');
    const userId = String(record['user_id'] ?? '');
    if (!postTid || !userId) return null;
    return `like:${record['self_id'] ?? ''}:${postTid}:${userId}`;
  }

  return null;
}

export class EventHub {
  private subscribers = new Set<EventCallback>();
  private seedTids: string[] = [];
  private recentEventFingerprints = new Map<string, number>();
  private readonly eventDebug: boolean;

  constructor(opts?: EventHubOptions) {
    this.eventDebug = Boolean(opts?.eventDebug);
  }

  subscribe(cb: EventCallback): void {
    this.subscribers.add(cb);
  }

  unsubscribe(cb: EventCallback): void {
    this.subscribers.delete(cb);
  }

  /** @returns 是否实际下发（false 表示短期内重复已去重） */
  async publish(event: OneBotEvent): Promise<boolean> {
    const fp = getEventFingerprint(event);
    if (this.isDuplicateEvent(event)) {
      if (this.eventDebug && fp) console.log(`[push][dedupe] ${fp}`);
      return false;
    }
    if (this.eventDebug && fp) console.log(`[push][publish] ${fp}`);
    for (const cb of this.subscribers) {
      try {
        await cb(event);
      } catch (err) {
        console.error('[EventHub] callback error:', err);
      }
    }
    return true;
  }

  addSeedTid(tid: string): void {
    if (!this.seedTids.includes(tid)) {
      this.seedTids.push(tid);
      if (this.seedTids.length > MAX_SEED_TIDS) {
        this.seedTids.shift();
      }
    }
  }

  getSeedTids(): string[] {
    return [...this.seedTids];
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  private isDuplicateEvent(event: OneBotEvent): boolean {
    const fingerprint = getEventFingerprint(event);
    if (!fingerprint) return false;

    const nowMs = Date.now();
    this.pruneRecentEventFingerprints(nowMs);

    const lastSeenAt = this.recentEventFingerprints.get(fingerprint);
    if (lastSeenAt != null && nowMs - lastSeenAt < EVENT_DEDUP_TTL_MS) {
      return true;
    }

    this.recentEventFingerprints.set(fingerprint, nowMs);
    return false;
  }

  private pruneRecentEventFingerprints(nowMs: number): void {
    for (const [fingerprint, seenAt] of this.recentEventFingerprints) {
      if (nowMs - seenAt >= EVENT_DEDUP_TTL_MS) {
        this.recentEventFingerprints.delete(fingerprint);
      }
    }

    while (this.recentEventFingerprints.size > EVENT_DEDUP_MAX) {
      const oldestKey = this.recentEventFingerprints.keys().next().value;
      if (!oldestKey) break;
      this.recentEventFingerprints.delete(oldestKey);
    }
  }
}
