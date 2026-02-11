# Story 2.4: Redis 共享状态与 schemaVersion 降级机制

Status: review

## Story

As a 平台工程师,  
I want 在 stable/canary 间共享最小状态并处理 schema 兼容,  
so that 灰度切流时对话不会因状态漂移而随机失败.

## Acceptance Criteria

1. **Given** stable 与 canary 使用同一 Redis  
   **When** 请求在不同通道间切换  
   **Then** 会话状态可连续读取与复用  
   **And** 不因通道切换丢失上下文
2. **Given** 读取到未知或损坏的 `schemaVersion` 状态  
   **When** 服务执行解析  
   **Then** 按 miss 降级为新会话而非返回失败  
   **And** 记录可观测事件用于排障

## Tasks / Subtasks

- [x] 1. 会话存储后端扩展为 Redis + 内存降级（AC: #1）
  - [x] 新增 Redis 连接与会话 key 前缀配置
  - [x] 在 session 读写清理路径接入 Redis
  - [x] Redis 不可用时自动降级到内存，保证请求不中断
- [x] 2. schemaVersion 兼容与降级（AC: #2）
  - [x] 引入 `schemaVersion` 会话结构（当前版本 `1`）
  - [x] 读取到未知/损坏结构时按 miss 降级并清理坏数据
  - [x] 记录可观测告警日志（`Session schema miss`）
- [x] 3. 自动化回归与文档（AC: #1 #2）
  - [x] 新增 Redis 共享会话跨实例复用集成测试（环境支持时执行）
  - [x] 新增未知 schemaVersion 降级集成测试（环境支持时执行）
  - [x] 更新 `.env.example` / `README.md` / `docs/session.md`
  - [x] 全量测试通过

## Dev Notes

### Architectural Guardrails

- Redis 作为默认状态存储，内存作为降级路径。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Data Architecture`]
- schemaVersion 只增不改；未知版本或解析失败按 miss 新建会话。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Data Modeling Approach`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有会话存储为进程内 `Map`，无跨实例共享能力。  
  [Source: `server.js`]
- 现有会话对象未带 `schemaVersion`，无法执行版本化校验。  
  [Source: `server.js`]

### Testing Requirements

- 覆盖 Redis 共享状态下跨实例会话连续性。
- 覆盖未知/损坏 `schemaVersion` 的降级行为（按 miss 新会话）。
- 在无 Redis 运行环境下测试允许跳过 Redis 专项用例，但其他回归必须通过。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 2.4: Redis 共享状态与 schemaVersion 降级机制`
- `_bmad-output/planning-artifacts/architecture.md#Data Architecture`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 会话存储升级为“Redis 优先 + 内存降级”，默认 `SESSION_STORE_MODE=redis`。
- 新增会话对象 `schemaVersion=1`，统一校验并在异常结构时降级为 miss。
- 新增 `Session schema miss` 日志用于排障观测。
- 补齐 `REDIS_URL`、`REDIS_SESSION_PREFIX` 等配置文档与说明。
- 本地环境缺少 `redis-server` 可执行文件，Redis 专项集成测试以 `skip` 执行；其余测试全绿。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `.env.example`
- `README.md`
- `docs/session.md`
- `package.json`
- `package-lock.json`
- `_bmad-output/implementation-artifacts/2-4-redis-共享状态与-schemaversion-降级机制.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 2.4（Redis 共享状态与 schemaVersion 降级机制）：接入 Redis 会话存储、schemaVersion 降级与回归测试。
