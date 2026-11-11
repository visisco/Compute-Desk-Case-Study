// Example data only. Index levels are the public homepage snapshot (Nov 2026);
// curves, books, providers, quotes and fees are made up for the demo.

export const SIZE = 730 // GPU-hours per futures contract (1 GPU-month)
export const TICK = 0.01 // tentative per contract-spec thread
export const IM_RATE = 0.15 // assumed initial margin, % of notional

export const SKUS = {
  H100: { index: 2.92, slope: -0.006, chg: '-3.1%' },
  H200: { index: 3.51, slope: -0.003, chg: '+2.4%' },
  B200: { index: 5.64, slope: 0.004, chg: '+11.8%' },
  B300: { index: 7.52, slope: 0.008, chg: '+41.0%' },
}

export const MONTHS = ['DEC26', 'JAN27', 'FEB27', 'MAR27', 'APR27', 'MAY27', 'JUN27', 'JUL27', 'AUG27', 'SEP27', 'OCT27', 'NOV27']

export const roundTick = (x) => Math.round(x / TICK) * TICK
export const fmt = (x, d = 3) => (x ?? 0).toFixed(d)
export const usd = (x) => (x < 0 ? '-' : '') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US')
export const sym = (sku, m) => `${sku}-${m}`

export function curvePx(sku, i, drift = 0) {
  const s = SKUS[sku]
  return roundTick(s.index * (1 + s.slope * (i + 1)) + drift)
}

export const ROLES = {
  end_user: { label: 'End user', who: 'Northwind AI (lab)', tabs: ['onboard', 'markets', 'trader', 'efp', 'delivery', 'api'], home: 'efp' },
  provider: { label: 'Provider', who: 'Helios Cloud (neocloud)', tabs: ['onboard', 'markets', 'trader', 'efp', 'delivery', 'api'], home: 'trader' },
  spec: { label: 'Speculator', who: 'Ridgeline Capital (fund)', tabs: ['onboard', 'markets', 'api'], home: 'markets' },
  mm: { label: 'Market maker', who: 'Lattice Trading (MM)', tabs: ['onboard', 'markets', 'api'], home: 'api' },
}

export const TABS = {
  onboard: 'Onboard',
  markets: 'Futures',
  trader: 'Physical RFQ',
  efp: 'EFP',
  delivery: 'Delivery',
  api: 'API',
}

const strip = (sku, from, n, qty, px) => {
  const i0 = MONTHS.indexOf(from)
  return Object.fromEntries(MONTHS.slice(i0, i0 + n).map((m) => [sym(sku, m), { qty, avg: px }]))
}

export const SEED_POSITIONS = {
  end_user: strip('H100', 'JUN27', 6, 64, 2.5),
  provider: strip('H100', 'JUN27', 6, -64, 2.7),
  spec: { 'B200-MAR27': { qty: 20, avg: 5.62 }, 'B200-SEP27': { qty: -20, avg: 5.71 } },
  mm: { 'H100-JAN27': { qty: 12, avg: 2.9 }, 'H100-FEB27': { qty: -8, avg: 2.895 } },
}

// Lifecycle stages per ICP (mirrors the spec's lifecycle table)
export const LIFECYCLE = {
  end_user: [
    ['Onboard', 'KYB, credit check, FCM account for futures'],
    ['Fund', 'Futures margin at FCM; physical: 1 month prepaid into escrow'],
    ['Discover price', 'Index, forward curve, RFQ quotes'],
    ['Trade', 'Buy futures to hedge; post RFQ; request EFP'],
    ['Post-trade', 'Confirms, positions, daily variation margin via FCM'],
    ['Deliver', 'Nodes handed over, acceptance check, daily health'],
    ['Close', 'Offset, cash settle, or EFP; escrow released monthly'],
  ],
  provider: [
    ['Onboard', 'KYB, data-centre due diligence, attestation agent, FCM account'],
    ['Fund', 'Futures margin at FCM; physical: performance bond (cash or LC)'],
    ['Discover price', 'Index, curve, open RFQs and EFP requests'],
    ['Trade', 'Sell futures to hedge; quote RFQs; quote basis on EFPs'],
    ['Post-trade', 'Contract signed, escrow funded, positions'],
    ['Deliver', 'Hand over nodes, attestation evidence, SLA reporting'],
    ['Close', 'Escrow paid monthly in arrears; bond released at term end'],
  ],
  spec: [
    ['Onboard', 'KYC via FCM, API keys'],
    ['Fund', 'Margin at FCM'],
    ['Discover price', 'Order book, curve, calendar and SKU spreads'],
    ['Trade', 'Orders and spreads on the CLOB (UI, FIX or WebSocket)'],
    ['Post-trade', 'Drop copy, positions, P&L'],
    ['Deliver', 'Not applicable: financial only'],
    ['Close', 'Offset, or cash settle vs monthly index average'],
  ],
  mm: [
    ['Onboard', 'KYC via FCM, MM agreement, FIX certification'],
    ['Fund', 'Margin at FCM; fee rebates by MM tier'],
    ['Discover price', 'Order book, index ticks, reference data'],
    ['Trade', 'Two-sided mass quotes with obligations (size, spread, uptime)'],
    ['Post-trade', 'Drop copy, real-time risk, inventory hedging'],
    ['Deliver', 'Not applicable: financial only'],
    ['Close', 'Flatten or roll before expiry'],
  ],
}

// Provider quotes for an RFQ / EFP request. Basis is $/GPU-hr over the index.
export function makeQuotes(req) {
  const base = [
    { id: 'P-A', name: 'Provider A', region: 'US-East', ic: 'InfiniBand', tier: 'Tier 1', basis: 0.08, uptime: 99.5 },
    { id: 'P-B', name: 'Provider B', region: 'EU-West', ic: 'InfiniBand', tier: 'Tier 1', basis: 0.05, uptime: 99.5 },
    { id: 'P-C', name: 'Provider C', region: 'US-East', ic: 'RoCE', tier: 'Tier 2', basis: 0.06, uptime: 99.0 },
    { id: 'P-D', name: 'Provider D', region: 'US-Central', ic: 'InfiniBand', tier: 'Tier 2', basis: 0.12, uptime: 99.5 },
  ]
  return base
    .map((q) => {
      const fails = []
      if (req.region !== 'Any US' && q.region !== req.region) fails.push(`Region ${q.region}`)
      if (req.region === 'Any US' && !q.region.startsWith('US')) fails.push(`Region ${q.region}`)
      // RoCE normalised to the index's InfiniBand reference spec (assumed basis table)
      const adj = q.ic === 'RoCE' && req.ic === 'InfiniBand' ? 0.04 : 0
      const norm = q.basis + adj
      if (norm > req.maxBasis) fails.push(`Basis ${fmt(norm)} > max ${fmt(req.maxBasis)}`)
      const score = Math.max(0, Math.round(100 - norm * 300 - (q.tier === 'Tier 2' ? 8 : 0) - (99.5 - q.uptime) * 10))
      return { ...q, adj, norm, fails, score: fails.length ? 0 : score }
    })
    .sort((a, b) => b.score - a.score)
}

export const SEED_CONTRACTS = [
  {
    id: 'PC-1042', sku: 'B200', gpus: 128, months: 12, start: 'SEP26', price: 5.71, provider: 'Provider A', via: 'RFQ',
    stage: 6, failed: false, month: 3, uptime: 99.7,
    log: ['Contract signed via RFQ', 'Escrow funded: month 1', 'Bond posted', 'Nodes handed over (16 nodes)', 'Acceptance passed', 'Month 1 settled', 'Month 2 settled'],
  },
]
