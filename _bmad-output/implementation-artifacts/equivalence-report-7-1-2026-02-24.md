# Stage Equivalence Report - Story 7.1

Date: 2026-02-24
Story: 7-1-配置与通用工具抽离
Scope: 配置读取与纯工具函数从 `server.js` 抽离，保持北向行为等价

## 1) 变更范围

- 新增模块
  - `config/env.js`
  - `config/runtime-config.js`
  - `config/model-utils.js`
  - `utils/common.js`
  - `utils/text.js`
  - `utils/json-text.js`
  - `utils/tool-parser.js`
  - `utils/tool-calls.js`
- 入口改造
  - `server.js` 改为导入上述模块，移除对应内联实现

## 2) 等价性验证结果

### 2.1 契约端点

- `/health`：正常返回 `200` 与 `{"status":"ok"}`
- `/v1/models`：默认模型列表与 `MODEL_LIST` 覆盖行为保持一致

### 2.2 请求可观测口径

- `x-request-id` 生成与透传逻辑保持不变
- `request.completed` 日志维度字段保持不变

### 2.3 已执行测试

执行命令：

```bash
node --test tests/unit/config-env.test.js tests/unit/config-model-utils.test.js tests/unit/utils-common.test.js tests/unit/utils-text.test.js tests/unit/utils-json-text.test.js tests/unit/utils-tool-parser.test.js tests/unit/utils-tool-calls.test.js tests/integration/health.test.js
```

结果：`28 passed, 0 failed`

覆盖点：
- 配置解析：int/bool/json
- 文本与 JSON 提取
- tool_call 容错解析
- tool_calls 过滤/参数归一化/OpenAI 结构映射
- 健康检查与模型列表端点行为

## 3) 风险与未覆盖项

- 未执行完整回归包 A/B/C（本阶段聚焦 7-1 的模块抽离与基础契约等价）
- 未覆盖上游真实链路联调（需在 7-2/7-3 后统一执行）

## 4) 阶段结论

- 结论：`PASS`
- 准入建议：允许进入 `7-2-中间件与路由入口抽离`
