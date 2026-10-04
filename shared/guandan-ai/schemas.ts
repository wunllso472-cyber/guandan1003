// 掼蛋 AI 接入交接模块；与本目录中的相关模块一起复制。
export const inputSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.invalid/guandan/state-input.schema.json",
  "title": "掼蛋局面输入",
  "type": "object",
  "required": [
    "rules",
    "self_id",
    "partner_id",
    "turn_order",
    "current_actor",
    "seats",
    "self_hand",
    "history_complete",
    "history",
    "known_card_transfers",
    "current_trick",
    "phase_hint",
    "legal_actions",
    "engine_evaluation"
  ],
  "properties": {
    "rules": {
      "type": "object",
      "required": [
        "profile_id",
        "verified",
        "level_rank",
        "deck_count",
        "details"
      ],
      "properties": {
        "profile_id": {
          "type": [
            "string",
            "null"
          ]
        },
        "verified": {
          "type": "boolean"
        },
        "level_rank": {
          "enum": [
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "10",
            "J",
            "Q",
            "K",
            "A",
            null
          ]
        },
        "deck_count": {
          "const": 2
        },
        "details": {
          "type": "object",
          "description": "实际规则配置；至少明确大小序、允许牌型、配牌、炸弹次序、贡还、接风、收益。"
        }
      },
      "additionalProperties": false
    },
    "self_id": {
      "enum": [
        "P0",
        "P1",
        "P2",
        "P3"
      ]
    },
    "partner_id": {
      "enum": [
        "P0",
        "P1",
        "P2",
        "P3"
      ]
    },
    "turn_order": {
      "type": "array",
      "items": {
        "enum": [
          "P0",
          "P1",
          "P2",
          "P3"
        ]
      },
      "minItems": 4,
      "maxItems": 4,
      "uniqueItems": true
    },
    "current_actor": {
      "enum": [
        "P0",
        "P1",
        "P2",
        "P3",
        null
      ]
    },
    "seats": {
      "type": "array",
      "minItems": 4,
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": [
          "player_id",
          "remaining_cards",
          "finished_rank"
        ],
        "properties": {
          "player_id": {
            "enum": [
              "P0",
              "P1",
              "P2",
              "P3"
            ]
          },
          "remaining_cards": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 27
          },
          "finished_rank": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1,
            "maximum": 4
          }
        },
        "additionalProperties": false
      }
    },
    "self_hand": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
        "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
      },
      "uniqueItems": true,
      "maxItems": 108
    },
    "history_complete": {
      "type": "boolean"
    },
    "history": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "event_id",
          "trick_id",
          "player_id",
          "action_type",
          "cards",
          "declared",
          "remaining_after"
        ],
        "properties": {
          "event_id": {
            "type": "string"
          },
          "trick_id": {
            "type": "string"
          },
          "player_id": {
            "enum": [
              "P0",
              "P1",
              "P2",
              "P3"
            ]
          },
          "action_type": {
            "enum": [
              "play",
              "pass"
            ]
          },
          "cards": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
              "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
            },
            "uniqueItems": true,
            "maxItems": 108
          },
          "declared": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "hand_type": {
                "enum": [
                  "single",
                  "pair",
                  "triple",
                  "full_house",
                  "straight",
                  "consecutive_pairs",
                  "consecutive_triples",
                  "rank_bomb",
                  "straight_flush",
                  "joker_bomb"
                ]
              },
              "primary_rank": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sequence_ranks": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "bomb_length": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 4
              },
              "wildcard_as": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "card_id",
                    "rank",
                    "suit"
                  ],
                  "properties": {
                    "card_id": {
                      "type": "string",
                      "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
                      "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
                    },
                    "rank": {
                      "type": "string"
                    },
                    "suit": {
                      "enum": [
                        "S",
                        "H",
                        "C",
                        "D",
                        null
                      ]
                    }
                  },
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "hand_type",
              "primary_rank",
              "sequence_ranks",
              "bomb_length",
              "wildcard_as"
            ],
            "additionalProperties": false
          },
          "remaining_after": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 27
          }
        },
        "additionalProperties": false
      }
    },
    "known_card_transfers": {
      "type": "array",
      "description": "公开贡还牌是归属转移，不是已打出牌。",
      "items": {
        "type": "object",
        "required": [
          "event_id",
          "from_player",
          "to_player",
          "card_id",
          "transfer_type"
        ],
        "properties": {
          "event_id": {
            "type": "string"
          },
          "from_player": {
            "enum": [
              "P0",
              "P1",
              "P2",
              "P3"
            ]
          },
          "to_player": {
            "enum": [
              "P0",
              "P1",
              "P2",
              "P3"
            ]
          },
          "card_id": {
            "type": "string",
            "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
            "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
          },
          "transfer_type": {
            "enum": [
              "tribute",
              "return_tribute"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "current_trick": {
      "type": "object",
      "required": [
        "trick_id",
        "lead_player",
        "winning_player",
        "winning_action",
        "passed_since_latest_play",
        "trick_closed",
        "next_leader"
      ],
      "properties": {
        "trick_id": {
          "type": [
            "string",
            "null"
          ]
        },
        "lead_player": {
          "enum": [
            "P0",
            "P1",
            "P2",
            "P3",
            null
          ]
        },
        "winning_player": {
          "enum": [
            "P0",
            "P1",
            "P2",
            "P3",
            null
          ]
        },
        "winning_action": {
          "type": [
            "object",
            "null"
          ],
          "required": [
            "action_id",
            "action_type",
            "cards",
            "declared",
            "legal_validated"
          ],
          "properties": {
            "action_id": {
              "type": "string",
              "minLength": 1
            },
            "action_type": {
              "const": "play"
            },
            "cards": {
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
                "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
              },
              "uniqueItems": true,
              "maxItems": 108
            },
            "declared": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "hand_type": {
                  "enum": [
                    "single",
                    "pair",
                    "triple",
                    "full_house",
                    "straight",
                    "consecutive_pairs",
                    "consecutive_triples",
                    "rank_bomb",
                    "straight_flush",
                    "joker_bomb"
                  ]
                },
                "primary_rank": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "sequence_ranks": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "bomb_length": {
                  "type": [
                    "integer",
                    "null"
                  ],
                  "minimum": 4
                },
                "wildcard_as": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": [
                      "card_id",
                      "rank",
                      "suit"
                    ],
                    "properties": {
                      "card_id": {
                        "type": "string",
                        "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
                        "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
                      },
                      "rank": {
                        "type": "string"
                      },
                      "suit": {
                        "enum": [
                          "S",
                          "H",
                          "C",
                          "D",
                          null
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "hand_type",
                "primary_rank",
                "sequence_ranks",
                "bomb_length",
                "wildcard_as"
              ],
              "additionalProperties": false
            },
            "legal_validated": {
              "type": "boolean"
            },
            "features": {
              "type": "object",
              "description": "可选候选派生特征。只报告实际计算或有证据支持的估计。"
            }
          },
          "additionalProperties": false,
          "allOf": [
            {
              "if": {
                "properties": {
                  "action_type": {
                    "const": "pass"
                  }
                }
              },
              "then": {
                "properties": {
                  "cards": {
                    "maxItems": 0
                  },
                  "declared": {
                    "type": "null"
                  }
                }
              }
            },
            {
              "if": {
                "properties": {
                  "action_type": {
                    "const": "play"
                  }
                }
              },
              "then": {
                "properties": {
                  "cards": {
                    "minItems": 1
                  },
                  "declared": {
                    "type": "object"
                  }
                }
              }
            },
            {
              "if": {
                "properties": {
                  "action_type": {
                    "enum": [
                      "tribute",
                      "return_tribute"
                    ]
                  }
                }
              },
              "then": {
                "properties": {
                  "cards": {
                    "minItems": 1,
                    "maxItems": 1
                  },
                  "declared": {
                    "type": "null"
                  }
                }
              }
            }
          ]
        },
        "passed_since_latest_play": {
          "type": "array",
          "items": {
            "enum": [
              "P0",
              "P1",
              "P2",
              "P3"
            ]
          },
          "uniqueItems": true
        },
        "trick_closed": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "next_leader": {
          "enum": [
            "P0",
            "P1",
            "P2",
            "P3",
            null
          ]
        }
      },
      "additionalProperties": false
    },
    "phase_hint": {
      "enum": [
        "auto",
        "tribute",
        "opening",
        "middle",
        "endgame"
      ]
    },
    "legal_actions": {
      "type": [
        "array",
        "null"
      ],
      "items": {
        "type": "object",
        "required": [
          "action_id",
          "action_type",
          "cards",
          "declared",
          "legal_validated"
        ],
        "properties": {
          "action_id": {
            "type": "string",
            "minLength": 1
          },
          "action_type": {
            "enum": [
              "play",
              "pass",
              "tribute",
              "return_tribute"
            ]
          },
          "cards": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
              "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
            },
            "uniqueItems": true,
            "maxItems": 108
          },
          "declared": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "hand_type": {
                "enum": [
                  "single",
                  "pair",
                  "triple",
                  "full_house",
                  "straight",
                  "consecutive_pairs",
                  "consecutive_triples",
                  "rank_bomb",
                  "straight_flush",
                  "joker_bomb"
                ]
              },
              "primary_rank": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sequence_ranks": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "bomb_length": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 4
              },
              "wildcard_as": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "card_id",
                    "rank",
                    "suit"
                  ],
                  "properties": {
                    "card_id": {
                      "type": "string",
                      "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
                      "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
                    },
                    "rank": {
                      "type": "string"
                    },
                    "suit": {
                      "enum": [
                        "S",
                        "H",
                        "C",
                        "D",
                        null
                      ]
                    }
                  },
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "hand_type",
              "primary_rank",
              "sequence_ranks",
              "bomb_length",
              "wildcard_as"
            ],
            "additionalProperties": false
          },
          "legal_validated": {
            "type": "boolean"
          },
          "features": {
            "type": "object",
            "description": "可选候选派生特征。只报告实际计算或有证据支持的估计。"
          }
        },
        "additionalProperties": false,
        "allOf": [
          {
            "if": {
              "properties": {
                "action_type": {
                  "const": "pass"
                }
              }
            },
            "then": {
              "properties": {
                "cards": {
                  "maxItems": 0
                },
                "declared": {
                  "type": "null"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "action_type": {
                  "const": "play"
                }
              }
            },
            "then": {
              "properties": {
                "cards": {
                  "minItems": 1
                },
                "declared": {
                  "type": "object"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "action_type": {
                  "enum": [
                    "tribute",
                    "return_tribute"
                  ]
                }
              }
            },
            "then": {
              "properties": {
                "cards": {
                  "minItems": 1,
                  "maxItems": 1
                },
                "declared": {
                  "type": "null"
                }
              }
            }
          }
        ]
      },
      "description": "规则引擎验证过的可选动作；null表示未提供，空数组表示未得到候选。"
    },
    "engine_evaluation": {
      "type": [
        "object",
        "null"
      ],
      "description": "可选的实际计算结果，包括余手、控制链、搜索结果和特征；与估计把握分开。"
    }
  },
  "additionalProperties": false,
  "x-semantic-checks": [
    "四个座次 ID 恰好各一次；partner 是固定对家且不等于 self。",
    "普通轮到自己出牌时 current_actor=self。",
    "self_hand 长度等于自家 remaining_cards；已出完者余牌为0。",
    "每个实体 ID 在手牌与打出历史中不重复；同一张牌的贡还转移可出现多次但不是打出。",
    "history_complete=false 时只计算已知下界与不完整牌池，不能声明完整推断。",
    "出牌记录的剩余数与扣牌一致；PASS 不扣牌；latest play之后重算不跟名单。",
    "当前 winning_action 必须与本轮最新最大出牌一致，可能不是日志中最新事件。",
    "候选 action_id 唯一；候选实体牌是自家手牌子集；全部配牌、压牌、PASS条件由规则引擎验证。",
    "ready 要求 rules.verified=true、level_rank非null、完整关键桌面状态且推荐候选 legal_validated=true。"
  ]
};
export const outputSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.invalid/guandan/advice-output.schema.json",
  "title": "掼蛋出牌建议输出",
  "type": "object",
  "required": [
    "status",
    "stage",
    "role",
    "recommendation",
    "verified_facts",
    "beliefs",
    "hand_plan",
    "alternatives",
    "reason_summary",
    "source_rule_ids",
    "risks",
    "missing_fields",
    "confidence"
  ],
  "properties": {
    "status": {
      "enum": [
        "ready",
        "needs_input",
        "needs_legal_validation"
      ]
    },
    "stage": {
      "enum": [
        "tribute",
        "opening",
        "middle",
        "endgame",
        "undetermined"
      ]
    },
    "role": {
      "enum": [
        "attack",
        "support",
        "undecided"
      ]
    },
    "recommendation": {
      "type": [
        "object",
        "null"
      ],
      "required": [
        "action_id",
        "action_type",
        "cards",
        "declared",
        "legal_validated"
      ],
      "properties": {
        "action_id": {
          "type": "string",
          "minLength": 1
        },
        "action_type": {
          "enum": [
            "play",
            "pass",
            "tribute",
            "return_tribute"
          ]
        },
        "cards": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
            "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
          },
          "uniqueItems": true,
          "maxItems": 108
        },
        "declared": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "hand_type": {
              "enum": [
                "single",
                "pair",
                "triple",
                "full_house",
                "straight",
                "consecutive_pairs",
                "consecutive_triples",
                "rank_bomb",
                "straight_flush",
                "joker_bomb"
              ]
            },
            "primary_rank": {
              "type": [
                "string",
                "null"
              ]
            },
            "sequence_ranks": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "bomb_length": {
              "type": [
                "integer",
                "null"
              ],
              "minimum": 4
            },
            "wildcard_as": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "card_id",
                  "rank",
                  "suit"
                ],
                "properties": {
                  "card_id": {
                    "type": "string",
                    "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
                    "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
                  },
                  "rank": {
                    "type": "string"
                  },
                  "suit": {
                    "enum": [
                      "S",
                      "H",
                      "C",
                      "D",
                      null
                    ]
                  }
                },
                "additionalProperties": false
              }
            }
          },
          "required": [
            "hand_type",
            "primary_rank",
            "sequence_ranks",
            "bomb_length",
            "wildcard_as"
          ],
          "additionalProperties": false
        },
        "legal_validated": {
          "type": "boolean"
        },
        "features": {
          "type": "object",
          "description": "可选候选派生特征。只报告实际计算或有证据支持的估计。"
        }
      },
      "additionalProperties": false,
      "allOf": [
        {
          "if": {
            "properties": {
              "action_type": {
                "const": "pass"
              }
            }
          },
          "then": {
            "properties": {
              "cards": {
                "maxItems": 0
              },
              "declared": {
                "type": "null"
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "action_type": {
                "const": "play"
              }
            }
          },
          "then": {
            "properties": {
              "cards": {
                "minItems": 1
              },
              "declared": {
                "type": "object"
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "action_type": {
                "enum": [
                  "tribute",
                  "return_tribute"
                ]
              }
            }
          },
          "then": {
            "properties": {
              "cards": {
                "minItems": 1,
                "maxItems": 1
              },
              "declared": {
                "type": "null"
              }
            }
          }
        }
      ]
    },
    "verified_facts": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "beliefs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "player_id",
          "hypothesis",
          "evidence",
          "counterexamples",
          "confidence"
        ],
        "properties": {
          "player_id": {
            "enum": [
              "P0",
              "P1",
              "P2",
              "P3"
            ]
          },
          "hypothesis": {
            "type": "string"
          },
          "evidence": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "counterexamples": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "confidence": {
            "enum": [
              "low",
              "medium",
              "high"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "hand_plan": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "groups": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^d[01]-(?:[SHCD]-(?:[2-9]|10|[JQKA])|SJ|BJ)$",
              "description": "实体牌 ID，例如 d0-H-7；两副牌区分 d0/d1；SJ小王、BJ大王。"
            },
            "uniqueItems": true,
            "maxItems": 108
          }
        },
        "estimated_remaining_hands": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "weak_routes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "summary": {
          "type": "string"
        }
      },
      "required": [
        "groups",
        "estimated_remaining_hands",
        "weak_routes",
        "summary"
      ],
      "additionalProperties": false
    },
    "alternatives": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "action_id",
          "direction",
          "reason_not_chosen"
        ],
        "properties": {
          "action_id": {
            "type": [
              "string",
              "null"
            ]
          },
          "direction": {
            "type": "string"
          },
          "reason_not_chosen": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "reason_summary": {
      "type": "string"
    },
    "source_rule_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "risks": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "missing_fields": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "confidence": {
      "enum": [
        "low",
        "medium",
        "high"
      ]
    }
  },
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "status": {
            "const": "ready"
          }
        }
      },
      "then": {
        "properties": {
          "recommendation": {
            "type": "object",
            "properties": {
              "legal_validated": {
                "const": true
              }
            }
          },
          "missing_fields": {
            "maxItems": 0
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "status": {
            "enum": [
              "needs_input",
              "needs_legal_validation"
            ]
          }
        }
      },
      "then": {
        "properties": {
          "recommendation": {
            "type": "null"
          }
        }
      }
    }
  ]
};
