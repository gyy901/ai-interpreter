import { executeWithRegistry } from './executor.js'
import { normalizeLlmConfig, requestCommands } from './llm.js'
import { createRegistry } from './registry.js'
import type { CommandContext, Interpreter, LlmConfig } from './types.js'

/** 创建解释器实例；必须提供 LLM 服务配置，注册与执行共享同一张命令表。 */
export function createInterpreter(config: LlmConfig): Interpreter {
  const settings = normalizeLlmConfig(config)
  const registry = createRegistry()
  return {
    registerCommand: registry.registerCommand.bind(registry),
    registerEntityMethod: registry.registerEntityMethod.bind(registry),
    getCommand: registry.getCommand.bind(registry),
    getEntityMethod: registry.getEntityMethod.bind(registry),
    listCommands: registry.listCommands.bind(registry),
    listEntityMethods: registry.listEntityMethods.bind(registry),
    executeCommands: (source: string, ctx: CommandContext) => executeWithRegistry(source, ctx, registry),
    generateCommands: (input, options) => requestCommands(settings, registry, input, options),
    run: async (input, ctx, options) => {
      const source = await requestCommands(settings, registry, input, options)
      const result = await executeWithRegistry(source, ctx, registry)
      return { source, result }
    },
  }
}
