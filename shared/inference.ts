// 出牌画像（教材规则库 I01–I08）：只用公开出牌记录，推断另外三家是主攻还是助攻、擅长什么牌路。
// 这些都是可更新的倾向，不是已知手牌：每条推断都附依据，置信度不高于 0.7。
//   I01 主动出牌与被动拆接分开看：跟牌出的顺子、三连对、钢板可能是拆出来的，余单增加
//   I02 已出组合的点数空隙：只作记录
//   I03 多手顺子：只作记录
//   I04 多手三张：小间隔可能余单余对多，大跨度要警惕中段已组成连接牌
//   I05 首攻强信号：本队第一次主动出小单张、三带二、杂顺 → 偏主攻（特殊牌型较弱）
//   I06 首攻对子、高单 → 偏助攻（强牌对子多也可能首出对子，只是倾向）
//   I07 首跟与回收：跟牌拿下一轮、用炸弹抢回出牌权 → 主攻意图加强
//   I08 风格：多次主动用炸弹 → 记录为“敢于争权”，只作动态先验
import { isBomb, type Combo, type ComboType } from './combo';
import type { CardTracker } from './tracker';

export interface SeatProfile {
  seat: number;
  /** 主攻倾向分：正数偏主攻，负数偏助攻 */
  attack: number;
  role: 'attack' | 'support' | 'unknown';
  /** 多次主动领出的牌型（可能擅长） */
  likelyTypes: ComboType[];
  /** 推断依据（中文，带规则编号） */
  evidence: { rule: string; text: string }[];
}

const ATTACK_LEAD: ComboType[] = ['fullhouse', 'straight'];
const SPECIAL: ComboType[] = ['tube', 'plate'];
const LINKED: ComboType[] = ['straight', 'tube', 'plate'];
const TYPE_CN: Record<string, string> = { single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二', straight: '顺子', tube: '三连对', plate: '钢板' };

/** 推断三家（不含自己）的画像；返回按座位编号的数组，自己的位置为 null */
export function profileSeats(tracker: CardTracker, me: number): (SeatProfile | null)[] {
  const hist = tracker.history;
  const profiles: (SeatProfile | null)[] = [0, 1, 2, 3].map((s) => (s === me ? null : { seat: s, attack: 0, role: 'unknown', likelyTypes: [], evidence: [] }));
  const add = (s: number, rule: string, text: string, w: number) => {
    const p = profiles[s];
    if (!p) return;
    p.attack += w;
    p.evidence.push({ rule, text });
  };

  // I05 / I06：每队第一次主动领出（整副牌第一手由先手决定，也算）
  const teamFirstLead = new Map<number, { seat: number; combo: Combo }>();
  for (const h of hist) if (h.combo && h.lead && !teamFirstLead.has(h.seat % 2)) teamFirstLead.set(h.seat % 2, { seat: h.seat, combo: h.combo });
  for (const { seat, combo } of teamFirstLead.values()) {
    const t = combo.type;
    if ((t === 'single' && combo.value <= 10) || ATTACK_LEAD.includes(t)) add(seat, 'I05', `本队第一次主动出${t === 'single' ? '小单张' : TYPE_CN[t]}，偏向主攻`, 1);
    else if (SPECIAL.includes(t)) add(seat, 'I05', `本队第一次主动出${TYPE_CN[t]}（较弱的尝试信号），略偏主攻`, 0.5);
    else if (t === 'pair' || (t === 'single' && combo.value >= 13)) add(seat, 'I06', `本队第一次主动出${t === 'pair' ? '对子' : '大单张'}，偏向助攻（强牌对子多时也可能这样出）`, -1);
  }

  // I07：跟牌拿下一轮（主动回收）、用炸弹抢出牌权；I01：跟牌出连接牌型
  let leader = -1, winner = -1;
  const recoveries = [0, 0, 0, 0], bombs = [0, 0, 0, 0];
  const closeTrick = () => { if (winner >= 0 && winner !== leader) recoveries[winner]++; };
  for (const h of hist) {
    if (!h.combo) continue;
    if (h.lead) { closeTrick(); leader = h.seat; winner = h.seat; continue; }
    winner = h.seat;
    if (isBomb(h.combo)) bombs[h.seat]++;
    if (LINKED.includes(h.combo.type)) {
      const p = profiles[h.seat];
      if (p && !p.evidence.some((e) => e.rule === 'I01')) p.evidence.push({ rule: 'I01', text: `跟牌出过${TYPE_CN[h.combo.type]}，可能是拆出来的，余单可能变多` });
    }
  }
  // 当前一轮还没结束时，拿到桌面最大的人暂不算回收
  for (let s = 0; s < 4; s++) {
    if (recoveries[s] >= 1) add(s, 'I07', `跟牌拿下过 ${recoveries[s]} 轮，在主动争出牌权`, Math.min(1.5, 0.5 * recoveries[s]));
    if (bombs[s] >= 2) add(s, 'I08', `已经主动用了 ${bombs[s]} 个炸弹，敢于争权`, 0.5);
  }

  // 剩牌明显少于其他人：正在冲刺
  const counts = [0, 1, 2, 3].map((s) => tracker.seats[s].count);
  for (let s = 0; s < 4; s++) {
    if (!profiles[s] || tracker.seats[s].place) continue;
    const others = counts.filter((_, i) => i !== s && !tracker.seats[i].place);
    if (others.length && counts[s] <= 10 && counts[s] + 6 <= Math.min(...others)) add(s, 'I07', `只剩 ${counts[s]} 张，明显比别人少，正在冲刺`, 1);
  }

  // I03 / I04：多手顺子、三张（只作记录）；likelyTypes：多次主动领出的牌型
  for (let s = 0; s < 4; s++) {
    const p = profiles[s];
    if (!p) continue;
    const plays = tracker.seats[s].plays;
    const straights = plays.filter((c) => c.type === 'straight');
    if (straights.length >= 2) p.evidence.push({ rule: 'I03', text: `出过 ${straights.length} 手顺子（${straights.map((c) => c.value).join('、')} 起），重叠区和空隙可能有对子或三张` });
    const triples = plays.filter((c) => c.type === 'triple' || c.type === 'fullhouse').map((c) => c.value).sort((a, b) => a - b);
    if (triples.length >= 2) {
      const span = triples[triples.length - 1] - triples[0];
      p.evidence.push({ rule: 'I04', text: span >= 5 ? `三张跨度大（${triples.join('、')}），中段可能已组成连接牌` : `出过多手三张且间隔小，可能余单余对较多` });
    }
    const cnt = new Map<ComboType, number>();
    for (const t of tracker.seats[s].leads) cnt.set(t, (cnt.get(t) ?? 0) + 1);
    p.likelyTypes = [...cnt].filter(([, n]) => n >= 2).map(([t]) => t);
    p.role = p.attack >= 1 ? 'attack' : p.attack <= -1 ? 'support' : 'unknown';
  }
  return profiles;
}

/** 画像的置信度：依据越多越高，最高 0.7（只是倾向） */
export function profileConfidence(p: SeatProfile): number {
  return Math.min(0.7, 0.35 + 0.12 * Math.abs(p.attack));
}
