'use strict'
// Codex and DeepSeek Harness bridges against fake processes, the AI-core registry and the characters
// that come with each core. (End-to-end runs against the real CLIs need their sign-in; see README.)
const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { PassThrough } = require('stream')
const { CodexRun, locateCodex, codexOptions, changeResult } = require('../src/main/codex')
const { DshRun, locateDsh, dshOptions, patchFor, taskText, TOOLSETS } = require('../src/main/dsh')
const { BACKENDS, backendOf } = require('../src/main/agents')
const { patchFromResult } = require('../src/main/blackboard')
const P = require('../src/main/persona')
const i18n = require('../src/main/i18n')

/** A child process whose stdin/stdout we drive from the test. */
function fakeChild() {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.kill = () => {
    child.killed = true
    setImmediate(() => child.emit('close', null))
  }
  return child
}
const done = (run) => new Promise((resolve) => run.on('done', resolve))

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ojousama-backends-'))
  try {
    // ---------------------------------------------------------------- registry
    assert.deepEqual(Object.keys(BACKENDS), ['claude', 'codex', 'dsh'])
    assert.equal(backendOf({}).id, 'claude')
    assert.equal(backendOf({ backend: 'nope' }).id, 'claude')
    assert.deepEqual(['claude', 'codex', 'dsh'].map((id) => BACKENDS[id].character), ['ojousama', 'dragon', 'whale'])

    // ---------------------------------------------------------------- locating
    if (process.platform !== 'win32') {
      const bin = path.join(tmp, 'bin')
      const pkg = path.join(tmp, 'lib', 'node_modules', '@openai', 'codex', 'bin')
      fs.mkdirSync(bin, { recursive: true })
      fs.mkdirSync(pkg, { recursive: true })
      fs.writeFileSync(path.join(pkg, 'codex.js'), '')
      fs.symlinkSync(path.join(pkg, 'codex.js'), path.join(bin, 'codex'))
      const codex = locateCodex(null, { env: { PATH: bin }, installDirs: [] })
      assert.equal(codex.exe, process.execPath)
      assert.equal(codex.electronRunAsNode, true)
      assert.equal(locateCodex(null, { env: { PATH: path.join(tmp, 'none') }, installDirs: [] }), null)
      // dsh's JS entry must run on a real Node next to it, never on Electron's.
      const dshPkg = path.join(tmp, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
      fs.mkdirSync(dshPkg, { recursive: true })
      fs.writeFileSync(path.join(dshPkg, 'bin.js'), '')
      fs.symlinkSync(path.join(dshPkg, 'bin.js'), path.join(bin, 'dsh'))
      assert.equal(locateDsh(null, { env: { PATH: bin }, installDirs: [], exists: () => false }), null, 'no node, no dsh')
      fs.writeFileSync(path.join(bin, 'node'), '')
      const dsh = locateDsh(null, { env: { PATH: bin }, installDirs: [], exists: () => false })
      assert.equal(dsh.exe, path.join(bin, 'node'))
      assert.deepEqual(dsh.args, [fs.realpathSync(path.join(dshPkg, 'bin.js'))])
      assert.ok(!dsh.electronRunAsNode)
    }

    // ---------------------------------------------------------------- Codex
    const settings = { permission: 'workspace-write', cwd: tmp, codexModel: 'gpt-x', codexEffort: 'low', dshModel: 'deepseek-official/deepseek-flash' }
    const look = codexOptions(settings, { prompt: 'p', tools: 'look', permission: 'danger-full-access' })
    assert.equal(look.permission, 'read-only')
    assert.equal(look.loadAgentsMd, false)
    assert.equal(codexOptions(settings, { prompt: 'p' }).permission, 'workspace-write')

    let child
    const sent = []
    const run = new CodexRun({ ...codexOptions(settings, { prompt: '看看', images: ['/shot.jpg'], persist: false, sessionId: 'claude:other' }), codex: { exe: '/fake/codex', args: [] } }, {
      spawnProcess: (exe, args, opts) => {
        assert.equal(exe, '/fake/codex')
        assert.ok(args.includes('app-server'))
        assert.equal(opts.cwd, tmp)
        child = fakeChild()
        child.stdin.on('data', (buf) => {
          for (const line of String(buf).split('\n').filter(Boolean)) {
            const m = JSON.parse(line)
            sent.push(m)
            const reply = (result) => child.stdout.write(JSON.stringify({ id: m.id, result }) + '\n')
            if (m.method === 'initialize') reply({})
            else if (m.method === 'thread/start') reply({ thread: { id: 'th1' } })
            else if (m.method === 'turn/start') {
              reply({ turn: { id: 'tu1' } })
              const note = (method, params) => child.stdout.write(JSON.stringify({ method, params: { threadId: 'th1', ...params } }) + '\n')
              note('turn/started', { turn: { id: 'tu1' } })
              note('item/agentMessage/delta', { itemId: 'm1', delta: '好的，' })
              note('item/started', { item: { id: 'f1', type: 'fileChange', changes: [{ path: '/w/a.js', kind: { type: 'update' }, diff: '@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3\n' }] } })
              note('item/completed', { item: { id: 'f1', type: 'fileChange', status: 'completed', changes: [{ path: '/w/a.js', kind: { type: 'update' }, diff: '@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3\n' }] } })
              note('item/completed', { item: { id: 'm1', type: 'agentMessage', text: '好的，改好了。' } })
              note('turn/completed', { turn: { id: 'tu1', status: 'completed' } })
            }
          }
        })
        return child
      },
    })
    const events = []
    run.on('event', (e) => events.push(e))
    const result = await done(run)
    assert.equal(result.ok, true, result.error)
    assert.equal(result.final, '好的，改好了。')
    assert.equal(result.sessionId, 'codex:th1')
    const start = sent.find((m) => m.method === 'thread/start').params
    assert.equal(start.approvalPolicy, 'never', 'nobody can answer an approval')
    assert.equal(start.sandbox, 'workspace-write')
    assert.equal(start.model, 'gpt-x')
    assert.equal(start.ephemeral, true)
    assert.ok(!sent.some((m) => m.method === 'thread/resume'), 'a Claude session id is not a Codex thread')
    const turn = sent.find((m) => m.method === 'turn/start').params
    assert.deepEqual(turn.input.map((i) => i.type), ['text', 'localImage'])
    assert.equal(turn.effort, 'low')
    const fileResult = events.find((e) => e.type === 'tool_result' && e.result)
    const patch = patchFromResult(fileResult.result)
    assert.equal(patch.file, '/w/a.js')
    assert.deepEqual([patch.add, patch.del], [1, 1])
    assert.equal(events.find((e) => e.type === 'session').sessionId, 'codex:th1')
    assert.ok(events.some((e) => e.type === 'text' && e.text === '好的，'))
    assert.equal(changeResult({ path: '/w/gone.js', kind: { type: 'delete' }, diff: '' }), null)
    assert.equal(patchFromResult(changeResult({ path: '/w/new.js', kind: { type: 'add' }, diff: 'x\ny\n' })).add, 2)

    // ---------------------------------------------------------------- DeepSeek Harness
    const lookPatch = patchFor(dshOptions(settings, { prompt: 'p', persona: '你是"鲸鱼"\n第二行', tools: 'look' }))
    assert.match(lookPatch, /personaPrefix: "你是\\"鲸鱼\\"\\n第二行"/)
    assert.match(lookPatch, /- id: tool-bash\n {2}disabled: true/)
    assert.doesNotMatch(lookPatch, /- id: tool-fs\n/, 'looks keep read_image')
    assert.match(lookPatch, /- id: deepseek-account\n {2}disabled: false/)
    assert.match(lookPatch, /provider: "deepseek-official"\n {4}model: "deepseek-flash"/)
    assert.deepEqual(TOOLSETS.full, [])
    assert.match(taskText('看看', ['/tmp/a.jpg', '/tmp/notes.txt']), /read_image[\s\S]*- \/tmp\/a\.jpg/)
    assert.doesNotMatch(taskText('看看', ['/tmp/a.jpg', '/tmp/notes.txt']), /notes\.txt/)

    let dargs, dinput = ''
    let patchSeen = ''
    const drun = new DshRun({ ...dshOptions(settings, { prompt: '你好', persona: '你是大肥鱼。', tools: 'none', sessionId: 'dsh:session-1', images: ['/tmp/s.png'] }), dsh: { exe: '/fake/node', args: ['/fake/bin.js'] } }, {
      spawnProcess: (exe, args, opts) => {
        dargs = args
        assert.equal(exe, '/fake/node')
        assert.equal(opts.env.DSH_PERMISSION_MODE, 'read-only')
        assert.ok(!opts.env.ELECTRON_RUN_AS_NODE)
        patchSeen = fs.readFileSync(args[args.indexOf('--patch') + 1], 'utf8')
        const c = fakeChild()
        c.stdin.on('data', (b) => (dinput += b))
        c.stdin.on('finish', () => {
          for (const e of [
            { type: 'session', sessionId: 'session-1' },
            { type: 'status', phase: 'turn_start', turn: 1 },
            { type: 'tool_call', callId: 'c1', tool: 'read_image', input: { file_path: '/tmp/s.png' } },
            { type: 'tool_result', callId: 'c1', status: 'completed', result: 'ok' },
            { type: 'text', text: '鱼片你好！' },
            { type: 'final', sessionId: 'session-1', text: '鱼片你好！' },
          ]) c.stdout.write(JSON.stringify(e) + '\n')
          c.stdout.end()
          setImmediate(() => c.emit('close', 0))
        })
        return c
      },
    })
    const devents = []
    drun.on('event', (e) => devents.push(e))
    const dres = await done(drun)
    assert.equal(dres.ok, true, dres.error)
    assert.equal(dres.final, '鱼片你好！')
    assert.equal(dres.sessionId, 'dsh:session-1')
    assert.deepEqual(dargs.slice(0, 3), ['/fake/bin.js', '--profile', 'headless'])
    for (const flag of ['--json', '--approval-policy', 'never', '--permission-mode', 'read-only', '--session-id', 'session-1', '-']) assert.ok(dargs.includes(flag), flag)
    assert.match(patchSeen, /- id: tool-fs\n {2}disabled: true/, 'text-only jobs get no tools at all')
    assert.match(dinput, /^你好[\s\S]*\/tmp\/s\.png/)
    assert.deepEqual(devents.map((e) => e.type), ['session', 'status', 'tool_call', 'tool_result', 'text'])
    assert.equal(devents[3].tool, 'read_image')
    await new Promise((r) => setTimeout(r, 50))
    assert.ok(!fs.existsSync(dargs[dargs.indexOf('--patch') + 1]), 'the per-run patch is removed')

    // A run that exits without its final event failed, whatever the exit code says.
    const bad = new DshRun({ ...dshOptions(settings, { prompt: 'x' }), dsh: { exe: '/fake/node', args: [] } }, {
      spawnProcess: () => {
        const c = fakeChild()
        c.stdin.on('finish', () => {
          c.stderr.write('dsh: LLM_AUTH: no credentials for deepseek-official\n')
          setImmediate(() => c.emit('close', 1))
        })
        return c
      },
    })
    const bres = await done(bad)
    assert.equal(bres.ok, false)
    assert.match(bres.error, /LLM_AUTH/)

    // ---------------------------------------------------------------- characters
    const keys = (o) => Object.keys(o).sort().join(',')
    const base = P.CHARACTERS.ojousama.lines
    for (const [id, c] of Object.entries(P.CHARACTERS)) {
      for (const l of ['zh', 'en']) {
        assert.equal(keys(c.lines[l]), keys(base[l]), `${id}.${l} line banks`)
        for (const k of ['idle', 'touched']) assert.equal(keys(c.lines[l][k]), keys(base[l][k]), `${id}.${l}.${k}`)
      }
      P.setCharacter(id)
      const persona = P.personaPrompt({})
      assert.match(persona, /桌宠动作协议/, id)
      assert.match(persona, /结果要诚实/, id)
      assert.ok(P.pick(P.LINES.hello))
    }
    P.setCharacter('whale')
    assert.equal(P.me(), '本鱼')
    assert.match(P.personaPrompt({}), /鱼片/)
    P.setCharacter('dragon')
    assert.equal(P.me(), '我')
    assert.match(P.glancePrompt({ reason: 'user', app: 'x', title: 'y', ocr: '' }), /白龙娘口吻/)
    i18n.setLang('en')
    try {
      for (const id of Object.keys(P.CHARACTERS)) {
        P.setCharacter(id)
        assert.doesNotMatch(P.personaPrompt({}), /[\u4e00-\u9fff]/, `${id} English persona`)
        assert.doesNotMatch(JSON.stringify(P.CHARACTERS[id].lines.en), /[\u4e00-\u9fff]/, `${id} English lines`)
      }
    } finally {
      i18n.setLang(null)
    }
    P.setImageMode('file')
    assert.match(P.imageReference(), /read_image/)
    P.setImageMode('attach')
    P.setCharacter('ojousama')
    console.log('PASS backends: Codex and DeepSeek Harness bridges, locating, patches, AI-core registry and characters')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
