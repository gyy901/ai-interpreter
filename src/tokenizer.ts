import { ParseError } from './types.js'

export type TokenType = 'ident' | 'string' | 'number' | 'bool' | 'null' | 'punct'

export interface Token {
  type: TokenType
  value: string | number | boolean | null
  pos: number
}

const PUNCT = new Set(['.', '(', ')', ',', '[', ']', '{', '}', ':', ';'])

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (PUNCT.has(ch)) {
      tokens.push({ type: 'punct', value: ch, pos: i })
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      let out = ''
      let closed = false
      while (i < source.length) {
        const c = source[i]
        if (c === '\\' && i + 1 < source.length) {
          const next = source[i + 1]
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next
          i += 2
          continue
        }
        if (c === quote) {
          closed = true
          i++
          break
        }
        out += c
        i++
      }
      if (!closed) throw new ParseError('字符串引号没有闭合')
      tokens.push({ type: 'string', value: out, pos: i })
      continue
    }
    if (/[0-9]/.test(ch)) {
      let num = ''
      while (i < source.length && /[0-9.]/.test(source[i])) num += source[i++]
      const parsed = Number(num)
      if (Number.isNaN(parsed)) throw new ParseError(`无法解析的数字：${num}`)
      tokens.push({ type: 'number', value: parsed, pos: i })
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let ident = ''
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) ident += source[i++]
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'bool', value: ident === 'true', pos: i })
      } else if (ident === 'null') {
        tokens.push({ type: 'null', value: null, pos: i })
      } else {
        tokens.push({ type: 'ident', value: ident, pos: i })
      }
      continue
    }
    throw new ParseError(`无法识别的字符：${ch}`)
  }
  return tokens
}
