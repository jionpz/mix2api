---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish']
inputDocuments:
  - '_bmad-output/planning-artifacts/product-brief-mix2api-2026-02-10.md'
  - '_bmad-output/planning-artifacts/research/domain-LLM网关-OpenAIChatCompletions兼容适配层-new-api生态-MCP工具调用生态-research-2026-02-10.md'
  - '_bmad-output/planning-artifacts/research/technical-LLM网关-OpenAIChatCompletions兼容适配层-new-api生态-MCP工具调用生态-research-2026-02-10.md'
  - '_bmad-output/brainstorming/brainstorming-session-2026-02-10.md'
  - 'docs/architecture.md'
  - 'docs/session.md'
  - 'docs/tools-mcp-skills.md'
documentCounts:
  briefCount: 1
  researchCount: 2
  brainstormingCount: 1
  projectDocsCount: 3
classification:
  projectType: api_backend
  domain: general
  complexity: medium
  projectContext: brownfield
workflowType: 'prd'
date: '2026-02-11'
---

# Product Requirements Document - mix2api

**Author:** 皇上
**Date:** 2026-02-11

---

## Executive Summary

- **一句话定位（内部版）**：mix2api 是 new-api 后置的内部上游适配层（provider），把自建模型网站输出为**语义稳定的 OpenAI Chat Completions**（`/v1/chat/completions`，`stream` 不断流 + `tools/tool_calls` 闭环，MCP-safe），并以**可观测优先 + 最小状态（Redis 默认开启）+ 灰度回滚**保障 OpenCode/Claude Code 可验收、可迭代。
- **目标用户**：内部 AI 工程师（IDE 智能体使用与回归）与平台/后端工程师（链路稳定性、观测、灰度回滚）。
- **安全边界**：仅允许 new-api 内网调用；service-to-service 鉴权；敏感信息全链路脱敏；可选采样留痕保留 1 天。
- **明确边界（MVP）**：
  - 只做 Chat Completions（含 `stream` + `tools` + legacy `functions`），不承诺 `/responses`
  - 不替代 new-api 控制面（Key/配额/计费/限流/路由治理）
  - 不承诺服务端执行 MCP（仅保证 MCP-safe）
- **验收方式**：2 人、2 周（2026-02-11 ～ 2026-02-25）；rolling 24h 且按 client 分开统计（OpenCode/Claude Code），排除 `client_abort`；排障以响应头 `x-request-id` 作为 `request_id` 入口，结合 `end_reason` 归因并支持灰度回滚。

---

## Success Criteria

### User Success

- **验收窗口**：2 周（2026-02-11 ～ 2026-02-25），**核心用户**：2 人
- **不断流可感知**：在 OpenCode 与 Claude Code 的真实开发任务中，`stream=true` 不出现“卡住/半截断/无完成信号”
- **tools 闭环可用**：需要工具的任务可稳定完成 `assistant(tool_calls) → tool(result) → assistant(final)`，不依赖“关 tools / 改提示词”规避
- **失败可定位**：任一失败可通过 `request_id + end_reason` 在 10 分钟内归因到 `upstream / new-api / mix2api / client` 中至少一类（用于修复或回滚决策）
- **Aha/完成场景**：IDE 侧使用体验与官方对应型号模型无显著差异（语义、稳定性、工具闭环、流式体验一致）

### Business Success

- **2 周内（≤ 2026-02-25）**：两端分别达到 MVP SLO；回归包 A/B/C 全绿；灰度与回滚策略可执行且可复盘
- **3 个月内（≤ 2026-05-11）**：形成可持续交付节奏（stable/canary 灰度发布常态化）；按 Top `end_reason` 驱动迭代，兼容性不回归
- **12 个月内（≤ 2027-02-11）**：保持对 new-api 生态强绑定与北向契约稳定；为后续能力扩展（如 `/responses`、服务端 MCP Gateway）保留清晰、可独立验收的指标体系

### Technical Success

