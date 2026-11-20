/** 解释器类型定义 */

export type ArgValue = string | number | boolean | null | ArgValue[] | { [key: string]: ArgValue }

/** 一次点号调用：device.camera.open() 或 contact.getPersonByName('王二') */
export interface CallNode {
  /** 点号分割的路径，如 ['device','camera','open'] */
  path: string[]
  args: ArgValue[]
}

/** 调用链：first 的返回值作为后续每一步的接收者 */
export interface ChainNode {
  first: CallNode
  steps: CallNode[]
}

export class CommandError extends Error {}
export class ParseError extends Error {}

export type RiskLevel = 'low' | 'high'

export interface ParamSpec {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object'
  required?: boolean
  enum?: string[]
  desc?: string
}

export interface CommandContext {
  /** 需要二次确认时由 UI 层实现 */
  confirm(prompt: string): Promise<boolean>
  currentUserId: string | null
}

export interface CommandSpec {
  /** 注册键，如 'setting.setTheme' */
  name: string
  /** 供提示词展示的调用签名，如 "setting.setTheme('dark' | 'light')" */
  signature: string
  description: string
  params: ParamSpec[]
  risk: RiskLevel
  handler: (args: ArgValue[], ctx: CommandContext) => unknown | Promise<unknown>
}

export interface EntityMethodSpec {
  /** 如 'contact.sendMessage' */
  key: string
  entityKind: string
  method: string
  signature: string
  description: string
  risk: RiskLevel
}

/** 实体对象上携带的元信息 */
export interface EntityMeta {
  __kind: string
  __label: string
  __methods: Record<string, (...args: never[]) => unknown>
}

/** 单条命令的执行结果 */
export interface StepResult {
  /** 归一化后的命令文本，用于向用户展示 */
  command: string
  ok: boolean
  /** 成功文案（本地生成）或真实错误信息 */
  message: string
}

export interface ExecResult {
  ok: boolean
  /** 全部成功时为各条命令文案的汇总；失败时为真实错误信息（用于回喂 AI） */
  message: string
  /** 每条命令的执行结果，供 UI 逐条展示 */
  steps: StepResult[]
  /** 用户在二次确认时主动取消（此时不再触发 AI 二轮） */
  cancelled: boolean
}

/** OpenAI Chat Completions 的 reasoning_effort 取值 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** 创建带 LLM 能力的解释器所需的服务配置 */
export interface LlmConfig {
  /** OpenAI 兼容 API 基址，例如 https://provider.example/v1 */
  baseUrl: string
  /** 服务商密钥，作为 Authorization: Bearer 凭证发送 */
  apiKey: string
  /** 服务商要求的模型 ID */
  model: string
  /** 原样写入请求体的 reasoning_effort；不传则完全省略该字段 */
  thinking?: ReasoningEffort
  /** 替换默认角色文本「你是一个AI智能助手」 */
  systemPrompt?: string
}

export type LlmErrorKind = 'config' | 'request' | 'response'

/** LLM 请求相关的错误：创建配置无效、请求失败或响应内容不可用 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind
  constructor(kind: LlmErrorKind, message: string) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

export interface GenerateOptions {
  /** 取消尚未完成的 LLM 请求 */
  signal?: AbortSignal
}

/** run 的返回值：生成的命令文本与执行结果 */
export interface RunResult {
  source: string
  result: ExecResult
}

/** 无 LLM 配置的解释器：注册与执行共享同一张命令表 */
export interface Interpreter {
  registerCommand(spec: CommandSpec): void
  registerEntityMethod(spec: EntityMethodSpec): void
  getCommand(name: string): CommandSpec | undefined
  getEntityMethod(kind: string, method: string): EntityMethodSpec | undefined
  listCommands(): CommandSpec[]
  listEntityMethods(): EntityMethodSpec[]
  executeCommands(source: string, ctx: CommandContext): Promise<ExecResult>
}

/** 带 LLM 配置的解释器：可根据自然语言生成命令并直接执行 */
export interface LlmInterpreter extends Interpreter {
  /** 组装提示词并请求 LLM，返回命令字符串（不执行） */
  generateCommands(input: string, options?: GenerateOptions): Promise<string>
  /** 生成命令后用同一实例执行，返回生成的命令与执行结果 */
  run(input: string, ctx: CommandContext, options?: GenerateOptions): Promise<RunResult>
}
