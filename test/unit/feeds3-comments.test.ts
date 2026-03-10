/**
 * feeds3 评论解析单元测试
 * 验证一级评论和二级回复的正确解析
 */

import { parseFeeds3Comments } from '../../src/qzone/feeds3Parser.js';
import { assert, runSuite, type TestCase } from '../test-helpers.js';

const cases: TestCase[] = [
  {
    name: '应正确解析一级评论和嵌套的二级回复',
    fn: () => {
      // 用户提供的实际抓包数据（简化版，保留关键结构）
      const html = `
<div class="comments-list">
  <ul>
    <li class="comments-item bor3" data-type="commentroot" data-tid="11" data-uin="1827451317" data-nick="林汐" data-who="1">
      <div class="comments-item-bd">
        <div class="comments-content">
          <a class="nickname c_tx q_namecard" link="nameCard_1827451317">林汐</a>&nbsp;:&nbsp;所以不应该啊，之前都是正常的。
        </div>
        <div class="comments-op">
          <span class="state c_tx3">昨天 18:36</span>
          <a class="reply" data-param="t1_source=1&t1_tid=d2849419010_1741580710_0_1_1741580710_07d&t1_uin=2849419010&sceneid=xxx">回复</a>
        </div>
      </div>
      <div class="comments-list mod-comments-sub">
        <ul>
          <li class="comments-item bor3" data-type="replyroot" data-tid="1" data-uin="2124279245" data-nick="Rive2" data-who="1">
            <div class="comments-content">
              <a class="nickname c_tx q_namecard" link="nameCard_2124279245">Rive2</a>&nbsp;回复<a class="nickname c_tx q_namecard" link="nameCard_1827451317">林汐</a>&nbsp; : 所以更不应该了。
            </div>
            <div class="comments-op">
              <span class="state c_tx3">昨天 19:02</span>
              <a class="reply" data-param="t1_source=1&t1_tid=d2849419010_1741580710_0_1_1741580710_07d&t1_uin=2849419010&t2_uin=1827451317&t2_tid=11&sceneid=xxx">回复</a>
            </div>
          </li>
        </ul>
      </div>
    </li>
    <li class="comments-item bor3" data-type="commentroot" data-tid="10" data-uin="2849419010" data-nick="go on." data-who="1">
      <div class="comments-item-bd">
        <div class="comments-content">
          <a class="nickname c_tx q_namecard" link="nameCard_2849419010">go on.</a>&nbsp;:&nbsp;测试评论内容
        </div>
        <div class="comments-op">
          <span class="state c_tx3">14:20</span>
          <a class="reply" data-param="t1_source=1&t1_tid=d2849419010_1741580710_0_1_1741580710_07d&t1_uin=2849419010&sceneid=xxx">回复</a>
        </div>
      </div>
    </li>
  </ul>
</div>
`;

      const result = parseFeeds3Comments(html);

      // 应该解析出帖子 TID
      assert(result.size > 0, '应该解析出帖子 TID');

      // 获取帖子下的评论列表
      const postTid = result.keys().next().value;
      assert(postTid !== undefined, 'postTid 应该存在');
      const comments = result.get(postTid)!;

      // 应该有 3 条评论：2 条一级 + 1 条二级
      assert(comments.length === 3, `应该有 3 条评论，实际: ${comments.length}`);

      // 验证一级评论
      const rootComments = comments.filter(c => c['is_reply'] === false);
      assert(rootComments.length === 2, `应该有 2 条一级评论，实际: ${rootComments.length}`);

      // 验证二级回复
      const replies = comments.filter(c => c['is_reply'] === true);
      assert(replies.length === 1, `应该有 1 条二级回复，实际: ${replies.length}`);

      // 验证二级回复的详细属性
      const reply = replies[0]!;
      assert(String(reply['commentid']).includes('11'), `commentid 应包含父评论 ID 11，实际: ${reply['commentid']}`);
      assert(reply['uin'] === '2124279245', `uin 应为 2124279245，实际: ${reply['uin']}`);
      assert(reply['name'] === 'Rive2', `name 应为 Rive2，实际: ${reply['name']}`);
      assert(reply['content'] === '所以更不应该了。', `content 应为 "所以更不应该了。" 实际: ${reply['content']}`);
      assert(reply['parent_comment_id'] === '11', `parent_comment_id 应为 11，实际: ${reply['parent_comment_id']}`);
      assert(reply['reply_to_uin'] === '1827451317', `reply_to_uin 应为 1827451317，实际: ${reply['reply_to_uin']}`);
      assert(reply['reply_to_nickname'] === '林汐', `reply_to_nickname 应为 "林汐"，实际: ${reply['reply_to_nickname']}`);
      assert(reply['reply_to_comment_id'] === '11', `reply_to_comment_id 应为 11，实际: ${reply['reply_to_comment_id']}`);

      // 验证一级评论属性
      const rootComment1 = rootComments.find(c => c['commentid'] === '11');
      assert(rootComment1 !== undefined, '应该找到 tid=11 的一级评论');
      assert(rootComment1!['uin'] === '1827451317', `一级评论 uin 应为 1827451317，实际: ${rootComment1!['uin']}`);
      assert(rootComment1!['name'] === '林汐', `一级评论 name 应为 "林汐"，实际: ${rootComment1!['name']}`);
      assert(rootComment1!['content'] === '所以不应该啊，之前都是正常的。', `一级评论 content 不正确，实际: ${rootComment1!['content']}`);
      assert(rootComment1!['is_reply'] === false, '一级评论 is_reply 应为 false');

      const rootComment2 = rootComments.find(c => c['commentid'] === '10');
      assert(rootComment2 !== undefined, '应该找到 tid=10 的一级评论');
      assert(rootComment2!['uin'] === '2849419010', `一级评论 uin 应为 2849419010，实际: ${rootComment2!['uin']}`);
      assert(rootComment2!['name'] === 'go on.', `一级评论 name 应为 "go on."，实际: ${rootComment2!['name']}`);
      assert(rootComment2!['content'] === '测试评论内容', `一级评论 content 不正确，实际: ${rootComment2!['content']}`);
    },
  },
  {
    name: '应正确解析多个二级回复',
    fn: () => {
      const html = `
<div class="comments-list">
  <ul>
    <li class="comments-item bor3" data-type="commentroot" data-tid="1" data-uin="111111" data-nick="用户A">
      <div class="comments-item-bd">
        <div class="comments-content">
          <a class="nickname">用户A</a>&nbsp;:&nbsp;一级评论
        </div>
      </div>
      <div class="comments-list mod-comments-sub">
        <ul>
          <li class="comments-item bor3" data-type="replyroot" data-tid="1" data-uin="222222" data-nick="用户B">
            <div class="comments-content">
              <a class="nickname">用户B</a>&nbsp;回复<a class="nickname">用户A</a>&nbsp;:&nbsp;回复1
            </div>
            <div class="comments-op">
              <a class="reply" data-param="t1_tid=abc123&t2_uin=111111&t2_tid=1">回复</a>
            </div>
          </li>
          <li class="comments-item bor3" data-type="replyroot" data-tid="2" data-uin="333333" data-nick="用户C">
            <div class="comments-content">
              <a class="nickname">用户C</a>&nbsp;回复<a class="nickname">用户B</a>&nbsp;:&nbsp;回复2
            </div>
            <div class="comments-op">
              <a class="reply" data-param="t1_tid=abc123&t2_uin=222222&t2_tid=1">回复</a>
            </div>
          </li>
        </ul>
      </div>
    </li>
  </ul>
</div>
`;

      const result = parseFeeds3Comments(html);
      const comments = result.values().next().value!;

      // 1 条一级 + 2 条二级
      assert(comments.length === 3, `应该有 3 条评论，实际: ${comments.length}`);

      const replies = comments.filter(c => c['is_reply'] === true);
      assert(replies.length === 2, `应该有 2 条二级回复，实际: ${replies.length}`);

      // 验证两条二级回复
      const reply1 = replies.find(c => c['uin'] === '222222');
      assert(reply1 !== undefined, '应该找到 uin=222222 的回复');
      assert(reply1!['content'] === '回复1', `回复1 content 不正确，实际: ${reply1!['content']}`);
      assert(reply1!['reply_to_nickname'] === '用户A', `回复1 reply_to_nickname 应为 "用户A"，实际: ${reply1!['reply_to_nickname']}`);

      const reply2 = replies.find(c => c['uin'] === '333333');
      assert(reply2 !== undefined, '应该找到 uin=333333 的回复');
      assert(reply2!['content'] === '回复2', `回复2 content 不正确，实际: ${reply2!['content']}`);
      assert(reply2!['reply_to_nickname'] === '用户B', `回复2 reply_to_nickname 应为 "用户B"，实际: ${reply2!['reply_to_nickname']}`);
    },
  },
  {
    name: '应正确处理没有二级回复的一级评论',
    fn: () => {
      const html = `
<div class="comments-list">
  <ul>
    <li class="comments-item bor3" data-type="commentroot" data-tid="1" data-uin="111111" data-nick="用户A">
      <div class="comments-item-bd">
        <div class="comments-content">
          <a class="nickname">用户A</a>&nbsp;:&nbsp;只有一级评论
        </div>
        <div class="comments-op">
          <a class="reply" data-param="t1_tid=testpost123&t1_uin=111111">回复</a>
        </div>
      </div>
    </li>
  </ul>
</div>
`;

      const result = parseFeeds3Comments(html);
      assert(result.size > 0, '应该解析出帖子');
      const comments = result.values().next().value!;

      assert(comments.length === 1, `应该有 1 条评论，实际: ${comments.length}`);
      assert(comments[0]!['is_reply'] === false, 'is_reply 应为 false');
      assert(comments[0]!['content'] === '只有一级评论', `content 不正确，实际: ${comments[0]!['content']}`);
    },
  },
  {
    name: '应正确解析回复目标昵称（带 HTML 标签）',
    fn: () => {
      const html = `
<div class="comments-list">
  <ul>
    <li class="comments-item bor3" data-type="commentroot" data-tid="1" data-uin="111111" data-nick="测试用户">
      <div class="comments-item-bd">
        <div class="comments-content">
          <a class="nickname">测试用户</a>&nbsp;:&nbsp;内容
        </div>
        <div class="comments-op">
          <a class="reply" data-param="t1_tid=testpost456&t1_uin=111111">回复</a>
        </div>
      </div>
      <div class="comments-list mod-comments-sub">
        <ul>
          <li class="comments-item bor3" data-type="replyroot" data-tid="1" data-uin="222222" data-nick="回复者">
            <div class="comments-content">
              <a class="nickname c_tx q_namecard" link="nameCard_222222">回复者</a>&nbsp;回复<a class="nickname c_tx q_namecard" link="nameCard_111111">测试用户</a>&nbsp; : 回复内容测试
            </div>
            <div class="comments-op">
              <a class="reply" data-param="t1_tid=testpost456&t2_uin=111111&t2_tid=1">回复</a>
            </div>
          </li>
        </ul>
      </div>
    </li>
  </ul>
</div>
`;

      const result = parseFeeds3Comments(html);
      assert(result.size > 0, '应该解析出帖子');
      const comments = result.values().next().value!;
      const reply = comments.find(c => c['is_reply'] === true);

      assert(reply !== undefined, '应该找到二级回复');
      assert(reply!['reply_to_nickname'] === '测试用户', `reply_to_nickname 应为 "测试用户"，实际: ${reply!['reply_to_nickname']}`);
      assert(reply!['content'] === '回复内容测试', `content 应为 "回复内容测试"，实际: ${reply!['content']}`);
    },
  },
  {
    name: '应正确解析用户提供的实际数据中的二级评论',
    fn: () => {
      // 用户提供的实际抓包数据片段
      const html = `
<li class="comments-item bor3" data-type="commentroot" data-tid="11" data-uin="1827451317" data-nick="林汐" data-who="1">
  <div class="comments-item-bd">
    <div class="comments-content">
      <a class="nickname c_tx q_namecard" link="nameCard_1827451317" href="http://user.qzone.qq.com/1827451317">林汐</a>&nbsp;:&nbsp;所以不应该啊，之前都是正常的。
    </div>
    <div class="comments-op">
      <span class="state c_tx3">昨天 18:36</span>
      <a class="reply" data-param="t1_source=1&t1_tid=d2849419010_1741580710_0_1_1741580710_07d&t1_uin=2849419010&sceneid=10001103">回复</a>
    </div>
  </div>
  <div class="comments-list mod-comments-sub">
    <ul>
      <li class="comments-item bor3" data-type="replyroot" data-tid="1" data-uin="2124279245" data-nick="Rive2" data-who="1">
        <div class="comments-content">
          <a class="nickname c_tx q_namecard" link="nameCard_2124279245" href="http://user.qzone.qq.com/2124279245">Rive2</a>&nbsp;回复<a class="nickname c_tx q_namecard" link="nameCard_1827451317" href="http://user.qzone.qq.com/1827451317">林汐</a>&nbsp; : 所以更不应该了。
        </div>
        <div class="comments-op">
          <span class="state c_tx3">昨天 19:02</span>
          <a class="reply" data-param="t1_source=1&t1_tid=d2849419010_1741580710_0_1_1741580710_07d&t1_uin=2849419010&t2_uin=1827451317&t2_tid=11&sceneid=10001103">回复</a>
        </div>
      </li>
    </ul>
  </div>
</li>
`;

      const result = parseFeeds3Comments(html);
      assert(result.size > 0, '应该解析出帖子');

      const comments = result.values().next().value!;
      
      // 验证一级评论
      const rootComment = comments.find(c => c['commentid'] === '11' && c['is_reply'] === false);
      assert(rootComment !== undefined, '应该找到一级评论');
      assert(rootComment!['name'] === '林汐', `一级评论昵称应为 "林汐"，实际: ${rootComment!['name']}`);
      assert(rootComment!['content'] === '所以不应该啊，之前都是正常的。', `一级评论内容不正确`);

      // 验证二级评论 - "所以更不应该了。" 就是二级评论
      const reply = comments.find(c => c['is_reply'] === true);
      assert(reply !== undefined, '应该找到二级评论');
      assert(reply!['name'] === 'Rive2', `二级评论昵称应为 "Rive2"，实际: ${reply!['name']}`);
      assert(reply!['content'] === '所以更不应该了。', `二级评论内容应为 "所以更不应该了。" 实际: ${reply!['content']}`);
      assert(reply!['parent_comment_id'] === '11', `parent_comment_id 应为 11`);
      assert(reply!['reply_to_nickname'] === '林汐', `reply_to_nickname 应为 "林汐"`);
    },
  },
];

export async function run(): Promise<{ name: string; passed: number; failed: number; errors: Array<{ test: string; error: string }> }> {
  return runSuite('feeds3-comments', cases);
}