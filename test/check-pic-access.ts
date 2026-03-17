#!/usr/bin/env npx tsx
/** 检查 JSON 中的图片 URL 是否可访问（HEAD 请求，带 Referer） */
import fs from 'node:fs';
import path from 'node:path';

const DEBUG_DIR = path.join(process.env['QZONE_CACHE_PATH'] ?? './test_cache', 'debug');
const rawPath = path.join(DEBUG_DIR, 'debug_raw_msglist.json');
const friendPath = path.join(DEBUG_DIR, 'debug_friend_feeds.json');

function extractPicUrls(data: unknown): string[] {
  const urls: string[] = [];
  const items = (data as Record<string, unknown>)?.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) return urls;
  for (const item of items) {
    const pic = item['pic'];
    if (Array.isArray(pic)) {
      for (const p of pic) {
        const u = (p as Record<string, unknown>)?.url;
        if (typeof u === 'string' && u.startsWith('http')) urls.push(u);
      }
    }
  }
  return [...new Set(urls)];
}

async function headOk(url: string): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://user.qzone.qq.com/',
      },
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false };
  }
}

async function main(): Promise<void> {
  const urls: string[] = [];
  if (fs.existsSync(rawPath)) {
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    urls.push(...extractPicUrls(raw));
  }
  if (fs.existsSync(friendPath)) {
    const friend = JSON.parse(fs.readFileSync(friendPath, 'utf8'));
    urls.push(...extractPicUrls(friend));
  }
  const unique = [...new Set(urls)];
  console.log(`\n检查 ${unique.length} 个图片 URL 可访问性（HEAD + Referer）:\n`);
  for (let i = 0; i < unique.length; i++) {
    const r = await headOk(unique[i]!);
    const short = unique[i]!.length > 72 ? unique[i]!.slice(0, 72) + '...' : unique[i]!;
    console.log(`  ${r.ok ? '✓' : '✗'} [${r.status ?? 'err'}] ${short}`);
  }
  console.log('');
}

main().catch(console.error);
