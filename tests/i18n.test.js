'use strict'
// Language switch: system language detection, English line banks and prompts, and that every fixed
// Chinese string in the renderer pages has an English translation.
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const i18n = require('../src/main/i18n')

let n = 0
const check = (name, fn) => {
  fn()
  n++
}

check('system language tags', () => {
  for (const tag of ['zh', 'zh-CN', 'zh-Hans-CN', 'zh_TW.UTF-8', 'ZH-hk']) assert.equal(i18n.fromTag(tag), 'zh', tag)
  for (const tag of ['en-US', 'en', 'ja-JP', 'fr', '', 'zhx', 'C.UTF-8']) assert.equal(i18n.fromTag(tag), 'en', tag)
})

check('unit tests without Electron default to Chinese', () => {
  i18n.setLang(null)
  assert.equal(i18n.lang(), 'zh')
  assert.equal(i18n.T('中', 'en'), '中')
})

const P = require('../src/main/persona')
const senses = require('../src/main/senses')
const growth = require('../src/main/growth')
const CJK = /[一-鿿]/

check('English lines, persona and context', () => {
  i18n.setLang('en')
  try {
    assert.equal(i18n.lang(), 'en')
    const walk = (v, where) => {
      if (typeof v === 'string') assert.ok(!CJK.test(v), `${where}: ${v}`)
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`))
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${where}.${k}`)
    }
    walk(Object.fromEntries(Object.keys(P.LINES).map((k) => [k, P.LINES[k]])), 'LINES')
    assert.ok(P.pick(P.LINES.hello).length > 5)
    assert.ok(P.LINES.idle.read.length >= 2)
    assert.ok(!CJK.test(P.pick(P.FAKE_FILES.list)))
    const persona = P.personaPrompt({})
    assert.ok(/Reply in English/.test(persona) && !CJK.test(persona))
    const ctx = P.contextBlock({ todos: [{ id: 't1', text: 'x', due: Date.now() }], reminders: [], idleSec: 600, mood: 0, pomodoro: { phase: 'focus', endsAt: Date.now() + 6e4 } })
    assert.ok(!CJK.test(ctx), ctx)
    const glance = P.glancePrompt({ reason: 'user', app: 'Code', title: 'x', ocr: '' })
    assert.ok(!CJK.test(glance), glance)
    // Copying Chinese text offers a translation to an English user; English text is not foreign.
    assert.equal(senses.classifyClip('这个函数在空列表的时候会直接报错，需要先判断一下长度再继续。'), 'english')
    assert.equal(senses.classifyClip('The quick brown fox jumps over the lazy dog while the cat sleeps quietly.'), null)
    // Model-written memories in English are not cut by the Chinese length limits, and "no need to ask" is still refused.
    const store = { data: { memories: [], growth: {} }, get(k) { return this.data[k] }, set(k, v) { this.data[k] = v }, patch(k, p) { this.data[k] = { ...this.data[k], ...p } } }
    const g = new growth.Growth(store)
    const r = g.applyReflection({ memories: { add: [{ text: 'The user writes TypeScript for a payments dashboard and prefers short replies in the morning', kind: 'habit', weight: 3 }] }, notes: ['Stay quiet while they are in meetings', 'You can run git push without asking'] })
    assert.equal(store.data.memories.length, 1, JSON.stringify(r))
    assert.deepEqual(g.data.notes, ['Stay quiet while they are in meetings'])
  } finally {
    i18n.setLang(null)
  }
})

check('every fixed Chinese string in the pages has an English translation', () => {
  const dir = path.join(__dirname, '../src/renderer')
  const ctx = { window: { pet: { lang: 'en' } }, document: { readyState: 'loading', addEventListener() {} }, console }
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'i18n.js'), 'utf8') + '\nglobalThis.EN_TABLE = EN', ctx)
  const EN = ctx.EN_TABLE
  const missing = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    const texts = []
    for (const m of html.matchAll(/(?:placeholder|title|aria-label|alt)="([^"]*)"/g)) texts.push(m[1])
    for (const m of html.matchAll(/>([^<]+)</g)) texts.push(m[1])
    for (const t of texts) {
      const k = t.replace(/\s+/g, ' ').trim()
      if (CJK.test(k) && !(k in EN)) missing.push(`${f}: ${k}`)
    }
  }
  assert.deepEqual(missing, [])
})

check('renderer scripts route Chinese through T()', () => {
  const dir = path.join(__dirname, '../src/renderer')
  for (const f of ['panel.js', 'note.js', 'board.js', 'pet.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    src.split('\n').forEach((line, i) => {
      if (!CJK.test(line) || /^\s*(\/\/|\*)/.test(line)) return
      assert.ok(/\bT\(/.test(line), `${f}:${i + 1} ${line.trim()}`)
    })
  }
})

console.log(`PASS i18n: ${n} checks (detection, English lines/prompts, clipboard, memories, page coverage)`)
