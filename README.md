# ai-interpreter

## 介绍

`ai-interpreter` 是一个 TypeScript 命令解释器。应用把功能注册成命令，再传入 `demo.echo('hello')` 这样的命令字符串，解释器会校验参数、调用对应的处理函数并返回执行结果。命令字符串可以由程序直接提供，也可以由应用请求 LLM 生成。

## 安装命令

`ai-interpreter` 可从 npm 公开安装。以下示例使用 Node.js 22+ 和 ESM，包自带 TypeScript 类型声明。[npm 包页](https://www.npmjs.com/package/ai-interpreter)

```sh
npm install ai-interpreter
```

## 使用说明

### 注册命令

在应用目录创建 `commands.mjs`。`name` 是解释器查找命令的键，`signature` 和 `description` 用于告诉调用方和模型如何使用命令。

```js
import { createInterpreter } from 'ai-interpreter'

export const interpreter = createInterpreter()

interpreter.registerCommand({
  name: 'demo.echo',
  signature: "demo.echo('text')",
  description: '回显传入的文本',
  params: [{ name: 'text', type: 'string' }],
  risk: 'low',
  handler: ([text]) => text,
})

export const context = {
  currentUserId: null,
  confirm: async () => false,
}
```

把业务逻辑写在 `handler(args, context)` 中。`params` 按位置声明参数，支持 `string`、`number`、`boolean` 和 `object`，默认必填。可用 `required: false` 声明可选参数，用 `enum` 限定取值。将有敏感副作用的命令设为 `risk: 'high'`，并由应用实现 `context.confirm`。示例中的确认函数会拒绝这类命令。

### 执行命令字符串

创建 `run.mjs`，用同一个解释器执行命令。

```js
import { context, interpreter } from './commands.mjs'

const source = process.argv[2] ?? "demo.echo('hello')"
const result = await interpreter.executeCommands(source, context)

console.log(result.ok, result.message)
if (!result.ok) process.exitCode = 1
```

```sh
node run.mjs
# true hello

node run.mjs 'demo.echo(123)'
# false 参数「text」应为字符串
```

多条命令用英文分号分隔，例如 `demo.echo('first'); demo.echo('second')`。解释器按顺序执行，遇到失败或取消就停止，前面已发生的副作用会保留。

### 配置 LLM 生成命令

LLM 请求由应用发起。下面以 OpenAI 兼容的 Chat Completions 接口为例，在服务端用 `fetch` 获取命令文本，再交给同一个解释器。将以下配置写入应用的 `.env`，并将该文件加入 `.gitignore`。

```dotenv
LLM_BASE_URL=https://provider.example/v1
LLM_MODEL=your-model-id
LLM_API_KEY=your-api-key
```

`LLM_BASE_URL` 填供应商的 API 基址（包含供应商要求的版本路径），代码会追加 `/chat/completions`。`LLM_MODEL` 填供应商提供的模型 ID，`LLM_API_KEY` 会作为 Bearer 凭证发送。

创建 `run-with-llm.mjs`。

```js
import { context, interpreter } from './commands.mjs'

const { LLM_BASE_URL: baseUrl, LLM_MODEL: model, LLM_API_KEY: apiKey } = process.env
if (!baseUrl || !model || !apiKey) {
  throw new Error('请设置 LLM_BASE_URL、LLM_MODEL 和 LLM_API_KEY')
}

const allowedCommands = interpreter.listCommands()
  .map(({ signature, description }) => `${signature} — ${description}`)
  .join('\n')

const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    stream: false,
    messages: [
      {
        role: 'system',
        content: `只输出命令字符串，不要附加解释或 Markdown。可用命令：\n${allowedCommands}`,
      },
      { role: 'user', content: process.argv[2] ?? '请回显 hello' },
    ],
  }),
  signal: AbortSignal.timeout(30_000),
})

if (!response.ok) throw new Error(`LLM 请求失败（HTTP ${response.status}）`)
const { choices } = await response.json()
const source = choices?.[0]?.message?.content
if (typeof source !== 'string' || !source.trim()) {
  throw new Error('LLM 没有返回命令字符串')
}

const result = await interpreter.executeCommands(source.trim(), context)
console.log(result.ok, result.message)
if (!result.ok) process.exitCode = 1
```

```sh
node --env-file=.env run-with-llm.mjs '请回显 hello'
```

如果模型返回 `demo.echo('hello')`，终端会输出 `true hello`。接入应用时，按当前用户可用的能力注册命令，业务权限由处理函数校验。

## API 介绍

| API | 用途 |
| --- | --- |
| `createInterpreter()` | 创建拥有独立命令表的解释器。注册和执行使用同一个实例。 |
| `interpreter.registerCommand(spec)` | 接收 `CommandSpec`，注册根命令。相同 `name` 重复注册会抛错。 |
| `interpreter.listCommands()` / `interpreter.getCommand(name)` | 列出已注册的根命令，或按名称查询单条命令。可将签名和说明用于生成提示词。 |
| `interpreter.executeCommands(source, context)` | 解析并执行命令字符串，返回 `Promise<ExecResult>`。`CommandContext` 包含 `currentUserId` 和异步确认函数 `confirm`。 |
| `interpreter.registerEntityMethod(spec)` | 注册形如 `demo.entity().greet()` 的链式方法。注册键格式为 `实体类型.方法名`。根命令返回的对象用 `__kind` 标明类型，将方法定义为自身属性，并可用 `__label` 提供显示名。 |
| `interpreter.listEntityMethods()` / `interpreter.getEntityMethod(kind, method)` | 列出或查询已注册的链式方法。 |
| `tokenize(source)` / `parse(source)` / `renderChain(chain)` | 将源码拆为 token、解析成调用链，或将调用链转回规范化命令字符串。 |

`ExecResult` 包含 `ok`（是否全部成功）、`message`（结果或错误文案）、`steps`（逐条结果，每条含 `command`、`ok`、`message`）和 `cancelled`（用户是否取消确认）。只需要检查语法时可以直接用 `parse`，语法无效会抛出 `ParseError`。

包也导出了顶层的 `registerCommand`、`registerEntityMethod`、`executeCommands` 和相应查询函数，它们共享默认命令表。不同调用场景需要各自的命令时，可分别创建独立实例。

## 本地开发

```sh
npm install
npm test
```

`npm test` 会先构建到 `dist/`，再运行 `test/` 下的用例。发布前执行 `npm publish`，`prepublishOnly` 会重跑测试。
