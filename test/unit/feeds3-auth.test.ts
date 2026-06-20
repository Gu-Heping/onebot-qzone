import { QzoneClient } from '../../src/qzone/client.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

function makeFeeds3AuthError() {
  const error = new Error('need login') as Error & { payload?: Record<string, unknown> };
  error.payload = {
    code: -3000,
    subcode: -4001,
    message: 'need login',
    tips: 'need login',
  };
  return error;
}

const cases: TestCase[] = [
  {
    name: 'extractFeeds3BusinessFailure detects auth response payload',
    fn: () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      const parsed = anyClient.extractFeeds3BusinessFailure('_Callback({"code":-3000,"subcode":-4001,"message":"need login"})');
      assert(parsed != null, 'expected feeds3 business failure payload');
      assert(parsed.code === -3000, `expected code -3000, got ${String(parsed.code)}`);
      assert(client.isAuthFailure(parsed), 'expected auth failure classification');
    },
  },
  {
    name: 'getEmotionList returns auth failure instead of empty success',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      anyClient.qqNumber = '3905536442';
      anyClient.fetchFeeds3Html = async () => { throw makeFeeds3AuthError(); };

      const result = await client.getEmotionList('3905536442', 0, 5);
      assert(result.code === -3000, `expected auth failure code, got ${String(result.code)}`);
      assert(Array.isArray(result.msglist) && result.msglist.length === 0, 'expected empty msglist on failure');
      assert(result['_failure_kind'] === 'auth', `expected auth failure kind, got ${String(result['_failure_kind'])}`);
    },
  },
  {
    name: 'getFriendFeeds fast mode returns auth failure instead of empty success',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      anyClient.qqNumber = '3905536442';
      anyClient.fetchFeeds3Html = async () => { throw makeFeeds3AuthError(); };

      const result = await client.getFriendFeeds('', 5, { fastMode: true });
      assert(result.code === -3000, `expected auth failure code, got ${String(result.code)}`);
      assert(result['_failure_kind'] === 'auth', `expected auth failure kind, got ${String(result['_failure_kind'])}`);
    },
  },
  {
    name: 'getFriendFeeds slow mode returns auth failure instead of empty success',
    fn: async () => {
      const client = new QzoneClient({ cachePath: './test_cache' });
      const anyClient = client as unknown as Record<string, any>;
      anyClient.qqNumber = '3905536442';
      anyClient.fetchFeeds3Html = async () => { throw makeFeeds3AuthError(); };

      const result = await client.getFriendFeeds('', 5, { fastMode: false });
      assert(result.code === -3000, `expected auth failure code, got ${String(result.code)}`);
      assert(result['_failure_kind'] === 'auth', `expected auth failure kind, got ${String(result['_failure_kind'])}`);
    },
  },
];

export async function run() {
  return runSuite('feeds3/auth', cases);
}