- **北向语义契约（Chat Completions）**：`/v1/chat/completions` 的 `stream` + `tools/tool_calls` 行为可预测、可回归（字段对齐只是底线）
- **SSE 稳定性**：事件顺序/增量语义/结束信号一致；断连/超时/上游异常统一归因（`end_reason`）
- **Tool Loop 状态机**：严格闭环；`tool_call_id` 关联一致；回填后能继续生成；流式与非流式语义一致
- **状态与隔离（Redis 默认开启）**：
  - stable/canary 共享 Redis，避免灰度时会话漂移导致随机失败
  - schemaVersion 前后兼容（只增不改）；解析失败/未知 version 按 miss 自动新会话（不得让请求失败）
  - session key 隔离按 auth 指纹/显式 header，避免串话
- **可观测优先**：100% 请求具备 `request_id`；最小维度打点 `client`、`stream`、`tools_present`、`end_reason`、`http_status`、`upstream_status`
- **灰度/回滚工程化**：配合 new-api 权重 0%→5%→20%→50%→100%；短窗回滚阈值可自动触发
- **安全边界**：mix2api 作为内部上游适配层，只信任 new-api 入站；敏感信息默认脱敏，不在日志中泄露

### Measurable Outcomes

- **统计口径**：rolling 24h；按 client（OpenCode、Claude Code）分别统计；排除 `client_abort`；以服务端 `end_reason` 为准

| KPI | 定义 | 门槛（MVP） |
| --- | --- | --- |
| 请求成功率 | `end_reason=ok / (total - client_abort)` | ≥ 99.0% |
| 工具调用成功率 | 在出现 `tool_calls` 的请求中：闭环完成占比（排除 `client_abort`） | ≥ 97.0% |
| 断流率 | `stream=true` 且非 `client_abort` 的未正常完成占比 | ≤ 0.5% |
| 归因覆盖率 | 非成功请求中，`end_reason != unknown` 的占比 | ≥ 99% |
| 回归包通过率 | 最小回归包 A/B/C（stable 与 canary） | 100% |
| 回滚时效 | 触发阈值后权重回滚到 0% 的完成时间 | ≤ 10 分钟 |

## Product Scope

### MVP - Minimum Viable Product

- **北向**：仅 `POST /v1/chat/completions`（含 `stream` + `tools/tool_calls` 语义一致）
- **南向**：token 生命周期（获取/续期/失败重登）、上游 `sessionId/exchangeId` 提取与复用、错误形态规范化
- **MCP-safe**：不破坏 MCP 相关工具形态（默认不承诺服务端执行 MCP）
- **可观测**：按 client×stream×tools 拆分统计与归因（`end_reason`）
- **灰度回滚**：配合 new-api 权重灰度；stable/canary 双容器
- **共享 Redis（默认开启）**：最小必要状态外置，保障多实例一致性

### Growth Features (Post-MVP)

- 扩充一致性回归矩阵（多工具/并行工具/长输出/取消/超时/上游 token 过期等）
- 视需要引入 `/responses` 兼容桥接（在不破坏既有契约前提下渐进演进）
- 结构化输出（JSON Schema + strict）透传/兼容策略（用于降低工具链随机性）
- 更完整的可观测体系（如 trace 贯通、可回放/采样策略、成本归因闭环）
- 评估独立立项“服务端 MCP Gateway”（从 MCP-safe 升级到可执行与可治理）

### Vision (Future)

- Claude Code / OpenCode 使用起来与官方对应型号模型无差别（语义、稳定性、工具闭环、流式体验一致）
- 在“契约不回归”的前提下扩展 OpenAI 生态能力与工具治理能力，并保持与 new-api 生态强绑定

---

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** 体验/可靠性 MVP（以“不断流 + tools 闭环 + 可观测归因 + 灰度回滚”为第一目标）  
**Resource Requirements:** 2 人、2 周（2026-02-11 ～ 2026-02-25）；角色覆盖：AI 工程师（契约/回归/工具闭环）+ 平台/后端工程师（SSE/网关链路/观测/灰度回滚/Redis）

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Journey 1：AI 工程师 happy path（OpenCode/Claude Code 日常开发任务）
- Journey 2：AI 工程师失败恢复（tools 闭环/断流翻车时 10 分钟内止血并给结论）
- Journey 3：平台工程师运维排障与回滚（按 end_reason 分型决策）

