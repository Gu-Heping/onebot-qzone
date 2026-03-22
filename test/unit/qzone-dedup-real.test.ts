/**
 * 用与 poller.pollComments / pollLikes 相同的「已见集合」逻辑验证去重；
 * 并检查 _pruneTrackingDicts 函数体不触碰 seenCommentIds / seenLikeUins。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function simulateCommentFirstPass(seenCommentIds: Map<string, Set<string>>, tid: string, commentId: string): boolean {
  if (!commentId) return false;
  if (!seenCommentIds.has(tid)) seenCommentIds.set(tid, new Set());
  const isNew = !seenCommentIds.get(tid)!.has(commentId);
  if (isNew) seenCommentIds.get(tid)!.add(commentId);
  return isNew;
}

function simulateLikeFirstPass(seenLikeUins: Map<string, Set<string>>, tid: string, uin: string): boolean {
  if (!uin) return false;
  if (!seenLikeUins.has(tid)) seenLikeUins.set(tid, new Set());
  if (!seenLikeUins.get(tid)!.has(uin)) {
    seenLikeUins.get(tid)!.add(uin);
    return true;
  }
  return false;
}

const cases: TestCase[] = [
  {
    name: '同一 tid + commentId 第二次不应再视为新评论',
    fn: () => {
      const seen = new Map<string, Set<string>>();
      const tid = '20250320143000abcdef';
      const cid = 'feeds_comment_realistic_id_9f3a2b1c';
      assert(simulateCommentFirstPass(seen, tid, cid) === true, '首次为新');
      assert(simulateCommentFirstPass(seen, tid, cid) === false, '二次应去重');
      assert(seen.get(tid)!.has(cid), '集合应保留 id');
    },
  },
  {
    name: '不同 tid 相同 commentId 仍各自可首次上报（键按帖隔离）',
    fn: () => {
      const seen = new Map<string, Set<string>>();
      const cid = 'same_id_different_posts_edge';
      assert(simulateCommentFirstPass(seen, 'tid_a', cid) === true, 'tid_a 首次');
      assert(simulateCommentFirstPass(seen, 'tid_b', cid) === true, 'tid_b 首次');
    },
  },
  {
    name: '同一 tid + uin 点赞第二次应去重',
    fn: () => {
      const seen = new Map<string, Set<string>>();
      const tid = '20250320143000abcdef';
      const uin = '876543210';
      assert(simulateLikeFirstPass(seen, tid, uin) === true, '点赞首次');
      assert(simulateLikeFirstPass(seen, tid, uin) === false, '点赞二次去重');
    },
  },
  {
    name: '_pruneTrackingDicts 函数体内不得引用 seenCommentIds / seenLikeUins',
    fn: () => {
      const pollerPath = join(__dirname, '../../src/bridge/poller.ts');
      const src = readFileSync(pollerPath, 'utf8');
      const m = src.match(
        /private _pruneTrackingDicts\([^)]*\): void \{([\s\S]*?)\n  \}\n\n  private emitHeartbeat/,
      );
      assert(!!m, '应能解析 _pruneTrackingDicts 函数体');
      const body = m![1];
      assert(!body.includes('seenCommentIds'), '裁剪时不应操作 seenCommentIds');
      assert(!body.includes('seenLikeUins'), '裁剪时不应操作 seenLikeUins');
    },
  },
];

export async function run() {
  return runSuite('qzone-dedup-real', cases);
}
