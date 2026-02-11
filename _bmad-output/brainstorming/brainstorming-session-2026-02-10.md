---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: '为 Claude Code 构建可用的 LLM 网关/转接后端（尽量配合 new-api），并选型可复用的同类开源框架'
session_goals: '在 GitHub（2026-02）筛选 3 个核心同类框架；做对比维度+打分表；输出迁移方案（步骤/里程碑/风险/回滚/灰度）'
selected_approach: 'user-selected'
techniques_used: ['Five Whys', 'Assumption Reversal', 'Question Storming']
ideas_generated: 33
context_file: ''
prioritized_questions: [21, 24, 25, 29]
target_architecture: 'Claude Code / OpenCode → new-api → 本项目（自建模型网站适配层）'
session_active: false
workflow_completed: true
---

# Brainstorming Session Results

**Facilitator:** 皇上
**Date:** 2026-02-10

## Session Overview

**Topic:** 为 Claude Code 构建可用的 LLM 网关/转接后端（尽量配合 new-api），并选型可复用的同类开源框架
**Goals:** 在 GitHub（2026-02）筛选 3 个核心同类框架；做对比维度+打分表；输出迁移方案（步骤/里程碑/风险/回滚/灰度）

### Context Guidance

_未提供 context_file，本次以对话信息为准。_

### Session Setup

_已确认：候选框架数量=3；目标是让 Claude Code → 本项目 → 后端模型/网页后台模型的链路稳定可用，并尽量与 new-api 生态配合（例如复用 OpenAI 兼容接口、Key 管理、模型路由等能力）。_

## Technique Selection

**Approach:** User-Selected Techniques
**Selected Techniques:**

- **Five Whys**：用于把“链路不稳定/不可用”的现象追到根因（协议/鉴权/流式/限流/会话/工具调用等）。
- **Assumption Reversal**：用于反转关键假设，避免选型与迁移被隐含约束锁死（例如“必须强绑定某接口形态/必须完全兼容某协议”等）。
- **Question Storming**：用于先把问题空间问清楚（同类框架定义、必要能力、评估维度、迁移风险与验证方法），再进入检索与选型。

**Selection Rationale:** 你希望先把“真实问题”和“关键假设”澄清，再据此去 GitHub 筛选 3 个核心框架，并形成对比打分表与迁移方案。

## Technique Execution (In Progress)

### Question Storming — Round 1（只产出问题，不回答）

