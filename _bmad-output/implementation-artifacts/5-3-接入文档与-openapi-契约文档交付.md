# Story 5.3: 接入文档与 OpenAPI 契约文档交付

Status: review

## Story

As a AI 工程师,  
I want 获得完整的接入与契约文档,  
so that 可以快速完成 provider 配置、联调与回归执行.

## Acceptance Criteria

1. **Given** 项目进入可验收阶段  
   **When** 查看 README  
   **Then** 包含接入步骤、鉴权配置、灰度与回滚说明  
   **And** 提供最小回归包 A/B/C 的执行示例
2. **Given** 需要契约校验  
   **When** 查看 OpenAPI 文档  
   **Then** 覆盖 `/v1/chat/completions`、`/v1/models`、`/health`  
   **And** 包含流式与错误响应示例

## Tasks / Subtasks

- [x] 1. README 交付内容补齐（AC: #1）
  - [x] 增加接入步骤与最小 smoke 命令
  - [x] 增加鉴权模式说明与推荐配置
  - [x] 增加灰度放量、回滚触发与回滚动作说明
  - [x] 增加回归包 A/B/C 命令示例
- [x] 2. OpenAPI 文档交付（AC: #2）
  - [x] 新增 `docs/openapi.yaml`（OpenAPI 3.0.3）
  - [x] 覆盖 `/v1/chat/completions`、`/v1/models`、`/health`
  - [x] 补充流式与错误响应示例
- [x] 3. 一致性检查
  - [x] 与当前接口行为/测试语义对齐（stream、tools、legacy、error envelope）

## Dev Notes

### Architectural Guardrails

- 文档必须可直接支持接入、灰度与回滚决策。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 5.3: 接入文档与 OpenAPI 契约文档交付`]
- OpenAPI 需体现北向契约（核心端点 + stream + error envelope）。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#API Documentation Approach`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有 README 具备基础介绍，但缺少完整灰度回滚与回归包 A/B/C 指令。  
  [Source: `README.md`]
- 仓库缺少可交付的 OpenAPI 契约文件。  
  [Source: `docs/`]

### Testing Requirements

- 文档改动无运行时代码行为变更，执行现有回归确保无副作用。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 5.3: 接入文档与 OpenAPI 契约文档交付`
- `README.md`
- `docs/openapi.yaml`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test`

### Completion Notes List

- README 增补接入、鉴权、灰度回滚与回归包 A/B/C 指南。
- 新增 OpenAPI 3.0.3 契约文档，覆盖核心端点并给出流式/错误示例。

### File List

- `README.md`
- `docs/openapi.yaml`
- `_bmad-output/implementation-artifacts/5-3-接入文档与-openapi-契约文档交付.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 5.3（接入文档与 OpenAPI 契约文档交付）：补齐 README 接入指引并新增 OpenAPI 文档。
