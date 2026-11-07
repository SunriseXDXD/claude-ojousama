'use strict'
const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const S = require('../src/main/stocks')

const DAY = 86400
// Trading-day series ending on `end` (unix s): growth per year, daily noise, and a last-days multiplier.
function series({ years = 5, annual = 0.2, noise = 0.03, end = Date.UTC(2026, 10, 6, 14, 30) / 1000, tail = 0, tailDays = 8, seed = 7 } = {}) {
  let r = seed
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647
  const days = []
  for (let t = end; days.length < Math.round(years * 252); t -= DAY) {
    const wd = new Date(t * 1000).getUTCDay()
    if (wd !== 0 && wd !== 6) days.unshift(t)
  }
  let p = 100
  return days.map((t, i) => {
    p *= Math.exp(Math.log(1 + annual) / 252 + (rnd() - 0.5) * noise)
    if (tail && i >= days.length - tailDays) p *= Math.pow(1 + tail, 1 / tailDays)
    return [t, Math.round(p * 100) / 100]
  })
}
const chart = (points, meta = {}) => ({
  chart: {
    result: [{ meta: { currency: 'USD', exchangeName: 'NMS', fullExchangeName: 'NasdaqGS', instrumentType: 'EQUITY', gmtoffset: -18000, longName: 'Test Inc.', ...meta }, timestamp: points.map((p) => p[0]), indicators: { quote: [{ close: points.map((p) => p[1]) }] } }],
    error: null,
  },
})

// ---- analysis
const dip = S.analyze(series({ tail: -0.16 }))
assert.ok(dip.uptrend && dip.rapid && dip.dip, 'long-term riser with a sharp drop')
assert.ok(['strong', 'up'].includes(dip.trend.label))
assert.ok(dip.dd1m < -0.1 && dip.trend.annual > 0.1 && dip.trend.r2 > 0.6)
assert.ok(dip.trend.vsTrend < 0, 'below its trend line after the drop')
const steady = S.analyze(series({}))
assert.ok(steady.uptrend && !steady.rapid && !steady.dip)
assert.equal(S.analyze(series({ annual: -0.2 })).trend.label, 'down')
const flat = S.analyze(series({ annual: 0, noise: 0.04, seed: 3 }))
assert.ok(!flat.uptrend, 'no trend, no dip signal')
assert.equal(S.analyze(series({ annual: 0, tail: -0.2, seed: 3 })).dip, false, 'a drop alone is not enough')
const young = S.analyze(series({ years: 1.5 }))
assert.equal(young.trend.label, 'unknown')
assert.ok(young.windows.y1 && young.windows.m6)
const baby = S.analyze(series({ years: 0.3 }))
assert.equal(baby.windows.y1, null)
assert.equal(baby.windows.m6, null)
assert.ok(baby.windows.m1)
assert.equal(S.analyze(series({ years: 0.05 })), null, 'too little data')
assert.equal(S.analyze(series({ tail: -0.08 }), { dropPct: 10 }).dd1m > -0.1, true)
assert.equal(S.analyze(series({ tail: -0.08 }), { dropPct: 5 }).rapid, true, 'threshold is a setting')

// window math on a hand-made month: 30 closes 100..129, then today 110
const t0 = Date.UTC(2026, 9, 1) / 1000
const month = [...Array(30)].map((_, i) => [t0 + i * DAY, 100 + i]).concat([[t0 + 30 * DAY, 110]])
const w = S.analyze(month).windows.m1
assert.equal(w.low, 100)
assert.equal(w.high, 129)
assert.ok(Math.abs(w.pos - 10 / 29) < 1e-9)
assert.ok(Math.abs(w.change - 110 / w.start + 1) < 1e-12)

// describe: facts only, and every window has a line
const d = S.describe(dip)
assert.match(d.trend, /整体上涨/)
assert.match(d.drop, /1 个月内最高价/)
assert.equal(d.compare.length, 3)
assert.match(d.level, /不是估值/)
assert.doesNotMatch(JSON.stringify(d), /买入|卖出|建议买|建议卖/)

