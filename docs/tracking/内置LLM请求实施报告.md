# 内置 LLM 请求实施报告

- 日期：2026-11-20
- 依据：[AI解释器内置LLM请求方案](../plan/待验收/AI解释器内置LLM请求方案.md)
- 状态：已实施，自测通过，待验收

## 需求

调用方创建解释器时传入 LLM 服务配置，解释器读取当前实例命令清单、拼装系统提示词、请求 OpenAI 兼容 Chat Completions 接口，取得命令字符串并可直接交给现有执行器。业务函数与用户上下文仍由应用提供，无参创建方式保持兼容。

## 实施思路

1. 配置校验和提示词生成独立成模块，不侵入注册表与执行器。
2. `createInterpreter` 用重载区分无参与带配置两种返回类型，带配置实例复用同一张注册表和 `executeWithRegistry`，保证生成、执行看到同一份清单。
3. LLM 交互只做非流式 `POST /chat/completions`，错误统一收敛为 `LlmError`，按配置、请求、响应三个阶段区分 `kind`。
4. 请求体默认最小：不传 `thinking` 时不发送 `reasoning_effort`；未做任何服务商私有推理参数映射。

## 代码改动

- [src/llm.ts](file:///Users/yuyanggao/代码/ai-interpreter/src/llm.ts)：新增 `normalizeLlmConfig`（必填、HTTP(S) 基址、`thinking` 枚举校验）、`buildSystemPrompt`（角色文本 + 根命令及参数元数据 + 实体方法 + DSL 输出规则）、`requestCommands`（Bearer 鉴权、非流式请求、`choices[0].message.content` 提取、错误分类）。
- [src/types.ts](file:///Users/yuyanggao/代码/ai-interpreter/src/types.ts)：新增 `ReasoningEffort`、`LlmConfig`、`LlmError`、`GenerateOptions`、`RunResult`、`Interpreter`、`LlmInterpreter`。
- [src/interpreter.ts](file:///Users/yuyanggao/代码/ai-interpreter/src/interpreter.ts)：新增 `createInterpreter(config)` 重载，LLM 实例增加 `generateCommands` 与 `run`；无参行为不变。
- [src/index.ts](file:///Users/yuyanggao/代码/ai-interpreter/src/index.ts)：导出新增类型与 `LlmError`。
- [tsconfig.json](file:///Users/yuyanggao/代码/ai-interpreter/tsconfig.json)：`lib` 增加 `DOM`，为 `fetch`、`Response`、`AbortSignal` 提供类型（运行环境仍使用宿主自带 `fetch`，Node 18+ / 浏览器均可）。
- [README.md](file:///Users/yuyanggao/代码/ai-interpreter/README.md)：改写 LLM 章节为内置配置用法，补充字段表、`reasoning_effort` 取值说明、错误分类和方法表。
- [test/interpreter.test.mjs](file:///Users/yuyanggao/代码/ai-interpreter/test/interpreter.test.mjs)：新增 7 项 LLM 用例。

## 检验结果

- `npm run typecheck`：通过。
- `npm test`：11 项全部通过（原有 4 项 + 新增 7 项）。
- 模拟服务覆盖：请求路径与末尾斜杠处理、模型 ID、Bearer 鉴权、`reasoning_effort` 省略/显式发送、创建期配置报错、默认/自定义角色、两类注册项进入系统消息、仅生成不执行 handler、`run` 全链路、未注册命令与语法错误、高风险确认取消、双实例隔离、HTTP 500 / 空内容 / 非法 JSON / 网络错误 / `AbortSignal` 取消。
- 独立消费者：`npm pack` 后在 `/tmp` 新项目安装，公共入口冒烟测试与 `.ts` 类型检查均通过。
- 真实端点：火山方舟 ARK `https://ark.cn-beijing.volces.com/api/v3`、模型 `doubao-seed-2-1-turbo-260628`，低风险回显全链路成功，耗时约 2.2 秒。

## 已知边界

- 只解析字符串形式的 `message.content`，未处理多模态分段数组。
- 其他服务商私有推理参数（ARK `thinking`、DashScope `enable_thinking`）不自动映射，按计划留待具体接入需求。
- 默认不设超时，取消由调用方通过 `options.signal` 控制；应用可自行传入 `AbortSignal.timeout()`。

## 下一步

1. 人类或 Agent 按方案验收标准逐条核验。
2. 验收通过后把方案迁入 `docs/plan/已完成/`。
3. Web 端接入时，将顶层注册函数迁移到带 LLM 配置的实例，避免请求时读到空清单。