**Must-Have Capabilities:**
- 北向契约：`POST /v1/chat/completions`（含 `stream`、`tools/tool_calls`，并兼容 legacy `functions/function_call`）
- Streaming 可靠性（最高优先级）：SSE 不缓冲、事件增量语义稳定、必须发送 `[DONE]`；能区分并排除 `client_abort`
- tools 闭环：`assistant(tool_calls) → tool(result) → assistant(final)` 严格可回归，`tool_call_id` 全链路一致，回填后必须继续生成
- 基础端点：`GET /health`、`GET /v1/models`，以及 `POST /` 的兼容入口
- 入站鉴权与隔离：内网调用 + 共享 secret header；会话隔离优先用显式 header（兜底用 auth 指纹 hash）
- 最小状态 + Redis（默认开启）：stable/canary 共享；schemaVersion 前后兼容；解析失败按 miss 新会话降级
- 可观测/归因：100% `x-request-id`；最小维度 `client/stream/tools_present/end_reason/http_status/upstream_status`；可用于“10 分钟内归因 + 回滚决策”
- 灰度与回滚：配合 new-api 权重 0→5→20→50→100；短窗阈值触发回滚可执行、可复盘
- 数据治理底线：默认不落盘 prompts/tool payload；可选采样留痕保留 1 天；全链路脱敏（Authorization/cookie/token/session 等）
- 文档与回归：README（接入/灰度/回归包 A/B/C）+ OpenAPI 规范；回归包 A/B/C（stable 与 canary）全绿

### Post-MVP Features

**Phase 2 (Post-MVP):**
- 扩大一致性回归矩阵（多工具/并行工具/长文本/取消/超时/重试/多模型）
- 观测增强：更细粒度 end_reason 分型、Top N 失败样本自动采集（仍遵循脱敏与留存策略）
- 工程化稳定性：SSE 链路专项压测、代理/网关配置基线、连接复用与超时策略固化
- 配置与运维：更完善的运行手册、告警阈值与自动回滚联动

**Phase 3 (Expansion):**
- 新北向能力（例如 `/responses`）与更复杂场景的兼容性扩展（单独验收与回归矩阵）
- 服务端 MCP Gateway（另立项），与 mix2api 的 MCP-safe 边界保持清晰
- 若未来对外/跨域交付：补齐合规与审计要求（等保/ISO/SOC2 等按需引入）

### Risk Mitigation Strategy

**Technical Risks:** SSE 断流/缓冲/结束信号是首要风险；策略是“先把 streaming 做成可回归的第一等公民”：
- 优先实现并固化 SSE 输出规范（flush、禁缓冲、结束信号、超时/断连处理）
- 把断流定义成可度量指标（排除 `client_abort`），并作为灰度回滚触发条件之一
- 用回归包 A（纯流式长输出）做为每日基线与发布门禁

**Market Risks:** 内部“可用性预期”极高（IDE 体验要接近官方模型）；策略是以真实 IDE 任务验收 + 分端统计（OpenCode/Claude Code）避免“平均数掩盖问题”。

**Resource Risks:** 2 人 2 周，范围爆炸会直接失败；策略是严格坚持 MVP 边界（只做 Chat Completions），治理/限流/计费等全部依赖 new-api，任何新增能力必须以“不断流/工具闭环/归因/回滚”不受影响为前置条件。

---

## User Journeys

### Journey 1：AI 工程师（林泽）— Happy Path：把 IDE 智能体跑到“像官方一样稳定”

**Opening Scene（开场）**  
周一早上，林泽准备开始一天的开发。他已经受够了“偶发断流/工具不触发/回填后不继续”的玄学问题：每次失败都要重试、抓包、猜测，心态从“我在写代码”变成“我在对抗链路”。

**Rising Action（推进）**  
他按团队标准路径接入：OpenCode/Claude Code → new-api → mix2api → 自建模型网站。  
他做的第一件事不是写复杂提示词，而是跑最小回归包 A/B/C（稳定性优先）：
- A：`stream=true` 无 tools 的长输出，确认不断流、结束信号一致
- B：`stream=true` 有 tools 的最小工具链，确认能走完 tool loop
- C：主动取消/超时，确认能被识别为 `client_abort` 且资源释放

