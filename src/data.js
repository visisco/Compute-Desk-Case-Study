// Example data only. Index levels are the public homepage snapshot (Nov 2026);
// curves, books, providers, quotes, news and fees are made up for the demo.

export const SIZE = 730 // GPU-hours per futures contract (1 GPU-month)
export const TICK = 0.01
export const IM_RATE = 0.15 // assumed initial margin, % of notional
export const FEE = 0.0005 // assumed exchange fee, $/GPU-hr

export const SKUS = {
  H100: { index: 2.92, slope: -0.006, chg: -3.1, vol: 0.9 },
  H200: { index: 3.51, slope: -0.003, chg: 2.4, vol: 1.0 },
  B200: { index: 5.64, slope: 0.004, chg: 11.8, vol: 1.4 },
  B300: { index: 7.52, slope: 0.008, chg: 41.0, vol: 2.0 },
}

export const MONTHS = ['DEC26', 'JAN27', 'FEB27', 'MAR27', 'APR27', 'MAY27', 'JUN27', 'JUL27', 'AUG27', 'SEP27', 'OCT27', 'NOV27']

export const roundTick = (x) => Math.round(x / TICK) * TICK
export const fmt = (x, d = 2) => (x ?? 0).toFixed(d)
export const usd = (x) => (x < 0 ? '-' : '') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US')
export const usdK = (x) => (Math.abs(x) >= 1e6 ? (x < 0 ? '-' : '') + '$' + (Math.abs(x) / 1e6).toFixed(2) + 'M' : usd(x))
// Symbol convention: SKU code + region (U = US) + type (F = future), then month code + year, e.g. H1UF Z26.
const MC = { JAN: 'F', FEB: 'G', MAR: 'H', APR: 'J', MAY: 'K', JUN: 'M', JUL: 'N', AUG: 'Q', SEP: 'U', OCT: 'V', NOV: 'X', DEC: 'Z' }
export const SC = { H100: 'H1', H200: 'H2', B200: 'B2', B300: 'B3' }
export const sym = (sku, m) => `${SC[sku]}UF ${MC[m.slice(0, 3)]}${m.slice(3)}`
export const skuOf = (s) => ({ H1: 'H100', H2: 'H200', B2: 'B200', B3: 'B300' })[s.slice(0, 2)]
export const contractName = (sku, m) => `${sku} US GPU-Month Future · ${m[0]}${m.slice(1, 3).toLowerCase()} 20${m.slice(3)}`
export const INSTRUMENTS = Object.keys(SKUS).flatMap((sku) => MONTHS.map((m, i) => ({ sym: sym(sku, m), sku, m, i })))
export const pct = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + '%'

export function curvePx(sku, i, drift = 0) {
  const s = SKUS[sku]
  return roundTick(s.index * (1 + s.slope * (i + 1)) + drift)
}

// Accounts stand in for participant types. Login picks one.
export const ACCOUNTS = {
  northwind: { name: 'Northwind AI', type: 'End user', kind: 'end_user', user: 'Priya Shah', email: 'priya@northwind.ai', fcm: 'Marex (FCM)', initials: 'NA' },
  helios: { name: 'Helios Cloud', type: 'Provider', kind: 'provider', user: 'Tom Okafor', email: 'tom@helios.cloud', fcm: 'StoneX (FCM)', initials: 'HC' },
  ridgeline: { name: 'Ridgeline Capital', type: 'Speculator', kind: 'spec', user: 'Ana Ruiz', email: 'ana@ridgeline.capital', fcm: 'Marex (FCM)', initials: 'RC' },
  lattice: { name: 'Lattice Trading', type: 'Market maker', kind: 'mm', user: 'Sam Lee', email: 'sam@lattice.trade', fcm: 'ADM (FCM)', initials: 'LT' },
}

const strip = (sku, from, n, qty, px) => {
  const i0 = MONTHS.indexOf(from)
  return Object.fromEntries(MONTHS.slice(i0, i0 + n).map((m) => [sym(sku, m), { qty, avg: px }]))
}

