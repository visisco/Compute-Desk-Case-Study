import React, { useEffect, useRef, useState } from 'react'
import { MONTHS, SIZE, IM_RATE, fmt, usd, sym, skuOf, INSTRUMENTS } from './data.js'
import { Panel, Seg } from './ui.jsx'
import './convert.css'

// Convert to Physical (EFP): swap long GPU-Month futures for a Node-Month lease.
// Physical deals are bilateral: the buyer negotiates terms with one provider, signs a lease
// that is conditional on a proof of concept (POC), and the EFP books only when the POC passes.
// A failed POC ends the lease under the break clause and leaves the futures hedge untouched.
// One lot = 8 contracts = 1 node for 1 month.

const LOT = 8
const STEPS = [['Position', 'Pick what to convert'], ['Spec', 'Set the delivery spec'], ['Negotiate', 'Agree terms with one provider'], ['POC', 'Prove the nodes first'], ['Booked', 'EFP, clearing, escrow']]
const PREPAY = ['Monthly in advance', '25% upfront']
const POC_DAYS = [3, 7, 14]
const mon = (m) => m[0] + m.slice(1, 3).toLowerCase() + ' ' + m.slice(3)
const phys = (sku, m) => sym(sku, m).replace('UF', 'UP')
const monthOf = (s) => INSTRUMENTS.find((i) => i.sym === s).m
const stripFrom = (sku, start, term) => { const i0 = MONTHS.indexOf(start); return MONTHS.slice(i0, i0 + term).map((m) => sym(sku, m)) }
const r3 = (x) => Math.round(x * 1000) / 1000

// Timeline after the POC passes. `book` marks the step where the DCO clears both legs.
const TIMELINE = [
  { who: 'You + provider', t: 'Lease becomes unconditional', d: 'POC passed, so the full Node-Month lease starts on the agreed terms.' },
  { who: 'Exchange', t: 'EFP reported off the order book', d: 'One ticket holds the futures leg and a reference to the lease.' },
  { who: 'Exchange', t: 'Exchange accepts the EFP', d: 'Checks: opposite sides, futures quantity matches the lease (8 contracts per node-month), lease attached.' },
  { who: 'DCO', t: 'Clearinghouse books both futures legs', d: 'You sell the strip; the provider buys it. Your long is offset to zero.', book: true },
  { who: 'FCM', t: 'Margin settled at your FCM', d: 'Last variation margin paid on the EFP price; initial margin released to your account.' },
  { who: 'Clear Escrow', t: 'Prepayment funded', d: 'Paid in on the agreed terms and released to the provider against verified GPU-hours.' },
]

export default function Convert(props) {
  return props.me.kind === 'provider' ? <ProviderView {...props} /> : <BuyerFlow {...props} />
}

