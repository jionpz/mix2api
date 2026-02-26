# Sprint Change Proposal - 稳定性与安全默认值加固

Date: 2026-02-24  
Workflow: correct-course  
Mode: Incremental  
Author: BMad Master

## 1. 问题摘要

在 Epic 7 关闭后，基于代码审查与运行证据发现一组“测试可通过但生产风险偏高”的问题：

- 流式读取阶段缺少统一 timeout/abort 约束
- SSE 解析对标准帧容错不足
- Redis 不可用时 session store 静默退化内存，健康检查无降级信号
- 默认 `UPSTREAM_AUTH_MODE=pass_through` 存在凭据边界误用风险
- OpenAPI/README 与实现存在漂移（`413`、`/health` degraded 语义）

## 2. 影响分析

### 2.1 Epic / Story 影响

- 当前 `sprint-status.yaml` 中 epic 全部 done，不新增新 epic。
- 本次采用“Correct Course + 维护性增量修复”处理，作为发布前硬化补丁。

### 2.2 技术影响

- 涉及模块：`upstream-stream`、`upstream-read`、`session-store`、`routes/health`、`chat-handler`。
- 影响面：stream lifecycle、SSE protocol、health contract、auth defaults、文档契约。

## 3. 推荐路径

选择 **Direct Adjustment（增量校正）**：不改变产品范围，仅提升运行稳健性与运维可见性。

## 4. 已批准并已实施变更

1. Stream timeout/abort 端到端治理
   - 在流式桥接与 SSE 读取路径引入 timeout 驱动终止
   - client abort / timeout / upstream_error 的终止语义统一

2. SSE 解析鲁棒性升级
   - 引入统一 SSE parser，支持 `event:`/多行 `data:`/空行分帧

3. Session store 降级信号显式化
   - 新增 store health 结构
   - `/health` 在降级态返回 `503 + status=degraded + session_store`

4. 安全默认值调整
   - 默认 `UPSTREAM_AUTH_MODE` -> `static`
   - 默认 `SESSION_STORE_MODE` -> `auto`

5. 契约与文档对齐
   - OpenAPI 增补 `413 request_too_large`
   - OpenAPI 增补 `/health` degraded 响应
   - README/.env.example 与默认行为同步

## 5. 验收与证据

- 全量测试：`npm test` 通过（118 pass / 0 fail / 2 skipped）
- LSP：修改的 JS 文件无 error/warning
- 发布门禁：见本次 `release:gate` 新输出目录

## 6. 实施交接

- 该变更作为“发布硬化补丁”纳入 implementation artifacts。
- 后续若继续增强，建议新开 story：拆分 header timeout 与 stream idle timeout 双阈值配置。
