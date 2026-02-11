# Sprint Change Proposal（2026-02-12，Rev-2）

## 0. Workflow Context

- Workflow: `bmad-bmm-correct-course`
- Project: `mix2api`
- Mode: `Batch`（本轮按 revise 后一次性输出）
- Revised Trigger: 首个 `session_id` 必须来自首次访问上游后的响应
- Trigger Source:
  - 用户澄清："第一次 session id 是第一次访问上游时候，上游传回来的"
  - 当前实现允许客户端显式 `session_id` 优先透传，和该语义存在冲突风险

## 1. Issue Summary

目标语义应为“上游回传主导的会话引导（bootstrap）”：

1. 首轮（本地无会话映射）请求发送到上游时，必须不带 `session_id`。  
2. 首个 `session_id` 只能由上游响应产生并写入本地映射。  
3. 只有在本地已存在映射后，才允许后续复用 `session_id`。

当前风险点：若客户端首轮误传 `session_id` 并被透传，上游可能直接报错，破坏首轮成功率与会话一致性。

## 2. Impact Analysis

### 2.1 Epic Impact

- 受影响 Epic: `Epic 2（会话连续性与上游访问稳定）`
- 结论：需补强“首轮会话引导语义”，保证 session 来源单一可信。

### 2.2 Story Impact

- Story `2.1`（显式 session 支持）需补充边界：显式 `session_id` 仅用于“已建立会话”的后续请求。  
- Story `2.3`（自动创建与复用）需补充首轮强约束：store miss 时不透传 `session_id`。  
- Story `5.3`（接入文档）需明确写明 `session_id` 首次来源规则。

### 2.3 Artifact Conflicts

- `epics.md` 中 FR19（显式输入）与 FR20（自动创建）需要增加“引导阶段优先 FR20”说明。  
- 现有测试 `reuses explicitly provided session_id across turns` 假设“首轮显式可透传”，与新语义冲突，需要调整。

### 2.4 Technical Impact

- 服务端需在 `store miss` 时强制丢弃客户端 `session_id/exchange_id`，走上游新建。  
- 首轮成功后写入映射，后续请求再复用。  
- 新增回归测试覆盖“首轮误传 session_id 仍不透传”的行为。

## 3. Path Forward Evaluation

### Option 1: Upstream-Authoritative Bootstrap（推荐）

- 可行性：`Viable`
- Effort：`Medium`
- Risk：`Low`
- 说明：和你的业务规则完全一致，且可通过测试稳定约束。

### Option 2: Continue Client-Priority Session

- 可行性：`Not viable`
- Effort：`Low`
- Risk：`High`
- 说明：继续保留首轮显式透传会与“session 首次来自上游”原则冲突。

### Option 3: Remove Explicit Session Support Entirely

- 可行性：`Not viable`
- Effort：`Medium`
- Risk：`Medium`
- 说明：会破坏后续会话显式复用能力，超出必要变更。

### Selected Approach

- 选择：`Option 1 (Upstream-Authoritative Bootstrap)`
- 理由：满足首轮语义，同时保留后续复用能力。

## 4. Detailed Change Proposals

### 4.1 Story Proposal

Story: `2.1-会话隔离键与显式会话输入支持`  
Section: Acceptance Criteria（边界修订）

OLD:
- 客户端可显式提供 `session_id` 复用上游会话。

NEW:
- 客户端可显式提供 `session_id` 复用“已建立”的上游会话。  
- 若当前会话键无已建立映射（store miss），显式 `session_id` 不透传上游，由上游新建并回传首个 `session_id`。

Rationale: 保证 session 首次来源唯一（上游）。

---

Story: `2.3-自动会话创建与上游会话复用`  
Section: Acceptance Criteria（首轮强约束）

OLD:
- 无显式 `session_id` 时自动创建并复用。

NEW:
- 会话键首次访问（store miss）时，不论客户端是否传入 `session_id`，均按“无 session”访问上游。  
- 上游回传 `sessionId/exchangeId` 后写入映射；后续命中映射请求再复用。

Rationale: 把首轮 bootstrap 规则工程化。

