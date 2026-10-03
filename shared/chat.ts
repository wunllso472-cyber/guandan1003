// 聊天互动：快捷语、表情、道具。
export type ChatKind = 'phrase' | 'emoji' | 'prop';

/** 与 scripts/voice-lines.json 中 phrase_0..7 一一对应 */
export const PHRASES = [
  '快点吧，等到花儿都谢了',
  '这牌打得漂亮！',
  '搭档，接好了！',
  '不好意思，我先走一步',
  '别走，决战到天亮',
  '和你配合真愉快',
  '手气不太好啊',
  '大家好，很高兴认识各位',
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
