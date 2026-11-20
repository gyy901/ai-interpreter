import { parse } from './parser.js'
import { defaultRegistry, type CommandRegistry } from './registry.js'
import {
  CommandError,
  ParseError,
  type ArgValue,
  type CallNode,
  type ChainNode,
  type CommandContext,
  type CommandSpec,
  type ExecResult,
  type StepResult,
} from './types.js'

function renderArg(value: ArgValue): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (Array.isArray(value)) return `[${value.map(renderArg).join(', ')}]`
  if (value && typeof value === 'object') {
    const body = Object.entries(value)
      .map(([k, v]) => `${k}: ${renderArg(v as ArgValue)}`)
      .join(', ')
    return `{${body}}`
  }
  return value === null ? 'null' : String(value)
}

function renderCall(node: CallNode): string {
  return `${node.path.join('.')}(${node.args.map(renderArg).join(', ')})`
}

/** 把调用链还原成规范命令文本，用于展示与回喂 AI */
export function renderChain(chain: ChainNode): string {
  return [chain.first, ...chain.steps].map(renderCall).join('.')
}

function formatArgs(args: ArgValue[]): string {
  return args.map(renderArg).join(', ')
}

function validateArgs(spec: CommandSpec, args: ArgValue[]): void {
  if (args.length > spec.params.length) {
    throw new CommandError(`命令 ${spec.name} 不需要这么多参数`)
  }
  spec.params.forEach((param, index) => {
    const value = args[index]
    if (value === undefined || value === null) {
      if (param.required !== false) {
        throw new CommandError(`命令 ${spec.name} 缺少参数「${param.name}」`)
      }
      return
    }
    if (param.type === 'string' && typeof value !== 'string') {
      throw new CommandError(`参数「${param.name}」应为字符串`)
    }
    if (param.type === 'number' && typeof value !== 'number') {
      throw new CommandError(`参数「${param.name}」应为数字`)
    }
    if (param.type === 'boolean' && typeof value !== 'boolean') {
      throw new CommandError(`参数「${param.name}」应为布尔值`)
    }
    if (param.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      throw new CommandError(`参数「${param.name}」应为对象`)
    }
    if (param.enum && !param.enum.includes(String(value))) {
      throw new CommandError(`参数「${param.name}」只能是 ${param.enum.join(' / ')}`)
    }
  })
}

async function callRoot(node: CallNode, ctx: CommandContext, registry: CommandRegistry): Promise<unknown> {
  const key = node.path.join('.')
  const spec = registry.getCommand(key)
  if (!spec) throw new CommandError(`未注册的命令：${key}`)
  validateArgs(spec, node.args)
  if (spec.risk === 'high') {
    const ok = await ctx.confirm(`即将执行：${key}(${formatArgs(node.args)})，确认继续？`)
    if (!ok) throw new CommandError('已取消执行')
  }
  return spec.handler(node.args, ctx)
}

async function callStep(receiver: unknown, node: CallNode, ctx: CommandContext, registry: CommandRegistry): Promise<unknown> {
  if (receiver === null || receiver === undefined || typeof receiver !== 'object') {
    throw new CommandError('上一条命令没有返回可继续操作的对象')
  }
  const target = receiver as Record<string, unknown> & { __kind?: string; __label?: string }
  const method = node.path.join('.')
  const spec = target.__kind ? registry.getEntityMethod(target.__kind, method) : undefined
  const fn = Object.prototype.hasOwnProperty.call(target, method) ? target[method] : undefined
  if (!spec || typeof fn !== 'function') {
    throw new CommandError(`${target.__label ?? '该对象'}不支持操作「${method}」`)
  }
  if (target.__kind) {
    if (spec.risk === 'high') {
      const ok = await ctx.confirm(
        `即将执行：${target.__label}.${method}(${formatArgs(node.args)})，确认继续？`,
      )
      if (!ok) throw new CommandError('已取消执行')
    }
  }
  return (fn as (...a: ArgValue[]) => unknown).apply(target, node.args)
}

/** 成功文案在本地生成（省 token、零延迟） */
function describeChain(chain: ChainNode, value: unknown): string {
  if (value === undefined || value === null) return `已执行 ${renderChain(chain)}`
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const label = (value as { __label?: string }).__label
  return label ? `操作成功：${label}` : `已执行 ${renderChain(chain)}`
}

/** 用户在二次确认弹窗点「取消」时的错误文案 */
const CANCELLED = '已取消执行'

/** 解析并逐条执行 AI 返回的命令文本（多条用 ; 分隔）；某条失败即停止后续命令 */
export async function executeWithRegistry(source: string, ctx: CommandContext, registry: CommandRegistry): Promise<ExecResult> {
  let program: ChainNode[]
  try {
    program = parse(source)
  } catch (err) {
    const message = err instanceof ParseError ? err.message : String(err)
    return { ok: false, message: `无法解析命令：${message}`, steps: [], cancelled: false }
  }

  const steps: StepResult[] = []
  for (const chain of program) {
    const command = renderChain(chain)
    try {
      let value = await callRoot(chain.first, ctx, registry)
      for (const step of chain.steps) {
        value = await callStep(value, step, ctx, registry)
      }
      steps.push({ command, ok: true, message: describeChain(chain, value) })
    } catch (err) {
      const cancelled = err instanceof CommandError && err.message === CANCELLED
      const message =
        err instanceof CommandError ? err.message : `执行出错：${(err as Error).message}`
      steps.push({ command, ok: false, message })
      return { ok: false, message, steps, cancelled }
    }
  }

  return { ok: true, message: steps.map((s) => s.message).join('\n'), steps, cancelled: false }
}

export function executeCommands(source: string, ctx: CommandContext): Promise<ExecResult> {
  return executeWithRegistry(source, ctx, defaultRegistry)
}
