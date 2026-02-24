---
title: 'server.js 职责分层拆分技术规格'
slug: 'server-js-layered-refactor-tech-spec'
created: '2026-02-24T15:04:43+08:00'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'Node.js (CommonJS)'
  - 'Express 4.x'
  - 'node-fetch 2.x'
  - 'redis 4.x'
  - 'node:test'
files_to_modify:
  - 'server.js'
  - 'package.json'
  - 'tests/unit/baseline-files.test.js'
  - 'routes/register-core-routes.js'
  - 'middleware/register-core-middlewares.js'
  - 'src/app.js (new)'
  - 'src/server.js (new)'
  - 'src/bootstrap/chat-handler.js (new)'
  - 'src/bootstrap/observability.js (new)'
code_patterns:
  - '当前模式：server.js 统一装配 + 业务编排 + 启动监听（单文件集中）'
  - '已存在模式：registerCoreMiddlewares/registerCoreRoutes 通过依赖注入注册'
  - '服务化模式：chat/session/upstream/tool/openai-response 均以工厂函数构建'
  - '观测模式：request-id 中间件初始化 res.locals，request-log 在 finish 统一打点'
test_patterns:
  - '集成测试使用 node:test + mock upstream + 真实进程启动验证'
  - '回归门禁使用测试名称匹配分包（A/B/C）'
  - '单元测试覆盖 middleware/routes/services/utils 的纯函数与注册行为'
---

# Tech-Spec: server.js 职责分层拆分技术规格

**Created:** 2026-02-24T15:04:43+08:00

## Overview

### Problem Statement

当前 `server.js` 仍承载过多启动编排与横切逻辑，导致职责边界不清、变更影响面大、回归验证成本上升，不利于持续迭代与故障定位。

### Solution

在不改变北向 API 契约与线上行为的前提下，采用渐进式重构将 `server.js` 拆分为 `app/bootstrap + routes + middleware + services + observability` 分层结构，并通过既有 A/B/C 回归门禁与 stable/canary 灰度策略保障发布安全。

### Scope

**In Scope:**
- 仅进行 `server.js` 结构性拆分，不新增业务功能
- 按“文件路径 + 具体动作”输出可执行任务计划
- 输出风险点、回滚策略、验收标准（Given/When/Then）
- 保持现有发布与回归机制（A/B/C + stable/canary）

**Out of Scope:**
- 变更 OpenAI Chat Completions 北向契约与错误 envelope
- 变更 SSE 流式语义与工具闭环协议行为
- 引入新的发布平台/运维体系或跨项目级架构升级

## Context for Development

### Codebase Patterns

- `server.js` 当前为单体入口（约 2177 行），同时承担：配置加载、helper 定义、采样留痕生命周期、核心 handler、路由挂载、启动监听。
- `register-core-middlewares.js` 与 `register-core-routes.js` 已具备“薄注册层”模式，适合继续外移 `handleChatCompletion` 等重逻辑。
- `services/*` 已形成工厂化边界（`create*Service`），说明业务能力可复用，适合由 bootstrap 层组合，而非继续堆叠在 `server.js`。
- `request-id`/`request-log` 采用 `res.locals` 贯通观测字段，重构必须保持该观测协议与字段名稳定。
- 约束优先级确认：兼容性 > 稳定性 > 结构优化，且每波重构后需通过 A/B/C 回归包。

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `server.js` | 当前单体入口与编排逻辑 |
| `_bmad-output/planning-artifacts/architecture.md` | 架构约束与横切关注点 |
| `_bmad-output/planning-artifacts/epics.md` | Epic 7 拆分目标与范围 |
| `middleware/register-core-middlewares.js` | 核心中间件注册锚点 |
| `routes/register-core-routes.js` | 核心路由注册锚点 |
| `middleware/request-id.js` | request_id 与观测默认字段初始化 |
| `middleware/request-log.js` | request.completed 统一日志与采样触发 |
| `services/chat-orchestration.js` | 会话解析与上游请求编排边界 |
| `tests/integration/chat-completions-auth-nonstream.test.js` | stream/tools/timeout 等行为不变性主回归 |
| `tests/unit/baseline-files.test.js` | 基线约束（含 server.js 与 start 脚本） |
| `scripts/release-gate.sh` | A/B/C 门禁执行与回滚提示 |
| `package.json` | 启动入口与测试分包命令定义 |

