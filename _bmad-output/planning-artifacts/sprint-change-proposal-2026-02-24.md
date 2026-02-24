# Sprint Change Proposal - server.js 模块化重构

Date: 2026-02-24
Workflow: correct-course
Mode: Incremental
Author: BMad Master

## 1. 问题摘要（Issue Summary）

### 1.1 触发问题

在实施阶段识别出 `server.js` 过于集中、耦合高、测试困难、迭代风险上升，已达到“显著影响后续实施稳定性”的阈值，需要执行 Correct Course。

### 1.2 发现上下文

- 触发类型：Technical limitation discovered during implementation
- 关联范围：Epic 7（单体解耦与职责分层重构）
- 主要证据：`server.js` 同时承担 request-id 注入、请求日志、会话存储、上游 token 生命周期、上下文预算、工具闭环编排等多重职责

### 1.3 证据样例

- 入口与中间件职责聚合：`server.js:24`, `server.js:168`
- 配置与运行参数聚合：`server.js:201`
- 会话存储与 Redis 适配聚合：`server.js:235`
- 上游 token 生命周期管理聚合：`server.js:570`
- Chat 主编排逻辑聚合：`server.js:2000`

## 2. 影响分析（Impact Analysis）

### 2.1 Epic 影响

- 直接影响：`epic-7`
- 建议：将 `epic-7` 从 `backlog` 调整为 `in-progress`，并以分阶段方式推进（先低风险拆分再进入编排层）
- 对 `epic-1`~`epic-6`：目标不变，但其回归资产作为重构等价性门禁

### 2.2 Story 影响

- 受影响故事：`7-1` ~ `7-5`
- 需要补强：为 `7-1`~`7-4` 增加阶段退出门槛；为 `7-5` 增加量化验收阈值与等价性报告要求

### 2.3 工件冲突与调整

- PRD：无目标冲突，MVP 范围保持不变
- Architecture：需补“分阶段迁移计划 + 每阶段退出条件 + 回滚触发”
- UI/UX：N/A（纯后端改造）
- 其他工件：需同步 sprint-status 与回归门禁执行策略

### 2.4 技术影响

- 代码组织：从单体入口向 `config/middleware/routes/services/repositories` 分层迁移
- 测试策略：回归包 A/B/C 由“推荐执行”升级为“阶段准入门禁”
- 发布风险：需以阈值化指标约束推进与回滚

## 3. 推荐路径（Recommended Approach）

### 3.1 选型结论

选择 **Option 1: Direct Adjustment**。

### 3.2 选型依据

- 问题属于工程实现层，不需要回滚已完成业务能力
- 不改变 PRD/MVP 目标，仅增强实施路径与验收判据
- 与 Epic 7 既有方向一致，可最小化组织与沟通成本

### 3.3 评估

- Effort: Medium
- Risk: Medium（可通过分阶段 + 量化门禁 + 回滚策略控制）
- Timeline impact: 低到中等（增加治理动作但降低后续返工）

## 4. 详细变更提案（Detailed Change Proposals）

### 4.1 Stories 变更提案 A（已批准）

Story: Epic 7（`7-1`~`7-5`）  
Section: Acceptance Criteria

OLD:
- 已描述模块化方向，但缺少统一的“阶段迁移完成判据”。

NEW:
- 在 `7-1`~`7-4` 增加统一退出条件：
  - `/v1/chat/completions`、`/`、`/v1/models`、`/health` 契约行为不变
  - `x-request-id`、`end_reason`、`request.completed` 字段口径不变
  - 回归包 A/B/C 全绿方可进入下一阶段
- 在 `7-5` 增加等价性基线对比要求：
  - stream done 覆盖
  - tools 闭环成功率
  - 非 `client_abort` 失败率
  - 超阈值时阻断推进并回滚到上阶段

Rationale:
- 将“结构重构”转化为“可验收、可回滚、可审计”的实施闭环。

### 4.2 Architecture 变更提案（已批准）

Artifact: `_bmad-output/planning-artifacts/architecture.md`  
Section: `Implementation Sequence`, `Project Structure & Boundaries`

OLD:
- 给出了目标结构，但缺少迁移阶段与退出判据。

NEW:
- 增补 `Server.js Incremental Modularization Plan`：
  1) config/utils 抽离
  2) middleware/routes 抽离
  3) session/upstream services 抽离
  4) chat orchestration 状态机抽离
- 每阶段定义 exit criteria（契约等价 + 观测口径等价 + A/B/C 回归全绿）
- 增补 `Rollback Trigger During Refactor`（非 client_abort 指标恶化、tool-loop 回归失败时立即停止并回退）

Rationale:
- 将目标架构补全为可执行迁移路线，降低阶段性失控风险。

### 4.3 Sprint Tracking 变更提案（已批准）

Artifact: `_bmad-output/implementation-artifacts/sprint-status.yaml`  
Section: `development_status`

OLD:
- `epic-7`、`7-1`~`7-5` 均为 `backlog`。

NEW:
- `epic-7: in-progress`
- `7-1-配置与通用工具抽离: ready-for-dev`
- `7-2`~`7-5`: 保持 `backlog`

Rationale:
- 采用低风险先拆策略，符合 Incremental 方式与风险控制原则。

### 4.4 Stories 变更提案 B（已批准）

Story: `7-5 回归与等价性验收`  
Section: Acceptance Criteria

OLD:
- 要求 A/B/C 回归通过与契约兼容，但缺少量化门槛。

NEW:
- 增加量化阈值：
  - 非 `client_abort` 口径下 `[DONE]` 覆盖率 `>=99.5%`
  - 断流率 `<=0.5%`
  - `tool_calls` 闭环成功率 `>=97%`，B 包通过率 `100%`
  - `end_reason != unknown` 覆盖率 `>=99%`，漂移率 `<=5%`
- 每阶段迁移必须输出“等价性报告”（样本、request_id、差异、准入结论）
- 任一阈值不达标即阻断推进并回退到上阶段基线

Rationale:
- 防止“结构变好但质量退化”的隐性风险，确保重构质量可量化。

## 5. 实施交接（Implementation Handoff）

### 5.1 变更范围分级

**Moderate**（中等范围）

- 原因：无需改动产品目标，但需要 backlog 状态调整、架构文档补强、验收门禁强化，并对实施顺序做治理。

### 5.2 交接对象与职责

- Product Owner / Scrum Master
  - 更新 Epic 7 与 Story 7.1 状态
  - 维护实施顺序与阶段门禁
- Development Team
  - 按 7-1 → 7-2 → 7-3 → 7-4 执行抽离
  - 每阶段产出等价性报告并执行 A/B/C
- Architect
  - 同步更新 architecture 文档迁移计划与回滚触发规则

### 5.3 成功标准

- Epic 7 迁移阶段按顺序推进，且每阶段均满足退出条件
- 北向契约零破坏，核心观测口径不漂移
- 回归与阈值全部达标后才进入下一阶段
