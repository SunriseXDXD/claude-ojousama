'use strict'
// US stock watch. Daily closes come from Yahoo Finance's chart API; only stocks listed on the major US
// exchanges in USD are kept. For each one: a 5-year trend fit, the short-term drop, and how today's
// price compares with the past 1 month / half year / 1 year. Scans run three times per US trading day.
const fs = require('fs')

const DAY = 86400e3
const YEAR = 365.25 * DAY
const ET = 'America/New_York'
const DEFAULT_TIMES = ['10:00', '13:00', '16:15'] // New York time: after the open, midday, after the close
// Large US-listed, US-headquartered companies (Yahoo symbols; class shares use "-").
const DEFAULT_POOL = [
  // tech, internet, media, telecom
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'INTC', 'CSCO', 'QCOM', 'TXN', 'IBM', 'NOW', 'INTU',
  'AMAT', 'MU', 'LRCX', 'KLAC', 'ADI', 'PANW', 'CRWD', 'PLTR', 'SNPS', 'CDNS', 'ANET', 'UBER', 'NFLX', 'TSLA', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS',
  // financials
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'BLK', 'AXP', 'V', 'MA', 'PYPL', 'COF', 'USB', 'BK', 'MET', 'AIG', 'PGR', 'SPGI', 'MCO', 'ICE', 'CME', 'BRK-B',
  // health care
  'LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'AMGN', 'GILD', 'ISRG', 'BMY', 'CVS', 'SYK', 'VRTX', 'REGN', 'ELV', 'BSX',
  // consumer
  'WMT', 'COST', 'HD', 'LOW', 'MCD', 'SBUX', 'NKE', 'TGT', 'PG', 'KO', 'PEP', 'PM', 'MO', 'MDLZ', 'CL', 'BKNG', 'TJX', 'CMG', 'ORLY',
  // industrials
  'CAT', 'DE', 'GE', 'HON', 'RTX', 'LMT', 'BA', 'UNP', 'UPS', 'FDX', 'GD', 'NOC', 'MMM', 'EMR', 'WM',
  // energy, utilities, materials, real estate
  'XOM', 'CVX', 'COP', 'EOG', 'NEE', 'DUK', 'SO', 'SHW', 'APD', 'PLD', 'AMT', 'EQIX',
]
// Yahoo codes of the major US exchanges: Nasdaq (three tiers), NYSE, NYSE American, NYSE Arca, Cboe BZX.
const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NAS', 'NYQ', 'NYS', 'ASE', 'PCX', 'BTS'])
const WINDOWS = [
  { key: 'm1', label: '近 1 个月', days: 30 },
  { key: 'm6', label: '近半年', days: 182 },
  { key: 'y1', label: '近 1 年', days: 365 },
]

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
const round = (v) => Math.round(v * 1e4) / 1e4
const pct = (v, digits = 1) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(digits) + '%'
const absPct = (v, digits = 1) => Math.abs(v * 100).toFixed(digits) + '%'
const usd = (v) => '$' + (v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2))

/** "brk.b" / "$aapl" → "BRK-B" / "AAPL"; null when it cannot be a US ticker. */
function normalizeSymbol(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/^\$/, '').replace(/\./g, '-')
  return /^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(s) ? s : null
}

/** Why a quote is not a US stock, or null when it is one. */
function usCheck(meta) {
  if (!meta) return '没有行情数据'
  if (meta.currency !== 'USD') return `不是美元计价（${meta.currency || '未知'}）`
  if (!US_EXCHANGES.has(meta.exchangeName)) return `不在美国主要交易所上市（${meta.fullExchangeName || meta.exchangeName || '未知'}）`
  if (meta.instrumentType && meta.instrumentType !== 'EQUITY') return `不是个股（${meta.instrumentType}）`
  return null
}

function dataError(message) {
  return Object.assign(new Error(message), { dataError: true })
}

