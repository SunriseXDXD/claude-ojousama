'use strict'
// Claude Code bridge: one headless `claude -p` process per turn. The prompt (and any screenshots)
// goes in as a single stream-json user message; the CLI streams JSON events back up to its `result`.
const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TOOL_MODES = ['full', 'look', 'scan', 'none']
const PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access']
/** Tools that change files or run code; read-only chats never get them. */
const WRITE_TOOLS = ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit']
/** Research tools a chat may use without asking (nobody can answer a prompt in a headless run). */
const WEB_TOOLS = ['WebSearch', 'WebFetch']
/** All an unattended workspace scan gets; --restricted keeps them inside the work folder. */
const SCAN_TOOLS = ['Read', 'Glob', 'Grep']
// Workspace-write: commands run only inside Claude Code's sandbox (Seatbelt on macOS, bubblewrap on
// Linux): writes limited to the work folder, no network. Where the sandbox cannot start (Windows,
// bubblewrap missing) a command would need approval, and with nobody to approve it is refused.
const SANDBOX = { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false }
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
const RESULT_ERRORS = { error_max_turns: '超过了最大轮数', error_max_budget_usd: '超过了花费上限', error_during_execution: '执行时出错' }

// Stored session ids carry a prefix, so ids left over from the old Codex / DSH backends are never resumed.
const PREFIX = 'claude:'
const sessionFor = (id) => (typeof id === 'string' && id.startsWith(PREFIX) && id.length > PREFIX.length ? id.slice(PREFIX.length) : null)
const tagSession = (id) => (id ? PREFIX + id : null)

/** Where `claude` usually lives when a GUI app's PATH lacks the user's shell setup. */
function commonDirs(home) {
  if (process.platform === 'win32') return [path.join(home, '.local', 'bin'), path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm')]
  return [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin')]
}

/** Find the Claude Code CLI: the configured path, else PATH and the usual install folders. */
function locateClaude(override, { env = process.env, home = os.homedir(), installDirs = commonDirs(home) } = {}) {
  const win = process.platform === 'win32'
  const names = win ? ['claude.exe', 'claude.cmd'] : ['claude']
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
      // npm's Windows shim: start the package's own entry, never through cmd.exe.
      const pkg = path.join(path.dirname(resolved), 'node_modules', '@anthropic-ai', 'claude-code')
      const exe = path.join(pkg, 'bin', 'claude.exe')
      if (fs.existsSync(exe)) return { exe, args: [], displayPath: candidate }
      const cli = path.join(pkg, 'cli.js')
      if (fs.existsSync(cli)) return { exe: process.execPath, args: [cli], electronRunAsNode: true, displayPath: candidate }
      continue
    }
    // Older npm releases link to cli.js, and a GUI app may have no node on PATH: use Electron's.
    if (/\.(c|m)?js$/i.test(resolved)) return { exe: process.execPath, args: [resolved], electronRunAsNode: true, displayPath: candidate }
    if (!win) {
      try {
        fs.accessSync(resolved, fs.constants.X_OK)
      } catch {
        continue
      }
    }
    // Keep the link itself: the native installer updates by re-pointing it.
    return { exe: candidate, args: [], displayPath: candidate }
  }
  return null
}

/**
 * --restricted runs skip the user's settings files. Carry over what they need to reach the model:
 * the settings' env block (third-party endpoints, tokens) goes into the child's environment; the
 * API key helper and default model go in through --settings.
 */
function userAuth({ env = process.env, home = os.homedir() } = {}) {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
    const vars = {}
    if (s.env && typeof s.env === 'object') for (const [k, v] of Object.entries(s.env)) if (v != null && typeof v !== 'object') vars[k] = String(v)
    const settings = {}
    if (typeof s.apiKeyHelper === 'string' && s.apiKeyHelper) settings.apiKeyHelper = s.apiKeyHelper
    if (typeof s.model === 'string' && s.model) settings.model = s.model
    return { env: vars, settings }
  } catch {
    return { env: {}, settings: {} }
  }
}

/** Run options from the pet's settings. Restricted runs (look / scan / none) are always read-only. */
function claudeOptions(settings, { prompt, persona, sessionId = null, permission, tools = 'full', images = [], persist = true }) {
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
    workspace: !!settings.cwd, // scans read files only inside a folder the user picked
    model: (restricted && settings.claudeGlanceModel) || settings.claudeModel || '',
    effort: (restricted && settings.claudeGlanceEffort) || settings.claudeEffort || '',
  }
}

