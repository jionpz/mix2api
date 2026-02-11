---
stepsCompleted: [1, 2, 3]
workflowType: 'party-mode'
user_name: '皇上'
date: '2026-02-11'
agents_loaded: true
party_active: false
workflow_completed: true
session_topic: 'mix2api 一句话定位 / MVP / SLO / 路线图与灰度回滚'
key_outcomes:
  - '一句话定位（内部版）：mix2api 是 new-api 后置的内部上游适配层（provider），把自建模型网站输出为语义稳定的 OpenAI Chat Completions（tools 闭环 + SSE streaming，MCP 链路不破坏），可观测优先、最小状态（可选 Redis），保障 OpenCode/Claude Code 近期可用并可验收。'
  - 'MVP 范围：仅 Chat Completions（不做 /responses）；OpenCode 与 Claude Code 分别达成 SLO。'
  - 'MVP SLO（rolling 24h，排除 client_abort）：成功率 ≥ 99.0%；工具调用成功率 ≥ 97.0%（仅统计出现 tool_calls 的请求）；断流率 ≤ 0.5%（仅统计 stream=true 且非 client_abort）。'
  - '灰度与回滚：new-api 按权重灰度（0%→5%→20%→50%→100%）；stable/canary 两套 mix2api 容器；短窗回滚触发（10–15min）：adapter_error>0.5% 或 5xx>1% 或 非 client_abort 断流>1%。'
  - '共享 Redis：stable/canary 共用同一套 Redis；要求 schemaVersion 前后兼容；解析失败/未知版本按 miss 自动新会话；会话隔离优先（按 auth 指纹/显式 header）。'
---

# Party Mode Session Summary (mix2api)

本次 Party Mode 用于在产品简报 Step 2（愿景/定位）阶段，快速把“定位、验收、范围、路线图、灰度回滚策略”对齐为可执行的工程契约，供后续写入 `product-brief-mix2api-2026-02-10.md`。