/* ---------- Buyer: guided five-step flow ---------- */
function BuyerFlow({ me, acct, marks, requests, createRequest, award, setTab, prefill }) {
  const longs = Object.entries(acct.positions).filter(([, p]) => p.qty > 0)
  const skus = [...new Set(longs.map(([k]) => skuOf(k)))]
  const [sku, setSku] = useState(prefill?.sku && skus.includes(prefill.sku) ? prefill.sku : skus[0])
  const held = (s) => (acct.positions[s]?.qty > 0 ? acct.positions[s].qty : 0)
  const months = MONTHS.filter((m) => held(sym(sku || 'H100', m)) > 0)
  const [start, setStart] = useState(prefill?.start && months.includes(prefill.start) ? prefill.start : months[0])
  const [term, setTerm] = useState(months.length >= 6 ? 6 : months.length >= 3 ? 3 : 1)
  const strip = sku && start ? stripFrom(sku, start, term) : []
  const maxNodes = strip.length === term ? Math.floor(Math.min(...strip.map(held)) / LOT) : 0
  const [nodes, setNodes] = useState(Math.max(1, maxNodes))
  const [spec, setSpec] = useState({ region: 'US-East', ic: 'InfiniBand', maxBasis: 0.15 })
  const [step, setStep] = useState(0)
  const [reqId, setReqId] = useState(null)
  const [pick, setPick] = useState(null)
  const [deal, setDeal] = useState(null) // { ask, counter, agreed, prepay, poc, rounds, waiting }
  const [poc, setPoc] = useState({ day: 0, state: 'idle' }) // idle | running | passed | failed | broken
  const [snap, setSnap] = useState(null)
  const [tl, setTl] = useState(-1)
  const [tried, setTried] = useState([])
  const booked = useRef(false)

  useEffect(() => { if (nodes > maxNodes && maxNodes > 0) setNodes(maxNodes) }, [maxNodes])

  const gpus = nodes * LOT
  const r = requests.find((x) => x.id === reqId)
  const offers = r ? [...r.quotes].filter((q) => !q.fails.length).sort((a, b) => a.norm - b.norm) : []
  const q = r && pick ? r.quotes.find((x) => x.id === pick) : null
  const fAvg = strip.length ? strip.reduce((a, s) => a + marks[s], 0) / strip.length : 0
  const legs = strip.map((s) => {
    const p = acct.positions[s] || { qty: 0, avg: marks[s] }
    return { s, m: monthOf(s), qty: p.qty, avg: p.avg, mark: marks[s], gain: (marks[s] - p.avg) * gpus * SIZE, im: gpus * SIZE * marks[s] * IM_RATE }
  })
  const gain = legs.reduce((a, l) => a + l.gain, 0)
  const imRel = legs.reduce((a, l) => a + l.im, 0)
  const basis = deal ? (deal.agreed ?? deal.ask) : 0
  const price = fAvg + basis
  const gainPerHr = gain / (gpus * SIZE * term || 1)
  const monthly = gpus * SIZE * price
  const prepaid = deal?.prepay === '25% upfront' ? 0.25 * monthly * term : monthly

  // Start negotiating with one provider: their quote is the opening ask.
  const choose = (x) => { setPick(x.id); setDeal({ ask: r3(x.norm), counter: r3(Math.max(0, x.norm - 0.03)), agreed: null, prepay: PREPAY[0], poc: 7, rounds: [{ who: x.name, t: `Opening offer: premium +$${fmt(x.norm, 3)} over strip, monthly in advance, 7-day POC on 1 node.` }], waiting: false }) }
  // Provider's simulated reply: accepts anything within 3 cents of its ask, otherwise meets halfway.
  const sendCounter = () => {
    const c = r3(deal.counter)
    setDeal((d) => ({ ...d, waiting: true, rounds: [...d.rounds, { who: 'You', t: `Counter: +$${fmt(c, 3)}, ${d.prepay.toLowerCase()}, ${d.poc}-day POC.` }] }))
    setTimeout(() => setDeal((d) => {
      const floor = r3(q.norm - 0.03)
      if (c >= floor) return { ...d, waiting: false, agreed: c, rounds: [...d.rounds, { who: q.name, t: `Agreed at +$${fmt(c, 3)}.` }] }
      const mid = r3((c + d.ask) / 2)
      return { ...d, waiting: false, ask: Math.max(mid, floor), rounds: [...d.rounds, { who: q.name, t: `Can't go that low. Revised offer: +$${fmt(Math.max(mid, floor), 3)}.` }] }
    }), 900)
  }
  const acceptAsk = () => setDeal((d) => ({ ...d, agreed: d.ask, rounds: [...d.rounds, { who: 'You', t: `Accepted +$${fmt(d.ask, 3)}.` }] }))

  // POC: run day by day. A pass unlocks booking; a failure goes to the cure window, then the break clause.
  useEffect(() => {
    if (poc.state !== 'running') return
    if (poc.day >= deal.poc) { setPoc((p) => ({ ...p, state: 'passed' })); return }
    if (poc.failAt && poc.day >= poc.failAt) { setPoc((p) => ({ ...p, state: 'failed' })); return }
    const t = setTimeout(() => setPoc((p) => ({ ...p, day: p.day + 1 })), 280)
    return () => clearTimeout(t)
  }, [poc])

  // Booking timeline. Positions change when the DCO step lands.
  useEffect(() => {
    if (tl < 0 || tl >= TIMELINE.length) return
    if (TIMELINE[tl].book && !booked.current) { booked.current = true; const cid = award(reqId, pick, { basis, prepay: deal.prepay, poc: deal.poc }); setSnap((x) => ({ ...x, contractId: cid })) }
    const t = setTimeout(() => setTl((n) => n + 1), 1000)
    return () => clearTimeout(t)
  }, [tl])

  const book = () => { setSnap({ q, price, fAvg, gain, imRel, gainPerHr, gpus, nodes, term, prepaid, prepay: deal.prepay }); setStep(4); setTl(0) }
  const tryAnother = () => { setTried((t) => [...t, pick]); setPick(null); setDeal(null); setPoc({ day: 0, state: 'idle' }); setStep(2) }

  if (!skus.length) return (
    <div className="stack"><Header />
      <Panel><p className="note">You have no long futures to convert. Buy a GPU-Month strip on Trade first, then come back here to turn it into GPUs.</p><button className="btn" onClick={() => setTab('trade')}>Open Trade</button></Panel>
    </div>
  )

  const range = (arr, f) => (arr.length ? (arr.length > 1 ? `${f(arr[0])} – ${f(arr.at(-1))}` : f(arr[0])) : '')

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
          <Swap s={{ gpus, nodes, term, sku }} fAvg={fAvg} gain={gain} />
          <Foot left={<span className="note">You keep any months you don't convert as futures.</span>} next={<button className="btn" disabled={!maxNodes || strip.length < term} onClick={() => setStep(1)}>Continue to spec</button>} />
        </div>
      )}

      {step === 1 && (
        <div className="cv-grid">
          <Panel title="2 · What should the GPUs look like?">
            <div className="cv-form">
              <label>Region<select value={spec.region} onChange={(e) => setSpec({ ...spec, region: e.target.value })}><option>US-East</option><option>US-Central</option><option>Any US</option></select></label>
              <label>Interconnect<select value={spec.ic} onChange={(e) => setSpec({ ...spec, ic: e.target.value })}><option>InfiniBand</option><option>RoCE</option></select></label>
              <label>Max premium over strip price ($/GPU-hr)<input type="number" step="0.01" value={spec.maxBasis} onChange={(e) => setSpec({ ...spec, maxBasis: Number(e.target.value) })} /></label>
            </div>
            <div className="callout" style={{ marginTop: 16 }}>
              <div className="eyebrow">Node-Month lease you're asking for</div>
              <b>{nodes} × {sku} nodes</b> (8 GPUs each) for <b>{term} month{term > 1 ? 's' : ''}</b> from {mon(start)} · {spec.region} · {spec.ic} · 99.5% uptime SLA with a break clause · checked by Clear Verified, paid through Clear Escrow.
              <div className="note" style={{ marginTop: 6 }}>Physical symbols: <span className="mono cream">{range(strip.map((x) => phys(sku, monthOf(x))), (v) => v)}</span></div>
            </div>
            <p className="note" style={{ marginTop: 12 }}>Matching providers send opening offers. You then negotiate with one of them. Your name is shown only to the provider you pick.</p>
          </Panel>
          <Swap s={{ gpus, nodes, term, sku }} fAvg={fAvg} gain={gain} />
          <Foot left={<button className="btn ghost" onClick={() => setStep(0)}>Back</button>} next={<button className="btn" onClick={() => { setReqId(createRequest({ sku, gpus, region: spec.region, ic: spec.ic, start, term, maxBasis: spec.maxBasis, kind: 'EFP' })); setPick(null); setDeal(null); setStep(2) }}>Ask providers for offers</button>} />
        </div>
      )}

      {step === 2 && r && (
        <div className="cv-grid">
          <Panel title={`3 · Opening offers · ${r.id}`} right={<span className={'pill ' + (r.quotes.length < 4 ? 'warn' : 'good')}>{r.quotes.length < 4 ? `${r.quotes.length} in, more coming` : 'All in'}</span>}>
            <p className="note" style={{ marginTop: -4 }}>Premium over the strip futures price (<b className="mono cream">${fmt(fAvg)}</b>), normalised to your spec. Pick one provider to negotiate with.</p>
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {offers.length === 0 && <p className="note">Waiting for the first offer…</p>}
              {offers.map((x) => (
                <button key={x.id} className={'cv-offer' + (x.id === pick ? ' on' : '') + (tried.includes(x.id) ? ' tried' : '')} disabled={tried.includes(x.id)} onClick={() => choose(x)}>
                  <span><b>{x.name}</b> <span className="note">{x.tier} · {x.region} · {x.ic}</span></span>
                  <span className="mono">+{fmt(x.norm, 3)}</span>
                  <span className="note">{tried.includes(x.id) ? 'POC failed' : `${x.uptime}% SLA`}</span>
                </button>
              ))}
              {r.quotes.filter((x) => x.fails.length).map((x) => <div key={x.id} className="note">{x.name}: out of spec ({x.fails.join(', ')})</div>)}
            </div>
          </Panel>
          {deal && q ? (
            <Panel title={`Term sheet · ${q.name}`} right={deal.agreed != null ? <span className="pill good">Terms agreed</span> : <span className="pill warn">Negotiating</span>}>
              <div className="cv-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <label>Their premium<input disabled value={`+${fmt(deal.ask, 3)}`} /></label>
                <label>Your counter<input type="number" step="0.005" value={deal.counter} disabled={deal.agreed != null} onChange={(e) => setDeal({ ...deal, counter: Number(e.target.value) })} /></label>
                <label>Prepayment<select value={deal.prepay} disabled={deal.agreed != null} onChange={(e) => setDeal({ ...deal, prepay: e.target.value })}>{PREPAY.map((p) => <option key={p}>{p}</option>)}</select></label>
                <label>POC on 1 node<select value={deal.poc} disabled={deal.agreed != null} onChange={(e) => setDeal({ ...deal, poc: Number(e.target.value) })}>{POC_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
              </div>
              <div className="kv" style={{ marginTop: 12 }}>SLA<b>99.5% uptime · 72h cure · break clause</b></div>
              <div className="kv">All-in price<b className="cream">${fmt(price, 3)} / GPU-hr</b></div>
              <div className="kv">Prepayment into Clear Escrow<b>{usd(prepaid)}</b></div>
              <ol className="cv-chat">{deal.rounds.map((m, i) => <li key={i} className={m.who === 'You' ? 'me' : ''}><b>{m.who}</b> {m.t}</li>)}{deal.waiting && <li className="note">{q.name} is replying…</li>}</ol>
              {deal.agreed == null
                ? <div className="row"><button className="btn ghost" disabled={deal.waiting} onClick={sendCounter}>Send counter</button><button className="btn" disabled={deal.waiting} onClick={acceptAsk}>Accept +{fmt(deal.ask, 3)}</button></div>
                : <div className="row"><button className="btn" onClick={() => { setPoc({ day: 0, state: 'idle' }); setStep(3) }}>Sign conditional lease</button><span className="note">Binding only if the POC passes.</span></div>}
            </Panel>
          ) : <Panel title="Term sheet"><p className="note">Pick an offer to open the term sheet. Premium, prepayment and POC length are negotiable. The SLA and break clause are standard.</p></Panel>}
          <Foot left={<button className="btn ghost" onClick={() => setStep(1)}>Back</button>} next={<span className="note">Offers stay firm for 15 minutes.</span>} />
        </div>
      )}

      {step === 3 && q && deal && (
        <div className="stack">
          <div className="cv-grid">
            <Panel title={`4 · Proof of concept · 1 node from ${q.name}`} right={<span className={'pill ' + ({ passed: 'good', failed: 'crit', broken: 'crit' }[poc.state] || 'warn')}>{{ idle: 'Lease signed, POC not started', running: `Day ${poc.day} of ${deal.poc}`, passed: 'POC passed', failed: 'POC failed · cure window open', broken: 'Lease ended · break clause' }[poc.state]}</span>}>
              <div className="cv-poc">{Array.from({ length: deal.poc }, (_, i) => <i key={i} className={i < poc.day ? (poc.state === 'failed' || poc.state === 'broken') && i === poc.day - 1 ? 'bad' : 'ok' : ''} />)}</div>
              <p className="note">Clear Verified checks the node every day: SKU and GPU UUIDs, 8 of 8 GPUs, HBM, NVLink, InfiniBand bandwidth, and a short NCCL burn-in.</p>
              <div className="callout good" style={{ marginTop: 8 }}>Your futures are untouched during the POC: you still hold <b>{gpus} contracts in each month</b> of {range(strip, (v) => v)}.</div>
              {poc.state === 'idle' && <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={() => setPoc({ day: 0, state: 'running' })}>Run POC</button><button className="btn ghost" onClick={() => setPoc({ day: 0, state: 'running', failAt: Math.min(3, deal.poc) })}>Run POC (it fails)</button></div>}
              {poc.state === 'failed' && <div className="stack" style={{ gap: 10, marginTop: 14 }}><div className="callout crit">Day {poc.day}: InfiniBand at 200 Gb/s against 400 in the spec. {q.name} has 72 hours to fix it.</div><div className="row"><button className="btn ghost" onClick={() => setPoc({ day: poc.day, state: 'running' })}>Provider fixes it</button><button className="btn" onClick={() => setPoc((p) => ({ ...p, state: 'broken' }))}>Cure fails: use break clause</button></div></div>}
              {poc.state === 'broken' && <div className="stack" style={{ gap: 10, marginTop: 14 }}><div className="callout crit">Lease ended under the break clause. No EFP was booked and no prepayment was taken. You are exactly where you started: long the futures strip.</div><div className="row"><button className="btn" onClick={tryAnother}>Negotiate with another provider</button><button className="btn ghost" onClick={() => setTab('trade')}>Keep the futures</button></div></div>}
              {poc.state === 'passed' && <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={book}>Book the EFP and start the lease</button></div>}
            </Panel>
            <Panel title="Agreed terms">
              <div className="stack" style={{ gap: 8 }}>
                <div className="kv">Provider<b>{q.name}</b></div>
                <div className="kv">Lease<b>{nodes} nodes × {term} mo · {sku}</b></div>
                <div className="kv">Premium over strip<b>+{fmt(basis, 3)}</b></div>
                <div className="kv">All-in price<b className="cream">${fmt(price, 3)}</b></div>
                <div className="kv">Prepayment<b>{deal.prepay} · {usd(prepaid)}</b></div>
                <div className="kv">SLA<b>99.5% · 72h cure · break</b></div>
              </div>
            </Panel>
          </div>
          <div className="grid2">
            <Panel title="When the POC passes">
              <table className="cv-ba">
                <thead><tr><th>Month</th><th className="n">Futures now</th><th className="n">After</th><th className="n">Init. margin released</th><th className="n">Hedge gain</th><th className="n">Lease after</th></tr></thead>
                <tbody>{legs.map((l) => <tr key={l.s}><td className="mono">{l.s}</td><td className="n up">+{l.qty}</td><td className="n">{l.qty - gpus > 0 ? '+' : ''}{l.qty - gpus}</td><td className="n">{usd(l.im)}</td><td className={'n ' + (l.gain >= 0 ? 'up' : 'dn')}>{usd(l.gain)}</td><td className="n cream">{phys(sku, l.m)} × {nodes}</td></tr>)}</tbody>
              </table>
            </Panel>
            <Panel title="What it costs you">
              <div className="stack" style={{ gap: 10 }}>
                <div className="kv">Lease price<b>${fmt(price, 3)}</b></div>
                <div className="kv">Less hedge gain per GPU-hr<b className={gainPerHr >= 0 ? 'up' : 'dn'}>−${fmt(gainPerHr, 3)}</b></div>
                <div className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>Net cost per GPU-hr<b className="cream" style={{ fontSize: 18 }}>${fmt(price - gainPerHr, 3)}</b></div>
                <p className="note">≈ the price you hedged at plus the premium.</p>
                <div className="kv">Initial margin released<b>{usd(imRel)}</b></div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {step === 4 && snap && (
        <div className="grid2">
          <Panel title="5 · Booking" right={<span className={'pill ' + (tl >= TIMELINE.length ? 'good' : 'warn')}>{tl >= TIMELINE.length ? 'Booked' : 'In progress'}</span>}>
            <ol className="cv-tl">
              {TIMELINE.map((x, i) => <li key={x.t} className={i < tl ? 'done' : i === tl ? 'now' : ''}><i /><div><b>{x.t}</b><span className="who">{x.who}</span><p>{x.d}</p></div></li>)}
            </ol>
          </Panel>
          <Panel title="Receipt">
            <div className="stack" style={{ gap: 10 }}>
              <div className="kv">Futures sold to {snap.q.name}<b>{snap.gpus * snap.term} @ ${fmt(snap.fAvg)}</b></div>
              <div className="kv">Hedge gain realised<b className={snap.gain >= 0 ? 'up' : 'dn'}>{usd(snap.gain)}</b></div>
              <div className="kv">Initial margin released<b>{tl > 4 ? usd(snap.imRel) : '…'}</b></div>
              <div className="kv">Node-Month lease<b>{snap.contractId || '…'}</b></div>
              <div className="kv">Lease price<b>${fmt(snap.price, 3)}</b></div>
              <div className="kv">Prepayment in Clear Escrow<b>{tl > 5 ? usd(snap.prepaid) : '…'}</b></div>
              <div className="kv">Net cost per GPU-hr<b className="cream">${fmt(snap.price - snap.gainPerHr, 3)}</b></div>
              <p className="note">If the SLA fails later, the provider gets a 72-hour cure window, then you can break the lease and get unused prepayment back. The futures leg is never unwound.</p>
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
  <div><h1>Convert to Physical</h1><p className="sub">Exchange your long GPU-Month futures for a Node-Month lease (EFP). Agree terms with one provider, prove the nodes in a short POC, and the EFP books only when it passes.</p></div>
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
function ProviderView({ session, acct, marks, requests, providerQuote }) {
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
      <div><h1>Convert to Physical · provider side</h1><p className="sub">Buyers who hold long futures want GPUs. Send an opening offer. If the buyer picks you, you negotiate terms and run a short POC on one node. When it passes, you buy their futures and deliver the lease. If you're short as a hedge, the EFP closes that hedge at the same time.</p></div>
      <div className="row">{efps.map((x) => <button key={x.id} className={'chip-btn' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>{x.id} · {x.sku} × {x.gpus} · {x.term} mo · {x.status}</button>)}</div>
      <div className="grid2">
        <Panel title={`${r.id} · ${r.sku} × ${r.gpus / LOT} nodes · ${mon(r.start)} for ${r.term} mo`}>
          <table className="cv-ba">
            <thead><tr><th>Month</th><th className="n">Your futures now</th><th className="n">After EFP</th><th className="n">Margin freed</th></tr></thead>
            <tbody>{rows.map((x) => <tr key={x.s}><td className="mono">{x.s}</td><td className={'n ' + (x.now < 0 ? 'dn' : '')}>{x.now}</td><td className="n">{x.after}</td><td className="n">{usd(x.im)}</td></tr>)}</tbody>
          </table>
          <p className="note" style={{ marginTop: 10 }}>You buy {r.gpus * r.term} contracts at the strip price (${fmt(fAvg)}). That offsets your short hedge, so the price you locked in when you hedged becomes the price you deliver at.</p>
        </Panel>
        <Panel title="Your opening offer">
          <div className="cv-form" style={{ gridTemplateColumns: '1fr' }}>
            <label>Premium over strip price ($/GPU-hr)<input type="number" step="0.01" value={basis} onChange={(e) => setBasis(Number(e.target.value))} /></label>
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <div className="kv">All-in price to buyer<b className="cream">${fmt(fAvg + basis, 3)}</b></div>
            <div className="kv">Margin freed if the EFP books<b>{usd(freed)}</b></div>
            <div className="kv">Standard terms<b>POC on 1 node · 99.5% SLA · break clause</b></div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" disabled={r.status !== 'open'} onClick={() => providerQuote(r.id, basis)}>{r.myQuote != null ? 'Update offer' : 'Send offer'}</button>
            {r.myQuote != null && <span className="pill good">Offer live at +{fmt(r.myQuote)}</span>}
          </div>
        </Panel>
      </div>
    </div>
  )
}
