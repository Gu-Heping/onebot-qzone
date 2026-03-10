/**
 * 调试评论解析
 */

import { parseFeeds3Comments } from '../src/qzone/feeds3Parser.js';

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

console.log('=== 调试评论解析 ===\n');

const result = parseFeeds3Comments(html);

console.log('解析结果:');
for (const [postTid, comments] of result) {
  console.log(`\n帖子 TID: ${postTid}`);
  for (const c of comments) {
    console.log(`\n  评论 ID: ${c['commentid']}`);
    console.log(`  UIN: ${c['uin']}`);
    console.log(`  昵称: ${c['name']}`);
    console.log(`  内容: "${c['content']}"`);
    console.log(`  是否回复: ${c['is_reply']}`);
    console.log(`  回复目标 UIN: ${c['reply_to_uin']}`);
    console.log(`  回复目标昵称: ${c['reply_to_nickname']}`);
    console.log(`  回复目标评论 ID: ${c['reply_to_comment_id']}`);
    console.log(`  父评论 ID: ${c['parent_comment_id']}`);
  }
}

// 测试正则表达式
console.log('\n=== 测试正则表达式 ===\n');

const replyBody = `<div class="comments-content">
          <a class="nickname c_tx q_namecard" link="nameCard_2124279245" href="http://user.qzone.qq.com/2124279245">Rive2</a>&nbsp;回复<a class="nickname c_tx q_namecard" link="nameCard_1827451317" href="http://user.qzone.qq.com/1827451317">林汐</a>&nbsp; : 所以更不应该了。
        </div>`;

console.log('replyBody:', replyBody.substring(0, 200));

// 测试提取回复目标昵称的正则（已修复：使用 * 而非 +，因为"回复"后可能没有空格）
const htmlPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*回复(?:&nbsp;|\s)*<a[^>]*class="[^"]*nickname[^"]*"[^>]*>([^<]+)<\/a>/i;
const htmlMatch = replyBody.match(htmlPattern);
console.log('\n提取回复目标昵称匹配结果:', htmlMatch ? htmlMatch[1] : '未匹配');

// 测试提取内容的正则（已修复：使用 * 而非 +）
const replyPattern = /<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*回复(?:&nbsp;|\s)*<a[^>]*class="[^"]*nickname[^"]*"[^>]*>[^<]*<\/a>(?:&nbsp;|\s)*[:：](?:&nbsp;|\s)*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|$)/i;
const replyMatch = replyBody.match(replyPattern);
console.log('提取回复内容匹配结果:', replyMatch ? `"${replyMatch[1]}"` : '未匹配');

// 测试简化的内容提取
const simplePattern = /回复[\s\S]*?[:：]\s*([\s\S]*?)(?:<div\s+class="comments-op|<div\s+class="mod-comments-sub|$)/i;
const simpleMatch = replyBody.match(simplePattern);
console.log('简化内容匹配结果:', simpleMatch ? `"${simpleMatch[1]}"` : '未匹配');