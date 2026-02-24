---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/product-brief-mix2api-2026-02-10.md'
  - '_bmad-output/planning-artifacts/research/domain-LLM网关-OpenAIChatCompletions兼容适配层-new-api生态-MCP工具调用生态-research-2026-02-10.md'
  - '_bmad-output/planning-artifacts/research/technical-LLM网关-OpenAIChatCompletions兼容适配层-new-api生态-MCP工具调用生态-research-2026-02-10.md'
  - 'docs/architecture.md'
  - 'docs/session.md'
  - 'docs/tools-mcp-skills.md'
  - '_bmad-output/planning-artifacts/prd-validation-report.md'
  - '_bmad-output/brainstorming/brainstorming-session-2026-02-10.md'
  - '_bmad-output/planning-artifacts/party-mode-session-mix2api-2026-02-11.md'
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-02-11'
project_name: 'mix2api'
user_name: '皇上'
date: '2026-02-11'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
项目共 38 条 FR，已形成清晰的架构分层需求：
- API 兼容层（FR1–FR7）：以 OpenAI Chat Completions 为北向契约，覆盖 `/v1/chat/completions`、`/`、`/v1/models`、`/health`
- Streaming 生命周期（FR8–FR12）：SSE 增量输出、完成信号、`client_abort` 区分、异常终止归因
- Tools 闭环（FR13–FR18）：`tool_calls`/legacy `functions` 兼容、`tool_call_id` 一致、回填后继续生成、MCP-safe
- 会话与状态（FR19–FR23）：显式/自动 session 复用、多实例共享状态、schemaVersion 降级策略
- 鉴权与上游访问（FR24–FR27）：仅受信调用、可配置鉴权策略、上游 token 生命周期管理、敏感信息保护
- 错误与归因（FR28–FR30）：OpenAI 错误 envelope + 稳定 `end_reason` + `x-request-id`
- 可观测与留痕（FR31–FR35）：分维度指标、默认最小日志、可选采样 1 天留痕、字段级脱敏
- 文档与回归（FR36–FR38）：README/OpenAPI/最小回归包 A-B-C 作为发布门禁

**Non-Functional Requirements:**
项目共 17 条 NFR，驱动架构决策的核心约束包括：
- 可靠性与不断流（NFR1–NFR4）：SLO 明确，`[DONE]` 覆盖率、断流率、tool 闭环成功率、回归包通过率均可量化
- 可观测与归因（NFR5–NFR7）：最小观测字段固定，`end_reason` 覆盖率与漂移率有阈值
- 安全与数据治理（NFR8–NFR11）：内网调用、S2S 鉴权、默认不落盘敏感内容、强制脱敏
- 兼容与回归安全（NFR12–NFR14）：向后兼容优先、MCP-safe 底线、破坏性变更为 0
- 运维与发布（NFR15–NFR17）：stable/canary 灰度、回滚时效 ≤10 分钟、配置化运行参数

**Scale & Complexity:**
该项目属于“范围受控但质量门槛高”的后端适配系统：
- 业务范围明确聚焦 Chat Completions，但要求流式、工具闭环、归因、灰度回滚全部可工程化验收
- 多跳链路（OpenCode/Claude Code → new-api → mix2api → 上游模型）提升了一致性与归因复杂度
- 会话最小状态与跨通道一致性（shared Redis）带来状态兼容与隔离要求

- Primary domain: API backend / LLM gateway adapter
- Complexity level: High
- Estimated architectural components: 10

### Technical Constraints & Dependencies

已识别的硬约束与依赖：
- 北向范围：MVP 仅 `POST /v1/chat/completions`（含 stream + tools + legacy functions），不承诺 `/responses`
- 安全边界：仅允许 new-api 内网入站，service-to-service 鉴权
- 工具边界：MVP 仅 MCP-safe（不执行服务端 MCP 工具）
- 状态策略：最小状态外置，Redis 默认开启且 stable/canary 共享；schemaVersion 前后兼容，解析失败按 miss 降级
- 观测口径：rolling 24h，按 client 分开统计，排除 `client_abort`
- 运维策略：new-api 权重灰度（0→5→20→50→100）与短窗自动回滚
- 部署取向：双容器/Compose 优先，不依赖 K8s（来自现有项目文档）

