// 掼蛋 AI 接入交接模块；与本目录中的相关模块一起复制。
export interface FeatureValues {
  /** 规则配置已由用户或规则引擎确认 */
  "state.rules_verified": boolean;
  /** 实体牌重复、余牌数、当前行动者或历史等存在冲突 */
  "state.inconsistent": boolean;
  /** 候选动作的规则合法性已验证 */
  "action.legal_validated": boolean;
  /** 把对家或对手未公开手牌当作已知事实 */
  "belief.uses_unrevealed_hand_as_fact": boolean;
  /** 观察到的动作类型 */
  "observation.action_type": string;
  /** 本次公开出牌使用逢人配 */
  "observation.uses_wildcard": boolean;
  /** 把自家某牌型认定为同类最大 */
  "belief.claims_top_route": boolean;
  /** 结合炸弹、控制牌、手数与弱路的牌力初判 */
  "state.strength_band": string;
  /** 原主攻被阻击后已无较好的清牌能力或另一家形成更好机会 */
  "state.attack_role_needs_review": boolean;
  /** 当前桌面最大牌的出牌者与自己的关系 */
  "state.current_winner_relation": string;
  /** 存在即时清牌或送听危险 */
  "state.immediate_danger": boolean;
  /** 候选动作意图给搭档送牌或送听 */
  "action.intends_feed_partner": boolean;
  /** 组牌方案含小顺子 */
  "plan.has_small_straight": boolean;
  /** 该顺子方案产生的难处理小余单数量 */
  "plan.new_low_single_count": number;
  /** 同一三张主体有多种对子可带 */
  "plan.has_full_house_attachment_choice": boolean;
  /** 三带二附带对子分配可留下大小相差较大的对子 */
  "plan.can_keep_pair_gradient": boolean;
  /** 本方当前角色判断 */
  "state.role": string;
  /** 有小三连对或小钢板 */
  "plan.has_small_special_group": boolean;
  /** 候选接牌会拆开原组合 */
  "action.breaks_existing_group": boolean;
  /** 方案含炸弹 */
  "plan.has_bombs": boolean;
  /** 走该牌路后有有据可查的回收计划 */
  "action.has_recovery_plan": boolean;
  /** 候选选择先走弱路保留优势 */
  "action.hides_strength": boolean;
  /** 单张路较弱或受贡还影响 */
  "state.single_route_weak": boolean;
  /** 候选为主动领出对子 */
  "action.leads_pair": boolean;
  /** 候选主动领出钢板或三连对 */
  "action.leads_special_group": boolean;
  /** 敌方在本方主打牌路中反复顺走牌 */
  "state.opponent_repeatedly_sheds_on_route": boolean;
  /** 公开证据支持搭档有主攻机会 */
  "state.partner_has_attack_opportunity": boolean;
  /** 存在敌方向其搭档送牌／送听的有据风险 */
  "state.opponent_feed_threat": boolean;
  /** 敌方有连续冲牌迹象 */
  "state.opponent_sprint_threat": boolean;
  /** 候选用于阻截敌方顺子 */
  "action.intercepts_straight": boolean;
  /** 候选使用炸弹 */
  "action.uses_bomb": boolean;
  /** 上家出牌有机会让自己顺走所需牌路 */
  "state.upstream_can_feed_self": boolean;
  /** 通过规则与搜索已验证该动作确保本方先出完 */
  "action.secures_team_first": boolean;
  /** 已验证敌方有即时或接桥清牌威胁 */
  "state.verified_opponent_immediate_win": boolean;
  /** 现有出牌权和控制资源能支持所述清牌链 */
  "plan.has_verified_clear_chain": boolean;
  /** 可以把较小弱牌作为最后一手 */
  "plan.can_keep_low_tail": boolean;
  /** 预计最后一手需要搭档送牌 */
  "plan.needs_partner_bridge": boolean;
  /** 公开信息支持敌方可能只剩一两手 */
  "state.opponent_near_listen": boolean;
  /** 本方某弱路缺少回收能力 */
  "plan.low_route_unrecoverable": boolean;
  /** 候选使用相对场上炸弹较小的炸弹 */
  "action.uses_small_bomb": boolean;
  /** 自己有相对强的炸弹 */
  "state.self_has_strong_bomb": boolean;
  /** 现在上手后的余牌仍不能顺畅走出 */
  "plan.no_smooth_followup": boolean;
  /** 拆炸可形成能阻止敌方顺牌的合法组牌 */
  "plan.can_split_bomb_for_safe_group": boolean;
  /** 搭档已无法有效送听或已离场 */
  "state.partner_cannot_bridge": boolean;
  /** 本方弱路与其可能听牌牌路相同 */
  "plan.shares_vulnerable_listen_route": boolean;
  /** 保留结构可对敌方送听形成实际干扰 */
  "plan.can_interfere_enemy_bridge": boolean;
  /** 当前重点防守敌家的余牌张数 */
  "state.threat_seat_remaining": number;
  /** 方案考虑尾牌与搭档接风 */
  "plan.considers_initiative_transfer": boolean;
  /** 该公开出牌是被动接牌 */
  "observation.is_follow": boolean;
  /** 同一家已出牌型之间出现点数空隙或大跨度 */
  "observation.rank_gap_pattern": boolean;
  /** 同一家已出两手以上顺子 */
  "observation.multiple_straights": boolean;
  /** 同一家已出多手三张或三带二 */
  "observation.multiple_triples": boolean;
  /** 本队第一次主动领出 */
  "observation.first_team_lead": boolean;
  /** 领出小单、三带二、杂顺或中强尝试型特殊牌 */
  "observation.attack_signal_route": boolean;
  /** 领出对子或高单 */
  "observation.support_signal_route": boolean;
  /** 出现首次跟牌或能观察到主动回收选择 */
  "observation.first_follow_or_recovery": boolean;
  /** 有多次出牌形成节省资源或主动压制的行为证据 */
  "observation.style_evidence": boolean;
  /** 规则引擎给出多个合法并列进贡候选 */
  "state.has_tribute_choice": boolean;
  /** 处于回贡阶段并有合法回贡候选 */
  "state.has_return_choice": boolean;
}
export type FeatureName = keyof FeatureValues;
export type FeatureContext = { [K in FeatureName]?: FeatureValues[K] | null };
