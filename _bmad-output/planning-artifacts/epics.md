---
stepsCompleted:
  - 'step-01-validate-prerequisites'
  - 'step-02-design-epics'
  - 'step-03-create-stories'
  - 'step-04-final-validation'
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
---

# mix2api - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for mix2api, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: 客户端（OpenCode/Claude Code）可以通过 `POST /v1/chat/completions` 发起 Chat Completions 请求并获得 OpenAI 兼容响应。
FR2: 系统可以对请求体进行基础校验（例如 `messages` 非空数组）并对无效请求返回兼容错误响应。
FR3: 客户端可以在同一端点通过 `stream` 参数选择流式或非流式响应模式。
FR4: 客户端可以通过 `POST /` 以兼容入口获得与 `/v1/chat/completions` 等价的行为。
FR5: 客户端可以通过 `GET /v1/models` 获取 OpenAI 兼容格式的模型列表。
FR6: 平台工程师可以通过 `GET /health` 获取服务健康状态。
FR7: 平台工程师可以配置系统对外暴露的模型列表（用于 IDE/SDK 探测与回归）。
FR8: 客户端在 `stream=true` 时可以以 `text/event-stream` 接收增量输出（符合 OpenAI SSE 语义）。
FR9: 系统可以在流式响应结束时发送明确的完成信号（包含 `[DONE]` 语义）。
FR10: 系统可以在客户端主动断开连接时识别为 `client_abort` 并停止处理与释放资源。
FR11: 系统可以在上游异常/超时/中断时结束流并向客户端提供兼容的失败响应或终止信号（可区分非 `client_abort`）。
FR12: 平台工程师可以按 `client` 与 `stream` 维度定位流式相关故障类别（不断流验收所需）。
FR13: 客户端可以在请求中提供 `tools` 并让模型以 OpenAI 规范输出 `tool_calls`。
FR14: 客户端可以使用 legacy `functions/function_call` 格式进行函数调用并获得兼容响应。
FR15: 系统可以在响应中返回 OpenAI 兼容的 `assistant.tool_calls[]`，并包含可用于关联的 `tool_call_id`。
FR16: 客户端可以在后续请求中提交 `tool` 角色消息（包含 `tool_call_id` 与结果）并让系统继续生成后续 assistant 内容。
FR17: 系统可以在需要工具的对话中保持“工具闭环”语义一致（不会出现回填后不继续/提前结束/状态错乱）。
FR18: 系统在不执行客户端工具的前提下，可以保持工具 schema/消息结构兼容，确保 MCP 相关工具链路不被破坏（MCP-safe）。
FR19: 客户端可以显式提供 `session_id`（通过 header/body/metadata 任一）以复用上游会话。
FR20: 当客户端未提供 `session_id` 时，系统可以自动创建并复用上游会话以支持多轮对话（尤其 OpenCode）。
FR21: 系统可以按显式 `session key` header 或鉴权指纹实现会话隔离，避免不同 caller/环境串话。
FR22: 系统可以在多实例/多通道（stable/canary）部署下共享并复用会话状态，避免灰度漂移导致对话中断。
FR23: 系统可以对会话状态采用版本化 schema，并在解析失败/未知版本时降级为新会话（而非让请求失败）。
FR24: 系统可以对入站请求实施 service-to-service 鉴权并拒绝未授权访问（内部调用边界）。
FR25: 平台工程师可以配置入站鉴权策略（启用/关闭/静态校验）以适配不同环境。
FR26: 系统可以管理上游鉴权凭据的生命周期（获取/续期/失效恢复）并在调用上游时携带正确凭据。
FR27: 系统可以在不暴露敏感信息的前提下完成会话隔离与上游访问（禁止在日志/响应中输出 token 原文）。
FR28: 系统可以对客户端返回 OpenAI 兼容的错误 envelope（含正确 HTTP status 与 `error` 字段结构）。
FR29: 系统可以对上游错误、适配错误、超时、取消等情况进行分类并产出稳定的 `end_reason`（用于归因与统计）。
FR30: 客户端可以通过 `x-request-id` 关联一次请求的错误与归因信息以支持排障。
FR31: 系统可以为每个请求生成并返回唯一 `request_id`，并在日志/指标中全链路关联。
FR32: 平台工程师可以按 `client×stream×tools_present×end_reason×http_status×upstream_status` 查看指标与分型统计（用于分别验收与回滚决策）。
FR33: 系统默认仅记录必要的结构化指标与脱敏后的日志，不持久化 prompts/tool payload。
FR34: 平台工程师可以启用“可选采样留痕”用于复现与排障，并配置 1 天保留期与到期删除。
FR35: 系统可以对日志与留痕数据进行字段级脱敏（Authorization/cookie/token/session 等）。
FR36: AI 工程师可以获得接入文档（README）以完成 new-api provider 配置与本地/内网验证。
FR37: AI 工程师可以获得 OpenAPI 3.0 规范文档用于集成与契约校验。
FR38: 团队可以运行最小回归包 A/B/C（覆盖 stream、tools、取消/超时）并作为发布门禁。
FR39: 系统可以维护每个模型的能力画像（context window、最大输入令牌、最大新令牌）并支持配置化管理。
FR40: 系统可以在请求进入上游前按模型能力画像计算输入/输出令牌预算并执行预检。
FR41: 系统可以在输入超预算时按策略执行上下文裁剪（保留关键消息、丢弃低价值历史、可选摘要压缩）。
FR42: 系统可以将客户端 `max_tokens` / `max_completion_tokens` 等参数映射为上游约束并做保护性裁剪。
FR43: 平台工程师可以观测上下文预算与裁剪结果（触发次数、裁剪比例、拒绝原因）并按模型统计。
FR44: 团队可以通过多模型上下文回归用例验证不同窗口与令牌上限下的一致性与稳定性。

