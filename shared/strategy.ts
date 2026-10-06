// 掼蛋策略规则库：根据《掼蛋实战进阶手册》（guandan_master_deep_study.docx）整理。
// 手册强调“口诀要附条件”，因此每条规则都由程序根据实际牌面判断是否触发、支持还是反对某个出法，
// 结果一方面调整本地提示的排序，一方面作为“专家规则命中”交给 Jev 参考。
import { card, cardValue, SMALL_JOKER } from './cards';
import type { Combo } from './combo';
import type { Control, OptionFeatures } from './advisor';
import type { CardTracker } from './tracker';

export interface Rule {
  id: string;
  /** 中文名称 */
  name: string;
  /** 给 Jev 的英文原则（官方建议问题和选项说明用英文） */
  principle: string;
  /** 手册出处 */
  source: string;
}

export const RULES: Record<string, Rule> = {
  GOAL: {
    id: 'GOAL', name: '目标切换', source: '第2章、第10章',
    principle: 'Decide the goal first: if an opponent already went out first, protect the partner from finishing last (and stop the opponents passing A); if the partner went out first, go out next; otherwise compete for first place.',
  },
  PASS_GATE: {
    id: 'PASS_GATE', name: '传牌门槛与顺序', source: '第6.2节、牌例04',
    principle: 'When feeding the partner, remember the next opponent acts before the partner. If that opponent is about to go out and can follow the play, a low card sends the opponent out first; raise the threshold instead.',
  },
  LAST_HAND: {
    id: 'LAST_HAND', name: '留下不可被夺的最后一手', source: '第6.3节、第10章',
    principle: 'When close to going out, keep a final play that nobody can beat, so the partner takes over the lead (jiefeng) after I go out. Play the weak parts first.',
  },
  RECAPTURE: {
    id: 'RECAPTURE', name: '有打有收', source: '第5.2节',
    principle: 'Lead a combination type only if I can win the lead back with a stronger play of the same type later.',
  },
  BOMB_PURPOSE: {
    id: 'BOMB_PURPOSE', name: '炸弹要有目的', source: '第7章',
    principle: 'Use a bomb only with a clear purpose: sprint (go out right after), escort (the partner is about to go out), cut off (an opponent is about to go out), or stop a big loss. A bomb without a follow-up wastes it.',
  },
  KEEP_LINKS: {
    id: 'KEEP_LINKS', name: '先出重复余量，保护连接牌', source: '第4.2节、牌例03',
    principle: 'Play spare duplicate cards first and keep the cards that link straights, tubes, plates and bombs.',
  },
  CHECK_REST: {
    id: 'CHECK_REST', name: '拆牌前做剩牌检查', source: '第4.3节、牌例01',
    principle: 'Breaking a bomb or a straight is only worth it if the remaining hand clearly needs fewer plays.',
  },
  STOP_FINISH: {
    id: 'STOP_FINISH', name: '优先防止对手直接走完', source: '第9章',
    principle: 'If an opponent can go out with this play or the next one, stopping them comes first, even at a high cost.',
  },
  GRAB_LEAD: {
    id: 'GRAB_LEAD', name: '小王抢出牌权', source: '玩家复盘要求（2026-10-04）',
    principle: 'Early in the round, when an opponent leads a big single (an A or a level card) and I still need the lead to run several combinations, beat it with the small joker instead of passing.',
  },
  DONT_OVERTAKE: {
    id: 'DONT_OVERTAKE', name: '不抢对家的牌', source: '第6.1节',
    principle: 'Do not overtake the partner unless taking over clearly shortens the team route or blocks an opponent from finishing.',
  },
};

export interface RuleHit {
  id: string;
  /** support 支持这个出法 / oppose 反对 */
  effect: 'support' | 'oppose';
  /** 对本地评分的调整（负数表示更推荐） */
  weight: number;
  /** 中文说明（显示给玩家） */
  note: string;
  /** 英文说明（交给 Jev） */
  en: string;
}

export interface RuleContext {
  seat: number;
  hand: number[];
  level: number;
  combo: Combo | null;
  target: Combo | null;
  targetSeat: number | null;
  counts: number[];
  tracker: CardTracker;
  features: OptionFeatures | null;
  /** 出完这手后剩下的非炸弹组合（只剩一手时用于判断最后一手） */
  restCombos: Combo[];
  /** 剩下最后一手的控制力；剩多手或已出完时为 null */
  lastHandControl: Control | null;
  /** 手里是否还有同类型、外面压不住的大牌（有打有收） */
  canRecapture: boolean;
  /** 是否存在“出完后最后一手外面压不住”的其他出法 */
  safeLastExists: boolean;
  /** 不急的时候拆散了已有牌型（出完后手数没有减少） */
  breaksLinks: boolean;
  /** 可选单张中不超过 A 的最大点值（传牌门槛用），没有时为 0 */
  maxGateSingle: number;
  /** 拆炸弹但很安全：对手剩的牌都不到 4 张（不可能有炸弹），拆开后这手和剩下的同点数牌外面都压不住 */
  bombSplitSafe?: boolean;
}