**Climax（关键时刻）**  
一次真实开发任务里，模型需要调用工具：IDE 发起请求带 `tools`，mix2api 产出 `assistant(tool_calls)`，IDE 执行工具并回填 `role=tool` 结果后，模型继续生成最终答案——全过程没有“提前结束/卡住/忘记工具协议”，并且 `tool_call_id` 全链路一致。

**Resolution（结局/新现实）**  
林泽在 IDE 里用起来几乎“无感”：流式输出稳定，工具闭环可靠；即使偶发失败，也能从响应里拿到 `request_id` 并看到明确 `end_reason`，不再靠猜。  
他的情绪从“焦虑+防守”回到“专注开发”，团队也终于能按 SLO 做验收，而不是按体感争论。

**可能出错点与恢复路径（用户视角）**  
- 若偶发失败：按 `request_id + end_reason` 快速归因（upstream/new-api/mix2api/client），优先触发灰度回滚止损，再定位修复。  
- 若需要新会话：通过约定方式强制新 session（避免上下文串扰）。

### Journey 2：AI 工程师（林泽）— Edge Case：工具闭环/断流翻车时，10 分钟内能止血并给结论

**Opening Scene（开场）**  
下午高峰期，林泽在 Claude Code 执行一个依赖工具的改造任务：模型开始流式输出，随后发起工具调用。但这一次，IDE 表现为“卡住/半截断/回填后不继续”。

**Rising Action（推进）**  
林泽不再“先重试三次再说”。他按约定的排障路径走：
- 记录 `request_id`（以及必要的 client、是否 stream、是否带 tools）
- 查看服务端口径的 `end_reason` 与关键维度（client×stream×tools）

**Climax（关键时刻）**  
排查发现这次失败可被明确归类，例如：
- `end_reason=upstream_error`（上游异常/超时）
- `end_reason=adapter_error`（适配层状态机/映射问题）
- `end_reason=timeout`（链路超时）
并且能回答两个关键问题：
1) 这次失败是不是“断流”（且不是 `client_abort`）？
2) 这次失败是不是“tool loop 未闭环”（在出现 `tool_calls` 的请求集中）？

**Resolution（结局/新现实）**  
林泽把结论同步给链路 owner：这不是“模型玄学”，而是可定位的类别问题。  
若属于已设定的短窗回滚阈值范围内（断流/adapter_error/5xx 触发），平台侧按流程回滚 new-api 权重到 0%，先恢复体验，再开工修复。

**可能出错点与恢复路径（用户视角）**  
- 断流：要求服务端能区分 `client_abort` 与非正常中断，并提供一致的完成信号与归因。  
- 工具闭环：要求 `assistant(tool_calls) → tool(result) → assistant(final)` 的显式状态机与一致性回归用例，避免“回填后不继续/提前 final”。

### Journey 3：平台工程师（周宁）— 运维排障与回滚：把“责任归属”从争论变成指标分型

**Opening Scene（开场）**  
周宁收到告警：近期某段窗口内断流上升，且工具闭环成功率下滑。多跳链路里最怕的就是“谁的问题说不清”，最终只能全链路背锅。

**Rising Action（推进）**  
他按 mix2api 的观测维度拆解问题：
- 按 `client` 分开看（OpenCode vs Claude Code）
- 按 `stream`、`tools_present` 分开看
- 聚合 Top `end_reason` 与对应的 upstream/http 状态

**Climax（关键时刻）**  
在 10–15 分钟滑窗内触发回滚条件（例如 adapter_error、5xx、非 client_abort 断流之一超阈值），周宁快速执行“一键止血”：
- 通过 new-api 权重把 canary 回滚到 0%（或从 canary 切回 stable）
- 确认回滚后指标恢复，并保留可复盘证据（请求样本与分型数据）

**Resolution（结局/新现实）**  
回滚不是失败，而是系统设计的一部分：先恢复可用性，再用 Top `end_reason` 驱动修复优先级。  
同时，由于 Redis 默认开启且 stable/canary 共享，灰度过程中不会因为实例漂移导致会话随机失败，排障信号更干净，迭代节奏可持续。

**可能出错点与恢复路径（平台视角）**  
- 会话漂移/串话：要求 session key 按 auth 指纹或显式 header 隔离；schemaVersion 前后兼容；解析失败按 miss 新会话降级。  
- 指标口径不一致：统一以服务端 `end_reason` 与固定维度统计，避免客户端侧误判影响决策。

