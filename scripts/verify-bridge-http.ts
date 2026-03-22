/**
 * 对**已启动**的 onebot-qzone HTTP 服务做真实请求校验（get_login_info / check_cookie / get_stranger_info）。
 * 若 NapCat/OpenClaw 正订阅事件 WS，大量 HTTP 读请求可能间接触发轮询与缓存变化；写操作请用 verify:tools 并阅读其文件头警告。
 *
 * 用法（仓库根目录）：
 *   npx tsx scripts/verify-bridge-http.ts
 *   ONEBOT_PORT=5700 ONEBOT_ACCESS_TOKEN=xxx npx tsx scripts/verify-bridge-http.ts
 *
 * 退出码：0 全部通过；1 有失败。
 */
import 'dotenv/config';

const PORT = Number(process.env['ONEBOT_PORT'] ?? '5700');
const HOST = process.env['ONEBOT_VERIFY_HOST'] ?? '127.0.0.1';
const TOKEN = (process.env['ONEBOT_ACCESS_TOKEN'] ?? '').trim();
const BASE = `http://${HOST}:${PORT}`;

async function postJson(action: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const url = `${BASE.replace(/\/+$/, '')}/${action.replace(/^\/+/, '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${action}: 非 JSON 响应 (${res.status}): ${text.slice(0, 200)}`);
  }
}

function asOkData(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o['status'] !== 'ok' && o['retcode'] !== 0) return null;
  const d = o['data'];
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
}

async function main(): Promise<void> {
  console.log(`[verify-http] ${BASE} (token=${TOKEN ? 'yes' : 'no'})`);

  const cookie = await postJson('check_cookie', { probe: false });
  const cookieData = asOkData(cookie);
  if (!cookieData) {
    console.error('[verify-http] check_cookie 失败:', JSON.stringify(cookie));
    process.exit(1);
  }
  console.log('[verify-http] check_cookie:', {
    valid: cookieData['valid'],
    qq: cookieData['qq'],
  });

  const login = await postJson('get_login_info', {});
  const loginData = asOkData(login);
  if (!loginData) {
    console.error('[verify-http] get_login_info 失败:', JSON.stringify(login));
    process.exit(1);
  }
  const userId = String(loginData['user_id'] ?? '');
  const nickname = String(loginData['nickname'] ?? '');
  console.log('[verify-http] get_login_info:', { user_id: userId, nickname });

  if (nickname === 'QZone用户') {
    console.warn(
      '[verify-http] 警告: 昵称为占位「QZone用户」。请确认已 npm run build 并重启服务，且 Cookie 有效（个人资料卡应能解析）。',
    );
  }

  if (!userId) {
    console.error('[verify-http] get_login_info 缺少 user_id');
    process.exit(1);
  }

  const stranger = await postJson('get_stranger_info', { user_id: userId });
  const strangerData = asOkData(stranger);
  if (!strangerData) {
    console.error('[verify-http] get_stranger_info 失败:', JSON.stringify(stranger));
    process.exit(1);
  }
  const cardNick = String(strangerData['nickname'] ?? '');
  console.log('[verify-http] get_stranger_info:', { nickname: cardNick });

  if (cardNick && nickname !== 'QZone用户' && cardNick !== nickname) {
    console.warn('[verify-http] 警告: get_login_info 与 get_stranger_info 昵称不一致', {
      login: nickname,
      card: cardNick,
    });
  }

  if (cookieData['valid'] === true && nickname === 'QZone用户') {
    process.exit(1);
  }

  console.log('[verify-http] 通过');
}

main().catch((e) => {
  console.error('[verify-http] 异常:', e);
  process.exit(1);
});
