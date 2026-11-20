# AI 解释器内置 LLM 请求方案

- 日期：2026-11-19
- 更新：2026-11-20 创建参数改为命名参数（配置对象），`thinking` 取值对齐 OpenAI `reasoning_effort` 枚举
- 状态：待验收（已实施并通过自测，见文末「自测记录」）
- 范围：TypeScript 解释器及公开 npm 包 `ai-interpreter`

## 目标

让调用方创建解释器时传入 LLM 服务配置。注册命令后，解释器负责读取当前实例的命令清单、拼装系统提示词、请求 LLM、取得命令字符串，并可直接交给现有执行器。业务函数和执行时所需的用户上下文继续由应用提供。

当前 Web 端已有 Chat Completions 请求和命令提示词，可以作为实现参考。公开包沿用现有命令 DSL 和注册接口。原生工具调用协议属于另一个设计议题。[Web 请求实现](../../../web-client/src/services/ai/provider.ts) · [Web 提示词](../../../web-client/src/services/ai/prompt.ts) · [工具调用协议复审](../待决策/AI工具调用协议复审决策.md)

## 创建解释器

计划保留无参创建方式，同时新增一个接收 LLM 配置对象的重载。参数改为命名参数：调用方只写需要的字段，选项顺序不再敏感，后续新增配置项也不会破坏既有调用。下面是待实现的 TypeScript 接口。

```ts
/** OpenAI Chat Completions 的 reasoning_effort 取值 */
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  thinking?: ReasoningEffort
  systemPrompt?: string
}

function createInterpreter(): Interpreter

function createInterpreter(config: LlmConfig): LlmInterpreter
```

| 字段 | 要求 | 含义 |
| --- | --- | --- |
| `baseUrl` | 必填 | OpenAI 兼容 API 基址，例如 `https://provider.example/v1`。请求时去掉末尾斜杠，再拼接 `/chat/completions`。 |
| `apiKey` | 必填 | 服务商密钥，放入请求的 `Authorization: Bearer …`。 |
| `model` | 必填 | 服务商要求的模型 ID，放入请求体的 `model`。 |
| `thinking` | 选填，不传则不发送 | OpenAI Chat Completions 的 `reasoning_effort` 字段。传值时原样放入请求体；不传时完全省略，由服务商采用自己的默认强度。 |
| `systemPrompt` | 选填 | 默认角色文本为「你是一个AI智能助手」。传入自定义文本时，它替换这一段角色文本。库会在两种情况下都追加命令清单和 DSL 输出规则。 |

