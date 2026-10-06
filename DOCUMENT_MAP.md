# Document Map

- Last Audited: 2026-10-05
- Map Owner: 本文件（仓库首个权威地图，由 `$vibe-workflow init` 建立）

| 职责 | 实际路径或外部位置 | 状态 | 定位依据/备注 |
|---|---|---|---|
| Agent 规则 | `AGENTS.md`（未建立） | `缺失` | 本轮仅建地图，未创建 AGENTS.md |
| 产品范围与验收 | `docs/REQUIREMENTS.md`（历史基线）；**当前有效**：`docs/vibe/releases/v1/SPEC.md` | `v1 已冻结` | v1 冻结后以 release SPEC 为产品行为事实源 |
| 当前架构 | `docs/vibe/TECH_DESIGN.md` | `已核验` | 基于当前代码/配置/运行证据编写（2026-10-05） |
| 当前进度 | `docs/vibe/PROGRESS.md` | `已核验` | 由 Git/测试核验 |
| 当前 Release | `docs/vibe/releases/v1/`（PROJECT_BRIEF/SPEC/CHANGE/PROPOSED_DESIGN/IMPLEMENTATION_PLAN/VERIFICATION） | `READY_TO_SHIP` | v1 已推送 `4501029` |
| 决策记录 | `docs/vibe/decisions/DEC-001-provider-abstraction.md`、`DEC-002-jev-prefilter.md` | `已记录` | 跨版本决策集中存放 |
| Bug 记录 | `docs/vibe/bugs/` | `缺失` | 本会话发现 3 个已知问题，记录于 PROGRESS 风险表，未开 BUG 文档 |
| 测试与验证 | `server/src/__tests__/` + `docs/vibe/releases/v1/VERIFICATION.md` | `已核验` | 命令见 VERIFICATION |
| 本地运行 | `docs/LOCAL_SETUP.md` | `已核验` | 已同步扫描周期变更 |
| API 集成参考 | `docs/API_INTEGRATION.md` | `部分过期` | 仍含 OpenRouter SDK 与 30 分钟示例；新源与 provider 层需以 TECH_DESIGN 为准 |
| 自包含 Agent Skill | `skills/hot-monitor/` | `独立` | 与本 server 实现并行，职责见 `skills/hot-monitor/SKILL.md`；本会话信源新增仅落 server，未同步 skill |

本文件只作导航，不复制需求、设计或验证结论。