**[Client #1]**: 双客户端兼容
_Concept_: Claude Code 和 OpenCode 是否都能兼容同一套入口（协议/URL/鉴权）？如果不能，需要哪两套入口并存（例如 OpenAI-compatible 与 Anthropic-native）？
_Novelty_: 这决定我们寻找的“同类框架”是单协议网关还是多协议网关。

**[Architecture #2]**: 端到端链路拓扑
_Concept_: 是否必须支持 Claude Code/OpenCode → new-api → 本项目 → 后端/网页后台模型，并确保响应最终按客户端期望的流式协议回传？链路中每一段分别负责路由/配额/日志/改写吗？
_Novelty_: 把职责边界定清，避免重复网关与双重改写导致不可控的兼容问题。

**[Runtime #3]**: 代理运行时能力范围
_Concept_: 是否需要完整支持工具调用、上下文管理、MCP、skills 等能力？这些能力由客户端提供还是需要网关/框架提供与桥接？
_Novelty_: 避免把客户端能力误当成网关能力，从而选错框架导致迁移后仍不满足需求。

**[Client #4]**: Claude Code 的可配置入口
_Concept_: Claude Code 允许配置哪些连接参数（baseURL/endpoint/custom headers/proxy）？它期望的协议是 OpenAI Chat Completions、OpenAI Responses API 还是 Anthropic `/v1/messages`？
_Novelty_: 直接决定我们应实现哪类兼容层与 GitHub 筛选关键字。

**[Client #5]**: OpenCode 的可配置入口
_Concept_: OpenCode 期望的 API 形态是什么（OpenAI Chat Completions/Responses/其他）？是否支持自定义 header 与代理，还是只能依赖环境变量？
_Novelty_: 避免只兼容 Claude Code，导致 OpenCode 断链。

**[Protocol #6]**: 流式语义一致性
_Concept_: 需要支持哪些 streaming 语义（SSE、delta 事件、`[DONE]`、tool delta、usage 事件、心跳/重连）？new-api 会不会改写流式事件，导致兼容性差异？
_Novelty_: 绝大多数“不兼容”死在 streaming 细节而非普通 JSON 响应。

**[Protocol #7]**: 工具调用协议桥接
_Concept_: 工具调用需要兼容哪些 schema（OpenAI `tool_calls`/`function_call` vs Anthropic `tool_use`/`tool_result`）？是否需要在不同 schema 间转换与补全字段？
_Novelty_: 这是“同类框架”差异最大的能力之一。

**[Runtime #8]**: MCP 的交互边界
_Concept_: MCP 是由 Claude Code 本地作为 MCP client 直连 MCP servers，还是要求本项目代理/聚合 MCP？若要代理，认证、隔离与网络策略如何定义？
_Novelty_: MCP 是新范式，很多框架完全不覆盖或边界不清会带来安全风险。

**[State #9]**: 上下文/会话的归属
_Concept_: 会话由客户端每次带 messages 管理，还是服务端持久化 threads/sessions？是否必须兼容你现有的“会话 id + TTL”机制（类似 exchangeId/sessionId）？
_Novelty_: 会话归属决定数据结构、存储与横向扩展方式。

**[Runtime #10]**: skills/插件体系需求
_Concept_: 你说的 skills 是客户端侧技能，还是你希望服务端/网关也有插件执行与扩展点？如果服务端要执行插件，权限隔离与审计如何做？
_Novelty_: 如果要服务端插件，就不能只选 API proxy，需要更像 agent runtime。

**[Security #11]**: Key、多租户与 RBAC
_Concept_: 是否需要多用户/多项目 key 管理、配额、角色权限、审计日志？这些由 new-api 提供还是本项目补齐？
_Novelty_: 决定候选框架是否必须自带 Admin/RBAC/计费能力。

**[Security #12]**: 日志、隐私与数据保留
_Concept_: 是否需要保存请求/响应用于排障、复盘与成本分析？脱敏、加密、访问控制、保留周期与删除策略是什么？
_Novelty_: 成熟产品常败在“可观测性 vs 隐私合规”的权衡上。

**[Ops #13]**: 观测与成本指标
_Concept_: 需要哪些指标（token/费用、延迟、错误率、重试次数、工具调用失败率、按用户/模型统计）？是否需要 Prometheus/OpenTelemetry/Sentry？
_Novelty_: 这是从“能转发”走向“可运维产品”的分水岭。

**[Reliability #14]**: 路由、重试与降级策略
_Concept_: 是否需要多模型路由（成本/质量/可用性）、自动 failover、熔断、并发限制、队列与重试？这些机制放在 new-api、框架还是本项目实现？
_Novelty_: 可靠性机制往往比“协议转换”更决定最终体验。

**[Deployment #15]**: 部署形态与状态管理
_Concept_: 目标部署是单机 Docker、本地代理、K8s 多副本还是混合？是否要求无状态化（共享会话存储）与零停机升级？
_Novelty_: 直接影响框架可选范围与迁移复杂度。

**[Selection #16]**: “同类框架”硬性标准
_Concept_: 你定义的同类框架必须具备哪些不可妥协能力（多协议/工具调用桥接/路由配额/管理台/插件等）？哪些是“有最好、没有也行”？
_Novelty_: 没有硬标准，就无法在 GitHub 上高效筛出 3 个核心候选。

**[Selection #17]**: “最流行/成熟”的衡量方式
_Concept_: 你更看重哪些信号（stars、近 90 天活跃度、issue 响应、release 频率、安全公告、文档质量、企业用户案例）？
_Novelty_: 避免只按 stars 选到“过气但星高”的项目。

**[Migration #18]**: 迁移最小切口（MVP）
_Concept_: 迁移时你希望先保证哪条链路可用作为 MVP（先 Claude Code 再 OpenCode？先 chat 再 tools/MCP？先单租户再多租户）？
_Novelty_: 切口选错会导致迁移战线过长与风险爆炸。

**[Migration #19]**: 灰度与回滚策略
_Concept_: 是否需要旧服务与新框架并行（双跑/双写）、按用户/模型灰度、以及一键回滚？允许的失败窗口与 SLO 是什么？
_Novelty_: 把风险控制前置，迁移期才不会频繁“停摆”。

**[Integration #20]**: 与 new-api 的组合方式
_Concept_: 你更希望 new-api 作为“上游统一入口”还是“下游 provider 聚合层”？本项目在链路中扮演协议转换层、策略层还是专有 provider 适配层？
_Novelty_: 决定我们应该找“gateway/proxy”还是“agent runtime/平台型框架”。

### Question Storming — Round 2（基于你当前现状继续发问）

**[Reality #21]**: Claude Code 目前未跑通
_Concept_: Claude Code 卡住的“具体失败点”是什么：无法配置 baseURL/代理？协议不匹配（Anthropic-native vs OpenAI-compatible）？鉴权/证书问题？还是流式/工具调用阶段崩溃？
_Novelty_: 不回答“怎么修”，先把失败类型定清，才能反推应该选“多协议网关”还是“单协议 + 网络代理”。

**[Reality #22]**: OpenCode 已跑通但工具调用不稳定
_Concept_: OpenCode 工具调用的错误属于哪一类：schema 不匹配、参数缺失、JSON 不合法、流式中断、工具结果回填不被模型采纳、还是模型“没调用工具就收尾”？
_Novelty_: 工具调用故障常被误认为“模型不智能”，但根因往往是协议/事件序列/约束提示。

**[UX #23]**: 对话自动结束且未编辑代码
_Concept_: “不编辑代码就结束聊天”的触发条件是什么：超时、上游模型提前输出 final、工具调用强制规则缺失、还是客户端把某些响应当作结束信号？
_Novelty_: 这决定迁移方案里是否必须加入“强制工具调用/强制 patch/强制回写”的防呆机制。

**[Scope #24]**: 近期目标允许 Claude Code 暂不兼容
_Concept_: 既然短期可暂不兼容 Claude Code，那“现在必须达成的最小可用链路”是什么（OpenCode chat + streaming + tool calls）？Claude Code 兼容需要被锁定成哪些未来必达的非功能约束？
_Novelty_: 用“阶段性合同”避免一次性背上过多兼容债。

**[Boundary #25]**: new-api 负责即可（哪些具体职责？）
_Concept_: new-api 负责：用户/Key/配额/路由/管理台/计费/审计中的哪些？本项目必须补齐哪些（协议转换、token 抓取、流式适配、工具调用桥接、可观测性）？
_Novelty_: “职责边界图”是选型打分表里最关键的一列。

**[Auth #26]**: 自建模型网站需要抓 token
_Concept_: token 获取方式是什么：手工一次性获取、用户名密码登录换 token、OAuth/扫码、还是浏览器 cookie/session？token 的过期策略与刷新方式是什么？
_Novelty_: 这会直接决定候选框架需不需要“browser automation/headless 登录”能力或可插拔认证模块。

**[Security #27]**: token 安全与多租户隔离
_Concept_: token 是全局共用还是按用户隔离？需要加密存储、审计、最小权限、以及防泄漏（日志脱敏、header 过滤）吗？
_Novelty_: 很多“能跑的代理”无法产品化的根因在这里。

**[Ops #28]**: 排障所需的最小可观测性集合
_Concept_: 为了跑通 Claude Code/OpenCode，你最需要哪些观测：端到端 request-id、上游/下游耗时、SSE 事件序列、工具调用 payload、以及错误样本回放？
_Novelty_: 没有可观测性，你只能靠猜；有了它，迁移方案可以变成可验证的里程碑。

**[Selection #29]**: GitHub 搜索与筛选的“硬指标”
_Concept_: 选“同类框架”时，硬指标是什么：近 90 天 commit、维护者响应、release 频率、OpenAI/Anthropic 兼容范围、工具调用支持、部署形态、许可证、以及是否易于自定义 provider？
_Novelty_: 把“最流行”从主观变成可打分的客观量表。

**[Migration #30]**: 迁移的最小切口与灰度验证
_Concept_: 迁移第一阶段要验证什么：先保证 OpenCode chat+streaming 稳定，再加 tool calls，再加 token 自动刷新，再考虑 Claude Code？每一步的“通过标准”是什么？
_Novelty_: 让迁移方案从“计划”变成“验收清单驱动”的工程过程。

**[Architecture #31]**: 统一入口确定为 new-api
_Concept_: Claude Code 与 OpenCode 都先对接 new-api；new-api 作为唯一 client-facing 入口；new-api 再对接本项目（本项目作为上游 provider/适配层）。
_Novelty_: 明确了“谁是入口、谁是上游”，后续选型/打分只需围绕 new-api 的能力边界与本项目的 provider 适配能力展开。

**[Constraint #32]**: 不使用 K8s
_Concept_: 部署以单机/容器为主，不引入 K8s/CRD 体系；因此优先选择“Docker 可落地”的方案（或能在 docker-compose/单机部署跑稳的框架）。
_Novelty_: 直接排除或降低“强依赖 K8s 的网关框架”，把精力集中在协议/工具调用/稳定性与可观测上。

**[Boundary #33]**: new-api 负责用户与配额
_Concept_: 用户/Key/配额/路由治理尽量交给 new-api；本项目聚焦：协议/流式兼容、token 抓取与刷新、以及对接“自建模型网站”。
_Novelty_: 这能避免“重复做一套控制台/计费/权限”，也让迁移方案更可控。

## Idea Organization and Prioritization

### Session Achievement Summary

- **Total Ideas Generated:** 33（以“可验证的问题/约束/假设”为单位）
- **Creative Techniques Used:** Question Storming（五问/假设反转未完整执行，但其意图已被收敛到行动计划与验收标准中）
- **Session Focus:** Claude Code/OpenCode 通过 new-api 访问你自建模型网站（需抓 token），并把当前项目升级成可产品化的适配层

### Thematic Organization（按主题聚类）

**Theme 1：客户端与协议兼容（Claude Code / OpenCode / OpenAI / Claude Messages）**
- 关键问题：#1 #4 #5 #6 #21 #24（Claude Code 没跑通的失败类型、OpenCode 已跑通的入口与 streaming 语义）

**Theme 2：工具调用 / MCP / skills 的边界与桥接**
- 关键问题：#3 #7 #8 #10 #22（工具调用 schema 与事件序列、MCP 是否需要被代理、skills 是否在服务端执行）

**Theme 3：new-api 与本项目的职责边界（你已定：new-api 做入口）**
- 关键问题：#2 #11 #14 #16 #20 #25 #31 #33（new-api 负责用户/Key/配额/路由；本项目做 provider/适配层）

**Theme 4：token 抓取与安全（自建模型网站）**
- 关键问题：#9 #12 #26 #27（token 获取/刷新、存储与脱敏、按用户隔离与审计）

**Theme 5：可观测性与可靠性（从“能转发”到“可运维”）**
- 关键问题：#13 #14 #28（request-id、SSE 事件序列、失败重试/熔断、成本与延迟指标）

**Theme 6：选型量表与迁移验收（你选中的核心）**
- 关键问题：#29 #30（GitHub 硬指标、分阶段 MVP、灰度/回滚与验收口径）

### Prioritization Results（你点名的 Top 优先级）

1) **#21 Claude Code 未跑通的失败类型**（未来要让 Claude Code → new-api 成立，必须先验证它可配置的 endpoint/协议形态）  
2) **#24 阶段性合同**（短期可先满足 OpenCode；Claude Code 延后但要把“未来必须达成的约束”写进验收清单）  
3) **#25 new-api 与本项目职责边界**（你已确定：new-api 做入口，本项目做上游 provider/适配层）  
4) **#29 GitHub 选型硬指标**（用于做对比打分表，防止只按 stars 选错）

## Framework Candidates（GitHub 核心同类框架：截至 2026-02-10）

> 说明：你最终入口已定为 new-api，因此下面 3 个框架中，new-api 为“主入口”，其余两个更偏“可选外挂（Claude Code/MCP/更强 tools）或未来替换入口的备选”。

### 1) Calcium-Ion/new-api（你选择作为入口）

- GitHub：`https://github.com/Calcium-Ion/new-api`
- Stars：17394（API 查询时间：2026-02-10）
- Latest release：`v0.10.9-alpha.3`（发布：2026-02-08）
- 关键能力（README 明示）：智能路由、失败自动重试、用户级限流；**OpenAI Compatible ⇄ Claude Messages**（格式转换）、OpenAI↔Gemini 转换等。

### 2) BerriAI/litellm（超高热度的 AI Gateway，可用于补齐 MCP / tools 能力或做 Claude Code 适配层）

- GitHub：`https://github.com/BerriAI/litellm`
- Stars：35687（API 查询时间：2026-02-10）
- Latest release：`v1.81.3-stable`（发布：2026-02-08）
- 关键能力（README 明示）：LiteLLM Proxy Server（AI Gateway）；**MCP Tools / MCP Gateway**（通过 `/chat/completions` 调 MCP 工具）。

### 3) Portkey-AI/gateway（Node/TS 网关 + Console，可用于补齐观测与 MCP Gateway 或作为备用入口）

- GitHub：`https://github.com/Portkey-AI/gateway`
- Stars：10569（API 查询时间：2026-02-10）
- Latest release：`v1.15.2`（发布：2026-01-12）
- 关键能力（README 明示）：`npx @portkey-ai/gateway` 本地启动；提供 Gateway Console；支持多 provider；提供 **MCP Gateway**。

## Comparison Scorecard（对比维度 + 打分表）

评分规则：每项 1–5 分；总分=∑(权重×分数/5)。分数是“面向你当前目标（new-api 为入口、不开 K8s、需 token 抓取、OpenCode 先跑稳）”的工程视角初评；Claude Code 相关项需要你后续实测确认。

| 维度（权重） | new-api | LiteLLM | Portkey |
| --- | ---: | ---: | ---: |
| 入口契合度（20） | 5 | 2 | 2 |
| OpenCode 兼容（10） | 5 | 5 | 5 |
| Claude Code 路径可行性（10） | 3 | 2 | 2 |
| tools / MCP 能力（15） | 3 | 5 | 4 |
| streaming & session 稳定性（10） | 4 | 4 | 4 |
| 自定义上游扩展（token 抓取）（15） | 4 | 4 | 3 |
| 可观测与运维（10） | 3 | 4 | 4 |
| 自托管简易度（无 K8s）（10） | 4 | 3 | 5 |
| **总分（100）** | **79** | **71** | **69** |

**解读：**
- **你当前架构下（new-api 为唯一入口），“迁移”不等于换网关**：更像是把本项目升级成一个稳定的 upstream provider/适配层，并把 new-api 的 channel/路由配置跑通。
- LiteLLM/Portkey 的价值主要在两类场景：  
  1) 未来 Claude Code 必须走 Anthropic-native/Claude Messages，而 new-api 入口无法直接满足时，作为“协议适配层”；  
  2) 你想要更强的 MCP 网关/可观测与工具生态时，作为外挂能力。

## Migration Plan（迁移方案：Claude Code/OpenCode → new-api → 本项目）

### Phase 0：把“现状问题”变成可复现用例（0.5–1 天）

- 固化 3 组回归用例（保存请求/响应样本）：  
  1) OpenCode：chat + streaming（无 tools）  
  2) OpenCode：chat + tools（最小工具集）  
  3) OpenCode：出现“未编辑代码就结束”的复现路径（触发条件、日志片段）
- 明确 Claude Code 未跑通的失败类型（#21）：是 endpoint 配置、协议不匹配、TLS/代理、还是 streaming/tools 阶段崩溃。

### Phase 1：明确职责边界与链路（1 天）

- **new-api（入口）负责**：用户/Key/配额/路由治理/限流（你已确认）。  
- **本项目（上游 provider/适配层）负责**：  
  - 对接自建模型网站（抓 token、刷新、失败重登）  
  - 协议/流式适配（对 new-api 呈现稳定的 OpenAI-compatible 上游）  
  - 关键可观测性（最小 request-id、上游耗时、SSE 事件序列、错误分类）

### Phase 2：把本项目改造成“只信任 new-api 的内部服务”（2–4 天）

- 将本项目从“接收用户 Authorization 并透传上游”升级为：  
  - 对外只允许来自 new-api 的调用（内网 + 共享 secret header）  
  - 上游 token 由本项目自行抓取与管理（不依赖客户端传 token）
- 重点修复 OpenCode 工具调用不稳（#22/#23）：  
  - 明确 tools 的输入/输出协议（JSON 合法性、tool_call_id 对齐、event 顺序）  
  - streaming 场景下的结束信号与超时策略（避免“自动结束”）

### Phase 3：new-api 配置上线与灰度（1–2 天）

- 在 new-api 里新增 channel：上游 base_url 指向本项目（Docker 内网地址）。  
- 灰度策略：  
  - 先只灰度 OpenCode 的 chat（无 tools）  
  - 再灰度 tools（从 1 个稳定工具开始）  
  - 每阶段都有“通过标准”（#30）：错误率、平均延迟、工具调用成功率、是否再现“自动结束”

### Phase 4：Claude Code（后置，但要写清验收标准）（时间盒：2–3 天）

- 若 Claude Code 支持自定义 base_url 且可对接 new-api 的“Claude Messages”能力，则优先直连 new-api。  
- 若无法直连：再评估引入 LiteLLM/Portkey 作为“Claude Code 协议适配层”（只服务 Claude Code，不影响 OpenCode 主链路）。

### 回滚策略（强制写死）

- new-api 保留旧 channel；通过路由/权重切换实现一键回滚  
- 本项目与新链路所有变更必须可通过环境变量开关（例如 token 管理开关、streaming 策略开关、tools 策略开关）

## Session Summary and Insights

- 你最关键的成功前提不是“再找一个更流行的网关”，而是把 **new-api ↔ 本项目** 的边界做成可验证、可灰度、可回滚的产品级链路。  
- Claude Code 未跑通属于“未来必须补的协议兼容债”，但可以通过阶段合同（#24）把风险从“现在就阻塞”变成“后置且可控”。  
- 对你这种“需要抓 token 的自建模型网站”场景，最容易产品化失败的不是转发本身，而是 **token 生命周期管理 + 可观测 + 工具调用/流式细节**。
