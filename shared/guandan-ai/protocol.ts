// 掼蛋 AI 接入交接模块；与本目录中的相关模块一起复制。
// Runtime ranges, patterns and conditional constraints are checked by the validators.
export type GameState = {
"rules": {
"profile_id": string | null;
"verified": boolean;
"level_rank": "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" | null;
"deck_count": 2;
"details": Record<string, unknown>;
};
"self_id": "P0" | "P1" | "P2" | "P3";
"partner_id": "P0" | "P1" | "P2" | "P3";
"turn_order": Array<"P0" | "P1" | "P2" | "P3">;
"current_actor": "P0" | "P1" | "P2" | "P3" | null;
"seats": Array<{
"player_id": "P0" | "P1" | "P2" | "P3";
"remaining_cards": number | null;
"finished_rank": number | null;
}>;
"self_hand": Array<CardId>;
"history_complete": boolean;
"history": Array<{
"event_id": string;
"trick_id": string;
"player_id": "P0" | "P1" | "P2" | "P3";
"action_type": "play" | "pass";
"cards": Array<CardId>;
"declared": {
"hand_type": "single" | "pair" | "triple" | "full_house" | "straight" | "consecutive_pairs" | "consecutive_triples" | "rank_bomb" | "straight_flush" | "joker_bomb";
"primary_rank": string | null;
"sequence_ranks": Array<string>;
"bomb_length": number | null;
"wildcard_as": Array<{
"card_id": CardId;
"rank": string;
"suit": "S" | "H" | "C" | "D" | null;
}>;
} | null;
"remaining_after": number | null;
}>;
"known_card_transfers": Array<{
"event_id": string;
"from_player": "P0" | "P1" | "P2" | "P3";
"to_player": "P0" | "P1" | "P2" | "P3";
"card_id": CardId;
"transfer_type": "tribute" | "return_tribute";
}>;
"current_trick": {
"trick_id": string | null;
"lead_player": "P0" | "P1" | "P2" | "P3" | null;
"winning_player": "P0" | "P1" | "P2" | "P3" | null;
"winning_action": {
"action_id": string;
"action_type": "play";
"cards": Array<CardId>;
"declared": {
"hand_type": "single" | "pair" | "triple" | "full_house" | "straight" | "consecutive_pairs" | "consecutive_triples" | "rank_bomb" | "straight_flush" | "joker_bomb";
"primary_rank": string | null;
"sequence_ranks": Array<string>;
"bomb_length": number | null;
"wildcard_as": Array<{
"card_id": CardId;
"rank": string;
"suit": "S" | "H" | "C" | "D" | null;
}>;
} | null;
"legal_validated": boolean;
"features"?: Record<string, unknown>;
} | null;
"passed_since_latest_play": Array<"P0" | "P1" | "P2" | "P3">;
"trick_closed": boolean | null;
"next_leader": "P0" | "P1" | "P2" | "P3" | null;
};
"phase_hint": "auto" | "tribute" | "opening" | "middle" | "endgame";
"legal_actions": Array<{
"action_id": string;
"action_type": "play" | "pass" | "tribute" | "return_tribute";
"cards": Array<CardId>;
"declared": {
"hand_type": "single" | "pair" | "triple" | "full_house" | "straight" | "consecutive_pairs" | "consecutive_triples" | "rank_bomb" | "straight_flush" | "joker_bomb";
"primary_rank": string | null;
"sequence_ranks": Array<string>;
"bomb_length": number | null;
"wildcard_as": Array<{
"card_id": CardId;
"rank": string;
"suit": "S" | "H" | "C" | "D" | null;
}>;
} | null;
"legal_validated": boolean;
"features"?: Record<string, unknown>;
}> | null;
"engine_evaluation": Record<string, unknown> | null;
};
type DecisionShape = {
"status": "ready" | "needs_input" | "needs_legal_validation";
"stage": "tribute" | "opening" | "middle" | "endgame" | "undetermined";
"role": "attack" | "support" | "undecided";
"recommendation": {
"action_id": string;
"action_type": "play" | "pass" | "tribute" | "return_tribute";
"cards": Array<CardId>;
"declared": {
"hand_type": "single" | "pair" | "triple" | "full_house" | "straight" | "consecutive_pairs" | "consecutive_triples" | "rank_bomb" | "straight_flush" | "joker_bomb";
"primary_rank": string | null;
"sequence_ranks": Array<string>;
"bomb_length": number | null;
"wildcard_as": Array<{
"card_id": CardId;
"rank": string;
"suit": "S" | "H" | "C" | "D" | null;
}>;
} | null;
"legal_validated": boolean;
"features"?: Record<string, unknown>;
} | null;
"verified_facts": Array<string>;
"beliefs": Array<{
"player_id": "P0" | "P1" | "P2" | "P3";
"hypothesis": string;
"evidence": Array<string>;
"counterexamples": Array<string>;
"confidence": "low" | "medium" | "high";
}>;
"hand_plan": {
"groups": Array<Array<CardId>> | null;
"estimated_remaining_hands": number | null;
"weak_routes": Array<string>;
"summary": string;
} | null;
"alternatives": Array<{
"action_id": string | null;
"direction": string;
"reason_not_chosen": string;
}>;
"reason_summary": string;
"source_rule_ids": Array<string>;
"risks": Array<string>;
"missing_fields": Array<string>;
"confidence": "low" | "medium" | "high";
};

export type Action = NonNullable<GameState['legal_actions']>[number];
export type Seat = GameState['self_id'];
export type Stage = Decision['stage'];
export type Role = Decision['role'];
export type Status = Decision['status'];
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type CardId = `d${0 | 1}-${'S' | 'H' | 'C' | 'D'}-${Rank}` | `d${0 | 1}-${'SJ' | 'BJ'}`;
export type Decision = Omit<DecisionShape, 'status' | 'recommendation'> & (
  | { status: 'ready'; recommendation: Action & { legal_validated: true } }
  | { status: 'needs_input' | 'needs_legal_validation'; recommendation: null }
);