### NonFunctional Requirements

NFR1: 系统必须满足 PRD「Success Criteria / Measurable Outcomes」中定义的 MVP SLO（rolling 24h、按 client 分开统计、排除 `client_abort`）。
NFR2: `stream=true` 的输出必须符合 OpenAI SSE 语义（`text/event-stream`、增量可消费、完成信号明确）；在 rolling 24h 且排除 `client_abort` 口径下，`stream=true` 的 `[DONE]` 发出覆盖率必须 ≥ 99.5%，并且断流率必须 ≤ 0.5%。
NFR3: 任何非 `client_abort` 的流式异常终止都必须被归因（`end_reason`），并进入断流统计口径，用于灰度回滚决策与复盘。
NFR4: 工具链路在流式与非流式下的行为必须一致：tool loop 可闭环、回填后可继续生成；在 rolling 24h 且排除 `client_abort` 口径下，出现 `tool_calls` 的请求闭环成功率必须 ≥ 97.0%，并且工具链路回归包（B）在 stable/canary 的通过率必须为 100%。
NFR5: 每个请求必须具备可关联的 `request_id`（对客户端返回 `x-request-id`，并在服务端日志/指标中可检索）。
NFR6: 系统必须产出可计算 SLO 的最小观测字段：`client`、`stream`、`tools_present`、`end_reason`、`http_status`、`upstream_status`（可通过结构化日志或指标系统获取，形式不限但必须可聚合）。
NFR7: 归因口径必须稳定且可复盘：在 rolling 24h 且排除 `client_abort` 口径下，`end_reason != unknown` 的归因覆盖率必须 ≥ 99%；同类故障在不同 client/不同发布通道的 `end_reason` 漂移率必须 ≤ 5%。
NFR8: 服务仅允许内网调用，并强制 service-to-service 鉴权（共享 secret header 等）；任何未授权请求必须被拒绝。
NFR9: 默认不持久化 prompts、tool 参数与 tool 结果；仅记录必要的结构化指标与脱敏日志。
NFR10: 可选采样留痕必须支持“保留 1 天并到期删除”，并对 Authorization/cookie/token/session 等敏感字段进行字段级脱敏。
NFR11: 敏感信息不得以明文出现在日志、指标标签、错误响应体中（仅允许脱敏后的指纹/摘要）。
NFR12: 北向契约变更必须“向后兼容优先”（字段/行为尽量只增不改）；任何契约调整必须通过最小回归包 A/B/C（stable 与 canary）验证。
NFR13: 兼容范围以 OpenAI Chat Completions 为准（含 streaming 与 tools/legacy functions）；每次发布前，最小回归包 A/B/C 在 stable 与 canary 的通过率必须为 100%，并且北向契约破坏性变更必须为 0。
NFR14: MCP-safe 是底线：不得破坏客户端工具形态/消息结构；MCP 相关工具链路（仅透传场景）回归通过率必须为 100%，并且服务端工具执行事件计数必须为 0（MVP 阶段）。
NFR15: 灰度发布必须支持 stable/canary 双通道与权重灰度，并在触发阈值后 **≤10 分钟**完成权重回滚到 0%（或切回 stable）。
NFR16: 每次回滚必须具备可复盘证据（指标分型 + 关键样本/日志关联 `request_id`），以支撑“先止血、后归因修复”的工作流。
NFR17: 运行参数（鉴权模式、会话隔离、最小状态存储开关/连接、采样留痕开关、超时等）必须可配置并可在不改代码的情况下调整；配置项文档覆盖率必须为 100%，并且配置生效验证（重启后）通过率必须为 100%。

