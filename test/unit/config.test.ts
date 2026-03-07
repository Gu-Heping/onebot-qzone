/**
 * 配置 fromEnv 单元测试（默认值与类型）
 */
import { fromEnv } from '../../src/bridge/config.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: 'fromEnv 返回必要字段',
    fn: () => {
      const cfg = fromEnv();
      assert(typeof cfg.host === 'string', 'host');
      assert(typeof cfg.port === 'number', 'port');
      assert(Array.isArray(cfg.httpPostUrls), 'httpPostUrls');
      assert(Array.isArray(cfg.wsReverseUrls), 'wsReverseUrls');
      assert(typeof cfg.cachePath === 'string', 'cachePath');
      assert(typeof cfg.pollInterval === 'number', 'pollInterval');
      assert(typeof cfg.emitMessageEvents === 'boolean', 'emitMessageEvents');
    },
  },
  {
    name: 'fromEnv 默认 port',
    fn: () => {
      const prev = process.env['ONEBOT_PORT'];
      delete process.env['ONEBOT_PORT'];
      const cfg = fromEnv();
      assert(cfg.port === 8080, '默认 port 应为 8080');
      if (prev !== undefined) process.env['ONEBOT_PORT'] = prev;
    },
  },
  {
    name: 'fromEnv cachePath 默认',
    fn: () => {
      const prev = process.env['QZONE_CACHE_PATH'];
      delete process.env['QZONE_CACHE_PATH'];
      const cfg = fromEnv();
      assert(cfg.cachePath === './test_cache', '默认 cachePath');
      if (prev !== undefined) process.env['QZONE_CACHE_PATH'] = prev;
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('bridge/config', cases);
}