### Journey Requirements Summary

从以上旅程中抽取的能力需求（用于后续 FR/NFR）：

- **兼容契约**：`/v1/chat/completions`（含 `stream` + `tools/tool_calls`）语义可预测、可回归
- **Streaming 稳定性**：SSE 事件顺序/结束信号一致；能识别并排除 `client_abort`；断流可归因
- **工具闭环状态机**：严格保证 tool loop；`tool_call_id` 全链路一致；回填后必须继续生成
- **可观测/归因**：`request_id`、`end_reason`、`client/stream/tools_present/http_status/upstream_status` 作为最小必备维度
- **灰度与回滚**：支持 stable/canary + new-api 权重灰度；短窗阈值触发回滚可执行、可复盘
- **最小状态 + Redis 默认开启**：共享 Redis 保证多实例一致性；schemaVersion 兼容；解析失败降级为 miss；会话隔离避免串话
- **安全与数据治理底线**：只信任 new-api 入站；敏感信息默认脱敏（尤其是鉴权/会话标识相关）

---

## Domain-Specific Requirements

### Compliance & Regulatory

- **合规框架**：MVP 阶段不强制对齐外部合规框架（如等保/ISO27001/SOC2）作为硬门槛。
- **服务定位**：mix2api 定位为内部适配层（不面向公众）。若未来对外提供服务或跨区域交付，再补充合规评估与审计要求。

### Technical Constraints

- **内网边界**：mix2api **仅允许 new-api 内网调用**，禁止公网直连。
- **入站鉴权**：基于 service-to-service 认证（例如共享 secret header 或 mTLS）作为入站硬门槛；不信任任意直连请求。
- **敏感数据最小化**：
  - 默认 **不落盘** prompts/代码片段/tool 参数与 tool 结果，仅保留指标与必要的脱敏字段。
  - **可选采样留痕**（仅用于问题复现/排障）：保留期 **1 天**，到期自动删除；对 Authorization/cookie/token/sessionId 等做字段级脱敏。
- **日志与观测脱敏**：对日志/观测链路进行字段级 redaction（Authorization、cookie、上游 token、session_id、以及 tool payload 中可能出现的密钥/凭证）。
- **会话与隔离**：
  - session key 按 auth 指纹/显式 header 隔离，避免跨渠道串话。
  - Redis（默认开启）schemaVersion 前后兼容（只增不改）；解析失败/未知版本按 miss 自动新会话降级。

### Integration Requirements

- **与 new-api 的集成**：
  - 支持 stable/canary 双通道 + 权重灰度/回滚。
  - 请求需可区分 client（OpenCode/Claude Code）并支持按维度统计（client×stream×tools）。
- **与上游模型网站的集成**：
  - token 生命周期（获取/续期/失败重登）。
  - 上游 sessionId/exchangeId 的提取与复用。
- **Redis**：默认开启并与 stable/canary 共享，仅承载最小必要状态（token/session 等）以支撑灰度一致性。

### Risk Mitigations

- **断流/缓冲风险**：链路（网关/反代）必须对 SSE 友好（禁用缓冲、合理超时），避免“半截断/卡住/无完成信号”。
- **工具生态风险**：MVP 保持 MCP-safe（不执行 MCP 工具），防止越权与供应链风险；服务端 MCP Gateway 另立项并单独验收。
- **故障止损**：按短窗阈值触发回滚，先恢复体验；回滚后基于 `end_reason` 分型定位根因并驱动修复。

---

## API Backend Specific Requirements

### Project-Type Overview

mix2api 是部署在 new-api 之后的内部 API backend/provider：北向提供 OpenAI `/v1/chat/completions` 的语义兼容实现（重点：`stream` 不断流 + `tools/tool_calls` 闭环），南向适配自建模型网站的 token/session/错误形态，并以可观测、可灰度、可回滚为第一优先级。

### Technical Architecture Considerations