/** Keep one close per exchange day (the later one wins). */
function dedupeDays(points, gmtoffset = 0) {
  const out = []
  for (const p of points) {
    const prev = out[out.length - 1]
    if (prev && Math.floor((prev[0] + gmtoffset) / 86400) === Math.floor((p[0] + gmtoffset) / 86400)) out[out.length - 1] = p
    else if (!prev || p[0] > prev[0]) out.push(p)
  }
  return out
}

/** Yahoo chart JSON → { meta, points: [[unixSeconds, close]] } (split-adjusted closes, gaps dropped). */
function parseChart(json) {
  const chart = json && json.chart
  if (chart && chart.error) throw dataError(chart.error.description || chart.error.code || 'Yahoo 返回了错误')
  const r = chart && chart.result && chart.result[0]
  if (!r || !r.meta) throw dataError('没有行情数据')
  const ts = r.timestamp || []
  const quote = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {}
  const close = quote.close || []
  const points = []
  for (let i = 0; i < ts.length; i++) if (Number.isFinite(close[i]) && close[i] > 0) points.push([ts[i], round(close[i])])
  return { meta: r.meta, points: dedupeDays(points, r.meta.gmtoffset || 0) }
}

/** Put the latest trade price on the series (it replaces today's candle, or becomes a new point). */
function withLive(points, meta) {
  const price = meta && meta.regularMarketPrice
  const at = meta && meta.regularMarketTime
  if (!Number.isFinite(price) || !(price > 0) || !at || !points.length) return points
  const off = meta.gmtoffset || 0
  const last = points[points.length - 1]
  if (Math.floor((last[0] + off) / 86400) === Math.floor((at + off) / 86400)) return [...points.slice(0, -1), [last[0], round(price)]]
  return at > last[0] ? [...points, [at, round(price)]] : points
}

/** Splice a fresh month into the cached series; null when old closes no longer match (a split: refetch). */
function merge(old, fresh) {
  if (!fresh.length) return old
  const first = fresh[0][0]
  const byTime = new Map(old.map((p) => [p[0], p[1]]))
  for (const [t, c] of fresh.slice(0, -1)) {
    const was = byTime.get(t)
    if (was && Math.abs(c / was - 1) > 0.02) return null
  }
  return [...old.filter((p) => p[0] < first), ...fresh]
}

/**
 * Everything the pet says about one stock. points: [[unixSeconds, close]] ascending, ideally 5 years.
 * dropPct: how far below its 1-month high counts as a rapid drop (5 trading days: 0.7 of it).
 */
