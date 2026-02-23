# Release Readiness (2026-02-24)

## 1. Final Decision

- Decision: `GO`
- Scope: `stable` release gate（Epic 6 增量）
- Commit baseline: `1d9c2a3`
- Conclusion:
  - 全量回归通过：`node --test` = 65 tests / 63 pass / 0 fail / 2 skipped（Redis 依赖）
  - 发布门禁 A/B/C 全部通过：`gate=PASS`
  - Epic 6（模型画像、预算预检、裁剪恢复、输出映射、预算观测）已完成并完成回顾

## 2. Evidence

- Full test run:
  - Command: `npm test`
  - Result: `pass=63 fail=0 skipped=2`
  - Skip reason: `redis-server not available in test environment`
- Release gate summary:
  - `_bmad-output/release-gates/20260224-030913-stable/summary.txt`
  - `pack-a-stream=PASS`
  - `pack-b-tools-loop=PASS`
  - `pack-c-cancel-timeout=PASS`
  - `gate=PASS`
- Status closure:
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`（epic-6 与 retrospective 均为 `done`）
  - `_bmad-output/workflow-status.yaml`（新增本次 release-readiness 输出）

## 3. Execution Commands

发布前复核：

```bash
npm test
npm run release:gate -- stable epic6
```

生产切流建议：

1. canary 5% 观察预算拒绝率与 `end_reason` 异常占比
2. 正常后提升到 20% / 50% / 100%
3. 任一关键指标异常触发回滚

## 4. Watch Items

- 预算相关指标重点：
  - `model.profile.budget_observation` 中 `reject_reason` 占比
  - `truncation_applied=true` 变化趋势（按模型维度聚合）
  - `model.profile.resolve` 的 fallback warning 频率
- 兼容性重点：
  - stream/non-stream 在默认输出预算下的一致性
  - `max_tokens` 非法入参回退到默认预留预算的比例
- 已知限制：
  - Redis 专项测试仍依赖外部 `redis-server`，在当前环境是 skip，建议在 CI/预发补跑

## 5. Rollback Checklist

1. 将 canary 权重降为 0%（或切回上一 stable）
2. 收集失败样本 `x-request-id` 与预算观测日志
3. 修复后从小流量重放并复跑 A/B/C 门禁
