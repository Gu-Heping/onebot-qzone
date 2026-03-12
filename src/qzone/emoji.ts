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

  // 新版表情 (e190-e204)
  'e190': '[爱情]',
  'e191': '[飞吻]',
  'e192': '[跳跳]',
  'e193': '[发抖]',
  'e194': '[怄火]',
  'e195': '[转圈]',
  'e196': '[磕头]',
  'e197': '[回头]',
  'e198': '[跳绳]',
  'e199': '[挥手]',
  'e200': '[激动]',
  'e201': '[街舞]',
  'e202': '[献吻]',
  'e203': '[左太极]',
  'e204': '[右太极]',

  // 新表情 (e243, e247, e249, e257, e282, e302)
  'e243': '[泪奔]',
  'e247': '[喷血]',
  'e249': '[doge]',
  'e257': '[👻]',
  'e282': '[托腮]',
  'e302': '[🙏]',

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
  'e10261': '[忙到飞起]',
  'e10262': '[脑阔疼]',
  'e10263': '[沧桑]',
  'e10264': '[捂脸]',
  'e10265': '[辣眼睛]',
  'e10266': '[哦呦]',
  'e10267': '[头秃]',
  'e10268': '[问号脸]',
  'e10269': '[暗中观察]',
  'e10270': '[emm]',
  'e10271': '[吃瓜]',
  'e10272': '[呵呵哒]',
  'e10273': '[我酸了]',
  'e10274': '[太南了]',
  'e10277': '[汪汪]',
  'e10289': '[睁眼]',
  'e10318': '[崇拜]',
  'e10319': '[比心]',
};

/** QQ空间表情图片基础URL */
const EMOJI_BASE_URL = 'https://qzonestyle.gtimg.cn/qzone/em/';

/** 表情别名映射：网络流行语 -> 标准表情代码 */
const EMOJI_ALIASES: Record<string, string> = {
  // 英文别名
  'doge': 'e249',   // QzEmoji 中的 doge
  'emm': 'e10270',  // QzEmoji 中的 emm (e10270)
  // 中文别名
  'doge狗头': 'e249',
  '托腮': 'e282',
  '祈祷': 'e302',
  '比心': 'e187',   // 爱你
  '飞吻': 'e191',   // e191 不是 e201
  '抱抱': 'e178',   // 拥抱
  '握手': 'e181',
  '鼓掌': 'e142',
  '胜利': 'e182',
  'OK': 'e189',
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
  '哭': 'e105',     // 流泪
  '笑': 'e100',     // 微笑
  '开心': 'e128',   // 憨笑
  '生气': 'e111',   // 发怒
  '惊讶': 'e114',
  '难过': 'e115',
  '害羞': 'e106',
  '调皮': 'e112',
  '可爱': 'e121',
};

