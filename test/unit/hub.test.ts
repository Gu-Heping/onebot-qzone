/**
 * EventHub 单元测试
 */
import { EventHub } from '../../src/bridge/hub.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'subscribe + publish 基本工作',
    fn: async () => {
      const hub = new EventHub();
      const received: unknown[] = [];
      hub.subscribe((ev) => { received.push(ev); });
      await hub.publish({ type: 'test', data: 1 });
      assert(received.length === 1, '应收到 1 条');
      assert((received[0] as any).data === 1, '数据应一致');
    },
  },
  {
    name: 'publish 多订阅者全部收到',
    fn: async () => {
      const hub = new EventHub();
      let c1 = 0, c2 = 0;
      hub.subscribe(() => { c1++; });
      hub.subscribe(() => { c2++; });
      await hub.publish({ type: 'x' });
      assert(c1 === 1 && c2 === 1, '两个订阅者都应收到');
    },
  },
  {
    name: 'unsubscribe 后不再收到',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      const cb = () => { count++; };
      hub.subscribe(cb);
      await hub.publish({ type: 'a' });
      hub.unsubscribe(cb);
      await hub.publish({ type: 'b' });
      assert(count === 1, 'unsubscribe 后不应再收到');
    },
  },
  {
    name: 'publish 单回调异常不阻断其他',
    fn: async () => {
      const hub = new EventHub();
      let ok = false;
      hub.subscribe(() => { throw new Error('boom'); });
      hub.subscribe(() => { ok = true; });
      await hub.publish({ type: 'err' });
      assert(ok, '第二个回调应正常执行');
    },
  },
  {
    name: 'subscriberCount 正确',
    fn: () => {
      const hub = new EventHub();
      assert(hub.subscriberCount() === 0, '初始为 0');
      const cb = () => {};
      hub.subscribe(cb);
      assert(hub.subscriberCount() === 1, '添加后为 1');
      hub.unsubscribe(cb);
      assert(hub.subscriberCount() === 0, '移除后为 0');
    },
  },
  {
    name: 'seedTid 去重 + FIFO 上限',
    fn: () => {
      const hub = new EventHub();
      hub.addSeedTid('a');
      hub.addSeedTid('a');
      assert(hub.getSeedTids().length === 1, '重复不应增加');
      for (let i = 0; i < 25; i++) hub.addSeedTid(`t_${i}`);
      const tids = hub.getSeedTids();
      assert(tids.length === 20, '最多 20 条');
      assert(!tids.includes('t_0'), '最早的应被淘汰');
      assert(tids.includes('t_24'), '最新的应保留');
    },
  },
  {
    name: 'getSeedTids 返回副本',
    fn: () => {
      const hub = new EventHub();
      hub.addSeedTid('x');
      const t1 = hub.getSeedTids();
      t1.push('injected');
      assert(hub.getSeedTids().length === 1, '修改副本不应影响原数据');
    },
  },
  {
    name: '无订阅者时 publish 不报错',
    fn: async () => {
      const hub = new EventHub();
      await hub.publish({ type: 'lonely' });
    },
  },
  {
    name: '相同动态事件短期内只推送一次',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      hub.subscribe(() => { count++; });
      const event = {
        post_type: 'message',
        self_id: 10001,
        message_id: 123,
        _tid: '123',
      } as any;
      await hub.publish(event);
      await hub.publish(event);
      assert(count === 1, '重复动态事件应被去重');
    },
  },
  {
    name: '同 _stable_post_key 不同 _tid 仍去重',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      hub.subscribe(() => { count++; });
      const a = {
        post_type: 'message',
        self_id: 10001,
        message_id: 1,
        _tid: 'aaa',
        _stable_post_key: '777:aaa',
      } as any;
      const b = { ...a, _tid: 'bbb', message_id: 2 };
      await hub.publish(a);
      await hub.publish(b);
      assert(count === 1, 'stable key 相同应去重');
    },
  },
  {
    name: '相同评论事件短期内只推送一次',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      hub.subscribe(() => { count++; });
      const event = {
        post_type: 'notice',
        notice_type: 'qzone_comment',
        self_id: 10001,
        post_tid: 'post_1',
        comment_id: 'comment_1',
      } as any;
      await hub.publish(event);
      await hub.publish(event);
      assert(count === 1, '重复评论事件应被去重');
    },
  },
  {
    name: '评论事件 self_id 数字与字符串指纹一致应去重',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      hub.subscribe(() => { count++; });
      const base = {
        post_type: 'notice',
        notice_type: 'qzone_comment',
        post_tid: 'tid_hex_1',
        comment_id: 'cmt_9',
      } as any;
      await hub.publish({ ...base, self_id: 2492835361 });
      await hub.publish({ ...base, self_id: '2492835361' });
      assert(count === 1, 'self_id 形态不同不应重复下发');
    },
  },
  {
    name: '不同动态事件不应被错误去重',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      hub.subscribe(() => { count++; });
      await hub.publish({ post_type: 'message', self_id: 10001, message_id: 1, _tid: '1' } as any);
      await hub.publish({ post_type: 'message', self_id: 10001, message_id: 2, _tid: '2' } as any);
      assert(count === 2, '不同事件应正常下发');
    },
  },
  {
    name: '_stable_post_key 与 _author_uin+_tid 应视为同一帖去重',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      hub.subscribe(() => { count++; });
      const withStable = {
        post_type: 'message',
        self_id: 10001,
        _tid: 'fgafhjdhhb',
        _stable_post_key: '2492835361:fgafhjdhhb',
        sender: { user_id: 2492835361, nickname: 'x' },
      } as any;
      const withAuthorTidOnly = {
        post_type: 'message',
        self_id: 10001,
        _tid: 'fgafhjdhhb',
        _author_uin: '2492835361',
        message_id: 0,
      } as any;
      await hub.publish(withStable);
      await hub.publish(withAuthorTidOnly);
      assert(count === 1, '同一作者+tid 不同字段形态应去重');
    },
  },
  {
    name: 'sender.user_id 与 _stable_post_key 应视为同一帖去重',
    fn: async () => {
      const hub = new EventHub();
      let count = 0;
      hub.subscribe(() => { count++; });
      await hub.publish({
        post_type: 'message',
        self_id: 10001,
        _tid: 'abc',
        _stable_post_key: '888:abc',
      } as any);
      await hub.publish({
        post_type: 'message',
        self_id: 10001,
        _tid: 'abc',
        sender: { user_id: 888 },
      } as any);
      assert(count === 1, 'sender.user_id 应对齐 stable 指纹');
    },
  },
];

export async function run() {
  return runSuite('hub/EventHub', cases);
}