- **契约优先**：以 OpenAI Chat Completions 的语义为北向契约（SSE 增量、结束信号、tool loop 状态机），不仅字段对齐。
- **最小状态**：默认尽量无状态；可选/默认启用 Redis 存储最小会话与上游登录态（stable/canary 共享，避免灰度漂移）。
- **归因可观测**：每请求具备 `x-request-id`；按 `client×stream×tools_present×end_reason` 维度统计与排障归因。
- **SSE 友好链路**：反代禁用缓冲、合理超时；服务端及时 flush，确保 `data: ...\n\n` 与 `[DONE]` 正常送达。

### Endpoint Specs

- `POST /v1/chat/completions`：核心业务端点（支持 `stream`、`tools/tool_calls`、legacy `functions/function_call`）。
- `POST /`：兼容 new-api 直连根路径的调用方式（语义同上）。
- `GET /v1/models`：OpenAI 兼容模型列表（IDE/SDK 探测用）。
- `GET /health`：健康检查（用于容器/负载均衡探活）。

### Auth Model

- **入站鉴权（new-api → mix2api）**：内网调用 + 共享 secret header（推荐 `Authorization: Bearer <token>`）；可选开启静态校验（只允许指定 token）。
- **会话隔离 key**：
  - 优先：显式 header（例如 `x-session-key`）做隔离；
  - 兜底：使用入站 token 的 hash 指纹做隔离（不得存储/输出原文）。
- **敏感信息处理**：Authorization、cookie、上游 token、session 标识等必须 redaction；默认不落盘 prompts/tool payload。
- **上游鉴权**：由 mix2api 管理 token 生命周期（获取/续期/失败重登），避免把上游登录态复杂度外溢给客户端。

### Data Schemas

- **请求体**：兼容 OpenAI Chat Completions JSON
  - 必须：`model`、`messages[]`
  - 支持：`stream`、`tools` + `tool_choice`
  - 同时兼容 legacy：`functions` + `function_call`
- **响应体（非流式）**：兼容 `chat.completion`；支持 `assistant.tool_calls[]`（或 legacy `assistant.function_call`）。
- **响应体（流式）**：SSE `text/event-stream`
  - 按 `data: {chunk}\n\n` 输出 `chat.completion.chunk`
  - 正常结束必须发送 `data: [DONE]\n\n`
- **Tool Loop 语义**：出现 tools 时必须保证闭环：
  - `assistant(tool_calls) → tool(result) → assistant(final)`
  - `tool_call_id` 全链路一致，回填后必须继续生成（不得卡死/提前 stop）。

### Error Codes

- **北向错误形态**：对齐 OpenAI error envelope（`error.message/type/code/param`）与正确 HTTP status（400/401/429/5xx 等）。
- **归因不破坏兼容**：`end_reason` 用于日志/指标归因；对外响应保持 OpenAI 兼容（必要信息优先放在日志/指标/响应 header）。

### Rate Limits

- **不在 mix2api 叠加业务限流**：配额/Key/限流/计费由 new-api 负责。
- **基础保护**：保留可配置的 body size limit、上游超时、并发上限与 SSE 相关超时（稳定性保护）。

### API Docs

- **README**：new-api provider 接入说明（鉴权、环境变量、灰度/回滚），以及最小回归包 A/B/C 的 curl 示例（含 stream+tools）。
- **OpenAPI Spec**：提供 OpenAPI 3.0 文档覆盖 `/v1/chat/completions`、`/v1/models`、`/health`（含 streaming `text/event-stream` 示例）。

### Implementation Considerations

- **版本策略**：北向只提供 `/v1`；变更以“向后兼容优先”，必要时用新 major/新端点隔离。
- **client 维度**：支持从 `User-Agent`/显式 header 推断 client（OpenCode/Claude Code），用于分别统计与验收。

---

## Functional Requirements

### 北向 API 兼容层（OpenAI Chat Completions）

- FR1: 客户端（OpenCode/Claude Code）可以通过 `POST /v1/chat/completions` 发起 Chat Completions 请求并获得 OpenAI 兼容响应。
- FR2: 系统可以对请求体进行基础校验（例如 `messages` 非空数组）并对无效请求返回兼容错误响应。
- FR3: 客户端可以在同一端点通过 `stream` 参数选择流式或非流式响应模式。
- FR4: 客户端可以通过 `POST /` 以兼容入口获得与 `/v1/chat/completions` 等价的行为。
- FR5: 客户端可以通过 `GET /v1/models` 获取 OpenAI 兼容格式的模型列表。
- FR6: 平台工程师可以通过 `GET /health` 获取服务健康状态。
- FR7: 平台工程师可以配置系统对外暴露的模型列表（用于 IDE/SDK 探测与回归）。

