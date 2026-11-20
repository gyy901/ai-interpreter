import { executeWithRegistry } from './executor.js'
import { createRegistry } from './registry.js'
import type { CommandContext } from './types.js'

/** 创建隔离的解释器实例；注册与执行共享同一张命令表。 */
export function createInterpreter() {
  const registry = createRegistry()
  return {
    registerCommand: registry.registerCommand.bind(registry),
    registerEntityMethod: registry.registerEntityMethod.bind(registry),
    getCommand: registry.getCommand.bind(registry),
    getEntityMethod: registry.getEntityMethod.bind(registry),
    listCommands: registry.listCommands.bind(registry),
    listEntityMethods: registry.listEntityMethods.bind(registry),
    executeCommands: (source: string, ctx: CommandContext) => executeWithRegistry(source, ctx, registry),
  }
}
