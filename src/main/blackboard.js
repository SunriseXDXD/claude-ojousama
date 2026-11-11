'use strict'
// The blackboard: a window she pulls out beside her for long text and for code she changed
// (GitHub-style red/green diffs). The speech bubble keeps only the first sentence. It stays hidden
// while there is nothing to show and puts itself away when nobody looks at it.

const LONG_CHARS = 160
const LONG_LINES = 7
const MAX_DIFF_LINES = 600 // per changed file
const MAX_ENTRIES = 12

// ---------------------------------------------------------------- text: what belongs on the board

/** Long, multi-line or code-carrying text is written on the board instead of the bubble. */
function needsBoard(text) {
  const t = String(text || '')
  return /```/.test(t) || t.length > LONG_CHARS || t.split('\n').filter((l) => l.trim()).length > LONG_LINES
}

/** The first sentence or two (plain text, at most `max` characters) for the bubble. Headings are skipped. */
function briefOf(text, max = 70) {
  const lines = String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .split('\n')
    .filter((l) => l.trim() && !/^\s{0,3}#{1,6}\s/.test(l) && !/^\s*\|?[\s:|-]+\|?\s*$/.test(l))
    .map((l) => l.replace(/^\s{0,3}([-*+]|\d+[.)]|>)\s+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
  if (!lines.length) {
    // Only headings or only code: use a heading if there is one, else leave the bubble to the caller.
    const heading = String(text || '').replace(/```[\s\S]*?(```|$)/g, '\n').match(/^\s{0,3}#{1,6}\s+(.+)$/m)
    return heading ? heading[1].replace(/[*_`]/g, '').trim().slice(0, max) : ''
  }
  // A very short opener ("改好了：") reads better with the line after it.
  const first = lines[0].length < 12 && lines[1] ? `${lines[0]} ${lines[1]}` : lines[0]
  const sentences = first.match(/.+?(?:[。！？!?…]+|\.(?=\s|$)|$)/g) || [first]
  let out = ''
  for (const s of sentences) {
    if (out && (out + s).length > max) break
    out += s
    if (out.length >= max * 0.6) break
  }
  out = out.trim()
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out
}

// ---------------------------------------------------------------- diffs