### Streaming（SSE）与连接生命周期

- FR8: 客户端在 `stream=true` 时可以以 `text/event-stream` 接收增量输出（符合 OpenAI SSE 语义）。
- FR9: 系统可以在流式响应结束时发送明确的完成信号（包含 `[DONE]` 语义）。
- FR10: 系统可以在客户端主动断开连接时识别为 `client_abort` 并停止处理与释放资源。
- FR11: 系统可以在上游异常/超时/中断时结束流并向客户端提供兼容的失败响应或终止信号（可区分非 `client_abort`）。
- FR12: 平台工程师可以按 `client` 与 `stream` 维度定位流式相关故障类别（不断流验收所需）。

### 工具调用与函数调用（tools 闭环 + legacy 兼容）

- FR13: 客户端可以在请求中提供 `tools` 并让模型以 OpenAI 规范输出 `tool_calls`。
- FR14: 客户端可以使用 legacy `functions/function_call` 格式进行函数调用并获得兼容响应。
- FR15: 系统可以在响应中返回 OpenAI 兼容的 `assistant.tool_calls[]`，并包含可用于关联的 `tool_call_id`。
- FR16: 客户端可以在后续请求中提交 `tool` 角色消息（包含 `tool_call_id` 与结果）并让系统继续生成后续 assistant 内容。
- FR17: 系统可以在需要工具的对话中保持“工具闭环”语义一致（不会出现回填后不继续/提前结束/状态错乱）。
- FR18: 系统在不执行客户端工具的前提下，可以保持工具 schema/消息结构兼容，确保 MCP 相关工具链路不被破坏（MCP-safe）。

### 会话、最小状态与隔离

- FR19: 客户端可以显式提供 `session_id`（通过 header/body/metadata 任一）以复用上游会话。
- FR20: 当客户端未提供 `session_id` 时，系统可以自动创建并复用上游会话以支持多轮对话（尤其 OpenCode）。
- FR21: 系统可以按显式 `session key` header 或鉴权指纹实现会话隔离，避免不同 caller/环境串话。
- FR22: 系统可以在多实例/多通道（stable/canary）部署下共享并复用会话状态，避免灰度漂移导致对话中断。
- FR23: 系统可以对会话状态采用版本化 schema，并在解析失败/未知版本时降级为新会话（而非让请求失败）。

### 入站鉴权、上游访问与安全边界

- FR24: 系统可以对入站请求实施 service-to-service 鉴权并拒绝未授权访问（内部调用边界）。
- FR25: 平台工程师可以配置入站鉴权策略（启用/关闭/静态校验）以适配不同环境。
- FR26: 系统可以管理上游鉴权凭据的生命周期（获取/续期/失效恢复）并在调用上游时携带正确凭据。
- FR27: 系统可以在不暴露敏感信息的前提下完成会话隔离与上游访问（禁止在日志/响应中输出 token 原文）。

### 错误响应与归因（北向契约）

- FR28: 系统可以对客户端返回 OpenAI 兼容的错误 envelope（含正确 HTTP status 与 `error` 字段结构）。
- FR29: 系统可以对上游错误、适配错误、超时、取消等情况进行分类并产出稳定的 `end_reason`（用于归因与统计）。
- FR30: 客户端可以通过 `x-request-id` 关联一次请求的错误与归因信息以支持排障。

### 可观测、留痕与运维协作

- FR31: 系统可以为每个请求生成并返回唯一 `request_id`，并在日志/指标中全链路关联。
- FR32: 平台工程师可以按 `client×stream×tools_present×end_reason×http_status×upstream_status` 查看指标与分型统计（用于分别验收与回滚决策）。
- FR33: 系统默认仅记录必要的结构化指标与脱敏后的日志，不持久化 prompts/tool payload。
- FR34: 平台工程师可以启用“可选采样留痕”用于复现与排障，并配置 1 天保留期与到期删除。
- FR35: 系统可以对日志与留痕数据进行字段级脱敏（Authorization/cookie/token/session 等）。

