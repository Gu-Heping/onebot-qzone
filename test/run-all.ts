#!/usr/bin/env npx tsx
/**
 * 全量自动测试：先跑 6 套单元测试，再按需跑 API 全量接口测试。
 *
 * 用法:
 *   npx tsx test/run-all.ts                           # 仅单元测试
 *   npx tsx test/run-all.ts --api                     # 单元 + API 全量接口测试（含读写，需先启动 bridge）
 *   npx tsx test/run-all.ts --api --readonly          # 只读 API 测试，跳过写操作
 *   npx tsx test/run-all.ts --api --port 8080         # 指定端口
 *
 * 单元测试不依赖服务；--api 时检测服务可达后执行 api-interfaces.ts。
 * 默认含写操作（发说说/评论/点赞等），会产生真实数据。
 * 加 --readonly 可跳过写操作。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const withApi = args.includes('--api');
const apiArgs = args.filter((a) => a !== '--api');
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 && args[portIdx + 1] ? args[portIdx + 1] : '8080';
const BASE = `http://127.0.0.1:${port}`;

type SuiteResult = { name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> };

async function runUnitSuites(): Promise<SuiteResult[]> {
  const suites: Array<() => Promise<SuiteResult>> = [
    (await import('./unit/utils.test.ts')).run,
    (await import('./unit/bridge-utils.test.ts')).run,
    (await import('./unit/config.test.ts')).run,
    (await import('./unit/friend-extract.test.ts')).run,
    (await import('./unit/poller-helpers.test.ts')).run,
    (await import('./unit/actions-helpers.test.ts')).run,
    (await import('./unit/hub.test.ts')).run,
    (await import('./unit/cookie-store.test.ts')).run,
    (await import('./unit/robustness.test.ts')).run,
    (await import('./unit/feeds3-comments.test.ts')).run,
    (await import('./unit/feeds3-enhanced.test.ts')).run,
  ];
  const results: SuiteResult[] = [];
  for (const run of suites) {
    results.push(await run());
  }
  return results;
}

async function checkServerReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/get_version_info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json();
    return j && j.status === 'ok';
  } catch {
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║    QZone Bridge 全量自动测试 (单元 + 可选 API)       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const unitResults = await runUnitSuites();

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
  console.log(`\n  合计: ${unitPassed} 通过, ${unitFailed} 失败\n`);

  let apiExitCode: number | null = null;
  if (withApi) {
    console.log('━━━ API 测试 (api-interfaces) ━━━\n');
    const reachable = await checkServerReachable();
    if (!reachable) {
      console.log(`  ⊘ 跳过: 无法连接 ${BASE}，请先启动 bridge: npx tsx src/main.ts\n`);
    } else {
      const child = spawnSync('npx', ['tsx', join(ROOT, 'test', 'api-interfaces.ts'), ...apiArgs], {
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
  if (apiExitCode !== null && !apiOk) console.log('  API 测试: 有失败');
  if (unitOk && apiOk) console.log('  全部通过');
  console.log('══════════════════════════════════════════════════════\n');

  const exitCode = unitOk && apiOk ? 0 : 1;
  process.exit(exitCode);
}

main()
  .then(() => {})
  .catch((e) => {
    console.error('run-all 异常:', e);
    process.exit(2);
  });
