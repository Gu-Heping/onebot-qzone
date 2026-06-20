import { buildDependentFailureMessage, SkipCheckError, summarizeFeeds3Failure } from '../../scripts/verify-endpoints.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'summarizeFeeds3Failure marks emotion_list need login as auth failure',
    fn: () => {
      const summary = summarizeFeeds3Failure({
        code: -3000,
        subcode: -4001,
        message: 'need login',
      }, 'emotion_list');
      assert(summary.kind === 'auth', `expected auth kind, got ${summary.kind}`);
      assert(summary.message.includes('feeds3 auth failure'), `expected auth failure wording, got ${summary.message}`);
    },
  },
  {
    name: 'dependent failure message inherits emotion_list auth failure',
    fn: () => {
      const message = buildDependentFailureMessage('comment_list', {
        kind: 'auth',
        message: 'feeds3 auth failure: need login',
      });
      assert(message.includes('comment_list blocked by emotion_list auth failure'), `unexpected message: ${message}`);
    },
  },
  {
    name: 'SkipCheckError preserves skip semantics',
    fn: () => {
      const error = new SkipCheckError('emotion_list returned no posts');
      assert(error instanceof Error, 'expected SkipCheckError to extend Error');
      assert(error.name === 'SkipCheckError', `expected SkipCheckError name, got ${error.name}`);
    },
  },
];

export async function run() {
  return runSuite('verify-endpoints', cases);
}