### 文档与回归（可验收交付物）

- FR36: AI 工程师可以获得接入文档（README）以完成 new-api provider 配置与本地/内网验证。
- FR37: AI 工程师可以获得 OpenAPI 3.0 规范文档用于集成与契约校验。
- FR38: 团队可以运行最小回归包 A/B/C（覆盖 stream、tools、取消/超时）并作为发布门禁。

---

## Non-Functional Requirements

### Reliability & Streaming Quality

- NFR1: 系统必须满足 PRD「Success Criteria / Measurable Outcomes」中定义的 MVP SLO（rolling 24h、按 client 分开统计、排除 `client_abort`）。
- NFR2: `stream=true` 的输出必须符合 OpenAI SSE 语义（`text/event-stream`、增量可消费、完成信号明确）；在 rolling 24h 且排除 `client_abort` 口径下，`stream=true` 的 `[DONE]` 发出覆盖率必须 ≥ 99.5%，并且断流率必须 ≤ 0.5%。
- NFR3: 任何非 `client_abort` 的流式异常终止都必须被归因（`end_reason`），并进入断流统计口径，用于灰度回滚决策与复盘。
- NFR4: 工具链路在流式与非流式下的行为必须一致：tool loop 可闭环、回填后可继续生成；在 rolling 24h 且排除 `client_abort` 口径下，出现 `tool_calls` 的请求闭环成功率必须 ≥ 97.0%，并且工具链路回归包（B）在 stable/canary 的通过率必须为 100%。

### Observability & Attribution

- NFR5: 每个请求必须具备可关联的 `request_id`（对客户端返回 `x-request-id`，并在服务端日志/指标中可检索）。
- NFR6: 系统必须产出可计算 SLO 的最小观测字段：`client`、`stream`、`tools_present`、`end_reason`、`http_status`、`upstream_status`（可通过结构化日志或指标系统获取，形式不限但必须可聚合）。
- NFR7: 归因口径必须稳定且可复盘：在 rolling 24h 且排除 `client_abort` 口径下，`end_reason != unknown` 的归因覆盖率必须 ≥ 99%；同类故障在不同 client/不同发布通道的 `end_reason` 漂移率必须 ≤ 5%。

### Security & Data Governance

- NFR8: 服务仅允许内网调用，并强制 service-to-service 鉴权（共享 secret header 等）；任何未授权请求必须被拒绝。
- NFR9: 默认不持久化 prompts、tool 参数与 tool 结果；仅记录必要的结构化指标与脱敏日志。
- NFR10: 可选采样留痕必须支持“保留 1 天并到期删除”，并对 Authorization/cookie/token/session 等敏感字段进行字段级脱敏。
- NFR11: 敏感信息不得以明文出现在日志、指标标签、错误响应体中（仅允许脱敏后的指纹/摘要）。

### Compatibility & Regression Safety

- NFR12: 北向契约变更必须“向后兼容优先”（字段/行为尽量只增不改）；任何契约调整必须通过最小回归包 A/B/C（stable 与 canary）验证。
- NFR13: 兼容范围以 OpenAI Chat Completions 为准（含 streaming 与 tools/legacy functions）；每次发布前，最小回归包 A/B/C 在 stable 与 canary 的通过率必须为 100%，并且北向契约破坏性变更必须为 0。
- NFR14: MCP-safe 是底线：不得破坏客户端工具形态/消息结构；MCP 相关工具链路（仅透传场景）回归通过率必须为 100%，并且服务端工具执行事件计数必须为 0（MVP 阶段）。

### Operability, Release & Rollback

- NFR15: 灰度发布必须支持 stable/canary 双通道与权重灰度，并在触发阈值后 **≤10 分钟**完成权重回滚到 0%（或切回 stable）。
- NFR16: 每次回滚必须具备可复盘证据（指标分型 + 关键样本/日志关联 `request_id`），以支撑“先止血、后归因修复”的工作流。
- NFR17: 运行参数（鉴权模式、会话隔离、最小状态存储开关/连接、采样留痕开关、超时等）必须可配置并可在不改代码的情况下调整；配置项文档覆盖率必须为 100%，并且配置生效验证（重启后）通过率必须为 100%。