### Additional Requirements

- Starter Template（来自架构决策）：采用 Express Brownfield Baseline（不切换新框架）；如需对照脚手架，参考命令 `npx express-generator@4.16.1 --no-view --git mix2api`。
- 北向契约聚焦 Chat Completions：核心端点 `POST /v1/chat/completions`，并保留 `POST /` 兼容入口、`GET /v1/models`、`GET /health`。
- Streaming 语义必须稳定：SSE 实时 flush、禁缓冲、事件顺序可消费、结束必须发送 `[DONE]`，并区分 `client_abort`。
- Tool Loop 需严格闭环：`assistant(tool_calls) -> tool(result) -> assistant(final)`；`tool_call_id` 全链路一致，回填后必须继续生成。
- MCP-safe 边界：MVP 不执行服务端 MCP，仅保证 tools/消息结构兼容透传。
- 入站安全边界：仅允许 new-api 内网调用；MVP 使用 S2S shared secret header，未授权请求必须拒绝（mTLS 后置）。
- 状态策略：Redis 默认开启并由 stable/canary 共享，仅存最小必要状态（session/token meta），降低灰度会话漂移。
- 会话隔离与版本：session key 按 `auth_fingerprint + model + client`（支持显式 header 覆盖）；`schemaVersion` 只增不改，解析失败/未知版本按 miss 新建会话。
- 可观测基线：所有请求返回 `x-request-id`；统一归因字段 `end_reason` 与最小维度 `client/stream/tools_present/http_status/upstream_status`。
- 数据治理：默认不持久化 prompts/tool payload；可选采样留痕保留 1 天并自动清理；Authorization/cookie/token/session 全链路字段级脱敏。
- 发布策略：stable/canary 双通道 + new-api 权重灰度（0→5→20→50→100），触发阈值后需支持 ≤10 分钟回滚。
- 质量门禁：最小回归包 A/B/C（stream、tools-loop、cancel/timeout）需在 stable/canary 全绿后放量。

### FR Coverage Map

