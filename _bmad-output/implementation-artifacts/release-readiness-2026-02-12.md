# Release Readiness (2026-02-12)

## 1. Final Decision

- Decision: `GO`
- Scope: `stable` release gate
- Commit baseline: `5ae7c0e`
- Conclusion:
  - 全量测试通过（除 Redis 环境依赖导致的 2 个 skip）
  - 发布门禁 A/B/C 全部通过（`gate=PASS`）
  - Sprint/Workflow 状态已收敛到全量 done

## 2. Evidence

- Full test run (`node --test`):
  - tests: 43
  - pass: 41
  - fail: 0
  - skipped: 2 (`redis-server not available in test environment`)
- Release gate summary:
  - `_bmad-output/release-gates/20260212-040712-stable/summary.txt`
  - `gate=PASS`
  - `pack-a-stream=PASS`
  - `pack-b-tools-loop=PASS`
  - `pack-c-cancel-timeout=PASS`
- Status closure:
  - `_bmad-output/implementation-artifacts/sprint-status.yaml` (epic/story/retrospective 全部 done)
  - `_bmad-output/workflow-status.yaml`（next_recommended 收敛到 `sprint-status`）

## 3. Execution Commands

发布前（建议）：

```bash
node --test
npm run release:gate -- stable <release_version>
```

生产切流（建议顺序）：

1. canary 先 5%，观察关键分型指标
2. 无异常后逐档提升到 20% / 50% / 100%
3. 任一关键异常触发回滚（权重归零或切回 stable）

## 4. Watch Items

- 指标重点：
  - `end_reason=timeout|upstream_error|adapter_error` 占比
  - `stream=true` 的 `[DONE]` 完成率
  - tools-loop 成功率
- 当前已知限制：
  - Redis 专项用例在本机环境被 skip，建议在 CI/预发环境补齐 `redis-server` 后再做一次门禁复核

## 5. Rollback Checklist

1. 将 canary 权重降到 0%（或切回 stable）
2. 保留失败日志与 `x-request-id` 样本
3. 修复后从小流量重新放量，并复跑 A/B/C 门禁