### Cross-Cutting Concerns Identified

会影响多个模块的横切关注点：
- Streaming 语义一致性（SSE flush、结束信号、异常终止与归因）
- Tool loop 状态机一致性（流式/非流式一致、`tool_call_id` 关联稳定）
- 观测与归因统一（`request_id`、`end_reason`、client/stream/tools 维度）
- 安全与数据治理（S2S 鉴权、字段级脱敏、最小留痕）
- 会话一致性与隔离（key 设计、schema 演进、跨通道共享）
- 发布治理（灰度、回滚、回归门禁、证据化复盘）
- 兼容性治理（OpenAI 契约稳定、MCP-safe、破坏性变更控制）

## Starter Template Evaluation

### Primary Technology Domain

API/Backend（LLM 网关适配层） based on project requirements analysis

### Starter Options Considered

1) Express Generator（`express-generator@4.16.1`）
- 优点：与当前仓库（Express 单体服务）一致，迁移风险最低，最适合 2 周 MVP 快速交付
- 风险：脚手架更新节奏较慢，默认结构较基础，需要手动补齐测试/规范化目录

2) Fastify CLI（`fastify-cli@7.4.1`）
- 优点：更现代的性能与插件生态，对高并发 SSE 有潜在收益
- 风险：从现有 Express 迁移成本更高，MVP 周期内会挤占“不断流 + tools 闭环”核心目标

3) Nest CLI（`@nestjs/cli@11.0.16`）
- 优点：工程化与模块化完善，长期大型团队协作友好
- 风险：引入框架治理成本高，不符合当前“短期必达 + 最小变更”策略

### Selected Starter: Express Brownfield Baseline（不切换新框架）

**Rationale for Selection:**
- 项目是已有代码库，不是 greenfield；当前目标是稳定性与兼容性达标，而非框架升级
- 当前约束（2人/2周、MVP 强调不断流与 tools 闭环）要求优先最小迁移风险
- 保留 Express 便于将工程变更集中在协议语义、SSE、tool loop、观测与回滚机制
- Fastify/Nest 可作为 Post-MVP 重构候选，不阻塞当前验收

**Initialization Command:**

