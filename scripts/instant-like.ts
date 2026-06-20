#!/usr/bin/env tsx
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  chooseBetterCandidate,
} from '../src/bridge/instant-like-candidates.js';
import {
  applyCachedFeedPoolFallback,
  type CachedFeedPool,
} from '../src/bridge/instant-like-feed-cache.js';
import {
  collectFeedPool,
  type FeedPool,
} from '../src/bridge/instant-like-feed-sources.js';
import {
  candidateHistoryDelta,
  compactInstantLikeState,
  hasSeenCandidateState,
  markCandidateFailedState,
  markCandidateSeenState,
  normalizeInstantLikeState,
  orderStrategyLabels,
  recordStrategyOutcome,
  shouldCooldownCandidateState,
  strategyWeight,
  type InstantLikeState,
} from '../src/bridge/instant-like-state.js';
import { QzoneClient } from '../src/qzone/client.js';
import { env } from '../src/qzone/config/env.js';

interface CliOptions {
  once: boolean;
  fastMode: boolean;
  feedSourceStrategy: 'playwright_first' | 'feeds3_first' | 'playwright_only' | 'feeds3_only';
  includeSelf: boolean;
  maxPosts: number;
  maxLikesPerRound: number;
  intervalMs: number;
  maxAgeSec: number;
  likeDelayMs: number;
  verifyAttempts: number;
  refetchRounds: number;
  feedFetchPasses: number;
  feedFetchPages: number;
  feedCacheMaxAgeSec: number;
  failureCooldownSec: number;
  failureThreshold: number;
  previewCount: number;
  statePath?: string;
  failureDumpPath?: string;
  feedCachePath?: string;
  dryRun: boolean;
}

type SeenState = InstantLikeState;

interface LikeAttempt {
  label: string;
  run(): Promise<Record<string, unknown>>;
}

interface SyntheticLikeParams {
  unikey: string;
  curkey: string;
  source: string;
}

interface LikeFailureRecord {
  at: string;
  qq: string;
  nickname: string;
  uin: string;
  tid: string;
  appid: string;
  typeid: string;
  score: number;
  source: string;
  candidate: Record<string, unknown>;
  attempts: Array<{
    label: string;
    ok: boolean;
    verified: boolean;
    response?: Record<string, unknown>;
    error?: string;
  }>;
}

interface CandidateFilterStats {
  missingIdentity: number;
  selfFiltered: number;
  alreadyLiked: number;
  alreadySeen: number;
  cooldownSkipped: number;
  tooOld: number;
  eligible: number;
}

function readCliValue(names: string[]): string | undefined {
  for (const name of names) {
    const prefix = `--${name}=`;
    const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    if (match) return match.slice(prefix.length);
  }
  return undefined;
}

function parseIntArg(cliNames: string[], envKey: string, fallback: number, allowZero = false): number {
  const raw = readCliValue(cliNames) ?? process.env[envKey];
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  if (allowZero && num === 0) return 0;
  return num > 0 ? Math.floor(num) : fallback;
}

