# Story 1.1: 从 Starter Template 初始化项目基线

Status: done

## Story

As a 平台工程师,  
I want 按架构选定的 Express Starter Template 初始化项目骨架并完成初始配置,  
so that 团队可以在统一基线上快速开始开发与联调.

## Acceptance Criteria

1. **Given** Architecture 已指定 Express Brownfield Starter  
   **When** 执行初始化（模板落地、依赖安装、基础配置）  
   **Then** 生成可运行的项目骨架  
   **And** 目录与入口满足后续故事扩展需要
2. **Given** 项目骨架初始化完成  
   **When** 启动服务并访问 `GET /health`  
   **Then** 返回健康状态  
   **And** 可作为后续开发与部署探活基线

## Tasks / Subtasks

- [x] 1. 建立或确认项目骨架与依赖可运行（AC: #1）
  - [x] 确认 `package.json` 具备最小启动脚本（`npm start`）且入口文件可运行
  - [x] 确认 Express 入口禁用 `x-powered-by`，并启用 JSON body 解析与大小限制
  - [x] 确认 `.env.example` 覆盖最小可运行配置，且 `.gitignore` 不提交 `.env`
  - [x] 确认 Docker 相关文件存在且可构建运行（`Dockerfile`、`docker-compose.yml`）
  - [x] （可选）如需对照脚手架：用 `npx express-generator@4.16.1 --no-view --git mix2api` 新建对照目录或分支，不要覆盖主线代码
- [x] 2. 健康检查端点可用（AC: #2）
  - [x] 提供 `GET /health` 返回 JSON（至少含 `status` 字段）
  - [x] 本地运行后用 curl 验证 `GET /health` 返回 200
- [x] 3. 为后续故事预留可演进的结构边界（AC: #1）
  - [x] 明确短期策略：允许 `server.js` 作为入口壳，后续逐步迁移到 `src/app.js` + `src/server.js`
  - [x] 明确长期目标结构：按架构文档中的 `src/` 目录树做模块边界规划（routes/controllers/services/adapters/middleware/errors/tests/scripts）

## Dev Notes

### Architectural Guardrails

- 选型结论：**Express Brownfield Baseline（不切换新框架）**，目标是最小迁移风险，把精力集中到 SSE、tool loop、归因、观测与灰度回滚等关键验收项。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Selected Starter: Express Brownfield Baseline（不切换新框架）`]
- `express-generator@4.16.1` 仅作为“对照/PoC”初始化命令，**不要**用它覆盖主线；brownfield 推荐“沿用现有仓库并增量重构”。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation`]
- 目标目录结构与边界：后续会演进出 `src/` 分层结构（route -> controller -> service -> adapter/upstream），并把横切能力放到 `middleware/`。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

仓库中已存在可运行基线与文档骨架，开发时优先“确认并收敛”而不是新造轮子：

- 入口与端点：`server.js` 已包含 `/health`、`/v1/models`、`/v1/chat/completions` 与 `POST /` 兼容入口（后续故事会继续增强语义与观测）。  
  [Source: `server.js`]
- 运行与部署：已提供 `README.md`、`.env.example`、`Dockerfile`、`docker-compose.yml`。  
  [Source: `README.md`] [Source: `.env.example`] [Source: `Dockerfile`] [Source: `docker-compose.yml`]

### Testing Requirements (Baseline)

- 本 Story 的最低验证是“可启动 + 探活可用”，优先用最小 smoke check（`npm start` + curl `/health`）保证基础可运行。
- 回归包 A/B/C 属于后续门禁（尤其是流式、tools、取消/超时），不在本 Story 强制落地，但需要在结构上为 `tests/regression/*` 预留落点。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Test Organization`]

### Project Structure Notes

- 现状：当前以根目录 `server.js` 为主入口，适合快速迭代但不利于后续分层与测试。
- 目标：按架构给出的目录树逐步拆分到 `src/`，本 Story 只要求“入口与目录规划清晰且不阻塞后续拆分”，避免一次性大重构引入回归。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Development Server Structure`]

### References

- `_bmad-output/planning-artifacts/epics.md#Story 1.1: 从 Starter Template 初始化项目基线`
- `_bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation`
- `_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `README.md`
- `package.json`
- `server.js`
- `.env.example`
- `Dockerfile`
- `docker-compose.yml`

## Dev Agent Record

### Agent Model Used

GPT-5.2 (Codex CLI)

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- 新增 Node 内置测试：基线文件/脚本校验 + `/health` 探活集成测试（含 `x-powered-by` 不泄露）
- 验证容器构建：`docker build` 成功
- 验证本地探活：启动服务并 curl `/health` 返回 200
- 代码审查问题已修复：测试进程清理竞态、补充 `npm test` 脚本、校正 Story File List 与状态同步

### File List

- `.dockerignore`
- `.env.example`
- `.gitignore`
- `Dockerfile`
- `README.md`
- `docker-compose.yml`
- `docs/architecture.md`
- `docs/session.md`
- `docs/tools-mcp-skills.md`
- `package-lock.json`
- `package.json`
- `server.js`
- `_bmad-output/implementation-artifacts/1-1-从-starter-template-初始化项目基线.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `tests/unit/baseline-files.test.js`
- `tests/integration/health.test.js`

### Change Log

- 2026-02-11: 增加基线校验与健康检查测试；更新 sprint-status 使 Story 进入 review
- 2026-02-11: 修复 Code Review 高/中优先级问题（测试清理竞态、`npm test` 脚本、File List 完整性）；Story 状态更新为 done
- 2026-02-11: 修复 LOW 问题：放宽 `health` 集成测试的 `stderr` 断言，仅对关键错误失败，降低环境噪声误报

## Senior Developer Review (AI)

### Review Date

2026-02-11

### Outcome

Approved after fixes (HIGH/MEDIUM resolved)

### Findings Resolved

- [HIGH] `tests/integration/health.test.js` 的 `stopProc` 在子进程已退出场景可能等待挂死，已改为基于 `exitCode/signalCode` 的安全退出判断并加超时等待。
- [MEDIUM] `package.json` 缺少 `test` 脚本导致 `npm test` 不可用，已新增 `test: node --test`。
- [MEDIUM] Story File List 与实际改动不一致，已补齐本 Story 涉及的应用代码与测试文件记录。
- [LOW] `tests/integration/health.test.js` 对 `stderr` 的“全空”断言易受环境 warning 干扰，已改为仅在关键错误日志出现时失败。

### Verification

- `npm test` 通过
- `node --test` 通过
