import React, { useMemo, useState } from 'react'
import { SKUS, MONTHS, SIZE, TICK, IM_RATE, LIFECYCLE, ROLES, fmt, usd, sym, roundTick, makeQuotes } from './data.js'

/* ---------- shared bits ---------- */

const Steps = ({ items, at, bad }) => (
  <ol className="steps">
    {items.map((s, i) => (
      <li key={s} className={bad === i ? 'bad' : i < at ? 'done' : i === at ? 'now' : ''}>{s}</li>
    ))}
  </ol>
)

const Stat = ({ k, v, cls }) => (
  <div className="stat"><div className="k">{k}</div><div className={'v ' + (cls || '')}>{v}</div></div>
)

function applyFill(pos, s, delta, px) {
  const cur = pos[s] || { qty: 0, avg: px }
  const q = cur.qty + delta
  let avg = cur.avg
  if (cur.qty === 0 || Math.sign(cur.qty) === Math.sign(delta)) avg = (cur.avg * Math.abs(cur.qty) + px * Math.abs(delta)) / Math.abs(q)
  else if (Math.sign(q) !== Math.sign(cur.qty) && q !== 0) avg = px
  const next = { ...pos }
  if (q === 0) delete next[s]
  else next[s] = { qty: q, avg }
  return next
}

const pnl = (p, mark) => p.qty * SIZE * (mark - p.avg)

/* ---------- Onboard: lifecycle per ICP ---------- */

const STAGE_TAB = { 2: 'markets', 3: null, 4: 'markets', 5: 'delivery', 6: 'efp' }
const CHECKS = {
  end_user: ['KYB and credit check', 'FCM account linked (futures)', 'Escrow agent account', 'Users and roles set up', 'First hedge placed'],
  provider: ['KYB and data-centre due diligence', 'Attestation agent installed on nodes', 'FCM account linked (futures)', 'Performance bond facility (LC)', 'Inventory published via API'],
  spec: ['KYC via FCM', 'Pre-trade risk limits set by FCM', 'API keys issued', 'First order'],
  mm: ['KYC via FCM', 'Market maker agreement signed', 'FIX certification passed in test environment', 'Production FIX session and drop copy', 'Quoting obligations live'],
}

