export interface BaselineState {
  v: 1;
  postsDone: boolean;
  friendFeedsDone: boolean;
  interactiveInitialized: boolean;
  pendingComments: string[];
  pendingLikes: string[];
}

export interface BaselineInit {
  /** seen_post_tids.json 已存在（旧版本或已建立基线） */
  postsSeen: boolean;
  /** seen_interactive_state.json 已存在（旧版本已记录评论/点赞） */
  interactiveSeen: boolean;
}

function uniqueTids(tids: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tid of tids) {
    if (!tid || seen.has(tid)) continue;
    seen.add(tid);
    out.push(tid);
  }
  return out;
}

export function createBaselineState(init: BaselineInit): BaselineState {
  return {
    v: 1,
    postsDone: init.postsSeen,
    friendFeedsDone: init.postsSeen,
    interactiveInitialized: init.interactiveSeen,
    pendingComments: [],
    pendingLikes: [],
  };
}

export function normalizeBaselineState(raw: unknown): BaselineState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? uniqueTids(value.filter((v): v is string => typeof v === 'string')) : [];
  return {
    v: 1,
    postsDone: o['postsDone'] === true,
    friendFeedsDone: o['friendFeedsDone'] === true,
    interactiveInitialized: o['interactiveInitialized'] === true,
    pendingComments: stringArray(o['pendingComments']),
    pendingLikes: stringArray(o['pendingLikes']),
  };
}

/** 首轮主轮询成功后快照当前跟踪的 tid；已完成则保持幂等。 */
export function initializeInteractiveBaseline(state: BaselineState, tids: Iterable<string>): boolean {
  if (state.interactiveInitialized) return false;
  const snapshot = uniqueTids(tids);
  state.pendingComments = [...snapshot];
  state.pendingLikes = [...snapshot];
  state.interactiveInitialized = true;
  return true;
}

export function isCommentBaselinePending(state: BaselineState, tid: string): boolean {
  return state.pendingComments.includes(tid);
}

export function isLikeBaselinePending(state: BaselineState, tid: string): boolean {
  return state.pendingLikes.includes(tid);
}

export function completeCommentBaseline(state: BaselineState, tid: string): void {
  state.pendingComments = state.pendingComments.filter(t => t !== tid);
}

export function completeLikeBaseline(state: BaselineState, tid: string): void {
  state.pendingLikes = state.pendingLikes.filter(t => t !== tid);
}

export function pruneBaselinePending(state: BaselineState, keepTids: Set<string>): boolean {
  const before = state.pendingComments.length + state.pendingLikes.length;
  state.pendingComments = state.pendingComments.filter(t => keepTids.has(t));
  state.pendingLikes = state.pendingLikes.filter(t => keepTids.has(t));
  return state.pendingComments.length + state.pendingLikes.length !== before;
}

export function isBaselineComplete(state: BaselineState): boolean {
  return state.postsDone
    && state.friendFeedsDone
    && state.interactiveInitialized
    && state.pendingComments.length === 0
    && state.pendingLikes.length === 0;
}
