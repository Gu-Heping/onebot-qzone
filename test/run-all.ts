#!/usr/bin/env npx tsx
/**
 * 全量自动测试：自动发现 test/unit/*.test.ts，再按需跑 API 接口测试。
 *
 * 用法:
 *   npx tsx test/run-all.ts                           # 仅单元测试
 *   npx tsx test/run-all.ts --suite feeds3            # 只跑文件名匹配的单元套件
 *   npx tsx test/run-all.ts --api                     # 单元 + API 接口测试（含读写，需先启动 bridge）
 *   npx tsx test/run-all.ts --api --readonly          # 只读 API 测试，跳过写操作
 *   npx tsx test/run-all.ts --api --port 5700         # 指定端口（默认读 ONEBOT_PORT，否则 8080）
 *
 * 单元测试不依赖服务；--api 时检测服务可达后执行 api-interfaces.ts。
 * 默认含写操作（发说说/评论/点赞等），会产生真实数据。
 * 加 --readonly 可跳过写操作。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const UNIT_DIR = join(__dirname, 'unit');

const args = process.argv.slice(2);
const withApi = args.includes('--api');
const suiteIdx = args.indexOf('--suite');
const suiteFilter = suiteIdx >= 0 ? (args[suiteIdx + 1] ?? '').trim() : '';
if (suiteIdx >= 0 && !suiteFilter) {
  console.error('用法: --suite <名称子串>');
  process.exit(2);
}
const apiArgs = args.filter((a, i) => {
  if (a === '--api') return false;
  if (i === suiteIdx || i === suiteIdx + 1) return false;
  return true;
});

type SuiteResult = { name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> };
type SuiteModule = { run: () => Promise<SuiteResult> };

function discoverSuites(): string[] {
  const files = readdirSync(UNIT_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();
  if (!suiteFilter) return files;
  return files.filter((f) => f.toLowerCase().includes(suiteFilter.toLowerCase()));
}

async function runUnitSuites(files: string[]): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(UNIT_DIR, file)).href)) as SuiteModule;
    results.push(await mod.run());
  }
  return results;
}

function resolvePort(): string {
  const portIdx = args.indexOf('--port');
  if (portIdx >= 0 && args[portIdx + 1]) return args[portIdx + 1]!;
  return process.env['ONEBOT_PORT'] || '8080';
}

async function checkServerReachable(base: string): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env['ONEBOT_ACCESS_TOKEN'];
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const r = await fetch(`${base}/get_version_info`, { method: 'POST', headers, body: '{}' });
    const j = (await r.json()) as { status?: string };
    return Boolean(j?.status === 'ok');
  } catch {
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║    QZone Bridge 全量自动测试 (单元 + 可选 API)       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const files = discoverSuites();
  if (files.length === 0) {
    console.error(`未找到匹配的单元测试套件${suiteFilter ? `: ${suiteFilter}` : ''}`);
    process.exit(1);
  }

  const unitResults = await runUnitSuites(files);

  let unitPassed = 0;
  let unitFailed = 0;
  console.log('━━━ 单元测试 ━━━\n');
  for (const s of unitResults) {
    unitPassed += s.passed;
    unitFailed += s.failed;
    const icon = s.failed === 0 ? '✔' : '✘';
    console.log(`  ${icon} ${s.name}: ${s.passed} 通过, ${s.failed} 失败`);
    for (const e of s.errors) {
      console.log(`      ✗ ${e.test}: ${e.error}`);
    }
  }
  const unitCases = unitPassed + unitFailed;
  console.log(`\n  合计: ${unitResults.length} 套件, ${unitCases} 用例 — ${unitPassed} 通过, ${unitFailed} 失败\n`);

  let apiExitCode: number | null = null;
  let apiUnreachable = false;
  if (withApi) {
    await import('dotenv/config');
    const port = resolvePort();
    const base = `http://127.0.0.1:${port}`;
    console.log('━━━ API 测试 (api-interfaces) ━━━\n');
    const reachable = await checkServerReachable(base);
    if (!reachable) {
      apiUnreachable = true;
      console.log(`  ✘ 无法连接 ${base}，请先启动 bridge: npx tsx src/main.ts\n`);
    } else {
      const childArgs = ['tsx', join(ROOT, 'test', 'api-interfaces.ts'), ...apiArgs];
      if (!apiArgs.includes('--port')) childArgs.push('--port', port);
      const child = spawnSync('npx', childArgs, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env },
      });
      apiExitCode = child.status;
    }
  } else {
    console.log('  提示: 加 --api 可同时跑 API 全量接口测试（需先启动 bridge）；加 --readonly 跳过写操作\n');
  }

  console.log('══════════════════════════════════════════════════════');
  const unitOk = unitFailed === 0;
  const apiOk = apiExitCode === null || apiExitCode === 0;
  if (!unitOk) console.log('  单元测试: 有失败');
  if (apiUnreachable) console.log('  API 测试: bridge 不可达');
  if (apiExitCode !== null && !apiOk) console.log('  API 测试: 有失败');
  if (unitOk && apiOk && !apiUnreachable) console.log('  全部通过');
  console.log('══════════════════════════════════════════════════════\n');

  const exitCode = unitOk && apiOk && !apiUnreachable ? 0 : 1;
  process.exit(exitCode);
}

main()
  .then(() => {})
  .catch((e) => {
    console.error('run-all 异常:', e);
    process.exit(2);
  });
