# 调研证据包

- Research-Type: evidence-pack

## 证据 1：TypeSafe 官方关于 Jev 模型与 System One 架构定义

- Source: Introducing System One Models and Jev
- Author-or-Organization: TypeSafe AI
- URL: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Accessed-At: 2026-10-06T14:01:39+08:00
- Key-Fact: Jev 是 TypeSafe AI 于 2026 年 9 月 15 日发布的非自回归 System One 判别式决策模型。它不生成自由自然语言文本，而是输入状态（state）和类型化问题（questions），输出强类型概率决策。模型通过 RLCD（Reinforcement Learning for Calibrated Decisions）训练获得高置信度校准概率；支持 Choice（多选）、Noul（二值 True/False 概率 0~1）、Score（有序刻度打分）三种原语；推理延迟低至 70~500ms，输入计费 $0.042/MTok，输出 token 免费，上下文窗口为 32K token。
- Short-Excerpt: System One models are a class of AI models built to make fast, structured decisions that software can use directly. A System One model evaluates a state and returns typed answers and probabilities... up to 200x faster and 400x cheaper than comparable LLMs on classification tasks.
- Intended-Use: 用于教程第二节“Jev 模型核心解密”和第三节“官方特性与三种决策原语”，为读者深入剖析 System One 的设计原理、技术参数与 API 协议。

## 证据 2：热点监控项目中 Jev 预筛流水线实测调优与生产数据

- Source: docs/vibe/features/jev-prefilter/（DEC.md 与 DESIGN/VERIFICATION）决策及进展报告
- Author-or-Organization: liyupi/yupi-hot-monitor 项目工程团队
- URL: https://github.com/liyupi/yupi-hot-monitor/blob/main/docs/vibe/features/jev-prefilter/DEC.md
- Accessed-At: 2026-10-06T14:00:07+08:00
- Key-Fact: 项目全量扫描轮次需处理约 450 条候选条目，原本每条均调用生成式 LLM（火山方舟 Ark），单轮 AI 处理耗时长达 10~20 分钟且极易触发 429 配额耗尽。引入 Jev 后，初版方案尝试由 Jev 完全代替 LLM 打分，但真实运行测试发现：Jev 对正规真实新闻的 isReal 概率波动较大（同为真实新闻判定值在 0.22~0.69），若作为最终仲裁者会导致严重误杀；而在垃圾内容（营销软文 0.03、标题党 0.20、完全无关相关度打分 0）上具备极强区分度。团队据此调整为“Jev 保守粗筛 + LLM 全量精判”两级流水线（拦截阈值 isReal < 0.15 或 relevanceScore === 0）。在生产级真实扫描中，Jev 成功拦截 20 条明确垃圾条目，零输出 token 成本；且当 Ark 发生 429 报错时 Jev 预筛依然独立健康运行；17 个单测与全量 145 个回归测试完全通过。同时解决 Node.js 原生 fetch（undici）在代理环境下超时问题，通过 Axios 实现自动继承 HTTP_PROXY。
- Short-Excerpt: 实测发现 Jev 对真实内容 isReal 判定不稳定（真实新闻 0.22 vs 0.69），但对垃圾区分度好（营销 0.03、标题党 0.20）→ 决定 Jev 只做保守粗筛，不做最终决策... 真实扫描实证拦截 20 条垃圾且 Ark 429 时 Jev 仍独立工作。
- Intended-Use: 用于教程第四节“工程落地实战”、第五节“实测调优与踩坑经验”，提供详实的业务痛点、反直觉实测发现、两级流水线设计以及生产环境避坑指南。
