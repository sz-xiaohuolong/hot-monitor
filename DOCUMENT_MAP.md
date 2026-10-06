# Document Map

- Last Audited: 2026-10-05
- Map Owner: 本文件（仓库首个权威地图，由 `$vibe-workflow init` 建立）

| 职责 | 实际路径或外部位置 | 状态 | 定位依据/备注 |
|---|---|---|---|
| Agent 规则 | `AGENTS.md`（未建立） | `缺失` | 本轮仅建地图，未创建 AGENTS.md |
| 产品范围与验收 | `docs/REQUIREMENTS.md` | `基线存在；范围已改未冻结` | 原始需求文档；本会话已发生两次产品变更（扫描周期、AI provider），均已记录但未作为 Release 冻结 |
| 当前架构 | `docs/vibe/TECH_DESIGN.md` | `已核验` | 基于当前代码/配置/运行证据编写（2026-10-05） |
| 当前进度 | `docs/vibe/PROGRESS.md` | `已核验` | 由 Git/测试核验 |
| 决策记录 | `docs/vibe/features/*/DEC.md` | `已记录` | DEC-001（provider-abstraction）、DEC-002（jev-prefilter）归位到各自功能文件夹 |
| 功能文档 | `docs/vibe/features/<feature>/`（REQUIREMENT/DESIGN/IMPLEMENTATION/VERIFICATION） | `已建立` | 五个功能：provider-abstraction / new-sources / scan-health / scan-frequency / jev-prefilter |
| Bug 记录 | `docs/vibe/bugs/` | `缺失` | 本会话发现 3 个已知问题，记录于 PROGRESS 风险表，未开 BUG 文档 |
| 测试与验证 | `server/src/__tests__/` + `docs/vibe/PROGRESS.md` 验证表 | `已核验` | 命令见 PROGRESS |
| 本地运行 | `docs/LOCAL_SETUP.md` | `已核验` | 已同步扫描周期变更 |
| API 集成参考 | `docs/API_INTEGRATION.md` | `部分过期` | 仍含 OpenRouter SDK 与 30 分钟示例；新源与 provider 层需以 TECH_DESIGN 为准 |
| 自包含 Agent Skill | `skills/hot-monitor/` | `独立` | 与本 server 实现并行，职责见 `skills/hot-monitor/SKILL.md`；本会话信源新增仅落 server，未同步 skill |

本文件只作导航，不复制需求、设计或验证结论。