function analyze(points, { dropPct = 10 } = {}) {
  if (!Array.isArray(points) || points.length < 30) return null
  const n = points.length
  const t = points.map((p) => p[0] * 1000)
  const c = points.map((p) => p[1])
  const price = c[n - 1]
  const lastT = t[n - 1]
  // Index of the first close inside the last `days` calendar days.
  const from = (days) => {
    const cut = lastT - days * DAY
    let i = n - 1
    while (i > 0 && t[i - 1] >= cut) i--
    return i
  }
  const windows = {}
  for (const w of WINDOWS) {
    const i = from(w.days)
    if (lastT - t[Math.max(0, i - 1)] < w.days * DAY * 0.8) {
      windows[w.key] = null // the stock has not traded that long
      continue
    }
    const slice = c.slice(i)
    const low = Math.min(...slice)
    const high = Math.max(...slice)
    const avg = mean(slice)
    windows[w.key] = { change: price / c[i] - 1, start: c[i], avg, vsAvg: price / avg - 1, low, high, pos: high > low ? (price - low) / (high - low) : 0.5 }
  }

  // Long-term trend: least squares of ln(close) on time, over up to 5 years.
  const i5 = from(5 * 366)
  const years = (lastT - t[i5]) / YEAR
  let trend = { label: 'unknown', years, annual: null, r2: null, vsTrend: null, change3y: null, fit: null }
  if (years >= 2) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0
    const m = n - i5
    for (let k = i5; k < n; k++) {
      const x = (t[k] - t[i5]) / YEAR
      const y = Math.log(c[k])
      sx += x
      sy += y
      sxx += x * x
      sxy += x * y
      syy += y * y
    }
    const b = (m * sxy - sx * sy) / (m * sxx - sx * sx)
    const a = (sy - b * sx) / m
    let ssRes = 0
    for (let k = i5; k < n; k++) ssRes += (Math.log(c[k]) - (a + (b * (t[k] - t[i5])) / YEAR)) ** 2
    const ssTot = syy - (sy * sy) / m
    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0
    const annual = Math.exp(b) - 1
    const i3 = from(3 * 366)
    const change3y = lastT - t[i3] >= 2.8 * YEAR ? price / c[i3] - 1 : null
    const label =
      annual >= 0.15 && r2 >= 0.6 ? 'strong' : annual >= 0.07 && r2 >= 0.45 && (change3y == null || change3y > 0) ? 'up' : annual <= -0.05 ? 'down' : 'flat'
    trend = { label, years, annual, r2, vsTrend: price / Math.exp(a + (b * (lastT - t[i5])) / YEAR) - 1, change3y, fit: { a, b, t0: t[i5] } }
  }

  const drop5 = price / c[Math.max(0, n - 6)] - 1
  const high1m = Math.max(...c.slice(from(30)))
  const dd1m = price / high1m - 1
  const ma = (len, end = n) => (end >= len ? mean(c.slice(end - len, end)) : null)
  const ma200 = ma(200)
  const ma200Ago = ma(200, n - 126)
  const thr = Math.max(1, Number(dropPct) || 10) / 100
  const rapid = dd1m <= -thr || drop5 <= -thr * 0.7
  const uptrend = trend.label === 'strong' || trend.label === 'up'
  const positions = WINDOWS.map((w) => windows[w.key]).filter(Boolean).map((w) => w.pos)
  const score = positions.length ? mean(positions) : null
  const level = score == null ? null : score < 0.2 ? '低位' : score < 0.4 ? '偏低' : score < 0.6 ? '中间' : score < 0.8 ? '偏高' : '高位'
  return {
    price, at: lastT, windows, trend, drop5, dd1m, high1m, ma200,
    ma200Rising: ma200 != null && ma200Ago != null ? ma200 > ma200Ago : null,
    rapid, uptrend, dip: uptrend && rapid, score, level,
  }
}

/** Plain-language lines for the panel, the pet's bubble and Claude's prompts (facts only, no advice). */
function describe(m) {
  const tr = m.trend
  const yrs = Math.max(1, Math.round(tr.years))
  const trendLine =
    tr.label === 'unknown'
      ? `上市不到 2 年（${tr.years.toFixed(1)} 年），看不出长期趋势`
      : tr.label === 'down'
        ? `近 ${yrs} 年整体下跌：年化约 ${pct(tr.annual)}`
        : tr.label === 'flat'
          ? `近 ${yrs} 年没有明显的上涨趋势（年化 ${pct(tr.annual)}，稳定度 R² ${tr.r2.toFixed(2)}）`
          : `近 ${yrs} 年整体上涨：年化约 ${pct(tr.annual)}，走势稳定度 R² ${tr.r2.toFixed(2)}；现价比长期趋势线${tr.vsTrend < 0 ? '低' : '高'} ${absPct(tr.vsTrend)}`
  const dropLine = `最近 5 个交易日 ${pct(m.drop5)}；${m.dd1m < -0.0005 ? `比 1 个月内最高价 ${usd(m.high1m)} 低 ${absPct(m.dd1m)}` : '就在 1 个月内的最高价附近'}`
  const compare = WINDOWS.map((w) => {
    const x = m.windows[w.key]
    if (!x) return { key: w.key, label: w.label, text: '还没有这么长的交易历史' }
    return {
      key: w.key,
      label: w.label,
      text: `比当时 ${pct(x.change)}；比均价 ${usd(x.avg)} ${x.vsAvg >= 0 ? '高' : '低'} ${absPct(x.vsAvg)}；在区间 ${usd(x.low)}–${usd(x.high)} 的 ${Math.round(x.pos * 100)}% 位置`,
    }
  })
  const levelLine = m.level
    ? `综合近 1 个月、半年、1 年的价格区间，现在处在${m.level}（平均在区间的 ${Math.round(m.score * 100)}% 位置）。只和它自己过去的价格比，不是估值。`
    : ''
  return { trend: trendLine, drop: dropLine, compare, level: levelLine }
}

