---
{"schema_version":1,"status":"ready"}
---

# 写作参考包

## 个人参考 1

- Source-ID: MINE-0003
- Selection-Reason: 该文章同为开发者实战 tutorial 风格教程，详细拆解了工程背景痛点、方案选型权衡、核心原语机制、分步工程实现与避坑指南，结构与本篇 Jev 教程高度匹配。
- Method-To-Use: 采用其“本节重点 → 需求背景与痛点 → 方案选型权衡 → 核心机制原语解析 → 分步工程实现 → 实测验证与踩坑总结”的章节推进节奏；在各步骤中通过代码切片与结构图指引读者，并在结尾给出清晰检查点。

## 外部参考 1

- Source: What Is Jev? A Guide to TypeSafe AI’s System One Model
- Author-or-Organization: LangChain (S. Runkle, H. Lovell)
- URL: https://blog.langchain.dev/building-a-harness-with-jev/
- Accessed-At: 2026-10-06T14:02:21+08:00
- Selection-Reason: 该文章清晰地将 Jev 的 System One（判别式、非自回归、概率校准）与传统生成式 LLM 进行对比，直击大模型流水线“又慢又贵”的痛点，给出了类型化原语（Noul/Score/Choice）的标准解释范式。
- Transferable-Method: 借用其“痛点引入（LLM 调用的慢与贵）→ 引入 System One 概念（非自回归、仅作结构化判别）→ 拆解 typed questions 请求模式”的论述逻辑，用于本篇概念介绍章节。
- Do-Not-Imitate: 不复制其英文客服工单示例、不模仿其 LangChain 专属的 Harness API 绑定代码，保持独立技术描述与热点监控特定业务场景。

## 外部参考 2

- Source: Building Production Agents with Jev and LangGraph
- Author-or-Organization: LangChain
- URL: https://blog.langchain.dev/building-prod-with-jev-and-langgraph/
- Accessed-At: 2026-10-06T14:02:31+08:00
- Selection-Reason: 该文章从工程系统可靠性出发，讨论了如何在复杂生产系统中分层：确定性代码控制主流程、低成本判别模型把守分支网关、生成模型处理自由文本，为本文两级流水线设计提供了架构论证依据。
- Transferable-Method: 吸收其“将判别式决策与生成式内容解耦、分别部署到不同性能/成本等级的管道中”的架构叙事逻辑，用于本文工程流水线与架构图展开。
- Do-Not-Imitate: 不模仿其带有口号色彩的宣传语和宽泛泛化叙事，本篇只保留具体工程实现与真实实测数据。

## 来源替换 1

- Seed-URL: https://sidbharath.com/blog/jev-typesafe-system-one-model
- Reason: 目标链接返回 HTTP 404 页面丢失，无法获取正文及写作方法
- Replacement-URL: https://blog.langchain.dev/building-a-harness-with-jev/
