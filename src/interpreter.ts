import { executeWithRegistry } from './executor.js'
import { normalizeLlmConfig, requestCommands } from './llm.js'
import { createRegistry } from './registry.js'
import type { CommandContext, Interpreter, LlmConfig, LlmInterpreter } from './types.js'

/** 创建隔离的解释器实例；注册与执行共享同一张命令表。 */
export function createInterpreter(): Interpreter
/** 创建带 LLM 配置的解释器实例；可按自然语言生成命令并直接执行。 */
export function createInterpreter(config: LlmConfig): LlmInterpreter
export function createInterpreter(config?: LlmConfig): Interpreter | LlmInterpreter {
  const registry = createRegistry()
  const interpreter: Interpreter = {
    registerCommand: registry.registerCommand.bind(registry),
    registerEntityMethod: registry.registerEntityMethod.bind(registry),
    getCommand: registry.getCommand.bind(registry),
    getEntityMethod: registry.getEntityMethod.bind(registry),
    listCommands: registry.listCommands.bind(registry),
    listEntityMethods: registry.listEntityMethods.bind(registry),
    executeCommands: (source: string, ctx: CommandContext) => executeWithRegistry(source, ctx, registry),
  }
  if (config === undefined) return interpreter

  const settings = normalizeLlmConfig(config)
  return {
    ...interpreter,
    generateCommands: (input, options) => requestCommands(settings, registry, input, options),
    run: async (input, ctx, options) => {
      const source = await requestCommands(settings, registry, input, options)
      const result = await executeWithRegistry(source, ctx, registry)
      return { source, result }
    },
  }
}
