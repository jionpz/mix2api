# 工具调用 / MCP / 上下文 / skills（设计说明）

本项目的原则是：**网关/适配层优先保证协议与闭环稳定，不抢客户端运行时的职责**。

## 工具调用（OpenAI tools / tool_calls）

### 目标

- 只要请求带 `tools`，就进入“工具调用模式”：
  - 上游返回工具调用时，`mix2api` 产出 OpenAI 规范的 `tool_calls`
  - 客户端执行工具后以 `role: "tool"` 回传工具结果
  - `mix2api` 在下一轮把 tool 结果带给上游，让模型输出最终回答

### 与 LiteLLM 的共性（可学习点）

- 工具调用闭环必须严格：`assistant(tool_calls) → tool → assistant(final)`
- 工具 schema 很大时需要裁剪/摘要（本项目通过 `reduceTools()` + `TOOL_*` 环境变量控制）
- 需要防止“工具指令只注入一次导致模型后续忘记协议”（本项目改为：只要请求带 tools 就注入指令/摘要）

## 上下文管理

优先依赖上游 `session_id` 来管理对话历史：

- 有 `session_id`：裁剪 messages（降低 token 与延迟）
- 无 `session_id`：可选把对话历史压缩拼进 query（`INCLUDE_CONTEXT_IN_QUERY`）

此外，本项目会尽量保留完整的工具调用链（`CONTEXT_PRESERVE_TOOL_CHAINS=true`）。

## MCP（Model Context Protocol）

### 现状

- Claude Code/OpenCode 的 MCP 往往是 **客户端直连 MCP Server**。
- `mix2api` 当前 **不执行 MCP 工具**，只保证工具调用协议不被破坏。

### 向 LiteLLM 学习的方向（Roadmap）

LiteLLM 支持把 MCP Server 作为 “tool descriptor”（`type: "mcp"`）在 `/chat/completions` 中使用，并由网关侧执行。

本项目当前会 **忽略非 function 类型的 tools**（例如 `type:"mcp"`），避免污染提示词与选择逻辑；如果你要做“服务端 MCP Gateway”，建议新增一个专门的 MCP 模块/服务，按 LiteLLM 的方式实现：

- MCP server 注册与鉴权
- tools/list → 转 OpenAI tools schema
- tools/call → 生成 tool result，并驱动模型继续

## skills

skills（例如 Claude Code/OpenCode 的技能系统）通常属于客户端能力：

- 本项目不实现/不执行 skills
- 通过稳定的 tool_calls、流式语义、session_id 与上下文策略，保证客户端技能系统能正常工作

