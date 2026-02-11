# 架构与职责边界

目标架构（双容器，无需 K8s）：

```
Claude Code / OpenCode → new-api → mix2api → 上游模型网站（你的后台大模型）
```

## new-api（入口）

建议承担：

- 用户/Key/配额/路由/模型映射
- 管理后台、统计、审计、限流
- 对外统一的 OpenAI / Claude Messages 入口（视 new-api 版本能力而定）

## mix2api（内部上游适配层）

建议聚焦：

- **协议/流式适配**：对 new-api 暴露稳定的 OpenAI Chat Completions
- **上游会话 session_id**：提取与复用上游 `sessionId`，降低上下文拼接开销
- **工具调用闭环**：稳定产出 `tool_calls`（由客户端执行工具），并在下一轮携带 `tool` 结果让模型总结
- **可观测性**：request-id、上游耗时、错误分类、可选的 body/header 日志（注意脱敏）

## 为什么不把 MCP/skills 放在网关里做？

- Claude Code/OpenCode 的 **tools/MCP/skills** 多数属于客户端运行时能力，网关应以“兼容/不破坏协议”为优先。
- 如果确实需要“服务端执行工具”（例如把 MCP Server 统一托管在服务器侧），建议单独做一个 MCP Gateway（可以参考 LiteLLM 的思路），避免把 mix2api 变成臃肿的执行环境。

