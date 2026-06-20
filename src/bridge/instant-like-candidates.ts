export interface FeedCandidateMergeState {
  canonical: Map<string, Record<string, unknown>>;
  aliasMap: Map<string, string>;
  aliasOnly: Map<string, Record<string, unknown>>;
}

export function createFeedCandidateMergeState(): FeedCandidateMergeState {
  return {
    canonical: new Map(),
    aliasMap: new Map(),
    aliasOnly: new Map(),
  };
}

export function chooseBetterCandidate(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  scoreOf: (item: Record<string, unknown>) => number,
  richnessOf: (item: Record<string, unknown>) => number,
): Record<string, unknown> {
  const leftScore = scoreOf(left);
  const rightScore = scoreOf(right);
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;
  const leftRichness = richnessOf(left);
  const rightRichness = richnessOf(right);
  if (rightRichness !== leftRichness) return rightRichness > leftRichness ? right : left;
  if (!Boolean(left['isLiked']) && Boolean(right['isLiked'])) return right;
  return left;
}

export function mergeFeedCandidate(
  state: FeedCandidateMergeState,
  item: Record<string, unknown>,
  keys: { primaryKey: string; aliasKey: string },
  scoreOf: (item: Record<string, unknown>) => number,
  richnessOf: (item: Record<string, unknown>) => number,
): void {
  if (!keys.primaryKey.endsWith(':')) {
    const aliasSeed = state.aliasOnly.get(keys.aliasKey);
    const current = state.canonical.get(keys.primaryKey);
    const seed = current
      ? chooseBetterCandidate(current, item, scoreOf, richnessOf)
      : (aliasSeed ? chooseBetterCandidate(aliasSeed, item, scoreOf, richnessOf) : item);
    const chosen = aliasSeed && seed === item
      ? chooseBetterCandidate(item, aliasSeed, scoreOf, richnessOf)
      : seed;
    state.canonical.set(keys.primaryKey, chosen);
    state.aliasMap.set(keys.aliasKey, keys.primaryKey);
    state.aliasOnly.delete(keys.aliasKey);
    return;
  }

  const existingPrimary = state.aliasMap.get(keys.aliasKey);
  if (!existingPrimary) {
    const existingAliasOnly = state.aliasOnly.get(keys.aliasKey);
    state.aliasOnly.set(
      keys.aliasKey,
      existingAliasOnly ? chooseBetterCandidate(existingAliasOnly, item, scoreOf, richnessOf) : item,
    );
    return;
  }

  const current = state.canonical.get(existingPrimary);
  if (current) {
    state.canonical.set(existingPrimary, chooseBetterCandidate(current, item, scoreOf, richnessOf));
  }
}