### Technical Decisions

- 保持北向接口行为与响应结构完全兼容。
- 采用小步重构与分阶段验证，避免一次性大改。
- 每阶段必须通过最小回归包后再进入下一阶段。
- 明确分层边界并禁止跨层耦合：`routes` 不直接处理基础设施细节，`middleware` 不承载业务编排，`observability` 不改变业务分支结果。
- 依赖方向约束：允许 `src/bootstrap/* -> services/*`，禁止 `services/* -> src/bootstrap/*` 反向依赖，避免环依赖与边界回流。
- 目标结构建议：`src/app.js`（应用装配）、`src/server.js`（进程启动）、`src/bootstrap/*`（启动编排）、`src/observability/*`（日志与指标）。
- 兼容约束锚点：
  - `server.js` 中 `app.listen` 当前直接启动并初始化 `startSampleTraceCleanupTask()` 与 `sessionStoreService.initRedisSessionClient()`；拆分后仍需在进程启动路径保留。
  - `handleChatCompletion` 仍是最主要编排函数，建议迁移到 bootstrap/controller 模块并保持同签名挂载。
  - `tests/unit/baseline-files.test.js` 目前硬编码 `server.js` 与 `node server.js`，重构若引入 `src/server.js`，需同步更新基线测试与 package start 脚本。

### Investigation Notes

- 已执行深度扫描：`glob + grep + ast-grep` 覆盖入口、注册、测试与门禁脚本。
- 并行子代理任务已发起但因系统 stale timeout 被取消；本次结论基于本地代码与测试脚本直接扫描结果。
- 未发现 `project-context.md` 文件。

### Success Metrics

- `server.js` 仅保留入口/兼容壳层职责（禁止业务编排逻辑驻留）。
- 业务编排函数迁移完成率 100%（以函数清单验收：聊天处理、观测生命周期、启动编排）。
- 拆分后职责覆盖完整：启动装配、路由注册、横切中间件、观测能力均迁移到对应分层。
- 每个重构波次完成后，最小回归包 A/B/C 通过率保持 100%。

## Implementation Plan

### Tasks

- [ ] Task 1: 建立双入口骨架并保持启动兼容
  - File: `src/app.js`（new）
  - Action: 新增 `createApp(deps)`，负责创建 express app、关闭 `x-powered-by`、注册核心中间件与核心路由。
  - Notes: 不直接 `listen`，仅返回 app 实例；保留依赖注入参数，避免模块隐式耦合。

- [ ] Task 2: 拆分进程启动逻辑
  - File: `src/server.js`（new）
  - Action: 新增 `startServer()`，完成 runtime config 读取、依赖构建、`app.listen` 与启动后初始化（trace cleanup + redis init）。
  - Notes: 启动日志格式保持与当前一致，避免观测面板断档。

- [ ] Task 3: 提取聊天编排处理器
  - File: `src/bootstrap/chat-handler.js`（new）
  - Action: 将 `handleChatCompletion` 从 `server.js` 迁移到新模块，导出工厂函数 `createChatHandler(deps)`。
  - Notes: 保持现有 handler 签名与错误返回路径；`setRequestEndReason`/`setRequestUpstreamStatus` 作为依赖注入或同模块私有工具保留；`createChatHandler(deps)` 需显式注入 `sendOpenAIError`、`upstreamRequestService`、`openAIResponseService`、`toolResponseService`、`chatOrchestrationService`；并保留预算观测、`x-session-id` 写入、`endReason/upstreamStatus` 设置等辅助依赖链路。

- [ ] Task 4: 提取观测与采样生命周期
  - File: `src/bootstrap/observability.js`（new）
  - Action: 迁移 `sampleTraceStore` 相关函数（purge/evict/sample/build/start cleanup）与预算观测辅助函数。
  - Notes: `request-log` 中 `maybeRecordSampleTrace` 调用契约不变；trace 字段命名不变。