---

Story: `2.5-上游回传主导的会话引导`（新增）  
Section: New Story

建议 AC:
1. store miss + 客户端传 `session_id`：上游请求体不含 `session_id`。  
2. 首轮响应回传 `sessionId` 后可在第二轮复用。  
3. 日志记录 `session_bootstrap=upstream`，且不泄露原始值。  
4. 回归测试覆盖上述行为。

Rationale: 将规则沉淀为独立可验收故事。

### 4.2 Code Behavior Proposal

Artifact: `server.js`  
Section: `session_id` 解析与上游请求构造

OLD:
- 客户端显式 `session_id` 优先透传。

NEW:
- 先基于会话键读取 store。  
- 若 `store miss`：强制 `sessionId=null`、`exchangeId=null` 后再构造上游请求。  
- 若 `store hit`：允许客户端显式值用于复用（或按现有优先级策略处理）。

Rationale: 在引导阶段屏蔽错误输入，在复用阶段保持兼容。

### 4.3 Test Proposal

Artifact: `tests/integration/chat-completions-auth-nonstream.test.js`

OLD:
- 有“首轮不携带 session_id”的自动会话基线。  
- 有“首轮显式 session_id 透传”的旧假设测试。

NEW:
- 新增测试：`store miss` 下即使请求携带 `session_id`，上游首轮也不应收到。  
- 调整旧测试：显式 `session_id` 透传仅在“已建立映射后”成立。

Rationale: 使测试与业务真实语义一致。

### 4.4 Documentation Proposal

Artifacts: `README.md`, `docs/openapi.yaml`, `_bmad-output/implementation-artifacts/5-3-接入文档与-openapi-契约文档交付.md`

OLD:
- 文档对首轮来源规则表述不够硬。

NEW:
- 明确会话生命周期：  
  1) 第一次请求：不传 `session_id`（或传了也不生效）  
  2) 上游回传后：返回/持久化 `session_id`  
  3) 后续请求：复用该 `session_id`

Rationale: 减少接入方误用与误判。

## 5. PRD/MVP Impact and Action Plan

- MVP 目标不变。  
- 影响类型：会话语义收敛与容错增强，不改变北向接口形态。  
- 高层动作：
  1. SM/PO 在 Epic 2 增补 Story 2.5
  2. Dev 调整 session bootstrap 逻辑
  3. QA 更新并新增回归用例
  4. Tech Writer 更新接入说明

## 6. Handoff Plan

- Scope Classification: `Moderate`
- Routed To:
  - `Scrum Master / Product Owner`: Backlog 与状态同步
  - `Development`: bootstrap 逻辑实现
  - `QA`: 测试基线修订与新增
  - `Tech Writer`: 文档修订
- Success Criteria:
  - 首轮 `session_id` 来源仅为上游回传
  - store miss 时客户端显式 `session_id` 不再透传
  - 回归与文档一致

## 7. Checklist Snapshot

- [x] 1.1 触发故事识别
- [x] 1.2 核心问题定义
- [x] 1.3 证据收集
- [x] 2.1 当前 Epic 影响评估
- [x] 2.2 Epic 级调整建议
- [x] 2.3 后续 Epics 影响复核
- [x] 2.4 新增/失效 Epic 判断（建议新增 Story 2.5）
- [x] 2.5 优先级顺序评估
- [x] 3.1 PRD 冲突检查
- [x] 3.2 Architecture 冲突检查
- [N/A] 3.3 UI/UX 冲突检查（本变更无 UI）
- [x] 3.4 其他工件影响评估
- [x] 4.1 Option 1 评估
- [x] 4.2 Option 2 评估
- [x] 4.3 Option 3 评估
- [x] 4.4 路径选择
- [x] 5.1~5.5 提案组件齐备
- [x] 6.1~6.2 最终复核
- [!] 6.3 待用户明确批准
- [!] 6.4 批准后更新 `sprint-status.yaml`
- [!] 6.5 批准后确认执行分工与下一步

## 8. Approval Needed

请确认是否批准该修订提案进入实施（yes/no/revise）。
