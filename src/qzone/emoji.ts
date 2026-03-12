/* ─────────────────────────────────────────────
   QQ空间表情处理模块 (Emoji Processor)
   处理 [em]eXXX[/em] 格式的表情代码
   ───────────────────────────────────────────── */

/** 常见QQ空间表情映射表 (e100-e399 为常用表情) */
export const EMOJI_NAME_MAP: Record<string, string> = {
  // 基础表情 (e100-e149)
  'e100': '[微笑]',
  'e101': '[撇嘴]',
  'e102': '[色]',
  'e103': '[发呆]',
  'e104': '[得意]',
  'e105': '[流泪]',
  'e106': '[害羞]',
  'e107': '[闭嘴]',
  'e108': '[睡]',
  'e109': '[大哭]',
  'e110': '[尴尬]',
  'e111': '[发怒]',
  'e112': '[调皮]',
  'e113': '[呲牙]',
  'e114': '[惊讶]',
  'e115': '[难过]',
  'e116': '[酷]',
  'e117': '[冷汗]',
  'e118': '[抓狂]',
  'e119': '[吐]',
  'e120': '[偷笑]',
  'e121': '[可爱]',
  'e122': '[白眼]',
  'e123': '[傲慢]',
  'e124': '[饥饿]',
  'e125': '[困]',
  'e126': '[惊恐]',
  'e127': '[流汗]',
  'e128': '[憨笑]',
  'e129': '[大兵]',
  'e130': '[奋斗]',
  'e131': '[咒骂]',
  'e132': '[疑问]',
  'e133': '[嘘]',
  'e134': '[晕]',
  'e135': '[折磨]',
  'e136': '[衰]',
  'e137': '[骷髅]',
  'e138': '[敲打]',
  'e139': '[再见]',
  'e140': '[擦汗]',
  'e141': '[抠鼻]',
  'e142': '[鼓掌]',
  'e143': '[糗大了]',
  'e144': '[坏笑]',
  'e145': '[左哼哼]',
  'e146': '[右哼哼]',
  'e147': '[哈欠]',
  'e148': '[鄙视]',
  'e149': '[委屈]',

  // 更多表情 (e150-e199)
  'e150': '[快哭了]',
  'e151': '[阴险]',
  'e152': '[亲亲]',
  'e153': '[吓]',
  'e154': '[可怜]',
  'e155': '[菜刀]',
  'e156': '[西瓜]',
  'e157': '[啤酒]',
  'e158': '[篮球]',
  'e159': '[乒乓]',
  'e160': '[咖啡]',
  'e161': '[饭]',
  'e162': '[猪头]',
  'e163': '[玫瑰]',
  'e164': '[凋谢]',
  'e165': '[示爱]',
  'e166': '[爱心]',
  'e167': '[心碎]',
  'e168': '[蛋糕]',
  'e169': '[闪电]',
  'e170': '[炸弹]',
  'e171': '[刀]',
  'e172': '[足球]',
  'e173': '[瓢虫]',
  'e174': '[便便]',
  'e175': '[月亮]',
  'e176': '[太阳]',
  'e177': '[礼物]',
  'e178': '[拥抱]',
  'e179': '[强]',
  'e180': '[弱]',
  'e181': '[握手]',
  'e182': '[胜利]',
  'e183': '[抱拳]',
  'e184': '[勾引]',
  'e185': '[拳头]',
  'e186': '[差劲]',
  'e187': '[爱你]',
  'e188': '[NO]',
  'e189': '[OK]',

  // 新版表情 (e200-e299)
  'e200': '[爱情]',
  'e201': '[飞吻]',
  'e202': '[跳跳]',
  'e203': '[发抖]',
  'e204': '[怄火]',
  'e205': '[转圈]',
  'e206': '[磕头]',
  'e207': '[回头]',
  'e208': '[跳绳]',
  'e209': '[挥手]',
  'e210': '[激动]',
  'e211': '[街舞]',
  'e212': '[献吻]',
  'e213': '[左太极]',
  'e214': '[右太极]',
  'e215': '[闭嘴2]',
  'e216': '[双喜]',
  'e217': '[鞭炮]',
  'e218': '[灯笼]',
  'e219': '[发财]',
  'e220': '[K歌]',
  'e221': '[购物]',
  'e222': '[邮件]',
  'e223': '[帅]',
  'e224': '[喝彩]',
  'e225': '[祈祷]',
  'e226': '[爆筋]',
  'e227': '[棒棒糖]',
  'e228': '[喝奶]',
  'e229': '[面条]',
  'e230': '[香蕉]',
  'e231': '[飞机]',
  'e232': '[开车]',
  'e233': '[高铁左]',
  'e234': '[高铁右]',
  'e235': '[轮船]',
  'e236': '[自行车]',

  // 新增表情 (e300-e399)
  'e300': '[点赞]',
  'e301': '[无聊]',
  'e302': '[怀疑]',
  'e303': '[皱眉]',
  'e304': '[无语]',
  'e305': '[无奈]',
  'e306': '[傻笑]',
  'e307': '[敷衍]',
  'e308': '[叫兽]',
  'e309': '[胜利2]',
  'e310': '[投降]',
  'e311': '[鼓掌2]',
  'e312': '[感谢]',
  'e313': '[不客气]',
  'e314': '[晚安]',
  'e315': '[犯困]',
  'e316': '[戳眼]',
  'e317': '[讨厌]',
  'e318': '[火热]',
  'e319': '[受伤]',
  'e320': '[神仙]',
  'e321': '[骷髅2]',
  'e322': '[钱]',
  'e323': '[灯泡]',
  'e324': '[奖杯]',
  'e325': '[时钟]',
  'e326': '[戒指]',
  'e327': '[沙发]',
  'e328': '[手枪]',
  'e329': '[鞭炮2]',

  // 大表情 (e400-e499)
  'e400': '[熊猫]',
  'e401': '[兔子]',
  'e402': '[给力]',
  'e403': '[神马]',
  'e404': '[围观]',
  'e405': '[威武]',
  'e406': '[奥特曼]',
  'e407': '[囧]',
  'e408': '[浮云]',
  'e409': '[ Oregon]',
  'e410': '[萌]',
  'e411': '[猪]',
  'e412': '[恐龙]',
  'e413': '[便便]',
  'e414': '[外星]',
  'e415': '[钻石]',
  'e416': '[喝酒]',
  'e417': '[欸嘿]',
  'e418': '[淡定]',
  'e419': '[乖乖]',
  'e420': '[守护]',
  'e421': '[泪流满面]',
  'e422': '[抠鼻屎]',
  'e423': '[ovo]',
  'e424': '[难过2]',
  'e425': '[lucky]',
  'e426': '[买]',
  'e427': '[好的]',
  'e428': '[电摇]',
  'e429': '[有点东西]',
  'e430': '[小丑]',
  'e431': '[暗中观察]',
  'e432': '[82年的可乐]',
  'e433': '[冰墩墩]',
  'e434': '[狗头]',
  'e435': '[虎虎生威]',
  'e436': '[绿草]',
  'e437': '[钥匙]',
  'e438': '[药丸]',
  'e439': '[牛年大吉]',
  'e440': '[牛气冲天]',
  'e441': '[求红包]',
  'e442': '[谢谢老板]',
  'e443': '[红包]',
  'e444': '[搬砖]',
  'e445': '[福到了]',
  'e446': '[记录]',
  'e447': '[抖]',
  'e448': '[哈]',
  'e449': '[哇]',
  'e450': '[疑惑]',
  'e451': '[赞啊]',
  'e452': '[我啊]',
  'e453': '[加油]',
  'e454': '[filtered]',
  'e455': '[干杯]',
  'e456': '[内心戏]',
  'e457': '[社会]',
  'e458': '[满分]',
  'e459': '[结算]',
  'e460': '[挂科]',
  'e461': '[干饭]',
  'e462': '[就这]',
  'e463': '[举牌牌]',
  'e464': '[下次一定]',
  'e465': '[裂开]',
  'e466': '[赢麻了]',
  'e467': '[甜粽]',
  'e468': '[咸粽]',
  'e469': '[咸鸭蛋]',
  'e470': '[小丑2]',
  'e471': '[我太难了]',
  'e472': '[泪目]',
  'e473': '[不容易]',
  'e474': '[不忘初心]',
  'e475': '[ Chim]',
  'e476': '[emm]',
  'e477': '[汪汪]',
  'e478': '[喵喵]',
  'e479': '[牛啊]',
  'e480': '[开门红]',
  'e481': '[夺笋]',
  'e482': '[好耶]',
  'e483': '[贴贴]',
  'e484': '[锦鲤]',
  'e485': '[王炸]',
  'e486': '[浪]',
  'e487': '[运转]',
  'e488': '[弹]',
  'e489': '[起飞]',
  'e490': '[怼]',
  'e491': '[一起666]',
  'e492': '[_awsl]',
  'e493': '[酸]',
  'e494': '[吃糖]',
  'e495': '[桃花运]',
  'e496': '[飞]',
  'e497': '[炸弹2]',
  'e498': '[吃桃]',
  'e499': '[轻松]',

  // 更多动态表情 (e500+)
  'e500': '[搞定]',
  'e501': '[打招呼]',
  'e502': '[嗨]',
  'e503': '[打call]',
  'e504': '[满脑子]',
  'e505': '[想静静]',
  'e506': '[地表最帅]',
  'e507': '[真香]',
  'e508': '[超开心]',
  'e509': '[捶胸口]',
  'e510': '[尴尬2]',
  'e511': '[嫌弃]',
  'e512': '[让我康康]',
  'e513': '[露营]',
  'e514': '[在吗]',
  'e515': '[干饭人]',
  'e516': '[变形]',
  'e517': '[摸鱼]',
  'e518': '[生气2]',
  'e519': '[ dogs]',
  'e520': '[ meow]',
  'e521': '[流汗2]',
  'e522': '[辣眼睛]',
  'e523': '[呲牙2]',
  'e524': '[微笑2]',
  'e525': '[可怜2]',
  'e526': '[打你]',
  'e527': '[ cross]',
  'e528': '[ bye]',
  'e529': '[ hello]',
  'e530': '[偷瞄]',
  'e531': '[色色]',
  'e532': '[打脸]',
  'e533': '[书架]',
  'e534': '[手机]',
  'e535': '[鼠标]',
  'e536': '[笔]',
  'e537': '[灯泡2]',
  'e538': '[刀2]',
  'e539': '[盾牌]',
  'e540': '[绿帽]',
  'e541': '[帽子]',
  'e542': '[围巾]',
  'e543': '[领带]',
  'e544': '[袜子]',
  'e545': '[手套]',
  'e546': '[鞋子]',
  'e547': '[衣服]',
  'e548': '[裤子]',
  'e549': '[裙子]',

  // 超长编号表情 (e400000+ 系列)
  'e400343': '[变形]',
  'e400820': '[嗅嗅]',
  'e400827': '[哟吼]',
  'e400840': '[坚强]',
  'e400841': '[挥手告别]',
  'e400843': '[摸头]',
  'e400844': '[飞吻2]',
  'e400845': '[亲亲2]',
  'e400846': '[抱怨]',
  'e400847': '[震惊]',
  'e400848': '[晕倒]',
  'e400849': '[期待]',
  'e400850': '[惊讶2]',
  'e400851': '[害怕]',
  'e400852': '[大笑]',
  'e400853': '[开心]',
  'e400854': '[无聊2]',
  'e400855': '[哎呀]',
  'e400856': '[奋斗2]',
  'e400857': '[委屈2]',
  'e400858': '[愤怒]',
  'e400859': '[哭泣]',
  'e400860': '[喜欢]',
  'e400861': '[爱你2]',

  // 特殊大表情 (e10000+)
  'e10271': '[龙年快乐]',
  'e10272': '[新年快乐]',
  'e10273': '[恭喜发财]',
  'e10274': '[大吉大利]',
  'e10275': '[年年有余]',
  'e10276': '[红包拿来]',
  'e10277': '[万事如意]',
  'e10278': '[心想事成]',
  'e10279': '[步步高升]',
  'e10280': '[招财进宝]',
  'e10281': '[福星高照]',
  'e10282': '[财源广进]',
  'e10283': '[阖家欢乐]',
  'e10284': '[万事如意2]',
};

