'use strict'
/* global pet */
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
let snap = null
let renderedChatCount = -1

// ------------------------------------------------------------ helpers

const pad = (n) => String(n).padStart(2, '0')
function fmt(ts, withDate = true) {
  if (!ts) return ''
  const d = new Date(ts)
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (!withDate) return t
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return T(`今天 ${t}`, `Today ${t}`)
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${t}`
}
function toLocalInput(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v) {
  return v ? v.replace('T', ' ') : null
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
function formatText(raw) {
  return String(raw)
    .split(/```[\w-]*\n?([\s\S]*?)(?:```|$)/g)
    .map((p, i) => (i % 2 ? `<pre>${escapeHtml(p.replace(/\n$/, ''))}</pre>` : escapeHtml(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')))
    .join('')
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (k === 'html') e.innerHTML = v
    else e.setAttribute(k, v)
  }
  for (const c of children) if (c != null) e.append(c)
  return e
}

// ------------------------------------------------------------ tabs

function showTab(name) {
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name))
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name))
  if (name === 'chat') setTimeout(() => $('#chat-input').focus(), 30)
  if (name === 'stocks') refreshStocks(true)
}
$$('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)))
pet.on('panel:tab', showTab)

// ------------------------------------------------------------ render

function renderChat() {
  const msgs = snap.chat.messages
  const box = $('#messages')
  if (msgs.length === renderedChatCount) return
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  box.innerHTML = ''
  if (!msgs.length) box.append(el('div', { class: 'empty' }, T('还没有聊天记录～在下面说点什么吧', 'No messages yet — say something below')))
  for (const m of msgs) {
    box.append(el('div', { class: 'msg ' + m.role, html: formatText(m.text) + `<time>${fmt(m.ts)}</time>` }))
  }
  if (atBottom || renderedChatCount < 0) box.scrollTop = box.scrollHeight
  renderedChatCount = msgs.length
}

function renderTodos() {
  const list = $('#todo-list')
  list.innerHTML = ''
  const todos = [...snap.todos].sort((a, b) => a.done - b.done || (a.due || 9e15) - (b.due || 9e15))
  if (!todos.length) list.append(el('li', { class: 'empty' }, T('没有待办，轻松一下～', 'No to-dos. Relax a little~')))
  for (const t of todos) {
    const late = !t.done && t.due && t.due < Date.now()
    list.append(
      el(
        'li',
        { class: t.done ? 'done' : '' },
        el('input', { type: 'checkbox', ...(t.done ? { checked: '' } : {}), onchange: (e) => pet.invoke('todo:update', { id: t.id, patch: { done: e.target.checked, doneAt: Date.now() } }) }),
        el('span', { class: 'txt' }, t.text),
        t.due ? el('span', { class: 'due' + (late ? ' late' : '') }, fmt(t.due)) : null,
        el('button', { title: T('删除', 'Delete'), onclick: () => pet.invoke('todo:remove', t.id) }, '✕'),
      ),
    )
  }
  const rl = $('#rem-list')
  rl.innerHTML = ''
  const rems = snap.reminders.filter((r) => !r.fired).sort((a, b) => a.at - b.at)
  if (!rems.length) rl.append(el('li', { class: 'empty' }, T('没有提醒', 'No reminders')))
  for (const r of rems) {
    rl.append(el('li', {}, el('span', { class: 'txt' }, r.text), el('span', { class: 'due' }, fmt(r.at) + (r.repeat ? T(' · 每天', ' · daily') : '')), el('button', { onclick: () => pet.invoke('reminder:remove', r.id) }, '✕')))
  }
  const p = snap.pomodoro
  $('#pomo-state').textContent = p ? T(`${p.phase === 'focus' ? '专注中' : '休息中'}，${fmt(p.endsAt, false)} 结束`, `${p.phase === 'focus' ? 'Focusing' : 'On a break'}, ends ${fmt(p.endsAt, false)}`) : ''
}

function renderTasks() {
  const list = $('#task-list')
  list.innerHTML = ''
  if (!snap.tasks.length) list.append(el('li', { class: 'empty' }, T('还没有后台任务', 'No background tasks yet')))
  for (const t of snap.tasks) {
    const label = T({ running: '进行中', done: '完成', error: '失败' }, { running: 'Running', done: 'Done', error: 'Failed' })[t.status] || t.status
    list.append(
      el(
        'li',
        {},
        el(
          'div',
          { class: 'head' },
          el('span', { class: 'badge ' + t.status }, label),
          el('b', { class: 'grow' }, t.title),
          el('span', { class: 'muted' }, fmt(t.startedAt)),
          t.status === 'running' ? el('button', { onclick: () => pet.invoke('task:cancel', t.id) }, T('取消', 'Cancel')) : el('button', { onclick: () => pet.invoke('task:remove', t.id) }, T('删除', 'Delete')),
        ),
        t.activity ? el('div', { class: 'muted' }, t.activity) : null,
        t.result ? el('div', { class: 'result', html: formatText(t.result) }) : null,
      ),
    )
  }
}

const EVERY_LABEL = { hourly: T('每小时', 'Hourly'), '3h': T('每 3 小时', 'Every 3 hours'), daily: T('每天', 'Daily') }

function goalStatus(g) {
  if (g.running) return ['running', T('跟进中…', 'Working…')]
  if (g.status === 'done') return ['done', T('完成', 'Done')]
  if (g.status === 'paused') return ['paused', T('暂停', 'Paused')]
  if (g.question) return ['ask', T('等你拍板', 'Needs your call')]
  return ['active', T('进行中', 'Active')]
}

function renderGoals() {
  const list = $('#goal-list')
  // Don't wipe an answer the user is typing.
  if (list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return
  list.innerHTML = ''
  const goals = snap.goals || []
  if (!goals.length) list.append(el('li', { class: 'empty' }, T('还没有目标～交给她一件需要长期跟进的事吧', 'No goals yet — hand her something that needs following up over time')))
  for (const g of [...goals].reverse()) {
    const [cls, label] = goalStatus(g)
    const sched = g.every === 'daily' ? T(`每天 ${g.at || '09:00'}`, `Daily ${g.at || '09:00'}`) : EVERY_LABEL[g.every] || ''
    const busy = g.running || snap.goalBusy
    list.append(
      el(
        'li',
        {},
        el('div', { class: 'head' }, el('span', { class: 'badge ' + cls }, label), el('b', { class: 'grow' }, g.title), el('span', { class: 'muted' }, sched)),
        g.detail ? el('div', { class: 'muted' }, g.detail) : null,
        g.running && g.activity ? el('div', { class: 'muted' }, g.activity) : null,
        g.question
          ? el(
              'div',
              { class: 'question' },
              el('div', {}, '❓ ' + g.question.text),
              el(
                'div',
                { class: 'row' },
                ...(g.question.options || []).map((o) => el('button', { class: 'primary', onclick: () => pet.invoke('goal:answer', { id: g.id, answer: o }) }, o)),
                el('button', { onclick: () => pet.invoke('goal:answer', { id: g.id, answer: '__auto' }) }, T('你决定吧', 'You decide')),
              ),
              el(
                'form',
                {
                  class: 'row',
                  onsubmit: (e) => {
                    e.preventDefault()
                    const v = e.target.querySelector('input').value.trim()
                    if (v) pet.invoke('goal:answer', { id: g.id, answer: v })
                  },
                },
                el('input', { placeholder: T('或者直接写下你的想法…', 'Or just write what you think…'), maxlength: '300' }),
                el('button', { class: 'primary' }, T('回答', 'Answer')),
              ),
            )
          : null,
        g.log && g.log.length
          ? el('div', { class: 'result' }, ...g.log.slice(-4).reverse().map((l) => el('div', { class: 'log' }, el('time', {}, fmt(l.ts)), ' ', l.text)))
          : null,
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'muted grow' }, g.status === 'active' && g.nextAt && !g.running ? T(`下次跟进：${fmt(g.nextAt)}`, `Next follow-up: ${fmt(g.nextAt)}`) : ''),
          el('button', { onclick: () => pet.invoke('goal:run', g.id), ...(busy ? { disabled: '' } : {}) }, T('立即跟进', 'Follow up now')),
          g.status === 'active'
            ? el('button', { onclick: () => pet.invoke('goal:update', { id: g.id, patch: { status: 'paused' } }) }, T('暂停', 'Pause'))
            : el('button', { onclick: () => pet.invoke('goal:update', { id: g.id, patch: { status: 'active' } }) }, g.status === 'done' ? T('重新开始', 'Restart') : T('继续', 'Resume')),
          g.status !== 'done' ? el('button', { onclick: () => pet.invoke('goal:update', { id: g.id, patch: { status: 'done' } }) }, T('完成', 'Done')) : null,
          el('button', { onclick: () => pet.invoke('goal:remove', g.id) }, T('删除', 'Delete')),
        ),
      ),
    )
  }
}

function renderActivity() {
  const list = $('#act-list')
  list.innerHTML = ''
  const acts = snap.activity || []
  if (!acts.length) list.append(el('li', { class: 'empty' }, T('她还没有自己做过什么～', "She hasn't done anything on her own yet~")))
  for (const a of acts.slice(0, 80)) list.append(el('li', {}, el('span', { class: 'icon' }, a.icon || '•'), el('span', { class: 'txt' }, a.text), el('span', { class: 'due' }, fmt(a.ts))))
  const ml = $('#mem-list')
  ml.innerHTML = ''
  const mems = snap.memories || []
  if (!mems.length) ml.append(el('li', { class: 'empty' }, T('还没有记住什么', 'Nothing remembered yet')))
  const KIND = T({ preference: '偏好', habit: '习惯', fact: '事实', project: '项目', person: '人' }, { preference: 'Preference', habit: 'Habit', fact: 'Fact', project: 'Project', person: 'Person' })
  for (const m of [...mems].sort((a, b) => (b.weight || 3) - (a.weight || 3) || b.ts - a.ts)) {
    ml.append(
      el(
        'li',
        {},
        el('span', { class: 'txt' }, `${'★'.repeat(m.weight || 3)} ${m.text}`),
        el('span', { class: 'due' }, `${KIND[m.kind] || ''}${m.source === 'user' ? T(' · 你写的', ' · by you') : m.source === 'reflect' ? T(' · 整理', ' · tidied') : ''}`),
        el('button', { title: T('让她忘掉', 'Make her forget'), onclick: () => pet.invoke('memory:remove', m.id) }, '✕'),
      ),
    )
  }
}

function renderGrowth() {
  const g = snap.growth
  if (!g) return
  const span = Math.max(1, g.levelNext - g.levelStart)
  $('#lvl-name').textContent = `Lv.${g.level}`
  $('#lvl-bar').style.width = Math.min(100, Math.round(((g.xp - g.levelStart) / span) * 100)) + '%'
  $('#lvl-xp').textContent = `${g.xp} / ${g.levelNext} XP`
  const ul = $('#unlock-list')
  ul.innerHTML = ''
  for (const u of g.unlocks) ul.append(el('li', { class: u.open ? 'open' : '' }, `${u.open ? '✓' : '🔒'} Lv.${u.level} ${u.label}`))
  const sl = $('#stat-list')
  sl.innerHTML = ''
  if (!g.stats.length) sl.append(el('li', { class: 'empty' }, T('还在观察你喜欢哪种帮忙～', 'Still learning which kind of help you like~')))
  for (const s of g.stats) {
    const trend = s.factor >= 1.2 ? T('↑ 会更常这样做', '↑ More often') : s.factor <= 0.7 ? T('↓ 以后少打扰', '↓ Less often') : T('→ 保持', '→ Same')
    sl.append(el('li', {}, el('span', { class: 'txt' }, s.label), el('span', { class: 'due' }, T(`接受 ${s.accepted} · 拒绝 ${s.declined} · 没理 ${s.ignored}`, `accepted ${s.accepted} · declined ${s.declined} · ignored ${s.ignored}`)), el('span', { class: 'trend' }, trend)))
  }
  const nl = $('#note-list')
  nl.innerHTML = ''
  if (!g.notes.length) nl.append(el('li', { class: 'empty' }, T('整理过记忆后，她会在这里写下学到的东西', "After tidying her memories she'll write what she learned here")))
  for (const n of g.notes) nl.append(el('li', {}, el('span', { class: 'txt' }, '🌱 ' + n)))
  const dl = $('#diary-list')
  dl.innerHTML = ''
  if (!g.diary.length) dl.append(el('li', { class: 'empty' }, T('还没有日记', 'No diary yet')))
  for (const d of g.diary) dl.append(el('li', {}, el('b', {}, d.date), el('span', { class: 'txt' }, d.text)))
  const ll = $('#learn-list')
  ll.innerHTML = ''
  for (const l of g.learned) ll.append(el('li', { class: 'open' }, '💡 ' + l.topic))
  $('#reflect-state').textContent = snap.agendaRunning ? T(`正在：${({ reflect: '整理记忆', brief: '准备简报', pulse: '巡检工作区', tip: '学习' })[snap.agendaRunning] || snap.agendaRunning}…`, `Now: ${({ reflect: 'tidying memories', brief: 'preparing the brief', pulse: 'checking the workspace', tip: 'learning' })[snap.agendaRunning] || snap.agendaRunning}…`) : g.lastReflectAt ? T(`上次整理：${fmt(g.lastReflectAt)}`, `Last tidied: ${fmt(g.lastReflectAt)}`) : T('还没整理过', 'Not tidied yet')
  $('#reflect-now').disabled = !!snap.agendaRunning
}

function renderScreenCapabilities() {
  const caps = snap.screenCapabilities
  const summary = $('#screen-capability-summary')
  const reason = $('#screen-capability-reason')
  if (!caps) {
    summary.textContent = T('正在检测屏幕能力…', 'Checking screen capabilities…')
    reason.hidden = true
    return
  }
  const platform = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[caps.platform] || caps.platform || T('当前系统', 'this system')
  const session = ['aqua', 'win32'].includes(caps.session) ? '' : { x11: 'X11', wayland: 'Wayland', headless: T('无图形会话', 'no graphical session') }[caps.session] || caps.session
  const state = (value) => value === true ? T('可用', ' available') : value === false ? T('不可用', ' unavailable') : T('检测中', ' checking')
  const capture = caps.platform === 'darwin' && caps.manualCapture && caps.screenCapture === false
    ? T('手动截图需授权', 'Manual capture needs permission')
    : T(`${caps.session === 'wayland' ? '手动选屏' : '手动截图'}${state(caps.manualCapture)}`, `${caps.session === 'wayland' ? 'Manual screen pick' : 'Manual capture'}${state(caps.manualCapture)}`)
  summary.textContent = [platform, session, capture, T(`前台窗口${state(caps.foreground)}`, `Foreground window${state(caps.foreground)}`), T(`窗口停靠${state(caps.windows)}`, `Window perching${state(caps.windows)}`), T(`OCR ${state(caps.ocr)}`, `OCR${state(caps.ocr)}`)].filter(Boolean).join(' · ')
  const reasons = [...new Set([caps.reason, caps.ocrReason].filter(Boolean))]
  reason.textContent = reasons.join(T('；', '; '))
  reason.hidden = !reasons.length
  for (const control of $$('[data-requires]')) {
    control.disabled = caps[control.dataset.requires] === false
    control.title = control.disabled ? reasons.join(T('；', '; ')) || T({ windows: '需要窗口检测能力', foreground: '需要前台窗口检测能力', manualCapture: '需要可用的图形桌面和截图能力' }, { windows: 'Needs window detection', foreground: 'Needs foreground-window detection', manualCapture: 'Needs a graphical desktop and screen capture' })[control.dataset.requires] : ''
  }
  if ($('#prank-select').selectedOptions[0].disabled) $('#prank-select').value = ''
  $('#screen-permission').hidden = !(caps.platform === 'darwin' && caps.screenCapture === false)
}

function renderSettings() {
  const s = snap.settings
  for (const input of $$('[data-key]')) {
    if (document.activeElement === input) continue
    const v = s[input.dataset.key]
    if (input.type === 'checkbox') input.checked = !!v
    else input.value = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)
  }
  for (const sel of $$('[data-rule]')) {
    if (document.activeElement !== sel) sel.value = (s.rules || {})[sel.dataset.rule] || sel.options[0].value
  }
  for (const ta of $$('[data-list]')) {
    if (document.activeElement !== ta) ta.value = (s[ta.dataset.list] || []).join('\n')
  }
  const paused = snap.screenPausedUntil > Date.now()
  $('#screen-pause').textContent = paused ? T('恢复看屏幕', 'Resume screen looks') : T('1 小时内别看', "Don't look for 1 hour")
  $('#screen-state').textContent = paused ? T(`暂停到 ${fmt(snap.screenPausedUntil, false)}`, `Paused until ${fmt(snap.screenPausedUntil, false)}`) : ''
  $('#scale-val').textContent = `×${s.scale}`
  $('#backend-status').textContent = snap.backendFound
    ? T(`已找到 ${snap.backendName || 'Claude Code'}：${snap.backendPath}`, `Found ${snap.backendName || 'Claude Code'}: ${snap.backendPath}`)
    : T('未找到 Claude Code。安装后在终端运行 claude 登录，或选择 claude 的路径。', 'Claude Code not found. Install it and run claude in a terminal to log in, or choose the path to claude.')
  renderScreenCapabilities()
}

function render() {
  if (!snap) return
  $('#status').textContent = snap.busy ? T('正在思考…', 'Thinking…') : snap.backendFound === false ? T('未找到内核', 'Core not found') : T('待命', 'Ready')
  $('#status').classList.toggle('busy', snap.busy)
  const MOOD = ['😢', '😟', '😐', '🙂', '😊', '😄', '🥰']
  $('#mood').textContent = `${MOOD[Math.max(0, Math.min(6, (snap.mood || 0) + 3))]} ❤ ${snap.affection || 0}`
  renderChat()
  renderTodos()
  renderGoals()
  renderTasks()
  renderActivity()
  renderGrowth()
  $('#weather-state').textContent = snap.weather ? T(`现在：${snap.weather}`, `Now: ${snap.weather}`) : snap.settings.weatherCity ? T('还没拿到天气（检查城市名或网络）', 'No weather yet (check the city name or network)') : ''
  const u = snap.update || {}
  $('#update-state').textContent =
    T(`当前版本 v${snap.version || '?'}`, `Version v${snap.version || '?'}`) +
    (u.available ? T(` · 🎁 新版本 v${u.available} 可以下载`, ` · 🎁 v${u.available} available to download`) : u.checkedAt ? (u.error ? T(` · 上次检查失败（${u.error}）`, ` · last check failed (${u.error})`) : T(` · 已是最新（${fmt(u.checkedAt)} 检查）`, ` · up to date (checked ${fmt(u.checkedAt)})`)) : '')
  renderSettings()
  refreshStocks()
  $('#note-post').textContent = snap.noteOpen ? T('📌 便签已贴出', '📌 Note is up') : T('📌 贴到桌面', '📌 Put on desktop')
}

pet.on('state', (s) => {
  snap = s
  render()
})

// ------------------------------------------------------------ actions

function sendChat() {
  const t = $('#chat-input').value.trim()
  if (!t) return
  $('#chat-input').value = ''
  pet.invoke('chat:send', t)
}
$('#chat-send').addEventListener('click', sendChat)
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    sendChat()
  }
})
$('#chat-cancel').addEventListener('click', () => pet.invoke('chat:cancel'))
$('#chat-new').addEventListener('click', () => {
  renderedChatCount = -1
  pet.invoke('chat:new')
})

$('#todo-form').addEventListener('submit', (e) => {
  e.preventDefault()
  pet.invoke('todo:add', { text: $('#todo-text').value.trim(), due: fromLocalInput($('#todo-due').value) })
  $('#todo-text').value = ''
  $('#todo-due').value = ''
})
$('#todo-clear').addEventListener('click', () => pet.invoke('todo:clear-done'))
$('#plan-today').addEventListener('click', () => {
  pet.invoke('plan:today')
  showTab('chat')
})
$('#rem-form').addEventListener('submit', (e) => {
  e.preventDefault()
  pet.invoke('reminder:add', { text: $('#rem-text').value.trim(), at: fromLocalInput($('#rem-at').value), repeat: $('#rem-daily').checked ? 'daily' : null })
  $('#rem-text').value = ''
})
$('#rem-at').value = toLocalInput(Date.now() + 30 * 60000)
$('#pomo-25').addEventListener('click', () => pet.invoke('pomodoro:start', 25))
$('#pomo-50').addEventListener('click', () => pet.invoke('pomodoro:start', 50))
$('#pomo-stop').addEventListener('click', () => pet.invoke('pomodoro:stop'))

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const prompt = $('#task-text').value.trim()
  if (!prompt) return
  pet.invoke('task:start', { prompt })
  $('#task-text').value = ''
})

for (const input of $$('[data-key]')) {
  const ev = input.type === 'range' || input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'change'
  input.addEventListener(ev, () => {
    const key = input.dataset.key
    let v = input.type === 'checkbox' ? input.checked : input.value
    if (['scale'].includes(key)) v = Number(v)
    if (['mischief', 'waterMinutes', 'llmRemarkMinutes', 'nagMinutes', 'agendaPerDay', 'stockDropPct', 'boardHideSeconds'].includes(key)) v = Math.max(0, Number(v) || 0)
    pet.invoke('settings:set', { [key]: v })
  })
}
for (const sel of $$('[data-rule]')) {
  sel.addEventListener('change', () => pet.invoke('settings:set', { rules: { [sel.dataset.rule]: sel.value } }))
}
for (const ta of $$('[data-list]')) {
  ta.addEventListener('change', () => pet.invoke('settings:set', { [ta.dataset.list]: ta.value }))
}
$('#tidy-now').addEventListener('click', () => pet.invoke('tidy:now'))
$('#note-post').addEventListener('click', () => pet.invoke('note:post'))
$('#act-clear').addEventListener('click', () => pet.invoke('activity:clear'))
$('#reflect-now').addEventListener('click', () => pet.invoke('growth:reflect'))
$('#weather-refresh').addEventListener('click', () => pet.invoke('weather:refresh'))
$('#update-check').addEventListener('click', async (e) => {
  e.target.disabled = true
  try {
    await pet.invoke('update:check')
  } finally {
    e.target.disabled = false
  }
})
$('#mem-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = $('#mem-text')
  const t = input.value.trim()
  if (!t) return
  const m = await pet.invoke('memory:add', t)
  if (m) input.value = ''
  else {
    // Keep the text so it can be shortened; say why it was not saved.
    input.setCustomValidity(T('没记住：一条最多 200 字，或者她已经记得这件事了', "Not saved: at most 200 characters each, or she already remembers it"))
    input.reportValidity()
    setTimeout(() => input.setCustomValidity(''), 2500)
  }
})
$('#goal-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const title = $('#goal-title').value.trim()
  if (!title) return
  pet.invoke('goal:add', { title, detail: $('#goal-detail').value.trim(), every: $('#goal-every').value, at: $('#goal-at').value })
  $('#goal-title').value = ''
  $('#goal-detail').value = ''
})
$('#goal-every').addEventListener('change', () => {
  $('#goal-at').style.display = $('#goal-every').value === 'daily' ? '' : 'none'
})
$('#pick-cwd').addEventListener('click', async () => {
  const d = await pet.invoke('pick:dir')
  if (d) pet.invoke('settings:set', { cwd: d })
})
$('#pick-claude').addEventListener('click', async () => {
  const f = await pet.invoke('pick:claude')
  if (f) pet.invoke('settings:set', { claudeExe: f })
})
$('#prank-run').addEventListener('click', () => {
  const v = $('#prank-select').value
  if (v === 'climb') pet.invoke('climb:now')
  else pet.invoke('prank', v || undefined)
})
$('#look-now').addEventListener('click', () => pet.invoke('look:now'))
$('#screen-permission').addEventListener('click', () => pet.invoke('screen:permission'))
$('#screen-refresh').addEventListener('click', async () => {
  const button = $('#screen-refresh')
  button.disabled = true
  button.textContent = T('检测中…', 'Checking…')
  try {
    const capabilities = await pet.invoke('screen:refresh')
    if (capabilities && snap) {
      snap.screenCapabilities = capabilities
      renderScreenCapabilities()
    }
  } catch (e) {
    $('#screen-capability-reason').textContent = T(`重新检测失败：${e.message || e}`, `Re-check failed: ${e.message || e}`)
    $('#screen-capability-reason').hidden = false
  } finally {
    button.disabled = false
    button.textContent = T('重新检测', 'Re-check')
  }
})
$('#screen-pause').addEventListener('click', () => pet.invoke('screen:pause', snap && snap.screenPausedUntil > Date.now() ? 0 : 60))

// ------------------------------------------------------------ US stocks

const YEAR_MS = 365.25 * 86400e3
const RANGE_DAYS = { '1m': 30, '6m': 182, '1y': 365, '5y': 5 * 366 }
let stockData = null
let stockVersion = -1
let stockLoading = false
let stockSel = null
let stockSeries = null
let stockRange = '1y'

const signed = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(d) + '%'
const money = (v) => '$' + (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2))
const dir = (v) => (v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : '')
const arrow = (v) => (v > 0.0005 ? '▲' : v < -0.0005 ? '▼' : '—')
const NS = 'http://www.w3.org/2000/svg'
function svg(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}
function svgText(attrs, text) {
  const t = svg('text', attrs)
  t.textContent = text
  return t
}

function sparkline(values, w = 76, h = 26) {
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, 'aria-hidden': 'true' })
  if (!values || values.length < 2) return s
  const lo = Math.min(...values)
  const span = Math.max(...values) - lo || 1
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (w - 6), h - 3 - ((v - lo) / span) * (h - 6)])
  s.append(svg('polyline', { points: pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: 'var(--s-price)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
  const [x, y] = pts[pts.length - 1]
  s.append(svg('circle', { cx: x, cy: y, r: 2.5, fill: 'var(--s-price)' }))
  return s
}

function trendTag(t) {
  if (t.label === 'unknown') return T('历史不足 2 年', 'Under 2 years of history')
  return T(`${{ strong: '长期强势上涨', up: '长期上涨', flat: '长期横盘', down: '长期下跌' }[t.label]} ${signed(t.annual, 0)}/年`, `${{ strong: 'Strong long-term uptrend', up: 'Long-term uptrend', flat: 'Flat long-term', down: 'Long-term downtrend' }[t.label]} ${signed(t.annual, 0)}/yr`)
}

function stockRow(item) {
  const pick = () => selectStock(item.symbol)
  const li = el('li', { tabindex: '0', role: 'button', 'data-sym': item.symbol, 'aria-label': `${item.symbol} ${item.name}`, onclick: pick, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()) })
  if (item.symbol === stockSel) li.classList.add('sel')
  const tags = el('div', { class: 'tags' }, el('span', { class: 'tag' }, trendTag(item.trend)))
  if (item.rapid) tags.append(el('span', { class: 'tag' + (item.dip ? ' hot' : '') }, T(`▼ 比 1 个月高点 ${signed(item.dd1m)}`, `▼ ${signed(item.dd1m)} vs 1M high`)))
  if (item.watched) tags.append(el('span', { class: 'tag' }, T('自选', 'Mine')))
  if (item.stale) tags.append(el('span', { class: 'tag' }, T('旧数据', 'Stale')))
  const left = el('div', { class: 'sym' }, el('b', {}, item.symbol), el('span', { class: 'nm' }, item.name), tags)
  const m1 = item.windows.m1
  const right = el('div', { class: 'q' }, el('b', {}, money(item.price)), m1 ? el('small', { class: dir(m1.change) }, T(`1 个月 ${arrow(m1.change)} ${signed(m1.change)}`, `1M ${arrow(m1.change)} ${signed(m1.change)}`)) : null)
  li.append(left, sparkline(item.spark), right)
  return li
}

function renderStockStatus() {
  const st = snap.stocks
  if (!st) return
  const s = snap.settings
  $('#tab-stocks').classList.toggle('green-up', s.stockColors === 'green-up')
  const auto = s.stockAuto === false ? T('自动查看已关闭', 'Auto checks off') : st.next ? T(`下次 ${fmt(st.next.at)}（美东 ${st.next.et}）`, `Next ${fmt(st.next.at)} (ET ${st.next.et})`) : ''
  $('#stock-status').textContent = st.scanning
    ? T(`正在看第 ${st.done}/${st.total} 只…`, `Checking ${st.done}/${st.total}…`)
    : [st.scannedAt ? T(`上次 ${fmt(st.scannedAt)}，${st.count} 只里 ${st.dips} 只长期上涨又急跌`, `Last ${fmt(st.scannedAt)}: ${st.dips} of ${st.count} are long-term risers with a sharp drop`) : T('还没看过', 'Not checked yet'), auto].filter(Boolean).join(' · ')
  $('#stock-scan').disabled = st.scanning
  $('#stock-scan').textContent = st.scanning ? T('查看中…', 'Checking…') : T('立即查看', 'Check now')
  const local = (st.localAt || []).filter(Boolean).map((t) => fmt(t, false))
  $('#stock-local-times').textContent = local.length ? T(`换算成你这里的时间：${local.join('、')}（美东夏令时切换时会变）。只在美股交易日（周一到周五）查看。`, `In your time: ${local.join(', ')} (shifts when US daylight saving changes). Only on US trading days (Mon–Fri).`) : ''
}

async function refreshStocks(force = false) {
  if (!snap || !snap.stocks) return
  renderStockStatus()
  if (!$('#tab-stocks').classList.contains('active') || stockLoading) return
  if (!force && snap.stocks.version === stockVersion) return
  stockLoading = true
  try {
    stockVersion = snap.stocks.version
    stockData = await pet.invoke('stock:view')
    renderStockLists()
    const items = (stockData && stockData.items) || []
    if (stockSel && items.some((x) => x.symbol === stockSel)) await selectStock(stockSel, { quiet: true })
    else if (!stockSel && items.length) await selectStock((items.find((x) => x.dip) || items[0]).symbol, { quiet: true })
  } finally {
    stockLoading = false
  }
}

function renderStockLists() {
  const items = (stockData && stockData.items) || []
  const drop = Number(snap.settings.stockDropPct) || 10
  $('#stock-dip-note').textContent = T(`近 5 年年化 ≥7% 且走势稳定，最近比 1 个月高点跌 ≥${drop}%（或 5 天跌 ≥${Math.round(drop * 0.7)}%）`, `≥ 7% a year over 5 years with a steady trend, now ≥ ${drop}% below the 1-month high (or ≥ ${Math.round(drop * 0.7)}% down in 5 days)`)
  const dips = items.filter((x) => x.dip)
  $('#stock-dips').replaceChildren(...(dips.length ? dips.map(stockRow) : [el('li', { class: 'empty' }, items.length ? T('现在没有长期上涨又最近急跌的。', 'No long-term risers with a sharp recent drop right now.') : T('还没有数据，点「立即查看」。', 'No data yet. Click "Check now".'))]))
  const q = $('#stock-filter').value.trim().toUpperCase()
  const shown = items.filter((x) => !q || x.symbol.includes(q) || String(x.name).toUpperCase().includes(q))
  $('#stock-all').replaceChildren(...shown.map(stockRow))
  const errors = (stockData && stockData.errors) || []
  const invalid = (stockData && stockData.invalid) || []
  $('#stock-errors').textContent = [
    invalid.length ? T(`这些不是有效的美股代码：${invalid.join('、')}`, `These aren't valid US tickers: ${invalid.join(', ')}`) : '',
    errors.length ? T(`跳过了 ${errors.length} 只：${errors.slice(0, 8).map((e) => `${e.symbol}（${e.error}）`).join('；')}${errors.length > 8 ? '…' : ''}`, `Skipped ${errors.length}: ${errors.slice(0, 8).map((e) => `${e.symbol} (${e.error})`).join('; ')}${errors.length > 8 ? '…' : ''}`) : '',
  ].filter(Boolean).join('\n')
}

