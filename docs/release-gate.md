# Release Gate A/B/C

本项目发布前必须执行回归包 A/B/C，任一失败都应阻断放量并触发回滚决策。

## 1. 执行方式

单包执行：

```bash
npm run test:pack:a
npm run test:pack:b
npm run test:pack:c
```

门禁一键执行（推荐）：

```bash
npm run release:gate -- stable v2026.02.11
```

执行结果会落在：

- `_bmad-output/release-gates/<timestamp>-<channel>/summary.txt`
- `_bmad-output/release-gates/<timestamp>-<channel>/pack-a-stream.log`
- `_bmad-output/release-gates/<timestamp>-<channel>/pack-b-tools-loop.log`
- `_bmad-output/release-gates/<timestamp>-<channel>/pack-c-cancel-timeout.log`

## 2. 包定义

- A（stream）：`stream=true` 基线、`[DONE]`、首包及时性、关键 completed 维度日志。
- B（tools-loop）：`tools`、legacy `functions`、`tool_calls`、tool backfill 闭环、MCP-safe。
- C（cancel-timeout）：timeout、client abort、上游错误分型。

## 3. 发布判定

- 三包全部通过：可进入下一档灰度。
- 任一失败：`gate=BLOCK`，必须先止血（回滚）后修复。

建议回滚动作：

1. new-api 将 canary 权重降到 0%（或切回 stable）。
2. 保存失败日志与关键 `x-request-id` 样本。
3. 复盘修复后从小流量重放（5%）。

## 4. 记录模板

```
release_channel: stable|canary
release_version: <version>
gate_result: PASS|BLOCK
pack_a: PASS|FAIL
pack_b: PASS|FAIL
pack_c: PASS|FAIL
rollback_action: none|weight_to_zero|switch_to_stable
evidence_request_ids:
  - <x-request-id-1>
  - <x-request-id-2>
summary_file: _bmad-output/release-gates/<timestamp>-<channel>/summary.txt
```