// ---- parsing, live price, merging
const pts = series({ years: 0.2 })
const parsed = S.parseChart(chart([...pts, [pts[pts.length - 1][0] + 3600, 999]]))
assert.equal(parsed.points.length, pts.length, 'same exchange day collapses to one close')
assert.equal(parsed.points[parsed.points.length - 1][1], 999)
const holes = chart(pts)
holes.chart.result[0].indicators.quote[0].close[3] = null
assert.equal(S.parseChart(holes).points.length, pts.length - 1)
assert.throws(() => S.parseChart({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }), (e) => e.dataError && /delisted/.test(e.message))
const last = pts[pts.length - 1]
assert.equal(S.withLive(pts, { regularMarketPrice: 50, regularMarketTime: last[0] + 3 * 3600, gmtoffset: -18000 }).at(-1)[1], 50)
assert.equal(S.withLive(pts, { regularMarketPrice: 50, regularMarketTime: last[0] + DAY, gmtoffset: -18000 }).length, pts.length + 1)
const old = pts.slice(0, -5)
assert.equal(S.merge(old, pts.slice(-10)).length, pts.length)
assert.equal(S.merge(old, pts.slice(-10).map(([t, c]) => [t, c / 4])), null, 'a 4:1 split since the cache: refetch')

// ---- US only
assert.equal(S.usCheck({ currency: 'USD', exchangeName: 'NYQ', instrumentType: 'EQUITY' }), null)
assert.match(S.usCheck({ currency: 'GBp', exchangeName: 'LSE' }), /美元/)
assert.match(S.usCheck({ currency: 'USD', exchangeName: 'PNK', fullExchangeName: 'OTC Markets', instrumentType: 'EQUITY' }), /主要交易所/)
assert.match(S.usCheck({ currency: 'USD', exchangeName: 'PCX', instrumentType: 'ETF' }), /不是个股/)
assert.equal(S.normalizeSymbol(' brk.b '), 'BRK-B')
assert.equal(S.normalizeSymbol('$nvda'), 'NVDA')
for (const bad of ['7203.T', '0700.HK', 'TOOLONG', '', 'A B']) assert.equal(S.normalizeSymbol(bad), null, bad)
assert.equal(new Set(S.DEFAULT_POOL).size, S.DEFAULT_POOL.length)
assert.ok(S.DEFAULT_POOL.every((x) => S.normalizeSymbol(x) === x))

// ---- schedule (New York time, trading days)
assert.deepEqual(S.normalizeTimes('9:45，16:15 13:00 25:00 bad'), ['09:45', '13:00', '16:15'])
assert.deepEqual(S.normalizeTimes(''), S.DEFAULT_TIMES)
assert.equal(new Date(S.etToUtc(2026, 7, 1, 10, 0)).toISOString(), '2026-07-01T14:00:00.000Z') // EDT
assert.equal(new Date(S.etToUtc(2026, 11, 6, 10, 0)).toISOString(), '2026-11-06T15:00:00.000Z') // EST
const fri = Date.UTC(2026, 10, 6, 18, 5) // Fri 13:05 New York
assert.equal(S.latestSlot(fri, S.DEFAULT_TIMES).key, '2026-11-06 13:00')
assert.equal(S.nextSlot(fri, S.DEFAULT_TIMES).key, '2026-11-06 16:15')
assert.equal(S.latestSlot(Date.UTC(2026, 10, 8, 15), S.DEFAULT_TIMES).key, '2026-11-06 16:15', 'Sunday: last Friday')
assert.equal(S.nextSlot(Date.UTC(2026, 10, 7, 15), S.DEFAULT_TIMES).key, '2026-11-09 10:00', 'Saturday: next Monday')

