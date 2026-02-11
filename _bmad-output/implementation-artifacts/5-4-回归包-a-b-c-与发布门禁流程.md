# Story 5.4: 回归包 A/B/C 与发布门禁流程

Status: review

## Story

As a 平台工程师,  
I want 将回归包 A/B/C 作为放量前门禁,  
so that 每次发布都可验证 stream、tools-loop、取消/超时三类关键风险.

## Acceptance Criteria

1. **Given** stable 与 canary 待发布版本  
   **When** 执行回归包 A/B/C  
   **Then** 三类用例全部通过  
   **And** 结果可用于发布决策记录
2. **Given** 任一关键回归失败  
   **When** 进入发布决策  
   **Then** 阻断继续放量或触发回滚流程  
   **And** 失败样本可通过 request_id 追踪复盘

## Tasks / Subtasks

- [x] 1. 门禁脚本实现（AC: #1 #2）
  - [x] 新增 `scripts/release-gate.sh`，按 A/B/C 顺序执行回归包
  - [x] 输出分包日志与 `summary.txt` 到 `_bmad-output/release-gates/<timestamp>-<channel>/`
  - [x] 任一包失败返回非 0，输出 `gate=BLOCK` 与回滚建议
- [x] 2. 可执行命令接入（AC: #1）
  - [x] `package.json` 新增 `test:pack:a|b|c`
  - [x] `package.json` 新增 `release:gate` 一键门禁命令
- [x] 3. 发布流程文档（AC: #1 #2）
  - [x] 新增 `docs/release-gate.md`（执行方法、判定规则、回滚动作、记录模板）
  - [x] `README.md` 补充门禁命令与文档入口

## Dev Notes

### Architectural Guardrails

- A/B/C 回归包必须作为放量前门禁，失败即阻断放量。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 5.4: 回归包 A/B/C 与发布门禁流程`]
- 回滚需保留 request_id 证据链用于复盘。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Error Handling Standards`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 已有丰富集成测试覆盖 stream/tools/cancel-timeout，但缺少统一门禁执行入口与发布记录模板。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 验证 A/B/C 命令可执行。
- 验证一键门禁命令输出 summary 与分包日志。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 5.4: 回归包 A/B/C 与发布门禁流程`
- `scripts/release-gate.sh`
- `package.json`
- `docs/release-gate.md`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `npm run test:pack:a`
- `npm run test:pack:b`
- `npm run test:pack:c`
- `npm run release:gate -- stable v2026.02.11`

### Completion Notes List

- 将 A/B/C 回归从“文档命令”升级为可执行门禁脚本和 npm 命令。
- 失败场景统一返回阻断信号并给出回滚动作建议。
- 新增发布记录模板，便于沉淀证据链与决策记录。

### File List

- `scripts/release-gate.sh`
- `package.json`
- `README.md`
- `docs/release-gate.md`
- `_bmad-output/implementation-artifacts/5-4-回归包-a-b-c-与发布门禁流程.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 5.4（回归包 A/B/C 与发布门禁流程）：新增门禁脚本、npm 命令与发布记录模板。