/** QQ空间表情图片基础URL */
const EMOJI_BASE_URL = 'https://qzonestyle.gtimg.cn/qzone/em/';

/** 表情别名映射：网络流行语 -> 标准表情代码 */
const EMOJI_ALIASES: Record<string, string> = {
  // 英文别名
  'doge': 'e434',
  'ovo': 'e423',
  'emm': 'e476',
  'lucky': 'e425',
  'cross': 'e527',
  'bye': 'e528',
  'hello': 'e529',
  'awsl': 'e492',
  // 中文别名
  '庆祝': 'e10272', // 新年快乐作为庆祝
  '烟花': 'e217',   // 鞭炮
  '666': 'e491',    // 一起666
  '加油': 'e453',
  '干杯': 'e455',
  '谢谢': 'e312',   // 感谢
  '晚安': 'e314',
  '点赞': 'e300',
  '比心': 'e187',   // 爱你
  '飞吻': 'e201',
  '抱抱': 'e178',   // 拥抱
  '握手': 'e181',
  '鼓掌': 'e142',
  '胜利': 'e182',
  'OK': 'e189',
  '好的': 'e427',
  '收到': 'e427',
  '红包': 'e443',
  '福': 'e445',     // 福到了
  '奋斗': 'e130',
  '困': 'e125',
  '饿': 'e124',     // 饥饿
  '累': 'e135',     // 折磨
  '心碎': 'e167',
  '爱心': 'e166',
  '玫瑰': 'e163',
  '礼物': 'e177',
  '蛋糕': 'e168',
  '咖啡': 'e160',
  '啤酒': 'e157',
  '饭': 'e161',
  '西瓜': 'e156',
  '月亮': 'e175',
  '太阳': 'e176',
};

