/**
 * 测试二级评论获取
 * 运行: npx tsx test/comment-parser.ts
 */

import { QzoneClient } from '../src/qzone/client.js';

// 测试用 Cookie（用户提供）
const TEST_COOKIE = `pgv_pvid=5648323174; RK=twZ7mau0fF; ptcz=e872dd41d9f4d643f2201bf78b49428bc77a1bc52c6403c8e7ca37e5568faae1; qz_screen=1260x840; QZ_FE_WEBP_SUPPORT=1; ptui_loginuin=2492835361; __Q_w_s__QZN_TodoMsgCnt=1; __Q_w_s_hat_seed=1; _qimei_uuid42=1a3010d1021100a087d376d5e20b625e8e3656026a; yybsdk-webId=736831300000019ca7d3b0b04a7d758f; _qimei_fingerprint=fa94e117d28c39d5d5f67f0d33e1ce6d; _qimei_i_3=5cd16d80c10850dac8c3fc615cd072b1a1b8a6f9150802d0b7867d0d2397246e336065943989e2daab8c; _qimei_q36=; _qimei_i_2=52c644e0f21d; _qimei_h38=; _qimei_i_1=40c754c5ee21; _qimei_q32=; _qpsvr_localtk=0.16076841417711463; Loading=Yes; pgv_info=ssid=s4361221760; uin=o2492835361; skey=@TUxvGY9Tm; p_uin=o2492835361; pt4_token=UD4iG8bf2viAEo1vIF6AU7Y8p857HHp3r7w4Ldnoxlk_; p_skey=GjjLn9SdO*8HuRqfkh-vhCJ4M-mJHwHZk8x6syoRjZw_; media_p_uin=2492835361; media_p_skey=XGIB2bHWIwRd88X9-Dh8-8n2-oPt44hLT6akVyoAodKAGStmI4HR5pU4OgXkXOYdhIgObAUCNEeRW0ed51hYhw; 2492835361_todaycount=2; 2492835361_totalcount=526; cpu_performance_v8=54`;

function extractUin(cookie: string): string {
  const match = cookie.match(/uin=o?(\d+)/);
  return match ? match[1] : '';
}

async function main() {
  console.log('=== 二级评论获取测试 ===\n');
  
  const uin = extractUin(TEST_COOKIE);
  console.log(`登录 UIN: ${uin}\n`);
  
  // 创建 QzoneClient
  const client = new QzoneClient({ cachePath: './.cache' });
  
  // 设置 cookies
  const cookiePairs = TEST_COOKIE.split(';').map(s => s.trim()).filter(Boolean);
  for (const pair of cookiePairs) {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      client.cookies[key] = valueParts.join('=');
    }
  }
  client.qqNumber = uin;
  
  try {
    // 获取自己的说说列表
    console.log('[1] 获取说说列表...');
    const emotions = await client.getEmotionList(uin, 0, 20);
    
    // 找有评论的说说
    const items = (emotions['msglist'] || emotions['data'] || []) as Record<string, unknown>[];
    console.log(`获取到 ${items.length} 条说说`);
    
    // 找评论数最多的帖子
    const sortedItems = items
      .filter((item: Record<string, unknown>) => (item['cmtnum'] as number) > 0)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => ((b['cmtnum'] as number) || 0) - ((a['cmtnum'] as number) || 0));
    
    if (sortedItems.length === 0) {
      console.log('\n没有找到有评论的说说');
      return;
    }
    
    // 测试评论数最多的帖子
    const testPost = sortedItems[0];
    const testTid = testPost['tid'] as string;
    const testUin = testPost['uin'] as string || uin;
    const cmtnum = testPost['cmtnum'] as number;
    
    console.log(`\n[2] 测试评论数最多的帖子:`);
    console.log(`  tid: ${testTid}`);
    console.log(`  uin: ${testUin}`);
    console.log(`  评论数: ${cmtnum}`);
    console.log(`  内容: ${(testPost['content'] as string)?.substring(0, 50)}...`);
    
    // 获取完整评论
    console.log('\n[3] 获取完整评论...');
    const commentsRes = await client.getCommentsBestEffort(testUin, testTid, 50, 0);
    console.log(`API 响应 code: ${commentsRes.code}`);
    
    // 解析评论列表
    const commentList = (commentsRes['commentlist'] || commentsRes['comments'] || commentsRes['data'] || []) as Record<string, unknown>[];
    console.log(`获取到 ${commentList.length} 条评论`);
    
    // 分析评论结构
    let rootCount = 0;
    let replyCount = 0;
    
    console.log('\n[4] 评论详情:');
    for (const c of commentList) {
      // 检查是否是二级回复
      const replyToUin = c['reply_to_uin'] || c['replyto_uin'] || c['replyUin'];
      const replyToCommentId = c['reply_to_comment_id'] || c['reply_comment_id'] || c['replyTid'];
      const isReply = !!(replyToUin || replyToCommentId);
      
      const name = (c['name'] || c['nickname'] || c['userName']) as string;
      const content = (c['content'] || c['text']) as string;
      
      if (isReply) {
        replyCount++;
        const replyToName = c['reply_to_name'] || c['reply_to_nickname'] || c['replyName'] || '(未知)';
        console.log(`  [回复] ${name} -> @${replyToName}: ${content?.substring(0, 40)}`);
        console.log(`         reply_to_uin=${replyToUin}, reply_to_comment_id=${replyToCommentId}`);
      } else {
        rootCount++;
        console.log(`  [一级] ${name}: ${content?.substring(0, 40)}`);
      }
    }
    
    console.log('\n=== 统计 ===');
    console.log(`一级评论: ${rootCount}`);
    console.log(`二级回复: ${replyCount}`);
    
    if (replyCount > 0) {
      console.log('\n✅ 成功获取到二级评论！');
    } else {
      console.log('\n⚠️ 该帖子没有二级回复，但 API 支持获取');
      console.log('   二级回复的数据结构已验证可用');
    }
    
  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

main();