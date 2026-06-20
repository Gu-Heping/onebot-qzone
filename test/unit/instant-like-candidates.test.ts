import {
  chooseBetterCandidate,
  createFeedCandidateMergeState,
  mergeFeedCandidate,
} from '../../src/bridge/instant-like-candidates.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const scoreOf = (item: Record<string, unknown>) => Number(item['_score'] ?? 0);
const richnessOf = (item: Record<string, unknown>) => Number(item['_richness'] ?? 0);

const cases: TestCase[] = [
  {
    name: 'chooseBetterCandidate prefers higher score then richness',
    fn: () => {
      const low = { _score: 10, _richness: 5 };
      const high = { _score: 20, _richness: 1 };
      const rich = { _score: 20, _richness: 6 };
      assert(chooseBetterCandidate(low, high, scoreOf, richnessOf) === high, 'higher score wins');
      assert(chooseBetterCandidate(high, rich, scoreOf, richnessOf) === rich, 'higher richness breaks tie');
    },
  },
  {
    name: 'mergeFeedCandidate keeps alias-only item until primary version arrives',
    fn: () => {
      const state = createFeedCandidateMergeState();
      const aliasOnly = { tid: '', uin: '1', _score: 10, _richness: 1, marker: 'alias' };
      const primary = { tid: 'abc', uin: '1', _score: 30, _richness: 2, marker: 'primary' };
      mergeFeedCandidate(state, aliasOnly, { primaryKey: '1:', aliasKey: 'alias-1' }, scoreOf, richnessOf);
      assert(state.aliasOnly.get('alias-1') === aliasOnly, 'alias-only entry stored');
      mergeFeedCandidate(state, primary, { primaryKey: '1:abc', aliasKey: 'alias-1' }, scoreOf, richnessOf);
      assert(state.aliasOnly.has('alias-1') === false, 'alias-only entry consumed');
      assert(state.canonical.get('1:abc')?.['marker'] === 'primary', 'primary entry promoted');
    },
  },
  {
    name: 'mergeFeedCandidate upgrades canonical item when later alias variant is better',
    fn: () => {
      const state = createFeedCandidateMergeState();
      const primary = { tid: 'abc', uin: '1', _score: 20, _richness: 1, marker: 'primary' };
      const betterAlias = { tid: '', uin: '1', _score: 25, _richness: 4, marker: 'alias-better' };
      mergeFeedCandidate(state, primary, { primaryKey: '1:abc', aliasKey: 'alias-2' }, scoreOf, richnessOf);
      mergeFeedCandidate(state, betterAlias, { primaryKey: '1:', aliasKey: 'alias-2' }, scoreOf, richnessOf);
      assert(state.canonical.get('1:abc')?.['marker'] === 'alias-better', 'better alias replaces canonical');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('instant-like-candidates', cases);
}
