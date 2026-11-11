import { TICK, SKUS, roundTick, skuOf } from './data.js'

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

export function book(s, mid, tick, levels = 12) {
  const r = rng(s + 'book' + Math.floor(tick / 2))
  const bids = [], asks = []
  for (let i = 0; i < levels; i++) {
    asks.push({ px: roundTick(mid + TICK * (i + 1)), q: Math.round(8 + r() * 60 + i * 6) })
    bids.push({ px: roundTick(mid - TICK * (i + 1)), q: Math.round(8 + r() * 60 + i * 6) })
  }
  return { bids, asks }
}