// ---------------------------------------------------------------- New York time and the schedule

const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: ET, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
function etParts(ms) {
  const o = {}
  for (const p of etFmt.formatToParts(new Date(ms))) o[p.type] = p.value
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, weekday: o.weekday, day: `${o.year}-${o.month}-${o.day}` }
}
/** The instant a New York wall-clock time happens (DST-aware). */
function etToUtc(y, m, d, h, mi) {
  const want = Date.UTC(y, m - 1, d, h, mi)
  let at = want
  for (let i = 0; i < 3; i++) {
    const p = etParts(at)
    at += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)
  }
  return at
}
/** "10:00, 13:00" or an array → sorted unique "HH:MM" (New York time); the defaults when nothing valid. */
function normalizeTimes(times) {
  const list = (Array.isArray(times) ? times : String(times || '').split(/[,，\s]+/))
    .map((x) => String(x).trim().match(/^(\d{1,2})[:：](\d{2})$/))
    .filter((m) => m && +m[1] < 24 && +m[2] < 60)
    .map((m) => `${m[1].padStart(2, '0')}:${m[2]}`)
  const unique = [...new Set(list)].sort()
  return unique.length ? unique.slice(0, 6) : [...DEFAULT_TIMES]
}
const weekend = (p) => p.weekday === 'Sat' || p.weekday === 'Sun'
function slotsAround(now, times, days) {
  const out = []
  for (const back of days) {
    const p = etParts(now + back * DAY)
    if (weekend(p)) continue
    for (const hm of normalizeTimes(times)) {
      const [h, mi] = hm.split(':').map(Number)
      out.push({ key: `${p.day} ${hm}`, at: etToUtc(p.y, p.m, p.d, h, mi), et: hm })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
/** The most recent scheduled scan at or before now (weekdays only). */
function latestSlot(now, times) {
  const past = slotsAround(now, times, [-3, -2, -1, 0]).filter((s) => s.at <= now)
  return past.length ? past[past.length - 1] : null
}
function nextSlot(now, times) {
  return slotsAround(now, times, [0, 1, 2, 3, 4]).find((s) => s.at > now) || null
}

// ---------------------------------------------------------------- the scanner

class StockWatch {
  /**
   * fetch: (url, init) → Response (the app passes a Chromium-backed session fetch).
   * settings: () → { stockDefaultPool, stockWatch, stockDropPct, stockTimes }.
   */
  constructor({ file, fetch, settings, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), spacing = 450, now = () => Date.now() }) {
    Object.assign(this, { file, fetch, settings, sleep, spacing, now })
    this.data = { scannedAt: 0, lastSlot: '', version: 0, results: {}, series: {}, errors: {}, announced: { day: '', symbols: [] } }
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch {}
    this.scanning = null
    this.progress = { done: 0, total: 0 }
    this.stopped = false
  }

  save() {
    try {
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data), 'utf8')
      fs.renameSync(this.file + '.tmp', this.file)
    } catch (e) {
      console.warn('[stocks] save failed', e.message)
    }
  }

  /** The default pool (unless turned off) plus the user's own list, as Yahoo symbols. */
  symbols() {
    const s = this.settings()
    const own = Array.isArray(s.stockWatch) ? s.stockWatch : []
    return [...new Set([...(s.stockDefaultPool !== false ? DEFAULT_POOL : []), ...own].map(normalizeSymbol).filter(Boolean))]
  }

  watched() {
    const own = this.settings().stockWatch
    return new Set((Array.isArray(own) ? own : []).map(normalizeSymbol).filter(Boolean))
  }

  async get(symbol, range) {
    const query = `range=${range}&interval=1d&includePrePost=false`
    let last
    for (const host of ['query1', 'query2']) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await this.fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`, {
            signal: AbortSignal.timeout(15000),
            headers: { Accept: 'application/json' },
          })
          if (r.status === 429) {
            last = Object.assign(new Error('Yahoo 限流了（HTTP 429）'), { rateLimited: true })
            await this.sleep(4000 * (attempt + 1))
            continue
          }
          if (r.status === 404) throw dataError('找不到这个代码（可能已退市）')
          if (!r.ok) throw new Error('HTTP ' + r.status)
          return parseChart(await r.json())
        } catch (e) {
          if (e.dataError) throw e
          last = e
          if (!e.rateLimited) break // network trouble: try the other host
        }
      }
    }
    throw last
  }

  /** Full 5 years once per New York day; later scans only fetch the last month. */
  async load(symbol, day) {
    const cached = this.data.series[symbol]
    if (cached && cached.day === day && cached.points && cached.points.length > 200) {
      const recent = await this.get(symbol, '1mo')
      const merged = merge(cached.points, recent.points)
      if (merged) return { meta: recent.meta, points: dedupeDays(merged, recent.meta.gmtoffset || 0) }
    }
    return this.get(symbol, '5y')
  }

  scan(options = {}) {
    if (!this.scanning) {
      this.stopped = false
      this.scanning = this._scan(options).finally(() => {
        this.scanning = null
        this.progress = { done: 0, total: 0 }
      })
    }
    return this.scanning
  }

  async _scan({ onProgress } = {}) {
    const symbols = this.symbols()
    const s = this.settings()
    const day = etParts(this.now()).day
    const results = {}, series = {}, errors = {}
    let got = 0, limited = 0, stoppedBy = ''
    this.progress = { done: 0, total: symbols.length }
    if (onProgress) onProgress()
    for (const symbol of symbols) {
      if (this.stopped) break
      try {
        const { meta, points } = await this.load(symbol, day)
        const bad = usCheck(meta)
        if (bad) errors[symbol] = bad
        else {
          const live = withLive(points, meta)
          const m = analyze(live, { dropPct: s.stockDropPct })
          if (!m) errors[symbol] = '交易数据太少'
          else {
            results[symbol] = { symbol, name: meta.longName || meta.shortName || symbol, exchange: meta.fullExchangeName || meta.exchangeName, ...m }
            series[symbol] = { day, points: live }
            got++
          }
        }
        limited = 0
      } catch (e) {
        errors[symbol] = e.message
        // A network hiccup keeps the last good reading (marked stale) instead of dropping the stock.
        if (!e.dataError && this.data.results[symbol]) {
          results[symbol] = { ...this.data.results[symbol], stale: true }
          if (this.data.series[symbol]) series[symbol] = this.data.series[symbol]
        }
        if (e.rateLimited && ++limited >= 3) {
          stoppedBy = 'Yahoo 限流了，这次先停下，稍后再看'
          break
        }
      }
      this.progress.done++
      if (onProgress) onProgress()
      await this.sleep(this.spacing)
    }
    if (!got) {
      const first = Object.values(errors)[0]
      return { error: stoppedBy || (first ? `一只都没拿到：${first}` : '没有要看的股票'), errors, count: 0, dips: [] }
    }
    // Keep earlier readings of stocks this scan never reached (stopped early).
    for (const symbol of symbols) {
      if (!results[symbol] && !errors[symbol] && this.data.results[symbol]) {
        results[symbol] = this.data.results[symbol]
        series[symbol] = this.data.series[symbol]
      }
    }
    Object.assign(this.data, { results, series, errors, scannedAt: this.now(), version: (this.data.version || 0) + 1 })
    this.save()
    return { count: got, dips: this.dips(), errors, error: stoppedBy || null }
  }

  stop() {
    this.stopped = true
  }

  /** Long-term risers that dropped fast, deepest drop first. */
  dips() {
    return Object.values(this.data.results)
      .filter((r) => r.dip)
      .sort((a, b) => a.dd1m - b.dd1m)
  }

  dueSlot(now, times) {
    const slot = latestSlot(now, times)
    if (!slot || slot.key === this.data.lastSlot || now - slot.at > 12 * 3600e3) return null
    return slot
  }

  markSlot(key) {
    this.data.lastSlot = key
    this.save()
  }

  /** Dips not mentioned yet today (New York day), so each one is announced once. */
  unannounced(dips) {
    const day = etParts(this.now()).day
    const seen = this.data.announced && this.data.announced.day === day ? new Set(this.data.announced.symbols) : new Set()
    return dips.filter((d) => !seen.has(d.symbol))
  }

  markAnnounced(dips) {
    const day = etParts(this.now()).day
    const prev = this.data.announced && this.data.announced.day === day ? this.data.announced.symbols : []
    this.data.announced = { day, symbols: [...new Set([...prev, ...dips.map((d) => d.symbol)])] }
    this.save()
  }

  status(now, times) {
    const next = nextSlot(now, times)
    return {
      scanning: !!this.scanning,
      done: this.progress.done,
      total: this.progress.total,
      scannedAt: this.data.scannedAt || 0,
      version: this.data.version || 0,
      count: Object.keys(this.data.results).length,
      dips: this.dips().length,
      next: next ? { at: next.at, et: next.et } : null,
      times: normalizeTimes(times),
      // When each New York time next happens, so the panel can show it in local time.
      localAt: normalizeTimes(times).map((hm) => (slotsAround(now, times, [0, 1, 2, 3, 4]).find((x) => x.et === hm && x.at > now) || {}).at || null),
    }
  }

  /** The panel's list: dips first, then everything by its drop from the 1-month high. */
  view() {
    const watched = this.watched()
    const items = Object.values(this.data.results).map((r) => {
      const pts = (this.data.series[r.symbol] || {}).points || []
      const recent = pts.slice(-64).map((p) => p[1])
      return {
        symbol: r.symbol, name: r.name, exchange: r.exchange, price: r.price, at: r.at, stale: !!r.stale,
        dip: r.dip, rapid: r.rapid, uptrend: r.uptrend, level: r.level, score: r.score,
        trend: { label: r.trend.label, annual: r.trend.annual, r2: r.trend.r2, vsTrend: r.trend.vsTrend, years: r.trend.years },
        drop5: r.drop5, dd1m: r.dd1m, high1m: r.high1m, windows: r.windows, text: describe(r),
        spark: recent.filter((_, i) => i % 2 === recent.length % 2 || i === recent.length - 1),
        watched: watched.has(r.symbol),
      }
    })
    items.sort((a, b) => (a.dip === b.dip ? a.dd1m - b.dd1m : a.dip ? -1 : 1))
    const invalid = (Array.isArray(this.settings().stockWatch) ? this.settings().stockWatch : []).filter((x) => !normalizeSymbol(x))
    return {
      scannedAt: this.data.scannedAt || 0,
      items,
      errors: Object.entries(this.data.errors || {}).map(([symbol, error]) => ({ symbol, error })),
      invalid,
    }
  }

  series(symbol) {
    const r = this.data.results[symbol]
    const s = this.data.series[symbol]
    if (!r || !s) return null
    return { symbol, name: r.name, points: s.points, fit: r.trend.fit }
  }

  /** One line for the chat context, so she knows what she saw (only when fresh). */
  contextLine(now = this.now()) {
    if (!this.data.scannedAt || now - this.data.scannedAt > 24 * 3600e3) return ''
    const d = new Date(this.data.scannedAt)
    const when = `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const dips = this.dips()
    return dips.length
      ? `美股观察（${when} 看的，只是数据）：长期上涨但最近急跌的有 ${dips.slice(0, 6).map((x) => `${x.symbol}（比 1 个月高点 ${pct(x.dd1m)}）`).join('、')}`
      : `美股观察（${when} 看的）：观察的 ${Object.keys(this.data.results).length} 只里没有长期上涨又最近急跌的`
  }
}

module.exports = {
  StockWatch, analyze, describe, parseChart, withLive, merge, dedupeDays, usCheck, normalizeSymbol,
  etParts, etToUtc, latestSlot, nextSlot, normalizeTimes, DEFAULT_POOL, DEFAULT_TIMES, WINDOWS, pct, usd,
}