FR1: Epic 1 - Chat Completions 兼容入口
FR2: Epic 1 - 入参校验与兼容错误
FR3: Epic 1 - stream/非 stream 模式切换
FR4: Epic 1 - 根路径兼容入口
FR5: Epic 1 - 模型列表探测
FR6: Epic 1 - 健康检查
FR7: Epic 1 - 模型列表可配置
FR8: Epic 3 - SSE 增量输出
FR9: Epic 3 - `[DONE]` 完成信号
FR10: Epic 3 - `client_abort` 识别与释放
FR11: Epic 3 - 流式异常终止处理
FR12: Epic 3 - client/stream 维度故障定位
FR13: Epic 4 - tools 输入支持
FR14: Epic 4 - legacy functions 兼容
FR15: Epic 4 - tool_calls 与 tool_call_id 输出
FR16: Epic 4 - tool 回填后继续生成
FR17: Epic 4 - 工具闭环一致性
FR18: Epic 4 - MCP-safe 透传兼容
FR19: Epic 2 - 显式 session 复用
FR20: Epic 2 - 自动 session 创建与复用
FR21: Epic 2 - 会话隔离
FR22: Epic 2 - stable/canary 状态共享
FR23: Epic 2 - schemaVersion 降级策略
FR24: Epic 1 - 入站 S2S 鉴权
FR25: Epic 1 - 鉴权策略可配置
FR26: Epic 2 - 上游 token 生命周期管理
FR27: Epic 2 - 敏感信息保护下的上游访问
FR28: Epic 1 - OpenAI 兼容错误 envelope
FR29: Epic 3 - end_reason 分类归因
FR30: Epic 3 - `x-request-id` 排障关联
FR31: Epic 3 - request_id 全链路关联
FR32: Epic 3 - 多维指标分型统计
FR33: Epic 5 - 最小化日志与不落盘策略
FR34: Epic 5 - 可选采样留痕与保留期
FR35: Epic 5 - 字段级脱敏
FR36: Epic 5 - README 接入文档
FR37: Epic 5 - OpenAPI 文档
FR38: Epic 5 - 回归包 A/B/C 门禁
FR39: Epic 6 - 模型能力画像管理
FR40: Epic 6 - 令牌预算预检
FR41: Epic 6 - 上下文裁剪与压缩策略
FR42: Epic 6 - 输出令牌参数映射与保护
FR43: Epic 6 - 上下文预算观测
FR44: Epic 6 - 多模型上下文回归

## Epic List

### Epic 1: 安全接入与基础对话可用
AI 工程师和平台工程师可以安全接入并完成基础 Chat Completions 能力验证（含基础端点与兼容错误形态）。
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR24, FR25, FR28

### Epic 2: 会话连续性与上游访问稳定
AI 工程师可以在多轮对话与灰度切流场景下保持会话连续，且上游凭据生命周期可稳定管理。
**FRs covered:** FR19, FR20, FR21, FR22, FR23, FR26, FR27

### Epic 3: 流式稳定与可归因排障
AI 工程师可获得不断流体验；平台工程师可基于统一归因与请求链路快速定位问题。
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR29, FR30, FR31, FR32

### Epic 4: 工具闭环与 MCP-safe 兼容
AI 工程师可稳定完成 tools/legacy functions 闭环任务，且保持 MCP-safe 语义兼容。
**FRs covered:** FR13, FR14, FR15, FR16, FR17, FR18

### Epic 5: 观测治理与发布门禁
团队可以在脱敏治理前提下进行可回归、可放量、可回滚的工程化发布。
**FRs covered:** FR33, FR34, FR35, FR36, FR37, FR38

### Epic 6: 多模型上下文管理与令牌预算自适配
AI 工程师可以在不同模型约束下稳定完成长对话与工具闭环；平台工程师可以对输入/输出令牌预算进行精细控制与观测。
**FRs covered:** FR39, FR40, FR41, FR42, FR43, FR44

## Epic 1: 安全接入与基础对话可用

AI 工程师和平台工程师可以安全接入并完成基础 Chat Completions 能力验证（含基础端点与兼容错误形态）。

### Story 1.1: 从 Starter Template 初始化项目基线

As a 平台工程师,
I want 按架构选定的 Express Starter Template 初始化项目骨架并完成初始配置,
So that 团队可以在统一基线上快速开始开发与联调.

**Implements:** FR6（基础探活可用）+ Additional Requirement（Starter Template）

**Acceptance Criteria:**

**Given** Architecture 已指定 Express Brownfield Starter  
**When** 执行初始化（模板落地、依赖安装、基础配置）  
**Then** 生成可运行的项目骨架  
**And** 目录与入口满足后续故事扩展需要

**Given** 项目骨架初始化完成  
**When** 启动服务并访问 `GET /health`  
**Then** 返回健康状态  
**And** 可作为后续开发与部署探活基线

### Story 1.2: 入站鉴权与非流式 Chat Completions 入口

As a AI 工程师,
I want 在受控鉴权下使用 `/v1/chat/completions` 发送请求并得到兼容响应,
So that IDE/SDK 可以安全接入并稳定调用基础能力.

**Implements:** FR1, FR2, FR24, FR25, FR28

**Acceptance Criteria:**