/** Unicode Emoji 映射表 (e7000-e7439): QQ代码 -> Unicode 字符 */
export const UNICODE_EMOJI_MAP: Record<string, string> = {
  'e7000': '😊', 'e7001': '😃', 'e7002': '😊', 'e7003': '😉', 'e7004': '😍', 'e7005': '😘',
  'e7006': '😚', 'e7007': '😳', 'e7008': '😌', 'e7009': '😁', 'e7010': '😜', 'e7011': '😝',
  'e7012': '😒', 'e7013': '😏', 'e7014': '😓', 'e7015': '😔', 'e7016': '😞', 'e7017': '😖',
  'e7018': '😥', 'e7019': '😰', 'e7020': '😨', 'e7021': '😣', 'e7022': '😢', 'e7023': '😭',
  'e7024': '😂', 'e7025': '😵', 'e7026': '😱', 'e7027': '😠', 'e7028': '😡', 'e7029': '😪',
  'e7030': '😷', 'e7031': '👿', 'e7032': '👽', 'e7033': '💛', 'e7034': '💙', 'e7035': '💜',
  'e7036': '粉心', 'e7037': '💚', 'e7038': '❤', 'e7039': '💔', 'e7040': '💖', 'e7041': '💘',
  'e7042': '✨', 'e7043': '⭐', 'e7044': '💢', 'e7045': '❗', 'e7046': '❓', 'e7047': '💤',
  'e7048': '💨', 'e7049': '💦', 'e7050': '🎶', 'e7051': '🎵', 'e7052': '🔥', 'e7053': '💩',
  'e7054': '👍', 'e7055': '👎', 'e7056': '👌', 'e7057': '👊', 'e7058': '✊', 'e7059': '✌',
  'e7060': '🖐', 'e7061': '✋', 'e7062': '👐', 'e7063': '👆', 'e7064': '👇', 'e7065': '👉',
  'e7066': '👈', 'e7067': '🙌', 'e7068': '🙏', 'e7069': '☝', 'e7070': '👏', 'e7071': '💪',
  'e7072': '🚶', 'e7073': '🏃', 'e7074': '👫', 'e7075': '💃', 'e7076': '👯', 'e7077': '🙆',
  'e7078': '🙅', 'e7079': '💁', 'e7080': '🙇', 'e7081': '💏', 'e7082': '💑', 'e7083': '💆',
  'e7084': '💇', 'e7085': '💅', 'e7086': '👦', 'e7087': '👧', 'e7088': '👩', 'e7089': '👨',
  'e7090': '👵', 'e7091': '👴', 'e7092': '🧑', 'e7093': '👲', 'e7094': '👳', 'e7095': '工人',
  'e7096': '👮', 'e7097': '👼', 'e7098': '👸', 'e7099': '💂', 'e7100': '💀', 'e7101': '👣',
  'e7102': '💋', 'e7103': '👄', 'e7104': '👂', 'e7105': '👀', 'e7106': '👃', 'e7107': '☀',
  'e7108': '🌧', 'e7109': '⛅', 'e7110': '⛄', 'e7111': '🌙', 'e7112': '⚡', 'e7113': '🌀',
  'e7114': '🌊', 'e7115': '🐱', 'e7116': '🐶', 'e7117': '🐭', 'e7118': '🐹', 'e7119': '🐰',
  'e7120': '🐺', 'e7121': '🐸', 'e7122': '🐯', 'e7123': '🐨', 'e7124': '🐻', 'e7125': '🐷',
  'e7126': '🐮', 'e7127': '🐗', 'e7128': '🐒', 'e7129': '🐴', 'e7130': '🐎', 'e7131': '🐫',
  'e7132': '🐏', 'e7133': '🐘', 'e7134': '🐍', 'e7135': '🐦', 'e7136': '🐤', 'e7137': '🐔',
  'e7138': '🐦', 'e7139': '🐛', 'e7140': '🐙', 'e7141': '🐵', 'e7142': '🐠', 'e7143': '🐟',
  'e7144': '🐋', 'e7145': '🐬', 'e7146': '💐', 'e7147': '🌸', 'e7148': '🌷', 'e7149': '🍀',
  'e7150': '🌹', 'e7151': '🌻', 'e7152': '🌺', 'e7153': '🍁', 'e7154': '🍃', 'e7155': '🍂',
  'e7156': '🌴', 'e7157': '🌵', 'e7158': '🌾', 'e7159': '🐚', 'e7160': '🪴', 'e7161': '💝',
  'e7162': '🎎', 'e7163': '🎒', 'e7164': '🧥', 'e7165': '🎏', 'e7166': '🎆', 'e7167': '🎇',
  'e7168': '🎐', 'e7169': '🎑', 'e7170': '🎃', 'e7171': '👻', 'e7172': '🎅', 'e7173': '🎄',
  'e7174': '🎁', 'e7175': '🔔', 'e7176': '🎉', 'e7177': '🎈', 'e7178': '💿', 'e7179': '📀',
  'e7180': '📹', 'e7181': '💻', 'e7182': '📺', 'e7183': '📱', 'e7184': '📠', 'e7185': '☎',
  'e7186': '💽', 'e7187': '📼', 'e7188': '🔈', 'e7189': '🔊', 'e7190': '🔉', 'e7191': '📻',
  'e7192': '📡', 'e7193': '👓', 'e7194': '🔍', 'e7195': '🔓', 'e7196': '🔒', 'e7197': '🔑',
  'e7198': '✂', 'e7199': '🔨', 'e7200': '💡', 'e7201': '📲', 'e7202': '📩', 'e7203': '📬',
  'e7204': '📮', 'e7205': '🛁', 'e7206': '🚽', 'e7207': '💺', 'e7208': '💰', 'e7209': '金冠',
  'e7210': '🚬', 'e7211': '💣', 'e7212': '🔫', 'e7213': '💊', 'e7214': '💉', 'e7215': '🏈',
  'e7216': '🏀', 'e7217': '⚽', 'e7218': '⚾', 'e7219': '🎾', 'e7220': '高尔夫', 'e7221': '🎱',
  'e7222': '🏊', 'e7223': '🏄', 'e7224': '🏂', 'e7225': '♠', 'e7226': '♥', 'e7227': '♣',
  'e7228': '♦', 'e7229': '🏆', 'e7230': '👾', 'e7231': '🎯', 'e7232': '🀄', 'e7233': '🎬',
  'e7234': '📝', 'e7235': '📖', 'e7236': '🎨', 'e7237': '🎤', 'e7238': '🎧', 'e7239': '🎺',
  'e7240': '🎷', 'e7241': '🎸', 'e7242': '〽', 'e7243': '👞', 'e7244': '🥿', 'e7245': '👠',
  'e7246': '👢', 'e7247': '👕', 'e7248': '👔', 'e7249': '👗', 'e7250': '👘', 'e7251': '👙',
  'e7252': '🎀', 'e7253': '🎩', 'e7254': '👑', 'e7255': '👒', 'e7256': '🌂', 'e7257': '💼',
  'e7258': '👜', 'e7259': '💄', 'e7260': '💍', 'e7261': '💎', 'e7262': '☕', 'e7263': '🍵',
  'e7264': '🍺', 'e7265': '🍻', 'e7266': '🍸', 'e7267': '🍶', 'e7268': '🍴', 'e7269': '🍔',
  'e7270': '🍝', 'e7271': '🍛', 'e7272': '🍱', 'e7273': '🍣', 'e7274': '🍙', 'e7275': '🍘',
  'e7276': '🍚', 'e7277': '🍜', 'e7278': '🍲', 'e7279': '🍞', 'e7280': '🥚', 'e7281': '🍢',
  'e7282': '🍡', 'e7283': '🍦', 'e7284': '🍧', 'e7285': '🎂', 'e7286': '🍰', 'e7287': '🍎',
  'e7288': '🍊', 'e7289': '🍉', 'e7290': '🍓', 'e7291': '🍆', 'e7292': '🍅', 'e7293': '🏠',
  'e7294': '🏫', 'e7295': '🏢', 'e7296': '🏣', 'e7297': '🏥', 'e7298': '🏦', 'e7299': '🏪',
  'e7300': '🏩', 'e7301': '🏨', 'e7302': '💒', 'e7303': '⛪', 'e7304': '🏬', 'e7305': '🌇',
  'e7306': '🌆', 'e7307': '油罐', 'e7308': '🏯', 'e7309': '🏰', 'e7310': '⛺', 'e7311': '🏭',
  'e7312': '🗼', 'e7313': '🗻', 'e7314': '🌄', 'e7315': '🌅', 'e7316': '🌠', 'e7317': '🗽',
  'e7318': '🌈', 'e7319': '🎡', 'e7320': '⛲', 'e7321': '🎢', 'e7322': '🚢', 'e7323': '🛥',
  'e7324': '⛵', 'e7325': '✈', 'e7326': '🚀', 'e7327': '🚲', 'e7328': '🚙', 'e7329': '🚗',
  'e7330': '🚕', 'e7331': '🚌', 'e7332': '🚓', 'e7333': '🚒', 'e7334': '🚑', 'e7335': '🚚',
  'e7336': '🚎', 'e7337': '🚉', 'e7338': '🚅', 'e7339': '🚆', 'e7340': '钞票', 'e7341': '⛽',
  'e7342': '🚦', 'e7343': '⚠', 'e7344': '🚧', 'e7345': '🔰', 'e7346': '🏧', 'e7347': '🎰',
  'e7348': '路牌', 'e7349': '💈', 'e7350': '♨', 'e7351': '🏁', 'e7352': '🎌', 'e7353': '🇯🇵',
  'e7354': '🇰🇷', 'e7355': '🇨🇳', 'e7356': '🇺🇸', 'e7357': '🇫🇷', 'e7358': '🇪🇸', 'e7359': '🇮🇹',
  'e7360': '🇬🇧', 'e7361': '🇩🇪', 'e7362': '1️⃣', 'e7363': '2️⃣', 'e7364': '3️⃣', 'e7365': '4️⃣',
  'e7366': '5️⃣', 'e7367': '6️⃣', 'e7368': '7️⃣', 'e7369': '8️⃣', 'e7370': '9️⃣', 'e7371': '0️⃣',
  'e7372': '#️⃣', 'e7373': '⬆', 'e7374': '⬇', 'e7375': '⬅', 'e7376': '➡', 'e7377': '↗',
  'e7378': '↙', 'e7379': '↘', 'e7380': '↙', 'e7381': '◀', 'e7382': '▶', 'e7383': '⏪',
  'e7384': '⏩', 'e7385': '🆗', 'e7386': '🆕', 'e7387': '🔝', 'e7388': '🆙', 'e7389': '🆒',
  'e7390': '🎦', 'e7391': '🈁', 'e7392': '📶', 'e7393': '🈵', 'e7394': '🈳', 'e7395': '🉐',
  'e7396': '🈹', 'e7397': '🈯', 'e7398': '🈺', 'e7399': '🈶', 'e7400': '🈚', 'e7401': '🈷',
  'e7402': '🈸', 'e7403': '🈂', 'e7404': '🚻', 'e7405': '🚹', 'e7406': '🚺', 'e7407': '🚼',
  'e7408': '🚭', 'e7409': '🅿', 'e7410': '♿', 'e7411': '列车', 'e7412': '🚾', 'e7413': '㊙',
  'e7414': '㊗', 'e7415': '🔞', 'e7416': '🆔', 'e7417': '✳', 'e7418': '标记', 'e7419': '💟',
  'e7420': '🆚', 'e7421': '手机', 'e7422': '📴', 'e7423': '💹', 'e7424': '💱', 'e7425': '♈',
  'e7426': '♉', 'e7427': '♊', 'e7428': '♋', 'e7429': '♌', 'e7430': '♍', 'e7431': '♎',
  'e7432': '♏', 'e7433': '♐', 'e7434': '♑', 'e7435': '♒', 'e7436': '♓', 'e7437': '⛎',
  'e7438': '🔯', 'e7439': '🅰',
};

