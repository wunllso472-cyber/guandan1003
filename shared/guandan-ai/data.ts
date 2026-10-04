// 掼蛋 AI 接入交接模块；与本目录中的相关模块一起复制。
import type { RuleLibrary } from './rules.js';
export const ruleLibrary = {
  "library_version": "1.0.0",
  "title": "掼蛋AI策略规则库",
  "source": {
    "file": "/Users/macforai/Downloads/7_掼蛋教材汇编-8888.pdf",
    "title": "江苏省掼蛋项目一线社会体育指导员再培训教材",
    "publisher": "江苏省社会体育管理中心",
    "date": "2017-10",
    "pdf_page_count": 60,
    "printed_page_offset": 4,
    "contributors": [
      "李旦生",
      "段绪林",
      "周高",
      "丁华"
    ]
  },
  "purpose": "供聊天AI或候选动作排序器使用的有条件策略知识，不包含完整合法牌型生成、特征提取、隐牌概率校准或搜索求解器。",
  "basis_legend": {
    "textbook_derived": "由教材明确观点概括并写成适用条件",
    "textbook_heuristic": "教材经验与招法，保留反例；非必然规则",
    "design_recommendation": "根据教材目标提出的实现/评价建议，非原文算法",
    "implementation_addition": "为正确处理输入、合法性、实体记牌和隐信息加入的实现约束"
  },
  "execution_contract": {
    "feature_provider": "调用方的规则引擎、状态分析器和候选模拟器提供注册特征；特征解释涉及估计时需附证据。",
    "condition_semantics": "all / any / not 可递归组合；谓词含 feature、op、value；op支持 eq、ne、gt、gte、lt、lte、in。",
    "missing_feature": "unknown；all中有false为false，无false但有unknown为unknown；any中有true为true，无true但有unknown为unknown；unknown不会自动命中规则。",
    "priority": "数字小者先检查。输入与合法性约束必须先满足；软策略优先级不是强制出牌指令。",
    "guidance": "自然语言策略目标，程序可用于解释或提示模型；若用于数值排序需另外定义评价特征、权重并校准。",
    "probability": "规则未提供本局胜率；教材统计缺少样本说明，不作为固定概率。",
    "information_scope": "自己的真实牌和公开历史；对家与敌家的隐牌只保留假设。",
    "input_schema": "局面输入.schema.json",
    "output_schema": "出牌建议输出.schema.json",
    "positive_input_gate": "rules.verified必须为true，级牌和关键桌面状态明确且无矛盾；未知不会视为已通过。",
    "positive_candidate_gate": "可执行候选必须明确 legal_validated=true；false和unknown都不可执行。",
    "ready_output_gate": "recommendation必须照录已验证的输入候选，action_id、实体牌和声明一致；不能由模型自行声称引擎已验证。"
  },
  "decision_order": [
    "validate_rules_and_state",
    "update_physical_card_ledger",
    "update_beliefs",
    "detect_phase_and_role",
    "compare_hand_partitions",
    "simulate_legal_candidates",
    "choose_team_payoff",
    "verify_and_explain"
  ],
  "phase_policy": {
    "source_pages": [
      11,
      12,
      13,
      14,
      43,
      44,
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54
    ],
    "design_recommendation": true,
    "opening": "角色和牌路尚未探明且没有明确清牌风险",
    "middle": "已有牌路证据，进入控牌、消耗和角色调整",
    "endgame": "有人出完、可一手出完或有较高把握仅剩一两手；以实际局面覆盖固定回合数",
    "early_endgame_watch_remaining_cards": 10,
    "threshold_note": "10张是建议的风险检查触发器，不是教材阶段阈值，不表示必然听牌。"
  },
  "strength_prior": {
    "basis": "textbook_heuristic",
    "printed_pages": [
      35,
      36,
      37
    ],
    "formula": "4 * bombs + top_route_hands - weak_hands",
    "bands": {
      "strong_min": 12,
      "middle_min": 6,
      "weak_below": 6
    },
    "notes": [
      "按同一合法且实体牌不重复的拆分计数。",
      "对级牌在教材中按1点弱近似。",
      "同类最大须含配牌重新核验；炸弹大小、回收和配合另行评估。",
      "不转换成获胜概率，不单独决定角色。"
    ]
  },
  "feature_registry": {
    "state.rules_verified": {
      "type": "boolean",
      "description": "规则配置已由用户或规则引擎确认",
      "missing_value": "unknown"
    },
    "state.inconsistent": {
      "type": "boolean",
      "description": "实体牌重复、余牌数、当前行动者或历史等存在冲突",
      "missing_value": "unknown"
    },
    "action.legal_validated": {
      "type": "boolean",
      "description": "候选动作的规则合法性已验证",
      "missing_value": "unknown"
    },
    "belief.uses_unrevealed_hand_as_fact": {
      "type": "boolean",
      "description": "把对家或对手未公开手牌当作已知事实",
      "missing_value": "unknown"
    },
    "observation.action_type": {
      "type": "string",
      "description": "观察到的动作类型",
      "missing_value": "unknown"
    },
    "observation.uses_wildcard": {
      "type": "boolean",
      "description": "本次公开出牌使用逢人配",
      "missing_value": "unknown"
    },
    "belief.claims_top_route": {
      "type": "boolean",
      "description": "把自家某牌型认定为同类最大",
      "missing_value": "unknown"
    },
    "state.strength_band": {
      "type": "string",
      "description": "结合炸弹、控制牌、手数与弱路的牌力初判",
      "missing_value": "unknown"
    },
    "state.attack_role_needs_review": {
      "type": "boolean",
      "description": "原主攻被阻击后已无较好的清牌能力或另一家形成更好机会",
      "missing_value": "unknown"
    },
    "state.current_winner_relation": {
      "type": "string",
      "description": "当前桌面最大牌的出牌者与自己的关系",
      "missing_value": "unknown"
    },
    "state.immediate_danger": {
      "type": "boolean",
      "description": "存在即时清牌或送听危险",
      "missing_value": "unknown"
    },
    "action.intends_feed_partner": {
      "type": "boolean",
      "description": "候选动作意图给搭档送牌或送听",
      "missing_value": "unknown"
    },
    "plan.has_small_straight": {
      "type": "boolean",
      "description": "组牌方案含小顺子",
      "missing_value": "unknown"
    },
    "plan.new_low_single_count": {
      "type": "number",
      "description": "该顺子方案产生的难处理小余单数量",
      "missing_value": "unknown"
    },
    "plan.has_full_house_attachment_choice": {
      "type": "boolean",
      "description": "同一三张主体有多种对子可带",
      "missing_value": "unknown"
    },
    "plan.can_keep_pair_gradient": {
      "type": "boolean",
      "description": "三带二附带对子分配可留下大小相差较大的对子",
      "missing_value": "unknown"
    },
    "state.role": {
      "type": "string",
      "description": "本方当前角色判断",
      "missing_value": "unknown"
    },
    "plan.has_small_special_group": {
      "type": "boolean",
      "description": "有小三连对或小钢板",
      "missing_value": "unknown"
    },
    "action.breaks_existing_group": {
      "type": "boolean",
      "description": "候选接牌会拆开原组合",
      "missing_value": "unknown"
    },
    "plan.has_bombs": {
      "type": "boolean",
      "description": "方案含炸弹",
      "missing_value": "unknown"
    },
    "action.has_recovery_plan": {
      "type": "boolean",
      "description": "走该牌路后有有据可查的回收计划",
      "missing_value": "unknown"
    },
    "action.hides_strength": {
      "type": "boolean",
      "description": "候选选择先走弱路保留优势",
      "missing_value": "unknown"
    },
    "state.single_route_weak": {
      "type": "boolean",
      "description": "单张路较弱或受贡还影响",
      "missing_value": "unknown"
    },
    "action.leads_pair": {
      "type": "boolean",
      "description": "候选为主动领出对子",
      "missing_value": "unknown"
    },
    "action.leads_special_group": {
      "type": "boolean",
      "description": "候选主动领出钢板或三连对",
      "missing_value": "unknown"
    },
    "state.opponent_repeatedly_sheds_on_route": {
      "type": "boolean",
      "description": "敌方在本方主打牌路中反复顺走牌",
      "missing_value": "unknown"
    },
    "state.partner_has_attack_opportunity": {
      "type": "boolean",
      "description": "公开证据支持搭档有主攻机会",
      "missing_value": "unknown"
    },
    "state.opponent_feed_threat": {
      "type": "boolean",
      "description": "存在敌方向其搭档送牌／送听的有据风险",
      "missing_value": "unknown"
    },
    "state.opponent_sprint_threat": {
      "type": "boolean",
      "description": "敌方有连续冲牌迹象",
      "missing_value": "unknown"
    },
    "action.intercepts_straight": {
      "type": "boolean",
      "description": "候选用于阻截敌方顺子",
      "missing_value": "unknown"
    },
    "action.uses_bomb": {
      "type": "boolean",
      "description": "候选使用炸弹",
      "missing_value": "unknown"
    },
    "state.upstream_can_feed_self": {
      "type": "boolean",
      "description": "上家出牌有机会让自己顺走所需牌路",
      "missing_value": "unknown"
    },
    "action.secures_team_first": {
      "type": "boolean",
      "description": "通过规则与搜索已验证该动作确保本方先出完",
      "missing_value": "unknown"
    },
    "state.verified_opponent_immediate_win": {
      "type": "boolean",
      "description": "已验证敌方有即时或接桥清牌威胁",
      "missing_value": "unknown"
    },
    "plan.has_verified_clear_chain": {
      "type": "boolean",
      "description": "现有出牌权和控制资源能支持所述清牌链",
      "missing_value": "unknown"
    },
    "plan.can_keep_low_tail": {
      "type": "boolean",
      "description": "可以把较小弱牌作为最后一手",
      "missing_value": "unknown"
    },
    "plan.needs_partner_bridge": {
      "type": "boolean",
      "description": "预计最后一手需要搭档送牌",
      "missing_value": "unknown"
    },
    "state.opponent_near_listen": {
      "type": "boolean",
      "description": "公开信息支持敌方可能只剩一两手",
      "missing_value": "unknown"
    },
    "plan.low_route_unrecoverable": {
      "type": "boolean",
      "description": "本方某弱路缺少回收能力",
      "missing_value": "unknown"
    },
    "action.uses_small_bomb": {
      "type": "boolean",
      "description": "候选使用相对场上炸弹较小的炸弹",
      "missing_value": "unknown"
    },
    "state.self_has_strong_bomb": {
      "type": "boolean",
      "description": "自己有相对强的炸弹",
      "missing_value": "unknown"
    },
    "plan.no_smooth_followup": {
      "type": "boolean",
      "description": "现在上手后的余牌仍不能顺畅走出",
      "missing_value": "unknown"
    },
    "plan.can_split_bomb_for_safe_group": {
      "type": "boolean",
      "description": "拆炸可形成能阻止敌方顺牌的合法组牌",
      "missing_value": "unknown"
    },
    "state.partner_cannot_bridge": {
      "type": "boolean",
      "description": "搭档已无法有效送听或已离场",
      "missing_value": "unknown"
    },
    "plan.shares_vulnerable_listen_route": {
      "type": "boolean",
      "description": "本方弱路与其可能听牌牌路相同",
      "missing_value": "unknown"
    },
    "plan.can_interfere_enemy_bridge": {
      "type": "boolean",
      "description": "保留结构可对敌方送听形成实际干扰",
      "missing_value": "unknown"
    },
    "state.threat_seat_remaining": {
      "type": "number",
      "description": "当前重点防守敌家的余牌张数",
      "missing_value": "unknown"
    },
    "plan.considers_initiative_transfer": {
      "type": "boolean",
      "description": "方案考虑尾牌与搭档接风",
      "missing_value": "unknown"
    },
    "observation.is_follow": {
      "type": "boolean",
      "description": "该公开出牌是被动接牌",
      "missing_value": "unknown"
    },
    "observation.rank_gap_pattern": {
      "type": "boolean",
      "description": "同一家已出牌型之间出现点数空隙或大跨度",
      "missing_value": "unknown"
    },
    "observation.multiple_straights": {
      "type": "boolean",
      "description": "同一家已出两手以上顺子",
      "missing_value": "unknown"
    },
    "observation.multiple_triples": {
      "type": "boolean",
      "description": "同一家已出多手三张或三带二",
      "missing_value": "unknown"
    },
    "observation.first_team_lead": {
      "type": "boolean",
      "description": "本队第一次主动领出",
      "missing_value": "unknown"
    },
    "observation.attack_signal_route": {
      "type": "boolean",
      "description": "领出小单、三带二、杂顺或中强尝试型特殊牌",
      "missing_value": "unknown"
    },
    "observation.support_signal_route": {
      "type": "boolean",
      "description": "领出对子或高单",
      "missing_value": "unknown"
    },
    "observation.first_follow_or_recovery": {
      "type": "boolean",
      "description": "出现首次跟牌或能观察到主动回收选择",
      "missing_value": "unknown"
    },
    "observation.style_evidence": {
      "type": "boolean",
      "description": "有多次出牌形成节省资源或主动压制的行为证据",
      "missing_value": "unknown"
    },
    "state.has_tribute_choice": {
      "type": "boolean",
      "description": "规则引擎给出多个合法并列进贡候选",
      "missing_value": "unknown"
    },
    "state.has_return_choice": {
      "type": "boolean",
      "description": "处于回贡阶段并有合法回贡候选",
      "missing_value": "unknown"
    }
  },
  "rule_count": 56,
  "rules": [
    {
      "id": "L01",
      "title": "确认实际规则",
      "scope": "global",
      "basis": "implementation_addition",
      "kind": "input_gate",
      "priority": 0,
      "condition": {
        "all": [
          {
            "feature": "state.rules_verified",
            "op": "eq",
            "value": false
          }
        ]
      },
      "guidance": {
        "prefer": "返回 needs_input；明确当前级牌、合法牌型、配牌、炸弹顺序、贡还、接风与收益。",
        "avoid": "把 2017 年教材等同于所有平台现行规则。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [],
        "pdf_pages": []
      }
    },
    {
      "id": "L02",
      "title": "先修复局面冲突",
      "scope": "global",
      "basis": "implementation_addition",
      "kind": "input_gate",
      "priority": 0,
      "condition": {
        "all": [
          {
            "feature": "state.inconsistent",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "返回 needs_input，列出具体冲突。",
        "avoid": "在矛盾局面中给可执行动作。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [],
        "pdf_pages": []
      }
    },
    {
      "id": "L03",
      "title": "仅执行经验证的合法候选",
      "scope": "global",
      "basis": "implementation_addition",
      "kind": "candidate_gate",
      "priority": 0,
      "condition": {
        "all": [
          {
            "feature": "action.legal_validated",
            "op": "eq",
            "value": false
          }
        ]
      },
      "guidance": {
        "prefer": "筛掉该候选；若没有经过验证的候选，返回 needs_legal_validation。",
        "avoid": "由自然语言口诀替代实体牌归属、压牌和配牌校验。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [],
        "pdf_pages": []
      }
    },
    {
      "id": "L04",
      "title": "遵守隐牌信息边界",
      "scope": "global",
      "basis": "implementation_addition",
      "kind": "belief_gate",
      "priority": 0,
      "condition": {
        "all": [
          {
            "feature": "belief.uses_unrevealed_hand_as_fact",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "改为有证据与反例的假设；只以自家手牌和公开信息决策。",
        "avoid": "借用未公开信息得出确定结果。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [],
        "pdf_pages": []
      }
    },
    {
      "id": "L05",
      "title": "不跟不是缺牌证明",
      "scope": "inference",
      "basis": "implementation_addition",
      "kind": "belief_update",
      "priority": 10,
      "condition": {
        "all": [
          {
            "feature": "observation.action_type",
            "op": "eq",
            "value": "pass"
          }
        ]
      },
      "guidance": {
        "prefer": "记录不跟及其位置、成本和可能目的，只软更新牌路倾向。",
        "avoid": "硬排除所有可以跟的牌、炸弹或配牌。"
      },
      "exceptions": [
        "有额外公开事实或计数确实排除时可作确定结论。"
      ],
      "source": {
        "printed_pages": [],
        "pdf_pages": []
      }
    },
    {
      "id": "L06",
      "title": "配牌按实体记账",
      "scope": "global",
      "basis": "implementation_addition",
      "kind": "state_update",
      "priority": 5,
      "condition": {
        "all": [
          {
            "feature": "observation.uses_wildcard",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "扣除真实花色点数的逢人配；另存代表牌及声明牌型。",
        "avoid": "把代表点数再作为另一张实体牌扣除。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [],
        "pdf_pages": []
      }
    },
    {
      "id": "L07",
      "title": "同类最大与不可阻挡分开",
      "scope": "inference",
      "basis": "implementation_addition",
      "kind": "belief_update",
      "priority": 10,
      "condition": {
        "all": [
          {
            "feature": "belief.claims_top_route",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "检查实体余量、对手余牌数、等大牌、可用配牌和炸弹风险；保留核验状态。",
        "avoid": "只凭级牌或王出过几张就断言必胜。"
      },
      "exceptions": [
        "牌型枚举只证明同类最大，仍需独立评估炸弹。"
      ],
      "source": {
        "printed_pages": [],
        "pdf_pages": []
      }
    },
    {
      "id": "T01",
      "title": "团队利益优先",
      "scope": "team",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 15,
      "condition": {
        "all": []
      },
      "guidance": {
        "prefer": "按实际比赛收益先争本方头游，兼顾名次组合；主攻与助攻协作。",
        "avoid": "只优化自己的名次、出牌张数或炸弹剩余数量。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [
          3,
          4,
          5,
          31,
          37,
          38
        ],
        "pdf_pages": [
          7,
          8,
          9,
          35,
          41,
          42
        ]
      }
    },
    {
      "id": "T02",
      "title": "强牌主攻弱牌助攻",
      "scope": "team",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 35,
      "condition": {
        "all": [
          {
            "feature": "state.strength_band",
            "op": "eq",
            "value": "weak"
          }
        ]
      },
      "guidance": {
        "prefer": "提高阻击敌家与帮助搭档送牌的优先级；中强牌是否主攻另行评估。",
        "avoid": "每副牌都执意争自己的头游。"
      },
      "exceptions": [
        "中局牌力转化后重新定位，不永久锁定弱牌角色。"
      ],
      "source": {
        "printed_pages": [
          35,
          36,
          37,
          38
        ],
        "pdf_pages": [
          39,
          40,
          41,
          42
        ]
      }
    },
    {
      "id": "T03",
      "title": "角色随消耗转换",
      "scope": "team",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 30,
      "condition": {
        "all": [
          {
            "feature": "state.attack_role_needs_review",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "根据新余牌与出牌权重估本方主攻，允许攻防角色转换。",
        "avoid": "继续向已无法冲刺的队友无意义投入资源。"
      },
      "exceptions": [
        "未公开手牌使判断不确定时保留两个角色假设。"
      ],
      "source": {
        "printed_pages": [
          5,
          38
        ],
        "pdf_pages": [
          9,
          42
        ]
      }
    },
    {
      "id": "T04",
      "title": "慎接对家领出",
      "scope": "team",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 35,
      "condition": {
        "all": [
          {
            "feature": "state.current_winner_relation",
            "op": "eq",
            "value": "partner"
          },
          {
            "feature": "state.immediate_danger",
            "op": "eq",
            "value": false
          }
        ]
      },
      "guidance": {
        "prefer": "把合法 PASS 与接转比较，优先保护队友原牌路和回收计划。",
        "avoid": "仅因为自己能压就打断队友。"
      },
      "exceptions": [
        "自己直接清牌、队友明确需要接转或接风协作、能改善团队胜机时可接。"
      ],
      "source": {
        "printed_pages": [
          11,
          18
        ],
        "pdf_pages": [
          15,
          22
        ]
      }
    },
    {
      "id": "T05",
      "title": "送牌先检查接收与阻截",
      "scope": "team",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 25,
      "condition": {
        "all": [
          {
            "feature": "action.intends_feed_partner",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "核对搭档可能牌路、座次和敌方截断能力；时机成熟才递。",
        "avoid": "认为小牌必然送给搭档。"
      },
      "exceptions": [
        "牌路只是低把握推测时比较其他出牌方案。"
      ],
      "source": {
        "printed_pages": [
          15,
          16,
          38
        ],
        "pdf_pages": [
          19,
          20,
          42
        ]
      }
    },
    {
      "id": "H01",
      "title": "多方案组牌",
      "scope": "grouping",
      "basis": "design_recommendation",
      "kind": "plan_review",
      "priority": 40,
      "condition": {
        "all": []
      },
      "guidance": {
        "prefer": "保留手数少、回收强、送牌灵活和残局安全的几类拆分；覆盖全部实体牌且不重复。",
        "avoid": "单纯最少手数或单纯最大炸弹唯一化组牌。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [
          3,
          4,
          6,
          8,
          23,
          35,
          36
        ],
        "pdf_pages": [
          7,
          8,
          10,
          12,
          27,
          39,
          40
        ]
      }
    },
    {
      "id": "H02",
      "title": "组小顺子检查余单",
      "scope": "grouping",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 45,
      "condition": {
        "all": [
          {
            "feature": "plan.has_small_straight",
            "op": "eq",
            "value": true
          },
          {
            "feature": "plan.new_low_single_count",
            "op": "gte",
            "value": 3
          }
        ]
      },
      "guidance": {
        "prefer": "主攻时比较不用该小顺子的完整方案，评估它是否真的减少弱路。",
        "avoid": "为少一手顺子制造更多难处理小单。"
      },
      "exceptions": [
        "助攻有明确传牌用途时教材允许例外；牌力和牌路仍须比较。"
      ],
      "source": {
        "printed_pages": [
          8
        ],
        "pdf_pages": [
          12
        ]
      }
    },
    {
      "id": "H03",
      "title": "三带二选择附带对子",
      "scope": "grouping",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 45,
      "condition": {
        "all": [
          {
            "feature": "plan.has_full_house_attachment_choice",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "考虑带走难处理对子，保留有回收或送牌用途的对子；三张主体决定三带二大小。",
        "avoid": "默认把最大对带走或把带对大小当压牌依据。"
      },
      "exceptions": [
        "为了尾牌、协防或搭档牌路，附带对子选择可能改变。"
      ],
      "source": {
        "printed_pages": [
          7,
          23
        ],
        "pdf_pages": [
          11,
          27
        ]
      }
    },
    {
      "id": "H04",
      "title": "保留大小梯度",
      "scope": "grouping",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 50,
      "condition": {
        "all": [
          {
            "feature": "plan.can_keep_pair_gradient",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较留下大小梯度后的对子回收链与留下相邻大对的后果。",
        "avoid": "忽视大对之间的回收关系。"
      },
      "exceptions": [
        "外面同路大牌已出、相邻大对可直接走时不必强求梯度。"
      ],
      "source": {
        "printed_pages": [
          23
        ],
        "pdf_pages": [
          27
        ]
      }
    },
    {
      "id": "H05",
      "title": "特殊牌型也是送牌资源",
      "scope": "grouping",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 45,
      "condition": {
        "all": [
          {
            "feature": "state.role",
            "op": "eq",
            "value": "support"
          },
          {
            "feature": "plan.has_small_special_group",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "保留或择机拆成搭档需要的小对子、三张；估计能多送几次。",
        "avoid": "在开局只为减少自家张数先走搭档难接的特殊牌型。"
      },
      "exceptions": [
        "自己已有真实冲刺机会或需逼炸／防止即时清牌时另行比较。"
      ],
      "source": {
        "printed_pages": [
          9
        ],
        "pdf_pages": [
          13
        ]
      }
    },
    {
      "id": "H06",
      "title": "每次拆接后重组",
      "scope": "grouping",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 30,
      "condition": {
        "all": [
          {
            "feature": "action.breaks_existing_group",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "重算余单、余对、手数、回收链与控制资源，连同阻击收益比较。",
        "avoid": "只看这次能压住，忽视拆接余单。"
      },
      "exceptions": [
        "避免即时败局或形成团队清牌链可值得付出结构代价。"
      ],
      "source": {
        "printed_pages": [
          6,
          7,
          23
        ],
        "pdf_pages": [
          10,
          11,
          27
        ]
      }
    },
    {
      "id": "H07",
      "title": "逢人配多用途比较",
      "scope": "grouping",
      "basis": "design_recommendation",
      "kind": "plan_review",
      "priority": 45,
      "condition": {
        "all": []
      },
      "guidance": {
        "prefer": "比较减少弱手、补控制牌、增强炸弹、改善送听尾牌等配法，按实际规则校验。",
        "avoid": "一律配成最大炸弹或永久固定第一次理牌结果。"
      },
      "exceptions": [],
      "source": {
        "printed_pages": [
          3,
          6,
          8,
          9
        ],
        "pdf_pages": [
          7,
          10,
          12,
          13
        ]
      }
    },
    {
      "id": "H08",
      "title": "炸弹按真实控制能力估值",
      "scope": "grouping",
      "basis": "design_recommendation",
      "kind": "plan_review",
      "priority": 40,
      "condition": {
        "all": [
          {
            "feature": "plan.has_bombs",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "区分小炸、大炸、能否取回有效出牌权以及需要护送的弱手。",
        "avoid": "只用炸弹数量判断强弱。"
      },
      "exceptions": [
        "教材计点可作初判，不能代替与未出炸弹的比较。"
      ],
      "source": {
        "printed_pages": [
          4,
          35,
          36,
          46,
          49
        ],
        "pdf_pages": [
          8,
          39,
          40,
          50,
          53
        ]
      }
    },
    {
      "id": "O01",
      "title": "开局走能出能收的优势路",
      "scope": "opening",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 50,
      "condition": {
        "all": [
          {
            "feature": "state.role",
            "op": "eq",
            "value": "attack"
          },
          {
            "feature": "action.has_recovery_plan",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较连续领出优势牌路、减少余手和控制对手的收益。",
        "avoid": "出完该路优势后没有回收手段。"
      },
      "exceptions": [
        "敌方在该路同样能持续顺牌或后续弱路暴露时要调整。"
      ],
      "source": {
        "printed_pages": [
          11
        ],
        "pdf_pages": [
          15
        ]
      }
    },
    {
      "id": "O02",
      "title": "藏优有前提",
      "scope": "opening",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 50,
      "condition": {
        "all": [
          {
            "feature": "action.hides_strength",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "要求有足够上手资源，且重新上手后能形成顺畅的冲牌／清牌方案。",
        "avoid": "重新上手仍有多手难处理弱路时机械藏优。"
      },
      "exceptions": [
        "敌方即时冲刺或已耗尽关键资源时不能等。"
      ],
      "source": {
        "printed_pages": [
          12
        ],
        "pdf_pages": [
          16
        ]
      }
    },
    {
      "id": "O03",
      "title": "对子试探",
      "scope": "opening",
      "basis": "textbook_heuristic",
      "kind": "soft_preference",
      "priority": 60,
      "condition": {
        "all": [
          {
            "feature": "state.single_route_weak",
            "op": "eq",
            "value": true
          },
          {
            "feature": "action.leads_pair",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "用对子试探搭档和敌方牌路，保留对强弱信号的后续校验。",
        "avoid": "把一次首发对子定为永远弱牌。"
      },
      "exceptions": [
        "对子多且有可靠回收能力的强牌也可能首发对子。"
      ],
      "source": {
        "printed_pages": [
          7,
          12
        ],
        "pdf_pages": [
          11,
          16
        ]
      }
    },
    {
      "id": "O04",
      "title": "助攻首发特殊牌慎重",
      "scope": "opening",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 55,
      "condition": {
        "all": [
          {
            "feature": "state.role",
            "op": "eq",
            "value": "support"
          },
          {
            "feature": "action.leads_special_group",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较搭档能否接到、对手能否接到、该结构后续送牌价值。",
        "avoid": "用一手对搭档无帮助的出牌提前暴露和耗尽送牌资源。"
      },
      "exceptions": [
        "需要真实逼炸、防一手清牌或角色转为主攻时可出。"
      ],
      "source": {
        "printed_pages": [
          9
        ],
        "pdf_pages": [
          13
        ]
      }
    },
    {
      "id": "M01",
      "title": "对手持续顺牌就调整牌路",
      "scope": "middle",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 35,
      "condition": {
        "all": [
          {
            "feature": "state.opponent_repeatedly_sheds_on_route",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "考虑换牌路或有效封顶，使其多花一次出牌权。",
        "avoid": "惯性重复同一牌路帮助敌方清牌。"
      },
      "exceptions": [
        "该路可直接确保本方头游时仍优先兑现胜机。"
      ],
      "source": {
        "printed_pages": [
          13
        ],
        "pdf_pages": [
          17
        ]
      }
    },
    {
      "id": "M02",
      "title": "主攻保留机会，助攻提高卡位",
      "scope": "middle",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 30,
      "condition": {
        "all": [
          {
            "feature": "state.role",
            "op": "eq",
            "value": "support"
          },
          {
            "feature": "state.partner_has_attack_opportunity",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "提高阻止下家垫牌、阻截上家送牌和为搭档取权的优先级。",
        "avoid": "为垫自己一手弱牌放过敌方关键一手。"
      },
      "exceptions": [
        "自己已形成更强清牌链时重新判断角色。"
      ],
      "source": {
        "printed_pages": [
          21,
          37,
          38
        ],
        "pdf_pages": [
          25,
          41,
          42
        ]
      }
    },
    {
      "id": "M03",
      "title": "堵截敌方传牌",
      "scope": "middle",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 20,
      "condition": {
        "all": [
          {
            "feature": "state.opponent_feed_threat",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "优先比较能切断传递的有效候选，连同敌方后续回收考虑。",
        "avoid": "在对手接桥即可清牌时只贪自己的垫牌。"
      },
      "exceptions": [
        "能够立即保障本方头游或由搭档更低成本稳定阻截时可另选。"
      ],
      "source": {
        "printed_pages": [
          18,
          21
        ],
        "pdf_pages": [
          22,
          25
        ]
      }
    },
    {
      "id": "M04",
      "title": "阻击冲刺优先有效性",
      "scope": "middle",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 20,
      "condition": {
        "all": [
          {
            "feature": "state.opponent_sprint_threat",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "找让冲刺者至少卡住一手的动作，再在有效动作里降低消耗。",
        "avoid": "用没有改变对方清牌链的小跟牌做无效阻击。"
      },
      "exceptions": [
        "未知牌导致是否有效不确定时保留多个情境比较。"
      ],
      "source": {
        "printed_pages": [
          18,
          22
        ],
        "pdf_pages": [
          22,
          26
        ]
      }
    },
    {
      "id": "M05",
      "title": "封顺子时比较封顶",
      "scope": "middle",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 35,
      "condition": {
        "all": [
          {
            "feature": "action.intercepts_straight",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较最大同类顺子与较小接法的差异；封顶通常能使对方付出炸弹代价。",
        "avoid": "省下一点顺子点数后反被对方同类封顶，迫使己方额外开炸。"
      },
      "exceptions": [
        "接搭档桥、减少自己的孤张或封顶也无战略作用时不用机械封顶。"
      ],
      "source": {
        "printed_pages": [
          22,
          34
        ],
        "pdf_pages": [
          26,
          38
        ]
      }
    },
    {
      "id": "M06",
      "title": "区分逼炸与诱炸",
      "scope": "middle",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 30,
      "condition": {
        "all": [
          {
            "feature": "action.uses_bomb",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "问开炸能否获得有效出牌权、截断清牌、保护主攻或换掉敌方关键资源。",
        "avoid": "对每次可疑逼炸都必炸，或为了省炸一概不炸。"
      },
      "exceptions": [
        "即时败局可被阻止时，提高必要开炸的优先级。"
      ],
      "source": {
        "printed_pages": [
          22,
          23,
          41,
          42
        ],
        "pdf_pages": [
          26,
          27,
          45,
          46
        ]
      }
    },
    {
      "id": "M07",
      "title": "上家可垫也要检查清牌风险",
      "scope": "middle",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 30,
      "condition": {
        "all": [
          {
            "feature": "state.upstream_can_feed_self",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "在顺牌收益之外核对上家的余手和炸弹，检查放行一手是否让其先头游。",
        "avoid": "只等自己喜欢的牌路而连续放过敌方冲刺。"
      },
      "exceptions": [
        "上家无即时危险且有可靠后续控制时可等待。"
      ],
      "source": {
        "printed_pages": [
          13,
          18
        ],
        "pdf_pages": [
          17,
          22
        ]
      }
    },
    {
      "id": "E01",
      "title": "优先落实已经验证的本方头游",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 10,
      "condition": {
        "all": [
          {
            "feature": "action.secures_team_first",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "优先兑现；再比较相同头游保障下的队友名次和留风。",
        "avoid": "为了留大牌尾、少用炸弹而失去已验证头游。"
      },
      "exceptions": [
        "仅估计有机会而非已验证时，应继续风险比较。"
      ],
      "source": {
        "printed_pages": [
          31,
          43
        ],
        "pdf_pages": [
          35,
          47
        ]
      }
    },
    {
      "id": "E02",
      "title": "不能放过可阻止的即时败局",
      "scope": "endgame",
      "basis": "design_recommendation",
      "kind": "soft_preference",
      "priority": 15,
      "condition": {
        "all": [
          {
            "feature": "state.verified_opponent_immediate_win",
            "op": "eq",
            "value": true
          },
          {
            "feature": "action.secures_team_first",
            "op": "eq",
            "value": false
          }
        ]
      },
      "guidance": {
        "prefer": "对比所有能有效阻止该威胁的动作；必要时付出炸弹或拆牌成本。",
        "avoid": "继续固定节约计划或等待理想牌路。"
      },
      "exceptions": [
        "没有候选能阻止时转为降低比赛损失；威胁只是推测则保留情境。"
      ],
      "source": {
        "printed_pages": [
          14,
          18,
          21,
          46,
          47
        ],
        "pdf_pages": [
          18,
          22,
          25,
          50,
          51
        ]
      }
    },
    {
      "id": "E03",
      "title": "小牌留尾需要清牌链",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 25,
      "condition": {
        "all": [
          {
            "feature": "plan.has_verified_clear_chain",
            "op": "eq",
            "value": true
          },
          {
            "feature": "plan.can_keep_low_tail",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较先出稍大弱牌对下家垫牌的限制，最后用控制权送走最小尾牌。",
        "avoid": "从小到大固定出牌，或无回收能力时强留最小尾牌。"
      },
      "exceptions": [
        "想顺走较大中牌、上家控制较软、需搭档送听时顺序可相反。"
      ],
      "source": {
        "printed_pages": [
          43,
          44,
          45,
          46
        ],
        "pdf_pages": [
          47,
          48,
          49,
          50
        ]
      }
    },
    {
      "id": "E04",
      "title": "听牌尾牌要可送达",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 25,
      "condition": {
        "all": [
          {
            "feature": "plan.needs_partner_bridge",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "留下搭档能送、自己能接且敌方不易截断的牌路；常需留下较大尾牌。",
        "avoid": "不顾送桥能力硬把最小单牌留下。"
      },
      "exceptions": [
        "搭档无法送听时转向协防或自家独立闯关方案。"
      ],
      "source": {
        "printed_pages": [
          44,
          48,
          51
        ],
        "pdf_pages": [
          48,
          52,
          55
        ]
      }
    },
    {
      "id": "E05",
      "title": "对手接近听牌时比较先逼炸",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 20,
      "condition": {
        "all": [
          {
            "feature": "state.opponent_near_listen",
            "op": "eq",
            "value": true
          },
          {
            "feature": "plan.low_route_unrecoverable",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较先出同类最大牌逼炸，保留好送的尾牌，减少敌方顺走关键一手的空间。",
        "avoid": "先开不能回收的弱路让敌方轻松进入听牌。"
      },
      "exceptions": [
        "敌方还多手且炸弹资源充裕，保留大牌听牌可能更合适。"
      ],
      "source": {
        "printed_pages": [
          46,
          47,
          48,
          49,
          50
        ],
        "pdf_pages": [
          50,
          51,
          52,
          53,
          54
        ]
      }
    },
    {
      "id": "E06",
      "title": "小炸要考虑及时兑现",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 25,
      "condition": {
        "all": [
          {
            "feature": "action.uses_small_bomb",
            "op": "eq",
            "value": true
          },
          {
            "feature": "state.opponent_near_listen",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较现在争权、逼掉大炸或为搭档消耗资源的价值，包括主动空掷的后续。",
        "avoid": "小炸一直保留到被大炸彻底封死。"
      },
      "exceptions": [
        "开炸后没有有利后续或属于诱炸时可保留。"
      ],
      "source": {
        "printed_pages": [
          46,
          49
        ],
        "pdf_pages": [
          50,
          53
        ]
      }
    },
    {
      "id": "E07",
      "title": "大炸不等于立刻冲刺",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 35,
      "condition": {
        "all": [
          {
            "feature": "state.self_has_strong_bomb",
            "op": "eq",
            "value": true
          },
          {
            "feature": "plan.no_smooth_followup",
            "op": "eq",
            "value": true
          },
          {
            "feature": "state.immediate_danger",
            "op": "eq",
            "value": false
          }
        ]
      },
      "guidance": {
        "prefer": "保留大炸等待合适桥路，持续监测敌方冲刺风险。",
        "avoid": "为了开炸而开炸，或危险已出现仍机械沉住气。"
      },
      "exceptions": [
        "自己有可行抢头游链或需阻止敌方即时清牌时另行选择。"
      ],
      "source": {
        "printed_pages": [
          46
        ],
        "pdf_pages": [
          50
        ]
      }
    },
    {
      "id": "E08",
      "title": "必要时评估拆炸逼炸",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 30,
      "condition": {
        "all": [
          {
            "feature": "plan.can_split_bomb_for_safe_group",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较拆炸组牌后的尾牌、配牌与听牌机会，和保炸方案的团队收益。",
        "avoid": "把炸弹当成永远不能拆的结构。"
      },
      "exceptions": [
        "同花顺／级牌等牌型与配牌须按平台规则验证；没有后续收益就不拆。"
      ],
      "source": {
        "printed_pages": [
          50
        ],
        "pdf_pages": [
          54
        ]
      }
    },
    {
      "id": "E09",
      "title": "协防保留不同牌路",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 25,
      "condition": {
        "all": [
          {
            "feature": "state.partner_cannot_bridge",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较本方两家剩余牌路覆盖，争取能分别阻拦敌方不同牌型。",
        "avoid": "本方两家都只剩同一条弱路。"
      },
      "exceptions": [
        "已有可确保头游的独立清牌链优先兑现。"
      ],
      "source": {
        "printed_pages": [
          50,
          51
        ],
        "pdf_pages": [
          54,
          55
        ]
      }
    },
    {
      "id": "E10",
      "title": "提前弥补听牌同路弱点",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 20,
      "condition": {
        "all": [
          {
            "feature": "state.opponent_near_listen",
            "op": "eq",
            "value": true
          },
          {
            "feature": "plan.shares_vulnerable_listen_route",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "仍有机会时先处理这条弱路，比较主动封盖取权后的处理顺序。",
        "avoid": "等敌方听单张或顺子后被迫送其头游。"
      },
      "exceptions": [
        "敌方听牌路是低把握推测时须权衡处理代价。"
      ],
      "source": {
        "printed_pages": [
          52,
          53
        ],
        "pdf_pages": [
          56,
          57
        ]
      }
    },
    {
      "id": "E11",
      "title": "听牌干扰保留结构",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 30,
      "condition": {
        "all": [
          {
            "feature": "plan.can_interfere_enemy_bridge",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较不顺牌、暂留相同牌数或转型后的拦截收益，必要时保留干扰态势。",
        "avoid": "看到可顺的小牌就跟掉，解除原本有效的干扰。"
      },
      "exceptions": [
        "干扰不能压过自己的真实胜机；上家听牌时留不同路可能更利于对家送听。"
      ],
      "source": {
        "printed_pages": [
          53,
          54
        ],
        "pdf_pages": [
          57,
          58
        ]
      }
    },
    {
      "id": "E12",
      "title": "余四张必须看结构",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 20,
      "condition": {
        "all": [
          {
            "feature": "state.threat_seat_remaining",
            "op": "eq",
            "value": 4
          }
        ]
      },
      "guidance": {
        "prefer": "枚举炸弹、三加一、两对、对加双单、四单等；检查下一次送牌能否使其清牌。",
        "avoid": "把“牌不打四”当作必过指令。"
      },
      "exceptions": [
        "自己的清牌链、空保火、对方传牌能力和炸弹大小都可能要求打四。"
      ],
      "source": {
        "printed_pages": [
          19,
          20
        ],
        "pdf_pages": [
          23,
          24
        ]
      }
    },
    {
      "id": "E13",
      "title": "六张警惕整手特殊牌",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 20,
      "condition": {
        "all": [
          {
            "feature": "state.threat_seat_remaining",
            "op": "eq",
            "value": 6
          }
        ]
      },
      "guidance": {
        "prefer": "检查六张可能为一手钢板、三连对或六炸，以及其他合法拆分。",
        "avoid": "因为其六张就认为至少需要两手。"
      },
      "exceptions": [
        "可能是一手不等于已知是一手；历史和牌池用于更新假设。"
      ],
      "source": {
        "printed_pages": [
          32
        ],
        "pdf_pages": [
          36
        ]
      }
    },
    {
      "id": "E14",
      "title": "七八九十张作为风险提示",
      "scope": "endgame",
      "basis": "textbook_heuristic",
      "kind": "soft_preference",
      "priority": 25,
      "condition": {
        "all": [
          {
            "feature": "state.threat_seat_remaining",
            "op": "gte",
            "value": 7
          },
          {
            "feature": "state.threat_seat_remaining",
            "op": "lte",
            "value": 10
          }
        ]
      },
      "guidance": {
        "prefer": "枚举合法剩余结构并检查敌方能否顺一手后空保火或听牌；比较组牌逼炸。",
        "avoid": "固定“打九不打十”或“逢七逢八必出组牌”。"
      },
      "exceptions": [
        "数字拆分只是假设；对子、组牌、炸弹与配牌的实际可组性必须核对。"
      ],
      "source": {
        "printed_pages": [
          20,
          50
        ],
        "pdf_pages": [
          24,
          54
        ]
      }
    },
    {
      "id": "E15",
      "title": "头游优先于留风",
      "scope": "endgame",
      "basis": "textbook_derived",
      "kind": "plan_review",
      "priority": 20,
      "condition": {
        "all": [
          {
            "feature": "plan.considers_initiative_transfer",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "先确保或提高本方头游，再按实际接风规则评估搭档下一次领出。",
        "avoid": "为了大牌结尾强行牺牲本方头游机会。"
      },
      "exceptions": [
        "教材讨论对门接风，平台若不同需重算；借风还要比较双方炸弹大小。"
      ],
      "source": {
        "printed_pages": [
          14,
          15,
          43
        ],
        "pdf_pages": [
          18,
          19,
          47
        ]
      }
    },
    {
      "id": "I01",
      "title": "主动出牌与被动拆接分开看",
      "scope": "inference",
      "basis": "textbook_derived",
      "kind": "belief_update",
      "priority": 50,
      "condition": {
        "all": [
          {
            "feature": "observation.is_follow",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "提高对拆接余单的关注，记录可能产生余单的点数范围。",
        "avoid": "把接出的顺子、三连对当作起手固定牌型。"
      },
      "exceptions": [
        "若无法确认拆牌，保留原生组合与拆接组合两个假设。"
      ],
      "source": {
        "printed_pages": [
          6,
          7
        ],
        "pdf_pages": [
          10,
          11
        ]
      }
    },
    {
      "id": "I02",
      "title": "用已出组合的空隙推测牌路",
      "scope": "inference",
      "basis": "textbook_heuristic",
      "kind": "belief_update",
      "priority": 55,
      "condition": {
        "all": [
          {
            "feature": "observation.rank_gap_pattern",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "保留空隙单牌、连接组牌、炸弹等可能，并据其余牌数筛查。",
        "avoid": "仅凭跨度认定某一家手里必有具体牌。"
      },
      "exceptions": [
        "逢人配、不最优组牌与刻意变形都会破坏这种经验推断。"
      ],
      "source": {
        "printed_pages": [
          6,
          7,
          8
        ],
        "pdf_pages": [
          10,
          11,
          12
        ]
      }
    },
    {
      "id": "I03",
      "title": "顺子重叠推断只作经验",
      "scope": "inference",
      "basis": "textbook_heuristic",
      "kind": "belief_update",
      "priority": 55,
      "condition": {
        "all": [
          {
            "feature": "observation.multiple_straights",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "记录重叠区、非重叠区和空隙，辅助对子／三张／炸弹假设。",
        "avoid": "硬认定出过顺子就不可能有对子或三带二。"
      },
      "exceptions": [
        "拆炸、配牌和非最优组合均可能产生反例。"
      ],
      "source": {
        "printed_pages": [
          8,
          9
        ],
        "pdf_pages": [
          12,
          13
        ]
      }
    },
    {
      "id": "I04",
      "title": "三张间隔辅助判断余手",
      "scope": "inference",
      "basis": "textbook_heuristic",
      "kind": "belief_update",
      "priority": 55,
      "condition": {
        "all": [
          {
            "feature": "observation.multiple_triples",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "小间隔时考虑余单余对负担；大跨度时警惕中段已组成连接牌。",
        "avoid": "将“多三带二＝弱牌”或“大跨度＝必强牌”作为定论。"
      },
      "exceptions": [
        "炸弹多、配牌充足或刻意拆牌可能改变含义。"
      ],
      "source": {
        "printed_pages": [
          7,
          8
        ],
        "pdf_pages": [
          11,
          12
        ]
      }
    },
    {
      "id": "I05",
      "title": "首攻强信号",
      "scope": "inference",
      "basis": "textbook_heuristic",
      "kind": "belief_update",
      "priority": 60,
      "condition": {
        "all": [
          {
            "feature": "observation.first_team_lead",
            "op": "eq",
            "value": true
          },
          {
            "feature": "observation.attack_signal_route",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "适度提高主攻意图假设，观察是否回收和后续资源；特殊牌属于较弱的尝试信号。",
        "avoid": "把首出牌型当成对家手牌强弱的确定证明。"
      },
      "exceptions": [
        "不同团队习惯、藏优、诱敌、教材各章节侧重点不同均会改变信号。"
      ],
      "source": {
        "printed_pages": [
          39
        ],
        "pdf_pages": [
          43
        ]
      }
    },
    {
      "id": "I06",
      "title": "首攻对子高单的反例",
      "scope": "inference",
      "basis": "textbook_heuristic",
      "kind": "belief_update",
      "priority": 60,
      "condition": {
        "all": [
          {
            "feature": "observation.first_team_lead",
            "op": "eq",
            "value": true
          },
          {
            "feature": "observation.support_signal_route",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "保留中弱牌助攻意图，但检查是否对子多、单路强且有回收能力。",
        "avoid": "见对子／高单就永久把队友定为助攻。"
      },
      "exceptions": [
        "强牌的强路、多路首出就是教材明确的例外。"
      ],
      "source": {
        "printed_pages": [
          12,
          39
        ],
        "pdf_pages": [
          16,
          43
        ]
      }
    },
    {
      "id": "I07",
      "title": "首跟与回收校验角色",
      "scope": "inference",
      "basis": "textbook_heuristic",
      "kind": "belief_update",
      "priority": 60,
      "condition": {
        "all": [
          {
            "feature": "observation.first_follow_or_recovery",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "结合是否小跟、大牌卡位、能收却放行，软更新角色与牌路意图。",
        "avoid": "只从一张 7 或 Q 推出确定角色。"
      },
      "exceptions": [
        "角色可能变换，成本和对方出牌意图也影响跟牌。"
      ],
      "source": {
        "printed_pages": [
          39,
          40
        ],
        "pdf_pages": [
          43,
          44
        ]
      }
    },
    {
      "id": "I08",
      "title": "风格作为动态先验",
      "scope": "inference",
      "basis": "textbook_heuristic",
      "kind": "belief_update",
      "priority": 65,
      "condition": {
        "all": [
          {
            "feature": "observation.style_evidence",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "记录倾向与反例，识别可能等待桥路、佯攻、诱炸或抢头游的风险。",
        "avoid": "用性格标签预测每一步，或把对手风格当已知隐牌。"
      },
      "exceptions": [
        "牌力和阶段变化会改变风格；优先当前公开事实。"
      ],
      "source": {
        "printed_pages": [
          40,
          41,
          42
        ],
        "pdf_pages": [
          44,
          45,
          46
        ]
      }
    },
    {
      "id": "R01",
      "title": "贡牌并列时考虑花色",
      "scope": "tribute",
      "basis": "textbook_derived",
      "kind": "soft_preference",
      "priority": 50,
      "condition": {
        "all": [
          {
            "feature": "state.has_tribute_choice",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "贡给敌方时比较同花相邻牌在本家被占用情况，以降低补同花顺机会。",
        "avoid": "忽视合法最大牌范围，或任意贡低牌。"
      },
      "exceptions": [
        "贡给搭档时考虑有利组合；未公开对方手牌使花色判断只属推测。"
      ],
      "source": {
        "printed_pages": [
          16,
          17
        ],
        "pdf_pages": [
          20,
          21
        ]
      }
    },
    {
      "id": "R02",
      "title": "回贡同时保护自己与限制敌方",
      "scope": "tribute",
      "basis": "textbook_heuristic",
      "kind": "soft_preference",
      "priority": 50,
      "condition": {
        "all": [
          {
            "feature": "state.has_return_choice",
            "op": "eq",
            "value": true
          }
        ]
      },
      "guidance": {
        "prefer": "比较自家拆分代价、对方可能补缺／成炸及花色；先以规则引擎限定可回牌。",
        "avoid": "把教材回贡统计直接当本局概率，或只按最小单牌固定回牌。"
      },
      "exceptions": [
        "回给搭档时目标反向；不能推断对方确切缺牌。"
      ],
      "source": {
        "printed_pages": [
          17
        ],
        "pdf_pages": [
          21
        ]
      }
    }
  ]
} satisfies RuleLibrary;