export function Onboard({ role, step, setStep, setTab }) {
  const stages = LIFECYCLE[role]
  const physicalOnly = role === 'spec' || role === 'mm'
  const trade = role === 'end_user' ? 'efp' : role === 'provider' ? 'trader' : 'markets'
  const go = STAGE_TAB[step] === null ? trade : STAGE_TAB[step]
  const checks = CHECKS[role]
  const doneChecks = Math.min(checks.length, step + 1)
  return (
    <div className="stack">
      <section className="panel">
        <h2>Lifecycle · {ROLES[role].label} <span className="meth">Click a stage</span></h2>
        <div className="lc">
          {stages.map(([name, desc], i) => {
            const na = physicalOnly && i === 5
            return (
              <div key={name} className={'st ' + (na ? 'na' : i < step ? 'done' : i === step ? 'now' : '')} onClick={() => setStep(i)}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <b>{name}</b>
                <p>{desc}</p>
              </div>
            )
          })}
        </div>
        <div className="row between" style={{ marginTop: 14 }}>
          <span className="note">Now: <b style={{ color: 'var(--fg)' }}>{stages[step][0]}</b> · {stages[step][1]}</span>
          <div className="row">
            {go && <button className="btn ghost" onClick={() => setTab(go)}>Open {go === 'efp' ? 'EFP' : go === 'trader' ? 'Physical RFQ' : go === 'delivery' ? 'Delivery' : 'Futures'} →</button>}
            <button className="btn" disabled={step >= 6} onClick={() => setStep(Math.min(6, step + 1))}>Complete stage</button>
          </div>
        </div>
      </section>
      <div className="grid2">
        <section className="panel">
          <h2>Onboarding checklist</h2>
          <div className="stack" style={{ gap: 10 }}>
            {checks.map((c, i) => (
              <div key={c} className="row between">
                <span>{c}</span>
                <span className={'pill ' + (i < doneChecks ? 'good' : 'muted')}>{i < doneChecks ? 'done' : 'pending'}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Access</h2>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row between"><span>Clearing</span><span className="note">Via FCM to partner DCO</span></div>
            <div className="row between"><span>Products</span><span className="note">{physicalOnly ? 'Futures and spreads' : 'Futures, physical, EFP'}</span></div>
            <div className="row between"><span>Interfaces</span><span className="note">{role === 'mm' ? 'FIX + WebSocket (UI for oversight)' : role === 'spec' ? 'UI, FIX or WebSocket' : 'UI + REST'}</span></div>
            <div className="row between"><span>Collateral</span><span className="note">{physicalOnly ? 'Margin at FCM' : 'Margin at FCM; escrow or bond for physical'}</span></div>
          </div>
        </section>
      </div>
    </div>
  )
}

/* ---------- Futures: curve, book, ticket, positions ---------- */

function Curve({ sku, marks, sel, onSel }) {
  const pts = MONTHS.map((m) => marks[sym(sku, m)])
  const idx = SKUS[sku].index
  const lo = Math.min(...pts, idx) - 0.03, hi = Math.max(...pts, idx) + 0.03
  const X = (i) => 40 + (i * 620) / 11
  const Y = (v) => 150 - ((v - lo) / (hi - lo)) * 130
  return (
    <div className="curve">
      <svg viewBox="0 0 700 175" role="img" aria-label={`${sku} forward curve`}>
        <line x1="40" x2="660" y1={Y(idx)} y2={Y(idx)} stroke="#8fa9d6" strokeDasharray="4 4" strokeWidth="1" />
        <text x="664" y={Y(idx) + 4} fill="#8fa9d6" fontSize="11" fontFamily="JetBrains Mono">index</text>
        <polyline fill="none" stroke="#e8e2b9" strokeWidth="1.6" points={pts.map((p, i) => `${X(i)},${Y(p)}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={i} onClick={() => onSel(MONTHS[i])} style={{ cursor: 'pointer' }}>
            <circle cx={X(i)} cy={Y(p)} r={MONTHS[i] === sel ? 5 : 3} fill={MONTHS[i] === sel ? '#e8e2b9' : '#1b1a19'} stroke="#e8e2b9" />
            <text x={X(i)} y="170" textAnchor="middle" fill="#6f6d67" fontSize="10.5" fontFamily="JetBrains Mono">{MONTHS[i].slice(0, 3)}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function Book({ mid, tick }) {
  const size = (i, side) => 8 * (1 + ((i * 7 + tick * (side + 2)) % 9))
  const asks = [...Array(7)].map((_, i) => ({ px: mid + TICK * (i + 1), q: size(i, 1) })).reverse()
  const bids = [...Array(7)].map((_, i) => ({ px: mid - TICK * (i + 1), q: size(i, 0) }))
  const max = 80
  return (
    <div className="tw">
      <table className="book">
        <thead><tr><th>Side</th><th className="n">Price $/GPU-hr</th><th className="n">Contracts</th></tr></thead>
        <tbody>
          {asks.map((a) => (
            <tr key={'a' + a.px} className="ask"><td>Offer</td><td className="n">{fmt(a.px)}</td><td className="n depth"><i style={{ width: `${(a.q / max) * 100}%` }} />{a.q}</td></tr>
          ))}
          <tr className="mid"><td colSpan={3}>{fmt(mid)} mid · spread {fmt(2 * TICK)}</td></tr>
          {bids.map((b) => (
            <tr key={'b' + b.px} className="bid"><td>Bid</td><td className="n">{fmt(b.px)}</td><td className="n depth"><i style={{ width: `${(b.q / max) * 100}%` }} />{b.q}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Markets({ role, marks, tick, myPos, setMyPos }) {
  const firstHeld = Object.keys(myPos)[0]
  const [sku, setSku] = useState(firstHeld ? firstHeld.split('-')[0] : 'H100')
  const [month, setMonth] = useState(firstHeld ? firstHeld.split('-')[1] : 'DEC26')
  const [side, setSide] = useState('buy')
  const [qty, setQty] = useState(20)
  const [px, setPx] = useState('')
  const [working, setWorking] = useState([])
  const [msg, setMsg] = useState(null)
  const s = sym(sku, month)
  const mid = marks[s]
  const limit = px === '' ? (side === 'buy' ? mid + TICK : mid - TICK) : Number(px)

  const place = () => {
    const bestAsk = mid + TICK, bestBid = mid - TICK
    const q = Math.max(1, Math.round(Number(qty)))
    if (side === 'buy' ? limit >= bestAsk - 1e-9 : limit <= bestBid + 1e-9) {
      const fill = side === 'buy' ? bestAsk : bestBid
      setMyPos((p) => applyFill(p, s, side === 'buy' ? q : -q, fill))
      setMsg({ ok: true, t: `Filled: ${side === 'buy' ? 'bought' : 'sold'} ${q} ${s} at $${fmt(fill)} (${(q * SIZE).toLocaleString()} GPU-hrs). Sent to the DCO for clearing via your FCM.` })
    } else {
      setWorking((w) => [{ id: 'O' + (1000 + w.length), s, side, q, px: roundTick(limit) }, ...w])
      setMsg({ ok: false, t: `Order resting on the book: ${side} ${q} ${s} at $${fmt(limit)}.` })
    }
    setPx('')
  }

  const rows = Object.entries(myPos)
  const totalPnl = rows.reduce((a, [k, p]) => a + pnl(p, marks[k]), 0)
  const margin = rows.reduce((a, [k, p]) => a + Math.abs(p.qty) * SIZE * marks[k] * IM_RATE, 0)
  const gpuHrs = rows.reduce((a, [, p]) => a + p.qty * SIZE, 0)

  return (
    <div className="stack">
      <div className="grid2">
        <section className="panel">
          <h2>
            <span>Forward curve · cash-settled vs index</span>
            <div className="seg small">
              {Object.keys(SKUS).map((k) => <button key={k} className={k === sku ? 'on' : ''} onClick={() => setSku(k)}>{k}</button>)}
            </div>
          </h2>
          <Curve sku={sku} marks={marks} sel={month} onSel={setMonth} />
          <div className="tw" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Contract</th><th className="n">Bid</th><th className="n">Offer</th><th className="n">Mark</th><th className="n">vs index</th><th className="n">Open interest</th></tr></thead>
              <tbody>
                {MONTHS.slice(0, 7).map((m, i) => {
                  const k = sym(sku, m), v = marks[k]
                  return (
                    <tr key={m} className={'click ' + (m === month ? 'sel' : '')} onClick={() => setMonth(m)}>
                      <td>{k}</td><td className="n">{fmt(v - TICK)}</td><td className="n">{fmt(v + TICK)}</td><td className="n">{fmt(v)}</td>
                      <td className={'n ' + (v >= SKUS[sku].index ? 'up' : 'dn')}>{v >= SKUS[sku].index ? '+' : ''}{fmt(v - SKUS[sku].index)}</td>
                      <td className="n">{(4200 - i * 480).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginBottom: 0 }}>1 contract = {SIZE} GPU-hrs (1 GPU-month). Final settlement = average of the daily index over the contract month.</p>
        </section>
        <div className="stack">
          <section className="panel">
            <h2>{s} · order book <span className="meth">CLOB</span></h2>
            <Book mid={mid} tick={tick} />
          </section>
          <section className="panel">
            <h2>Order ticket</h2>
            <div className="form">
              <div className="seg full" style={{ width: 'fit-content' }}>
                <button className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>Buy</button>
                <button className={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>Sell</button>
              </div>
              <label>Contracts<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
              <label>Limit $/GPU-hr<input placeholder={fmt(limit)} value={px} onChange={(e) => setPx(e.target.value)} /></label>
              <div className="full note">Notional {usd(Number(qty || 0) * SIZE * limit)} · est. initial margin {usd(Number(qty || 0) * SIZE * limit * IM_RATE)} at FCM</div>
              <button className={'btn full ' + side} onClick={place}>{side === 'buy' ? 'Buy' : 'Sell'} {qty} {s}</button>
            </div>
            {msg && <div className={'callout ' + (msg.ok ? 'good' : '')} style={{ marginTop: 12 }}>{msg.t}</div>}
          </section>
        </div>
      </div>
      <section className="panel">
        <h2>Positions · {ROLES[role].who}</h2>
        <div className="stats" style={{ marginBottom: 14 }}>
          <Stat k="Net GPU-hrs hedged" v={gpuHrs.toLocaleString()} cls="cream" />
          <Stat k="Unrealised P&L" v={usd(totalPnl)} cls={totalPnl >= 0 ? 'up' : 'dn'} />
          <Stat k="Initial margin (FCM)" v={usd(margin)} />
        </div>
        {rows.length ? (
          <div className="tw">
            <table>
              <thead><tr><th>Contract</th><th className="n">Qty</th><th className="n">Avg</th><th className="n">Mark</th><th className="n">P&L</th></tr></thead>
              <tbody>
                {rows.map(([k, p]) => (
                  <tr key={k}><td>{k}</td><td className={'n ' + (p.qty > 0 ? 'up' : 'dn')}>{p.qty > 0 ? '+' : ''}{p.qty}</td><td className="n">{fmt(p.avg)}</td><td className="n">{fmt(marks[k])}</td>
                    <td className={'n ' + (pnl(p, marks[k]) >= 0 ? 'up' : 'dn')}>{usd(pnl(p, marks[k]))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="note">No open positions.</p>}
        {working.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginTop: 16 }}>Working orders</div>
            {working.map((o) => (
              <div key={o.id} className="row between" style={{ padding: '6px 0' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{o.id} · {o.side} {o.q} {o.s} @ {fmt(o.px)}</span>
                <button className="btn ghost" onClick={() => setWorking((w) => w.filter((x) => x.id !== o.id))}>Cancel</button>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  )
}

/* ---------- Physical RFQ (Compute Trader) ---------- */

function QuoteTable({ quotes, sku, onAccept, accepted }) {
  const idx = SKUS[sku].index
  return (
    <div className="tw">
      <table>
        <thead><tr><th>Provider (blind)</th><th>Spec</th><th className="n">Quoted basis</th><th className="n">Spec adj.</th><th className="n">All-in $/GPU-hr</th><th>Score</th><th></th></tr></thead>
        <tbody>
          {quotes.map((q, i) => (
            <tr key={q.id} className={q.fails.length ? 'fail' : ''}>
              <td><b style={{ fontWeight: 500 }}>{q.name}</b><div className="note">{q.tier} · {q.uptime}% SLA</div></td>
              <td>{q.region} · {q.ic}{q.fails.length > 0 && <div className="hint">{q.fails.join(' · ')}</div>}</td>
              <td className="n">+{fmt(q.basis)}</td>
              <td className="n">{q.adj ? '+' + fmt(q.adj) : '0.000'}</td>
              <td className="n cream">{fmt(idx + q.norm)}</td>
              <td>{q.fails.length ? <span className="pill crit">filtered</span> : <div className="row" style={{ gap: 8 }}><span style={{ fontFamily: 'var(--mono)' }}>{q.score}</span><div className="bar"><i style={{ width: q.score + '%' }} /></div></div>}</td>
              <td>{!q.fails.length && <button className="btn" disabled={!!accepted} onClick={() => onAccept(q)}>{accepted === q.id ? 'Accepted' : i === 0 ? 'Accept best' : 'Accept'}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Trader({ role, addContract, setTab }) {
  const [req, setReq] = useState({ sku: 'B200', gpus: 256, region: 'US-East', ic: 'InfiniBand', start: 'JAN27', term: 12, maxBasis: 0.15 })
  const [quotes, setQuotes] = useState(null)
  const [accepted, setAccepted] = useState(null)
  const [provQuote, setProvQuote] = useState({ basis: '0.07', sent: false, won: false })
  const set = (k) => (e) => { setReq({ ...req, [k]: ['gpus', 'term', 'maxBasis'].includes(k) ? Number(e.target.value) : e.target.value }); setQuotes(null); setAccepted(null) }

  if (role === 'provider') {
    return (
      <div className="grid2">
        <section className="panel">
          <h2>Open RFQs matching your inventory</h2>
          <div className="tw">
            <table>
              <thead><tr><th>RFQ</th><th>Requirement</th><th className="n">Max basis</th><th>Closes</th></tr></thead>
              <tbody>
                <tr className="sel"><td>RFQ-2291</td><td>B200 × 256 · US-East · IB · JAN27 · 12 mo</td><td className="n">+0.150</td><td>2h 10m</td></tr>
                <tr><td>RFQ-2288</td><td>H100 × 64 · Any US · IB · DEC26 · 6 mo</td><td className="n">+0.100</td><td>5h 40m</td></tr>
              </tbody>
            </table>
          </div>
          <p className="note">Buyer identity stays hidden until both sides accept. Quotes are normalised to the index reference spec with the shared basis table.</p>
        </section>
        <section className="panel">
          <h2>Quote RFQ-2291</h2>
          <div className="form">
            <label>Basis over B200 index<input value={provQuote.basis} onChange={(e) => setProvQuote({ ...provQuote, basis: e.target.value })} /></label>
            <label>All-in $/GPU-hr<input disabled value={fmt(SKUS.B200.index + Number(provQuote.basis || 0))} /></label>
            <div className="full note">Performance bond if awarded: {usd(256 * SIZE * (SKUS.B200.index + Number(provQuote.basis || 0)))} (1 month, cash or LC)</div>
            <button className="btn full" disabled={provQuote.sent} onClick={() => setProvQuote({ ...provQuote, sent: true })}>{provQuote.sent ? 'Quote sent' : 'Send quote'}</button>
          </div>
          {provQuote.sent && !provQuote.won && (
            <div className="callout" style={{ marginTop: 12 }}>
              Ranked <b>#1 of 3</b> (blind). <button className="btn ghost" style={{ marginLeft: 8 }} onClick={() => {
                setProvQuote({ ...provQuote, won: true })
                addContract({ id: 'PC-' + (1100 + Math.floor(Math.random() * 800)), sku: 'B200', gpus: 256, months: 12, start: 'JAN27', price: SKUS.B200.index + Number(provQuote.basis), provider: 'You (Helios Cloud)', via: 'RFQ', stage: 0, failed: false, month: 0, uptime: 0, log: ['Buyer accepted your quote. Contract signed.'] })
              }}>Simulate buyer accept</button>
            </div>
          )}
          {provQuote.won && <div className="callout good" style={{ marginTop: 12 }}>Awarded. Post your bond, then hand over nodes. <button className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setTab('delivery')}>Open delivery →</button></div>}
        </section>
      </div>
    )
  }

  const best = quotes && quotes.find((q) => !q.fails.length)
  return (
    <div className="grid3">
      <section className="panel">
        <h2>Standard term sheet</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <label>SKU<select value={req.sku} onChange={set('sku')}>{Object.keys(SKUS).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>GPUs (8 per node)<input type="number" step="8" value={req.gpus} onChange={set('gpus')} /></label>
          <label>Region<select value={req.region} onChange={set('region')}><option>US-East</option><option>US-Central</option><option>Any US</option><option>EU-West</option></select></label>
          <label>Interconnect<select value={req.ic} onChange={set('ic')}><option>InfiniBand</option><option>RoCE</option></select></label>
          <label>Start<select value={req.start} onChange={set('start')}>{MONTHS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label>Term (months)<select value={req.term} onChange={set('term')}>{[1, 3, 6, 12].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="full">Max basis over index ($/GPU-hr)<input type="number" step="0.01" value={req.maxBasis} onChange={set('maxBasis')} /></label>
          <div className="full" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 2 }}>{req.sku} index</div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: 'var(--cream)' }}>${SKUS[req.sku].index.toFixed(2)}</span>
            <div className="note">Contract value at index: {usd(req.gpus * SIZE * req.term * SKUS[req.sku].index)}</div>
          </div>
          <button className="btn full" onClick={() => setQuotes(makeQuotes(req))}>Send blind RFQ</button>
        </form>
      </section>
      <section className="panel">
        <h2>Ranked quotes <span className="meth">Normalised to index reference spec</span></h2>
        {!quotes && <p className="note">Send the RFQ to see provider quotes, filtered on spec and ranked by all-in price, tier and SLA.</p>}
        {quotes && <QuoteTable quotes={quotes} sku={req.sku} accepted={accepted} onAccept={(q) => {
          setAccepted(q.id)
          addContract({ id: 'PC-' + (1100 + Math.floor(Math.random() * 800)), sku: req.sku, gpus: req.gpus, months: req.term, start: req.start, price: SKUS[req.sku].index + q.norm, provider: q.name, via: 'RFQ', stage: 0, failed: false, month: 0, uptime: 0, log: [`Contract signed with ${q.name} via blind RFQ`] })
        }} />}
        {quotes && !best && <div className="callout crit" style={{ marginTop: 12 }}>No quote meets the spec. Widen region or max basis, or hand to the desk.</div>}
        {accepted && <div className="callout good" style={{ marginTop: 12 }}>Contract signed. Next: fund month 1 into escrow; the provider posts a bond. <button className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setTab('delivery')}>Track delivery →</button></div>}
      </section>
    </div>
  )
}

/* ---------- EFP: futures position -> physical delivery ---------- */

const EFP_STEPS = ['Request', 'Quotes', 'Agree prices', 'EFP booked', 'Delivery']

export function Efp({ role, marks, myPos, setMyPos, addContract, setTab }) {
  const [req, setReq] = useState({ gpus: 64, start: 'JUN27', term: 6, region: 'US-East', ic: 'InfiniBand', maxBasis: 0.15 })
  const [quotes, setQuotes] = useState(null)
  const [done, setDone] = useState(null)
  const [pBasis, setPBasis] = useState('0.08')
  const i0 = MONTHS.indexOf(req.start)
  const strip = MONTHS.slice(i0, i0 + req.term)
  const short = strip.length < req.term
  const sign = role === 'provider' ? -1 : 1
  const coverage = strip.map((m) => ({ m, s: sym('H100', m), held: myPos[sym('H100', m)]?.qty || 0, mark: marks[sym('H100', m)], avg: myPos[sym('H100', m)]?.avg }))
  const covered = coverage.every((c) => sign * c.held >= req.gpus) && !short
  const fAvg = coverage.reduce((a, c) => a + c.mark, 0) / (coverage.length || 1)
  const set = (k) => (e) => { setReq({ ...req, [k]: ['gpus', 'term', 'maxBasis'].includes(k) ? Number(e.target.value) : e.target.value }); setQuotes(null) }

  const book = (basis, provider) => {
    const legs = coverage.map((c) => ({ ...c, fpx: c.mark }))
    const gainPerHr = legs.reduce((a, c) => a + sign * (c.fpx - (c.avg ?? c.fpx)), 0) / legs.length
    const realised = legs.reduce((a, c) => a + sign * (c.fpx - (c.avg ?? c.fpx)) * req.gpus * SIZE, 0)
    const imReleased = legs.reduce((a, c) => a + req.gpus * SIZE * c.fpx * IM_RATE, 0)
    const phys = fAvg + basis
    setMyPos((p) => legs.reduce((acc, c) => applyFill(acc, c.s, -sign * req.gpus, c.fpx), p))
    const id = 'PC-' + (1100 + Math.floor(Math.random() * 800))
    addContract({ id, sku: 'H100', gpus: req.gpus, months: req.term, start: req.start, price: phys, provider, via: 'EFP', stage: 0, failed: false, month: 0, uptime: 0, log: [`EFP booked: ${req.gpus * req.term} contracts at strip avg $${fmt(fAvg)}; physical at +$${fmt(basis)} basis`] })
    setDone({ id, phys, basis, gainPerHr, realised, imReleased, n: req.gpus * req.term, net: phys - gainPerHr, provider })
  }

  const at = done ? 4 : quotes ? 1 : 0

  return (
    <div className="stack">
      <div className="row between">
        <Steps items={EFP_STEPS} at={at} />
        <span className="note">EFP = exchange for physical: swap a futures position for a physical contract, at the same time, in the same size.</span>
      </div>
      <div className="grid3">
        <section className="panel">
          <h2>{role === 'provider' ? 'Incoming EFP request' : 'Convert futures to GPUs'}</h2>
          {role === 'provider' ? (
            <div className="stack" style={{ gap: 12 }}>
              <div className="callout">Buyer (blind) wants <b>64 H100</b> · US-East · InfiniBand · <b>JUN27 for 6 months</b>, max basis +0.150. They are long the futures strip; you are short it.</div>
              <label>Your basis quote ($/GPU-hr over futures)<input value={pBasis} onChange={(e) => setPBasis(e.target.value)} /></label>
              <button className="btn" disabled={!!done || !covered} onClick={() => book(Number(pBasis), 'You (Helios Cloud)')}>Quote and accept EFP</button>
              {!covered && !done && <span className="hint">You need a 64/month short in JUN27–NOV27 to offset.</span>}
            </div>
          ) : (
            <form onSubmit={(e) => e.preventDefault()}>
              <label>GPUs<input type="number" step="8" value={req.gpus} onChange={set('gpus')} /></label>
              <label>Start<select value={req.start} onChange={set('start')}>{MONTHS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Term (months)<select value={req.term} onChange={set('term')}>{[1, 3, 6].map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Region<select value={req.region} onChange={set('region')}><option>US-East</option><option>US-Central</option><option>Any US</option><option>EU-West</option></select></label>
              <label>Interconnect<select value={req.ic} onChange={set('ic')}><option>InfiniBand</option><option>RoCE</option></select></label>
              <label>Max basis<input type="number" step="0.01" value={req.maxBasis} onChange={set('maxBasis')} /></label>
              <button className="btn full" disabled={!covered || !!done} onClick={() => setQuotes(makeQuotes(req))}>Request EFP quotes</button>
              {!covered && !done && <span className="full hint">{short ? 'Strip runs past listed months.' : `Not enough long H100 futures to cover ${req.gpus} GPUs in every month.`}</span>}
            </form>
          )}
          <div className="eyebrow" style={{ marginTop: 18 }}>Futures being exchanged · H100</div>
          <div className="tw">
            <table>
              <thead><tr><th>Month</th><th className="n">Held</th><th className="n">Needed</th><th className="n">Mark</th></tr></thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.m}><td>{c.m}</td><td className="n">{c.held}</td><td className="n">{sign * req.gpus}</td><td className="n">{fmt(c.mark)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          {!done && role !== 'provider' && (
            <>
              <h2>Provider basis quotes <span className="meth">Strip avg futures ${fmt(fAvg)}</span></h2>
              {!quotes && <p className="note">Your long futures stay open until you accept a quote. Then both legs book together, so you never hold neither the hedge nor the GPUs.</p>}
              {quotes && <QuoteTable quotes={quotes.map((q) => ({ ...q }))} sku="H100" onAccept={(q) => book(q.norm, q.name)} />}
              {quotes && <p className="note">All-in column shown vs spot index; the EFP physical price is strip futures + basis.</p>}
            </>
          )}
          {!done && role === 'provider' && <p className="note">When you accept, you buy {req.gpus * req.term} H100 futures from the buyer, offsetting your short hedge, and sign the physical contract at futures + your basis.</p>}
          {done && (
            <div className="stack">
              <h2 style={{ margin: 0 }}>EFP booked · {done.id}</h2>
              <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="callout">
                  <div className="eyebrow">Futures leg · exchange + DCO</div>
                  <div>{role === 'provider' ? 'Bought' : 'Sold'} <b>{done.n} contracts</b> to {role === 'provider' ? 'the buyer' : done.provider} at strip avg <b>${fmt(fAvg)}</b>, off the order book.</div>
                  <div className="note" style={{ marginTop: 6 }}>Position flat in JUN27–NOV27. Final variation margin settled; initial margin released: <b style={{ color: 'var(--fg)' }}>{usd(done.imReleased)}</b></div>
                </div>
                <div className="callout">
                  <div className="eyebrow">Physical leg · Compute Clear</div>
                  <div><b>{req.gpus} H100 × {req.term} months</b> at <b>${fmt(done.phys)}</b>/GPU-hr (futures + {fmt(done.basis)} basis).</div>
                  <div className="note" style={{ marginTop: 6 }}>Escrow month 1: {usd(req.gpus * SIZE * done.phys)} · Bond: {usd(req.gpus * SIZE * done.phys)}</div>
                </div>
              </div>
              <div className="stats">
                <Stat k={role === 'provider' ? 'Hedge P&L realised' : 'Hedge gain realised'} v={usd(done.realised)} cls={done.realised >= 0 ? 'up' : 'dn'} />
                <Stat k="Physical price" v={'$' + fmt(done.phys)} />
                <Stat k={role === 'provider' ? 'Net received $/GPU-hr' : 'Net cost $/GPU-hr'} v={'$' + fmt(role === 'provider' ? done.phys + done.gainPerHr : done.net)} cls="cream" />
              </div>
              <p className="note" style={{ margin: 0 }}>{role === 'provider' ? 'Net received = physical price plus your short hedge P&L: roughly the price you locked in when you sold futures, plus the basis.' : 'Net cost = physical price minus the hedge gain: roughly the price you locked in when you bought futures, plus the basis. The hedge did its job.'}</p>
              <div><button className="btn" onClick={() => setTab('delivery')}>Track delivery →</button></div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/* ---------- Delivery (Compute Clear) ---------- */

const D_STEPS = ['Signed', 'Escrow funded', 'Bond posted', 'Nodes handed over', 'Acceptance', 'Monthly settlement']

export function Delivery({ contracts, updateContract }) {
  const [sel, setSel] = useState(contracts[0]?.id)
  const c = contracts.find((x) => x.id === sel) || contracts[0]
  if (!c) return <p className="note">No contracts yet.</p>
  const monthly = c.gpus * SIZE * c.price
  const closed = c.month >= c.months
  const step = (fn) => updateContract(c.id, fn)
  const advance = () => step((x) => {
    const n = Math.min(5, x.stage + 1)
    const msgs = ['', `Escrow funded: month 1 ${usd(monthly)}`, `Performance bond posted: ${usd(monthly)}`, `Nodes handed over: ${x.gpus / 8} nodes`, `Acceptance passed: SKU, GPU count, memory, interconnect verified`, 'Delivery live: daily health checks running']
    return { ...x, stage: n, uptime: n >= 4 ? 99.8 : 0, log: [...x.log, msgs[n]] }
  })
  const fail = () => step((x) => ({ ...x, failed: true, log: [...x.log, `Acceptance failed: ${Math.max(1, x.gpus / 32)} nodes show degraded interconnect. Escrow held.`] }))
  const cure = () => step((x) => ({ ...x, failed: false, stage: 5, uptime: 99.6, log: [...x.log, `Cure: backup provider substituted at +$0.050. Difference ${usd(0.05 * x.gpus * SIZE * (x.months - x.month))} drawn from the bond. Acceptance passed.`] }))
  const settle = () => step((x) => {
    const m = x.month + 1
    const up = 99.2 + Math.random() * 0.7
    const credit = up < 99.5 ? monthly * 0.02 : 0
    return { ...x, month: m, uptime: up, log: [...x.log, `Month ${m} settled: ${(x.gpus * SIZE).toLocaleString()} verified GPU-hrs, uptime ${up.toFixed(2)}%${credit ? `, SLA credit ${usd(credit)}` : ''}. Escrow paid ${usd(monthly - credit)} to provider.` + (m >= x.months ? ' Term complete: bond released.' : '')] }
  })

  return (
    <div className="grid3">
      <section className="panel">
        <h2>Physical contracts</h2>
        <div className="tw">
          <table>
            <thead><tr><th>Contract</th><th>Via</th><th className="n">Month</th></tr></thead>
            <tbody>
              {contracts.map((x) => (
                <tr key={x.id} className={'click ' + (x.id === c.id ? 'sel' : '')} onClick={() => setSel(x.id)}>
                  <td>{x.id}<div className="note">{x.sku} × {x.gpus}</div></td><td>{x.via}</td><td className="n">{x.stage === 5 ? `${x.month}/${x.months}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>{c.id} · {c.sku} × {c.gpus} · {c.start} for {c.months} mo <span className="meth">Methodology</span></h2>
        <Steps items={D_STEPS} at={closed ? 6 : c.stage} bad={c.failed ? 4 : undefined} />
        <div className="stats">
          <Stat k="Price" v={'$' + fmt(c.price)} cls="cream" />
          <Stat k="Monthly escrow" v={usd(monthly)} />
          <Stat k="Bond" v={usd(monthly)} />
          <Stat k="Uptime (30d)" v={c.stage >= 4 && !c.failed ? c.uptime.toFixed(2) + '%' : '—'} cls={c.uptime >= 99.5 ? 'up' : c.uptime ? 'dn' : ''} />
          <Stat k="Provider" v={c.provider} />
        </div>
        <div className="row">
          {c.stage < 3 && <button className="btn" onClick={advance}>Next: {D_STEPS[c.stage + 1]}</button>}
          {c.stage === 3 && !c.failed && <><button className="btn" onClick={advance}>Run acceptance check</button><button className="btn ghost" onClick={fail}>Fail acceptance</button></>}
          {c.failed && <button className="btn" onClick={cure}>Cure with backup provider</button>}
          {c.stage === 4 && !c.failed && <button className="btn" onClick={advance}>Go live</button>}
          {c.stage === 5 && !closed && <button className="btn" onClick={settle}>Settle month {c.month + 1}</button>}
          {closed && <span className="pill good">Contract complete · bond released</span>}
        </div>
        {c.failed && <div className="callout crit">No money moves while acceptance fails. The futures leg is not unwound; the cure happens inside the physical contract.</div>}
        <div>
          <div className="eyebrow">Event log</div>
          <ol className="log">{[...c.log].reverse().map((l, i) => <li key={i}>{l}</li>)}</ol>
        </div>
      </section>
    </div>
  )
}

/* ---------- API ---------- */

export function Api({ role, marks, feed }) {
  const [ch, setCh] = useState(role === 'mm' || role === 'spec' ? 'FIX' : 'REST')
  const s = 'H100-JUN27', px = fmt(marks[s])
  const code = {
    REST: `POST /v1/orders
Authorization: Bearer <api_key>   X-Signature: <hmac>   Idempotency-Key: 7f3c...
{ "instrument": "${s}", "side": "buy", "qty": 20, "price": ${px}, "tif": "GTC",
  "client_order_id": "nw-hedge-0042" }

→ 201 { "order_id": "O-88213", "status": "filled", "fill_px": ${px}, "gpu_hrs": 14600 }

POST /v1/efps
{ "futures_positions": ["H100-JUN27".."H100-NOV27"], "gpus": 64, "term_months": 6,
  "region": "US-East", "interconnect": "InfiniBand", "max_basis": 0.15 }

GET  /v1/contracts/PC-1042/delivery
→ { "stage": "live", "month": 3, "verified_gpu_hrs": 93440, "uptime_30d": 99.71,
    "escrow": { "balance": 533264, "next_release": "2026-12-01" } }`,
    WebSocket: `wss://api.computedesk.example/v1/stream

→ { "op": "subscribe", "channels": ["book.${s}", "trades.H100-*", "index.H100", "curve.H100"] }
← { "ch": "book.${s}", "type": "snapshot", "seq": 88190, "bids": [[${fmt(marks[s] - TICK)}, 40], ...], "asks": [[${fmt(marks[s] + TICK)}, 32], ...] }
← { "ch": "book.${s}", "type": "delta", "seq": 88191, "asks": [[${fmt(marks[s] + TICK)}, 24]] }

Private (after auth): orders · fills · positions · efp · delivery
Gap in seq → request snapshot, then replay deltas.`,
    FIX: `8=FIX.4.4|35=i|49=LATTICE|56=CDX|                       MassQuote
  117=Q-5521|296=1|302=H100|295=12|
  299=1|55=${s}|132=${fmt(marks[s] - TICK)}|133=${fmt(marks[s] + TICK)}|134=40|135=40|
  ...one QuoteEntry per listed month...

8=FIX.4.4|35=8|39=2|150=F|55=${s}|54=1|32=40|31=${px}|      ExecutionReport (fill)
8=FIX.4.4|35=AE|828=EFP|55=H100-JUN27|32=64|31=${px}|       TradeCaptureReport (EFP / block)

Session: cancel-on-disconnect, kill switch (35=q), drop copy to FCM.`,
  }
  const ents = [
    ['End user', 'UI + REST', 'Orders, RFQ, EFP, delivery records', '20 req/s'],
    ['Provider', 'UI + REST', 'RFQ quotes, EFP basis, inventory, attestation', '20 req/s'],
    ['Speculator', 'FIX / WebSocket / UI', 'Orders, spreads, market data', '100 msg/s'],
    ['Market maker', 'FIX + WebSocket', 'Mass quote, full depth, drop copy', '1,000 msg/s'],
  ]
  return (
    <div className="stack">
      <div className="grid2">
        <section className="panel">
          <h2>
            <span>Integrate · same engine, same risk checks for every channel</span>
            <div className="seg small">{['REST', 'WebSocket', 'FIX'].map((k) => <button key={k} className={ch === k ? 'on' : ''} onClick={() => setCh(k)}>{k}</button>)}</div>
          </h2>
          <pre className="code">{code[ch]}</pre>
        </section>
        <section className="panel">
          <h2>Live stream <span className="pill good">connected</span></h2>
          <div className="feed">
            {feed.length === 0 && <span>Waiting for messages…</span>}
            {feed.map((m, i) => <span key={m.t + i}><b>{m.t}</b> {m.ch}</span>)}
          </div>
        </section>
      </div>
      <section className="panel">
        <h2>Entitlements by participant type</h2>
        <div className="tw">
          <table>
            <thead><tr><th>Participant</th><th>Channels</th><th>Scope</th><th className="n">Rate limit (assumed)</th></tr></thead>
            <tbody>
              {ents.map((e) => (
                <tr key={e[0]} className={ROLES[role].label === e[0] ? 'sel' : ''}><td>{e[0]}</td><td>{e[1]}</td><td>{e[2]}</td><td className="n">{e[3]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>Certification test environment for FIX; API keys scoped by entitlement; FCM sets pre-trade credit limits that apply on every channel.</p>
      </section>
    </div>
  )
}
