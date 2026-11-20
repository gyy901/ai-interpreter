import { tokenize, type Token } from './tokenizer.js'
import { ParseError, type ArgValue, type CallNode, type ChainNode } from './types.js'

/** 递归下降解析命令 DSL，产出一组调用链（用 ; 分隔多条命令）；不使用 eval */
export function parse(source: string): ChainNode[] {
  const tokens = tokenize(source)
  if (tokens.length === 0) throw new ParseError('没有可执行的命令')
  let pos = 0

  const peek = (): Token | undefined => tokens[pos]
  const next = (): Token | undefined => tokens[pos++]
  const atPunct = (v: string): boolean => {
    const t = peek()
    return !!t && t.type === 'punct' && t.value === v
  }
  const expect = (v: string): void => {
    if (!atPunct(v)) throw new ParseError(`期望 "${v}"`)
    pos++
  }
  const expectIdent = (): string => {
    const t = next()
    if (!t || (t.type !== 'ident' && t.type !== 'string')) throw new ParseError('期望标识符')
    return String(t.value)
  }

  const parseValue = (): ArgValue => {
    const t = next()
    if (!t) throw new ParseError('参数缺失')
    switch (t.type) {
      case 'string':
      case 'number':
      case 'bool':
        return t.value as ArgValue
      case 'null':
        return null
      case 'ident':
        // 容错：AI 少写引号时，裸标识符当作字符串
        return String(t.value)
      case 'punct':
        if (t.value === '[') return parseArray()
        if (t.value === '{') return parseObject()
        throw new ParseError(`无法作为参数的值：${String(t.value)}`)
      default:
        throw new ParseError('无法解析的参数')
    }
  }

  const parseArray = (): ArgValue[] => {
    const items: ArgValue[] = []
    if (atPunct(']')) {
      pos++
      return items
    }
    for (;;) {
      items.push(parseValue())
      if (atPunct(',')) {
        pos++
        continue
      }
      break
    }
    expect(']')
    return items
  }

  const parseObject = (): { [key: string]: ArgValue } => {
    const obj: { [key: string]: ArgValue } = Object.create(null)
    if (atPunct('}')) {
      pos++
      return obj
    }
    for (;;) {
      const key = expectIdent()
      expect(':')
      obj[key] = parseValue()
      if (atPunct(',')) {
        pos++
        continue
      }
      break
    }
    expect('}')
    return obj
  }

  const parseCall = (): CallNode => {
    const path: string[] = [expectIdent()]
    while (atPunct('.')) {
      pos++
      path.push(expectIdent())
    }
    const args: ArgValue[] = []
    if (atPunct('(')) {
      pos++
      if (!atPunct(')')) {
        for (;;) {
          args.push(parseValue())
          if (atPunct(',')) {
            pos++
            continue
          }
          break
        }
      }
      expect(')')
    }
    return { path, args }
  }

  const program: ChainNode[] = []
  for (;;) {
    const first = parseCall()
    const steps: CallNode[] = []
    while (atPunct('.')) {
      pos++
      steps.push(parseCall())
    }
    program.push({ first, steps })
    if (!atPunct(';')) break
    pos++
    if (!peek()) break // 容忍结尾多余的分号
  }

  const rest = peek()
  if (rest) throw new ParseError(`命令后存在多余内容："${String(rest.value)}"`)

  return program
}