- [ ] Task 5: 薄化现有入口并做兼容桥接
  - File: `server.js`
  - Action: 改为最小入口：仅导入并调用 `src/server.js`（或保留短壳层以兼容既有脚本）。
  - Notes: 若保留壳层，确保不重复注册 app/middleware/routes；避免双实例监听；必要时默认导出空对象以避免测试 `require` 入口时副作用冲突。

- [ ] Task 6: 对齐路由与中间件注册依赖
  - File: `routes/register-core-routes.js`
  - Action: 保持接口不变，确认从新 bootstrap 注入 `handleChatCompletion` 后行为一致。
  - Notes: `/v1/chat/completions`、`/`、`/health`、`/v1/models` 路径与返回结构不得变化。

- [ ] Task 7: 对齐中间件装配顺序
  - File: `middleware/register-core-middlewares.js`
  - Action: 确认在 `src/app.js` 中的调用顺序与当前一致（request-id -> json parser -> json-body-error -> request-log）。
  - Notes: 顺序是错误 envelope 与 request.completed 观测稳定性的关键约束。

- [ ] Task 7.1: 波次门禁（强制）
  - File: `N/A（执行任务）`
  - Action: 每一波次完成后必须满足“可启动 + smoke 通过（health + 基础 chat）”后方可进入下一波。
  - Notes: 防止中间态不可运行导致定位困难。

- [ ] Task 8: 基线与启动命令兼容更新
  - File: `package.json`
  - Action: 若入口迁移到 `src/server.js`，更新 `scripts.start` 并保持 CI/本地启动一致。
  - Notes: 可选策略为保留 `node server.js`，通过壳层转发避免脚本变更。

- [ ] Task 9: 同步基线测试断言
  - File: `tests/unit/baseline-files.test.js`
  - Action: 更新 required files 与 start script 断言以匹配最终入口策略。
  - Notes: 必须避免与部署脚本产生分歧（文档、package、测试三方一致）。

- [ ] Task 10: 执行回归门禁并产出证据
  - File: `N/A（执行任务）`
  - Action: 不改脚本逻辑，仅执行 `npm run release:gate -- stable <tag>` 或等价 A/B/C 命令并留存 summary/log。
  - Notes: 若出现失败，按回滚策略即时停止推进并保留 request_id 样本。

### Acceptance Criteria

- [ ] AC 1: Given 当前系统可正常处理 `POST /v1/chat/completions`，when 完成入口拆分并启动服务，then 该端点在 `stream=false` 下响应结构与状态码保持兼容。
- [ ] AC 2: Given `stream=true` 请求，when 走流式路径，then SSE 语义保持一致并包含 `[DONE]` 完成信号。
- [ ] AC 3: Given tools/legacy functions 请求，when 完成重构后执行回归包 B，then `tool_calls`、`tool_call_id` 与回填继续生成行为保持一致。
- [ ] AC 4: Given 取消与超时场景，when 执行回归包 C，then `client_abort`、`upstream_timeout`、上游错误归因与 HTTP 映射保持一致。
- [ ] AC 5: Given 请求进入服务，when 请求结束，then `request.completed` 日志仍包含既有维度（client/stream/tools_present/end_reason/http_status/upstream_status/model/budget）。
- [ ] AC 6: Given 会话共享已启用，when 服务启动，then trace cleanup 定时任务与 Redis session client 初始化仍按启动路径触发。
- [ ] AC 7: Given 基线测试与启动脚本，when 执行单元与集成测试，then `baseline-files`、`health`、`chat-completions` 测试通过且入口约定一致。
- [ ] AC 8: Given 重构分阶段推进，when 每个波次完成，then A/B/C 最小回归包通过率为 100%，否则立即停止并回滚。
- [ ] AC 9: Given 生产灰度策略，when 出现 `[DONE]` 覆盖率异常下降或非 `client_abort` 异常终止率上升，then 在 ≤10 分钟内完成 canary 权重回滚并保留证据样本。
- [ ] AC 10: Given 会话复用场景，when 通过 `header/body/metadata` 三种入口分别发送连续两轮请求（首轮无缓存、次轮复用），then `x-session-id` 引导与复用语义保持与重构前一致。
- [ ] AC 11: Given 灰度发布运行中，when rolling 24h（排除 `client_abort`）统计显示 `[DONE]` 覆盖率 < 99.5% 或非 `client_abort` 异常终止率 > 0.5%，then 值班人员 5 分钟内将 canary 权重降至 0%，并在 10 分钟内完成证据归档。