export const SEED = {
  northwind: {
    cash: 1_500_000,
    positions: { ...strip('H100', 'JUN27', 6, 64, 2.5), [sym('B200', 'MAR27')]: { qty: 32, avg: 5.58 } },
    closed: [
      { sym: sym('H100', 'OCT26'), qty: 64, entry: 2.48, exit: 2.95, how: 'Cash settled (Oct index avg)', date: '2026-10-30' },
      { sym: sym('H100', 'NOV26'), qty: 32, entry: 2.61, exit: 2.9, how: 'Closed on CLOB', date: '2026-11-04' },
    ],
  },
  helios: {
    cash: 2_200_000,
    positions: { ...strip('H100', 'JUN27', 6, -64, 2.7), [sym('B200', 'JAN27')]: { qty: -128, avg: 5.7 } },
    closed: [{ sym: sym('H100', 'OCT26'), qty: -128, entry: 2.98, exit: 2.95, how: 'Cash settled (Oct index avg)', date: '2026-10-30' }],
  },
  ridgeline: {
    cash: 4_000_000,
    positions: { [sym('B200', 'MAR27')]: { qty: 200, avg: 5.62 }, [sym('B200', 'SEP27')]: { qty: -200, avg: 5.71 }, [sym('B300', 'FEB27')]: { qty: 60, avg: 7.41 } },
    closed: [{ sym: sym('B300', 'NOV26'), qty: 40, entry: 6.9, exit: 7.38, how: 'Closed on CLOB', date: '2026-11-06' }],
  },
  lattice: {
    cash: 10_000_000,
    positions: { [sym('H100', 'JAN27')]: { qty: 120, avg: 2.9 }, [sym('H100', 'FEB27')]: { qty: -80, avg: 2.89 }, [sym('B200', 'DEC26')]: { qty: -40, avg: 5.67 } },
    closed: [{ sym: sym('H100', 'NOV26'), qty: 0, entry: 2.9, exit: 2.9, how: 'Flattened intraday (1,240 contracts round-trip)', date: '2026-11-10' }],
  },
}

export const NEWS = [
  { t: '2h', tag: 'Index', head: 'B300 1Y rate up 41% over 90 days as Blackwell Ultra clusters sell out', body: 'Compute Signal B300 printed $7.52. Forward curve in steep contango through Q3 2027.' },
  { t: '5h', tag: 'Market', head: 'H100 curve backwardated: market pricing in Blackwell substitution', body: 'H100 Jun27 trades $0.13 under the index. Providers selling forward to lock revenue.' },
  { t: '1d', tag: 'Regulatory', head: 'CFTC comment period on compute derivatives closes Dec 15', body: 'Request for comment covers benchmark governance and physical delivery links.' },
  { t: '2d', tag: 'Insight', head: 'EFP volume: 18% of physical contracts now originate from futures', body: 'Labs increasingly hedge first, then convert to capacity 2–3 months before start.' },
]

// Provider quotes for an RFQ / EFP request. Basis is $/GPU-hr over the reference.
export const PROVIDERS = [
  { id: 'P-A', name: 'Provider A', region: 'US-East', ic: 'InfiniBand', tier: 'Tier 1', basis: 0.08, uptime: 99.5, delay: 1200 },
  { id: 'P-C', name: 'Provider C', region: 'US-East', ic: 'RoCE', tier: 'Tier 2', basis: 0.06, uptime: 99.0, delay: 2200 },
  { id: 'P-B', name: 'Provider B', region: 'EU-West', ic: 'InfiniBand', tier: 'Tier 1', basis: 0.05, uptime: 99.5, delay: 3000 },
  { id: 'P-D', name: 'Provider D', region: 'US-Central', ic: 'InfiniBand', tier: 'Tier 2', basis: 0.12, uptime: 99.5, delay: 3800 },
]

export function scoreQuote(q, req) {
  const fails = []
  if (req.region === 'Any US' ? !q.region.startsWith('US') : q.region !== req.region) fails.push(`Region ${q.region}`)
  const adj = q.ic === 'RoCE' && req.ic === 'InfiniBand' ? 0.04 : 0 // assumed basis-table adjustment
  const norm = q.basis + adj
  if (norm > req.maxBasis) fails.push(`Basis ${fmt(norm, 3)} > max ${fmt(req.maxBasis, 3)}`)
  const score = Math.max(0, Math.round(100 - norm * 300 - (q.tier === 'Tier 2' ? 8 : 0) - (99.5 - q.uptime) * 10))
  return { ...q, adj, norm, fails, score: fails.length ? 0 : score }
}

export const SEED_CONTRACTS = [
  {
    id: 'PC-1042', sku: 'B200', gpus: 128, months: 12, start: 'SEP26', price: 5.71, buyer: 'Northwind AI', provider: 'Helios Cloud', via: 'RFQ',
    stage: 5, failed: false, month: 2, uptime: 99.71,
    log: ['Contract signed via RFQ', 'Escrow funded: month 1', 'Bond posted', 'Nodes handed over (16 nodes)', 'Acceptance passed', 'Delivery live', 'Month 1 settled', 'Month 2 settled'],
  },
]

export const INCOMING = [
  { id: 'RFQ-2291', kind: 'RFQ', sku: 'B200', gpus: 256, region: 'US-East', ic: 'InfiniBand', start: 'JAN27', term: 12, maxBasis: 0.15, closes: '2h 10m', buyer: 'Buyer (blind)', quotes: 3 },
  { id: 'EFP-0187', kind: 'EFP', sku: 'H100', gpus: 64, region: 'US-East', ic: 'InfiniBand', start: 'JUN27', term: 6, maxBasis: 0.15, closes: '45m', buyer: 'Buyer (blind)', quotes: 2 },
  { id: 'RFQ-2288', kind: 'RFQ', sku: 'H100', gpus: 64, region: 'Any US', ic: 'InfiniBand', start: 'DEC26', term: 6, maxBasis: 0.1, closes: '5h 40m', buyer: 'Buyer (blind)', quotes: 1 },
]
