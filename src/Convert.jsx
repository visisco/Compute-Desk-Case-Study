import React, { useEffect, useRef, useState } from 'react'
import { SKUS, MONTHS, SIZE, IM_RATE, fmt, usd, sym, skuOf, INSTRUMENTS } from './data.js'
import { Panel, Seg, Stat } from './ui.jsx'
import './convert.css'

// Convert to Physical (EFP): swap long GPU-Month futures for Node-Month physical contracts.
// One lot = 8 contracts = 1 node for 1 month. Both legs book together; the futures leg is
// reported to the exchange off the order book and cleared at the DCO through each side's FCM.

const LOT = 8
const STEPS = [['Position', 'Pick what to convert'], ['Spec', 'Set the delivery spec'], ['Quotes', 'Providers quote basis'], ['Review', 'Check both legs'], ['Booked', 'Exchange and clearing']]
const mon = (m) => m[0] + m.slice(1, 3).toLowerCase() + ' ' + m.slice(3)
const phys = (sku, m) => sym(sku, m).replace('UF', 'UP')
const monthOf = (s) => INSTRUMENTS.find((i) => i.sym === s).m
const stripFrom = (sku, start, term) => { const i0 = MONTHS.indexOf(start); return MONTHS.slice(i0, i0 + term).map((m) => sym(sku, m)) }

// Timeline after confirm. `book` marks the step where the DCO clears both legs.
const TIMELINE = [
  { who: 'You + provider', t: 'Both sides confirm the EFP', d: 'Price, quantity and the attached Node-Month contract are locked.' },
  { who: 'Exchange', t: 'EFP reported off the order book', d: 'One ticket holds the futures leg and a reference to the physical contract.' },
  { who: 'Exchange', t: 'Exchange accepts the EFP', d: 'Checks: opposite sides, futures quantity matches the physical (8 contracts per node-month), physical contract attached.' },
  { who: 'DCO', t: 'Clearinghouse books both futures legs', d: 'You sell the strip; the provider buys it. Your long is offset to zero.', book: true },
  { who: 'FCM', t: 'Margin settled at your FCM', d: 'Last variation margin paid on the EFP price; initial margin released to your account.' },
  { who: 'Compute Desk', t: 'Node-Month contract live', d: 'Clear Escrow funding and the provider bond are due next, then hand-over and Clear Verified.' },
]

export default function Convert(props) {
  return props.me.kind === 'provider' ? <ProviderView {...props} /> : <BuyerFlow {...props} />
}