## Additional Context

### Dependencies

- 运行时依赖：`express`、`node-fetch`、`redis`、`uuid`。
- 现有内部依赖：`config/*`、`middleware/*`、`routes/register-core-routes.js`、`services/*`、`utils/*`。
- 发布依赖：`scripts/release-gate.sh` 与 `_bmad-output/release-gates/*` 证据目录。
- 前置条件：不引入新外部服务；仅依赖现有 upstream mock 与本地 redis（测试场景）。

### Testing Strategy

- 单元测试：
  - 保持 `tests/unit/middleware-register-core-middlewares.test.js`、`tests/unit/routes-register-core-routes.test.js` 通过。
  - 更新并通过 `tests/unit/baseline-files.test.js` 以匹配新入口策略。
- 集成测试：
  - 执行 `tests/integration/health.test.js` 确认启动与健康探测不变。
  - 执行 `tests/integration/chat-completions-auth-nonstream.test.js` 覆盖 stream/tools/timeout/abort。
- 门禁测试（发布前必跑）：
  - Pack A: `node --test --test-name-pattern "stream=true|DONE|flushes first chunk|request.completed logs fixed dimensions" tests/integration/chat-completions-auth-nonstream.test.js`
  - Pack B: `node --test --test-name-pattern "forwards tools schema|legacy functions|tool_calls|tool backfill|MCP-safe" tests/integration/chat-completions-auth-nonstream.test.js`
  - Pack C: `node --test --test-name-pattern "timeout|client abort|upstream HTTP error|upstream payload error" tests/integration/chat-completions-auth-nonstream.test.js`
  - 一键门禁：`npm run release:gate -- stable <version-tag>`
- 人工验证：
  - 验证 `/health`、`/v1/models`、`/v1/chat/completions`、`POST /` 响应一致性。
  - 抽样核对 `x-request-id`、`x-session-id`、`request.completed` 关键字段。

### Rollback Trigger Baseline

- 若 rolling 24h（排除 `client_abort`）`stream=true` 的 `[DONE]` 覆盖率 < 99.5%，触发回滚。
- 若 rolling 24h（排除 `client_abort`）非 `client_abort` 异常终止率 > 0.5%，触发回滚。
- 若 tools 闭环回归失败（包 B 不通过），立即停止放量并回滚。
- 角色与时限：Oncall 5 分钟内执行权重降为 0%；Release owner 10 分钟内完成 `request_id + gate logs` 证据归档。

### Non-goals

- 不引入任何新的 API 字段或行为语义。
- 不改变现有鉴权模型、会话语义与上游协议。
- 不在本次重构中引入新的发布平台能力。

### Notes

- 高风险项（预演）：
  - 入口迁移导致启动脚本、测试断言、容器入口不一致。
  - 中间件注册顺序漂移导致错误 envelope 或日志字段异常。
  - handler 外移时遗漏依赖注入，造成工具闭环或会话状态回归。
- 回滚策略（执行级）：
  - 代码层：保持每波次原子提交，失败即回退至上一稳定提交。
  - 发布层：异常触发后将 canary 权重降至 0%，保留 `x-request-id` 与 release-gate 日志。
  - 验证层：回滚后按 Pack A -> Pack B -> Pack C 顺序重跑，确认恢复基线。
- 未来考虑（本次不做）：
  - 将 `src/bootstrap/chat-handler.js` 进一步细分 controller/use-case。
  - 引入统一 composition root（DI 容器）替代手工 wiring。
- 建议执行顺序：Task 1 -> 2 -> 3 -> 4 -> 5 -> 6/7 -> 8 -> 9 -> 10。