async function selectStock(symbol, { quiet = false } = {}) {
  const item = stockData && stockData.items.find((x) => x.symbol === symbol)
  if (!item) return
  stockSel = symbol
  stockSeries = await pet.invoke('stock:series', symbol)
  $('#stock-detail').hidden = false
  $('#sd-symbol').textContent = item.symbol
  $('#sd-name').textContent = `${item.name} · ${item.exchange}`
  $('#sd-price').textContent = money(item.price)
  const tags = [el('span', { class: 'tag' }, trendTag(item.trend))]
  if (item.rapid) tags.push(el('span', { class: 'tag' + (item.dip ? ' hot' : '') }, T(`▼ 比 1 个月高点 ${signed(item.dd1m)}`, `▼ ${signed(item.dd1m)} vs 1M high`)))
  if (item.level) tags.push(el('span', { class: 'tag' }, T(`价位：${item.level}`, `Level: ${item.level.replace(/^a /, '')}`)))
  tags.push(el('span', { class: 'muted' }, T(` 截至 ${fmt(item.at)}`, ` as of ${fmt(item.at)}`)))
  $('#sd-tags').replaceChildren(...tags)
  $('#sd-trend').textContent = item.text.trend
  $('#sd-drop').textContent = item.text.drop
  $('#sd-level').textContent = item.text.level
  renderCompare(item)
  renderStockChart()
  for (const li of $$('.stocks li[data-sym]')) li.classList.toggle('sel', li.dataset.sym === symbol)
  if (!quiet) $('#tab-stocks').scrollTo({ top: 0, behavior: 'smooth' })
}

