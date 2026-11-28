'use strict'
// Renderer side of the language switch. The pages are written in Chinese; in English mode the static
// text is swapped through EN below, and scripts use T('中文', 'English') for what they build.
const LANG = (window.pet && window.pet.lang) === 'en' ? 'en' : 'zh'
const T = (zh, en) => (LANG === 'zh' ? zh : en)

const EN = {
  // panel: header and tabs
  在线: 'Online',
  聊天: 'Chat',
  待办: 'To-dos',
  目标: 'Goals',
  美股: 'Stocks',
  任务: 'Tasks',
  动态: 'Activity',
  成长: 'Growth',
  设置: 'Settings',
  // chat
  'Enter 发送 · Shift+Enter 换行 · /task 后台任务 · /todo 记待办': 'Enter to send · Shift+Enter for a new line · /task background task · /todo add to-do',
  发送: 'Send',
  停止: 'Stop',
  新对话: 'New chat',
  // to-dos
  待办清单: 'To-do list',
  '要做什么？': 'What needs doing?',
  '截止时间（可选）': 'Due (optional)',
  添加: 'Add',
  '✨ 帮我规划今天': '✨ Plan my day',
  '她会把待办写成便签，拖到桌面上贴好': 'She writes your to-dos on a sticky note and sticks it on the desktop',
  '📌 贴到桌面': '📌 Put on desktop',
  清除已完成: 'Clear done',
  提醒: 'Reminders',
  提醒内容: 'Reminder',
  每天: 'Daily',
  番茄钟: 'Pomodoro',
  '🍅 专注 25 分钟': '🍅 Focus 25 min',
  '专注 50 分钟': 'Focus 50 min',
  // goals
  '目标 · 持续跟进': 'Goals · ongoing follow-up',
  '把需要长期跟进的事交给她：到点后她会在后台推进一小步，回来向你汇报；需要你拍板时会带着选项来问你。':
    "Hand her things that need following up over time: when it's time she makes a small step of progress in the background and reports back; when you need to decide, she comes to you with options.",
  '例如：每天汇总项目仓库的新 issue': 'e.g. Summarize new issues in the project repo every day',
  '说明 / 标准 / 范围（可选）': 'Details / criteria / scope (optional)',
  '每 3 小时': 'Every 3 hours',
  每小时: 'Hourly',
  每天几点跟进: 'Daily follow-up time',
  交给她: 'Hand it over',
  // tasks
  后台任务: 'Background tasks',
  '交给 Claude Ojousama 在后台慢慢做，完成后会通知你。每个任务使用独立会话。': 'Claude Ojousama works on these in the background and lets you know when done. Each task has its own session.',
  '例如：把 Downloads 里的图片按月份整理成文件夹，并汇报整理结果': 'e.g. Sort the images in Downloads into folders by month and report the result',
  开始任务: 'Start task',
  // stocks
  立即查看: 'Check now',
  时间范围: 'Time range',
  '1 个月': '1M',
  半年: '6M',
  '1 年': '1Y',
  '5 年': '5Y',
  和过去比: 'Versus the past',
  '● 现价 | 均价 条：区间最低到最高': '● price | average bar: range low to high',
  让本小姐查查为什么跌: 'Ask her why it dropped',
  收起图表: 'Hide chart',
  '长期上涨 · 最近急跌': 'Long-term risers · sharp recent drop',
  全部观察: 'All watched',
  '按离 1 个月高点的跌幅排序': 'Sorted by drop from the 1-month high',
  '筛选：代码或公司名': 'Filter: ticker or company',
  筛选股票: 'Filter stocks',
  美股观察设置: 'Stock watch settings',
  '每个美股交易日自动看 3 次': 'Check automatically 3 times each US trading day',
  '自动查看的时间（美东时间，逗号分隔）': 'Check times (US Eastern, comma-separated)',
  '包含默认观察池（约 125 家美国大公司）': 'Include the default pool (about 125 large US companies)',
  '自选美股（每行一个代码，例如 AAPL、BRK.B）': 'Your own tickers (one per line, e.g. AAPL, BRK.B)',
  '急跌标准：比 1 个月内最高价低多少（%）': 'Sharp drop: how far below the 1-month high (%)',
  涨跌颜色: 'Up/down colors',
  红涨绿跌: 'Red up, green down',
  绿涨红跌: 'Green up, red down',
  '只看在美国主要交易所（Nasdaq、NYSE 等）上市、以美元交易的个股，ETF 和其他市场的代码会被跳过。数据来自 Yahoo Finance 的日线收盘价，交易时段内可能有约 15 分钟延迟。「价位」只和这只股票自己过去的价格比，不是估值。这里的一切都只是数据，不构成投资建议。':
    'Only single stocks listed on major US exchanges (Nasdaq, NYSE…) and traded in USD; ETFs and other markets are skipped. Data are Yahoo Finance daily closes and may be about 15 minutes delayed during trading hours. "Price level" compares a stock only with its own past prices; it is not a valuation. Everything here is just data, not investment advice.',
  // activity / growth
  她自己做过的事: 'What she did on her own',
  清空动态: 'Clear activity',
  她学到的: "What she's learned",
  你对每种主动帮忙的反应会改变她以后多常这样做: 'How you react to each kind of help changes how often she offers it',
  '你对每种主动帮忙的反应，会改变她以后多常这样做': 'How you react to each kind of help changes how often she offers it',
  成长笔记: 'Growth notes',
  她对怎样陪伴你的认识: 'What she has learned about keeping you company',
  日记: 'Diary',
  她最近学了: 'Recently learned',
  '🌱 现在整理一次记忆': '🌱 Tidy memories now',
  她记得的事: 'What she remembers',
  '让她记住…（例如：我每天 10 点开站会）': 'Have her remember… (e.g. I have stand-up at 10 every day)',
  记住: 'Remember',
  // settings
  基本: 'Basics',
  怎么称呼你: 'What to call you',
  默认你: 'Default: you',
  '默认：你': 'Default: you',
  桌宠大小: 'Pet size',
  拖动松手后落回屏幕底部: 'Fall back to the bottom of the screen after being dropped',
  开机自动启动: 'Start at login',
  剪贴板快捷键: 'Clipboard hotkey',
  留空关闭: 'Leave empty to turn off',
  '长回复和改过的代码写到小黑板上（气泡只留开头一两句）': 'Write long replies and edited code on the blackboard (the bubble keeps only the first sentence or two)',
  '黑板没人看时，多少秒后自动收起（0 = 不自动收起）': 'Hide the blackboard after this many idle seconds (0 = never)',
  'AI 内核': 'AI core',
  '用哪个 AI（换 AI 就换了一个她）': 'Which AI (another AI is another girl)',
  'Claude Code · Claude 大小姐（傲娇大小姐）': 'Claude Code · Claude Ojousama (tsundere young lady)',
  'Codex · ChatGPT 龙娘（成熟温柔的白龙）': 'Codex · ChatGPT Dragon (gentle white dragon)',
  'DeepSeek Harness · DeepSeek 鲸鱼娘（吃白饭的大肥鱼）': 'DeepSeek Harness · DeepSeek Whale (the rice-loving big fish)',
  'Codex 路径': 'Codex path',
  '留空自动查找 codex': 'Leave empty to find codex automatically',
  '留空使用 Codex 默认模型': "Leave empty for Codex's default model",
  '跟随 Codex 默认': 'Codex default',
  最低: 'Minimal',
  '使用 Codex 的登录状态：先安装（': 'Uses your Codex sign-in: install it (',
  '），再在终端运行': '), then run',
  '用 ChatGPT 账号登录。': 'in a terminal to sign in with your ChatGPT account.',
  'DeepSeek Harness 路径': 'DeepSeek Harness path',
  '留空自动查找 dsh 或 DeepSeek Harness 应用': 'Leave empty to find dsh or the DeepSeek Harness app',
  '留空使用默认，或写 provider/model': 'Leave empty for the default, or provider/model',
  '使用 DeepSeek Harness 应用里的 DeepSeek 账号登录；也可以在': 'Uses the DeepSeek account you signed in with in the DeepSeek Harness app; or put',
  '里写': 'in',
  '。命令行版需要 Node.js 24.9 以上（': '. The command-line version needs Node.js 24.9 or newer (',
  '）。': ').',
  'Claude Code 路径': 'Claude Code path',
  '留空自动查找 claude': 'Leave empty to find claude automatically',
  选择: 'Choose',
  模型: 'Model',
  '留空使用 Claude Code 默认模型': "Leave empty for Claude Code's default model",
  推理强度: 'Reasoning effort',
  '跟随 Claude Code 默认': 'Claude Code default',
  低: 'Low',
  中: 'Medium',
  高: 'High',
  超高: 'Extra high',
  最高: 'Max',
  '使用 Claude Code 的登录状态；首次使用请先在终端运行': 'Uses your Claude Code login; the first time, run',
  '完成登录。': 'in a terminal to log in.',
  权限: 'Permission',
  '只读：能读文件、查资料，不能改文件或运行命令': 'Read-only: read and research; no edits, no commands',
  '工作区可写：只改工作目录里的文件；命令在沙箱里运行，不联网': 'Workspace: edits in the work folder; sandboxed commands',
  '完全访问：不再询问，不受限制（谨慎）': 'Full access: no questions, no limits (careful)',
  工作目录: 'Work folder',
  主动性: 'Initiative',
  '主动模式（提醒、打招呼、捣蛋）': 'Proactive mode (reminders, greetings, mischief)',
  调皮程度: 'Mischief level',
  '0 · 乖巧，不捣蛋': '0 · Well-behaved, no mischief',
  '1 · 偶尔（约 1 小时一次）': '1 · Occasionally (about hourly)',
  '2 · 经常（约半小时一次）': '2 · Often (about every 30 min)',
  '3 · 超皮（约 10 分钟一次）': '3 · Very naughty (about every 10 min)',
  空闲时在屏幕底部散步: 'Stroll along the bottom of the screen when idle',
  '提醒没回应时，隔几分钟再来提醒（最多 3 次，0 = 只提醒一次）': 'Remind again after this many minutes when ignored (up to 3 times, 0 = only once)',
  '喝水/休息提醒间隔（分钟，0 关闭）': 'Water/break reminder interval (minutes, 0 = off)',
  'AI 主动搭话间隔（分钟，0 关闭；会消耗 token）': 'AI chat-starter interval (minutes, 0 = off; uses tokens)',
  安静时段开始: 'Quiet hours from',
  结束: 'to',
  随机捣蛋: 'Random mischief',
  偷看: 'Peek',
  假装代码爆炸: 'Fake code explosion',
  拖走假文件: 'Drag away a fake file',
  追鼠标: 'Chase the cursor',
  敲屏幕: 'Knock on the screen',
  躲猫猫: 'Hide and seek',
  跳舞: 'Dance',
  贴小纸条: 'Leave a note',
  爬到窗口上: 'Climb onto windows',
  现在捣个蛋: 'Make mischief now',
  自主与读屏: 'Autonomy & screen',
  '正在检测屏幕能力…': 'Checking screen capabilities…',
  重新检测: 'Re-check',
  打开屏幕录制权限: 'Allow screen recording',
  自主程度: 'Autonomy',
  '积极：常看看你在做什么，主动帮忙（每小时看屏 ≤12 次、开口 ≤8 次）': 'Active: looks often, offers help (≤12 looks, ≤8 remarks/h)',
  '适中：偶尔看看，有事才说（每小时看屏 ≤5 次、开口 ≤4 次）': 'Moderate: looks now and then (≤5 looks, ≤4 remarks/h)',
  '安静：不主动看屏幕，只提醒': "Quiet: doesn't look on her own, only reminds",
  '看你的屏幕（截图会交给模型）': 'Look at your screen (screenshots go to the model)',
  自动: 'Automatic',
  每次先问我: 'Ask me each time',
  关闭: 'Off',
  '你离开时，先帮你查刚才的报错': 'When you step away, look into the error you just had',
  '这些窗口从不看（进程名或标题关键词，每行一个）': 'Never look at these windows (process name or title keyword, one per line)',
  开会时保持安静: 'Stay quiet during meetings',
  '全屏看视频/玩游戏时躲起来': 'Hide during full-screen videos/games',
  '全屏玩游戏时也陪着你（打开后不会躲起来）': "Stay with you during full-screen games (she won't hide)",
  复制了报错代码或英文时主动问要不要帮忙: 'Offer help when you copy an error, code or Chinese text',
  '复制了报错、代码或英文时主动问要不要帮忙': 'Offer help when you copy an error, code or Chinese text',
  '番茄钟专注时，看到你在摸鱼就提醒': 'Nudge you when you slack off during pomodoro focus',
  '摸鱼网站/应用（每行一个）': 'Slacking sites/apps (one per line)',
  偶尔爬到你的窗口上坐着: 'Sometimes climb onto your windows and sit',
  '空闲时做些小动作（看书、吃饼干、坐着晃腿…）': 'Little idle animations (reading, cookies, swinging legs…)',
  '每天几点写今日小结（留空关闭；保存在文档目录的「Claude Ojousama 日报」）': 'Daily summary time (empty = off; saved in Documents/"Claude Ojousama Daily")',
  '她自己在后台做的事（整理记忆、每日简报、工作区巡检、每日小技巧）': 'Things she does on her own in the background (tidy memories, daily brief, workspace check-up, daily tip)',
  每天最多几次后台任务: 'Max background jobs per day',
  早上给我一份今日简报: 'Give me a daily brief in the morning',
  '我离开时巡检工作目录（只读文件，不联网、不运行命令）': 'Check the work folder while I am away (reads files only; no network, no commands)',
  '所在城市（用于天气和带伞提醒；留空不联网查天气）': 'Your city (for weather and umbrella reminders; empty = no weather lookups)',
  '例如：Shanghai 或 上海': 'e.g. London',
  刷新: 'Refresh',
  '有新版本时告诉我（只查 GitHub Releases，不会自动下载）': "Tell me about new versions (checks GitHub Releases only; never downloads on its own)",
  检查更新: 'Check for updates',
  看屏和后台任务的模型: 'Model for screen looks and background jobs',
  '留空跟随聊天模型（例如 haiku 更快更省）': 'Empty = same as chat (e.g. haiku is faster and cheaper)',
  看屏和后台任务的推理强度: 'Reasoning effort for screen looks and background jobs',
  跟随聊天设置: 'Same as chat',
  '👀 看看我在干嘛': "👀 See what I'm doing",
  '1 小时内别看': "Don't look for 1 hour",
  主动行为权限: 'Proactive permissions',
  '自动 / 先问我 / 禁止': 'Automatic / ask me / never',
  '帮你搬文件（聊天里让她搬）': 'Move files for you (when asked in chat)',
  先问我: 'Ask me first',
  '自动（拖过去就行）': 'Automatic (just drag it over)',
  禁止: 'Never',
  '发现新下载，帮你分类整理': 'Sort new downloads for you',
  '自动整理（可撤销）': 'Tidy automatically (undoable)',
  后台跟进目标: 'Follow up on goals in the background',
  到点自动推进: 'Work on them when due',
  到点先问我: 'Ask me when due',
  '关闭（只在我点「立即跟进」时）': 'Off (only when I click "Follow up now")',
  每天把待办写成便签贴出来: 'Put the to-dos on a sticky note every day',
  '打开网页 / 程序': 'Open web pages / programs',
  '监视的文件夹（每行一个，默认是下载文件夹）': 'Watched folders (one per line; default is Downloads)',
  现在整理一次: 'Tidy now',
  '只整理文件夹第一层的文件，不覆盖同名文件，可撤销': 'Only tidies files at the top level, never overwrites, undoable',
  // note
  小克的便签: "Claudie's note",
  '📌 今日待办': "📌 Today's to-dos",
  '置顶 / 取消置顶': 'Pin / unpin',
  收起便签: 'Put the note away',
  '+ 记一条，回车添加': '+ Add one, press Enter',
  '— 小克 ✎': '— Claudie ✎',
  '— 小克': '— Claudie',
  // board
  'Claude Ojousama · 黑板': 'Claude Ojousama · Blackboard',
  上一块: 'Previous',
  下一块: 'Next',
  复制黑板上的内容: 'Copy what is on the board',
  复制: 'Copy',
  '钉住：不自动收起': "Pin: don't hide automatically",
  钉住: 'Pin',
  收起黑板: 'Hide blackboard',
  // pet
  '和 Claude Ojousama 说点什么…（Enter 发送 · Esc 关闭）': 'Say something to Claude Ojousama… (Enter to send · Esc to close)',
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt']
const norm = (s) => s.replace(/\s+/g, ' ').trim()
const missing = new Set()

/** English for a fixed Chinese UI string, or the string itself. */
function en(s) {
  const k = norm(s)
  if (k in EN) return EN[k]
  if (/[一-鿿]/.test(k)) missing.add(k)
  return s
}

/** Translate the static text of a page (or a subtree) in English mode. */
function translateDom(root = document) {
  if (LANG === 'zh') return
  document.documentElement.lang = 'en'
  if (document.title) document.title = en(document.title)
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  for (const n of nodes) {
    const t = n.nodeValue
    if (!/[一-鿿]/.test(t)) continue
    const lead = t.match(/^\s*/)[0]
    const tail = t.match(/\s*$/)[0]
    const out = en(t)
    if (out !== t) n.nodeValue = lead + out + tail
  }
  for (const el of (root.body || root).querySelectorAll('*')) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a)
      if (v && /[一-鿿]/.test(v)) el.setAttribute(a, en(v))
    }
  }
  if (missing.size) console.warn('[i18n] untranslated:', [...missing])
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => translateDom())
else translateDom()