**Given** 合法的 Chat Completions 请求（`model` 与 `messages`）  
**When** 调用 `POST /v1/chat/completions` 且 `stream=false`  
**Then** 返回 OpenAI 兼容的非流式响应结构  
**And** 响应字段满足客户端解析要求

**Given** 未授权或鉴权信息错误的请求  
**When** 调用 `POST /v1/chat/completions`  
**Then** 返回未授权错误且中断业务处理  
**And** 错误响应保持兼容 envelope 结构

**Given** 非法请求（如 `messages` 为空）  
**When** 调用端点  
**Then** 返回 OpenAI 兼容 error envelope  
**And** HTTP status 与错误类型一致

### Story 1.3: 流式开关路由与根路径兼容入口

As a AI 工程师,
I want 在同一接口通过 `stream` 选择返回模式并可使用根路径兼容调用,
So that 保持与现有 new-api/provider 调用方式一致.

**Implements:** FR3, FR4

**Acceptance Criteria:**

**Given** `stream` 分别为 `true` 与 `false`  
**When** 调用 `POST /v1/chat/completions`  
**Then** 服务进入对应处理分支  
**And** 响应模式与请求参数一致

**Given** 调用 `POST /` 兼容入口  
**When** 发送与 Chat Completions 等价请求  
**Then** 行为与 `POST /v1/chat/completions` 等价  
**And** 错误处理语义保持一致

### Story 1.4: 模型探测与健康检查端点

As a 平台工程师,
I want 提供可配置的模型列表与健康检查端点,
So that 客户端探测与运维探活可稳定执行.

**Implements:** FR5, FR6, FR7

**Acceptance Criteria:**

**Given** 已配置模型清单  
**When** 调用 `GET /v1/models`  
**Then** 返回 OpenAI 兼容模型列表  
**And** 配置变更可反映到返回内容

**Given** 服务正常运行  
**When** 调用 `GET /health`  
**Then** 返回健康状态  
**And** 可用于容器/负载均衡探活

## Epic 2: 会话连续性与上游访问稳定

AI 工程师可以在多轮对话与灰度切流场景下保持会话连续，且上游凭据生命周期可稳定管理。

### Story 2.1: 会话隔离键与显式会话输入支持

As a AI 工程师,
I want 显式传入 session 信息并在缺省时按规则隔离会话,
So that 多调用方不会串话且可控复用上下文.

**Implements:** FR19, FR21

**Acceptance Criteria:**

**Given** 请求带显式 session 标识  
**When** 发起多轮请求  
**Then** 服务复用同一会话上下文  
**And** 不会被其他调用方污染

**Given** 请求未带显式 session 标识  
**When** 服务生成会话隔离键  
**Then** 使用 `auth_fingerprint + model + client` 规则生成  
**And** 不输出鉴权原文

### Story 2.2: 上游 token 生命周期管理

As a 平台工程师,
I want 统一管理上游 token 的获取、续期与失效恢复,
So that 上游调用稳定且无需客户端承担登录态复杂度.

**Implements:** FR26, FR27

**Acceptance Criteria:**

**Given** 当前无可用上游 token  
**When** 发起需要上游调用的请求  
**Then** 服务自动获取可用 token  
**And** 成功后继续处理请求

**Given** 上游返回 token 失效相关错误  
**When** 服务检测到失效  
**Then** 触发续期或重登流程并重试  
**And** 敏感 token 不以明文写入日志

### Story 2.3: 自动会话创建与上游会话复用

As a AI 工程师,
I want 在未显式提供 session 时自动建立并复用上游会话,
So that OpenCode/Claude Code 多轮对话保持连续.

**Implements:** FR20

**Acceptance Criteria:**

**Given** 首次请求未提供 session  
**When** 调用 Chat Completions  
**Then** 服务自动创建上游会话并保存关联信息  
**And** 后续请求可命中同一会话

**Given** 已存在可复用的 session 映射  
**When** 处理后续对话  
**Then** 使用已有上游 `sessionId/exchangeId`  
**And** 不重复创建新会话

### Story 2.4: Redis 共享状态与 schemaVersion 降级机制

As a 平台工程师,
I want 在 stable/canary 间共享最小状态并处理 schema 兼容,
So that 灰度切流时对话不会因状态漂移而随机失败.

**Implements:** FR22, FR23

