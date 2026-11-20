import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterpreter, parse, LlmError } from '../dist/index.js'

const ctx = (answer = true) => ({ currentUserId: null, confirm: async () => answer })
const command = (name, handler, params = [], risk = 'low') => ({
  name, signature: `${name}()`, description: name, params, risk, handler,
})

const completion = (content) => ({ choices: [{ message: { role: 'assistant', content } }] })

/** 启动模拟 Chat Completions 服务；reply 返回 { status?, body }，body 可以是对象或原始字符串 */
async function startLlmServer(reply) {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const record = {
      url: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body: raw ? JSON.parse(raw) : null,
    }
    requests.push(record)
    const { status = 200, body } = await reply(record)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1/`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const llmInterpreter = (baseUrl, overrides = {}) =>
  createInterpreter({ baseUrl, apiKey: 'test-key', model: 'test-model', ...overrides })

const echoSpec = () => ({
  name: 'demo.echo',
  signature: "demo.echo('text')",
  description: '回显传入的文本',
  params: [{ name: 'text', type: 'string', desc: '要回显的内容' }],
  risk: 'low',
  handler: ([text]) => `echo:${text}`,
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

test('llm config is validated at creation time', () => {
  const config = { baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'model' }
  const isConfigError = (err) => err instanceof LlmError && err.kind === 'config'

  assert.throws(() => createInterpreter({ ...config, baseUrl: '' }), isConfigError)
  assert.throws(() => createInterpreter({ ...config, apiKey: '  ' }), isConfigError)
  assert.throws(() => createInterpreter({ ...config, model: '' }), isConfigError)
  assert.throws(() => createInterpreter({ ...config, baseUrl: 'not a url' }), isConfigError)
  assert.throws(() => createInterpreter({ ...config, baseUrl: 'ftp://provider.example/v1' }), isConfigError)
  assert.throws(() => createInterpreter({ ...config, thinking: 'ultra' }), isConfigError)
  assert.doesNotThrow(() => createInterpreter({ ...config, thinking: 'medium' }))
})

test('generateCommands sends registry prompt, auth and model', async () => {
  const server = await startLlmServer(() => ({ body: completion("  demo.echo('hello')\n") }))
  try {
    let invoked = 0
    const interpreter = llmInterpreter(server.baseUrl)
    interpreter.registerCommand({ ...echoSpec(), handler: ([text]) => { invoked++; return text } })
    interpreter.registerEntityMethod({
      key: 'contact.sendMessage',
      entityKind: 'contact',
      method: 'sendMessage',
      signature: "contact.getPersonByName('name').sendMessage('text')",
      description: '给联系人发送消息',
      risk: 'high',
    })

    const source = await interpreter.generateCommands('请回显 hello')
    assert.equal(source, "demo.echo('hello')")
    assert.equal(invoked, 0, '仅生成命令时不应执行 handler')

    assert.equal(server.requests.length, 1)
    const [request] = server.requests
    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(request.method, 'POST')
    assert.equal(request.authorization, 'Bearer test-key')
    assert.equal(request.body.model, 'test-model')
    assert.equal(request.body.stream, false)
    assert.equal('reasoning_effort' in request.body, false)

    const [system, user] = request.body.messages
    assert.equal(system.role, 'system')
    assert.ok(system.content.startsWith('你是一个AI智能助手'))
    assert.ok(system.content.includes("demo.echo('text')：回显传入的文本"))
    assert.ok(system.content.includes('参数：text（string，必填，要回显的内容）'))
    assert.ok(system.content.includes('contact.sendMessage'))
    assert.ok(system.content.includes('实体类型 contact'))
    assert.ok(system.content.includes('英文分号'))
    assert.deepEqual(user, { role: 'user', content: '请回显 hello' })
  } finally {
    await server.close()
  }
})

test('reasoning_effort is sent only when thinking is configured', async () => {
  const server = await startLlmServer(() => ({ body: completion('demo.echo()') }))
  try {
    const interpreter = llmInterpreter(server.baseUrl, { thinking: 'medium', systemPrompt: '你是一个测试助手' })
    await interpreter.generateCommands('随便做点什么')
    assert.equal(server.requests[0].body.reasoning_effort, 'medium')
    assert.ok(server.requests[0].body.messages[0].content.startsWith('你是一个测试助手'))
  } finally {
    await server.close()
  }
})

test('run generates then executes commands on the same instance', async () => {
  let reply = "demo.echo('hello')"
  const server = await startLlmServer(() => ({ body: completion(reply) }))
  try {
    const interpreter = llmInterpreter(server.baseUrl)
    let invoked = 0
    interpreter.registerCommand({ ...echoSpec(), handler: ([text]) => { invoked++; return `echo:${text}` } })

    const { source, result } = await interpreter.run('请回显 hello', ctx())
    assert.equal(source, "demo.echo('hello')")
    assert.equal(result.ok, true)
    assert.equal(result.message, 'echo:hello')
    assert.equal(invoked, 1)

    reply = 'demo.unknown()'
    const unregistered = await interpreter.run('未注册的命令', ctx())
    assert.equal(unregistered.result.ok, false)
    assert.match(unregistered.result.message, /未注册的命令/)

    reply = 'demo.echo('
    const invalid = await interpreter.run('语法错误的命令', ctx())
    assert.equal(invalid.result.ok, false)
    assert.match(invalid.result.message, /无法解析命令/)

    let written = 0
    interpreter.registerCommand(command('demo.write', () => { written++; return 'written' }, [], 'high'))
    reply = 'demo.write()'
    const cancelled = await interpreter.run('执行高风险命令', ctx(false))
    assert.equal(cancelled.result.cancelled, true)
    assert.equal(written, 0)
  } finally {
    await server.close()
  }
})

test('llm instances keep separate service settings and command lists', async () => {
  const firstServer = await startLlmServer(() => ({ body: completion('demo.first()') }))
  const secondServer = await startLlmServer(() => ({ body: completion('demo.second()') }))
  try {
    const first = createInterpreter({ baseUrl: firstServer.baseUrl, apiKey: 'key-one', model: 'model-one' })
    const second = createInterpreter({ baseUrl: secondServer.baseUrl, apiKey: 'key-two', model: 'model-two' })
    first.registerCommand(command('demo.first', () => 'first'))
    second.registerCommand(command('demo.second', () => 'second'))

    await first.generateCommands('第一条')
    await second.generateCommands('第二条')

    const firstSystem = firstServer.requests[0].body.messages[0].content
    const secondSystem = secondServer.requests[0].body.messages[0].content
    assert.ok(firstSystem.includes('demo.first()'))
    assert.ok(!firstSystem.includes('demo.second()'))
    assert.ok(secondSystem.includes('demo.second()'))
    assert.ok(!secondSystem.includes('demo.first()'))
    assert.equal(firstServer.requests[0].body.model, 'model-one')
    assert.equal(secondServer.requests[0].body.model, 'model-two')
    assert.equal(firstServer.requests[0].authorization, 'Bearer key-one')
    assert.equal(secondServer.requests[0].authorization, 'Bearer key-two')
  } finally {
    await firstServer.close()
    await secondServer.close()
  }
})

test('llm failures are reported as LlmError with distinct kinds', async () => {
  let reply = () => ({ status: 500, body: { error: { message: 'boom' } } })
  const server = await startLlmServer(() => reply())
  try {
    const interpreter = llmInterpreter(server.baseUrl)
    await assert.rejects(
      interpreter.generateCommands('触发服务端错误'),
      (err) => err instanceof LlmError && err.kind === 'request' && /HTTP 500/.test(err.message),
    )

    reply = () => ({ body: completion('   ') })
    await assert.rejects(
      interpreter.generateCommands('触发空响应'),
      (err) => err instanceof LlmError && err.kind === 'response',
    )

    reply = () => ({ body: 'not json' })
    await assert.rejects(
      interpreter.generateCommands('触发非法 JSON'),
      (err) => err instanceof LlmError && err.kind === 'response',
    )
  } finally {
    await server.close()
  }

  const closed = await startLlmServer(() => ({ body: completion('demo.echo()') }))
  const deadBaseUrl = closed.baseUrl
  await closed.close()
  await assert.rejects(
    llmInterpreter(deadBaseUrl).generateCommands('触发网络错误'),
    (err) => err instanceof LlmError && err.kind === 'request',
  )
})

test('abort signal cancels a pending request', async () => {
  const server = await startLlmServer(() => new Promise(() => {}))
  try {
    const interpreter = llmInterpreter(server.baseUrl)
    const controller = new AbortController()
    const pending = interpreter.generateCommands('取消这次请求', { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, (err) => err?.name === 'AbortError')
  } finally {
    await server.close()
  }
})

