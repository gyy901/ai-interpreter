import test from 'node:test'
import assert from 'node:assert/strict'
import { createInterpreter, parse } from '../dist/index.js'

const ctx = (answer = true) => ({ currentUserId: null, confirm: async () => answer })
const command = (name, handler, params = [], risk = 'low') => ({
  name, signature: `${name}()`, description: name, params, risk, handler,
})

test('independent interpreters do not share registered commands', async () => {
  const first = createInterpreter()
  const second = createInterpreter()
  first.registerCommand(command('demo.echo', ([value]) => `echo:${value}`, [{ name: 'value', type: 'string' }]))
  assert.equal((await first.executeCommands("demo.echo('hi')", ctx())).message, 'echo:hi')
  assert.equal((await second.executeCommands("demo.echo('hi')", ctx())).ok, false)
})

test('high risk cancellation stops execution and following commands', async () => {
  const interpreter = createInterpreter()
  let invoked = 0
  interpreter.registerCommand(command('demo.write', () => { invoked++; return 'written' }, [], 'high'))
  const result = await interpreter.executeCommands('demo.write(); demo.write()', ctx(false))
  assert.equal(result.cancelled, true)
  assert.equal(result.steps.length, 1)
  assert.equal(invoked, 0)
})

test('chained calls require registered own methods', async () => {
  const interpreter = createInterpreter()
  interpreter.registerCommand(command('demo.entity', () => ({
    __kind: 'demo', __label: 'item', greet: () => 'hello',
  })))
  interpreter.registerEntityMethod({
    key: 'demo.greet', entityKind: 'demo', method: 'greet',
    signature: 'demo.entity().greet()', description: 'greet', risk: 'low',
  })
  assert.equal((await interpreter.executeCommands('demo.entity().greet()', ctx())).message, 'hello')
  assert.equal((await interpreter.executeCommands('demo.entity().toString()', ctx())).ok, false)
  assert.equal((await interpreter.executeCommands('demo.entity().constructor()', ctx())).ok, false)
})

test('object arguments are validated and special keys stay data', async () => {
  const interpreter = createInterpreter()
  interpreter.registerCommand(command('demo.inspect', ([value]) => Object.keys(value).join(','), [{ name: 'value', type: 'object' }]))
  const bad = await interpreter.executeCommands('demo.inspect(123)', ctx())
  assert.equal(bad.ok, false)
  const good = await interpreter.executeCommands("demo.inspect({'__proto__': 'x'})", ctx())
  assert.equal(good.ok, true)
  assert.equal(good.message, '__proto__')
  assert.equal(parse("demo.inspect({'__proto__': 'x'})")[0].first.args[0].__proto__, 'x')
})