**Acceptance Criteria:**

**Given** stable 与 canary 使用同一 Redis  
**When** 请求在不同通道间切换  
**Then** 会话状态可连续读取与复用  
**And** 不因通道切换丢失上下文

**Given** 读取到未知或损坏的 `schemaVersion` 状态  
**When** 服务执行解析  
**Then** 按 miss 降级为新会话而非返回失败  
**And** 记录可观测事件用于排障

## Epic 3: 流式稳定与可归因排障

AI 工程师可获得不断流体验；平台工程师可基于统一归因与请求链路快速定位问题。

### Story 3.1: request_id 贯通与排障关联头

As a 平台工程师,
I want 为每个请求生成并贯通唯一 request_id,
So that 客户端与服务端可以使用同一 ID 快速定位问题.

**Implements:** FR30, FR31

**Acceptance Criteria:**

**Given** 任意请求进入服务  
**When** 请求未携带可用 request_id  
**Then** 服务生成唯一 request_id  
**And** 在响应头返回 `x-request-id`

**Given** 请求处理过程写入日志与指标  
**When** 记录结构化字段  
**Then** 均包含同一 request_id  
**And** 能通过 request_id 检索完整链路事件

### Story 3.2: SSE 稳定输出与完成信号

As a AI 工程师,
I want 在 `stream=true` 时获得稳定的 SSE 增量输出,
So that IDE 端不会出现卡住、半截断或无完成信号.

**Implements:** FR8, FR9

**Acceptance Criteria:**

**Given** `stream=true` 的合法请求  
**When** 上游持续返回增量内容  
**Then** 服务以 `text/event-stream` 实时转发 chunk  
**And** 每个 chunk 保持可消费格式

**Given** 请求正常完成  
**When** 流式输出结束  
**Then** 服务发送 `data: [DONE]` 完成信号  
**And** 连接按预期关闭

### Story 3.3: 流式终止分型与 end_reason 归因

As a 平台工程师,
I want 将流式中断统一分型为稳定 end_reason,
So that 可以区分 `client_abort` 与系统问题并支持回滚决策.

**Implements:** FR10, FR11, FR29

**Acceptance Criteria:**

**Given** 客户端主动断连  
**When** 服务检测连接关闭  
**Then** 归因为 `client_abort` 并释放资源  
**And** 不计入失败口径

**Given** 上游超时、上游错误或适配异常  
**When** 流式处理终止  
**Then** 归因为对应 `end_reason`（如 `timeout`/`upstream_error`/`adapter_error`）  
**And** 写入可聚合观测字段

### Story 3.4: 按 client×stream×tools 维度的指标统计

As a 平台工程师,
I want 生成固定维度的分型指标,
So that 可以对 OpenCode/Claude Code 分别验收并触发灰度决策.

**Implements:** FR12, FR32

**Acceptance Criteria:**

**Given** 请求完成（成功或失败）  
**When** 记录指标事件  
**Then** 至少包含 `client`、`stream`、`tools_present`、`end_reason`、`http_status`、`upstream_status`  
**And** 字段命名与枚举保持稳定

**Given** 需要查看流式故障趋势  
**When** 按 `client` 与 `stream` 聚合  
**Then** 可定位断流或失败类别  
**And** 支持 rollout/rollback 判定

## Epic 4: 工具闭环与 MCP-safe 兼容

AI 工程师可稳定完成 tools/legacy functions 闭环任务，且保持 MCP-safe 语义兼容。

### Story 4.1: tools 与 legacy functions 入参兼容

As a AI 工程师,
I want 同时提交 `tools` 与 legacy `functions/function_call` 格式,
So that 现有不同客户端都可无缝接入.

**Implements:** FR13, FR14

**Acceptance Criteria:**

**Given** 请求使用 `tools` 格式  
**When** 服务解析入参  
**Then** 正确映射到内部调用模型  
**And** 不丢失工具 schema 关键字段

**Given** 请求使用 legacy `functions/function_call`  
**When** 服务解析入参  
**Then** 转换为兼容内部结构  
**And** 与 `tools` 流程行为一致

### Story 4.2: tool_calls 输出与 tool_call_id 一致性