/* ---------- Buyer: guided five-step flow ---------- */
function BuyerFlow({ me, acct, marks, requests, createRequest, award, setTab, prefill }) {
  const longs = Object.entries(acct.positions).filter(([, p]) => p.qty > 0)
  const skus = [...new Set(longs.map(([k]) => skuOf(k)))]
  const [sku, setSku] = useState(prefill?.sku && skus.includes(prefill.sku) ? prefill.sku : skus[0])
  const held = (s) => acct.positions[s]?.qty > 0 ? acct.positions[s].qty : 0
  const months = MONTHS.filter((m) => held(sym(sku || 'H100', m)) > 0)
  const [start, setStart] = useState(prefill?.start && months.includes(prefill.start) ? prefill.start : months[0])
  const [term, setTerm] = useState(Math.min(6, months.length) >= 6 ? 6 : months.length >= 3 ? 3 : 1)
  const strip = sku && start ? stripFrom(sku, start, term) : []
  const maxNodes = strip.length === term ? Math.floor(Math.min(...strip.map(held)) / LOT) : 0
  const [nodes, setNodes] = useState(Math.max(1, maxNodes))
  const [spec, setSpec] = useState({ region: 'US-East', ic: 'InfiniBand', maxBasis: 0.15 })
  const [step, setStep] = useState(0)
  const [reqId, setReqId] = useState(null)
  const [pick, setPick] = useState(null)
  const [snap, setSnap] = useState(null)
  const [tl, setTl] = useState(-1)
  const booked = useRef(false)

  useEffect(() => { if (nodes > maxNodes && maxNodes > 0) setNodes(maxNodes) }, [maxNodes])

  const gpus = nodes * LOT
  const r = requests.find((x) => x.id === reqId)
  const ranked = r ? [...r.quotes].sort((a, b) => b.score - a.score) : []
  const best = ranked.find((q) => !q.fails.length)
  const fAvg = strip.length ? strip.reduce((a, s) => a + marks[s], 0) / strip.length : 0
  const legs = strip.map((s) => {
    const p = acct.positions[s] || { qty: 0, avg: marks[s] }
    return { s, m: monthOf(s), qty: p.qty, avg: p.avg, mark: marks[s], gain: (marks[s] - p.avg) * gpus * SIZE, im: gpus * SIZE * marks[s] * IM_RATE }
  })
  const gain = legs.reduce((a, l) => a + l.gain, 0)
  const imRel = legs.reduce((a, l) => a + l.im, 0)
  const q = r && pick ? r.quotes.find((x) => x.id === pick) : null
  const price = q ? fAvg + q.norm : 0
  const gainPerHr = gain / (gpus * SIZE * term || 1)

  // Booking timeline. Positions change when the DCO step lands.
  useEffect(() => {
    if (tl < 0 || tl >= TIMELINE.length) return
    if (TIMELINE[tl].book && !booked.current) { booked.current = true; const cid = award(reqId, pick); setSnap((x) => ({ ...x, contractId: cid })) }
    const t = setTimeout(() => setTl((n) => n + 1), 1100)
    return () => clearTimeout(t)
  }, [tl])

  const confirm = () => {
    setSnap({ q, price, fAvg, gain, imRel, gainPerHr, legs, gpus, nodes, term, sku, start, strip })
    setStep(4); setTl(0)
  }

  if (!skus.length) return (
    <div className="stack"><Header />
      <Panel><p className="note">You have no long futures to convert. Buy a GPU-Month strip on Trade first, then come back here to turn it into GPUs.</p><button className="btn" onClick={() => setTab('trade')}>Open Trade</button></Panel>
    </div>
  )

  const s = snap || { q, price, fAvg, gain, imRel, gainPerHr, legs, gpus, nodes, term, sku, start, strip }
  const range = (arr, f) => arr.length ? (arr.length > 1 ? `${f(arr[0])} – ${f(arr.at(-1))}` : f(arr[0])) : ''

  return (
    <div className="stack">
      <Header />
      <ol className="cv-steps">{STEPS.map(([k, d], i) => <li key={k} className={i < step ? 'done' : i === step ? 'now' : ''}><b>{i + 1} · {k}</b>{d}</li>)}</ol>

      {step === 0 && (
        <div className="cv-grid">
          <Panel title="1 · Which hedge do you want as GPUs?">
            <div className="cv-pos">
              {skus.map((k) => {
                const ls = longs.filter(([x]) => skuOf(x) === k)
                const pnl = ls.reduce((a, [x, p]) => a + p.qty * SIZE * (marks[x] - p.avg), 0)
                return <button key={k} className={k === sku ? 'on' : ''} onClick={() => { setSku(k); const ms = MONTHS.filter((m) => held(sym(k, m)) > 0); setStart(ms[0]); setTerm(Math.min(term, ms.length) >= 6 ? 6 : ms.length >= 3 ? 3 : 1) }}>
                  <b>{k} GPU-Month Futures</b>
                  <span>{ls.length} month{ls.length > 1 ? 's' : ''} long · {range(ls.map(([x]) => monthOf(x)), mon)}</span>
                  <span className={pnl >= 0 ? 'up' : 'dn'}>{usd(pnl)} unrealised</span>
                </button>
              })}
            </div>
            <div className="cv-form" style={{ marginTop: 16 }}>
              <label>First delivery month<select value={start} onChange={(e) => setStart(e.target.value)}>{months.map((m) => <option key={m} value={m}>{mon(m)}</option>)}</select></label>
              <label>Months<Seg small value={term} options={[1, 3, 6].map((n) => [n, `${n} mo`])} onChange={setTerm} /></label>
              <label>Nodes (lots of 8 contracts)
                <div className="cv-qty"><button onClick={() => setNodes(Math.max(1, nodes - 1))} aria-label="Fewer nodes">−</button><span className="n">{nodes}</span><button onClick={() => setNodes(Math.min(maxNodes, nodes + 1))} aria-label="More nodes">+</button><span className="note">max {maxNodes}</span></div>
              </label>
            </div>
            <div className="eyebrow" style={{ marginTop: 16 }}>Coverage · contracts held vs to convert</div>
            <div className="cv-strip">
              {strip.map((x) => <div key={x} className={held(x) >= gpus ? 'ok' : 'bad'}><b>{x}</b><em>{held(x)} / {gpus}</em></div>)}
              {strip.length < term && <div className="bad"><b>Past listed months</b><em>shorten the term</em></div>}
            </div>
          </Panel>
          <Swap s={{ gpus, nodes, term, sku, strip }} fAvg={fAvg} gain={gain} />
          <Foot left={<span className="note">You keep any months you don't convert as futures.</span>} next={<button className="btn" disabled={!maxNodes || strip.length < term} onClick={() => setStep(1)}>Continue to spec</button>} />
        </div>
      )}

      {step === 1 && (
        <div className="cv-grid">
          <Panel title="2 · What should the GPUs look like?">
            <div className="cv-form">
              <label>Region<select value={spec.region} onChange={(e) => setSpec({ ...spec, region: e.target.value })}><option>US-East</option><option>US-Central</option><option>Any US</option></select></label>
              <label>Interconnect<select value={spec.ic} onChange={(e) => setSpec({ ...spec, ic: e.target.value })}><option>InfiniBand</option><option>RoCE</option></select></label>
              <label>Max basis over strip ($/GPU-hr)<input type="number" step="0.01" value={spec.maxBasis} onChange={(e) => setSpec({ ...spec, maxBasis: Number(e.target.value) })} /></label>
            </div>
            <div className="callout" style={{ marginTop: 16 }}>
              <div className="eyebrow">Node-Month contract you'll receive</div>
              <b>{nodes} × {sku} nodes</b> (8 GPUs each) for <b>{term} month{term > 1 ? 's' : ''}</b> from {mon(start)} · {spec.region} · {spec.ic} · 99.5% uptime SLA · checked by Clear Verified, paid through Clear Escrow.
              <div className="note" style={{ marginTop: 6 }}>Physical symbols: <span className="mono cream">{range(strip.map((x) => phys(sku, monthOf(x))), (v) => v)}</span></div>
            </div>
            <p className="note" style={{ marginTop: 12 }}>Providers see the spec and quantity, not your name, until you accept.</p>
          </Panel>
          <Swap s={{ gpus, nodes, term, sku, strip }} fAvg={fAvg} gain={gain} />
          <Foot left={<button className="btn ghost" onClick={() => setStep(0)}>Back</button>} next={<button className="btn" onClick={() => { setReqId(createRequest({ sku, gpus, region: spec.region, ic: spec.ic, start, term, maxBasis: spec.maxBasis, kind: 'EFP' })); setPick(null); setStep(2) }}>Request EFP quotes</button>} />
        </div>
      )}

      {step === 2 && r && (
        <Panel title={`3 · Provider quotes · ${r.id}`} right={<span className={'pill ' + (ranked.length < 4 ? 'warn' : 'good')}>{ranked.length < 4 ? `Collecting · ${ranked.length} of 4 in` : 'All providers in'}</span>}>
          <p className="note" style={{ marginTop: -4 }}>Each provider quotes a basis over the strip futures price (<b className="mono cream">${fmt(fAvg)}</b>). Quotes are normalised to your spec with the basis table, then ranked. Pick one to review both legs.</p>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            <div className="cv-q" style={{ background: 'transparent', border: 0, padding: '0 12px' }}><span className="note">Provider</span><span className="note">Region · fabric</span><span className="note">Basis (norm.)</span><span className="note">All-in $/GPU-hr</span><span className="note">Score</span><span /></div>
            {ranked.length === 0 && <p className="note">Waiting for the first quote…</p>}
            {ranked.map((x) => (
              <div key={x.id} className={'cv-q' + (x === best ? ' best' : '') + (x.fails.length ? ' out' : '')}>
                <span><b>{x.name}</b> <span className="note">{x.tier}</span></span>
                <span className="note">{x.region} · {x.ic}</span>
                <span className="mono">+{fmt(x.norm, 3)}{x.adj ? <span className="note"> (incl. +{fmt(x.adj)} fabric)</span> : null}</span>
                <span className="mono cream">{fmt(fAvg + x.norm, 3)}</span>
                <span className="mono">{x.fails.length ? '—' : x.score}</span>
                {x.fails.length ? <span className="note">{x.fails.join(' · ')}</span> : <button className={'btn' + (x === best ? '' : ' ghost')} onClick={() => { setPick(x.id); setStep(3) }}>Review</button>}
              </div>
            ))}
          </div>
          <Foot left={<button className="btn ghost" onClick={() => setStep(1)}>Back</button>} next={<span className="note">Quotes stay firm for 15 minutes.</span>} />
        </Panel>
      )}

      {step === 3 && q && (
        <div className="stack">
          <Panel title={`4 · Review · ${r.id} with ${q.name}`}>
            <div className="cv-legs">
              <div className="cv-leg">
                <div className="eyebrow" style={{ margin: 0 }}>Futures leg · exchange + DCO</div>
                <div><b>Sell {gpus * term} contracts</b> ({gpus} × {term} months) of {range(strip, (v) => v)} to {q.name}</div>
                <div className="kv">Price (strip avg, off-book EFP)<b>${fmt(fAvg)}</b></div>
                <div className="kv">Cleared through<b>{me.fcm}</b></div>
                <div className="kv">Your position after<b>0 in each month</b></div>
              </div>
              <div className="cv-leg">
                <div className="eyebrow" style={{ margin: 0 }}>Physical leg · Node-Month contract</div>
                <div><b>Receive {nodes} nodes × {term} months</b> of {sku} from {q.name}</div>
                <div className="kv">Price (strip + basis +{fmt(q.norm, 3)})<b>${fmt(price, 3)} / GPU-hr</b></div>
                <div className="kv">Clear Escrow, month 1 (you fund)<b>{usd(gpus * SIZE * price)}</b></div>
                <div className="kv">Performance bond (provider posts)<b>{usd(gpus * SIZE * price)}</b></div>
              </div>
            </div>
          </Panel>
          <div className="grid2">
            <Panel title="Before and after">
              <table className="cv-ba">
                <thead><tr><th>Month</th><th className="n">Futures now</th><th className="n">After</th><th className="n">Init. margin released</th><th className="n">Hedge gain</th><th className="n">Physical after</th></tr></thead>
                <tbody>{legs.map((l) => <tr key={l.s}><td className="mono">{l.s}</td><td className="n up">+{l.qty}</td><td className="n">{l.qty - gpus > 0 ? '+' : ''}{l.qty - gpus}</td><td className="n">{usd(l.im)}</td><td className={'n ' + (l.gain >= 0 ? 'up' : 'dn')}>{usd(l.gain)}</td><td className="n cream">{phys(sku, l.m)} × {nodes}</td></tr>)}</tbody>
              </table>
              <p className="note" style={{ marginTop: 10 }}>Most of the hedge gain has already reached your FCM account as daily variation margin. The EFP settles the last day's move and releases the initial margin.</p>
            </Panel>
            <Panel title="What it costs you">
              <div className="stack" style={{ gap: 10 }}>
                <div className="kv">Physical price<b>${fmt(price, 3)}</b></div>
                <div className="kv">Less hedge gain per GPU-hr<b className={gainPerHr >= 0 ? 'up' : 'dn'}>−${fmt(gainPerHr, 3)}</b></div>
                <div className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>Net cost per GPU-hr<b className="cream" style={{ fontSize: 18 }}>${fmt(price - gainPerHr, 3)}</b></div>
                <p className="note">≈ the price you hedged at plus the basis. Rising GPU prices since you hedged don't reach you.</p>
                <div className="kv">Initial margin released<b>{usd(imRel)}</b></div>
              </div>
            </Panel>
          </div>
          <Foot left={<button className="btn ghost" onClick={() => setStep(2)}>Back to quotes</button>} next={<button className="btn" onClick={confirm}>Confirm conversion</button>} />
        </div>
      )}

      {step === 4 && s.q && (
        <div className="grid2">
          <Panel title="5 · Booking" right={<span className={'pill ' + (tl >= TIMELINE.length ? 'good' : 'warn')}>{tl >= TIMELINE.length ? 'Booked' : 'In progress'}</span>}>
            <ol className="cv-tl">
              {TIMELINE.map((x, i) => <li key={x.t} className={i < tl ? 'done' : i === tl ? 'now' : ''}><i /><div><b>{x.t}</b><span className="who">{x.who}</span><p>{x.d}</p></div></li>)}
            </ol>
          </Panel>
          <Panel title="Receipt">
            <div className="stack" style={{ gap: 10 }}>
              <div className="kv">Futures sold to {s.q.name}<b>{s.gpus * s.term} @ ${fmt(s.fAvg)}</b></div>
              <div className="kv">Hedge gain realised<b className={s.gain >= 0 ? 'up' : 'dn'}>{usd(s.gain)}</b></div>
              <div className="kv">Initial margin released<b>{tl > 4 ? usd(s.imRel) : '…'}</b></div>
              <div className="kv">Node-Month contract<b>{s.contractId || '…'}</b></div>
              <div className="kv">Physical price<b>${fmt(s.price, 3)}</b></div>
              <div className="kv">Net cost per GPU-hr<b className="cream">${fmt(s.price - s.gainPerHr, 3)}</b></div>
              <p className="note">If delivery later fails, the fix happens inside the physical contract (backup provider or cash from the bond). The futures leg is never unwound.</p>
              <div className="row">
                <button className="btn" disabled={tl < TIMELINE.length} onClick={() => setTab('request')}>Track delivery</button>
                <button className="btn ghost" onClick={() => setTab('trade')}>See positions</button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}

const Header = () => (
  <div><h1>Convert to Physical</h1><p className="sub">Exchange your long GPU-Month futures for Node-Month contracts with a provider (EFP). Both legs book together, so you're never left without the hedge or the GPUs.</p></div>
)

const Foot = ({ left, next }) => <div className="cv-foot" style={{ gridColumn: '1 / -1' }}>{left}{next}</div>

function Swap({ s, fAvg, gain }) {
  return (
    <Panel title="The swap">
      <div className="cv-swap">
        <div className="side"><span className="note">You give</span><span className="big">{s.gpus * s.term}</span><span className="note">{s.sku} futures contracts ({s.gpus}/month × {s.term})</span><span className="note mono">at strip ${fmt(fAvg)}</span></div>
        <div className="arrow">⇄</div>
        <div className="side"><span className="note">You get</span><span className="big">{s.nodes * s.term}</span><span className="note">Node-Months ({s.nodes} nodes × {s.term})</span><span className="note mono">{(s.gpus * SIZE * s.term).toLocaleString()} GPU-hrs</span></div>
      </div>
      <p className="note" style={{ marginTop: 12 }}>Hedge gain on these contracts so far: <b className={gain >= 0 ? 'up' : 'dn'}>{usd(gain)}</b>. You keep it.</p>
    </Panel>
  )
}

/* ---------- Provider: take the other side of an EFP ---------- */
function ProviderView({ session, acct, marks, requests, providerQuote, setTab }) {
  const efps = requests.filter((r) => r.kind === 'EFP' && r.owner !== session)
  const [sel, setSel] = useState(efps[0]?.id)
  const r = efps.find((x) => x.id === sel)
  const [basis, setBasis] = useState(0.07)
  if (!r) return <div className="stack"><Header /><Panel><p className="note">No EFP requests right now.</p></Panel></div>
  const strip = stripFrom(r.sku, r.start, r.term)
  const fAvg = strip.reduce((a, s) => a + marks[s], 0) / strip.length
  const rows = strip.map((s) => { const p = acct.positions[s]?.qty || 0; return { s, now: p, after: p + r.gpus, im: Math.min(Math.abs(Math.min(p, 0)), r.gpus) * SIZE * marks[s] * IM_RATE } })
  const freed = rows.reduce((a, x) => a + x.im, 0)
  return (
    <div className="stack">
      <div><h1>Convert to Physical · provider side</h1><p className="sub">Buyers who hold long futures want GPUs. If you win, you buy their futures and deliver nodes. If you're short as a hedge, the EFP closes that hedge at the same time.</p></div>
      <div className="row">{efps.map((x) => <button key={x.id} className={'chip-btn' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>{x.id} · {x.sku} × {x.gpus} · {x.term} mo · {x.status}</button>)}</div>
      <div className="grid2">
        <Panel title={`${r.id} · ${r.sku} × ${r.gpus / LOT} nodes · ${mon(r.start)} for ${r.term} mo`}>
          <table className="cv-ba">
            <thead><tr><th>Month</th><th className="n">Your futures now</th><th className="n">After EFP</th><th className="n">Margin freed</th></tr></thead>
            <tbody>{rows.map((x) => <tr key={x.s}><td className="mono">{x.s}</td><td className={'n ' + (x.now < 0 ? 'dn' : '')}>{x.now}</td><td className="n">{x.after}</td><td className="n">{usd(x.im)}</td></tr>)}</tbody>
          </table>
          <p className="note" style={{ marginTop: 10 }}>You buy {r.gpus * r.term} contracts at the strip price (${fmt(fAvg)}). That offsets your short hedge, so the price you locked in when you hedged becomes the price you deliver at.</p>
        </Panel>
        <Panel title="Your quote">
          <div className="cv-form" style={{ gridTemplateColumns: '1fr' }}>
            <label>Basis over strip ($/GPU-hr)<input type="number" step="0.01" value={basis} onChange={(e) => setBasis(Number(e.target.value))} /></label>
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <div className="kv">All-in price to buyer<b className="cream">${fmt(fAvg + basis, 3)}</b></div>
            <div className="kv">Margin freed if you win<b>{usd(freed)}</b></div>
            <div className="kv">Bond you'll post<b>{usd(r.gpus * SIZE * (fAvg + basis))}</b></div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" disabled={r.status !== 'open'} onClick={() => providerQuote(r.id, basis)}>{r.myQuote != null ? 'Update quote' : 'Send quote'}</button>
            {r.myQuote != null && <span className="pill good">Quote live at +{fmt(r.myQuote)}</span>}
          </div>
        </Panel>
      </div>
    </div>
  )
}