/** 已知为 PNG 格式的表情 */
const PNG_EMOJIS = new Set([
  'e400343', 'e400820', 'e400827', 'e400840', 'e400841', 'e400843', 'e400844', 'e400845',
  'e400846', 'e400847', 'e400848', 'e400849', 'e400850', 'e400851', 'e400852', 'e400853',
  'e400854', 'e400855', 'e400856', 'e400857', 'e400858', 'e400859', 'e400860', 'e400861',
]);

/**
 * 获取表情图片URL
 * @param code 表情代码 (如 e100)
 * @returns 完整的表情图片URL
 */
export function getEmojiUrl(code: string): string {
  // 超长编号通常是 PNG
  const ext = PNG_EMOJIS.has(code) || code.length > 5 ? 'png' : 'gif';
  return `${EMOJI_BASE_URL}${code}.${ext}`;
}

/**
 * 获取表情显示名称
 * @param code 表情代码
 * @returns 表情名称
 */
export function getEmojiName(code: string): string {
  return EMOJI_NAME_MAP[code] ?? getGenericEmojiName(code);
}

/**
 * 根据表情代码生成通用名称
 * e100-e399: 经典小黄脸
 * e400-e499: 大表情
 * e500+: 新版动态表情
 * e400000+: 超清表情
 * e10000+: 节日大表情
 */
