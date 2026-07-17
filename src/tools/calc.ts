import type { Tool } from './types.js'

// A recursive-descent evaluator, never eval()/new Function(). The whole point
// of a benchmark tool is that a model can put arbitrary text in the argument —
// treating that text as code would hand the model the server process.
//
// Grammar (standard precedence, left-associative except ^):
//   expr   = term (('+' | '-') term)*
//   term   = power (('*' | '/' | '%') power)*
//   power  = unary ('^' power)?          // right-associative
//   unary  = ('+' | '-') unary | primary
//   primary= number | '(' expr ')'

class Parser {
  private pos = 0
  constructor(private readonly src: string) {}

  parse(): number {
    const v = this.expr()
    this.ws()
    if (this.pos < this.src.length) throw new Error(`unexpected "${this.src[this.pos]}" at ${this.pos}`)
    return v
  }

  private ws() { while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++ }

  private eat(ch: string): boolean {
    this.ws()
    if (this.src[this.pos] === ch) { this.pos++; return true }
    return false
  }

  private expr(): number {
    let v = this.term()
    for (;;) {
      if (this.eat('+')) v += this.term()
      else if (this.eat('-')) v -= this.term()
      else return v
    }
  }

  private term(): number {
    let v = this.power()
    for (;;) {
      if (this.eat('*')) v *= this.power()
      else if (this.eat('/')) {
        const d = this.power()
        if (d === 0) throw new Error('division by zero')
        v /= d
      } else if (this.eat('%')) {
        const d = this.power()
        if (d === 0) throw new Error('modulo by zero')
        v %= d
      } else return v
    }
  }

  private power(): number {
    const base = this.unary()
    if (this.eat('^')) return base ** this.power()
    return base
  }

  private unary(): number {
    if (this.eat('+')) return this.unary()
    if (this.eat('-')) return -this.unary()
    return this.primary()
  }

  private primary(): number {
    if (this.eat('(')) {
      const v = this.expr()
      if (!this.eat(')')) throw new Error('missing closing ")"')
      return v
    }
    this.ws()
    const rest = this.src.slice(this.pos)
    const m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest)
    if (!m) throw new Error(`expected a number at ${this.pos}`)
    this.pos += m[0].length
    return Number(m[0])
  }
}

export const calcTool: Tool = {
  spec: {
    name: 'calc',
    description: 'Evaluate an arithmetic expression. Supports + - * / % ^, parentheses and decimals. Example: "(2 + 3) * 4 ^ 2".',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'The arithmetic expression to evaluate.' },
      },
      required: ['expression'],
    },
  },
  async run(args) {
    const expr = args.expression
    if (typeof expr !== 'string' || !expr.trim()) throw new Error('expression must be a non-empty string')
    const result = new Parser(expr).parse()
    if (!Number.isFinite(result)) throw new Error('result is not a finite number')
    return String(result)
  },
}
