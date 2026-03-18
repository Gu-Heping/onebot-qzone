import type { OneBotEvent } from '../qzone/types.js';

export type EventCallback = (event: OneBotEvent) => void | Promise<void>;

const MAX_SEED_TIDS = 20;
const EVENT_DEDUP_TTL_MS = 60_000;
const EVENT_DEDUP_MAX = 1000;

function getEventFingerprint(event: OneBotEvent): string | null {
  const record = event as Record<string, unknown>;
  const postType = String(record['post_type'] ?? '');

  if (postType === 'message') {
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

  subscribe(cb: EventCallback): void {
    this.subscribers.add(cb);
  }

  unsubscribe(cb: EventCallback): void {
    this.subscribers.delete(cb);
  }

  async publish(event: OneBotEvent): Promise<void> {
    if (this.isDuplicateEvent(event)) return;
    for (const cb of this.subscribers) {
      try {
        await cb(event);
      } catch (err) {
        console.error('[EventHub] callback error:', err);
      }
    }
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