As a AI 工程师,
I want 在 assistant 响应中获得稳定的 `tool_calls` 与 `tool_call_id`,
So that 客户端可以精确执行并回填工具结果.

**Implements:** FR15

**Acceptance Criteria:**

**Given** 模型决定调用工具  
**When** 服务返回 assistant 消息  
**Then** 输出 OpenAI 兼容 `assistant.tool_calls[]`  
**And** 每个调用包含可关联的 `tool_call_id`

**Given** 同一轮存在多个工具调用  
**When** 生成输出  
**Then** `tool_call_id` 唯一且可追踪  
**And** 顺序与语义不冲突

### Story 4.3: tool 结果回填与继续生成闭环

As a AI 工程师,
I want 回填 `role=tool` 结果后模型继续生成最终答复,
So that 工具链任务可以完整结束而非中途卡死.

**Implements:** FR16, FR17

**Acceptance Criteria:**

**Given** 已返回 `assistant.tool_calls` 且客户端回填 `tool` 消息  
**When** 发起下一次请求  
**Then** 服务正确关联 `tool_call_id` 并继续生成  
**And** 不出现提前 stop 或状态错乱

**Given** 回填缺失或不匹配的 `tool_call_id`  
**When** 服务校验消息链  
**Then** 返回兼容错误响应  
**And** 给出可定位的问题类别

### Story 4.4: MCP-safe 透传与服务端执行隔离

As a 平台工程师,
I want 保证 MCP 相关工具形态透传兼容且不在服务端执行,
So that MVP 边界清晰并避免越权执行风险.

**Implements:** FR18

**Acceptance Criteria:**

**Given** 请求包含 MCP 相关工具定义  
**When** 服务处理请求与响应映射  
**Then** 工具形态保持兼容透传  
**And** 不改写关键协议字段语义

**Given** 运行期收到工具执行请求上下文  
**When** 服务进入适配流程  
**Then** 不触发服务端 MCP 执行  
**And** 仅执行协议映射与转发职责

## Epic 5: 观测治理与发布门禁

团队可以在脱敏治理前提下进行可回归、可放量、可回滚的工程化发布。

### Story 5.1: 最小日志策略与字段级脱敏

As a 平台工程师,
I want 默认只记录必要结构化字段并对敏感字段脱敏,
So that 排障可用且不会泄露鉴权或会话敏感信息.

**Implements:** FR33, FR35

**Acceptance Criteria:**

**Given** 请求成功或失败  
**When** 服务记录日志  
**Then** 默认不持久化 prompts/tool payload 原文  
**And** 保留最小观测字段用于统计

**Given** 日志中出现 Authorization/cookie/token/session 等字段  
**When** 脱敏规则生效  
**Then** 输出为脱敏值或摘要  
**And** 不出现明文敏感数据

### Story 5.2: 可选采样留痕与 1 天保留策略

As a 平台工程师,
I want 在需要时开启可选采样留痕并自动过期清理,
So that 能复现复杂问题且控制数据暴露窗口.

**Implements:** FR34

**Acceptance Criteria:**

**Given** 默认配置  
**When** 服务处理请求  
**Then** 采样留痕关闭  
**And** 不额外落盘敏感内容

**Given** 开启采样留痕  
**When** 命中采样策略  
**Then** 仅记录脱敏后的必要样本  
**And** 样本在 1 天后自动删除

### Story 5.3: 接入文档与 OpenAPI 契约文档交付

As a AI 工程师,
I want 获得完整的接入与契约文档,
So that 可以快速完成 provider 配置、联调与回归执行.

**Implements:** FR36, FR37

**Acceptance Criteria:**

**Given** 项目进入可验收阶段  
**When** 查看 README  
**Then** 包含接入步骤、鉴权配置、灰度与回滚说明  
**And** 提供最小回归包 A/B/C 的执行示例

**Given** 需要契约校验  
**When** 查看 OpenAPI 文档  
**Then** 覆盖 `/v1/chat/completions`、`/v1/models`、`/health`  
**And** 包含流式与错误响应示例

### Story 5.4: 回归包 A/B/C 与发布门禁流程

As a 平台工程师,
I want 将回归包 A/B/C 作为放量前门禁,
So that 每次发布都可验证 stream、tools-loop、取消/超时三类关键风险.

