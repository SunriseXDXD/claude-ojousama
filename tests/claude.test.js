'use strict'
const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { PassThrough, Writable } = require('stream')
const { Store, OBSOLETE_SETTINGS } = require('../src/main/store')
const C = require('../src/main/claude')
const P = require('../src/main/persona')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ojousama-claude-test-'))
const has = (args, ...seq) => args.some((_, i) => seq.every((v, j) => args[i + j] === v))

class FakeChild extends EventEmitter {
  constructor(file, args, options) {
    super()
    Object.assign(this, { file, args, options, exitCode: null, killed: false, input: '' })
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.stdin = new Writable({ write: (chunk, _enc, cb) => { this.input += chunk; cb() } })
  }
  send(...events) { for (const e of events) this.stdout.write(JSON.stringify(e) + '\n') }
  exit(code = 0) { this.exitCode = code; setImmediate(() => this.emit('close', code)) }
  kill(signal) { this.killed = signal || 'SIGTERM'; this.exit(143) }
}
function fakeRun(options) {
  let child
  const run = new C.ClaudeRun({ claude: { exe: '/bin/claude', args: [] }, cwd: dir, ...options }, { spawnProcess: (...a) => (child = new FakeChild(...a)) })
  const events = []
  run.on('event', (e) => events.push(e))
  const done = new Promise((resolve) => run.on('done', resolve))
  return { run, events, done, child: () => child }
}
const tick = () => new Promise((r) => setImmediate(r))