/** Command-line arguments for one run. */
function buildArgs(o, authSettings = {}) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', 'none']
  if (o.persona) args.push('--append-system-prompt', o.persona)
  if (o.model) args.push('--model', o.model)
  if (o.effort) args.push('--effort', o.effort)
  const resume = sessionFor(o.sessionId)
  if (resume) args.push('--resume', resume)
  if (o.persist === false) args.push('--no-session-persistence')
  let settings = null
  if (o.tools === 'full') {
    if (o.permission === 'danger-full-access') args.push('--permission-mode', 'bypassPermissions')
    else {
      if (o.permission === 'workspace-write') {
        args.push('--permission-mode', 'acceptEdits')
        settings = { sandbox: SANDBOX }
      } else args.push('--permission-mode', 'dontAsk', '--disallowedTools', WRITE_TOOLS.join(','))
      args.push('--allowedTools', WEB_TOOLS.join(','))
    }
  } else {
    // Looks, scans and text jobs: no settings files, hooks, plugins, CLAUDE.md or MCP servers, and
    // only the tools named here (none at all, or read/search confined to the work folder).
    const tools = o.tools === 'scan' && o.workspace ? SCAN_TOOLS.join(',') : ''
    args.push('--restricted', '--safe-mode', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', tools)
    if (Object.keys(authSettings).length) settings = authSettings
  }
  if (settings) args.push('--settings', JSON.stringify(settings))
  return args
}

/** The stream-json user message: screenshots first (as the API recommends), then the prompt. */
function userMessage(prompt, images = []) {
  const content = []
  for (const file of images) {
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()]
    if (!type) throw new Error('不支持的图片格式：' + path.basename(file))
    content.push({ type: 'image', source: { type: 'base64', media_type: type, data: fs.readFileSync(file).toString('base64') } })
  }
  content.push({ type: 'text', text: prompt || '' })
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' }) + '\n'
}