**Implements:** FR38

**Acceptance Criteria:**

**Given** stable 与 canary 待发布版本  
**When** 执行回归包 A/B/C  
**Then** 三类用例全部通过  
**And** 结果可用于发布决策记录

**Given** 任一关键回归失败  
**When** 进入发布决策  
**Then** 阻断继续放量或触发回滚流程  
**And** 失败样本可通过 request_id 追踪复盘

## Epic 6: 多模型上下文管理与令牌预算自适配

AI 工程师可以在不同模型约束下稳定完成长对话与工具闭环；平台工程师可以对输入/输出令牌预算进行精细控制与观测。

### Story 6.1: 模型能力画像与令牌上限配置

As a 平台工程师,
I want 为每个模型维护 context window、最大输入令牌、最大新令牌的统一配置,
So that 系统可以基于模型差异执行一致的上下文预算决策.

**Implements:** FR39

**Acceptance Criteria:**

**Given** 已配置多个模型能力画像  
**When** 服务接收对应模型请求  
**Then** 能读取该模型的 `context_window`、`max_input_tokens`、`max_new_tokens`  
**And** 未配置模型走保守默认值并输出告警事件

**Given** 配置被更新  
**When** 服务重新加载配置  
**Then** 新请求按新约束执行预算  
**And** 不影响既有 API 契约形态

### Story 6.2: 动态输入预算计算与请求前预检

As a AI 工程师,
I want 在请求进入上游前完成令牌预算预检,
So that 不会因为模型输入上限差异导致随机超限失败.

**Implements:** FR40

**Acceptance Criteria:**

**Given** 请求包含 `messages`、可选 `tools` 与目标模型  
**When** 服务进行预处理  
**Then** 计算输入估算令牌与可用输入预算  
**And** 为输出预留安全额度

**Given** 客户端请求的输出令牌过大  
**When** 预算计算完成  
**Then** 服务执行保护性裁剪或返回兼容错误  
**And** 返回信息可用于调用方调整参数

### Story 6.3: 历史消息裁剪与可回溯摘要策略

As a AI 工程师,
I want 在超预算时按优先级裁剪历史上下文并可选摘要压缩,
So that 在不同模型窗口下仍能保持对话连续性与关键语义.

**Implements:** FR41

**Acceptance Criteria:**

**Given** 请求输入估算超出模型可用输入预算  
**When** 触发上下文管理策略  
**Then** 保留 `system` 与最新轮次关键消息  
**And** 按策略裁剪较早低价值历史消息

**Given** 裁剪后仍接近上限  
**When** 摘要策略开启  
**Then** 服务将被裁剪历史压缩为短摘要记忆块  
**And** 在观测中记录裁剪与摘要触发信息

### Story 6.4: 输出令牌参数映射与保护

As a 平台工程师,
I want 将客户端输出令牌参数按模型约束映射到上游并做边界保护,
So that 不同模型都能得到可预测的输出长度与稳定行为.

**Implements:** FR42

**Acceptance Criteria:**

**Given** 请求包含 `max_tokens` 或 `max_completion_tokens`  
**When** 服务构造上游请求  
**Then** 按模型 `max_new_tokens` 上限进行映射与裁剪  
**And** 不会把非法或超限值透传给上游

**Given** 请求未指定输出令牌参数  
**When** 服务执行默认策略  
**Then** 使用模型级默认输出预算  
**And** 在流式与非流式下行为一致

### Story 6.5: 多模型上下文观测与回归矩阵

As a 平台工程师,
I want 观测上下文预算执行结果并建立多模型回归矩阵,
So that 可以持续验证上下文管理策略在不同模型上的稳定性.

**Implements:** FR43, FR44

**Acceptance Criteria:**

**Given** 请求经过预算预检与上下文管理  
**When** 记录指标与日志  
**Then** 至少包含 `model`、`input_budget`、`output_budget`、`truncation_applied`、`reject_reason`  
**And** 可按模型聚合查看触发率与失败率

**Given** 发布前执行回归  
**When** 覆盖小窗口与大窗口模型场景  
**Then** 上下文管理相关用例全部通过  
**And** 失败样本可通过 `request_id` 追踪
