import { buildClient, fromEnv } from '../../src/bridge/config.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'fromEnv returns required fields',
    fn: () => {
      const cfg = fromEnv();
      assert(typeof cfg.host === 'string', 'host');
      assert(typeof cfg.port === 'number', 'port');
      assert(Array.isArray(cfg.httpPostUrls), 'httpPostUrls');
      assert(Array.isArray(cfg.wsReverseUrls), 'wsReverseUrls');
      assert(typeof cfg.cachePath === 'string', 'cachePath');
      assert(typeof cfg.pollInterval === 'number', 'pollInterval');
      assert(typeof cfg.emitMessageEvents === 'boolean', 'emitMessageEvents');
      assert(typeof cfg.emitHeartbeatEvents === 'boolean', 'emitHeartbeatEvents');
    },
  },
  {
    name: 'fromEnv uses default port',
    fn: () => {
      const prev = process.env['ONEBOT_PORT'];
      delete process.env['ONEBOT_PORT'];
      const cfg = fromEnv();
      assert(cfg.port === 8080, 'default port should be 8080');
      if (prev !== undefined) process.env['ONEBOT_PORT'] = prev;
    },
  },
  {
    name: 'fromEnv uses default cachePath',
    fn: () => {
      const prev = process.env['QZONE_CACHE_PATH'];
      delete process.env['QZONE_CACHE_PATH'];
      const cfg = fromEnv();
      assert(cfg.cachePath === './test_cache', 'default cachePath');
      if (prev !== undefined) process.env['QZONE_CACHE_PATH'] = prev;
    },
  },
  {
    name: 'fromEnv ignores invalid numeric values',
    fn: () => {
      const prev = process.env['ONEBOT_POLL_INTERVAL'];
      try {
        process.env['ONEBOT_POLL_INTERVAL'] = 'abc';
        assert(fromEnv().pollInterval === 60, 'NaN should fall back to 60');
        process.env['ONEBOT_POLL_INTERVAL'] = '-5';
        assert(fromEnv().pollInterval === 60, 'negative should fall back to 60');
        process.env['ONEBOT_POLL_INTERVAL'] = '';
        assert(fromEnv().pollInterval === 60, 'empty should fall back to 60');
      } finally {
        if (prev !== undefined) process.env['ONEBOT_POLL_INTERVAL'] = prev;
        else delete process.env['ONEBOT_POLL_INTERVAL'];
      }
    },
  },
  {
    name: 'fromEnv parses baseline switch',
    fn: () => {
      const prev = process.env['ONEBOT_BASELINE_ON_FIRST_RUN'];
      try {
        process.env['ONEBOT_BASELINE_ON_FIRST_RUN'] = '0';
        assert(fromEnv().baselineOnFirstRun === false, '0 disables baseline');
        process.env['ONEBOT_BASELINE_ON_FIRST_RUN'] = 'yes';
        assert(fromEnv().baselineOnFirstRun === true, 'yes enables baseline');
        process.env['ONEBOT_BASELINE_ON_FIRST_RUN'] = 'not-a-bool';
        assert(fromEnv().baselineOnFirstRun === true, 'invalid falls back to default true');
      } finally {
        if (prev !== undefined) process.env['ONEBOT_BASELINE_ON_FIRST_RUN'] = prev;
        else delete process.env['ONEBOT_BASELINE_ON_FIRST_RUN'];
      }
    },
  },
  {
    name: 'fromEnv parses proxy config',
    fn: () => {
      const prevProxy = process.env['QZONE_PROXY_URL'];
      const prevPool = process.env['QZONE_PROXY_POOL'];
      process.env['QZONE_PROXY_URL'] = 'http://127.0.0.1:7890';
      process.env['QZONE_PROXY_POOL'] = 'http://127.0.0.1:9001,\nhttps://user:pass@127.0.0.1:9002';
      const cfg = fromEnv();
      assert(cfg.proxyUrl === 'http://127.0.0.1:7890', 'proxyUrl');
      assert(Array.isArray(cfg.proxyPool) && cfg.proxyPool.length === 2, 'proxyPool length');
      assert(cfg.proxyPool?.[1] === 'https://user:pass@127.0.0.1:9002', 'proxyPool second');
      if (prevProxy !== undefined) process.env['QZONE_PROXY_URL'] = prevProxy; else delete process.env['QZONE_PROXY_URL'];
      if (prevPool !== undefined) process.env['QZONE_PROXY_POOL'] = prevPool; else delete process.env['QZONE_PROXY_POOL'];
    },
  },
  {
    name: 'buildClient keeps proxy pool rotation capability',
    fn: () => {
      const client = buildClient({
        host: '127.0.0.1',
        port: 8080,
        accessToken: '',
        httpPostUrls: [],
        wsReverseUrls: [],
        wsReverseApiUrls: [],
        wsReverseEventUrls: [],
        wsReverseReconnectInterval: 5,
        pollInterval: 60,
        commentPollInterval: 120,
        likePollInterval: 180,
        friendFeedPollInterval: 120,
        maxRequestBodyBytes: 64 * 1024 * 1024,
        baselineOnFirstRun: true,
        enableQr: false,
        emitMessageEvents: true,
        emitCommentEvents: true,
        emitLikeEvents: true,
        emitFriendFeedEvents: false,
        emitHeartbeatEvents: true,
        eventDebug: false,
        eventPollSource: 'auto',
        attachImageDataInEvents: true,
        cachePath: './test_cache',
        proxyUrl: 'http://127.0.0.1:7890',
        proxyPool: ['http://127.0.0.1:9001', 'http://127.0.0.1:9002'],
      });
      const runtime = client as unknown as {
        config: { proxyUrl?: string; proxyPool?: string[] };
        nextProxyUrl(): string | null;
      };
      assert(runtime.config.proxyUrl === 'http://127.0.0.1:7890', 'client proxyUrl');
      assert(runtime.nextProxyUrl() === 'http://127.0.0.1:9001', 'pool first');
      assert(runtime.nextProxyUrl() === 'http://127.0.0.1:9002', 'pool second');
      assert(runtime.nextProxyUrl() === 'http://127.0.0.1:9001', 'pool rotates');
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('bridge/config', cases);
}