function childEnv(extra, located) {
  const env = { ...process.env, ...extra }
  // Started from a terminal inside Claude Code (e.g. `npm start` there): do not look like a nested session.
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  if (located.electronRunAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  // macOS GUI apps get a bare PATH; give the commands Claude runs the usual tool folders too.
  if (process.platform !== 'win32') {
    const parts = (env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean)
    for (const dir of [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']) if (!parts.includes(dir)) parts.push(dir)
    env.PATH = parts.join(':')
  }
  return env
}

const tail = (text) => String(text || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ')

/**
 * One Claude Code turn. Emits 'event' ({type: session | status | thinking | text | tool_call |
 * tool_result}), 'stderr' and 'done' ({ ok, final, sessionId, error, code }). Session ids go in
 * and come out in the stored `claude:` form.
 */
class ClaudeRun extends EventEmitter {
  constructor(options, { spawnProcess = spawn } = {}) {
    super()
    this.options = { tools: 'full', permission: 'read-only', images: [], persist: true, ...options }
    this.sessionId = sessionFor(this.options.sessionId)
    this.final = ''
    this.lastText = ''
    this.partial = ''
    this.stderr = ''
    this.killed = false
    this.done = false
    this.toolNames = new Map()
    this.spawnProcess = spawnProcess
    // Start after the caller has attached its listeners.
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
    if (!TOOL_MODES.includes(o.tools)) throw new Error('Unknown tool mode: ' + o.tools)
    if (!PERMISSIONS.includes(o.permission)) throw new Error('Unknown permission mode: ' + o.permission)
    const claude = typeof o.claude === 'string' ? { exe: o.claude, args: [] } : o.claude
    if (!claude || !claude.exe) throw new Error('找不到 Claude Code，请先安装并在终端运行 claude 登录')
    const cwd = o.cwd || os.homedir()
    if (!fs.existsSync(cwd)) throw new Error('工作目录不存在：' + cwd)
    const auth = o.tools === 'full' ? { env: {}, settings: {} } : userAuth()
    const input = userMessage(o.prompt, o.images || [])
    const args = [...(claude.args || []), ...buildArgs(o, auth.settings)]
    this.child = this.spawnProcess(claude.exe, args, { cwd, env: childEnv(auth.env, claude), windowsHide: true, shell: false })
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
      this.stderr = (this.stderr + text).slice(-8192)
      this.emit('stderr', text)
    })
    this.child.on('error', (e) => this._finish(false, e.code === 'ENOENT' ? `找不到 Claude Code：${claude.exe}` : e.message, -1))
    this.child.on('close', (code) => {
      clearTimeout(this.exitTimer)
      if (buffer.trim() && !this.done) this._line(buffer.trim())
      this._finish(false, this.killed ? '已取消' : tail(this.stderr) || `Claude Code 在回答前退出了（退出码 ${code}）`, code)
    })
    this.child.stdin.on('error', () => {})
    // One message per process: with stdin closed the CLI exits once the turn is done.
    this.child.stdin.end(input, 'utf8')
  }

  _line(line) {
    let e
    try {
      e = JSON.parse(line)
    } catch {
      return // not an event (a stray log line)
    }
    if (!e || typeof e !== 'object' || e.parent_tool_use_id) return // subagent traffic stays inside its tool call
    if (e.type === 'system' && e.subtype === 'init' && e.session_id) {
      this.sessionId = e.session_id
      this.emit('event', { type: 'session', sessionId: tagSession(e.session_id) })
      this.emit('event', { type: 'status', phase: 'turn_start' })
    } else if (e.type === 'stream_event') this._stream(e.event || {})
    else if (e.type === 'assistant') for (const block of (e.message && e.message.content) || []) this._block(block)
    else if (e.type === 'user') {
      const content = e.message && Array.isArray(e.message.content) ? e.message.content : []
      // tool_use_result is the CLI's structured outcome (for Edit / Write: the patch that was applied).
      const result = e.tool_use_result && typeof e.tool_use_result === 'object' ? { result: e.tool_use_result } : {}
      for (const b of content) if (b && b.type === 'tool_result') this.emit('event', { type: 'tool_result', tool: this.toolNames.get(b.tool_use_id) || 'tool', status: b.is_error ? 'failed' : 'completed', ...result })
    } else if (e.type === 'result') this._result(e)
  }

  /** Partial message chunks: the reply grows in the bubble while it is written. */
  _stream(ev) {
    const block = ev.content_block || {}
    if (ev.type === 'content_block_start' && block.type === 'text') this.partial = ''
    else if (ev.type === 'content_block_start' && block.type === 'thinking') this.emit('event', { type: 'thinking' })
    else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
      this.partial += ev.delta.text || ''
      this.emit('event', { type: 'text', text: this.partial })
    }
  }

  /** A finished content block (the CLI sends one assistant event per block). */
  _block(block) {
    if (!block) return
    if (block.type === 'text' && block.text) {
      this.lastText = block.text
      this.emit('event', { type: 'text', text: block.text })
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') this.emit('event', { type: 'thinking' })
    else if (/tool_use$/.test(block.type || '')) {
      const tool = String(block.name || 'tool')
      this.toolNames.set(block.id, tool)
      this.emit('event', { type: 'tool_call', tool, input: block.input || {} })
    }
  }

  _result(e) {
    if (e.session_id) this.sessionId = e.session_id
    const ok = e.subtype === 'success' && !e.is_error
    if (typeof e.result === 'string' && e.result && ok) this.final = e.result
    const errors = Array.isArray(e.errors) ? e.errors.filter(Boolean).join('；') : ''
    const error = ok ? null : errors || (typeof e.result === 'string' && e.result) || RESULT_ERRORS[e.subtype] || e.subtype || 'Claude Code 出错了'
    this._finish(ok, error, ok ? 0 : 1)
    // The CLI exits by itself after its result; make sure it does.
    if (this.child && this.child.exitCode === null) {
      this.exitTimer = setTimeout(() => {
        try {
          this.child.kill()
        } catch {}
      }, 5000)
      if (this.exitTimer.unref) this.exitTimer.unref()
    }
  }

  kill() {
    if (this.done || this.killed) return
    this.killed = true
    if (!this.child) return this._finish(false, '已取消', -1)
    try {
      this.child.kill()
    } catch {}
    // A stuck process (or Windows): force it, and report the cancel even if 'close' never comes.
    this.killTimer = setTimeout(() => {
      try {
        this.child.kill('SIGKILL')
      } catch {}
      this._finish(false, '已取消', -1)
    }, 2000)
    if (this.killTimer.unref) this.killTimer.unref()
  }

  _finish(ok, error, code) {
    if (this.done) return
    this.done = true
    clearTimeout(this.killTimer)
    ok = !!ok && !this.killed
    this.emit('done', { ok, final: this.final || this.lastText, sessionId: tagSession(this.sessionId), error: this.killed ? '已取消' : ok ? null : error || 'Claude Code 出错了', code })
  }
}

module.exports = { ClaudeRun, locateClaude, claudeOptions, buildArgs, userMessage, userAuth, sessionFor, tagSession, WRITE_TOOLS, SCAN_TOOLS }