function getGenericEmojiName(code: string): string {
  const num = parseInt(code.replace('e', ''), 10);
  if (Number.isNaN(num)) return `[表情${code}]`;

  if (num >= 100 && num < 200) return '[小黄脸]';
  if (num >= 200 && num < 300) return '[动态表情]';
  if (num >= 300 && num < 400) return '[新版表情]';
  if (num >= 400 && num < 500) return '[大表情]';
  if (num >= 500 && num < 600) return '[超萌表情]';
  if (num >= 400000 && num < 500000) return '[超清表情]';
  if (num >= 10000) return '[节日表情]';
  return `[表情${code}]`;
}

/**
 * 解析表情代码
 * @param content 包含表情的文本 (如 "你好[em]e100[/em]")
 * @returns 解析结果
 */
export function parseEmojis(content: string): {
  text: string;
  emojis: Array<{ code: string; name: string; url: string; index: number }>;
} {
  const emojis: Array<{ code: string; name: string; url: string; index: number }> = [];
  const pattern = /\[em\](e\d+)\[\/em\]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const code = match[1]!;
    emojis.push({
      code,
      name: getEmojiName(code),
      url: getEmojiUrl(code),
      index: match.index,
    });
  }

  return { text: content, emojis };
}

/**
 * 将表情代码转换为表情名称
 * @param content 原始内容
 * @returns 替换后的可读文本
 */
