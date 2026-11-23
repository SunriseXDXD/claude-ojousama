'use strict'
// Goals: things the pet keeps pushing forward between conversations.
const { fmtTime } = require('./persona')
const { T } = require('./i18n')

const EVERY_MIN = { hourly: 60, '3h': 180 }
const EVERY_LABEL = { hourly: T('每小时', 'Hourly'), '3h': T('每 3 小时', 'Every 3 hours'), daily: T('每天', 'Daily') }

/** Next scheduled check-in after `from`. */
function nextCheck(goal, from = Date.now()) {
  if (goal.every === 'daily') {
    const m = String(goal.at || '09:00').match(/^(\d{1,2}):(\d{2})$/)
    const d = new Date(from)
    d.setHours(m ? Number(m[1]) : 9, m ? Number(m[2]) : 0, 0, 0)
    if (d.getTime() <= from + 60000) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  return from + (EVERY_MIN[goal.every] || 180) * 60000
}

function normalizeEvery(every) {
  return ['hourly', '3h', 'daily'].includes(every) ? every : 'daily'
}

function scheduleLabel(goal) {
  return goal.every === 'daily' ? T(`每天 ${goal.at || '09:00'}`, `Daily ${goal.at || '09:00'}`) : EVERY_LABEL[goal.every] || ''
}

function checkInPrompt(goal) {
  const recent = (goal.log || [])
    .slice(-4)
    .map((l) => `- ${fmtTime(l.ts)} ${l.text}`)
    .join('\n')
  return [
    T('[目标跟进] 你在对话之外帮用户持续推进下面这个目标。这是一次定时跟进，用户此刻不一定在看屏幕。', '[Goal follow-up] Outside of chat you keep pushing the goal below forward for the user. This is a scheduled follow-up; the user may not be looking at the screen. Write everything for the user in English.'),
    T(`目标：${goal.title}`, `Goal: ${goal.title}`),
    goal.detail ? T(`说明 / 标准：${goal.detail}`, `Details / criteria: ${goal.detail}`) : '',
    T(`最近进展：\n${recent || '（还没有，这是第一次跟进）'}`, `Recent progress:\n${recent || '(none yet; this is the first follow-up)'}`),
    goal.answer ? T(`用户对你上次问题「${goal.lastQuestion || ''}」的回答：${goal.answer}`, `The user's answer to your last question "${goal.lastQuestion || ''}": ${goal.answer}`) : '',
    T('要求：', 'Requirements:'),
    T('1. 在当前权限内实际推进一小步（查资料、读写工作目录里的文件、整理信息等），不要只写计划；删除、外发消息、花钱等危险操作只提建议，不要执行。', '1. Actually make one small step of progress within your current permissions (research, read/write files in the work folder, organize information…), not just a plan; for risky operations like deleting, sending messages out or spending money, only suggest — never do them.'),
    T('2. 最后用 1~3 句话向用户汇报：这次做了什么、下一步打算做什么。', '2. End with a 1–3 sentence report to the user: what you did this time and what you plan next.'),
    T('3. 需要用户拍板时附加 {"action":"ask","question":"…","options":["…","…"]}；需要用户亲自做的事用 todo.add；目标已经完全达成时附加 {"action":"goal.done"}。', '3. When the user must decide, append {"action":"ask","question":"…","options":["…","…"]}; things the user must do themself go in todo.add; when the goal is fully achieved append {"action":"goal.done"}.'),
  ]
    .filter(Boolean)
    .join('\n')
}

module.exports = { nextCheck, normalizeEvery, scheduleLabel, checkInPrompt, EVERY_LABEL }
