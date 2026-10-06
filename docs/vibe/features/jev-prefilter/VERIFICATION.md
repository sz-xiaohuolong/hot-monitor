# Verification — Jev 决策预筛

- Feature: `jev-prefilter`
- Status: `VERIFIED`（fresh evidence，2026-10-05）
- 注: 接入验证时 JEV_ENABLED=true；**当前服务已按负责人要求关闭（JEV_ENABLED=false）**，本文件记录验证时证据。

## 测试证据

| 范围 | 命令 | 结果 |
|---|---|---|
| Jev 客户端 + 两级流水线单测 | `npx vitest run src/__tests__/jevClient.test.ts` | 17 passed |
| 全量回归 | `npx vitest run src` | 145 passed / 11 skipped |
| 类型检查 | `npx tsc --noEmit` | OK |

## 真实运行证据

### 接入验证（`verifyJevConnection.ts`，JEV_ENABLED=true）

- Jev 决策真实返回：`noul:0.34`、`score:3`+legend、`importance:high`、usage `input=534 output=98`。
- `analyzeContent` 端到端：`✅ 端到端成功`，LLM 生成 relevanceReason + summary。

### 关键调优实验（真实调用）

| 内容 | Jev isReal noul | 结论 |
|---|---|---|
| 真实新闻 A（GPT-4.1 发布） | 0.22 | isReal 判定不稳定 |
| 真实新闻 B（DeepSeek-R1） | 0.69 | 同上 |
| 营销软文 | 0.03 | 区分度极好 |
| 标题党/娱乐 | 0.20 | 区分度极好 |

→ 结论：Jev 只做保守粗筛（`<0.15` 拦截），幸存者交 LLM 精判（见 DEC.md）。

### 生产扫描（`scan_muvbuilf_1`，JEV_ENABLED=true）

- `⚡ Jev 拦截` 出现 **20 次**（拦截明显垃圾，零 LLM 成本）。
- 幸存者正常走 LLM 出热点（`✅ New hotspot [github]: anthropics/claude-code` 等）。
- **Ark 5 小时配额耗尽（429）时 Jev 仍独立工作**，LLM 通道自动降级 fallback，系统不崩。

## 降级验证（负责人当前状态：JEV_ENABLED=false）

- 重启后服务正常，`analyzeContent` 走纯 LLM 路径（不碰 Jev）。
- 降级方式：改 `JEV_ENABLED` 一行 + 重启即可（见 PROGRESS）。

## 结论

REQ-JEV-01 ~ 05 全部满足。