const splitLines = (s) => {
  const lines = String(s).split(/\r?\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Plain line diff (LCS) as one hunk with ` ` / `-` / `+` prefixed lines; context trimmed to 3 lines. */
function lineDiff(before, after, context = 3) {
  const a = splitLines(before)
  const b = splitLines(after)
  let ops
  if (a.length * b.length > 4e6) ops = [...a.map((l) => '-' + l), ...b.map((l) => '+' + l)]
  else {
    const m = a.length, n = b.length
    const lcs = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    ops = []
    let i = 0, j = 0
    while (i < m && j < n) {
      if (a[i] === b[j]) ops.push(' ' + a[i++]), j++
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push('-' + a[i++])
      else ops.push('+' + b[j++])
    }
    while (i < m) ops.push('-' + a[i++])
    while (j < n) ops.push('+' + b[j++])
  }
  // Split into hunks around the changes.
  const changed = ops.map((l, k) => (l[0] === ' ' ? -1 : k)).filter((k) => k >= 0)
  if (!changed.length) return []
  const hunks = []
  let start = Math.max(0, changed[0] - context)
  let end = changed[0]
  const flush = () => {
    const from = start, to = Math.min(ops.length - 1, end + context)
    let oldStart = 1, newStart = 1
    for (let k = 0; k < from; k++) {
      if (ops[k][0] !== '+') oldStart++
      if (ops[k][0] !== '-') newStart++
    }
    hunks.push({ oldStart, newStart, lines: ops.slice(from, to + 1) })
  }
  for (const k of changed.slice(1)) {
    if (k - end > context * 2) {
      flush()
      start = k - context
    }
    end = k
  }
  flush()
  return hunks
}

/**
 * What Claude Code reports after an Edit / Write (`tool_use_result`) → { file, created, hunks, add, del, cut }.
 * Edits come with a structured patch; a new file is all additions; older shapes fall back to a line diff.
 */
function patchFromResult(r) {
  if (!r || typeof r !== 'object' || typeof r.filePath !== 'string') return null
  let hunks = (Array.isArray(r.structuredPatch) ? r.structuredPatch : [])
    .filter((h) => h && Array.isArray(h.lines) && h.lines.length)
    .map((h) => ({ oldStart: Number(h.oldStart) || 1, newStart: Number(h.newStart) || 1, lines: h.lines.map(String) }))
  if (!hunks.length) {
    if (r.type === 'create' && typeof r.content === 'string') hunks = [{ oldStart: 0, newStart: 1, lines: splitLines(r.content).map((l) => '+' + l) }]
    else if (typeof r.originalFile === 'string' && typeof r.content === 'string') hunks = lineDiff(r.originalFile, r.content)
    else if (typeof r.oldString === 'string' && typeof r.newString === 'string') hunks = lineDiff(r.oldString, r.newString)
  }
  hunks = hunks.filter((h) => h.lines.length)
  if (!hunks.length) return null
  let add = 0, del = 0, room = MAX_DIFF_LINES, cut = 0
  const kept = []
  for (const h of hunks) {
    for (const l of h.lines) l[0] === '+' ? add++ : l[0] === '-' ? del++ : 0
    if (room <= 0) cut += h.lines.length
    else {
      kept.push(h.lines.length > room ? { ...h, lines: h.lines.slice(0, room) } : h)
      cut += Math.max(0, h.lines.length - room)
      room -= h.lines.length
    }
  }
  return { file: r.filePath, created: r.type === 'create', hunks: kept, add, del, cut }
}

// ---------------------------------------------------------------- the window

class Blackboard {
  /**
   * @param {object} o
   * @param {object} o.electron      { BrowserWindow, screen }
   * @param {string} o.preload
   * @param {string} o.html
   * @param {() => object|null} o.anchor       the pet window's bounds (the board opens beside her)
   * @param {() => number} o.hideSeconds       put away after this long without attention (0 = never)
   * @param {boolean} o.floating               frameless + transparent (false on desktops without positioning)
   */
  constructor(o) {
    this.o = o
    this.win = null
    this.entries = [] // { id, title, items: [{type:'text',text} | {type:'diff',...patch}], live, at }
    this.index = -1
    this.pinned = false
    this.visible = false
    this.side = 'left'
    this.lastActive = 0
    this.sendTimer = null
    this.timer = setInterval(() => this.tick(), 5000)
    if (this.timer.unref) this.timer.unref()
  }

  current() {
    return this.entries[this.index] || null
  }

  state() {
    return { entry: this.current(), index: this.index, total: this.entries.length, pinned: this.pinned, side: this.side, visible: this.visible }
  }

  /** Add or update (same id) an entry and show it. Returns true when the board was pulled out for it. */
  write(entry, { show = true } = {}) {
    const at = Date.now()
    const i = this.entries.findIndex((e) => e.id === entry.id)
    if (i >= 0) this.entries[i] = { ...this.entries[i], ...entry, at }
    else {
      this.entries.push({ ...entry, at })
      if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    }
    this.index = this.entries.findIndex((e) => e.id === entry.id)
    this.lastActive = at
    if (!show) return false
    const opened = !this.visible
    this.show()
    return opened
  }

  /** The writing on an entry is finished (it may now be put away when nobody looks). */
  settle(id) {
    const e = this.entries.find((x) => x.id === id)
    if (!e || !e.live) return
    e.live = false
    this.lastActive = Date.now()
    this.push(true)
  }

  place() {
    const { screen } = this.o.electron
    const b = this.o.anchor() || { x: 200, y: 200, width: 300, height: 300 }
    const wa = screen.getDisplayNearestPoint({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }).workArea
    const h = Math.min(470, wa.height - 24)
    // Beside her, overlapping the empty margin of her window: on the left when it fits there, else on
    // the roomier side, narrowed to the room there is (never covering her unless the screen is tiny).
    const gap = 44
    const want = Math.min(560, wa.width - 24)
    const roomLeft = b.x + gap - (wa.x + 4)
    const roomRight = wa.x + wa.width - 4 - (b.x + b.width - gap)
    this.side = roomLeft >= want || roomLeft >= roomRight ? 'left' : 'right'
    const room = this.side === 'left' ? roomLeft : roomRight
    const w = room >= 320 ? Math.min(want, room) : want
    let x = this.side === 'left' ? b.x + gap - w : b.x + b.width - gap
    x = Math.max(wa.x + 4, Math.min(wa.x + wa.width - w - 4, x))
    const y = Math.max(wa.y + 4, Math.min(wa.y + wa.height - h - 4, b.y + b.height - h - 8))
    return { x: Math.round(x), y: Math.round(y), width: w, height: h }
  }

  show() {
    if (!this.current()) return false
    const { BrowserWindow } = this.o.electron
    this.lastActive = Date.now()
    if (!this.win || this.win.isDestroyed()) {
      const floating = this.o.floating !== false
      this.win = new BrowserWindow({
        ...this.place(),
        transparent: floating,
        frame: !floating,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        title: 'Claude Ojousama · 黑板',
        backgroundColor: floating ? '#00000000' : '#23382f',
        webPreferences: { preload: this.o.preload, contextIsolation: true, nodeIntegration: false },
      })
      this.win.setAlwaysOnTop(true, 'floating')
      this.win.loadFile(this.o.html)
      this.win.once('ready-to-show', () => this.visible && this.win.showInactive())
      this.win.on('close', (e) => {
        if (this.quitting) return
        e.preventDefault() // closing only puts it away
        this.hide()
      })
      this.visible = true
      return true
    }
    if (!this.visible) {
      clearTimeout(this.hideTimer)
      this.win.setBounds(this.place())
      this.visible = true
      this.win.showInactive()
    }
    this.push()
    return true
  }

  hide() {
    if (!this.visible) return
    this.visible = false
    this.pinned = false
    this.push(true)
    clearTimeout(this.hideTimer)
    // Let the slide-out play before the window goes.
    this.hideTimer = setTimeout(() => this.win && !this.win.isDestroyed() && !this.visible && this.win.hide(), 220)
  }

  toggle() {
    if (this.visible) this.hide()
    else this.show()
  }

  nav(delta) {
    const i = Math.max(0, Math.min(this.entries.length - 1, this.index + delta))
    if (i === this.index) return
    this.index = i
    this.touch()
    this.push(true)
  }

  setPinned(v) {
    this.pinned = !!v
    this.touch()
    this.push(true)
  }

  touch() {
    this.lastActive = Date.now()
  }

  /** Put away when nobody has looked at it for a while (hovering, scrolling and new writing count). */
  tick(now = Date.now()) {
    const secs = Number(this.o.hideSeconds()) || 0
    const e = this.current()
    if (!this.visible || this.pinned || !secs || (e && e.live)) return
    if (now - this.lastActive > secs * 1000) this.hide()
  }

  /** Send the state to the window; streamed writing is batched. */
  push(now = false) {
    if (!this.win || this.win.isDestroyed()) return
    const send = () => {
      this.sendTimer = null
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send('board:state', this.state())
    }
    if (now) {
      clearTimeout(this.sendTimer)
      send()
    } else if (!this.sendTimer) this.sendTimer = setTimeout(send, 120)
  }

  destroy() {
    this.quitting = true
    clearInterval(this.timer)
    clearTimeout(this.hideTimer)
    clearTimeout(this.sendTimer)
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
  }
}

module.exports = { Blackboard, needsBoard, briefOf, lineDiff, patchFromResult, LONG_CHARS, MAX_DIFF_LINES }
