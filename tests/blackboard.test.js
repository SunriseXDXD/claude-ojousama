'use strict'
const assert = require('assert/strict')
const { EventEmitter } = require('events')
const B = require('../src/main/blackboard')

// ---- what goes on the board, and what stays in the bubble
assert.equal(B.needsBoard('好的，记下了。'), false)
assert.equal(B.needsBoard('字'.repeat(161)), true)
assert.equal(B.needsBoard('看这段：\n```js\nlet a = 1\n```'), true, 'code always goes on the board')
assert.equal(B.needsBoard('1\n2\n3\n4\n5\n6\n7'), false)
assert.equal(B.needsBoard('1\n2\n3\n4\n5\n6\n7\n8'), true)
assert.equal(B.briefOf('## 结论\n\n**改好了**。问题出在 `add` 用了减号，细节如下：\n\n```js\nx\n```'), '改好了。问题出在 add 用了减号，细节如下：')
assert.equal(B.briefOf('哼，查到了。\n\n1. 第一点\n2. 第二点'), '哼，查到了。 第一点')
assert.equal(B.briefOf('```js\nonly code\n```'), '', 'nothing to say: the caller adds its own hint')
assert.equal(B.briefOf('# 只有标题'), '只有标题')
const cut = B.briefOf('This sentence keeps going and going and going far past the limit of seventy characters for sure. Second.')
assert.ok(cut.length <= 70 && cut.endsWith('…'))
assert.equal(B.briefOf('第一句。第二句也不长。' + '第三句很长'.repeat(20)), '第一句。第二句也不长。')

// ---- diffs
const edit = B.patchFromResult({
  filePath: '/w/math.js', oldString: 'a - b', newString: 'a + b', originalFile: 'x',
  structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' function add(a, b) {', '-  return a - b', '+  // fixed', '+  return a + b', ' }'] }],
})
assert.deepEqual([edit.file, edit.created, edit.add, edit.del, edit.cut, edit.hunks.length], ['/w/math.js', false, 2, 1, 0, 1])
assert.equal(edit.hunks[0].oldStart, 1)
const created = B.patchFromResult({ type: 'create', filePath: '/w/new.txt', content: 'hello\nworld\n', structuredPatch: [], originalFile: null })
assert.deepEqual(created.hunks, [{ oldStart: 0, newStart: 1, lines: ['+hello', '+world'] }])
assert.equal(created.created, true)
const rewritten = B.patchFromResult({ type: 'update', filePath: '/w/a.txt', content: 'a\nB\nc\n', originalFile: 'a\nb\nc\n', structuredPatch: [] })
assert.deepEqual(rewritten.hunks[0].lines, [' a', '-b', '+B', ' c'])
const fallback = B.patchFromResult({ filePath: '/w/b.txt', oldString: 'one\ntwo', newString: 'one\n2' })
assert.deepEqual([fallback.add, fallback.del], [1, 1])
assert.equal(B.patchFromResult({ type: 'text', file: {} }), null, 'a Read result is not a change')
assert.equal(B.patchFromResult(null), null)
assert.equal(B.patchFromResult({ filePath: '/w/c.txt', oldString: 'same', newString: 'same' }), null)
const huge = B.patchFromResult({ type: 'create', filePath: '/w/big.txt', content: 'x\n'.repeat(1000), structuredPatch: [] })
assert.equal(huge.hunks[0].lines.length, B.MAX_DIFF_LINES)
assert.deepEqual([huge.add, huge.cut], [1000, 400])
// line diff: separate hunks, right line numbers
const before = [...Array(40)].map((_, i) => `line ${i + 1}`)
const after = [...before]
after[4] = 'LINE 5'
after.splice(30, 1) // drop "line 31"
after.push('line 41')
const hunks = B.lineDiff(before.join('\n'), after.join('\n'))
assert.equal(hunks.length, 3)
assert.deepEqual([hunks[0].oldStart, hunks[0].newStart], [2, 2])
assert.ok(hunks[0].lines.includes('-line 5') && hunks[0].lines.includes('+LINE 5'))
assert.deepEqual([hunks[1].oldStart, hunks[1].newStart], [28, 28])
assert.ok(hunks[1].lines.includes('-line 31'))
assert.equal(hunks[2].lines.at(-1), '+line 41')
assert.deepEqual(B.lineDiff('same\n', 'same\n'), [])

