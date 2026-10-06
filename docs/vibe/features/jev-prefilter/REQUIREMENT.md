# Requirement — Jev（TypeSafe System One）决策预筛

- Feature: `jev-prefilter`
- Status: `FROZEN`（2026-10-05 会话问答确认 + 负责人批准接入）
- 来源: 负责人需求 "把 typesafe jev 模型接入进来"（先分析可行性，后批准实现）
- 关联: docs/REQUIREMENTS.md §5（AI 分析）；`DESIGN.md`；`DEC.md`

## 问题

- 现状：每条内容都调一次 LLM（Ark）做完整判断 + 生成文本，全量扫描 ~450 条/轮，AI 阶段 10-20 分钟，且 Ark 有 5 小时配额限制。
- Jev 是判别式 System One 模型：不生成文本、输出类型化概率决策、70-500ms、**输出 token 免费**（输入 $0.042/MTok）。

## 需求条目

| ID | 需求 | 验收 |
|---|---|---|
| REQ-JEV-01 | Jev 通过 QuickRouter `/v1/systemone` + `jev-1.13.0` 接入 | 真实调用返回类型化决策 |
| REQ-JEV-02 | `analyzeContent` 两级流水线：Jev 预筛 → LLM 精判 | 明确垃圾被拦截、幸存者走 LLM |
| REQ-JEV-03 | Jev 失败自动降级 LLM 全量，行为与现状一致 | Jev 任何错误不中断扫描 |
| REQ-JEV-04 | `JEV_ENABLED=false`（默认）时与接入前逐字节等价 | 开关即回滚 |
| REQ-JEV-05 | 阈值经真实调用调优，避免误杀真实内容 | 见 DESIGN.md 调优结论 |

## 范围与边界

- In Scope: `jevClient.ts`、`ai.ts` 两级流水线、env 配置、单测、验证脚本
- Out of Scope: `expandKeyword` 迁移（Jev 不生成文本，不可行）；用 Jev 替换 Ark（不可行）
- 约束: `AIAnalysis` 对外结构不变；前端/入库零改动

## 决策

见 `DEC.md`（Approved: 保守粗筛 + LLM 全量精判）。
