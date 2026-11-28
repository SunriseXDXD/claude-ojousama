'use strict'
// DeepSeek Harness bridge: one `dsh --profile headless --json` process per turn. The pet passes its
// persona and the run's limits as a --patch overlay; sessions persist in DSH ($DSH_HOME/sessions).
// Sign in with the DeepSeek Harness app (DeepSeek account) or put DEEPSEEK_API_KEY in $DSH_HOME/.env.
const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { T } = require('./i18n')

const PREFIX = 'dsh:'
const sessionFor = (id) => (typeof id === 'string' && id.startsWith(PREFIX) && id.length > PREFIX.length ? id.slice(PREFIX.length) : null)
const tagSession = (id) => (id ? PREFIX + id : null)
const CANCELLED = () => T('已取消', 'Cancelled')
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i

/** Where `dsh` (npm, or the command the DeepSeek Harness app installs) and Node usually live. */
function commonDirs(home) {
  if (process.platform === 'win32') return [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'), path.join(home, '.local', 'bin')]
  return [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'), path.join(home, '.dsh', 'bin')]
}

/**
 * A Node.js >= 24.9 to run dsh's JavaScript entry with. Electron's own Node is refused by dsh's
 * native loader, so it is never used; nvm / Homebrew / npm-global installs put node next to dsh.
 */
function findNode(nextTo, { env = process.env, home = os.homedir(), dirs = commonDirs(home) } = {}) {
  const name = process.platform === 'win32' ? 'node.exe' : 'node'
  const all = [nextTo, ...(env.PATH || '').split(path.delimiter).filter(Boolean), ...dirs].filter(Boolean)
  for (const dir of [...new Set(all)]) {
    const p = path.join(dir, name)
    try {
      if (fs.statSync(p).isFile()) return p
    } catch {}
  }
  return null
}

/** The DeepSeek Harness desktop app's bundled CLI, run with the app's own runtime (it is the supported one). */
function desktopCandidates(home) {
  const rel = ['dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js']
  if (process.platform === 'darwin') {
    return ['/Applications', path.join(home, 'Applications')].map((dir) => {
      const app = path.join(dir, 'DeepSeek Harness.app')
      return { exe: path.join(app, 'Contents', 'MacOS', 'DeepSeek Harness'), cli: path.join(app, 'Contents', 'Resources', 'app.asar', ...rel) }
    })
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return [path.join(local, 'Programs', 'DeepSeek Harness'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'DeepSeek Harness')].map((dir) => ({
      exe: path.join(dir, 'DeepSeek Harness.exe'),
      cli: path.join(dir, 'resources', 'app.asar', ...rel),
    }))
  }
  return []
}

/** Find DeepSeek Harness: the configured path, else `dsh` on PATH / usual folders, else the desktop app. */
function locateDsh(override, { env = process.env, home = os.homedir(), installDirs = commonDirs(home), exists = fs.existsSync } = {}) {
  const win = process.platform === 'win32'
  const names = win ? ['dsh.exe', 'dsh.cmd'] : ['dsh']
  const dirs = [...new Set([...(env.PATH || '').split(path.delimiter).filter(Boolean), ...installDirs])]
  const candidates = override ? [override] : dirs.flatMap((dir) => names.map((name) => path.join(dir, name)))
  for (const candidate of candidates) {
    let resolved
    try {
      if (!fs.statSync(candidate).isFile()) continue
      resolved = fs.realpathSync(candidate)
    } catch {
      continue
    }
    if (/\.(cmd|bat)$/i.test(resolved)) {
      const dir = path.dirname(resolved)
      const entry = [path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), path.join(dir, '..', '@deepseek-ai', 'dsh', 'lib', 'bin.js')].find((p) => fs.existsSync(p))
      const node = entry && findNode(dir, { env, dirs: installDirs })
      if (node) return { exe: node, args: [entry], displayPath: candidate }
      continue
    }
    if (/\.(c|m)?js$/i.test(resolved)) {
      const node = findNode(path.dirname(candidate), { env, dirs: installDirs })
      if (node) return { exe: node, args: [resolved], displayPath: candidate }
      continue
    }
    if (!win) {
      try {
        fs.accessSync(resolved, fs.constants.X_OK)
      } catch {
        continue
      }
    }
    return { exe: candidate, args: [], displayPath: candidate }
  }
  if (override) return null
  for (const d of desktopCandidates(home)) if (exists(d.exe) && exists(d.cli)) return { exe: d.exe, args: [d.cli], electronRunAsNode: true, displayPath: d.exe }
  return null
}

// DSH plugins that give a run its tools. Switched off per run kind, so the limits of unattended runs
// are enforced by DSH itself, not just asked for in the prompt.
const TOOL_PLUGINS = [
  'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search', 'tool-skill', 'tool-agent-team', 'tool-subagent-control',
  'tool-subagent', 'tool-subagent-fork', 'tool-workflow', 'tool-todo', 'tool-goal', 'tool-web', 'tool-working-directory', 'mcp-resources',
]
const TOOLSETS = {
  full: [], // chat, tasks the user asked for or accepted, goals
  look: TOOL_PLUGINS.filter((id) => id !== 'tool-fs'), // screen looks: read_image (read-only); no shell, no network, no agents
  scan: TOOL_PLUGINS.filter((id) => id !== 'tool-fs' && id !== 'tool-fs-search'), // unattended file reading/search only
  none: TOOL_PLUGINS, // reflection, brief, tip, summary: text in, text out
}

/** Run options from the pet's settings. Restricted runs (look / scan / none) are always read-only. */
function dshOptions(settings, { prompt, persona, sessionId = null, permission, tools = 'full', images = [], persist = true }) {
  const restricted = tools !== 'full'
  return {
    prompt,
    persona,
    images,
    tools,
    persist,
    sessionId,
    permission: restricted ? 'read-only' : permission || settings.permission || 'read-only',
    cwd: settings.cwd || os.homedir(),
    model: settings.dshModel || '', // "provider/model"; '' = DSH's own default
  }
}

const yamlString = (v) => JSON.stringify(String(v)) // JSON strings are valid YAML scalars

/** The --patch overlay for one run: persona, stored sign-in, optional model, tools switched off. */
function patchFor(o) {
  const parts = ['# Written by Claude Ojousama for one run; deleted afterwards.']
  parts.push(`- id: system-prompt\n  config:\n    includeHarnessIdentity: false\n    personaPrefix: ${yamlString(o.persona || '')}`)
  // Headless ignores what the DeepSeek Harness app saved; use its sign-in and keys like the app does.
  for (const id of ['credentials', 'authorization', 'deepseek-account']) parts.push(`- id: ${id}\n  disabled: false`)
  const m = String(o.model || '').match(/^([\w.-]+)\/(.+)$/)
  if (m) parts.push(`- id: agent-default-model\n  config:\n    provider: ${yamlString(m[1])}\n    model: ${yamlString(m[2])}`)
  for (const id of TOOLSETS[o.tools] || []) parts.push(`- id: ${id}\n  disabled: true`)
  return parts.join('\n') + '\n'
}

/** Headless DSH reads its task from stdin; screenshots go in as files to open with read_image. */
function taskText(prompt, images = []) {
  const files = images.filter((f) => IMAGE_EXT.test(f))
  if (!files.length) return prompt || ''
  return `${prompt || ''}\n\n${T('[截图文件，用 read_image 工具查看]', '[Screenshot files: view them with the read_image tool]')}\n${files.map((f) => '- ' + f).join('\n')}\n`
}

/**
 * One DSH turn. Emits 'event' ({type: session | status | thinking | text | tool_call | tool_result}),
 * 'stderr' and 'done' ({ ok, final, sessionId, error, code }), like the Claude Code bridge.
 */
class DshRun extends EventEmitter {
  constructor(options, { spawnProcess = spawn } = {}) {
    super()
    this.options = { tools: 'full', permission: 'read-only', images: [], persist: true, ...options }
    this.sessionId = sessionFor(this.options.sessionId)
    this.final = ''
    this.texts = []
    this.stderr = ''
    this.killed = false
    this.done = false
    this.toolNames = new Map()
    this.spawnProcess = spawnProcess
    queueMicrotask(() => {
      try {
        this._start()
      } catch (e) {
        this._finish(false, e.message, -1)
      }
    })
  }

  _start() {
    if (this.done) return
    const o = this.options
    if (!TOOLSETS[o.tools]) throw new Error('Unknown tool mode: ' + o.tools)
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(o.permission)) throw new Error('Unknown permission mode: ' + o.permission)
    const dsh = typeof o.dsh === 'string' ? { exe: o.dsh, args: [] } : o.dsh
    if (!dsh || !dsh.exe) throw new Error(T('找不到 DeepSeek Harness，请先安装它（或 npm i -g @deepseek-ai/dsh）并登录', "Can't find DeepSeek Harness; install it (or npm i -g @deepseek-ai/dsh) and sign in"))
    const cwd = o.cwd || os.homedir()
    if (!fs.existsSync(cwd)) throw new Error(T('工作目录不存在：', "The work folder doesn't exist: ") + cwd)
    this.patchFile = path.join(os.tmpdir(), `ojousama-dsh-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.yml`)
    fs.writeFileSync(this.patchFile, patchFor(o), { encoding: 'utf8', mode: 0o600 })
    const args = [...(dsh.args || []), '--profile', 'headless', '--patch', this.patchFile, '--json', '--approval-policy', 'never', '--permission-mode', o.permission]
    if (this.sessionId) args.push('--session-id', this.sessionId)
    args.push('-')
    const env = { ...process.env, DSH_PERMISSION_MODE: o.permission }
    for (const k of ['DSH_SESSION_ID', 'DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SHELL', 'DSH_WEB_URL']) delete env[k]
    if (dsh.electronRunAsNode) env.ELECTRON_RUN_AS_NODE = '1'
    else delete env.ELECTRON_RUN_AS_NODE
    if (process.platform !== 'win32') {
      const parts = (env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean)
      for (const dir of [path.dirname(dsh.exe), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']) if (!parts.includes(dir)) parts.push(dir)
      env.PATH = parts.join(':')
    }
    this.child = this.spawnProcess(dsh.exe, args, { cwd, env, windowsHide: true, shell: false })
    let buffer = ''
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (line && !this.done) this._line(line)
      }
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (text) => {
      // Reasoning streams to stderr under "dsh: reasoning:"; it only means she is thinking.
      if (/dsh: reasoning:/.test(text)) this.emit('event', { type: 'thinking' })
      this.stderr = (this.stderr + text).slice(-8192)
      this.emit('stderr', text)
    })
    this.child.on('error', (e) => this._finish(false, e.code === 'ENOENT' ? T(`找不到 DeepSeek Harness：${dsh.exe}`, `Can't find DeepSeek Harness: ${dsh.exe}`) : e.message, -1))
    this.child.on('close', (code) => {
      if (buffer.trim() && !this.done) this._line(buffer.trim())
      const failure = this.stderr.split(/\r?\n/).filter((l) => /^dsh: (?!reasoning)/.test(l)).slice(-2).join(' ').replace(/^dsh: /, '')
      this._finish(code === 0 && !!this.finalSeen, this.killed ? CANCELLED() : failure || T(`DeepSeek Harness 在回答前退出了（退出码 ${code}）`, `DeepSeek Harness exited before answering (exit code ${code})`), code)
    })
    this.child.stdin.on('error', () => {})
    this.child.stdin.end(taskText(o.prompt, o.images), 'utf8')
  }

  _line(line) {
    let e
    try {
      e = JSON.parse(line)
    } catch {
      return
    }
    if (!e || typeof e !== 'object') return
    if (e.type === 'session' && e.sessionId) {
      this.sessionId = e.sessionId
      this.emit('event', { type: 'session', sessionId: tagSession(e.sessionId) })
    } else if (e.type === 'status') {
      if (e.phase === 'turn_start') this.emit('event', { type: 'status', phase: 'turn_start' })
    } else if (e.type === 'text' && e.text) {
      this.texts.push(e.text)
      this.emit('event', { type: 'text', text: e.text })
    } else if (e.type === 'reasoning' || e.type === 'thinking') this.emit('event', { type: 'thinking' })
    else if (e.type === 'tool_call') {
      const tool = String(e.tool || 'tool')
      if (e.callId) this.toolNames.set(e.callId, tool)
      this.emit('event', { type: 'tool_call', tool, input: e.input || {} })
    } else if (e.type === 'tool_result') this.emit('event', { type: 'tool_result', tool: String(e.tool || this.toolNames.get(e.callId) || 'tool'), status: e.status === 'completed' ? 'completed' : 'failed' })
    else if (e.type === 'final') {
      this.finalSeen = true
      if (e.sessionId) this.sessionId = e.sessionId
      this.final = typeof e.text === 'string' ? e.text : ''
    }
  }

  kill() {
    if (this.done || this.killed) return
    this.killed = true
    if (!this.child) return this._finish(false, CANCELLED(), -1)
    try {
      this.child.kill()
    } catch {}
    this.killTimer = setTimeout(() => {
      try {
        this.child.kill('SIGKILL')
      } catch {}
      this._finish(false, CANCELLED(), -1)
    }, 2000)
    if (this.killTimer.unref) this.killTimer.unref()
  }

  _finish(ok, error, code) {
    if (this.done) return
    this.done = true
    clearTimeout(this.killTimer)
    if (this.patchFile) fs.rm(this.patchFile, { force: true }, () => {})
    ok = !!ok && !this.killed
    this.emit('done', { ok, final: this.final || this.texts[this.texts.length - 1] || '', sessionId: tagSession(this.sessionId), error: this.killed ? CANCELLED() : ok ? null : error || T('DeepSeek Harness 出错了', 'DeepSeek Harness ran into an error'), code })
  }
}

module.exports = { DshRun, locateDsh, dshOptions, patchFor, taskText, findNode, sessionFor, tagSession, TOOLSETS, TOOL_PLUGINS }
