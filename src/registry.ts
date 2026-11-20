import type { CommandSpec, EntityMethodSpec } from './types.js'

export class CommandRegistry {
  private readonly rootCommands = new Map<string, CommandSpec>()
  private readonly entityMethods = new Map<string, EntityMethodSpec>()

  registerCommand(spec: CommandSpec): void {
    if (this.rootCommands.has(spec.name)) throw new Error(`重复注册命令：${spec.name}`)
    this.rootCommands.set(spec.name, spec)
  }
  registerEntityMethod(spec: EntityMethodSpec): void {
    if (this.entityMethods.has(spec.key)) throw new Error(`重复注册实体方法：${spec.key}`)
    this.entityMethods.set(spec.key, spec)
  }
  getCommand(name: string): CommandSpec | undefined { return this.rootCommands.get(name) }
  getEntityMethod(kind: string, method: string): EntityMethodSpec | undefined {
    return this.entityMethods.get(`${kind}.${method}`)
  }
  listCommands(): CommandSpec[] { return [...this.rootCommands.values()] }
  listEntityMethods(): EntityMethodSpec[] { return [...this.entityMethods.values()] }
}

export function createRegistry(): CommandRegistry { return new CommandRegistry() }
export const defaultRegistry = createRegistry()

export function registerCommand(spec: CommandSpec): void {
  defaultRegistry.registerCommand(spec)
}

export function registerEntityMethod(spec: EntityMethodSpec): void {
  defaultRegistry.registerEntityMethod(spec)
}

export function getCommand(name: string): CommandSpec | undefined {
  return defaultRegistry.getCommand(name)
}

export function getEntityMethod(entityKind: string, method: string): EntityMethodSpec | undefined {
  return defaultRegistry.getEntityMethod(entityKind, method)
}

export function listCommands(): CommandSpec[] {
  return defaultRegistry.listCommands()
}

export function listEntityMethods(): EntityMethodSpec[] {
  return defaultRegistry.listEntityMethods()
}
