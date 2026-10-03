// 聊天互动：快捷语、表情、道具。
export type ChatKind = 'phrase' | 'emoji' | 'prop';

export type PhraseLang = 'zh' | 'ne' | 'yue';

/**
 * 快捷语。编号即数组下标，已有编号不要改动（联机协议按编号传输）。
 * key 对应 shared/voice-script.json 里的语音台词。
 */
export const PHRASES: { key: string; text: string; lang: PhraseLang }[] = [
  { key: 'phrase_0', lang: 'zh', text: '快点吧，等到花儿都谢了' },
  { key: 'phrase_1', lang: 'zh', text: '这牌打得漂亮！' },
  { key: 'phrase_2', lang: 'zh', text: '搭档，接好了！' },
  { key: 'phrase_3', lang: 'zh', text: '不好意思，我先走一步' },
  { key: 'phrase_4', lang: 'zh', text: '别走，决战到天亮' },
  { key: 'phrase_5', lang: 'zh', text: '和你配合真愉快' },
  { key: 'phrase_6', lang: 'zh', text: '手气不太好啊' },
  { key: 'phrase_7', lang: 'zh', text: '大家好，很高兴认识各位' },
  { key: 'phrase_8', lang: 'zh', text: '院长，来个光棍三个！' },
  { key: 'phrase_9', lang: 'zh', text: '吴总，叫个美女来打牌呀！' },
  { key: 'phrase_10', lang: 'zh', text: '师者，所以传道受业解惑也！我是袁老师！' },
  { key: 'phrase_11', lang: 'zh', text: '我是不解风情的花果山石猴子！' },
  { key: 'phrase_ne_0', lang: 'ne', text: '咋这么磨叽呢，快点儿出啊' },
  { key: 'phrase_ne_1', lang: 'ne', text: '这把稳了，老铁' },
  { key: 'phrase_ne_2', lang: 'ne', text: '哎呀妈呀，这牌也太好了' },
  { key: 'phrase_ne_3', lang: 'ne', text: '别走，咱唠到天亮' },
  { key: 'phrase_yue_0', lang: 'yue', text: '快啲啦，等到花都谢埋' },
  { key: 'phrase_yue_1', lang: 'yue', text: '好嘢！配合得几好' },
  { key: 'phrase_yue_2', lang: 'yue', text: '唔好走，同你打到天光' },
  { key: 'phrase_yue_3', lang: 'yue', text: '今日手气唔系几好' },
];

export const EMOJI_NAMES = ['微笑', '大笑', '大哭', '生气', '流汗', '酷', '惊讶', '喜欢', '困', '得意', '亲亲', '晕'];

export const PROPS = [
  { key: 'flower', name: '鲜花' },
  { key: 'heart', name: '爱心' },
  { key: 'beer', name: '干杯' },
  { key: 'egg', name: '鸡蛋' },
  { key: 'bomb', name: '炸弹' },
] as const;

export interface ChatMsg { seat: number; kind: ChatKind; id: number; to?: number }

/** 校验聊天内容，合法返回 null */
export function validateChat(m: ChatMsg): string | null {
  const max = m.kind === 'phrase' ? PHRASES.length : m.kind === 'emoji' ? EMOJI_NAMES.length : m.kind === 'prop' ? PROPS.length : 0;
  if (!Number.isInteger(m.id) || m.id < 0 || m.id >= max) return '无效的聊天内容';
  if (m.kind === 'prop' && (!Number.isInteger(m.to) || m.to! < 0 || m.to! > 3 || m.to === m.seat)) return '无效的目标';
  return null;
}

/** 服务端冷却（防刷）；界面上另有 1.5 秒的限制，留出网络抖动的余量 */
export const CHAT_COOLDOWN_MS = 1000;