// ---- the window: hidden until needed, put away when nobody looks
const sent = []
class FakeWindow extends EventEmitter {
  constructor(options) { super(); this.options = options; this.shown = false; this.bounds = options; this.webContents = { send: (_c, s) => sent.push(s) } }
  isDestroyed() { return !!this.destroyed }
  setAlwaysOnTop() {}
  loadFile() { queueMicrotask(() => this.emit('ready-to-show')) }
  showInactive() { this.shown = true }
  hide() { this.shown = false }
  setBounds(b) { this.bounds = b }
  destroy() { this.destroyed = true }
}
const wa = { x: 0, y: 0, width: 1600, height: 900 }
const electron = { BrowserWindow: FakeWindow, screen: { getDisplayNearestPoint: () => ({ workArea: wa }) } }
let anchor = { x: 1200, y: 500, width: 300, height: 400 }
let hideSeconds = 120
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const board = new B.Blackboard({ electron, preload: 'p', html: 'h', anchor: () => anchor, hideSeconds: () => hideSeconds, floating: true })
  assert.equal(board.show(), false, 'nothing written: stays hidden')
  assert.equal(board.win, null)
  assert.equal(board.write({ id: 'a', title: 'A', items: [{ type: 'text', text: 'long' }], live: true }), true, 'pulled out for the first writing')
  await sleep(5)
  assert.ok(board.win.shown && board.visible)
  assert.equal(board.win.options.x + board.win.options.width, 1200 + 44, 'to her left, against her window')
  assert.equal(board.win.options.y + board.win.options.height, 900 - 8, 'standing on the same ground')
  assert.equal(board.side, 'left')
  assert.equal(board.write({ id: 'a', title: 'A', items: [{ type: 'text', text: 'longer' }], live: true }), false, 'same board keeps being written on')
  assert.equal(board.entries.length, 1)
  await sleep(160)
  assert.equal(sent.at(-1).entry.items[0].text, 'longer', 'streamed writing reaches the window (batched)')
  // being written on: never put away; afterwards only when nobody has looked for a while
  board.tick(Date.now() + 10 * 60000)
  assert.equal(board.visible, true)
  board.settle('a')
  assert.equal(board.current().live, false)
  board.tick(Date.now() + 60000)
  assert.equal(board.visible, true, 'still inside the 120 s')
  board.setPinned(true)
  board.tick(Date.now() + 10 * 60000)
  assert.equal(board.visible, true, 'pinned stays')
  board.setPinned(false)
  hideSeconds = 0
  board.tick(Date.now() + 10 * 60000)
  assert.equal(board.visible, true, '0 = never put away by itself')
  hideSeconds = 120
  board.touch()
  board.tick(Date.now() + 119000)
  assert.equal(board.visible, true)
  board.tick(Date.now() + 121000)
  assert.equal(board.visible, false, 'put away after 120 s without attention')
  assert.equal(sent.at(-1).visible, false, 'the window is told to slide out first')
  await sleep(260)
  assert.equal(board.win.shown, false)
  // history and placement
  anchor = { x: 100, y: 500, width: 300, height: 400 }
  assert.equal(board.write({ id: 'b', title: 'B', items: [{ type: 'diff', file: '/f', hunks: [], add: 1, del: 0 }] }), true)
  assert.equal(board.side, 'right', 'no room on the left: opens on her right')
  assert.equal(board.win.bounds.x, 100 + 300 - 44)
  assert.deepEqual([board.state().index, board.state().total], [1, 2])
  board.nav(-1)
  assert.equal(board.current().id, 'a')
  board.nav(-1)
  assert.equal(board.current().id, 'a')
  board.nav(1)
  assert.equal(board.current().id, 'b')
  assert.equal(board.write({ id: 'c', title: 'C', items: [] }, { show: false }), false)
  board.hide()
  assert.equal(board.write({ id: 'd', title: 'D', items: [] }, { show: false }), false, 'she is hidden (fullscreen app): written, not shown')
  assert.equal(board.visible, false)
  assert.equal(board.current().id, 'd')
  for (let i = 0; i < 20; i++) board.write({ id: 'n' + i, title: 'N', items: [] }, { show: false })
  assert.equal(board.entries.length, 12, 'only the last boards are kept')
  // A small screen with no full-width room beside her: the roomier side, narrowed, without covering her.
  Object.assign(wa, { width: 800, height: 450 })
  anchor = { x: 435, y: 62, width: 305, height: 388 }
  assert.equal(board.write({ id: 'small', title: 'S', items: [] }), true)
  assert.equal(board.side, 'left')
  assert.equal(board.win.bounds.x + board.win.bounds.width, 435 + 44)
  assert.ok(board.win.bounds.width >= 320 && board.win.bounds.x >= 4 && board.win.bounds.height <= 450 - 24)
  let prevented = false
  board.win.emit('close', { preventDefault: () => (prevented = true) })
  assert.equal(prevented, true, 'closing the window only puts it away')
  board.destroy()
  assert.equal(board.win.destroyed, true)
  console.log('PASS blackboard: routing of long text, brief sentence, Edit/Write diffs, line diff, show/hide, pin, history')
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