```bash
npx express-generator@4.16.1 --no-view --git mix2api
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
Node.js + JavaScript（CommonJS）基础结构，贴合当前仓库运行时。

**Styling Solution:**
N/A（后端服务，无前端样式决策）。

**Build Tooling:**
最小化 Node 工具链，不引入额外构建复杂度，便于快速聚焦网关语义问题。

**Testing Framework:**
脚手架默认不强制测试体系；建议在实现阶段按回归包 A/B/C 补齐契约与流式回归测试。

**Code Organization:**
提供基础路由/中间件结构，可作为从 `server.js` 向模块化拆分的过渡参考。

**Development Experience:**
上手门槛低，适合当前小团队快速迭代与问题定位；与 Docker/Compose 形态兼容。

**Note:** 当前项目为 brownfield，建议“沿用现有仓库并增量重构”，而不是重新初始化主线代码；上面命令用于新建对照分支或 PoC。

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data Architecture：Redis 作为默认状态存储，内存作为降级路径
- Authentication & Security：仅信任 new-api 的 S2S 入站鉴权 + 全链路脱敏
- API & Communication：OpenAI Chat Completions 语义契约（REST + SSE）
- Infrastructure & Deployment：stable/canary 双通道 + new-api 权重灰度回滚

**Important Decisions (Shape Architecture):**
- 会话 key 设计与隔离维度（auth 指纹 + model + client）
- schemaVersion 前后兼容与解析失败降级策略
- 观测字段标准化（request_id/end_reason/client/stream/tools_present/http_status/upstream_status）
- 保护性并发/超时策略由 mix2api 承担，业务限流继续由 new-api 承担

**Deferred Decisions (Post-MVP):**
- mTLS 入站增强（MVP 先 shared secret header）
- OTel 全链路 trace 深度集成（MVP 先结构化日志 + 指标）
- `/responses` 兼容桥接与服务端 MCP Gateway（保持独立立项）

### Data Architecture

- **Decision:** Redis（默认）+ 内存降级
- **Version:** Redis 8.x 线（以官方 releases 跟进稳定小版本）
- **Rationale:** 满足 stable/canary 共享状态、降低会话漂移，并支持最小状态外置
- **Affects:** 会话复用、token 生命周期、灰度一致性、故障恢复
- **Provided by Starter:** No

**Data Modeling Approach:**
- session key：`auth_fingerprint + model + client`（支持显式覆盖 header）
- session value：`sessionId/exchangeId/token_meta/schemaVersion/timestamp/turnCount`
- schema 策略：只增不改；未知版本或解析失败按 miss 新建会话

**Data Validation Strategy:**
- 入站请求体按 OpenAI Chat Completions 必填/可选字段校验
- 会话对象按 schemaVersion 验证，不合法对象直接降级

**Migration Approach:**
- 灰度阶段 stable/canary 共享同 Redis
- 变更先向后兼容，再放量，异常触发回滚

**Caching Strategy:**
- 不缓存模型正文输出
- 仅缓存最小必要会话与上游登录态元数据

### Authentication & Security

- **Decision:** S2S shared secret header（MVP），预留 mTLS（Post-MVP）
- **Version:** Node/Express 中间件校验（与当前 brownfield 基线一致）
- **Rationale:** 满足“仅 new-api 内网入站”边界，快速达成 MVP
- **Affects:** 入站访问控制、审计边界、数据合规
- **Provided by Starter:** No

**Authorization Patterns:**
- 仅允许受信来源调用 mix2api
- 未授权请求直接拒绝并产生日志归因

**Security Middleware:**
- 统一 request-id 注入
- 统一敏感字段脱敏（Authorization/cookie/token/session）

**Data Encryption Approach:**
- 传输层依赖内网 TLS/反向代理
- 敏感标识只保留 hash/fingerprint，不落明文

**API Security Strategy:**
- 默认不持久化 prompts/tool payload
- 可选采样留痕保留 1 天并自动清理

### API & Communication Patterns

- **Decision:** REST + SSE（OpenAI Chat Completions 语义优先）
- **Version:** OpenAI-compatible `/v1/chat/completions`（MVP）
- **Rationale:** 与既有客户端/new-api 生态契合，降低协议切换风险
- **Affects:** 客户端兼容性、工具闭环稳定性、断流归因
- **Provided by Starter:** Partial（Express 仅提供基础 HTTP 框架）

**API Design Patterns:**
- 核心端点：`POST /v1/chat/completions`
- 辅助端点：`GET /v1/models`、`GET /health`、`POST /`

**API Documentation Approach:**
- README + OpenAPI 3.0（覆盖 streaming 示例与错误 envelope）

**Error Handling Standards:**
- 对外保持 OpenAI error envelope
- 对内统一 `end_reason` 分类并与 request_id 关联

**Rate Limiting Strategy:**
- 业务限流/配额由 new-api 承担
- mix2api 仅做保护性并发与超时控制

**Communication Between Services:**
- new-api → mix2api：内网 S2S
- mix2api → 上游模型网站：token/session 适配与重登恢复

### Frontend Architecture

N/A（本项目为 API backend / adapter，无前端架构决策）

### Infrastructure & Deployment

- **Decision:** stable/canary 双通道 + new-api 权重灰度
- **Version:** Docker/Compose 基线（不依赖 K8s）
- **Rationale:** 满足 2 人 2 周 MVP 的可交付与可回滚要求
- **Affects:** 发布流程、故障止血、可运维性
- **Provided by Starter:** No

**Hosting Strategy:**
- 内网容器化部署，分 stable 与 canary 两组实例

**CI/CD Pipeline Approach:**
- 以回归包 A/B/C 作为发布门禁
- 灰度窗口监控关键 SLO 指标

**Environment Configuration:**
- 配置项外置：鉴权、Redis、采样留痕、超时、灰度标识

**Monitoring and Logging:**
- 结构化日志 + 关键维度指标
- request_id 贯通响应头与日志检索

**Scaling Strategy:**
- 横向扩容依赖共享 Redis 保持会话连续性
- 短窗触发阈值回滚（0→5→20→50→100 的逆向退回）

### Decision Impact Analysis

**Implementation Sequence:**
1. 先固化入站鉴权与 request_id/日志脱敏
2. 再完成 SSE 语义与 tool loop 状态机稳定化
3. 接入 Redis 最小状态并验证 stable/canary 一致性
4. 建立回归包 A/B/C 与灰度回滚自动化门禁

**Server.js Incremental Modularization Plan:**
1. Stage 1 - 抽离 `config/*` 与 `utils/*`（仅迁移配置解析与通用能力）
2. Stage 2 - 抽离 `middleware/*` 与 `routes/*`（入口只保留装配职责）
3. Stage 3 - 抽离 `services/session/*` 与 `services/upstream/*`（状态与外部交互分层）
4. Stage 4 - 抽离 `services/chat/*` 编排状态机（budget/tool-loop/stream 统一编排）

**Stage Exit Criteria:**
- 北向端点 `/v1/chat/completions`、`/`、`/v1/models`、`/health` 行为等价
- 观测口径 `x-request-id`、`end_reason`、`request.completed` 字段集合等价
- 回归包 A/B/C 全绿后才允许进入下一阶段

**Rollback Trigger During Refactor:**
- 非 `client_abort` 口径下断流率或失败率超过阈值
- tools 闭环成功率回落或回归包 B 失败
- 任一触发项出现时停止推进并回退到上阶段基线版本

**Cross-Component Dependencies:**
- 会话 key 设计直接影响工具闭环连续性与灰度一致性
- `end_reason` 口径影响监控告警、回滚触发与复盘效率
- 鉴权与脱敏策略影响可观测数据可用性与合规边界

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
12 areas where AI agents could make different choices and break compatibility.

### Naming Patterns

**Database Naming Conventions:**
- Redis key 命名统一：`mix2api:{env}:{scope}:{fingerprint}:{model}:{client}`
- 版本字段固定：`schemaVersion`
- 时间字段统一：`updatedAt`（ISO8601 字符串）

**API Naming Conventions:**
- 端点统一小写 + 斜杠：`/v1/chat/completions`、`/v1/models`、`/health`
- Header 统一小写语义名：`x-request-id`、`x-session-id`
- Query 参数统一 `snake_case`（与 OpenAI 字段冲突时遵循 OpenAI 约定）

**Code Naming Conventions:**
- 文件名：`kebab-case.js`（如 `session-store.js`）
- 函数/变量：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- 类型语义（注释或对象键）统一使用：`requestId/endReason/toolsPresent`

### Structure Patterns

**Project Organization:**
- 路由层：只做协议入参与响应出口，不放业务状态机
- 服务层：SSE、tool-loop、session、upstream 交互
- 基础设施层：redis、logger、config、auth middleware
- 测试：按模块同级放置 `*.spec.js`（先从关键链路开始）
- 迁移策略：`server.js` 采用“可运行优先”的增量抽离（先 config/middleware/routes，再 services，再 adapters）；每阶段必须保持行为等价并可回滚

**File Structure Patterns:**
- 配置读取统一从 `config/*`
- 协议映射统一在 `adapters/*`
- 归因与错误码映射统一在 `errors/*`
- 禁止在多个模块重复实现相同脱敏逻辑
- 等价性门槛：每次抽离后回归包 A/B/C 必须全绿，且 `x-request-id/end_reason` 观测口径不变

### Format Patterns

**API Response Formats:**
- 非流式成功：遵循 OpenAI `chat.completion` 结构
- 流式成功：SSE `data: {chunk}\n\n`，最终 `data: [DONE]\n\n`
- 错误响应：OpenAI `error` envelope，且始终返回 `x-request-id`

**Data Exchange Formats:**
- JSON 字段默认 `snake_case`，但 OpenAI 兼容字段按原规范保持
- 布尔值只用 `true/false`
- 时间统一 ISO8601 UTC
- `end_reason` 固定枚举集合，不允许自由文本

### Communication Patterns

**Event System Patterns:**
- 日志事件名统一：`request.received` / `request.completed` / `request.failed`
- 事件负载最小集合固定：`request_id/client/stream/tools_present/end_reason/http_status/upstream_status`
- 事件版本字段：`event_version`

**State Management Patterns:**
- session 状态更新必须“读-校验-写”三步走
- schema 不兼容时禁止抛 5xx，统一降级 miss 新会话
- `tool_call_id` 关联必须在单一状态机模块维护，避免分散写入

### Process Patterns

**Error Handling Patterns:**
- 先归类再响应：`upstream_error/adapter_error/timeout/client_abort/...`
- `client_abort` 不计入失败 SLO，但必须记录可观测事件
- 用户可见错误与内部日志细节分离（外部不泄露敏感上下文）

**Loading State Patterns:**
- SSE 写出必须及时 flush，禁止缓冲等待完整文本
- 上游超时、客户端断连、服务端取消三类终止路径必须分支处理
- tool 回填后继续生成的等待状态统一由 tool-loop 状态机控制

### Enforcement Guidelines

**All AI Agents MUST:**
- 严格保持 OpenAI Chat Completions 语义兼容，不擅自改字段含义
- 统一使用 `x-request-id` 与 `end_reason` 口径，不新增私有分裂口径
- 所有新代码遵循既定命名/结构/格式规则，并补充对应回归测试

**Pattern Enforcement:**
- PR 检查项：命名规则、响应结构、脱敏规则、SSE 结束信号、tool-loop 闭环
- 违规记录：在架构文档“Pattern Violations”节追加并给出修复 PR
- 规则更新：必须通过架构评审，更新本节并同步回归用例

### Pattern Examples

**Good Examples:**
- `x-request-id` 在成功/失败/流式全路径都返回
- Redis key 带 `fingerprint + model + client`，避免串会话
- tool 调用链保持 `assistant(tool_calls) -> tool -> assistant(final)`

**Anti-Patterns:**
- 在路由层直接操作 Redis 或拼接上游协议细节
- 使用多个不同字段表达同一归因（如 `reason/cause/end_reason` 混用）
- 流式结束未发送 `[DONE]` 或将 `client_abort` 计入失败率

## Project Structure & Boundaries

### Complete Project Directory Structure

```text
mix2api/
├── README.md
├── package.json
├── package-lock.json
├── Dockerfile
├── docker-compose.yml
├── .env
├── .env.example
├── .dockerignore
├── .gitignore
├── docs/
│   ├── architecture.md
│   ├── session.md
│   └── tools-mcp-skills.md
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   ├── env.js
│   │   ├── feature-flags.js
│   │   ├── timeout.js
│   │   └── slo-thresholds.js
│   ├── routes/
│   │   ├── chat-completions.route.js
│   │   ├── models.route.js
│   │   ├── health.route.js
│   │   └── root.route.js
│   ├── controllers/
│   │   ├── chat-completions.controller.js
│   │   ├── models.controller.js
│   │   └── health.controller.js
│   ├── services/
│   │   ├── chat/
│   │   │   ├── chat.service.js
│   │   │   ├── sse-stream.service.js
│   │   │   ├── tool-loop.service.js
│   │   │   ├── response-normalizer.service.js
│   │   │   └── end-reason.service.js
│   │   ├── upstream/
│   │   │   ├── upstream-client.service.js
│   │   │   ├── token-lifecycle.service.js
│   │   │   ├── session-extractor.service.js
│   │   │   └── exchange-adapter.service.js
│   │   ├── session/
│   │   │   ├── session-store.service.js
│   │   │   ├── session-key.service.js
│   │   │   ├── schema-version.service.js
│   │   │   └── store-adapter.service.js
│   │   └── observability/
│   │       ├── request-id.service.js
│   │       ├── metrics.service.js
│   │       ├── redaction.service.js
│   │       └── audit-sampling.service.js
│   ├── adapters/
│   │   ├── openai/
│   │   │   ├── request-mapper.js
│   │   │   ├── response-mapper.js
│   │   │   ├── stream-chunk-mapper.js
│   │   │   └── tool-mapper.js
│   │   └── upstream/
│   │       ├── request-mapper.js
│   │       └── response-mapper.js
│   ├── middleware/
│   │   ├── auth-guard.middleware.js
│   │   ├── request-id.middleware.js
│   │   ├── error-envelope.middleware.js
│   │   ├── timeout.middleware.js
│   │   └── access-log.middleware.js
│   ├── errors/
│   │   ├── error-factory.js
│   │   ├── error-codes.js
│   │   └── end-reason-map.js
│   ├── lib/
│   │   ├── logger.js
│   │   ├── redis-client.js
│   │   ├── http-client.js
│   │   └── clock.js
│   └── constants/
│       ├── headers.js
│       ├── endpoints.js
│       └── end-reason.js
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   ├── adapters/
│   │   └── middleware/
│   ├── integration/
│   │   ├── chat-completions.int.spec.js
│   │   ├── models.int.spec.js
│   │   └── health.int.spec.js
│   ├── regression/
│   │   ├── pack-a-streaming.spec.js
│   │   ├── pack-b-tools-loop.spec.js
│   │   └── pack-c-cancel-timeout.spec.js
│   └── fixtures/
├── scripts/
│   ├── smoke-chat.sh
│   ├── replay-request.sh
│   └── slo-report.js
└── .github/
    └── workflows/
        └── ci.yml
```

### Architectural Boundaries

**API Boundaries:**
- 北向契约边界：`/v1/chat/completions`、`/v1/models`、`/health`、`/`
- 协议边界在 `controllers + adapters/openai`，禁止在路由层拼协议细节
- 鉴权边界在 `middleware/auth-guard.middleware.js`
- 跨层约束：routes 禁止直接访问 redis/upstream；controllers 禁止承载预算/tool-loop 业务状态机

**Component Boundaries:**
- 路由层：仅做入参分发
- 控制器层：协议入/出控制
- 服务层：SSE、tool-loop、session、上游交互
- 适配器层：OpenAI 与上游模型形态转换

**Service Boundaries:**
- `services/chat/*` 不直接访问 Redis，统一通过 `services/session/*`
- `services/upstream/*` 不处理对外错误 envelope，统一交给 `errors/* + middleware`
- `services/observability/*` 负责日志、指标、采样留痕，不参与业务决策

**Data Boundaries:**
- Redis 只承载最小状态（session/token meta）
- 模型正文与 tool payload 默认不持久化
- schemaVersion 兼容校验在 `services/session/schema-version.service.js`

### Requirements to Structure Mapping

**Feature/FR Mapping:**
- Chat Completions 兼容（FR1-7）→ `routes/*` + `controllers/chat-completions.controller.js` + `adapters/openai/*`
- Streaming 生命周期（FR8-12）→ `services/chat/sse-stream.service.js` + `tests/regression/pack-a-streaming.spec.js`
- Tools 闭环（FR13-18）→ `services/chat/tool-loop.service.js` + `adapters/openai/tool-mapper.js` + `tests/regression/pack-b-tools-loop.spec.js`
- 会话与状态（FR19-23）→ `services/session/*` + `lib/redis-client.js`
- 鉴权与安全（FR24-27）→ `middleware/auth-guard.middleware.js` + `services/observability/redaction.service.js`
- 错误与归因（FR28-30）→ `errors/*` + `services/chat/end-reason.service.js`
- 可观测留痕（FR31-35）→ `services/observability/*` + `scripts/slo-report.js`
- 文档与回归（FR36-38）→ `README.md` + `tests/regression/*`

**Cross-Cutting Concerns:**
- `request_id` 贯通：`middleware/request-id.middleware.js` + `services/observability/metrics.service.js`
- 脱敏规则统一：`services/observability/redaction.service.js`
- 回滚阈值配置：`config/slo-thresholds.js` + `scripts/slo-report.js`

### Integration Points

**Internal Communication:**
- `route -> controller -> service -> adapter/upstream`
- 统一通过 `errors/*` 输出错误形态
- 统一通过 `middleware/request-id` 注入与传递 request_id

**External Integrations:**
- `new-api -> mix2api`（S2S 内网调用）
- `mix2api -> 上游模型网站`（token/session 管理）
- `mix2api -> Redis`（可选但默认开启）

**Data Flow:**
- 入站请求经鉴权与 request_id 注入后进入 chat service
- chat service 调 upstream + session service + tool-loop
- 输出通过 openai adapter 标准化后返回（SSE 或非流式）

### File Organization Patterns

**Configuration Files:**
- 全部运行参数集中 `src/config/*`
- `.env.example` 只保留可公开配置样例

**Source Organization:**
- 协议转换在 `adapters/*`
- 业务状态机在 `services/*`
- 中间件只做横切能力，不写业务分支

**Test Organization:**
- `unit`（纯函数/服务）
- `integration`（路由与中间件）
- `regression`（A/B/C 验收包）

**Asset Organization:**
- 后端项目，无静态前端资源目录要求
- 脚本与测试夹具分别在 `scripts/`、`tests/fixtures/`

### Development Workflow Integration

**Development Server Structure:**
- 当前 `server.js` 可作为入口壳，逐步迁移到 `src/app.js` + `src/server.js`

**Build Process Structure:**
- Node 运行时无额外构建；CI 重点执行回归包和集成测试

**Deployment Structure:**
- Docker/Compose 部署 stable/canary 双实例
- 环境变量区分通道与灰度标签

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
- 已决策项兼容：Express brownfield、SSE/Tool-loop、Redis 最小状态、stable/canary 灰度策略无冲突
- 安全边界与可观测口径一致：S2S 入站、`x-request-id`、`end_reason`、脱敏策略彼此对齐
- 延后项与 MVP 边界一致：`/responses`、服务端 MCP、mTLS 深化均被明确后置

**Pattern Consistency:**
- 命名/结构/格式/流程规则支撑核心决策，且与 API 兼容目标一致
- `client_abort`、`[DONE]`、`tool_call_id`、`end_reason` 口径在规则层统一
- 反模式已明确，可约束多智能体实现偏差

**Structure Alignment:**
- 目录结构覆盖路由、控制器、服务、适配器、中间件、错误、观测、测试与脚本
- 边界划分清晰：协议映射、状态管理、上游交互、日志归因职责分离
- 集成点（new-api、上游模型网站、Redis）均有明确落点

### Requirements Coverage Validation ✅

**Epic/Feature Coverage:**
- 当前无 epics 文档，已按 FR 功能域完成映射（兼容层/流式/tools/状态/鉴权/错误/观测/回归）

**Functional Requirements Coverage:**
- FR1-38 均有对应架构承接路径（模块与目录映射已定义）
- 跨切 FR（流式、tools、归因、回滚）在 `services/*` + `errors/*` + `tests/regression/*` 形成闭环

**Non-Functional Requirements Coverage:**
- 可靠性：SSE 完成信号、断流归因、回归门禁已覆盖
- 安全：S2S、脱敏、最小留痕策略已覆盖
- 可运维：灰度、回滚、关键指标维度已覆盖
- 兼容性：OpenAI Chat Completions 语义与 MCP-safe 边界已覆盖

### Implementation Readiness Validation ✅

**Decision Completeness:**
- 关键决策已落地（数据、安全、API、部署）
- 延后决策已标注（mTLS、OTel 深化、/responses、服务端 MCP）

**Structure Completeness:**
- 给出了完整目标目录树与模块边界
- 明确了内部/外部集成路径与数据流方向

**Pattern Completeness:**
- 覆盖命名、结构、格式、通信、流程五大类一致性规则
- 给出 Good/Anti-pattern 示例，可直接用于代码评审标准

### Gap Analysis Results

**Critical Gaps:**
- 无阻塞实施的关键缺口

**Important Gaps:**
- 建议补一份“版本兼容矩阵”（Node/Redis/关键依赖）到运维文档，降低环境漂移风险
- 建议在 CI 中把 A/B/C 回归包与阈值校验脚本强绑定，形成自动化门禁

**Nice-to-Have Gaps:**
- 增加“Pattern Violations”模板页，便于持续记录与修复闭环
- 增加“端到端故障演练脚本”（断流/超时/回滚）文档化样例

### Validation Issues Addressed

- 已确认 Step 2-6 的决策链条一致，未发现互斥方案
- 已确认结构映射覆盖核心 FR/NFR 能力
- 已确认多智能体冲突点已被规则约束

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- 目标边界清晰（MVP 聚焦、延后项明确）
- 工程闭环完整（SSE/tools/归因/回滚）
- 多智能体一致性规则具体、可执行

**Areas for Future Enhancement:**
- mTLS 与 OTel 深化
- `/responses` 兼容桥接
- 服务端 MCP Gateway 独立化

### Implementation Handoff

**AI Agent Guidelines:**
- 严格遵循本文档的决策与一致性规则
- 先保证契约与回归，再扩展功能
- 所有偏离规则的实现必须记录并评审

**First Implementation Priority:**
- 在现有 Express brownfield 中先落地：S2S 鉴权、request_id+end_reason 口径、SSE/tool-loop 稳定化、A/B/C 回归门禁
