import { TICK, SKUS, roundTick, skuOf, INSTRUMENTS } from './data.js'

// Deterministic pseudo-random numbers, so history looks the same on every render.
export function rng(seedStr) {
  let h = 2166136261
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const TF = { '1H': { n: 60, label: '1m bars' }, '1D': { n: 96, label: '15m bars' }, '1W': { n: 84, label: '2h bars' }, '1M': { n: 90, label: '8h bars' } }

// Candles walk backwards from the live mark so the last bar always ends at the current price.
export function candles(s, last, tf) {
  const sku = skuOf(s)
  const r = rng(s + tf)
  const n = TF[tf].n
  const vol = SKUS[sku].vol * 0.004 * last * (tf === '1H' ? 0.4 : tf === '1D' ? 0.8 : tf === '1W' ? 1.6 : 2.4)
  const out = []
  let close = last
  for (let i = 0; i < n; i++) {
    const open = close - (r() - 0.48) * vol
    const hi = Math.max(open, close) + r() * vol * 0.6
    const lo = Math.min(open, close) - r() * vol * 0.6
    out.unshift({ o: open, h: hi, l: lo, c: close, v: Math.round(20 + r() * 180) })
    close = open
  }
  return out
}

export function stats24(s, mark) {
  const r = rng(s + 'stats')
  const chg = (r() - 0.45) * 0.035 * SKUS[skuOf(s)].vol
  return { chg: chg * 100, open: mark / (1 + chg), vol: Math.round(400 + r() * 5200), oi: Math.round(1200 + r() * 9000) }
}

// Front months are tight and deep; back months and newer SKUs are wider and thinner.
export function liquidity(s) {
  const ins = INSTRUMENTS.find((x) => x.sym === s)
  const m = ins ? ins.i : 0
  const k = s.startsWith('B3') ? 0.45 : s.startsWith('H2') ? 0.75 : s.startsWith('B2') ? 0.85 : 1
  return { half: 1 + Math.floor(m / 4) + (s.startsWith('B3') ? 1 : 0), liq: Math.max(0.2, 1 - m * 0.07) * k }
}

// Top of book and depth (first n levels each side) for tables and the instrument bar.
export function top(s, mid, tick, n = 5) {
  const b = book(s, mid, tick, n)
  return { bid: b.bids[0], ask: b.asks[0], spread: b.asks[0].px - b.bids[0].px, depth: b.bids.reduce((a, l) => a + l.q, 0) + b.asks.reduce((a, l) => a + l.q, 0) }
}

export function book(s, mid, tick, levels = 12) {
  const r = rng(s + 'book' + Math.floor(tick / 2))
  const bids = [], asks = []
  const { half, liq } = liquidity(s)
  for (let i = 0; i < levels; i++) {
    asks.push({ px: roundTick(mid + TICK * (i + half)), q: Math.max(1, Math.round((8 + r() * 60 + i * 6) * liq)) })
    bids.push({ px: roundTick(mid - TICK * (i + half)), q: Math.max(1, Math.round((8 + r() * 60 + i * 6) * liq)) })
  }
  return { bids, asks }
}

// Walk the book for an order. Returns the fills by level, the filled size, the average price
// and what is left. Market orders take every level shown; limits stop at their price.
export function simulate(s, mid, tick, side, qty, type, limit) {
  const b = book(s, mid, tick, 12)
  const levels = side === 'Buy' ? b.asks : b.bids
  const fills = []
  let left = qty
  for (const l of levels) {
    if (left <= 0) break
    if (type === 'Limit' && (side === 'Buy' ? l.px > limit + 1e-9 : l.px < limit - 1e-9)) break
    const q = Math.min(left, l.q)
    fills.push({ px: l.px, q })
    left -= q
  }
  const filled = qty - left
  const avg = filled ? fills.reduce((a, f) => a + f.px * f.q, 0) / filled : 0
  const depthAll = levels.reduce((a, l) => a + l.q, 0)
  return { fills, filled, avg, left, slip: filled ? Math.abs(avg - mid) : 0, exhausted: type === 'Market' && left > 0, depthAll }
}

// How many contracts can trade within n ticks of mid on one side.
export function within(s, mid, tick, side, n) {
  const b = book(s, mid, tick, 12)
  return (side === 'Buy' ? b.asks : b.bids).slice(0, n).reduce((a, l) => a + l.q, 0)
}