/** Unicode Emoji 到 QQ 代码的反向映射 (延迟初始化) */
let EMOJI_TO_CODE_MAP: Map<string, string> | null = null;

/**
 * 获取 Unicode Emoji 到 QQ 代码的映射表
 */
function getEmojiToCodeMap(): Map<string, string> {
  if (!EMOJI_TO_CODE_MAP) {
    EMOJI_TO_CODE_MAP = new Map();
    for (const [code, emoji] of Object.entries(UNICODE_EMOJI_MAP)) {
      // 只映射真正的 Unicode Emoji，跳过中文描述（中文通常2-3个字符）
      // Emoji 通常包含非 ASCII 字符且能通过 Emoji 正则测试
      if (/\p{Emoji}/u.test(emoji) && !/[\u4e00-\u9fa5]/.test(emoji)) {
        EMOJI_TO_CODE_MAP.set(emoji, code);
      }
    }
  }
  return EMOJI_TO_CODE_MAP;
}

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

  // Unicode 表情 (e7000-e7439)
  if (num >= 7000 && num <= 7439) {
    return UNICODE_EMOJI_MAP[code] ?? `[表情${code}]`;
  }

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

/**
 * 将 QQ Unicode 表情代码 (e7000+) 转换为 Unicode Emoji 字符
 * 用于接收消息时的处理
 * @param content 包含 [em]e7000[/em] 格式的文本
 * @returns 替换为 Unicode Emoji 的文本
 * @example convertQqUnicodeToEmoji("你好[em]e7000[/em]") // "你好😊"
 */