function parseBoolArg(flags: string[], envKey: string, fallback = false): boolean {
  const args = process.argv.slice(2);
  for (const flag of flags) {
    if (args.includes(`--${flag}`)) return true;
    if (args.includes(`--no-${flag}`)) return false;
  }
  const raw = (process.env[envKey] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function parseStringArg(cliNames: string[], envKey: string): string | undefined {
  const value = (readCliValue(cliNames) ?? process.env[envKey])?.trim();
  return value ? value : undefined;
}

function getOptions(): CliOptions {
  const feedSourceStrategyRaw = (parseStringArg(['feed-source', 'feedSource'], 'QZONE_INSTANT_LIKE_SOURCE') ?? 'playwright_first')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  const feedSourceStrategy = (
    ['playwright_first', 'feeds3_first', 'playwright_only', 'feeds3_only'].includes(feedSourceStrategyRaw)
      ? feedSourceStrategyRaw
      : 'playwright_first'
  ) as CliOptions['feedSourceStrategy'];
  return {
    once: process.argv.slice(2).includes('--once'),
    fastMode: parseBoolArg(['fast'], 'QZONE_INSTANT_LIKE_FAST', true),
    feedSourceStrategy,
    includeSelf: parseBoolArg(['include-self'], 'QZONE_INSTANT_LIKE_INCLUDE_SELF', false),
    maxPosts: parseIntArg(['max-posts', 'maxPosts'], 'QZONE_INSTANT_LIKE_MAX_POSTS', 20),
    maxLikesPerRound: parseIntArg(['max-likes-per-round', 'maxLikesPerRound'], 'QZONE_INSTANT_LIKE_MAX_LIKES_PER_ROUND', 3),
    intervalMs: parseIntArg(['interval-ms', 'intervalMs'], 'QZONE_INSTANT_LIKE_INTERVAL_MS', 5000),
    maxAgeSec: parseIntArg(['max-age-sec', 'maxAgeSec'], 'QZONE_INSTANT_LIKE_MAX_AGE_SEC', 300, true),
    likeDelayMs: parseIntArg(['like-delay-ms', 'likeDelayMs'], 'QZONE_INSTANT_LIKE_DELAY_MS', 600),
    verifyAttempts: parseIntArg(['verify-attempts', 'verifyAttempts'], 'QZONE_INSTANT_LIKE_VERIFY_ATTEMPTS', 2),
    refetchRounds: parseIntArg(['refetch-rounds', 'refetchRounds'], 'QZONE_INSTANT_LIKE_REFETCH_ROUNDS', 2),
    feedFetchPasses: parseIntArg(['feed-fetch-passes', 'feedFetchPasses'], 'QZONE_INSTANT_LIKE_FEED_FETCH_PASSES', 2),
    feedFetchPages: parseIntArg(['feed-fetch-pages', 'feedFetchPages'], 'QZONE_INSTANT_LIKE_FEED_FETCH_PAGES', 2),
    feedCacheMaxAgeSec: parseIntArg(['feed-cache-max-age-sec', 'feedCacheMaxAgeSec'], 'QZONE_INSTANT_LIKE_FEED_CACHE_MAX_AGE_SEC', 300, true),
    failureCooldownSec: parseIntArg(['failure-cooldown-sec', 'failureCooldownSec'], 'QZONE_INSTANT_LIKE_FAILURE_COOLDOWN_SEC', 900, true),
    failureThreshold: parseIntArg(['failure-threshold', 'failureThreshold'], 'QZONE_INSTANT_LIKE_FAILURE_THRESHOLD', 2),
    previewCount: parseIntArg(['preview-count', 'previewCount'], 'QZONE_INSTANT_LIKE_PREVIEW_COUNT', 5),
    statePath: parseStringArg(['state-path', 'statePath'], 'QZONE_INSTANT_LIKE_STATE_PATH'),
    failureDumpPath: parseStringArg(['failure-dump-path', 'failureDumpPath'], 'QZONE_INSTANT_LIKE_FAILURE_DUMP_PATH'),
    feedCachePath: parseStringArg(['feed-cache-path', 'feedCachePath'], 'QZONE_INSTANT_LIKE_FEED_CACHE_PATH'),
    dryRun: parseBoolArg(['dry-run'], 'QZONE_INSTANT_LIKE_DRY_RUN', false),
  };
}

function loadState(filePath: string): SeenState {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return normalizeInstantLikeState(JSON.parse(raw) as Partial<SeenState>);
  } catch {
    return normalizeInstantLikeState(undefined);
  }
}

function saveState(filePath: string, state: SeenState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function appendFailureDump(filePath: string, record: LikeFailureRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function loadFeedCache(filePath: string): CachedFeedPool | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CachedFeedPool>;
    if (!Number.isFinite(parsed.cachedAt) || !Array.isArray(parsed.posts)) return null;
    return { cachedAt: parsed.cachedAt as number, posts: parsed.posts as Record<string, unknown>[] };
  } catch {
    return null;
  }
}

function saveFeedCache(filePath: string, posts: Record<string, unknown>[], cachedAt: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: CachedFeedPool = { cachedAt, posts };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyFor(item: Record<string, unknown>): string {
  return `${String(item['uin'] ?? '')}:${String(item['tid'] ?? item['cellid'] ?? '')}`;
}

function aliasKeyFor(item: Record<string, unknown>): string {
  const uin = normalizeText(item['uin'] ?? item['opuin']);
  const created = Number(item['created_time'] ?? item['createTime'] ?? 0);
  const appid = normalizeText(item['appid']);
  const typeid = normalizeText(item['typeid']);
  const playUrl = getSharePlayUrl(item);
  const title = normalizeText(item['appShareTitle'] ?? item['content']).slice(0, 80);
  return `${uin}:${created}:${appid}:${typeid}:${playUrl}:${title}`;
}

function isLikeSuccess(result: Record<string, unknown>): boolean {
  return Number(result['code'] ?? -1) === 0 || Number(result['ret'] ?? -1) === 0;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function getSharePlayUrl(item: Record<string, unknown>): string {
  const musicShare = item['musicShare'] as Record<string, unknown> | undefined;
  return normalizeText(musicShare?.['playUrl']);
}

function getSeenAlias(item: Record<string, unknown>): string {
  return aliasKeyFor(item);
}

function safeUrlFingerprint(value: string): string {
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
    return `${url.hostname}${segments ? `/${segments}` : ''}`;
  } catch {
    return value.slice(0, 80);
  }
}

function isSameFeedItem(candidate: Record<string, unknown>, item: Record<string, unknown>): boolean {
  const tid = normalizeText(item['tid'] ?? item['cellid']);
  const uin = normalizeText(item['uin'] ?? item['opuin']);
  const candidateTid = normalizeText(candidate['tid'] ?? candidate['cellid']);
  const candidateUin = normalizeText(candidate['uin'] ?? candidate['opuin']);
  if (tid && candidateTid && tid === candidateTid && uin && candidateUin && uin === candidateUin) return true;
  const created = Number(item['created_time'] ?? item['createTime'] ?? 0);
  const candidateCreated = Number(candidate['created_time'] ?? candidate['createTime'] ?? 0);
  return Boolean(
    created > 0
      && candidateCreated > 0
      && created === candidateCreated
      && uin
      && candidateUin
      && uin === candidateUin,
  );
}

function parseMoodUrl(value: string): { uin: string; tid: string } | null {
  const match = value.match(/user\.qzone\.qq\.com\/(\d+)\/mood\/([^/?#]+)/i);
  return match ? { uin: match[1]!, tid: match[2]! } : null;
}

function buildNumericCurkey(uin: string, abstime: number): string {
  return `00${uin.padStart(10, '0')}00${String(abstime).padStart(10, '0')}`;
}

function hasValidOverride(item: Record<string, unknown>): boolean {
  const likeUnikey = normalizeText(item['likeUnikey']);
  const likeCurkey = normalizeText(item['likeCurkey']);
  if (!likeUnikey || !likeCurkey) return false;
  const tid = normalizeText(item['tid'] ?? item['cellid']);
  const uin = normalizeText(item['uin'] ?? item['opuin']);
  const moodRef = parseMoodUrl(likeUnikey);
  if (!moodRef) return true;
  return moodRef.tid === tid && moodRef.uin === uin;
}

function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 90) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function computeCandidateScore(item: Record<string, unknown>): number {
  const appid = Number(item['appid'] ?? 0);
  const typeid = Number(item['typeid'] ?? 0);
  const playUrl = getSharePlayUrl(item);
  let score = 50;
  if (appid === 311) score += 35;
  if (appid !== 311 && hasValidOverride(item)) score += 30;
  if (appid === 202 && playUrl) score += 35;
  else if (appid !== 311 && playUrl) score += 20;
  if (appid !== 311 && !hasValidOverride(item) && !playUrl) score -= 25;
  if (normalizeText(item['sourceFkey']) === normalizeText(item['tid'])) score += 5;
  if (normalizeText(item['topicId'])) score += 5;
  if (typeid === 0 || typeid === 2) score += 5;
  return score;
}

function candidateRichness(item: Record<string, unknown>): number {
  let richness = 0;
  if (hasValidOverride(item)) richness += 3;
  if (getSharePlayUrl(item)) richness += 2;
  if (normalizeText(item['content'])) richness += 1;
  if (normalizeText(item['appShareTitle'])) richness += 1;
  if (normalizeText(item['topicId'])) richness += 1;
  if (normalizeText(item['sourceFkey'])) richness += 1;
  return richness;
}

function maybeUseCachedFeedPool(
  liveFeedPool: FeedPool,
  feedCachePath: string,
  maxAgeSec: number,
  nowSec: number,
): FeedPool {
  const cached = loadFeedCache(feedCachePath);
  return applyCachedFeedPoolFallback(liveFeedPool, cached, maxAgeSec, nowSec);
}

function classifyCandidateSource(item: Record<string, unknown>): string {
  if (normalizeText(item['_source']) === 'playwright_feed') return 'playwright_feed';
  const appid = Number(item['appid'] ?? 0);
  const playUrl = getSharePlayUrl(item);
  if (appid === 311) return 'mood-default';
  if (appid === 202 && playUrl) return 'music-share';
  if (hasValidOverride(item)) return 'override-ok';
  if (playUrl) return 'share-playurl';
  return 'synthetic-shared';
}

function getStrategyFingerprint(item: Record<string, unknown>): string {
  const appid = normalizeText(item['appid']) || '0';
  const typeid = normalizeText(item['typeid']) || '0';
  const source = classifyCandidateSource(item);
  const playUrl = getSharePlayUrl(item);
  const appName = normalizeText(item['appName']).slice(0, 32);
  const shareShape = playUrl ? safeUrlFingerprint(playUrl) : '';
  return [appid, typeid, source, appName, shareShape].filter(Boolean).join('|');
}

function getPrimaryLikeStrategy(item: Record<string, unknown>): string {
  const appid = Number(item['appid'] ?? 0);
  const playUrl = getSharePlayUrl(item);
  if (hasValidOverride(item)) return 'likeEmotion(overrides)';
  if (appid === 311) return 'likeEmotion(default)';
  if (appid === 202 && playUrl) return 'likeEmotion(musicShare.playUrl+numericCurkey)';
  if (playUrl) return 'likeEmotion(share.playUrl+numericCurkey)';
  return 'likeEmotion(appFallback)';
}

function listAttemptLabels(item: Record<string, unknown>): string[] {
  const labels: string[] = [];
  if (normalizeText(item['_source']) === 'playwright_feed') {
    labels.push('playwrightContext');
  }
  const appid = Number(item['appid'] ?? 0);
  const playUrl = getSharePlayUrl(item);
  if (appid !== 311) {
    if (hasValidOverride(item)) labels.push('likeEmotion(overrides)');
    if (appid === 202 && playUrl) {
      labels.push('likeEmotion(musicShare.playUrl+numericCurkey)');
      labels.push('likeEmotion(musicShare.playUrl+selfCurkey)');
    }
    if (playUrl) labels.push('likeEmotion(share.playUrl+numericCurkey)');
    labels.push('likeEmotion(appFallback)');
  }
  labels.push('likeEmotion(default)');
  labels.push('likeMobileFeed');
  return [...new Set(labels)];
}

function getPreferredStrategyLabelFromHistory(item: Record<string, unknown>, history: SeenState['strategyHistory']): string {
  const fingerprint = getStrategyFingerprint(item);
  const labels = listAttemptLabels(item);
  const ordered = orderStrategyLabels(labels, history, fingerprint);
  return ordered[0] ?? getPrimaryLikeStrategy(item);
}

function computeRuntimeCandidateScore(state: SeenState, item: Record<string, unknown>, nowSec: number): number {
  return computeCandidateScore(item) + candidateHistoryDelta(
    state,
    getStrategyFingerprint(item),
    getSeenAlias(item),
    listAttemptLabels(item),
    nowSec,
  );
}

async function refetchMatchingPost(
  client: QzoneClient,
  original: Record<string, unknown>,
  rounds: number,
): Promise<Record<string, unknown> | null> {
  for (let index = 0; index < rounds; index += 1) {
    const feed = await client.getFriendFeedsBestEffort('', 20, { fastMode: index === 0 });
    if (!feed.ok) continue;
    const matched = feed.data.posts.find((post) => isSameFeedItem(post, original));
    if (matched) return matched;
  }
  return null;
}

async function resolveLikeTarget(client: QzoneClient, item: Record<string, unknown>, rounds: number): Promise<Record<string, unknown>> {
  if (Number(item['appid'] ?? 0) === 311 || hasValidOverride(item)) return item;
  const refreshed = await refetchMatchingPost(client, item, rounds);
  if (refreshed && chooseBetterCandidate(item, refreshed, computeCandidateScore, candidateRichness) === refreshed) {
    return refreshed;
  }
  return item;
}

async function verifyLikeApplied(client: QzoneClient, item: Record<string, unknown>, attempts: number): Promise<boolean> {
  const selfUin = client.qqNumber ?? '';
  const targetUin = normalizeText(item['uin'] ?? item['opuin']);
  const targetTid = normalizeText(item['tid'] ?? item['cellid']);

  for (let index = 0; index < attempts; index += 1) {
    await sleep(700);
    try {
      if (await client.verifyLikeInPlaywrightContext(item)) return true;
    } catch {
      // ignore browser verification failure and continue fallbacks
    }
    try {
      const snapshot = await client.getPlaywrightFriendFeedSnapshot(20);
      const matched = snapshot.posts.find((post) => isSameFeedItem(post, item));
      if (matched && Boolean(matched['isLiked'])) return true;
    } catch {
      // ignore browser verification failure and continue fallbacks
    }
    const feed = await client.getFriendFeedsBestEffort('', 20, { fastMode: index % 2 === 0 });
    if (feed.ok) {
      const matched = feed.data.posts.find((post) => isSameFeedItem(post, item));
      if (matched && Boolean(matched['isLiked'])) return true;
    }
    try {
      const likes = await client.getLikeListBestEffort(targetUin, targetTid);
      if (likes.some((entry) => normalizeText((entry as Record<string, unknown>)['uin']) === selfUin)) return true;
    } catch {
      // ignore and continue verification retries
    }
  }

  return false;
}

function buildSyntheticLikeParams(item: Record<string, unknown>, abstime: number): SyntheticLikeParams[] {
  const tid = normalizeText(item['tid'] ?? item['cellid']);
  const uin = normalizeText(item['uin'] ?? item['opuin']);
  const appid = Number(item['appid'] ?? 0);
  if (!tid || !uin || appid === 311) return [];

  const out: SyntheticLikeParams[] = [];
  const seen = new Set<string>();
  const pushUnique = (entry: SyntheticLikeParams): void => {
    const key = `${entry.unikey}\u0000${entry.curkey}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  const numericCurkey = buildNumericCurkey(uin, abstime);
  const playUrl = getSharePlayUrl(item);
  if (appid === 202 && playUrl) {
    pushUnique({
      unikey: playUrl,
      curkey: numericCurkey,
      source: 'musicShare.playUrl+numericCurkey',
    });
    pushUnique({
      unikey: playUrl,
      curkey: playUrl,
      source: 'musicShare.playUrl+selfCurkey',
    });
  }
  if (playUrl) {
    pushUnique({
      unikey: playUrl,
      curkey: numericCurkey,
      source: 'share.playUrl+numericCurkey',
    });
  }
  pushUnique({
    unikey: `http://user.qzone.qq.com/${uin}/app/${tid}`,
    curkey: `http://user.qzone.qq.com/${uin}/app/${tid}`,
    source: 'appFallback',
  });
  return out;
}

function buildLikeAttempts(
  client: QzoneClient,
  item: Record<string, unknown>,
  abstime: number,
  history: SeenState['strategyHistory'],
): LikeAttempt[] {
  const tid = normalizeText(item['tid'] ?? item['cellid']);
  const uin = normalizeText(item['uin'] ?? item['opuin']);
  const appid = Number(item['appid'] ?? 0);
  const typeid = Number(item['typeid'] ?? 0);
  const likeUnikey = normalizeText(item['likeUnikey']);
  const likeCurkey = normalizeText(item['likeCurkey']);

  const attempts: LikeAttempt[] = [];
  if (normalizeText(item['_source']) === 'playwright_feed') {
    attempts.push({
      label: 'playwrightContext',
      run: async () => (await client.likeWithPlaywrightContext(item)) ?? { code: -1, message: 'playwright session unavailable' },
    });
  }
  if (hasValidOverride(item)) {
    attempts.push({
      label: 'likeEmotion(overrides)',
      run: () => client.likeEmotion(uin, tid, abstime, appid, typeid, likeUnikey, likeCurkey) as Promise<Record<string, unknown>>,
    });
  }
  for (const params of buildSyntheticLikeParams(item, abstime)) {
    attempts.push({
      label: `likeEmotion(${params.source})`,
      run: () => client.likeEmotion(uin, tid, abstime, appid, typeid, params.unikey, params.curkey) as Promise<Record<string, unknown>>,
    });
  }
  attempts.push({
    label: 'likeEmotion(default)',
    run: () => client.likeEmotion(uin, tid, abstime, appid, typeid, undefined, undefined) as Promise<Record<string, unknown>>,
  });
  attempts.push({
    label: 'likeMobileFeed',
    run: () => client.likeMobileFeed(uin, tid, appid || 311, typeid, 0) as Promise<Record<string, unknown>>,
  });
  const fingerprint = getStrategyFingerprint(item);
  return attempts.sort((left, right) => {
    const delta = strategyWeight(history, fingerprint, right.label) - strategyWeight(history, fingerprint, left.label);
    if (delta !== 0) return delta;
    return 0;
  });
}

function summarizeCandidate(item: Record<string, unknown>): string {
  const score = computeCandidateScore(item);
  const source = classifyCandidateSource(item);
  const first = normalizeText(item['_preferredStrategy']) || getPrimaryLikeStrategy(item);
  return `${String(item['nickname'] ?? item['name'] ?? item['uin'])} tid=${String(item['tid'] ?? item['cellid'] ?? '')} appid=${String(item['appid'] ?? '')} score=${score} confidence=${confidenceLabel(score)} source=${source} first=${first}`;
}

function createCandidateFilterStats(): CandidateFilterStats {
  return {
    missingIdentity: 0,
    selfFiltered: 0,
    alreadyLiked: 0,
    alreadySeen: 0,
    cooldownSkipped: 0,
    tooOld: 0,
    eligible: 0,
  };
}

function hasSeenCandidate(state: SeenState, item: Record<string, unknown>): boolean {
  return hasSeenCandidateState(state, keyFor(item), getSeenAlias(item));
}

function shouldCooldownCandidate(
  state: SeenState,
  item: Record<string, unknown>,
  nowSec: number,
  failureThreshold: number,
  failureCooldownSec: number,
): boolean {
  return shouldCooldownCandidateState(
    state,
    getSeenAlias(item),
    nowSec,
    failureThreshold,
    failureCooldownSec,
    computeCandidateScore(item),
  );
}

function markCandidateSeen(state: SeenState, at: number, ...items: Array<Record<string, unknown> | null | undefined>): void {
  markCandidateSeenState(
    state,
    at,
    items.filter(Boolean).map((item) => ({
      seenKey: keyFor(item!),
      aliasKey: getSeenAlias(item!),
    })),
  );
}

function markCandidateFailed(state: SeenState, at: number, item: Record<string, unknown>): void {
  markCandidateFailedState(state, at, getSeenAlias(item), computeCandidateScore(item));
}

async function runRound(
  client: QzoneClient,
  options: CliOptions,
  state: SeenState,
  statePath: string,
  feedPool: FeedPool,
): Promise<number> {
  if (feedPool.posts.length === 0) {
    const firstFailure = feedPool.traces.find((trace) => !trace.ok);
    if (firstFailure) {
      console.error(`[instant-like] feed failed mode=${firstFailure.mode} kind=${firstFailure.kind ?? 'unknown'} message=${firstFailure.message ?? 'unknown'}`);
    } else {
      console.error('[instant-like] feed pool empty');
    }
    return 0;
  }

  const selfUin = client.qqNumber ?? '';
  const nowSec = Math.floor(Date.now() / 1000);
  compactInstantLikeState(state, nowSec);
  let likedCount = 0;
  let scannedCount = 0;
  let eligibleCount = 0;
  const filterStats = createCandidateFilterStats();

  const candidates = [...feedPool.posts]
    .filter((item) => {
      const tid = String(item['tid'] ?? item['cellid'] ?? '').trim();
      const uin = String(item['uin'] ?? item['opuin'] ?? '').trim();
      if (!tid || !uin) {
        filterStats.missingIdentity += 1;
        return false;
      }
      if (!options.includeSelf && selfUin && uin === selfUin) {
        filterStats.selfFiltered += 1;
        return false;
      }
      if (Boolean(item['isLiked'])) {
        filterStats.alreadyLiked += 1;
        return false;
      }
      if (hasSeenCandidate(state, item)) {
        filterStats.alreadySeen += 1;
        return false;
      }
      if (shouldCooldownCandidate(state, item, nowSec, options.failureThreshold, options.failureCooldownSec)) {
        filterStats.cooldownSkipped += 1;
        return false;
      }
      const created = Number(item['created_time'] ?? item['createTime'] ?? 0);
      if (options.maxAgeSec > 0 && created > 0 && nowSec - created > options.maxAgeSec) {
        filterStats.tooOld += 1;
        return false;
      }
      filterStats.eligible += 1;
      return true;
    })
    .sort((left, right) => computeRuntimeCandidateScore(state, right, nowSec) - computeRuntimeCandidateScore(state, left, nowSec));

  for (const item of candidates) {
    if (likedCount >= options.maxLikesPerRound) break;
    scannedCount += 1;

    const tid = String(item['tid'] ?? item['cellid'] ?? '').trim();
    const uin = String(item['uin'] ?? item['opuin'] ?? '').trim();
    const seenKey = keyFor(item);
    const created = Number(item['created_time'] ?? item['createTime'] ?? 0);
    const nick = String(item['nickname'] ?? item['name'] ?? uin);
    eligibleCount += 1;
    const resolvedItem = await resolveLikeTarget(client, item, options.refetchRounds);
    const resolvedTid = String(resolvedItem['tid'] ?? resolvedItem['cellid'] ?? tid).trim();
    const resolvedUin = String(resolvedItem['uin'] ?? resolvedItem['opuin'] ?? uin).trim();
    const resolvedCreated = Number(resolvedItem['created_time'] ?? resolvedItem['createTime'] ?? created ?? 0);
    const abstime = resolvedCreated > 0 ? resolvedCreated : nowSec;
    const score = computeRuntimeCandidateScore(state, resolvedItem, nowSec);
    const strategyFingerprint = getStrategyFingerprint(resolvedItem);
    console.log(`[instant-like] candidate ${nick} uin=${resolvedUin} tid=${resolvedTid} appid=${String(resolvedItem['appid'] ?? '')} score=${score} confidence=${confidenceLabel(score)} first=${getPreferredStrategyLabelFromHistory(resolvedItem, state.strategyHistory)} fingerprint=${strategyFingerprint}`);

    if (options.dryRun) {
      console.log(`[instant-like] dry-run like ${nick} uin=${resolvedUin} tid=${resolvedTid}`);
      continue;
    }

    try {
      let verified = false;
      const attemptAudit: LikeFailureRecord['attempts'] = [];
      for (const attempt of buildLikeAttempts(client, resolvedItem, abstime, state.strategyHistory)) {
        try {
          const result = await attempt.run();
          if (!isLikeSuccess(result)) {
            attemptAudit.push({ label: attempt.label, ok: false, verified: false, response: result });
            recordStrategyOutcome(state, strategyFingerprint, attempt.label, false);
            console.error(`[instant-like] ${attempt.label} failed uin=${resolvedUin} tid=${resolvedTid} code=${String(result['code'] ?? result['ret'] ?? 'unknown')} msg=${String(result['message'] ?? result['msg'] ?? '')}`);
            continue;
          }
          verified = await verifyLikeApplied(client, resolvedItem, options.verifyAttempts);
          attemptAudit.push({ label: attempt.label, ok: true, verified, response: result });
          if (verified) {
            recordStrategyOutcome(state, strategyFingerprint, attempt.label, true);
            markCandidateSeen(state, nowSec, item, resolvedItem);
            state.liked[seenKey] = nowSec;
            saveState(statePath, state);
            likedCount += 1;
            console.log(`[instant-like] liked ${nick} uin=${resolvedUin} tid=${resolvedTid} via=${attempt.label}`);
            await sleep(options.likeDelayMs);
            break;
          }
          recordStrategyOutcome(state, strategyFingerprint, attempt.label, false);
          console.error(`[instant-like] ${attempt.label} returned success but verification failed uin=${resolvedUin} tid=${resolvedTid}`);
        } catch (error) {
          attemptAudit.push({
            label: attempt.label,
            ok: false,
            verified: false,
            error: error instanceof Error ? error.message : String(error),
          });
          recordStrategyOutcome(state, strategyFingerprint, attempt.label, false);
          console.error(`[instant-like] ${attempt.label} exception uin=${resolvedUin} tid=${resolvedTid}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!verified) {
        markCandidateFailed(state, nowSec, resolvedItem);
        if (options.failureDumpPath) {
          appendFailureDump(options.failureDumpPath, {
            at: new Date().toISOString(),
            qq: client.qqNumber ?? '',
            nickname: nick,
            uin: resolvedUin,
            tid: resolvedTid,
            appid: String(resolvedItem['appid'] ?? ''),
            typeid: String(resolvedItem['typeid'] ?? ''),
            score,
            source: summarizeCandidate(resolvedItem),
            candidate: resolvedItem,
            attempts: attemptAudit,
          });
        }
        console.error(`[instant-like] give up after verification failed uin=${resolvedUin} tid=${resolvedTid} appid=${String(resolvedItem['appid'] ?? '')} typeid=${String(resolvedItem['typeid'] ?? '')}`);
      }
    } catch (error) {
      console.error(`[instant-like] like exception uin=${resolvedUin} tid=${resolvedTid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  compactInstantLikeState(state, nowSec);
  saveState(statePath, state);
  console.log(
    `[instant-like] filtered missingIdentity=${filterStats.missingIdentity} self=${filterStats.selfFiltered} alreadyLiked=${filterStats.alreadyLiked} alreadySeen=${filterStats.alreadySeen} cooldown=${filterStats.cooldownSkipped} tooOld=${filterStats.tooOld} eligible=${filterStats.eligible}`,
  );
  console.log(`[instant-like] scanned=${scannedCount} eligible=${eligibleCount}`);
  return likedCount;
}

async function main(): Promise<void> {
  const options = getOptions();
  const client = new QzoneClient();
  try {
    const cookie = env.cookieString;
    if (!cookie) {
      throw new Error('missing QZONE_COOKIE or QZONE_COOKIE_STRING');
    }

    await client.loginWithCookieString(cookie);
    if (!client.qqNumber) {
      throw new Error('failed to resolve QQ number from cookie');
    }

    const statePath = options.statePath ?? path.join(client.config.cachePath, 'instant-like-state.json');
    const failureDumpPath = options.failureDumpPath ?? path.join(client.config.cachePath, 'instant-like-failures.jsonl');
    const feedCachePath = options.feedCachePath ?? path.join(client.config.cachePath, 'instant-like-feed-cache.json');
    const state = loadState(statePath);
    compactInstantLikeState(state);
    console.log(`[instant-like] login ok qq=${client.qqNumber} fast=${options.fastMode} once=${options.once} dryRun=${options.dryRun}`);
    console.log(`[instant-like] state=${statePath} proxy=${client.config.proxyUrl ?? '(none)'} pool=${client.config.proxyPool?.length ?? 0} source=${options.feedSourceStrategy} verifyAttempts=${options.verifyAttempts} refetchRounds=${options.refetchRounds} feedFetchPasses=${options.feedFetchPasses} feedFetchPages=${options.feedFetchPages} feedCacheMaxAgeSec=${options.feedCacheMaxAgeSec} failureThreshold=${options.failureThreshold} failureCooldownSec=${options.failureCooldownSec} failureDump=${failureDumpPath}`);

    do {
      const previewNowSec = Math.floor(Date.now() / 1000);
      const liveFeedPool = await collectFeedPool(
        client,
        {
          preferFast: options.fastMode,
          feedFetchPasses: options.feedFetchPasses,
          feedFetchPages: options.feedFetchPages,
          targetCount: Math.max(options.maxPosts, options.previewCount, options.maxLikesPerRound * 3, 20),
          nowSec: previewNowSec,
          strategy: options.feedSourceStrategy,
        },
        (item) => computeRuntimeCandidateScore(state, item, previewNowSec),
      );
      if (liveFeedPool.posts.length > 0) {
        saveFeedCache(feedCachePath, liveFeedPool.posts, previewNowSec);
      }
      const feedPool = maybeUseCachedFeedPool(liveFeedPool, feedCachePath, options.feedCacheMaxAgeSec, previewNowSec);
      if (feedPool.traces.length > 0) {
        const traceSummary = feedPool.traces
          .map((trace) => {
            const base = `${trace.source ?? 'unknown'}:${trace.mode}:p${trace.page}:${trace.ok ? trace.count : `fail:${trace.kind ?? 'unknown'}`}`;
            const meta = trace.source === 'playwright_feed'
              ? `:network=${trace.networkIntercepted ? '1' : '0'}:dom=${trace.domFallbackUsed ? '1' : '0'}`
              : '';
            return `${base}${meta}${trace.message ? `:${trace.message}` : ''}`;
          })
          .join(' ');
        console.log(`[instant-like] feed traces ${traceSummary}`);
      }
      const preview = [...feedPool.posts]
        .filter((item) => {
          const tid = String(item['tid'] ?? item['cellid'] ?? '').trim();
          const uin = String(item['uin'] ?? item['opuin'] ?? '').trim();
          return Boolean(tid && uin);
        })
        .sort((left, right) => computeRuntimeCandidateScore(state, right, previewNowSec) - computeRuntimeCandidateScore(state, left, previewNowSec))
        .slice(0, options.previewCount)
        .map((item) => summarizeCandidate({ ...item, _preferredStrategy: getPreferredStrategyLabelFromHistory(item, state.strategyHistory) }));
      if (preview.length > 0) {
        console.log('[instant-like] top candidates:');
        for (const line of preview) console.log(`  - ${line}`);
      } else if (feedPool.posts.length === 0) {
        console.log('[instant-like] no candidates from current feed pool');
      }
      const likedCount = await runRound(client, { ...options, failureDumpPath }, state, statePath, feedPool);
      console.log(`[instant-like] round done liked=${likedCount}`);
      if (options.once) break;
      await sleep(options.intervalMs);
    } while (true);
  } finally {
    await client.closeTransientSessions().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[instant-like] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
