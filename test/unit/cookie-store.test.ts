/**
 * CookieStore 单元测试（saveCookies、loadCookies、deleteCookies）
 */
import { saveCookies, loadCookies, deleteCookies } from '../../src/qzone/cookieStore.js';
import fs from 'node:fs';
import path from 'node:path';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const TMP_DIR = path.join('test_cache', '_cookie_test');
const TMP_FILE = path.join(TMP_DIR, 'test_cookies.json');

function cleanup() {
  try { fs.unlinkSync(TMP_FILE); } catch {}
  try { fs.rmdirSync(TMP_DIR); } catch {}
}

const cases: TestCase[] = [
  {
    name: 'save → load 往返一致',
    fn: () => {
      cleanup();
      const cookies = { p_skey: 'abc123', skey: 'def456' };
      saveCookies(TMP_FILE, cookies);
      const loaded = loadCookies(TMP_FILE);
      assert(loaded !== null, '应能加载');
      assert(loaded!.cookies['p_skey'] === 'abc123', 'p_skey 应一致');
      assert(loaded!.cookies['skey'] === 'def456', 'skey 应一致');
      cleanup();
    },
  },
  {
    name: 'load 过期 cookie（14天）返回 null',
    fn: () => {
      cleanup();
      // 写一个 last_used 为 15 天前的 cookie（last_used 是秒级时间戳）
      const oldData = {
        last_used: (Date.now() - 15 * 24 * 3600 * 1000) / 1000,
        cookies: { p_skey: 'expired' },
      };
      fs.mkdirSync(TMP_DIR, { recursive: true });
      fs.writeFileSync(TMP_FILE, JSON.stringify(oldData));
      const loaded = loadCookies(TMP_FILE);
      assert(loaded === null, '过期应返回 null');
      // 过期后文件应被删除
      assert(!fs.existsSync(TMP_FILE), '过期文件应被删除');
      cleanup();
    },
  },
  {
    name: 'load 不存在的文件返回 null',
    fn: () => {
      cleanup();
      const loaded = loadCookies(TMP_FILE);
      assert(loaded === null, '不存在应返回 null');
    },
  },
  {
    name: 'load 损坏 JSON 返回 null',
    fn: () => {
      cleanup();
      fs.mkdirSync(TMP_DIR, { recursive: true });
      fs.writeFileSync(TMP_FILE, '{{broken json');
      const loaded = loadCookies(TMP_FILE);
      assert(loaded === null, '损坏JSON应返回 null');
      cleanup();
    },
  },
  {
    name: 'deleteCookies 删除文件',
    fn: () => {
      cleanup();
      saveCookies(TMP_FILE, { key: 'val' });
      assert(fs.existsSync(TMP_FILE), '文件应存在');
      deleteCookies(TMP_FILE);
      assert(!fs.existsSync(TMP_FILE), '删除后不应存在');
      cleanup();
    },
  },
  {
    name: 'deleteCookies 文件不存在不抛错',
    fn: () => {
      cleanup();
      deleteCookies(TMP_FILE); // 不应抛错
    },
  },
  {
    name: 'saveCookies 自动创建目录',
    fn: () => {
      cleanup();
      const deepPath = path.join(TMP_DIR, 'deep', 'dir', 'cookies.json');
      saveCookies(deepPath, { nested: 'ok' });
      assert(fs.existsSync(deepPath), '嵌套路径应被创建');
      const loaded = loadCookies(deepPath);
      assert(loaded !== null && loaded.cookies['nested'] === 'ok', '应能读回');
      // cleanup deep
      try { fs.unlinkSync(deepPath); } catch {}
      try { fs.rmdirSync(path.join(TMP_DIR, 'deep', 'dir')); } catch {}
      try { fs.rmdirSync(path.join(TMP_DIR, 'deep')); } catch {}
      cleanup();
    },
  },
];

export async function run() {
  return runSuite('cookieStore', cases);
}
