import {
  candidateHistoryDelta,
  compactInstantLikeState,
  hasSeenCandidateState,
  markCandidateFailedState,
  markCandidateSeenState,
  normalizeInstantLikeState,
  orderStrategyLabels,
  recordStrategyOutcome,
  shouldCooldownCandidateState,
} from '../../src/bridge/instant-like-state.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const NOW = 1_800_000_000;

const cases: TestCase[] = [
  {
    name: 'normalizeInstantLikeState fills missing buckets',
    fn: () => {
      const state = normalizeInstantLikeState({ liked: { a: 1 } });
      assert(state.liked['a'] === 1, 'keeps liked');
      assert(Object.keys(state.likedAliases).length === 0, 'fills likedAliases');
      assert(Object.keys(state.failedAliases).length === 0, 'fills failedAliases');
      assert(Object.keys(state.strategyHistory).length === 0, 'fills strategyHistory');
    },
  },
  {
    name: 'recordStrategyOutcome and orderStrategyLabels prefer proven strategy',
    fn: () => {
      const state = normalizeInstantLikeState(undefined);
      recordStrategyOutcome(state, 'share-1', 'likeEmotion(appFallback)', false, NOW - 10);
      recordStrategyOutcome(state, 'share-1', 'likeEmotion(musicShare.playUrl+numericCurkey)', true, NOW);
      const ordered = orderStrategyLabels(
        ['likeEmotion(appFallback)', 'likeEmotion(musicShare.playUrl+numericCurkey)'],
        state.strategyHistory,
        'share-1',
        NOW,
      );
      assert(ordered[0] === 'likeEmotion(musicShare.playUrl+numericCurkey)', 'proven strategy should be first');
    },
  },
  {
    name: 'candidateHistoryDelta boosts proven fingerprints and penalizes recent failures',
    fn: () => {
      const state = normalizeInstantLikeState(undefined);
      recordStrategyOutcome(state, 'share-2', 'likeEmotion(musicShare.playUrl+numericCurkey)', true, NOW);
      markCandidateFailedState(state, NOW - 60, 'alias-3', 70);
      const boosted = candidateHistoryDelta(
        state,
        'share-2',
        'alias-clean',
        ['likeEmotion(appFallback)', 'likeEmotion(musicShare.playUrl+numericCurkey)'],
        NOW,
      );
      const penalized = candidateHistoryDelta(
        state,
        'share-2',
        'alias-3',
        ['likeEmotion(appFallback)', 'likeEmotion(musicShare.playUrl+numericCurkey)'],
        NOW,
      );
      assert(boosted > penalized, 'recently failed alias should rank lower than clean alias');
    },
  },
  {
    name: 'markCandidateFailedState and shouldCooldownCandidateState respect threshold and better score escape hatch',
    fn: () => {
      const state = normalizeInstantLikeState(undefined);
      markCandidateFailedState(state, NOW - 30, 'alias-1', 70);
      markCandidateFailedState(state, NOW - 10, 'alias-1', 75);
      assert(shouldCooldownCandidateState(state, 'alias-1', NOW, 2, 900, 70) === true, 'same-or-worse score cools down');
      assert(shouldCooldownCandidateState(state, 'alias-1', NOW, 2, 900, 80) === false, 'better score should retry');
      assert(shouldCooldownCandidateState(state, 'alias-1', NOW, 3, 900, 70) === false, 'below threshold should not cool down');
    },
  },
  {
    name: 'markCandidateSeenState clears failed alias and seen alias is recognized',
    fn: () => {
      const state = normalizeInstantLikeState(undefined);
      markCandidateFailedState(state, NOW, 'alias-2', 60);
      markCandidateSeenState(state, NOW, [{ seenKey: 'uin:tid', aliasKey: 'alias-2' }]);
      assert(hasSeenCandidateState(state, 'uin:tid', 'alias-2') === true, 'seen candidate recognized');
      assert(state.failedAliases['alias-2'] === undefined, 'successful mark clears failed alias');
    },
  },
  {
    name: 'compactInstantLikeState prunes stale seen and stale failure-only history',
    fn: () => {
      const state = normalizeInstantLikeState({
        liked: { stale: NOW - 31 * 86400, keep: NOW - 10 },
        likedAliases: { staleAlias: NOW - 31 * 86400, keepAlias: NOW - 10 },
        failedAliases: {
          staleFail: { count: 2, lastFailedAt: NOW - 31 * 86400, bestScore: 60 },
          keepFail: { count: 1, lastFailedAt: NOW - 20, bestScore: 70 },
        },
        strategyHistory: {
          s1: { a: { success: 0, failure: 1 } },
          s2: { b: { success: 1, failure: 3, lastSuccessAt: NOW - 100 } },
        },
      });
      compactInstantLikeState(state, NOW);
      assert(state.liked['stale'] === undefined, 'stale liked removed');
      assert(state.liked['keep'] === NOW - 10, 'recent liked kept');
      assert(state.likedAliases['staleAlias'] === undefined, 'stale alias removed');
      assert(state.failedAliases['staleFail'] === undefined, 'stale failed alias removed');
      assert(state.failedAliases['keepFail']?.count === 1, 'recent failed alias kept');
      assert(state.strategyHistory['s1'] === undefined, 'stale failure-only strategy pruned');
      assert(state.strategyHistory['s2']?.['b']?.success === 1, 'successful strategy kept');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('instant-like-state', cases);
}
