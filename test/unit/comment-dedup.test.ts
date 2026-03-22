/**
 * feeds3 短楼层号 → 内容指纹；长数字 / 带 _r_ 的 id → id: 前缀键
 */
import type { QzoneComment } from '../../src/qzone/types.js';
import {
  buildFeedCommentDedupKey,
  commentDedupMark,
  commentDedupSeen,
  feeds3CommentIdIsAmbiguous,
} from '../../src/bridge/commentDedup.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const tid = '21a695940668b96920380600';

function c(partial: Partial<QzoneComment> & Pick<QzoneComment, 'commentId' | 'uin' | 'content' | 'createdTime'>): QzoneComment {
  return {
    nickname: '',
    ...partial,
  };
}

const cases: TestCase[] = [
  {
    name: '短纯数字 commentId 视为歧义，同帖同内容两次哈希一致',
    fn: () => {
      assert(feeds3CommentIdIsAmbiguous('1'), '1 应歧义');
      assert(feeds3CommentIdIsAmbiguous('42'), '42 应歧义');
      assert(!feeds3CommentIdIsAmbiguous('1773838985'), '长数字不歧义');
      const q = c({ commentId: '1', uin: '111', content: '你好', createdTime: 1700000000 });
      const a = buildFeedCommentDedupKey(tid, q);
      const b = buildFeedCommentDedupKey(tid, q);
      assert(a === b, '哈希键应稳定');
      assert(a.startsWith('h:'), '短 id 应用 h: 前缀');
    },
  },
  {
    name: '带 _r_ 的 commentId 走 id: 键',
    fn: () => {
      const q = c({ commentId: '1_r_2_2492835361', uin: '2492835361', content: '回', createdTime: 1700000001 });
      const k = buildFeedCommentDedupKey(tid, q);
      assert(k === `id:${tid}:1_r_2_2492835361`, k);
    },
  },
  {
    name: 'commentDedupSeen / Mark 兼容裸楼层号与哈希',
    fn: () => {
      const seen = new Set<string>();
      const q = c({ commentId: '3', uin: '222', content: '测', createdTime: 1700000002 });
      assert(!commentDedupSeen(seen, tid, q), '首次未见');
      commentDedupMark(seen, tid, q);
      assert(commentDedupSeen(seen, tid, q), '标记后应已见');
      assert(seen.has('3'), '应保留原始 id 供旧数据兼容');
      assert([...seen].some(s => s.startsWith('h:')), '应有指纹键');
    },
  },
  {
    name: 'createtime 为 0 时 feeds3ParseSeq 参与指纹，避免同内容撞键',
    fn: () => {
      const base = {
        commentId: '2',
        uin: '111',
        content: '同文',
        createdTime: 0,
      } as const;
      const k1 = buildFeedCommentDedupKey(tid, c({ ...base, feeds3ParseSeq: 1 }));
      const k2 = buildFeedCommentDedupKey(tid, c({ ...base, feeds3ParseSeq: 2 }));
      assert(k1.startsWith('h:') && k2.startsWith('h:'), '短 id 应用 h:');
      assert(k1 !== k2, '不同解析序号应不同键');
      const kNoSeq = buildFeedCommentDedupKey(tid, c({ ...base }));
      assert(k1 !== kNoSeq, '有 seq 与无 seq 应不同键');
    },
  },
];

export async function run() {
  return runSuite('comment-dedup', cases);
}