LLM 重载在创建时检查 `baseUrl`、`apiKey`、`model` 三个必填字段非空，并验证 `baseUrl` 是有效的 HTTP(S) 基址。各实例保有自己的服务配置和命令表。无需调用模型的现有代码可继续用无参重载执行命令字符串。运行时切换服务配置时，可用新的配置对象创建实例并注册同一组命令。[当前实例接口](https://github.com/gyy901/ai-interpreter/blob/main/src/interpreter.ts)

### 关于 `thinking` 的取值

原先拟用 `thinking: { type: 'enabled' | 'disabled' }`，那是部分服务商的私有扩展，不是 OpenAI 标准字段。现改为对齐 OpenAI Chat Completions 的 `reasoning_effort`：

- 字段名用 `reasoning_effort`，取值沿用 OpenAI 的 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，具体模型只支持其中一部分。
- 不传时完全省略该字段。默认请求体保持最小：普通 Chat Completions 端点不会因未知字段被拒，推理模型按服务商默认强度工作。
- 显式传值时原样发送；模型不支持该取值时服务端返回 400，库把它归入 LLM 请求错误并透传给调用方。
- 其他服务商的私有参数（ARK 的 `thinking`、DashScope 的 `enable_thinking` 等）不做自动映射，待有具体接入需求时再定义。[项目既有的服务商兼容性记录](../../problems/已完成/AI问答收不到回复（读超时过紧）.md)

## 库发送给 LLM 的内容

每次请求前从当前实例的注册表生成一条 `system` 消息。包含以下三部分，之后另发一条承载自然语言输入的 `user` 消息。

1. **角色文本**。使用创建实例时提供的 `systemPrompt`，省略时使用「你是一个AI智能助手」。
2. **可用命令**。根命令列出 `name`、`signature`、`description` 和参数元数据，包括类型、必填性、枚举及说明。实体方法列出注册键、实体类型、方法名、签名和说明。库只序列化这些描述字段，业务 `handler`、本地用户上下文和 API Key 留在各自的执行与鉴权路径中。注册表有新增命令时，下一次请求会带上新清单。
3. **命令语法和输出格式**。让模型输出可被现有 parser 读取的纯命令字符串。根调用用 `namespace.command(arg1, arg2)`，实体链式调用用 `namespace.command(...).method(...)`，多条独立命令用英文分号分隔。按签名填写位置参数，字符串加引号，转义字符串内的引号和换行。数字使用现有词法支持的非负十进制形式，布尔值和 `null` 使用字面量，对象和数组按声明填写。输出正文只包含清单允许的命令，使用一行纯文本。

库使用运行环境的 `fetch` 发起非流式 `POST /chat/completions`，从 `choices[0].message.content` 读取命令字符串。网络错误、非 2xx 响应、服务端返回错误和空内容归入 LLM 请求或响应错误。命令语法、参数、注册查询和高风险确认继续由执行器处理。失败时直接返回错误给调用方，由应用决定如何处理。[语法解析器](https://github.com/gyy901/ai-interpreter/blob/main/src/parser.ts) · [执行器](https://github.com/gyy901/ai-interpreter/blob/main/src/executor.ts)

## 调用方式草案

```ts
const interpreter = createInterpreter({
  baseUrl,
  apiKey,
  model,
  thinking: 'medium',
  systemPrompt: '你是一个帮助用户操作应用的助手',
})

interpreter.registerCommand({
  name: 'demo.echo',
  signature: "demo.echo('text')",
  description: '回显传入的文本',
  params: [{ name: 'text', type: 'string' }],
  risk: 'low',
  handler: ([text]) => text,
})

const { source, result } = await interpreter.run('请回显 hello', context)
// source 为 "demo.echo('hello')"，result.message 为 "hello"
```

| 方法 | 用途 |
| --- | --- |
| `generateCommands(input, options?)` | 组装提示词并请求 LLM，返回命令字符串。调用方可用它在执行前展示或审查命令。 |
| `run(input, context, options?)` | 调用 `generateCommands`，再用同一实例执行命令，返回 `{ source, result }`。请求支持通过 `options.signal` 取消。 |
| `executeCommands(source, context)` | 执行已有命令字符串，保留现有返回结构 `ExecResult`。 |

在 Web 端接入时，保存设置后用新的配置对象创建实例，注册和执行使用同一实例。现有灵讯 Web 命令使用顶层注册函数，后续迁移时需要把命令绑定到有 LLM 配置的实例，避免请求时读到空清单。应用仍提供用户身份、确认交互和结果展示。浏览器直接请求时，端点须允许其跨域访问，应用负责决定密钥存放位置。

## 实施与验收

1. 在包内新增 LLM 请求和提示词生成逻辑，加入创建函数重载，复用实例注册表和现有执行器。更新公共类型声明（`LlmConfig`、`ReasoningEffort`）和面向 npm 用户的 README，说明配置对象写法与 `reasoning_effort` 取值。
2. 用模拟 Chat Completions 服务验收。核对请求路径、模型 ID、Bearer 鉴权和 `reasoning_effort` 的省略/显式发送行为，以及取值不在 OpenAI 枚举内时创建阶段即报错。检查默认角色、自定义角色、两类注册项和 DSL 格式都正确进入系统消息。创建两个实例验证清单和服务配置隔离。
3. 用模拟返回的命令完成注册 → 生成 → 执行全链路。验证仅生成命令时 handler 尚未运行，请求失败、空响应和错误语法进入各自的错误路径，未注册命令被拒绝，高风险命令沿用宿主确认。
4. 执行包内测试和类型检查，打包后在独立消费者项目里通过公共入口验收。验证无参创建与直接执行流程，以及包内生成、执行命令的流程。再使用测试凭证向实际配置的兼容端点执行低风险回显，记录实际连通的供应商和模型。

## 自测记录

- 包内测试：`npm test` 共 11 项全部通过（原有 4 项 + 新增 7 项 LLM 用例）；`npm run typecheck` 通过。
- 新增用例覆盖：创建阶段配置校验（必填字段、非法 `baseUrl`、非枚举 `thinking`）；请求路径、模型、Bearer 鉴权、`reasoning_effort` 省略/显式发送；默认与自定义角色文本、根命令参数元数据、实体方法、DSL 规则进入系统消息；仅生成不执行 handler；`run` 全链路与未注册命令、错误语法的失败路径；双实例配置与清单隔离；HTTP 500、空内容、非法 JSON、网络错误、`AbortSignal` 取消。
- 独立消费者：`npm pack` 后在 `/tmp` 新建项目安装 tarball，通过公共入口完成无参实例直接执行、LLM 实例 `executeCommands`、取消请求冒烟测试；`.ts` 消费者文件对 `LlmConfig`、`ReasoningEffort`、`Interpreter`、`LlmInterpreter`、`GenerateOptions`、`RunResult`、`LlmError` 类型检查通过。
- 真实端点：火山方舟（ARK）`https://ark.cn-beijing.volces.com/api/v3`，模型 `doubao-seed-2-1-turbo-260628`，提示「请回显 hello」返回 `demo.echo('hello')` 并执行成功（`echo:hello`，约 2.2 秒）。未发送 `reasoning_effort`，使用服务商默认强度。
