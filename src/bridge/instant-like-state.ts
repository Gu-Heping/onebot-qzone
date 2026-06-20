export interface StrategyStats {
  success: number;
  failure: number;
  lastSuccessAt?: number;
}

export interface FailedAliasStats {
  count: number;
  lastFailedAt: number;
  bestScore: number;
}

export interface InstantLikeState {
  liked: Record<string, number>;
  likedAliases: Record<string, number>;
  failedAliases: Record<string, FailedAliasStats>;
  strategyHistory: Record<string, Record<string, StrategyStats>>;
}

export function normalizeInstantLikeState(value: Partial<InstantLikeState> | null | undefined): InstantLikeState {
  return {
    liked: value?.liked && typeof value.liked === 'object' ? value.liked : {},
    likedAliases: value?.likedAliases && typeof value.likedAliases === 'object' ? value.likedAliases : {},
    failedAliases: value?.failedAliases && typeof value.failedAliases === 'object' ? value.failedAliases : {},
    strategyHistory: value?.strategyHistory && typeof value.strategyHistory === 'object' ? value.strategyHistory : {},
  };
}

export function compactInstantLikeState(state: InstantLikeState, nowSec = Math.floor(Date.now() / 1000)): void {
  const keepSeenAfter = nowSec - 30 * 86400;
  for (const [key, value] of Object.entries(state.liked)) {
    if (!Number.isFinite(value) || value < keepSeenAfter) delete state.liked[key];
  }
  for (const [key, value] of Object.entries(state.likedAliases)) {
    if (!Number.isFinite(value) || value < keepSeenAfter) delete state.likedAliases[key];
  }
  for (const [key, value] of Object.entries(state.failedAliases)) {
    if (!Number.isFinite(value.lastFailedAt) || value.lastFailedAt < keepSeenAfter) delete state.failedAliases[key];
  }
  for (const [fingerprint, labels] of Object.entries(state.strategyHistory)) {
    for (const [label, stats] of Object.entries(labels)) {
      const stale =
        stats.success <= 0
        && stats.failure <= 0
        && !stats.lastSuccessAt;
      const oldFailureOnly =
        stats.success <= 0
        && stats.failure > 0
        && (!stats.lastSuccessAt || stats.lastSuccessAt < keepSeenAfter);
      if (stale || oldFailureOnly) delete labels[label];
    }
    if (Object.keys(labels).length === 0) delete state.strategyHistory[fingerprint];
  }
}

export function hasSeenCandidateState(state: InstantLikeState, seenKey: string, aliasKey: string): boolean {
  return Boolean(state.liked[seenKey] || state.likedAliases[aliasKey]);
}

export function markCandidateSeenState(
  state: InstantLikeState,
  at: number,
  identities: Array<{ seenKey: string; aliasKey: string }>,
): void {
  for (const identity of identities) {
    state.liked[identity.seenKey] = at;
    state.likedAliases[identity.aliasKey] = at;
    delete state.failedAliases[identity.aliasKey];
  }
}

export function shouldCooldownCandidateState(
  state: InstantLikeState,
  aliasKey: string,
  nowSec: number,
  failureThreshold: number,
  failureCooldownSec: number,
  currentScore: number,
): boolean {
  if (failureCooldownSec <= 0 || failureThreshold <= 0) return false;
  const failed = state.failedAliases[aliasKey];
  if (!failed) return false;
  if (failed.count < failureThreshold) return false;
  if (nowSec - failed.lastFailedAt > failureCooldownSec) return false;
  return currentScore <= failed.bestScore;
}

export function markCandidateFailedState(
  state: InstantLikeState,
  at: number,
  aliasKey: string,
  score: number,
): void {
  const current = state.failedAliases[aliasKey];
  state.failedAliases[aliasKey] = {
    count: (current?.count ?? 0) + 1,
    lastFailedAt: at,
    bestScore: Math.max(score, current?.bestScore ?? 0),
  };
}

export function strategyWeight(
  history: InstantLikeState['strategyHistory'],
  fingerprint: string,
  label: string,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const stats = history[fingerprint]?.[label];
  if (!stats) return 0;
  const recencyBoost = stats.lastSuccessAt
    ? Math.min(5, Math.max(0, Math.floor((nowSec - stats.lastSuccessAt) / -86400) + 5))
    : 0;
  return stats.success * 10 - stats.failure * 3 + recencyBoost;
}

export function recordStrategyOutcome(
  state: InstantLikeState,
  fingerprint: string,
  label: string,
  verified: boolean,
  at = Math.floor(Date.now() / 1000),
): void {
  state.strategyHistory[fingerprint] ??= {};
  const bucket = state.strategyHistory[fingerprint]!;
  bucket[label] ??= { success: 0, failure: 0 };
  if (verified) {
    bucket[label]!.success += 1;
    bucket[label]!.lastSuccessAt = at;
  } else {
    bucket[label]!.failure += 1;
  }
}

export function orderStrategyLabels(
  labels: string[],
  history: InstantLikeState['strategyHistory'],
  fingerprint: string,
  nowSec = Math.floor(Date.now() / 1000),
): string[] {
  return [...labels].sort(
    (left, right) => strategyWeight(history, fingerprint, right, nowSec) - strategyWeight(history, fingerprint, left, nowSec),
  );
}

export function candidateHistoryDelta(
  state: InstantLikeState,
  fingerprint: string,
  aliasKey: string,
  labels: string[],
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const bestStrategyWeight = labels.reduce(
    (best, label) => Math.max(best, strategyWeight(state.strategyHistory, fingerprint, label, nowSec)),
    0,
  );
  const failed = state.failedAliases[aliasKey];
  if (!failed) return bestStrategyWeight;
  const ageSec = Math.max(0, nowSec - failed.lastFailedAt);
  const recentPenalty = ageSec < 3600 ? Math.max(0, 12 - Math.floor(ageSec / 300)) : 0;
  return bestStrategyWeight - recentPenalty - failed.count * 2;
}