function rangeBar(w) {
  const span = w.high - w.low || 1
  const bar = el('div', { class: 'rbar', role: 'img', 'aria-label': T(`区间 ${money(w.low)} 到 ${money(w.high)}，均价 ${money(w.avg)}，现价在 ${Math.round(w.pos * 100)}% 位置`, `Range ${money(w.low)} to ${money(w.high)}, average ${money(w.avg)}, price at ${Math.round(w.pos * 100)}%`) })
  bar.append(el('i', { class: 'avg', style: `left:${(((w.avg - w.low) / span) * 100).toFixed(1)}%` }), el('i', { class: 'now', style: `left:${(w.pos * 100).toFixed(1)}%` }))
  return bar
}

function renderCompare(item) {
  const rows = item.text.compare.map((c) => {
    const w = item.windows[c.key]
    const row = el('div', { class: 'cmp' }, el('span', {}, c.label))
    if (w) row.append(el('b', { class: dir(w.change) }, `${arrow(w.change)} ${signed(w.change)}`), rangeBar(w))
    row.append(el('p', {}, c.text))
    return row
  })
  $('#sd-compare').replaceChildren(...rows)
}

function niceTicks(lo, hi, n = 4) {
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw)
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(6)))
  return out
}
const tickLabel = (v) => (v >= 10000 ? `$${(v / 1000).toFixed(0)}K` : v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Number.isInteger(v) ? v : v.toFixed(v < 10 ? 2 : 1)}`)
const ymd = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dateTicks(t0, t1, range) {
  const out = []
  if (range === '1m') {
    const d = new Date(t0)
    d.setHours(12, 0, 0, 0)
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1) // Mondays
    for (; d.getTime() <= t1; d.setDate(d.getDate() + 7)) out.push({ t: d.getTime(), label: `${d.getMonth() + 1}/${d.getDate()}` })
  } else if (range === '5y') {
    for (let y = new Date(t0).getFullYear() + 1; new Date(y, 0, 1).getTime() <= t1; y++) out.push({ t: new Date(y, 0, 1).getTime(), label: String(y) })
  } else {
    const every = range === '1y' ? 2 : 1
    const d = new Date(t0)
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    for (let k = 0; d.getTime() <= t1; d.setMonth(d.getMonth() + 1), k++) {
      if (k % every) continue
      out.push({ t: d.getTime(), label: d.getMonth() === 0 ? String(d.getFullYear()) : T(`${d.getMonth() + 1}月`, d.toLocaleString('en', { month: 'short' })) })
    }
  }
  return out
}

function renderStockChart() {
  const box = $('#sd-chart')
  for (const b of $$('.seg button')) b.classList.toggle('on', b.dataset.range === stockRange)
  if (!stockSeries || !stockSeries.points || stockSeries.points.length < 2) {
    box.replaceChildren(el('p', { class: 'empty' }, T('没有价格数据', 'No price data')))
    $('#sd-legend').replaceChildren()
    return
  }
  const all = stockSeries.points.map(([t, c]) => ({ t: t * 1000, c }))
  // 200-day average over the whole history, then cut to the chosen range.
  const ma = []
  let sum = 0
  for (let i = 0; i < all.length; i++) {
    sum += all[i].c
    if (i >= 200) sum -= all[i - 200].c
    ma.push(i >= 199 ? sum / 200 : null)
  }
  const fit = stockSeries.fit
  const lastT = all[all.length - 1].t
  const cut = lastT - RANGE_DAYS[stockRange] * 86400e3
  let i0 = all.findIndex((p) => p.t >= cut)
  if (i0 < 0) i0 = 0
  const pts = all.slice(i0).map((p, k) => ({ ...p, ma: ma[i0 + k], tr: fit && p.t >= fit.t0 ? Math.exp(fit.a + (fit.b * (p.t - fit.t0)) / YEAR_MS) : null }))
  const series = [
    { key: 'c', name: T('收盘价', 'Close'), end: '', color: 'var(--s-price)' },
    { key: 'ma', name: T('200 日均线', '200-day avg'), end: T('200 日均线', '200-day avg'), color: 'var(--s-ma)' },
    { key: 'tr', name: T('5 年趋势线', '5-year trend'), end: T('趋势线', 'Trend'), color: 'var(--s-trend)' },
  ].filter((se) => pts.some((p) => p[se.key] != null))

  const W = Math.max(280, box.clientWidth || 430)
  const H = 214, L = 46, R = 70, TOP = 12, B = 24
  const vals = pts.flatMap((p) => series.map((se) => p[se.key])).filter((v) => v != null)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  const padv = (hi - lo) * 0.06 || hi * 0.02
  lo -= padv
  hi += padv
  const t0 = pts[0].t
  const x = (t) => L + ((t - t0) / (lastT - t0 || 1)) * (W - L - R)
  const y = (v) => TOP + (1 - (v - lo) / (hi - lo)) * (H - TOP - B)
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': T(`${stockSeries.symbol} 收盘价走势，${{ '1m': '近 1 个月', '6m': '近半年', '1y': '近 1 年', '5y': '近 5 年' }[stockRange]}`, `${stockSeries.symbol} closing prices, ${{ '1m': 'past month', '6m': 'past 6 months', '1y': 'past year', '5y': 'past 5 years' }[stockRange]}`) })
  for (const v of niceTicks(lo, hi, 4)) {
    s.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--s-grid)', 'stroke-width': 1 }))
    s.append(svgText({ x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'ax' }, tickLabel(v)))
  }
  s.append(svg('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: 'var(--s-axis)', 'stroke-width': 1 }))
  for (const tk of dateTicks(t0, lastT, stockRange)) {
    const xx = x(tk.t)
    if (xx < L + 14 || xx > W - R - 10) continue
    s.append(svgText({ x: xx, y: H - 8, 'text-anchor': 'middle', class: 'ax' }, tk.label))
  }
  const line = (key) => {
    let d = ''
    let pen = false
    for (const p of pts) {
      if (p[key] == null) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`
      pen = true
    }
    return d
  }
  s.append(svg('path', { d: `${line('c')}L${x(lastT).toFixed(1)},${H - B}L${x(t0).toFixed(1)},${H - B}Z`, fill: 'var(--s-price)', opacity: 0.1 }))
  for (const se of [...series].reverse()) s.append(svg('path', { d: line(se.key), fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
  // End labels: the price first; a line whose label would collide relies on the legend.
  const last = pts[pts.length - 1]
  const used = []
  for (const se of series) {
    const v = last[se.key]
    if (v == null) continue
    const yy = Math.min(H - B - 4, Math.max(TOP + 4, y(v)))
    if (used.some((u) => Math.abs(u - yy) < 13)) continue
    used.push(yy)
    s.append(svgText({ x: W - R + 8, y: yy + 3.5, class: se.key === 'c' ? 'endv' : 'endl' }, se.key === 'c' ? money(v) : se.end))
  }
  s.append(svg('circle', { cx: x(lastT), cy: y(last.c), r: 4, fill: 'var(--s-price)', stroke: 'var(--s-surface)', 'stroke-width': 2 }))
  // Hover / keyboard: a crosshair snaps to the nearest trading day; the tooltip lists every line.
  const cross = svg('line', { y1: TOP, y2: H - B, stroke: 'var(--s-axis)', 'stroke-width': 1, visibility: 'hidden' })
  const dot = svg('circle', { r: 4, fill: 'var(--s-price)', stroke: 'var(--s-surface)', 'stroke-width': 2, visibility: 'hidden' })
  const hit = svg('rect', { x: L, y: 0, width: W - L - R + 8, height: H - B, fill: 'transparent', tabindex: 0, 'aria-label': T('用左右方向键逐日查看', 'Use the left and right arrow keys to step through days') })
  s.append(cross, dot, hit)
  const tip = el('div', { class: 'tip', hidden: '' })
  let at = pts.length - 1
  const show = (i) => {
    at = Math.max(0, Math.min(pts.length - 1, i))
    const p = pts[at]
    const xx = x(p.t)
    for (const [k, v] of [['x1', xx], ['x2', xx], ['visibility', 'visible']]) cross.setAttribute(k, v)
    for (const [k, v] of [['cx', xx], ['cy', y(p.c)], ['visibility', 'visible']]) dot.setAttribute(k, v)
    tip.replaceChildren(
      el('div', { class: 'd' }, ymd(p.t)),
      ...series.filter((se) => p[se.key] != null).map((se) => el('div', {}, el('i', { class: 'k', style: `background:${se.color}` }), el('b', {}, money(p[se.key])), se.name)),
    )
    tip.hidden = false
    const scale = box.clientWidth / W || 1
    const left = (xx + 12) * scale
    tip.style.left = left + 150 > box.clientWidth ? `${Math.max(0, (xx - 12) * scale - tip.offsetWidth)}px` : `${left}px`
  }
  const hide = () => {
    tip.hidden = true
    cross.setAttribute('visibility', 'hidden')
    dot.setAttribute('visibility', 'hidden')
  }
  const nearest = (t) => {
    let a = 0
    let b = pts.length - 1
    while (b - a > 1) {
      const m = (a + b) >> 1
      if (pts[m].t < t) a = m
      else b = m
    }
    return t - pts[a].t < pts[b].t - t ? a : b
  }
  hit.addEventListener('pointermove', (e) => {
    const r = s.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    show(nearest(t0 + ((px - L) / (W - L - R)) * (lastT - t0)))
  })
  hit.addEventListener('pointerleave', hide)
  hit.addEventListener('focus', () => show(at))
  hit.addEventListener('blur', hide)
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      show(at + (e.key === 'ArrowLeft' ? -1 : 1))
    }
  })
  box.replaceChildren(s, tip)
  $('#sd-legend').replaceChildren(...series.map((se) => el('span', {}, el('i', { style: `background:${se.color}` }), se.name)))
}

$('#stock-scan').addEventListener('click', () => pet.invoke('stock:scan'))
$('#stock-filter').addEventListener('input', () => renderStockLists())
for (const b of $$('.seg button')) {
  b.addEventListener('click', () => {
    stockRange = b.dataset.range
    renderStockChart()
  })
}
$('#sd-close').addEventListener('click', () => {
  stockSel = null
  $('#stock-detail').hidden = true
  for (const li of $$('.stocks li.sel')) li.classList.remove('sel')
})
$('#sd-analyze').addEventListener('click', () => stockSel && pet.invoke('stock:analyze', stockSel))
let stockResize = null
window.addEventListener('resize', () => {
  clearTimeout(stockResize)
  stockResize = setTimeout(() => !$('#stock-detail').hidden && renderStockChart(), 120)
})

;(async () => {
  snap = await pet.invoke('panel:state')
  render()
  const tab = new URLSearchParams(location.search).get('tab')
  showTab(tab || 'chat')
})()