export function convertQqUnicodeToEmoji(content: string): string {
  return content.replace(/\[em\](e7\d{3})\[\/em\]/g, (_, code: string) => {
    return UNICODE_EMOJI_MAP[code] ?? `[${code}]`;
  });
}

/**
 * 将 Unicode Emoji 字符转换为 QQ 表情代码格式
 * 用于发送消息时的处理
 * @param content 包含 Unicode Emoji 的文本
 * @returns 替换为 [em]e7000[/em] 格式的文本
 * @example convertEmojiToQqCode("你好😊") // "你好[em]e7000[/em]"
 */
export function convertEmojiToQqCode(content: string): string {
  const emojiMap = getEmojiToCodeMap();

  // 匹配单个 Unicode Emoji（使用反向负向查找避免匹配连续的表情）
  // 匹配模式：emoji 可选的 FE0F 变体选择符，可选的 200D ZWJ 连接符，再加一个 emoji
  return content.replace(/\p{Emoji}(?:\uFE0F?\u200D\p{Emoji})?/gu, (match) => {
    // 尝试直接匹配
    let code = emojiMap.get(match);
    if (code) return `[em]${code}[/em]`;

    // 尝试去除变体选择符后匹配
    const withoutVariation = match.replace(/\uFE0F/g, '');
    code = emojiMap.get(withoutVariation);
    if (code) return `[em]${code}[/em]`;

    // 未找到映射，保留原样
    return match;
  });
}

/**
 * 检查内容是否包含 Unicode Emoji
 * @param content 内容
 * @returns 是否包含 Unicode Emoji
 */
export function hasUnicodeEmojis(content: string): boolean {
  return /\p{Emoji}/u.test(content);
}

/**
 * 判断表情代码是否为 Unicode 表情 (e7000-e7439)
 * @param code 表情代码
 * @returns 是否为 Unicode 表情
 */
export function isUnicodeEmojiCode(code: string): boolean {
  const num = parseInt(code.replace('e', ''), 10);
  return num >= 7000 && num <= 7439;
}