export function convertEmojisToNames(content: string): string {
  return content.replace(/\[em\](e\d+)\[\/em\]/g, (_, code: string) => {
    return getEmojiName(code);
  });
}

/** 反向映射表：表情名称 -> 表情代码 (延迟初始化) */
let NAME_TO_CODE_MAP: Map<string, string> | null = null;

/**
 * 获取名称到代码的映射表
 */
function getNameToCodeMap(): Map<string, string> {
  if (!NAME_TO_CODE_MAP) {
    NAME_TO_CODE_MAP = new Map();
    for (const [code, name] of Object.entries(EMOJI_NAME_MAP)) {
      // 存储多种变体以支持灵活匹配
      NAME_TO_CODE_MAP.set(name, code);
      // 也存储不带方括号的版本
      NAME_TO_CODE_MAP.set(name.replace(/[\[\]]/g, ''), code);
    }
    // 添加别名映射
    for (const [alias, code] of Object.entries(EMOJI_ALIASES)) {
      NAME_TO_CODE_MAP.set(`[${alias}]`, code);
      NAME_TO_CODE_MAP.set(alias, code);
    }
  }
  return NAME_TO_CODE_MAP;
}

/**
 * 将表情名称转换为表情代码格式
 * 支持格式：[微笑]、微笑、/微笑
 * @param content 包含表情名称的文本 (如 "你好[微笑]世界")
 * @returns 转换为代码格式的文本 (如 "你好[em]e100[/em]世界")
 */
export function convertNamesToEmojis(content: string): string {
  const nameMap = getNameToCodeMap();

  // 匹配 [表情名] 或 /表情名 格式
  return content.replace(/\[([^\]]+)\]|\/([a-zA-Z0-9\u4e00-\u9fa5]+)/g, (match, bracketName, slashName) => {
    const name = bracketName || slashName;
    if (!name) return match;

    const code = nameMap.get(name) || nameMap.get(`[${name}]`);
    if (code) {
      return `[em]${code}[/em]`;
    }
    return match;
  });
}

/**
 * 将表情代码转换为图片标签
 * @param content 原始内容
 * @returns 替换为<img>标签的HTML
 */
export function convertEmojisToImages(content: string): string {
  return content.replace(/\[em\](e\d+)\[\/em\]/g, (_, code: string) => {
    const url = getEmojiUrl(code);
    const name = getEmojiName(code).replace(/[\[\]]/g, '');
    return `<img src="${url}" alt="${name}" class="qzone-emoji" data-code="${code}" />`;
  });
}

/**
 * 提取纯文本（移除所有表情代码）
 * @param content 原始内容
 * @returns 纯文本
 */
export function stripEmojis(content: string): string {
  return content.replace(/\[em\]e\d+\[\/em\]/g, '');
}

/**
 * 表情转换选项
 */
export interface EmojiConvertOptions {
  /** 转换为: 'name'=表情名称, 'image'=图片标签, 'remove'=移除, 'keep'=保留原样 */
  mode: 'name' | 'image' | 'remove' | 'keep';
}

/**
 * 统一表情处理入口
 * @param content 原始内容
 * @param options 转换选项
 * @returns 处理后的内容
 */
export function processEmojis(content: string, options: EmojiConvertOptions = { mode: 'name' }): string {
  switch (options.mode) {
    case 'name':
      return convertEmojisToNames(content);
    case 'image':
      return convertEmojisToImages(content);
    case 'remove':
      return stripEmojis(content);
    case 'keep':
    default:
      return content;
  }
}

/**
 * 检查内容是否包含表情
 * @param content 内容
 * @returns 是否包含表情
 */
export function hasEmojis(content: string): boolean {
  return /\[em\]e\d+\[\/em\]/.test(content);
}

/**
 * 获取表情统计信息
 * @param content 内容
 * @returns 表情统计
 */
export function countEmojis(content: string): { total: number; unique: string[] } {
  const { emojis } = parseEmojis(content);
  const uniqueCodes = [...new Set(emojis.map(e => e.code))];
  return { total: emojis.length, unique: uniqueCodes };
}
