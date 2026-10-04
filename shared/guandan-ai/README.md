# 掼蛋 AI 策略接入交接

本目录为现有 TypeScript 掼蛋项目准备。仅包含接入所需源码与本说明：56 条条件策略、59 个特征、提示词、协议、匹配器和校验器。无需原 PDF、Python 转换脚本、HTML 指南、示例模板、测试目录、编译产物或原项目的 node_modules。

## 给另一个项目的 AI 的接入任务

请将本目录复制到现有掼蛋项目的策略模块中，通过 index.ts 引入。复用项目现有的牌型规则、合法出牌生成、级牌及逢人配处理、出牌历史和余牌统计，增加状态适配器与策略层。

1. 将实际游戏状态映射到 GameState；实体牌 ID 区分两副牌、花色与点数，配牌声明与实体牌分开。具体平台规则写入 rules.details，并由现有规则引擎确认 verified。
2. 由现有规则引擎提供 legal_actions，只有实际验证过的候选才填写 legal_validated=true。先调用 validateState 和 getExecutionGate；未通过时不自动出牌。
3. 从公开历史与自己的手牌提取 FeatureContext。未计算的特征省略或填 null，不能默认 false。每个候选独立计算 action.* / plan.* 特征，调用 matchRules。按实际局面判断 opening / middle / endgame，而非固定回合数。
4. 如果调用大模型，将 systemPrompt 作为系统指令，并提供局面、相关规则及 outputSchema；模型只选择现有候选。模型返回 JSON 后调用 validateDecisionForState，验证成功且 status=ready 才允许执行 recommendation。
5. 如果不调用大模型，可将 ruleLibrary 与 matchRules 用作策略参考；仍需现有项目实现候选评价。规则 priority 是检查顺序，不是出牌分数，不可直接取第一个匹配规则作为出牌决策。

保留教材策略中的条件与例外。PASS 不代表不能跟；队友与对手未公开手牌不能当作事实；不得编造精确胜率。本目录不提供组牌枚举、完整历史重放、牌型合法性搜索、接风结算或胜率求解器。

## 依赖与导入

在目标项目安装运行时校验依赖：

```bash
npm install ajv@^8
```

模块使用 ESM。源码里的 .js 导入后缀适用于 TS NodeNext/现代 bundler，TypeScript 会对应到 .ts 文件。按现有项目配置编译；若项目使用 CommonJS，需按其模块配置适配导入方式。

```ts
import {
  systemPrompt, ruleLibrary, outputSchema,
  validateState, getExecutionGate, matchRules, validateDecisionForState,
  type GameState, type FeatureContext,
} from './guandan-ai/index.js'; // 修改为项目中的实际路径

// rawState 由现有游戏状态适配器提供。
// const checked = validateState(rawState);
// if (!checked.valid) return checked.errors;
// const gate = getExecutionGate(checked.value);
// if (gate.status !== 'ready') return gate;
// const features: FeatureContext = await analyzeCandidate(...);
// const relevant = matchRules(ruleLibrary, features, detectedStage);
// 将 systemPrompt、checked.value、相关规则和 outputSchema 提供给模型。
// const advice = validateDecisionForState(parsedModelOutput, checked.value);
// if (advice.valid && advice.value.status === 'ready') {
//   executeExistingGameAction(advice.value.recommendation);
// }
```

## 文件职责

| 文件 | 用途 |
| --- | --- |
| index.ts | 唯一对外入口 |
| data.ts | 完整策略规则与教材出处 |
| prompt.ts | 中文系统提示词 |
| protocol.ts | GameState、Action、Decision 等 TS 类型 |
| features.ts | 特征名称、类型及说明 |
| rules.ts | 条件匹配器，支持 true / false / unknown |
| schemas.ts | 输入输出 JSON Schema |
| validation.ts | 基础状态校验、执行门槛与推荐候选对照 |

原提示词、规则元数据中的“局面输入.schema.json”与“出牌建议输出.schema.json”分别对应 schemas.ts 的 inputSchema / outputSchema 导出；不需要另外传输 JSON 文件。source.file 为原教材出处记录，不是运行时文件依赖。

rules.details 是开放配置对象。执行门槛要求提供 rank_order、allowed_hand_types、wildcard_definition、wildcard_can_represent_joker、bomb_comparison、ace_in_sequences、tribute_return、initiative_after_finished_player、team_payoff；各配置的内容与合法性由现有项目负责。verified / legal_validated 必须来自可信规则引擎，而非模型自报。基础校验不能替代完整游戏验证，ready 不代表必胜。