// ---- the scanner
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ojousama-stocks-'))
;(async () => {
  try {
    const now = Date.UTC(2026, 10, 6, 18, 5)
    const data = { AAPL: series({ tail: -0.15, end: Math.floor(now / 1000) - 3 * 3600 }), MSFT: series({ seed: 11, end: Math.floor(now / 1000) - 3 * 3600 }) }
    const calls = []
    let mode = 'ok'
    const fetch = async (url) => {
      const m = url.match(/^https:\/\/(query\d)\.finance\.yahoo\.com\/v8\/finance\/chart\/([^?]+)\?range=(\w+)&interval=1d/)
      assert.ok(m, url)
      const [, host, sym, range] = m
      calls.push(`${host} ${sym} ${range}`)
      const json = (status, body) => ({ status, ok: status < 300, json: async () => body })
      if (mode === '429') return json(429, {})
      if (sym === 'NET' && host === 'query1') throw new TypeError('fetch failed')
      if (sym === 'BAD') return json(404, { chart: { result: null, error: { description: 'No data found' } } })
      if (sym === 'VOD-L') return json(200, chart(series({}), { currency: 'GBp', exchangeName: 'LSE', fullExchangeName: 'LSE' }))
      if (sym === 'SPY') return json(200, chart(series({}), { exchangeName: 'PCX', instrumentType: 'ETF' }))
      const pts = data[sym === 'NET' ? 'MSFT' : sym]
      return json(200, chart(range === '1mo' ? pts.slice(-21) : pts, { regularMarketPrice: pts.at(-1)[1], regularMarketTime: pts.at(-1)[0] + 60 }))
    }
    const settings = { stockDefaultPool: false, stockWatch: ['aapl', 'MSFT', 'VOD.L', 'SPY', 'BAD', 'NET', '???'], stockDropPct: 10 }
    const file = path.join(dir, 'stocks.json')
    const watch = new S.StockWatch({ file, fetch, settings: () => settings, sleep: async () => {}, spacing: 0, now: () => now })
    assert.deepEqual(watch.symbols(), ['AAPL', 'MSFT', 'VOD-L', 'SPY', 'BAD', 'NET'])
    let progress = 0
    const r = await watch.scan({ onProgress: () => progress++ })
    assert.equal(r.count, 3, 'AAPL, MSFT and NET (via the second host)')
    assert.deepEqual(r.dips.map((x) => x.symbol), ['AAPL'])
    assert.match(r.errors['VOD-L'], /美元/)
    assert.match(r.errors.SPY, /不是个股/)
    assert.match(r.errors.BAD, /找不到/)
    assert.ok(calls.includes('query2 NET 5y'), 'falls back to query2')
    assert.ok(progress >= 7)
    assert.ok(calls.filter((c) => c.endsWith('5y')).length >= 6)
    // Second scan the same New York day: only the last month is fetched and spliced in.
    calls.length = 0
    await watch.scan()
    assert.deepEqual(calls.filter((c) => /AAPL|MSFT/.test(c)), ['query1 AAPL 1mo', 'query1 MSFT 1mo'])
    assert.equal(watch.data.series.AAPL.points.length, data.AAPL.length)
    // Saved and reloaded.
    const again = new S.StockWatch({ file, fetch, settings: () => settings, now: () => now })
    assert.equal(Object.keys(again.data.results).length, 3)
    const view = again.view()
    assert.equal(view.items[0].symbol, 'AAPL', 'dips come first')
    assert.ok(view.items[0].spark.length >= 20 && view.items[0].spark.length <= 40)
    assert.deepEqual(view.invalid, ['???'])
    assert.ok(view.items.every((x) => x.watched))
    assert.equal(again.series('AAPL').points.length, data.AAPL.length)
    assert.ok(again.series('AAPL').fit)
    assert.match(again.contextLine(now), /AAPL/)
    // Announce each dip once per New York day.
    assert.deepEqual(again.unannounced(again.dips()).map((x) => x.symbol), ['AAPL'])
    again.markAnnounced(again.dips())
    assert.deepEqual(again.unannounced(again.dips()), [])
    // Schedule bookkeeping.
    assert.equal(again.dueSlot(now, S.DEFAULT_TIMES).key, '2026-11-06 13:00')
    again.markSlot('2026-11-06 13:00')
    assert.equal(again.dueSlot(now, S.DEFAULT_TIMES), null)
    assert.equal(again.status(now, S.DEFAULT_TIMES).next.et, '16:15')
    // Rate limited: stop early, keep the last good readings (marked stale).
    mode = '429'
    const limited = await again.scan()
    assert.match(limited.error, /限流/)
    assert.ok(again.data.results.AAPL, 'earlier reading kept')
    console.log('PASS stocks: trend/drop analysis, 1m/6m/1y comparison, US-only filter, New York schedule, caching, fallback and rate limits')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
