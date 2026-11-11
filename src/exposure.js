// Exposure model and hedge finder. Pure functions, no React.
// Sign convention: + = long compute (you lose if prices fall), - = short compute (you lose if prices rise).
// One futures contract = 1 GPU for one month, so contracts and GPUs add directly.
import { SKUS, MONTHS, SIZE, IM_RATE, INSTRUMENTS, sym } from './data.js'

export const TYPES = {
  need: { label: 'Total need', side: -1, who: 'buyer', hint: 'GPUs you will need in that month, contracted or not' },
  rent_fixed: { label: 'Contracted, fixed price', side: 1, who: 'buyer', hint: 'Reserved capacity at a locked $/GPU-hr' },
  rent_float: { label: 'Contracted, floating price', side: 0, who: 'buyer', hint: 'On-demand or index-linked rental: GPUs secured, price not' },
  fleet: { label: 'Fleet capacity', side: 1, who: 'provider', hint: 'GPUs you own or lease and can sell' },
  sold_fixed: { label: 'Sold, fixed price', side: -1, who: 'provider', hint: 'Capacity sold at a locked $/GPU-hr' },
  sold_float: { label: 'Sold, floating price', side: 0, who: 'provider', hint: 'Capacity sold at an index-linked or spot price' },
}
const ALIAS = {
  need: 'need', demand: 'need', required: 'need', total_need: 'need',
  rent_fixed: 'rent_fixed', reserved: 'rent_fixed', reserved_fixed: 'rent_fixed', fixed_rental: 'rent_fixed', contracted_fixed: 'rent_fixed',
  rent_float: 'rent_float', reserved_float: 'rent_float', on_demand: 'rent_float', floating_rental: 'rent_float', contracted_floating: 'rent_float',
  fleet: 'fleet', capacity: 'fleet', supply: 'fleet',
  sold_fixed: 'sold_fixed', sold: 'sold_fixed', contracted_revenue: 'sold_fixed',
  sold_float: 'sold_float', sold_floating: 'sold_float', sold_index: 'sold_float',
}
export const REGIONS = ['US-East', 'US-Central', 'US-West', 'EU-West', 'APAC']

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const absOf = (m) => (2000 + +m.slice(3)) * 12 + MON.indexOf(m.slice(0, 3))
const ABS0 = absOf(MONTHS[0])
export const monthLabel = (m) => m[0] + m.slice(1, 3).toLowerCase() + ' ' + m.slice(3)
export function period(start, n) {
  const a = absOf(start) + n - 1
  const end = MON[a % 12] + String(Math.floor(a / 12)).slice(-2)
  return n === 1 ? monthLabel(start) : `${monthLabel(start).slice(0, 3)} ${start.slice(3)}–${monthLabel(end)}`
}
export const span = (from, n) => {
  const i = MONTHS.indexOf(from)
  return n === 1 ? monthLabel(from) : `${monthLabel(from).slice(0, 3)}–${monthLabel(MONTHS[i + n - 1])}`
}

