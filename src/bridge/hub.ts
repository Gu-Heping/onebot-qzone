import type { OneBotEvent } from '../qzone/types.js';

export type EventCallback = (event: OneBotEvent) => void | Promise<void>;

const MAX_SEED_TIDS = 20;

export class EventHub {
  private subscribers = new Set<EventCallback>();
  private seedTids: string[] = [];

  subscribe(cb: EventCallback): void {
    this.subscribers.add(cb);
  }

  unsubscribe(cb: EventCallback): void {
    this.subscribers.delete(cb);
  }

  async publish(event: OneBotEvent): Promise<void> {
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
}
