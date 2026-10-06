# Project

## Current Positioning

- Project Name: yupi-hot-monitor（AI 热点监控工具）
- Current Release: 未建立（本会话工作未走正式 Release 流程；见 PROGRESS）
- Quality Profile: Standard
- Product Summary: 多信源聚合 + AI 判定的热点监控工具。定时抓取 Twitter/B站/微博/HN/搜索引擎/掘金/CSDN/开源中国/GitHub/Product Hunt/微信公众号内容，AI 判定真实性、相关性与重要性后入库推送。
- Primary Users: AI 编程内容创作者（个人使用），以中文技术内容为主

## Current Product Boundaries

- In Scope: 关键词驱动的定时抓取与 AI 审核、多信源聚合、WebSocket 实时推送、邮件通知（高重要级）、手动/定时扫描、信源健康度可观测
- Out of Scope: 多用户/账号体系、付费订阅、移动端、历史数据分析；Twitter 依赖第三方付费 API（当前欠费停供）

## Document Map

权威地图见仓库根目录 `DOCUMENT_MAP.md`（本文件不重复维护第二张表）。

| 职责 | 实际路径 | 状态 |
|---|---|---|
| Agent Rules | `AGENTS.md`（未建立） | 缺失 |
| Current Architecture | `docs/vibe/TECH_DESIGN.md` | 已核验 |
| Current Progress | `docs/vibe/PROGRESS.md` | 已核验 |
| Product Baseline | `docs/REQUIREMENTS.md` | 基线存在，未冻结 |
| Current Release | `docs/vibe/releases/v1/`（PROJECT_BRIEF/SPEC/CHANGE/PROPOSED_DESIGN/IMPLEMENTATION_PLAN/VERIFICATION） | 已建立（v1） |
| Decisions | 并入 `docs/vibe/releases/v1/PROPOSED_DESIGN.md`（决策 D1/D2） | 已记录 |
| Bugs | `docs/vibe/bugs/` | 缺失（记录于 PROGRESS 风险表） |

## Supported Commands

| 目的 | 命令（server 目录下） | 备注 |
|---|---|---|
| Setup | `npm install`（server + client） | 依赖 `.env`（模板 `.env.example`） |
| Test | `npx vitest run src` | 当前 128 passed / 11 skipped |
| Typecheck | `npx tsc --noEmit` | 2026-10-05 修复 tsconfig `module: NodeNext` 后可用 |
| Build (server) | `npm run build` | 产物 `dist/`（已 gitignore） |
| Build (client) | `npm run build`（client 目录） | `tsc -b && vite build` |
| Dev | `npm run dev`（server）/ `npm run dev`（client） | server 用 tsx watch |
| 生产运行 | `npm start`（server，从 dist） | 当前环境采用 |
| 信源自检 | `npx tsx src/scripts/verifyNewSources.ts [关键词]` | 逐源真实抓取验证 |
| AI 连通自检 | `npx tsx src/scripts/verifyAiConnection.ts` | provider/模型/密钥验证 |

## Current Risks and Constraints

- Twitter 信源欠费（HTTP 402），`searchTwitter` 静默返回 0 条；健康度账本无法识别（既有 collector 吞错，见 PROGRESS 风险表）。
- B站账号检测 `searchBilibiliUser` 缺 `buvid3` cookie，间歇 412（不影响主视频搜索）。
- AI 响应 JSON 解析偶发失败（1 次/轮），走 fallback 不崩。
- B站单源依赖过重（近 24h 占比 ~68%）。