// Accepts DEC26, Dec 2026, Dec-26, 2026-12.
export function parseMonth(s) {
  const t = String(s || '').trim().toUpperCase()
  let m = t.match(/^([A-Z]{3})[A-Z]*[\s\-'/]*(\d{2}|\d{4})$/)
  if (m && MON.includes(m[1])) return m[1] + m[2].slice(-2)
  m = t.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m && +m[2] >= 1 && +m[2] <= 12) return MON[+m[2] - 1] + m[1].slice(-2)
  return null
}

export const TEMPLATE = `type,sku,region,start,months,gpus,price,counterparty,notes
need,H100,US-East,2026-12,6,384,,,Pre-training run
rent_fixed,H100,US-East,2026-12,12,256,2.85,Provider A,1-yr reserved cluster
rent_float,B200,US-East,2026-12,3,64,,Cloud X,On-demand (index-linked)
need,B200,US-East,2027-03,9,448,,,Migration to Blackwell
fleet,H100,US-East,2026-12,12,1024,,,Provider example: owned fleet
sold_fixed,H100,US-East,2026-12,9,512,2.95,3 labs,Provider example: contracted revenue
`

function splitCsv(line) {
  const out = []
  let cur = '', q = false
  for (const c of line) {
    if (c === '"') q = !q
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((x) => x.trim())
}

// Returns { rows, errors } where errors are { line, msg }.
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
  if (!lines.length) return { rows: [], errors: [{ line: 0, msg: 'The file is empty.' }] }
  const head = splitCsv(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''))
  const col = (names) => head.findIndex((h) => names.includes(h))
  const ix = { type: col(['type', 'kind', 'category']), sku: col(['sku', 'gpu', 'gputype', 'model']), region: col(['region', 'location']), start: col(['start', 'startmonth', 'from']), months: col(['months', 'term', 'tenor', 'duration']), gpus: col(['gpus', 'qty', 'quantity', 'count']), price: col(['price', 'rate', 'pricegpuhr']), cp: col(['counterparty', 'provider', 'customer']), notes: col(['notes', 'note', 'description', 'label']) }
  const missing = ['type', 'sku', 'start', 'months', 'gpus'].filter((k) => ix[k] < 0)
  if (missing.length) return { rows: [], errors: [{ line: 1, msg: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` }] }
  const rows = [], errors = []
  lines.slice(1).forEach((l, i) => {
    const c = splitCsv(l), n = i + 2
    const type = ALIAS[(c[ix.type] || '').toLowerCase().replace(/[\s-]+/g, '_')]
    const sku = (c[ix.sku] || '').toUpperCase().replace(/\s/g, '')
    const start = parseMonth(c[ix.start])
    const months = parseInt(c[ix.months], 10), gpus = parseInt(String(c[ix.gpus]).replace(/,/g, ''), 10)
    const bad = []
    if (!type) bad.push(`unknown type "${c[ix.type]}"`)
    if (!SKUS[sku]) bad.push(`unknown SKU "${c[ix.sku]}"`)
    if (!start) bad.push(`can't read start "${c[ix.start]}"`)
    if (!(months > 0)) bad.push('months must be 1 or more')
    if (!(gpus > 0)) bad.push('gpus must be 1 or more')
    if (bad.length) return errors.push({ line: n, msg: bad.join('; ') })
    const region = ix.region >= 0 && c[ix.region] ? c[ix.region] : 'US-East'
    rows.push({ type, sku, region, start, months, gpus, price: ix.price >= 0 && c[ix.price] ? +c[ix.price] : null, cp: ix.cp >= 0 ? c[ix.cp] : '', notes: ix.notes >= 0 ? c[ix.notes] : '', src: 'CSV' })
  })
  return { rows, errors }
}

export const toCsv = (lines) => TEMPLATE.split('\n')[0] + '\n' + lines.map((l) => [l.type, l.sku, l.region, l.start, l.months, l.gpus, l.price ?? '', l.cp || '', l.notes || ''].map((v) => (String(v).includes(',') ? `"${v}"` : v)).join(',')).join('\n')

// Month offsets (0..11 on the listed curve) a line covers, plus GPU-months beyond the curve.
function cover(l) {
  const a = absOf(l.start) - ABS0
  const idx = []
  let beyond = 0
  for (let k = 0; k < l.months; k++) {
    const i = a + k
    if (i >= 0 && i < MONTHS.length) idx.push(i)
    else if (i >= MONTHS.length) beyond += l.gpus
  }
  return { idx, beyond }
}

// Physical CDX contracts the account is party to become locked, fixed-price lines.
export function contractLines(contracts, me) {
  return contracts.filter((c) => c.buyer === me.name || c.provider === me.name).map((c) => ({
    id: c.id, type: c.buyer === me.name ? 'rent_fixed' : 'sold_fixed', sku: c.sku, region: 'US-East', start: c.start, months: c.months, gpus: c.gpus, price: c.price,
    cp: c.buyer === me.name ? c.provider : c.buyer, notes: `Node-Month Contract ${c.id}`, src: 'CDX', locked: true,
  }))
}

const zero = () => Object.fromEntries(Object.keys(SKUS).map((k) => [k, MONTHS.map(() => 0)]))

export function computeExposure(lines, positions) {
  const phys = zero(), fut = zero(), need = zero(), secured = zero(), fleet = zero(), sold = zero(), regional = []
  let beyond = 0
  for (const l of lines) {
    const t = TYPES[l.type], { idx, beyond: b } = cover(l)
    beyond += b
    for (const i of idx) {
      phys[l.sku][i] += t.side * l.gpus
      if (l.type === 'need') need[l.sku][i] += l.gpus
      if (l.type === 'rent_fixed' || l.type === 'rent_float') secured[l.sku][i] += l.gpus
      if (l.type === 'fleet') fleet[l.sku][i] += l.gpus
      if (l.type === 'sold_fixed' || l.type === 'sold_float') sold[l.sku][i] += l.gpus
    }
    if (!l.region.startsWith('US') && idx.length && t.side !== 0) regional.push({ ...l, idx })
  }
  for (const [s, p] of Object.entries(positions)) {
    const ins = INSTRUMENTS.find((x) => x.sym === s)
    if (ins) fut[ins.sku][ins.i] += p.qty
  }
  const net = zero()
  for (const k of Object.keys(SKUS)) MONTHS.forEach((_, i) => (net[k][i] = phys[k][i] + fut[k][i]))
  return { phys, fut, net, need, secured, fleet, sold, regional, beyond }
}

export function metrics(ex, marks, shock = 0.1) {
  let gross = 0, open = 0, risk = 0, hedged = 0
  for (const k of Object.keys(SKUS)) MONTHS.forEach((m, i) => {
    const p = ex.phys[k][i], h = ex.net[k][i] - p // h = futures, plus any planned hedges
    gross += Math.abs(p)
    if (p * h < 0) hedged += Math.min(Math.abs(p), Math.abs(h))
    open += Math.abs(ex.net[k][i])
    risk += Math.abs(ex.net[k][i]) * SIZE * marks[sym(k, m)] * shock
  })
  return { gross, open, risk, cover: gross ? hedged / gross : 1 }
}

const r8 = (x) => Math.round(x / 8) * 8
const avgPx = (legs, marks) => legs.reduce((a, l) => a + marks[l.sym], 0) / legs.length
const imOf = (legs, marks) => legs.reduce((a, l) => a + l.qty * SIZE * marks[l.sym] * IM_RATE, 0)

// Suggest hedges that bring open exposure towards (1 - ratio) of today's level.
// Order: GPU-vs-GPU spreads, then outright strips / futures / block RFQs, then physical actions.
export function findHedges(ex, marks, ratio, kind) {
  const skus = Object.keys(SKUS)
  const want = Object.fromEntries(skus.map((k) => [k, ex.net[k].map((v) => -Math.round(v * ratio))])) // + = buy futures
  const out = []
  let n = 0

  // 1. Spreads: sell one SKU and buy another over the same months.
  for (const a of skus) for (const b of skus) {
    if (a === b) continue
    let i = 0
    while (i < MONTHS.length) {
      const q = (j) => (want[a][j] < 0 && want[b][j] > 0 ? Math.min(-want[a][j], want[b][j]) : 0)
      if (q(i) < 8) { i++; continue }
      let j = i
      while (j + 1 < MONTHS.length && q(j + 1) >= 8) j++
      const len = j - i + 1
      if (len >= 2) {
        const qty = r8(Math.min(...MONTHS.slice(i, j + 1).map((_, k) => q(i + k))))
        if (qty >= 8) {
          const legs = MONTHS.slice(i, j + 1).flatMap((m) => [{ sym: sym(b, m), side: 'Buy', qty, sku: b, i: MONTHS.indexOf(m) }, { sym: sym(a, m), side: 'Sell', qty, sku: a, i: MONTHS.indexOf(m) }])
          for (let k = i; k <= j; k++) { want[a][k] += qty; want[b][k] -= qty }
          const spread = avgPx(legs.filter((l) => l.side === 'Buy'), marks) - avgPx(legs.filter((l) => l.side === 'Sell'), marks)
          out.push({
            id: 'H' + ++n, kind: 'Spread', sku: b, side: 'Buy', qty, from: MONTHS[i], n: len, legs,
            title: `Buy ${b} / sell ${a} spread · ${span(MONTHS[i], len)}`,
            why: `You're long ${a} and short ${b} over the same months, typically excess ${a} capacity during a move to ${b}. One spread trade hedges both and costs less margin than two outrights.`,
            px: spread, pxLabel: `${b}–${a} spread`, im: imOf(legs, marks) * 0.5,
            go: { label: 'Request spread quote', tab: 'request', prefill: { kind: 'Spread', a: sym(b, MONTHS[i]), b: sym(a, MONTHS[i]), side: 'Buy', qty } },
          })
        }
      }
      i = j + 1
    }
  }

  // 2. Outrights: group months with the same side and a similar size into strips.
  for (const k of skus) {
    let i = 0
    while (i < MONTHS.length) {
      const v = want[k][i]
      if (Math.abs(v) < 8) { i++; continue }
      let j = i
      while (j + 1 < MONTHS.length && Math.sign(want[k][j + 1]) === Math.sign(v) && Math.abs(want[k][j + 1]) >= 8 && Math.abs(Math.abs(want[k][j + 1]) - Math.abs(v)) <= Math.abs(v) * 0.25) j++
      const len = j - i + 1
      const qty = r8(MONTHS.slice(i, j + 1).reduce((a, _, x) => a + Math.abs(want[k][i + x]), 0) / len)
      const side = v > 0 ? 'Buy' : 'Sell'
      if (qty >= 8) {
        const legs = MONTHS.slice(i, j + 1).map((m) => ({ sym: sym(k, m), side, qty, sku: k, i: MONTHS.indexOf(m) }))
        const block = qty >= 200
        const kindL = block ? 'Block RFQ' : len > 1 ? 'Strip' : 'Future'
        const verb = side === 'Buy' ? 'rise' : 'fall'
        out.push({
          id: 'H' + ++n, kind: kindL, sku: k, side, qty, from: MONTHS[i], n: len, legs,
          title: `${side} ${qty} ${k} ${len > 1 ? 'strip' : 'future'} · ${span(MONTHS[i], len)}`,
          why: `${side === 'Sell' ? (kind === 'provider' ? 'Unsold capacity' : 'Excess contracted capacity') : (kind === 'provider' ? 'Capacity sold short' : 'Uncovered demand')}: ${qty * len} GPU-months lose money if ${k} rates ${verb}.${block ? ` At ${qty} contracts a month this is larger than the visible book, so ask market makers for one block price instead of walking the screen.` : len > 1 ? ' A strip trades each month as a separate contract on the order book, in one ticket.' : ''}`,
          px: avgPx(legs, marks), pxLabel: len > 1 ? 'Strip avg' : 'Mark', im: imOf(legs, marks),
          go: block
            ? { label: 'Request block quote', tab: 'trade', focus: legs[0].sym, prefill: len > 1 ? { strip: { sku: k, from: MONTHS[i], n: len, side, qty }, rfq: { side, qty } } : { rfq: { side, qty } } }
            : len > 1
              ? { label: 'Open strip in Trade', tab: 'trade', focus: legs[0].sym, prefill: { strip: { sku: k, from: MONTHS[i], n: len, side, qty } } }
              : { label: 'Open in Trade', tab: 'trade', focus: legs[0].sym },
        })
        for (let x = i; x <= j; x++) want[k][x] -= Math.sign(v) * Math.min(qty, Math.abs(want[k][x]))
      }
      i = j + 1
    }
  }

  // 3. Convert to Physical: a futures hedge in a near month where GPUs are still not secured (or not sold).
  for (const k of skus) for (let i = 0; i < 4; i++) {
    const f = ex.fut[k][i]
    const gap = kind === 'provider' ? ex.fleet[k][i] - ex.sold[k][i] : ex.need[k][i] - ex.secured[k][i]
    const ok = kind === 'provider' ? f < 0 : f > 0
    const qty = Math.floor(Math.min(Math.abs(f), gap) / 8) * 8
    if (ok && qty >= 8) out.push({
      id: 'H' + ++n, kind: 'EFP', sku: k, side: kind === 'provider' ? 'Sell' : 'Buy', qty, from: MONTHS[i], n: 1, legs: [],
      title: `Convert ${qty} ${k} ${monthLabel(MONTHS[i])} futures to physical`,
      why: kind === 'provider'
        ? `You're short ${Math.abs(f)} ${sym(k, MONTHS[i])} and still have ${gap} unsold GPUs that month. Swap the short for a Node-Month Contract with a buyer: the price stays locked and the capacity is sold.`
        : `You hold ${f} ${sym(k, MONTHS[i])} but ${gap} GPUs that month aren't secured yet. Convert the hedge into a Node-Month Contract: the price stays locked and you get the nodes.`,
      px: marks[sym(k, MONTHS[i])], pxLabel: 'Futures mark', im: 0, physical: true,
      go: { label: 'Convert to Physical', tab: 'convert', prefill: { kind: 'EFP', sku: k, start: MONTHS[i], gpus: qty, term: 1 } },
    })
  }

  // 4. Non-US exposure: futures settle on the US index, so ask for a regional physical price.
  for (const l of ex.regional) out.push({
    id: 'H' + ++n, kind: 'Regional RFQ', sku: l.sku, side: TYPES[l.type].side < 0 ? 'Buy' : 'Sell', qty: l.gpus, from: MONTHS[l.idx[0]], n: l.idx.length, legs: [],
    title: `${l.region} ${l.sku}: lock the regional price`,
    why: `${l.gpus} GPUs in ${l.region} (${l.notes || TYPES[l.type].label}). The US futures above hedge the rate level, but not the ${l.region} premium. A fixed-price physical RFQ in-region removes that basis risk.`,
    px: null, im: 0, physical: true, region: l.region,
    go: { label: 'Request regional quote', tab: 'request', prefill: { kind: 'RFQ', sku: l.sku, start: MONTHS[l.idx[0]], region: l.region, gpus: l.gpus, term: l.idx.length } },
  })
  return out
}

// Exposure after the selected hedges: futures and spread legs only (physical actions keep price exposure as is).
export function applyHedges(ex, hedges) {
  const net = Object.fromEntries(Object.entries(ex.net).map(([k, v]) => [k, [...v]]))
  for (const h of hedges) for (const l of h.legs) net[l.sku][l.i] += (l.side === 'Buy' ? 1 : -1) * l.qty
  return { ...ex, net }
}

export const SAMPLES = {
  end_user: [
    { type: 'need', sku: 'H100', region: 'US-East', start: 'DEC26', months: 6, gpus: 384, price: null, cp: '', notes: 'Pre-training run' },
    { type: 'need', sku: 'H100', region: 'US-East', start: 'JUN27', months: 6, gpus: 128, price: null, cp: '', notes: 'Inference after migration' },
    { type: 'rent_fixed', sku: 'H100', region: 'US-East', start: 'DEC26', months: 12, gpus: 256, price: 2.85, cp: 'Provider A', notes: '1-yr reserved cluster' },
    { type: 'need', sku: 'B200', region: 'US-East', start: 'DEC26', months: 3, gpus: 192, price: null, cp: '', notes: 'Eval and fine-tuning' },
    { type: 'need', sku: 'B200', region: 'US-East', start: 'MAR27', months: 9, gpus: 448, price: null, cp: '', notes: 'Migration to Blackwell' },
    { type: 'rent_float', sku: 'B200', region: 'US-East', start: 'DEC26', months: 3, gpus: 64, price: null, cp: 'Cloud X', notes: 'On-demand, index-linked' },
    { type: 'need', sku: 'H100', region: 'EU-West', start: 'JAN27', months: 6, gpus: 64, price: null, cp: '', notes: 'EU inference (data residency)' },
  ],
  provider: [
    { type: 'fleet', sku: 'H100', region: 'US-East', start: 'DEC26', months: 12, gpus: 1024, price: null, cp: '', notes: 'Ashburn halls 1–2' },
    { type: 'sold_fixed', sku: 'H100', region: 'US-East', start: 'DEC26', months: 9, gpus: 512, price: 2.95, cp: '3 labs', notes: 'Term contracts' },
    { type: 'sold_float', sku: 'H100', region: 'US-East', start: 'DEC26', months: 12, gpus: 128, price: null, cp: 'Marketplace', notes: 'Index-linked resale' },
    { type: 'fleet', sku: 'B200', region: 'US-Central', start: 'DEC26', months: 12, gpus: 256, price: null, cp: '', notes: 'Dallas hall A' },
    { type: 'fleet', sku: 'B200', region: 'US-Central', start: 'JAN27', months: 11, gpus: 256, price: null, cp: '', notes: 'Dallas hall B (delivers Jan)' },
    { type: 'fleet', sku: 'H200', region: 'EU-West', start: 'FEB27', months: 10, gpus: 128, price: null, cp: '', notes: 'Frankfurt expansion' },
  ],
}
