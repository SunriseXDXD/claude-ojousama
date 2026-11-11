'use strict'
/* global pet */
// The blackboard window: long text (a small Markdown subset) and GitHub-style diffs of changed files.
const $ = (s) => document.querySelector(s)
let state = null
let shownId = null

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/** Inline marks on already escaped text: `code`, **bold**, [text](url) (shown as text, never a link to click). */
const inline = (s) =>
  esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 <span class="muted">($2)</span>')

function tableHtml(rows) {
  const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const head = cells(rows[0])
  const body = rows.slice(2).map(cells)
  return `<table><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`
}

/** Text outside code fences: headings, lists, quotes, tables, paragraphs. */
function blocks(text) {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    let m
    if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/))) {
      out.push(`<h${Math.min(3, m[1].length)}>${inline(m[2])}</h${Math.min(3, m[1].length)}>`)
      i++
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr />')
      i++
    } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++])
      out.push(tableHtml(rows))
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items = []
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`)
    } else if (/^\s*>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${quote.map(inline).join('<br />')}</blockquote>`)
    } else {
      const para = []
      while (i < lines.length && lines[i].trim() && !/^\s{0,3}#{1,6}\s|^\s*([-*+]|\d+[.)])\s+|^\s*>\s?/.test(lines[i])) para.push(lines[i++])
      out.push(`<p>${para.map(inline).join('\n')}</p>`)
    }
  }
  return out.join('')
}

function markdown(text) {
  return String(text)
    .split(/```([\w+#.-]*)\n?([\s\S]*?)(?:```|$)/g)
    .map((part, i, all) => {
      if (i % 3 === 0) return blocks(part)
      if (i % 3 === 1) return ''
      const lang = all[i - 1]
      return `<pre>${lang ? `<span class="lang">${esc(lang)}</span>` : ''}<code>${esc(part.replace(/\n$/, ''))}</code></pre>`
    })
    .join('')
}

const count = (lines, signs) => lines.filter((l) => signs.includes(l[0])).length

/** One changed file: header with +/- counts, then each hunk with old/new line numbers. */
function diffHtml(d) {
  const rows = []
  for (const h of d.hunks) {
    let a = h.oldStart
    let b = h.newStart
    rows.push(`<tr class="hunk"><td colspan="4">@@ -${h.oldStart},${count(h.lines, ' -')} +${h.newStart},${count(h.lines, ' +')} @@</td></tr>`)
    for (const line of h.lines) {
      const sign = line[0]
      const code = esc(line.slice(1)) || ' '
      if (sign === '+') rows.push(`<tr class="add"><td class="ln"></td><td class="ln">${b++}</td><td class="sign">+</td><td>${code}</td></tr>`)
      else if (sign === '-') rows.push(`<tr class="del"><td class="ln">${a++}</td><td class="ln"></td><td class="sign">-</td><td>${code}</td></tr>`)
      else if (sign === '\\') continue // "\ No newline at end of file"
      else rows.push(`<tr><td class="ln">${a++}</td><td class="ln">${b++}</td><td class="sign"></td><td>${code}</td></tr>`)
    }
  }
  return (
    `<section class="diff"><div class="file"><span class="path" title="${esc(d.file)}">&lrm;${esc(d.name || d.file)}</span>` +
    `${d.created ? '<span class="badge">新文件</span>' : ''}<span class="plus">+${d.add}</span><span class="minus">−${d.del}</span></div>` +
    `<div class="scroll"><table>${rows.join('')}</table></div>${d.cut ? `<div class="cut">…还有 ${d.cut} 行没有显示</div>` : ''}</section>`
  )
}

/** Several edits of one file are shown together under one header. */
function mergeDiffs(items) {
  const files = new Map()
  for (const d of items) {
    const f = files.get(d.file)
    if (!f) files.set(d.file, { ...d, hunks: [...d.hunks] })
    else Object.assign(f, { hunks: [...f.hunks, ...d.hunks], add: f.add + d.add, del: f.del + d.del, cut: (f.cut || 0) + (d.cut || 0), created: f.created })
  }
  return [...files.values()]
}

function render(s) {
  state = s
  document.body.dataset.side = s.side || 'left'
  document.body.classList.toggle('in', !!s.visible)
  const e = s.entry
  if (!e) return
  const body = $('#body')
  const same = shownId === e.id
  const nearEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 40
  const top = body.scrollTop
  const texts = e.items.filter((x) => x.type === 'text')
  const diffs = mergeDiffs(e.items.filter((x) => x.type === 'diff'))
  const add = diffs.reduce((n, d) => n + d.add, 0)
  const del = diffs.reduce((n, d) => n + d.del, 0)
  body.innerHTML =
    texts.map((x) => `<div class="md">${markdown(x.text)}</div>`).join('') +
    (diffs.length ? `<h4 class="changes">改了 ${diffs.length} 个文件 <span class="muted">+${add} −${del}</span></h4>${diffs.map(diffHtml).join('')}` : '')
  // Streamed writing follows the chalk; otherwise keep the reader's place (a new entry starts at the top).
  body.scrollTop = same ? (e.live && nearEnd ? body.scrollHeight : top) : 0
  shownId = e.id
  $('#title').textContent = e.title || '黑板'
  $('#count').textContent = s.total > 1 ? `${s.index + 1}/${s.total}` : ''
  $('#prev').disabled = s.index <= 0
  $('#next').disabled = s.index >= s.total - 1
  $('#prev').hidden = $('#next').hidden = s.total < 2
  $('#pin').setAttribute('aria-pressed', String(!!s.pinned))
  $('#hint').textContent = e.live ? '✍️ 正在写…' : s.pinned ? '已钉住' : ''
}

pet.on('board:state', render)
$('#prev').addEventListener('click', () => pet.send('board:nav', -1))
$('#next').addEventListener('click', () => pet.send('board:nav', 1))
$('#close').addEventListener('click', () => pet.send('board:close'))
$('#pin').addEventListener('click', () => pet.send('board:pin', !(state && state.pinned)))
$('#copy').addEventListener('click', async () => {
  await pet.invoke('board:copy')
  $('#copy').textContent = '已复制'
  setTimeout(() => ($('#copy').textContent = '复制'), 1500)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') pet.send('board:close')
})
// Looking at it keeps it out: report attention at most once a second.
let lastPing = 0
for (const ev of ['mousemove', 'wheel', 'keydown', 'mousedown']) {
  window.addEventListener(
    ev,
    () => {
      if (Date.now() - lastPing < 1000) return
      lastPing = Date.now()
      pet.send('board:active')
    },
    { passive: true },
  )
}

;(async () => {
  const s = await pet.invoke('board:init')
  if (!s) return
  render({ ...s, visible: false })
  requestAnimationFrame(() => requestAnimationFrame(() => render(s))) // slide in
})()