;(async () => {
  // settings: fresh defaults, and old Codex / DSH settings dropped on upgrade
  const fresh = new Store(path.join(dir, 'fresh')).get('settings')
  assert.equal(fresh.permission, 'read-only')
  assert.equal(fresh.claudeModel, '')
  for (const key of OBSOLETE_SETTINGS) assert.equal(key in fresh, false, key)
  const oldDir = path.join(dir, 'old')
  fs.mkdirSync(oldDir)
  const legacy = { settings: { backend: 'dsh', provider: 'p', model: 'm', dshExe: 'C:\\dsh.exe', codexModel: 'x', permission: 'workspace-write', cwd: 'C:\\work' }, chat: { sessionId: 'dsh-thread', messages: [{ role: 'user', text: 'hello' }] }, todos: [{ id: 't1', text: 'keep me' }] }
  fs.writeFileSync(path.join(oldDir, 'pet-data.json'), JSON.stringify(legacy))
  const old = new Store(oldDir)
  for (const key of OBSOLETE_SETTINGS) assert.equal(key in old.get('settings'), false, key)
  assert.equal(old.get('settings').permission, 'workspace-write')
  assert.equal(old.get('settings').cwd, 'C:\\work')
  assert.deepEqual(old.get('chat'), legacy.chat)
  assert.deepEqual(old.get('todos'), legacy.todos)

  // session ids: only `claude:` ids are resumed
  assert.equal(C.sessionFor('claude:abc'), 'abc')
  assert.equal(C.sessionFor('codex:abc'), null)
  assert.equal(C.sessionFor('dsh-thread'), null)
  assert.equal(C.sessionFor('claude:'), null)
  assert.equal(C.tagSession('abc'), 'claude:abc')
  assert.equal(C.tagSession(null), null)

  // options: chat vs restricted runs
  const settings = { cwd: dir, permission: 'workspace-write', claudeModel: 'opus', claudeEffort: 'high', claudeGlanceModel: 'haiku', claudeGlanceEffort: 'low' }
  const chat = C.claudeOptions(settings, { prompt: 'hi', persona: 'pet', sessionId: 'claude:s1' })
  assert.deepEqual([chat.permission, chat.model, chat.effort, chat.workspace, chat.sessionId], ['workspace-write', 'opus', 'high', true, 'claude:s1'])
  const look = C.claudeOptions(settings, { prompt: 'look', tools: 'look', permission: 'danger-full-access', images: ['/shot.jpg'] })
  assert.deepEqual([look.permission, look.model, look.effort, look.images[0]], ['read-only', 'haiku', 'low', '/shot.jpg'])
  const bare = C.claudeOptions({}, { prompt: 'x' })
  assert.deepEqual([bare.permission, bare.cwd, bare.workspace, bare.model], ['read-only', os.homedir(), false, ''])

  // arguments
  const base = { persona: 'pet', tools: 'full' }
  const ro = C.buildArgs({ ...base, permission: 'read-only', sessionId: 'claude:s1', model: 'opus', effort: 'high' })
  assert.ok(has(ro, '-p') && has(ro, '--input-format', 'stream-json') && has(ro, '--output-format', 'stream-json') && has(ro, '--permission-prompts', 'none'))
  assert.ok(has(ro, '--append-system-prompt', 'pet') && has(ro, '--model', 'opus') && has(ro, '--effort', 'high') && has(ro, '--resume', 's1'))
  assert.ok(has(ro, '--permission-mode', 'dontAsk') && has(ro, '--disallowedTools', C.WRITE_TOOLS.join(',')) && has(ro, '--allowedTools', 'WebSearch,WebFetch'))
  assert.ok(!ro.includes('--restricted') && !ro.includes('--settings') && !ro.includes('--no-session-persistence'))
  const ww = C.buildArgs({ ...base, permission: 'workspace-write' })
  assert.ok(has(ww, '--permission-mode', 'acceptEdits') && !ww.includes('--disallowedTools'))
  assert.deepEqual(JSON.parse(ww[ww.indexOf('--settings') + 1]), { sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false } })
  const full = C.buildArgs({ ...base, permission: 'danger-full-access', sessionId: 'codex:old' })
  assert.ok(has(full, '--permission-mode', 'bypassPermissions') && !full.includes('--resume') && !full.includes('--disallowedTools'))
  for (const mode of ['look', 'none']) {
    const a = C.buildArgs({ ...base, tools: mode, permission: 'read-only', workspace: true, persist: false }, { model: 'sonnet' })
    assert.ok(has(a, '--restricted') && has(a, '--safe-mode') && has(a, '--strict-mcp-config') && has(a, '--tools', '') && has(a, '--permission-mode', 'dontAsk') && has(a, '--no-session-persistence'), mode)
    assert.deepEqual(JSON.parse(a[a.indexOf('--settings') + 1]), { model: 'sonnet' })
  }
  assert.ok(has(C.buildArgs({ ...base, tools: 'scan', workspace: true }), '--tools', 'Read,Glob,Grep'))
  assert.ok(has(C.buildArgs({ ...base, tools: 'scan', workspace: false }), '--tools', ''), 'no work folder: no file access')
  assert.ok(!C.buildArgs({ ...base, tools: 'none' }).includes('--settings'))

  // the user message: screenshots first, as base64
  const shot = path.join(dir, 'shot.jpg')
  fs.writeFileSync(shot, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  const msg = JSON.parse(C.userMessage('看看', [shot]))
  assert.equal(msg.type, 'user')
  assert.deepEqual(msg.message.content.map((c) => c.type), ['image', 'text'])
  assert.deepEqual(msg.message.content[0].source, { type: 'base64', media_type: 'image/jpeg', data: '/9j/2Q==' })
  assert.equal(msg.message.content[1].text, '看看')
  assert.throws(() => C.userMessage('x', ['/a.bmp']), /不支持/)

  // auth carried into restricted runs
  const cfg = path.join(dir, 'claude-config')
  fs.mkdirSync(cfg)
  assert.deepEqual(C.userAuth({ env: { CLAUDE_CONFIG_DIR: cfg } }), { env: {}, settings: {} })
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example', API_TIMEOUT_MS: 60000, NESTED: { no: 1 } }, apiKeyHelper: '/bin/key', model: 'opus', permissions: { allow: ['Bash'] } }))
  assert.deepEqual(C.userAuth({ env: { CLAUDE_CONFIG_DIR: cfg } }), { env: { ANTHROPIC_BASE_URL: 'https://proxy.example', API_TIMEOUT_MS: '60000' }, settings: { apiKeyHelper: '/bin/key', model: 'opus' } })

  // locating the CLI
  if (process.platform !== 'win32') {
    const bin = path.join(dir, 'bin'), home = path.join(dir, 'home')
    fs.mkdirSync(bin)
    fs.mkdirSync(home)
    assert.equal(C.locateClaude(null, { env: { PATH: bin }, home, installDirs: [] }), null)
    const exe = path.join(bin, 'claude')
    fs.writeFileSync(exe, '#!/bin/sh\n')
    assert.equal(C.locateClaude(null, { env: { PATH: bin }, home, installDirs: [] }), null, 'not executable')
    fs.chmodSync(exe, 0o755)
    assert.deepEqual(C.locateClaude(null, { env: { PATH: bin }, home, installDirs: [] }), { exe, args: [], displayPath: exe })
    fs.rmSync(exe)
    const localBin = path.join(home, '.local', 'bin')
    fs.mkdirSync(localBin, { recursive: true })
    const cli = path.join(dir, 'cli.js')
    fs.writeFileSync(cli, '')
    fs.symlinkSync(cli, path.join(localBin, 'claude'))
    const viaNode = C.locateClaude(null, { env: { PATH: '' }, home, installDirs: [localBin] })
    assert.deepEqual(viaNode, { exe: process.execPath, args: [fs.realpathSync(cli)], electronRunAsNode: true, displayPath: path.join(localBin, 'claude') }, 'GUI PATH without the install folder, npm link to cli.js')
    assert.equal(C.locateClaude(null, { env: { PATH: '' }, home }).displayPath, path.join(localBin, 'claude'), '~/.local/bin is searched by default')
    assert.equal(C.locateClaude(path.join(dir, 'missing'), { env: { PATH: bin }, home, installDirs: [] }), null)
  }

  // a chat turn: streaming text, tools, result
  {
    const t = fakeRun({ prompt: 'hi', persona: 'pet', sessionId: 'claude:s1', tools: 'full', permission: 'read-only' })
    await tick()
    const child = t.child()
    assert.equal(child.file, '/bin/claude')
    assert.equal(child.options.cwd, dir)
    assert.equal(child.options.shell, false)
    assert.ok(has(child.args, '--resume', 's1'))
    assert.equal(JSON.parse(child.input).message.content[0].text, 'hi')
    child.send(
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '我看' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '看' } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '我看看' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/a.txt' } }] } },
      { type: 'assistant', parent_tool_use_id: 'u0', message: { content: [{ type: 'text', text: 'subagent chatter' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: true, content: 'denied' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: '好啦', session_id: 's1' },
    )
    const res = await t.done
    assert.deepEqual(res, { ok: true, final: '好啦', sessionId: 'claude:s1', error: null, code: 0 })
    assert.deepEqual(t.events.map((e) => e.type), ['session', 'status', 'thinking', 'text', 'text', 'text', 'tool_call', 'tool_result'])
    assert.equal(t.events[0].sessionId, 'claude:s1')
    assert.deepEqual(t.events.filter((e) => e.type === 'text').map((e) => e.text), ['我看', '我看看', '我看看'])
    assert.deepEqual(t.events[6], { type: 'tool_call', tool: 'Read', input: { file_path: '/a.txt' } })
    assert.deepEqual(t.events[7], { type: 'tool_result', tool: 'Read', status: 'failed' })
    child.exit(0)
  }

  // errors: an error result, an early exit, a missing work folder, cancelling
  {
    const t = fakeRun({ prompt: 'x', sessionId: 'claude:gone' })
    await tick()
    t.child().send({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'gone', errors: ['No conversation found with session ID: gone'] })
    const res = await t.done
    assert.equal(res.ok, false)
    assert.match(res.error, /No conversation found/)
  }
  {
    const t = fakeRun({ prompt: 'x' })
    await tick()
    t.child().stderr.write('boom\nInvalid API key · Please run /login\n')
    await tick()
    t.child().exit(1)
    const res = await t.done
    assert.equal(res.ok, false)
    assert.match(res.error, /Invalid API key/)
  }
  {
    const res = await fakeRun({ prompt: 'x', cwd: path.join(dir, 'nope') }).done
    assert.match(res.error, /工作目录不存在/)
  }
  {
    const t = fakeRun({ prompt: 'x' })
    await tick()
    t.run.kill()
    const res = await t.done
    assert.equal(t.child().killed, 'SIGTERM')
    assert.deepEqual([res.ok, res.error], [false, '已取消'])
  }
  {
    const t = fakeRun({ prompt: 'x' })
    t.run.kill() // before the process even started
    assert.deepEqual([(await t.done).error, t.child()], ['已取消', undefined])
  }

  // restricted runs: user settings env reaches the child; nested-session markers do not
  {
    const saved = { ...process.env }
    Object.assign(process.env, { CLAUDE_CONFIG_DIR: cfg, CLAUDECODE: '1' })
    try {
      const t = fakeRun({ prompt: 'look', tools: 'look', images: [shot], claude: { exe: process.execPath, args: ['/cli.js'], electronRunAsNode: true } })
      await tick()
      const child = t.child()
      assert.equal(child.options.env.ANTHROPIC_BASE_URL, 'https://proxy.example')
      assert.equal(child.options.env.ELECTRON_RUN_AS_NODE, '1')
      assert.equal('CLAUDECODE' in child.options.env, false)
      assert.equal(child.args[0], '/cli.js')
      assert.ok(has(child.args, '--tools', '') && has(child.args, '--restricted'))
      assert.deepEqual(JSON.parse(child.args[child.args.indexOf('--settings') + 1]), { apiKeyHelper: '/bin/key', model: 'opus' })
      assert.equal(JSON.parse(child.input).message.content[0].type, 'image')
      child.send({ type: 'result', subtype: 'success', is_error: false, result: '{"action":"quiet"}', session_id: 'g1' })
      assert.equal((await t.done).final, '{"action":"quiet"}')
      child.exit(0)
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  }

  // persona and screen prompts
  assert.match(P.personaPrompt({}), /内核是 Claude/)
  const glance = P.glancePrompt({ reason: 'user', app: 'editor', title: 'file', ocr: '' })
  assert.doesNotMatch(glance, /read_image/)
  assert.match(glance, /随消息附上的屏幕截图/)
  console.log('PASS claude backend: settings upgrade, arguments, permissions, images, auth, locator, streaming, errors and cancel')
})()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(dir, { recursive: true, force: true }))
