import type { CommandRegistry } from './registry.js'
import {
  LlmError,
  type GenerateOptions,
  type LlmConfig,
  type ParamSpec,
  type ReasoningEffort,
} from './types.js'

/** 未提供 systemPrompt 时使用的角色文本 */
export const DEFAULT_SYSTEM_PROMPT = '你是一个AI智能助手'

/** 与 OpenAI Chat Completions 的 reasoning_effort 枚举保持一致 */
const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** 校验并归一化后的实例服务配置 */
export interface LlmSettings {
  /** 已去掉末尾斜杠并拼接 /chat/completions 的请求地址 */
  endpoint: string
  apiKey: string
  model: string
  thinking?: ReasoningEffort
  systemPrompt: string
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new LlmError('config', `创建 LLM 解释器需要提供非空的 ${field}`)
  }
  return value.trim()
}

/** 创建时校验必填字段与 baseUrl；不合法时抛 LlmError（kind: 'config'） */
export function normalizeLlmConfig(config: LlmConfig): LlmSettings {
  if (!config || typeof config !== 'object') {
    throw new LlmError('config', '创建解释器需要传入 LLM 配置对象')
  }
  const baseUrl = requireText(config.baseUrl, 'baseUrl')
  const apiKey = requireText(config.apiKey, 'apiKey')
  const model = requireText(config.model, 'model')

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new LlmError('config', `baseUrl 不是有效的地址：${baseUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LlmError('config', `baseUrl 必须是 HTTP(S) 地址：${baseUrl}`)
  }

  const thinking = config.thinking
  if (thinking !== undefined && !REASONING_EFFORTS.includes(thinking)) {
    throw new LlmError('config', `thinking 只能是 ${REASONING_EFFORTS.join(' / ')}`)
  }

  return {
    endpoint: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
    apiKey,
    model,
    thinking,
    systemPrompt:
      config.systemPrompt === undefined
        ? DEFAULT_SYSTEM_PROMPT
        : requireText(config.systemPrompt, 'systemPrompt'),
  }
}

function formatParam(param: ParamSpec): string {
  const parts = [param.type, param.required === false ? '选填' : '必填']
  if (param.enum && param.enum.length > 0) parts.push(`可选值：${param.enum.join(' / ')}`)
  if (param.desc) parts.push(param.desc)
  return `${param.name}（${parts.join('，')}）`
}

/** 生成系统消息：角色文本 + 当前注册表清单 + 命令语法与输出规则 */
export function buildSystemPrompt(systemPrompt: string, registry: CommandRegistry): string {
  const lines: string[] = [systemPrompt, '', '# 可用命令']

  const commands = registry.listCommands()
  if (commands.length === 0) {
    lines.push('（无）')
  } else {
    for (const spec of commands) {
      lines.push(`- ${spec.signature}：${spec.description}`)
      if (spec.params.length > 0) lines.push(`  参数：${spec.params.map(formatParam).join('；')}`)
    }
  }

  lines.push('', '# 实体方法', '实体方法需通过根命令返回的对象做链式调用（namespace.command(...).method(...)）：')
  const methods = registry.listEntityMethods()
  if (methods.length === 0) {
    lines.push('（无）')
  } else {
    for (const spec of methods) {
      lines.push(
        `- ${spec.key}：实体类型 ${spec.entityKind}，方法 ${spec.method}，签名 ${spec.signature}，说明：${spec.description}`,
      )
    }
  }

  lines.push(
    '',
    '# 输出规则',
    '只输出一行纯文本命令，不要附加解释、Markdown 代码块或其他文字。',
    '1. 根命令写成 namespace.command(arg1, arg2)；实体链式调用写成 namespace.command(...).method(...)。',
    '2. 多条互不依赖的命令用英文分号 ; 分隔。',
    '3. 按签名顺序填写位置参数；字符串用单引号包裹，转义其中的反斜杠、单引号和换行。',
    '4. 数字使用非负十进制写法；布尔值写 true 或 false；空值写 null；对象和数组按签名声明填写。',
    '5. 只使用上面列出的命令和方法，不要编造不存在的能力。',
  )
  return lines.join('\n')
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[]
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function snippet(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ')
  if (!flat) return '（空响应）'
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat
}

/** 发起非流式 Chat Completions 请求，返回模型生成的命令字符串 */
export async function requestCommands(
  settings: LlmSettings,
  registry: CommandRegistry,
  input: string,
  options?: GenerateOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: settings.model,
    stream: false,
    messages: [
      { role: 'system', content: buildSystemPrompt(settings.systemPrompt, registry) },
      { role: 'user', content: input },
    ],
  }
  // 未配置 thinking 时完全省略 reasoning_effort，由服务商采用默认强度
  if (settings.thinking !== undefined) body.reasoning_effort = settings.thinking

  let response: Response
  try {
    response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new LlmError('request', `LLM 请求失败：${(err as Error).message}`)
  }

  let text: string
  try {
    text = await response.text()
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new LlmError('request', `读取 LLM 响应失败：${(err as Error).message}`)
  }

  if (!response.ok) {
    throw new LlmError('request', `LLM 请求失败（HTTP ${response.status}）：${snippet(text)}`)
  }

  let payload: ChatCompletionResponse
  try {
    payload = JSON.parse(text) as ChatCompletionResponse
  } catch {
    throw new LlmError('response', `LLM 响应不是有效的 JSON：${snippet(text)}`)
  }

  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError('response', 'LLM 没有返回命令字符串')
  }
  return content.trim()
}
