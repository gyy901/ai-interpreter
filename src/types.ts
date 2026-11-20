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
