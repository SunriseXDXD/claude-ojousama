'use strict'
// The AI cores the pet can run on. Each one is a CLI agent driven headlessly, one process per turn,
// with the same run interface (events + done); the chosen core also decides her character.
const { locateClaude, ClaudeRun, claudeOptions } = require('./claude')
const { locateCodex, CodexRun, codexOptions } = require('./codex')
const { locateDsh, DshRun, dshOptions } = require('./dsh')
const { T } = require('./i18n')

const BACKENDS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    exeKey: 'claudeExe',
    character: 'ojousama',
    images: 'attach', // screenshots go in with the message
    locate: (s) => locateClaude(s.claudeExe),
    make: (s, opts, located) => new ClaudeRun({ ...claudeOptions(s, opts), claude: located }),
    missing: () => T('找不到 Claude Code，请先安装并在终端运行 claude 登录，或在设置里填写 claude 的路径', "Can't find Claude Code. Install it and run claude in a terminal to log in, or set the claude path in Settings"),
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    exeKey: 'codexExe',
    character: 'dragon',
    images: 'attach',
    locate: (s) => locateCodex(s.codexExe),
    make: (s, opts, located) => new CodexRun({ ...codexOptions(s, opts), codex: located }),
    missing: () => T('找不到 Codex，请先安装（npm i -g @openai/codex）并在终端运行 codex login 登录 ChatGPT，或在设置里填写 codex 的路径', "Can't find Codex. Install it (npm i -g @openai/codex) and run codex login in a terminal to sign in with ChatGPT, or set the codex path in Settings"),
  },
  dsh: {
    id: 'dsh',
    name: 'DeepSeek Harness',
    exeKey: 'dshExe',
    character: 'whale',
    images: 'file', // screenshots are files she opens with read_image
    locate: (s) => locateDsh(s.dshExe),
    make: (s, opts, located) => new DshRun({ ...dshOptions(s, opts), dsh: located }),
    missing: () => T('找不到 DeepSeek Harness，请先安装 DeepSeek Harness 并登录（或 npm i -g @deepseek-ai/dsh），或在设置里填写 dsh 的路径', "Can't find DeepSeek Harness. Install the DeepSeek Harness app and sign in (or npm i -g @deepseek-ai/dsh), or set the dsh path in Settings"),
  },
}

const backendIds = () => Object.keys(BACKENDS)
const backendOf = (settings) => BACKENDS[settings && settings.backend] || BACKENDS.claude

module.exports = { BACKENDS, backendIds, backendOf }