/**
 * 安全拆炸不再按“拆炸”扣分，改为支持（enabled=false 恢复旧逻辑，评估用：scripts/bench.ts 策略名加 ~old）。
 * 评估（advisor 对 advisor~old，4000 局）：每局净升级 +0.001 ±0.001，局面很少出现，不变差；主要是理由写对。
 */
export const splitSafeRule = { enabled: true };

export type Goal = 'first' | 'second' | 'protect';

/** 目标：对手已头游 → 保护对家；对家已头游 → 争二游；否则争头游 */
export function goalOf(seat: number, tracker: CardTracker): Goal {
  const firstSeat = [0, 1, 2, 3].find((s) => tracker.seats[s].place === 1);
  if (firstSeat === undefined) return 'first';
  return firstSeat % 2 === seat % 2 ? 'second' : 'protect';
}

/** 评估用：临时停用的规则（只在离线对打测试中设置） */
export const disabledRules = new Set<string>();

const hit = (id: string, effect: RuleHit['effect'], weight: number, note: string, en: string): RuleHit => ({ id, effect, weight, note, en });

/** 根据实际牌面判断每条规则对这个出法的态度 */
export function evaluateRules(c: RuleContext): RuleHit[] {
  const { seat, counts, combo, target, targetSeat, features: f, tracker } = c;
  const partner = (seat + 2) % 4, next = (seat + 1) % 4, prev = (seat + 3) % 4;
  const active = (s: number) => counts[s] > 0;
  const goal = goalOf(seat, tracker);
  const leading = !target;
  const hits: RuleHit[] = [];
  // 目标为保护对家时，配合类规则的分量加重
  const teamW = goal === 'protect' ? 1.5 : 1;

  // 不出
  if (!combo) {
    if (targetSeat === partner) hits.push(hit('DONT_OVERTAKE', 'support', -0.3, '不抢对家的牌', 'passing lets the partner keep the lead'));
    if (targetSeat !== null && targetSeat !== partner && active(targetSeat) && counts[targetSeat] <= 5) {
      hits.push(hit('STOP_FINISH', 'oppose', 2.5, `对手只剩 ${counts[targetSeat]} 张，放过可能让他直接走完`, `the opponent who made this play has only ${counts[targetSeat]} cards and may go out if I pass`));
    }
    return disabledRules.size ? hits.filter((h) => !disabledRules.has(h.id)) : hits;
  }
  if (!f) return hits;

  // 传牌门槛：送给对家的牌，下家先行动
  if (leading && active(partner) && counts[partner] <= 3 && active(next) && counts[next] <= 2 && combo.type === 'single') {
    // 下家剩 1 张时，小单张最容易被他接住走完；单张越大越安全（牌例04）
    const v = cardValue(combo.cards[0], c.level);
    if (counts[next] === 1) {
      // 在可选单张里比较：最大的（不超过 A）支持，越小越反对
      const gap = Math.max(0, c.maxGateSingle - Math.min(v, 14));
      const best = gap === 0;
      hits.push(hit('PASS_GATE', best ? 'support' : 'oppose', best ? -1.0 * teamW : gap * 0.3 * teamW,
        best ? '下家只剩 1 张，送尽量大的单张，免得先把下家送走' : '下家只剩 1 张，送小单张可能先把下家送走',
        best ? 'next opponent (acts before the partner) has 1 card; this is the highest single I can feed, hardest for them to follow'
          : 'next opponent (acts before the partner) has 1 card; a lower single may let them go out before the partner'));
    }
  }

  // 留下不可被夺的最后一手（第10章）：快出完时，最后一手要外面压不住，对家才能接风
  if (!f.finishes && c.restCombos.length === 1 && c.lastHandControl) {
    if (c.lastHandControl !== 'beatable') {
      hits.push(hit('LAST_HAND', 'support', -0.8 * teamW, '先出这手，最后留一手外面压不住的牌，对家能接风', 'keeps a final play nobody can beat, so the partner can take over after I go out'));
    } else if (c.safeLastExists) {
      hits.push(hit('LAST_HAND', 'oppose', 0.8 * teamW, '这样最后一手可能被压，对家接不到风', 'leaves a final play that others may beat, while a safer order exists'));
    }
  }

  // 有打有收：首出某类牌，手里还有同类压不住的大牌能收回出牌权
  if (leading && !f.isBomb && !f.finishes && c.canRecapture) {
    hits.push(hit('RECAPTURE', 'support', -0.3, `手里还有更大的${typeCn(combo.type)}能收回出牌权`, `I hold a stronger ${combo.type} to win the lead back`));
  }

  // 炸弹要有目的：判断标准与经过对打验证的电脑出牌一致（对手剩 8 张以内、炸完只剩两手以内等）
  if (f.isBomb && !f.finishes) {
    const sprint = f.handsLeft <= 2;
    const escort = active(partner) && counts[partner] <= 3;
    const cut = [next, prev].some((s) => active(s) && counts[s] <= 8);
    const stop = !!target && !['bomb', 'straightflush', 'jokerbomb'].includes(target.type) && target.value >= 14 && c.hand.length <= 15;
    if (sprint || escort || cut || stop) {
      const why = sprint ? '炸完很快就能走完' : cut ? '对手快出完，需要截断' : escort ? '对家快出完，炸了好护送' : '对手出了大牌，及时止损';
      const en = sprint ? 'sprint: only a couple of plays left after the bomb' : cut ? 'cut off an opponent who is close to going out' : escort ? 'escort the partner who is close to going out' : 'stop a big play before it costs more';
      hits.push(hit('BOMB_PURPOSE', 'support', -0.5, `用炸弹有明确目的：${why}`, `bomb has a purpose: ${en}`));
    } else {
      hits.push(hit('BOMB_PURPOSE', 'oppose', 0.5, '现在用炸弹没有明确后续，可能浪费', 'bomb without a clear follow-up (no sprint, escort, cut-off or stop-loss)'));
    }
  }

  // 拆牌前做剩牌检查 / 保护连接牌
  if (c.breaksLinks && !f.breaksBomb) hits.push(hit('KEEP_LINKS', 'oppose', 1.0, '会拆散已有的牌型', 'breaks an existing straight/pair/triple without reducing the number of plays left'));
  if (f.breaksBomb && c.bombSplitSafe && splitSafeRule.enabled) {
    hits.push(hit('CHECK_REST', 'support', -0.5, '对手剩的牌都不到 4 张，不可能有炸弹；拆开后每一手外面都压不住，能多次收回出牌权',
      'opponents hold fewer than 4 cards each (no bombs possible) and every piece of the split bomb is unbeatable, so splitting wins the lead more than once'));
  } else if (f.breaksBomb) hits.push(hit('CHECK_REST', 'oppose', 0.8, '会拆掉炸弹，剩下的牌未必更好走', 'breaks a bomb without clearly shortening the hand'));

  // 优先防止对手直接走完：对手刚出的牌，对手剩得很少时，压住它
  if (target && targetSeat !== null && targetSeat !== partner && active(targetSeat) && counts[targetSeat] <= 5) {
    hits.push(hit('STOP_FINISH', 'support', -0.6, `对手只剩 ${counts[targetSeat]} 张，压住他`, `the opponent has only ${counts[targetSeat]} cards; beating the play stops them going out`));
  }

  // 小王抢出牌权：开局对手首出大单张（A 或级牌），手里还有多手组合要走时，用小王压住拿出牌权
  if (target && target.type === 'single' && targetSeat !== null && targetSeat % 2 !== seat % 2 && target.value >= 14
    && combo.type === 'single' && card(combo.cards[0]).rank === SMALL_JOKER && c.hand.length >= 18 && f.handsLeft >= 3
    && ![next, prev].some((s) => active(s) && counts[s] <= 10)) {
    hits.push(hit('GRAB_LEAD', 'support', -3.5, '开局对手出大单张，用小王抢出牌权，好走自己的组合', 'early in the round: beat the opponent big single with the small joker to win the lead and run my combinations'));
  }

  // 不抢对家的牌：对家出的牌也去压
  if (target && targetSeat === partner && !f.finishes) {
    hits.push(hit('DONT_OVERTAKE', 'oppose', 0.6, '抢了对家的牌', 'overtakes the partner without going out'));
  }
  return disabledRules.size ? hits.filter((h) => !disabledRules.has(h.id)) : hits;
}

function typeCn(t: string): string {
  return ({ single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二', straight: '顺子', tube: '三连对', plate: '钢板' } as Record<string, string>)[t] ?? t;
}

