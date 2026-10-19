import {
  completeCommentBaseline,
  completeLikeBaseline,
  createBaselineState,
  initializeInteractiveBaseline,
  isBaselineComplete,
  isCommentBaselinePending,
  isLikeBaselinePending,
  normalizeBaselineState,
  pruneBaselinePending,
} from '../../src/bridge/firstRunBaseline.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: '首次运行创建未完成基线',
    fn: () => {
      const state = createBaselineState({ postsSeen: false, interactiveSeen: false });
      assert(state.postsDone === false, 'postsDone');
      assert(state.friendFeedsDone === false, 'friendFeedsDone');
      assert(state.interactiveInitialized === false, 'interactive');
      assert(state.pendingComments.length === 0 && state.pendingLikes.length === 0, 'pending empty');
    },
  },
  {
    name: '旧版 seen 文件视为已完成',
    fn: () => {
      const state = createBaselineState({ postsSeen: true, interactiveSeen: true });
      assert(state.postsDone && state.friendFeedsDone && state.interactiveInitialized, 'all done');
      assert(isBaselineComplete(state), 'complete');
    },
  },
  {
    name: '损坏或缺失字段归一化',
    fn: () => {
      const state = normalizeBaselineState({ postsDone: 'yes', pendingComments: ['a', 'a', 1, 'b'] });
      assert(state.postsDone === false, 'non-boolean is false');
      assert(state.pendingComments.join(',') === 'a,b', 'dedupe and filter');
      assert(state.pendingLikes.length === 0, 'missing likes');
      const empty = normalizeBaselineState(null);
      assert(empty.v === 1 && !empty.postsDone, 'null fallback');
    },
  },
  {
    name: '交互基线快照幂等',
    fn: () => {
      const state = createBaselineState({ postsSeen: true, interactiveSeen: false });
      assert(initializeInteractiveBaseline(state, ['t1', 't2', 't1']), 'first init');
      assert(state.pendingComments.join(',') === 't1,t2', 'comments snapshot');
      assert(state.pendingLikes.join(',') === 't1,t2', 'likes snapshot');
      assert(!initializeInteractiveBaseline(state, ['t3']), 'second init is no-op');
      assert(state.pendingComments.join(',') === 't1,t2', 'snapshot preserved');
    },
  },
  {
    name: '评论与点赞基线独立完成',
    fn: () => {
      const state = createBaselineState({ postsSeen: true, interactiveSeen: false });
      initializeInteractiveBaseline(state, ['t1', 't2']);
      assert(isCommentBaselinePending(state, 't1') && isLikeBaselinePending(state, 't1'), 'pending both');
      completeCommentBaseline(state, 't1');
      assert(!isCommentBaselinePending(state, 't1'), 'comment done');
      assert(isLikeBaselinePending(state, 't1'), 'like still pending');
      completeLikeBaseline(state, 't1');
      completeCommentBaseline(state, 't2');
      completeLikeBaseline(state, 't2');
      assert(isBaselineComplete(state), 'complete after both kinds');
    },
  },
  {
    name: '裁剪只保留仍在跟踪的 tid',
    fn: () => {
      const state = createBaselineState({ postsSeen: true, interactiveSeen: false });
      initializeInteractiveBaseline(state, ['t1', 't2', 't3']);
      assert(pruneBaselinePending(state, new Set(['t2'])), 'changed');
      assert(state.pendingComments.join(',') === 't2', 'comments pruned');
      assert(state.pendingLikes.join(',') === 't2', 'likes pruned');
      assert(!pruneBaselinePending(state, new Set(['t2'])), 'no change second time');
    },
  },
];

export async function run() {
  return runSuite('bridge/first-run-baseline', cases);
}
