'use strict'
// One language for the whole app: Chinese when the system's first language is Chinese, English otherwise.
// CLAUDE_PET_LANG=zh|en overrides it (for testing). Where Electron cannot be asked (unit tests), Chinese.

let cached = null

function systemLanguages() {
  if (!process.versions.electron) return null // plain Node (tests): requiring 'electron' there only gives a path, or even starts a download
  try {
    const { app } = require('electron')
    if (app && typeof app.getPreferredSystemLanguages === 'function') {
      const list = app.getPreferredSystemLanguages() || []
      if (list.length) return list
      const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
      return [typeof app.getLocale === 'function' && app.isReady && app.isReady() ? app.getLocale() : env]
    }
  } catch {}
  return null
}

/** 'zh' for any Chinese variant (zh, zh-Hans-CN, zh_TW…), else 'en'. */
function fromTag(tag) {
  return /^zh(?:$|[-_])/i.test(String(tag || '').trim()) ? 'zh' : 'en'
}

function lang() {
  const forced = String(process.env.CLAUDE_PET_LANG || '').toLowerCase()
  if (forced === 'zh' || forced === 'en') return forced
  if (!cached) {
    const list = systemLanguages()
    cached = list ? fromTag(list[0]) : 'zh'
  }
  return cached
}

/** For tests. */
function setLang(l) {
  cached = l === 'en' ? 'en' : l === 'zh' ? 'zh' : null
}

/** Pick the Chinese or the English text. Both are evaluated; keep them cheap. */
const T = (zh, en) => (lang() === 'zh' ? zh : en)
const isZh = () => lang() === 'zh'

/** An object whose properties resolve to the current language's table (for module-level line banks). */
function byLang(tables) {
  return new Proxy({}, {
    get: (_t, k) => tables[lang()][k],
    has: (_t, k) => k in tables[lang()],
    ownKeys: () => Reflect.ownKeys(tables[lang()]),
    getOwnPropertyDescriptor: (_t, k) => {
      const d = Object.getOwnPropertyDescriptor(tables[lang()], k)
      return d && { ...d, configurable: true }
    },
  })
}

module.exports = { lang, setLang, T, isZh, byLang, fromTag }
