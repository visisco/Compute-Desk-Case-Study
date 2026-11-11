import React, { useEffect, useState } from 'react'
import { SKUS, MONTHS, SIZE, TICK, INSTRUMENTS, fmt, usd, sym, skuOf, roundTick } from './data.js'
import { Panel, Seg, Stat, Steps } from './ui.jsx'
import { candles, top } from './market.js'

const D_STEPS = ['Signed', 'Clear Escrow funded', 'Bond posted', 'Nodes handed over', 'Clear Verified', 'Live']

const stripOf = (r) => { const i0 = MONTHS.indexOf(r.start); return MONTHS.slice(i0, i0 + r.term).map((m) => sym(r.sku, m)) }
const refPrice = (r, marks) => (r.kind === 'EFP' ? stripOf(r).reduce((a, s) => a + marks[s], 0) / r.term : SKUS[r.sku].index)

/* ---------- New request form (buyer) ---------- */
function NewRequest({ acct, marks, createRequest, onCreated, prefill }) {
  const [kind, setKind] = useState(prefill?.kind || 'RFQ')
  const [r, setR] = useState({ sku: prefill?.sku || (prefill?.kind === 'EFP' ? 'H100' : 'B200'), gpus: 64, region: 'US-East', ic: 'InfiniBand', start: prefill?.start || (prefill?.kind === 'EFP' ? 'JUN27' : 'JAN27'), term: 6, maxBasis: 0.15 })
  const set = (k) => (e) => setR({ ...r, [k]: ['gpus', 'term', 'maxBasis'].includes(k) ? Number(e.target.value) : e.target.value })
  const strip = stripOf(r)
  const short = strip.length < r.term
  const cover = strip.map((s) => ({ s, held: acct.positions[s]?.qty || 0 }))
  const ok = kind === 'RFQ' || (!short && cover.every((c) => c.held >= r.gpus))
  const ref = refPrice({ ...r, kind }, marks)
  return (
    <Panel title="New request" right={<Seg small value={kind} options={[['RFQ', 'Physical RFQ'], ['EFP', 'Convert to Physical (EFP)']]} onChange={setKind} />}>
      <p className="note" style={{ marginTop: -4 }}>{kind === 'EFP' ? 'Exchange your long futures for a Node-Month Contract. Both legs book together at award, so you never hold neither the hedge nor the GPUs.' : 'Blind RFQ on the standard term sheet. Providers see the spec, not your name, until you award.'}</p>
      <div className="form" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <label>SKU<select value={r.sku} onChange={set('sku')}>{Object.keys(SKUS).map((k) => <option key={k}>{k}</option>)}</select></label>
        <label>GPUs (8 per node)<input type="number" step="8" min="8" value={r.gpus} onChange={set('gpus')} /></label>
        <label>Start<select value={r.start} onChange={set('start')}>{MONTHS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Term (months)<select value={r.term} onChange={set('term')}>{(kind === 'EFP' ? [1, 3, 6] : [1, 3, 6, 12]).map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Region<select value={r.region} onChange={set('region')}><option>US-East</option><option>US-Central</option><option>Any US</option><option>EU-West</option></select></label>
        <label>Interconnect<select value={r.ic} onChange={set('ic')}><option>InfiniBand</option><option>RoCE</option></select></label>
        <label>Max basis $/GPU-hr<input type="number" step="0.01" value={r.maxBasis} onChange={set('maxBasis')} /></label>
        <label>Node-months<input disabled value={(r.gpus / 8) * r.term} /></label>
      </div>
      {kind === 'EFP' && (
        <div className="cover">
          {cover.map((c) => <div key={c.s} className={c.held >= r.gpus ? 'ok' : 'bad'}><span className="mono">{c.s}</span><b>{c.held} / {r.gpus}</b></div>)}
          {short && <div className="bad">Strip runs past listed months</div>}
        </div>
      )}
      <div className="row between" style={{ marginTop: 14 }}>
        <span className="note">Reference {kind === 'EFP' ? 'strip futures' : 'Compute Signal index'}: <b className="cream mono">${fmt(ref)}</b> · value at reference {usd(r.gpus * SIZE * r.term * ref)}</span>
        <button className="btn" disabled={!ok} onClick={() => onCreated(createRequest({ ...r, kind }))}>{kind === 'EFP' ? 'Request EFP quotes' : 'Send blind RFQ'}</button>
      </div>
      {!ok && kind === 'EFP' && <p className="hint">You need {r.gpus} long contracts in every month of the strip to convert.</p>}
    </Panel>
  )
}

/* ---------- Request detail ---------- */
function Detail({ r, me, session, marks, award, providerQuote, openContract }) {
  const [basis, setBasis] = useState(r.myQuote ?? 0.08)
  const ref = refPrice(r, marks)
  const isOwner = r.owner === session
  const ranked = [...r.quotes].sort((a, b) => b.score - a.score)
  const best = ranked.find((q) => !q.fails.length)
  const myRank = ranked.filter((q) => !q.fails.length).findIndex((q) => q.mine === session) + 1
  return (
    <div className="stack">
      <Panel title={`${r.id} · ${r.kind === 'EFP' ? 'Convert to Physical (EFP)' : 'Physical RFQ'}`} right={<span className={'pill ' + (r.status === 'open' ? 'warn' : 'good')}>{r.status === 'open' ? `Open · closes in ${r.closes}` : `Awarded to ${r.awardedTo}`}</span>}>
        <div className="stats">
          <Stat k="Spec" v={`${r.sku} × ${r.gpus}`} sub={`${r.region} · ${r.ic}`} />
          <Stat k="Term" v={`${r.start} · ${r.term} mo`} sub={`${(r.gpus / 8) * r.term} node-months`} />
          <Stat k={r.kind === 'EFP' ? 'Strip futures avg' : 'Index'} v={'$' + fmt(ref)} cls="cream" />
          <Stat k="Max basis" v={'+' + fmt(r.maxBasis)} />
          <Stat k="Counterparty" v={isOwner ? 'You' : r.buyer} />
        </div>
      </Panel>

      {!isOwner && r.status === 'open' && (
        <Panel title="Your quote">
          <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
            <label style={{ width: 200 }}>Basis over {r.kind === 'EFP' ? 'strip futures' : 'index'}<input type="number" step="0.01" value={basis} onChange={(e) => setBasis(Number(e.target.value))} /></label>
            <div className="stat"><div className="k">All-in $/GPU-hr</div><div className="v cream">{fmt(ref + basis)}</div></div>
            <div className="stat"><div className="k">Bond if awarded</div><div className="v">{usd(r.gpus * SIZE * (ref + basis))}</div></div>
            <button className="btn" onClick={() => providerQuote(r.id, basis)}>{r.myQuote != null ? 'Update quote' : 'Send quote'}</button>
          </div>
          {r.myQuote != null && <p className="note">Quote live. You rank <b className="cream">#{myRank || '–'}</b> of {ranked.filter((q) => !q.fails.length).length} eligible (blind).{r.kind === 'EFP' && ' If awarded, you buy the futures strip from the buyer, offsetting your short hedge.'}</p>}
        </Panel>
      )}

      {(isOwner || r.status !== 'open') && (
        <Panel title="Quotes" right={<span className="meth">Normalised to the reference spec with the basis table</span>}>
          {r.quotes.length === 0 ? <p className="note">Waiting for providers… quotes stream in as they respond.</p> : (
            <div className="tw"><table>
              <thead><tr><th>Provider</th><th>Spec</th><th className="n">Basis</th><th className="n">Adj.</th><th className="n">All-in</th><th>Score</th><th></th></tr></thead>
              <tbody>{ranked.map((q) => (
                <tr key={q.id} className={q.fails.length ? 'fail' : q.id === r.awardedId ? 'sel' : ''}>
                  <td><b style={{ fontWeight: 500 }}>{isOwner && r.status === 'open' ? q.name.replace(/Helios Cloud/, 'Provider H') : q.name}</b><div className="note">{q.tier} · {q.uptime}% SLA</div></td>
                  <td>{q.region} · {q.ic}{q.fails.length > 0 && <div className="hint">{q.fails.join(' · ')}</div>}</td>
                  <td className="n">+{fmt(q.basis, 3)}</td><td className="n">{q.adj ? '+' + fmt(q.adj, 3) : '—'}</td>
                  <td className="n cream">{fmt(ref + q.norm, 3)}</td>
                  <td>{q.fails.length ? <span className="pill crit">filtered</span> : <div className="row" style={{ gap: 8 }}><span className="mono">{q.score}</span><div className="bar"><i style={{ width: q.score + '%' }} /></div></div>}</td>
                  <td>{isOwner && r.status === 'open' && !q.fails.length && <button className="btn" onClick={() => award(r.id, q.id)}>{q === best ? 'Award best' : 'Award'}</button>}{q.id === r.awardedId && <span className="pill good">awarded</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
      )}

      {r.status === 'awarded' && (
        <Panel title="Booked">
          {r.efp ? (
            <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="callout"><div className="eyebrow">Futures leg · exchange + DCO</div>Buyer sold <b>{r.efp.n} contracts</b> to {r.awardedTo} at strip avg <b>${fmt(r.efp.fAvg)}</b>, off the order book. Positions flat; initial margin released: <b>{usd(r.efp.imReleased)}</b>.</div>
              <div className="callout"><div className="eyebrow">Physical leg · Node-Month Contract</div><b>{r.gpus} {r.sku} × {r.term} months</b> at <b>${fmt(r.price, 3)}</b>/GPU-hr. Clear Escrow month 1 and provider bond: {usd(r.gpus * SIZE * r.price)} each.</div>
            </div>
          ) : <div className="callout good">Node-Month Contract signed at <b>${fmt(r.price, 3)}</b>/GPU-hr with {r.awardedTo}.</div>}
          {r.efp && isOwner && (
            <div className="stats" style={{ marginTop: 14 }}>
              <Stat k="Hedge gain realised" v={usd(r.efp.realised)} cls={r.efp.realised >= 0 ? 'up' : 'dn'} />
              <Stat k="Physical price" v={'$' + fmt(r.price, 3)} />
              <Stat k="Net cost $/GPU-hr" v={'$' + fmt(r.price - r.efp.gainPerHr, 3)} cls="cream" sub="≈ hedged price + basis" />
            </div>
          )}
          <div style={{ marginTop: 14 }}><button className="btn" onClick={() => openContract(r.contractId)}>Track delivery →</button></div>
        </Panel>
      )}
    </div>
  )
}

/* ---------- Delivery tracker ---------- */
function Delivery({ c, updateContract }) {
  const monthly = c.gpus * SIZE * c.price
  const closed = c.month >= c.months
  const step = (fn) => updateContract(c.id, fn)
  const advance = () => step((x) => {
    const n = Math.min(5, x.stage + 1)
    const msgs = ['', `Clear Escrow funded: month 1 ${usd(monthly)}`, `Performance bond posted: ${usd(monthly)}`, `Nodes handed over: ${x.gpus / 8} nodes`, 'Clear Verified: SKU, GPU count, memory and interconnect match the contract', 'Delivery live: daily health checks running']
    return { ...x, stage: n, uptime: n >= 4 ? 99.8 : 0, log: [...x.log, msgs[n]] }
  })
  const fail = () => step((x) => ({ ...x, failed: true, log: [...x.log, `Clear Verified failed: ${Math.max(1, x.gpus / 32)} nodes show degraded interconnect. Escrow held.`] }))
  const cure = () => step((x) => ({ ...x, failed: false, stage: 5, uptime: 99.6, log: [...x.log, `Cure: backup provider substituted at +$0.05. Difference ${usd(0.05 * x.gpus * SIZE * (x.months - x.month))} drawn from the bond. Clear Verified passed.`] }))
  const settle = () => step((x) => {
    const m = x.month + 1, up = 99.2 + Math.random() * 0.7, credit = up < 99.5 ? monthly * 0.02 : 0
    return { ...x, month: m, uptime: up, log: [...x.log, `Month ${m} settled: ${(x.gpus * SIZE).toLocaleString()} verified GPU-hrs, uptime ${up.toFixed(2)}%${credit ? `, SLA credit ${usd(credit)}` : ''}. Escrow paid ${usd(monthly - credit)} to the provider.` + (m >= x.months ? ' Term complete: bond released.' : '')] }
  })
  return (
    <Panel title={`${c.id} · ${c.sku} × ${c.gpus} · ${c.start} for ${c.months} mo · via ${c.via}`} right={<span className="meth">Clear Verified methodology</span>}>
      <div className="stack">
        <Steps items={D_STEPS} at={closed ? 6 : c.stage} bad={c.failed ? 4 : undefined} />
        <div className="stats">
          <Stat k="Price" v={'$' + fmt(c.price, 3)} cls="cream" />
          <Stat k="Monthly escrow" v={usd(monthly)} />
          <Stat k="Bond" v={usd(monthly)} />
          <Stat k="Uptime (30d)" v={c.stage >= 4 && !c.failed ? c.uptime.toFixed(2) + '%' : '—'} cls={c.uptime >= 99.5 ? 'up' : c.uptime ? 'dn' : ''} />
          <Stat k="Buyer / provider" v={`${c.buyer.split(' ')[0]} / ${c.provider.split(' ').slice(0, 2).join(' ')}`} />
        </div>
        <div className="row">
          {c.stage < 3 && <button className="btn" onClick={advance}>Next: {D_STEPS[c.stage + 1]}</button>}
          {c.stage === 3 && !c.failed && <><button className="btn" onClick={advance}>Run Clear Verified check</button><button className="btn ghost" onClick={fail}>Fail the check</button></>}
          {c.failed && <button className="btn" onClick={cure}>Cure with backup provider</button>}
          {c.stage === 4 && !c.failed && <button className="btn" onClick={advance}>Go live</button>}
          {c.stage === 5 && !closed && <button className="btn" onClick={settle}>Settle month {c.month + 1}</button>}
          {closed && <span className="pill good">Contract complete · bond released</span>}
        </div>
        {c.failed && <div className="callout crit">No money moves while the check fails. The futures leg is not unwound; the cure happens inside the physical contract.</div>}
        <div><div className="eyebrow">Event log</div><ol className="log">{[...c.log].reverse().map((l, i) => <li key={i}>{l}</li>)}</ol></div>
      </div>
    </Panel>
  )
}

/* ---------- Spread trades ---------- */
const IDEAS = [
  { k: 'upgrade', label: 'Next-gen premium', type: 'Cross-GPU', a: ['B200', 'JUN27'], b: ['H100', 'JUN27'], side: 'Buy', why: 'Long B200, short H100. Hedge a fleet migration, or bet the next-gen premium widens.' },
  { k: 'rv', label: 'H200 vs H100', type: 'Cross-GPU', a: ['H200', 'MAR27'], b: ['H100', 'MAR27'], side: 'Sell', why: 'Relative value: sell the H200 premium if it looks rich against H100.' },
  { k: 'roll', label: 'Roll a hedge', type: 'Calendar', a: ['H100', 'JUN27'], b: ['H100', 'DEC26'], side: 'Buy', why: 'Buy Jun, sell Dec: move a hedge further out in one trade, with no legging risk.' },
  { k: 'curve', label: 'Curve steepener', type: 'Calendar', a: ['B200', 'NOV27'], b: ['B200', 'JAN27'], side: 'Buy', why: 'Bet that back-month B200 rises against the front as supply arrives late.' },
]

// Spread history from the two contracts' price histories, with the 30-period mean and z-score.
function spreadStats(a, b, ratio, marks) {
  const A = candles(a, marks[a], '1W'), B = candles(b, marks[b], '1W')
  const pts = A.map((x, i) => x.c - ratio * B[i].c)
  const n = pts.length, mean = pts.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(pts.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1e-9
  const last = marks[a] - ratio * marks[b]
  return { pts, mean, sd, last, z: (last - mean) / sd }
}

function SpreadChart({ st }) {
  const W = 560, H = 120, lo = Math.min(...st.pts, st.mean - st.sd), hi = Math.max(...st.pts, st.mean + st.sd)
  const X = (i) => 6 + (i / (st.pts.length - 1)) * (W - 70), Y = (v) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 28)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Spread history">
      <rect x="6" width={W - 70} y={Y(st.mean + st.sd)} height={Math.max(1, Y(st.mean - st.sd) - Y(st.mean + st.sd))} fill="#8fa9d6" opacity="0.08" />
      <line x1="6" x2={W - 64} y1={Y(st.mean)} y2={Y(st.mean)} stroke="#8fa9d6" strokeDasharray="3 3" opacity="0.6" />
      <polyline fill="none" stroke="#e8e2b9" strokeWidth="1.6" points={st.pts.map((p, i) => `${X(i)},${Y(p)}`).join(' ')} />
      <text x={W - 60} y={Y(st.mean) + 4} className="axis">mean {fmt(st.mean)}</text>
      <text x={W - 60} y={Y(st.pts.at(-1)) + 4} className="axis" fill="#e8e2b9">now {fmt(st.last)}</text>
    </svg>
  )
}

function zText(z) {
  const a = Math.abs(z)
  if (a < 0.75) return 'Near its 1-week average. No obvious dislocation.'
  return `${a.toFixed(1)}σ ${z > 0 ? 'above' : 'below'} its 1-week average. ${z > 0 ? 'Rich: sellers of the spread may see value.' : 'Cheap: buyers of the spread may see value.'}`
}

function SpreadNew({ marks, tick, createSpread, onCreated, initial }) {
  // initial: { a, b, side, qty } from another page, or { a } when coming from a single contract.
  const [idea, setIdea] = useState(initial ? null : 'upgrade')
  const base = IDEAS.find((i) => i.k === idea) || IDEAS[0]
  const a0 = initial?.a || sym(...base.a)
  const [x, setX] = useState({ type: initial ? (initial.b && skuOf(initial.b) === skuOf(a0) ? 'Calendar' : 'Cross-GPU') : base.type, a: a0, b: initial?.b || (initial ? sym(skuOf(a0) === 'H100' ? 'B200' : 'H100', INSTRUMENTS.find((i) => i.sym === a0).m) : sym(...base.b)), side: initial?.side || base.side, qty: initial?.qty || 50, weight: '1:1', thesis: '' })
  const pick = (i) => { setIdea(i.k); setX({ ...x, type: i.type, a: sym(...i.a), b: sym(...i.b), side: i.side }) }
  const ratio = x.weight === '1:1' ? 1 : Math.round((marks[x.a] / marks[x.b]) * 100) / 100
  const st = spreadStats(x.a, x.b, ratio, marks)
  // Legging on screen: cross both books, one leg at a time.
  const sg = x.side === 'Buy' ? 1 : -1
  const ta = top(x.a, marks[x.a], tick), tb = top(x.b, marks[x.b], tick)
  const legged = sg > 0 ? ta.ask.px - ratio * tb.bid.px : ta.bid.px - ratio * tb.ask.px
  const same = x.a === x.b
  const opts = INSTRUMENTS.filter((i) => x.type === 'Cross-GPU' ? true : x.type === 'Calendar' ? skuOf(i.sym) === skuOf(x.a) : true)
  return (
    <Panel title="New spread request" right={<span className="note">Two listed contracts, one net price</span>}>
      <div className="ideas">
        {IDEAS.map((i) => (
          <button key={i.k} className={'idea' + (idea === i.k ? ' on' : '')} onClick={() => pick(i)}>
            <span className="chip">{i.type}</span><b>{i.label}</b><span className="note">{i.why}</span>
          </button>
        ))}
      </div>
      <div className="form" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 14 }}>
        <label>Spread type<select value={x.type} onChange={(e) => { setIdea(null); setX({ ...x, type: e.target.value, b: e.target.value === 'Calendar' ? sym(skuOf(x.a), 'DEC26') : x.b }) }}><option>Cross-GPU</option><option>Calendar</option><option>Custom</option></select></label>
        <label>Leg A<select value={x.a} onChange={(e) => { setIdea(null); setX({ ...x, a: e.target.value }) }}>{INSTRUMENTS.map((i) => <option key={i.sym}>{i.sym}</option>)}</select></label>
        <label>Leg B<select value={x.b} onChange={(e) => { setIdea(null); setX({ ...x, b: e.target.value }) }}>{opts.map((i) => <option key={i.sym}>{i.sym}</option>)}</select></label>
        <label>Direction<select value={x.side} onChange={(e) => setX({ ...x, side: e.target.value })}><option value="Buy">Buy spread (buy A, sell B)</option><option value="Sell">Sell spread (sell A, buy B)</option></select></label>
        <label>Contracts (leg A)<input type="number" min="1" value={x.qty} onChange={(e) => setX({ ...x, qty: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label>Weighting<select value={x.weight} onChange={(e) => setX({ ...x, weight: e.target.value })}><option value="1:1">1:1 contracts</option><option value="dollar">Dollar-neutral</option></select></label>
        <label className="full" style={{ gridColumn: 'span 2' }}>Thesis (private note)<input value={x.thesis} placeholder="Why this spread?" onChange={(e) => setX({ ...x, thesis: e.target.value })} /></label>
      </div>
      <div className="spread-view">
        <div className="legs">
          <div className="legcard"><span className={sg > 0 ? 'up' : 'dn'}>{sg > 0 ? 'BUY' : 'SELL'} {x.qty}</span><b className="mono">{x.a}</b><span className="note">mid {fmt(marks[x.a])}</span></div>
          <div className="legop">−{ratio !== 1 ? ` ${ratio}×` : ''}</div>
          <div className="legcard"><span className={sg > 0 ? 'dn' : 'up'}>{sg > 0 ? 'SELL' : 'BUY'} {Math.round(x.qty * ratio)}</span><b className="mono">{x.b}</b><span className="note">mid {fmt(marks[x.b])}</span></div>
          <div className="legop">=</div>
          <div className="legcard hero"><span className="note">Screen spread</span><b className="mono cream">{fmt(st.last)}</b><span className="note">$/GPU-hr</span></div>
        </div>
        <SpreadChart st={st} />
        <div className={'signal ' + (Math.abs(st.z) >= 0.75 ? 'hot' : '')}><b>Signal</b> {zText(st.z)}</div>
        <div className="kv"><span>Legging it on screen (cross both books)</span><b>{fmt(legged)}</b></div>
        <div className="kv"><span>Notional, both legs</span><b>{usd(x.qty * SIZE * (marks[x.a] + ratio * marks[x.b]))}</b></div>
        <p className="note" style={{ margin: 0 }}>Market makers quote one net price. On a hit, both legs book at the same moment as two separate futures contracts, cleared through your FCM. No legging risk, and margin nets across the pair.</p>
      </div>
      <div className="row between" style={{ marginTop: 14 }}>
        <span className="note">{same ? 'Pick two different contracts.' : `Anonymous to ${['Lattice Trading', 'MM 2', 'MM 3'].length} market makers · quotes firm for 15s`}</span>
        <button className="btn big" disabled={same} onClick={() => onCreated(createSpread({ type: x.type, a: x.a, b: x.b, side: x.side, qty: x.qty, ratio, thesis: x.thesis }))}>Request spread quotes</button>
      </div>
    </Panel>
  )
}

function SpreadDetail({ x, session, marks, tick, hitSpread, quoteSpread }) {
  const st = spreadStats(x.a, x.b, x.ratio, marks)
  const sg = x.side === 'Buy' ? 1 : -1
  const ta = top(x.a, marks[x.a], tick), tb = top(x.b, marks[x.b], tick)
  const legged = sg > 0 ? ta.ask.px - x.ratio * tb.bid.px : ta.bid.px - x.ratio * tb.ask.px
  const mine = x.owner === session
  const ranked = [...x.quotes].sort((p, q) => sg * (p.px - q.px))
  const myQ = x.quotes.find((q) => q.mine === session)
  const [px, setPx] = useState(roundTick(st.last + sg * TICK))
  const verb = (s) => (s === 'Buy' ? 'Buy' : 'Sell')
  return (
    <div className="stack">
      <Panel title={`${x.id} · ${x.type} spread`} right={<span className={'pill ' + (x.status === 'open' ? 'warn' : 'good')}>{x.status === 'open' ? `Open · ${x.quotes.length} responses` : `Done with ${x.done.name}`}</span>}>
        <div className="legs">
          <div className="legcard"><span className={sg > 0 ? 'up' : 'dn'}>{verb(x.side).toUpperCase()} {x.qty}</span><b className="mono">{x.a}</b><span className="note">mid {fmt(marks[x.a])}</span></div>
          <div className="legop">−{x.ratio !== 1 ? ` ${x.ratio}×` : ''}</div>
          <div className="legcard"><span className={sg > 0 ? 'dn' : 'up'}>{(sg > 0 ? 'Sell' : 'Buy').toUpperCase()} {Math.round(x.qty * x.ratio)}</span><b className="mono">{x.b}</b><span className="note">mid {fmt(marks[x.b])}</span></div>
          <div className="legop">=</div>
          <div className="legcard hero"><span className="note">Screen spread</span><b className="mono cream">{fmt(st.last)}</b><span className="note">{mine ? 'You' : x.by} · {x.created}</span></div>
        </div>
        <SpreadChart st={st} />
        <div className={'signal ' + (Math.abs(st.z) >= 0.75 ? 'hot' : '')}><b>Signal</b> {zText(st.z)}</div>
        {x.thesis && mine && <p className="note" style={{ margin: '8px 0 0' }}>Thesis: {x.thesis}</p>}
      </Panel>

      {!mine && x.status === 'open' && (
        <Panel title="Your quote" right={<span className="note">Requester is blind. They {x.side === 'Buy' ? 'buy' : 'sell'} the spread</span>}>
          <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
            <label style={{ width: 180 }}>Net price $/GPU-hr<input type="number" step="0.01" value={px} onChange={(e) => setPx(Number(e.target.value))} /></label>
            <div className="stat"><div className="k">vs screen</div><div className="v">{px - st.last >= 0 ? '+' : ''}{fmt(px - st.last)}</div></div>
            <div className="stat"><div className="k">Best other</div><div className="v">{ranked.filter((q) => !q.mine)[0] ? fmt(ranked.filter((q) => !q.mine)[0].px) : '—'}</div></div>
            <button className="btn" onClick={() => quoteSpread(x.id, roundTick(px))}>{myQ ? 'Update quote' : 'Send quote'}</button>
          </div>
          {myQ && <p className="note">Quote live at {fmt(myQ.px)}. If it is the best price the requester can hit it; both legs then book to you on the other side.</p>}
        </Panel>
      )}

      <Panel title="Responses" right={<span className="meth">{mine ? (x.side === 'Buy' ? 'Lowest price is best for you' : 'Highest price is best for you') : (x.side === 'Buy' ? 'Requester buys: lowest price wins' : 'Requester sells: highest price wins')} · legging on screen {fmt(legged)}</span>}>
        {ranked.length === 0 && <p className="note">Waiting for market makers… quotes stream in here.</p>}
        {ranked.map((q, i) => {
          const edge = (legged - q.px) * sg * x.qty * SIZE
          const won = x.done && x.done.name === q.name
          return (
            <div key={q.id} className={'quote-row' + (won ? ' won' : '')}>
              <span>{q.mine === session ? 'You' : mine || x.status !== 'open' ? q.name : 'Market maker'}</span>
              <b className="mono cream">{fmt(q.px)}</b>
              <span className="note">{edge >= 0 ? 'beats legging it by ' : 'worse than legging by '}{usd(Math.abs(edge))}</span>
              {mine && x.status === 'open' ? <button className="btn" onClick={() => hitSpread(x.id, q.id)}>{i === 0 ? 'Hit best' : 'Hit'}</button> : won ? <span className="pill good">traded</span> : <span />}
            </div>
          )
        })}
        {x.done && (
          <div className="callout good" style={{ marginTop: 12 }}>
            {x.done.mine === session ? <>Your quote traded at <b>{fmt(x.done.px)}</b>.</> : <>Traded at <b>{fmt(x.done.px)}</b> with {x.done.name}.</>} {x.done.mine === session || mine ? 'Two block fills, cleared via your FCM:' : 'Printed to the tape as a block spread.'}
            {x.done.aPx != null && (x.done.mine === session || mine) && (() => { const buyA = (x.side === 'Buy') !== (x.done.mine === session); return <> {buyA ? 'bought' : 'sold'} {x.qty} {x.a} @ {fmt(x.done.aPx)}, {buyA ? 'sold' : 'bought'} {Math.round(x.qty * x.ratio)} {x.b} @ {fmt(x.done.bPx)}.</> })()}
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ---------- Flex contract request ---------- */
function FlexNew({ marks, onDone }) {
  const [flex, setFlex] = useState({ sku: 'H200', region: 'EU', start: 'MAR27', term: 3, settle: 'Cash', side: 'Buy', qty: 50 })
  const [quotes, setQuotes] = useState(null)
  const [done, setDone] = useState(null)
  const bench = marks[sym(flex.sku, flex.start)]
  const set = (k, num) => (e) => setFlex({ ...flex, [k]: num ? Number(e.target.value) : e.target.value })
  const ask = () => {
    setDone(null); setQuotes([])
    const prem = flex.region === 'EU' ? 0.06 : 0
    ;['Lattice Trading', 'MM 2', 'MM 3'].forEach((n, i) => setTimeout(() => setQuotes((q) => [...(q || []), { n, px: roundTick(bench + prem + 0.02 * (i + 1)), spread: roundTick(prem + 0.02 * (i + 1)) }].sort((a, b) => a.px - b.px)), 800 * (i + 1)))
  }
  return (
    <Panel title="New flex request" right={<span className="note">Any SKU, region or term</span>}>
      <p className="note" style={{ marginTop: -4 }}>Not on the screen? Ask for it. A flex contract is quoted as a spread to the listed benchmark and cleared the same way. Popular flex terms get promoted to listed contracts.</p>
      <div className="form" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <label>SKU<select value={flex.sku} onChange={set('sku')}>{Object.keys(SKUS).map((k) => <option key={k}>{k}</option>)}</select></label>
        <label>Region<select value={flex.region} onChange={set('region')}><option>US</option><option>EU</option></select></label>
        <label>Start<select value={flex.start} onChange={set('start')}>{MONTHS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Term (months)<select value={flex.term} onChange={set('term', true)}>{[1, 2, 3, 6, 9, 12].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Settlement<select value={flex.settle} onChange={set('settle')}><option>Cash</option><option>Physical</option></select></label>
        <label>Side<select value={flex.side} onChange={set('side')}><option>Buy</option><option>Sell</option></select></label>
        <label>Contracts<input type="number" min="1" value={flex.qty} onChange={set('qty', true)} /></label>
        <label>Benchmark ({sym(flex.sku, flex.start)})<input disabled value={fmt(bench)} /></label>
      </div>
      <div className="row between" style={{ marginTop: 14 }}><span className="note">Anonymous to market makers · firm for 15s</span><button className="btn big" onClick={ask}>Request flex quotes</button></div>
      {quotes && (
        <div style={{ marginTop: 12 }}>
          {quotes.length === 0 && <p className="note">Waiting for market makers…</p>}
          {quotes.map((q, i) => (
            <div key={q.n} className="quote-row">
              <span>{q.n}</span><b className="mono cream">{fmt(q.px)}</b><span className="note">bench +{fmt(q.spread)}</span>
              <button className="btn" disabled={!!done} onClick={() => setDone(q)}>{i === 0 ? 'Hit best' : 'Hit'}</button>
            </div>
          ))}
          {done && <div className="callout good" style={{ marginTop: 12 }}>Flex trade agreed with {done.n}: {flex.side.toLowerCase()} {flex.qty} × {flex.sku} {flex.region} {flex.start} for {flex.term} mo, {flex.settle.toLowerCase()}-settled at ${fmt(done.px)}. Booked as a flex contract and cleared via your FCM. <button className="link" onClick={onDone}>Back to requests</button></div>}
        </div>
      )}
    </Panel>
  )
}

/* ---------- Board cards ---------- */
// Price ladder: where each response sits against the reference (screen or index).
function Ladder({ ref0, pts, best, better }) {
  const all = [ref0, ...pts]
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.15 || 0.02
  const X = (v) => 4 + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 92
  return (
    <div className="ladder" aria-hidden="true">
      <i className="ref" style={{ left: X(ref0) + '%' }} />
      {pts.map((p, i) => <i key={i} className={'pt' + (p === best ? ' best' : '')} style={{ left: X(p) + '%' }} />)}
      <span className="lbl" style={{ left: X(ref0) + '%' }}>ref</span>
      {better && <span className="dir">{better}</span>}
    </div>
  )
}

function Card({ on, onClick, kind, title, sub, status, statusCls, ladder, foot }) {
  return (
    <button className={'rcard' + (on ? ' on' : '')} onClick={onClick}>
      <div className="row between"><span className={'kind k-' + kind.toLowerCase().replace(/[^a-z]/g, '')}>{kind}</span><span className={'pill ' + statusCls}>{status}</span></div>
      <b className="rtitle">{title}</b>
      <span className="note">{sub}</span>
      {ladder}
      {foot && <span className="rfoot">{foot}</span>}
    </button>
  )
}

const KINDS = {
  RFQ: { icon: '▦', title: 'Physical capacity', blurb: 'Blind RFQ to providers for GPUs on the standard term sheet.' },
  EFP: { icon: '⇄', title: 'Convert to Physical', blurb: 'Swap your long futures for a Node-Month Contract (EFP).' },
  Spread: { icon: '⟋', title: 'Spread trade', blurb: 'Trade one GPU or month against another at a single net price.' },
  Flex: { icon: '✦', title: 'Flex contract', blurb: 'Any SKU, region or term that is not listed, cash or physical.' },
}

/* ---------- Page ---------- */
export default function Request(props) {
  const { me, session, acct, marks, tick, requests, contracts, spreads, createRequest, createSpread, hitSpread, quoteSpread, providerQuote, award, updateContract, prefill, setPrefill } = props
  const buyer = me.kind === 'end_user'
  const provider = me.kind === 'provider'
  const mm = me.kind === 'mm'
  const kinds = buyer ? ['RFQ', 'EFP', 'Spread', 'Flex'] : ['Spread', 'Flex']
  const start = prefill?.kind === 'EFP' ? (provider ? null : 'EFP') : prefill?.kind === 'Spread' || prefill?.sym ? 'Spread' : prefill?.kind === 'RFQ' && buyer ? 'RFQ' : null
  const [compose, setCompose] = useState(start)
  const [sel, setSel] = useState(prefill?.kind === 'EFP' && provider ? requests.find((r) => r.kind === 'EFP' && r.owner !== session && r.status === 'open')?.id : null)
  useEffect(() => () => setPrefill(null), [])

  const physMine = requests.filter((r) => r.owner === session)
  const physOpen = provider ? requests.filter((r) => r.owner !== session && (r.status === 'open' || r.quotes.some((q) => q.mine === session))) : []
  const sprMine = spreads.filter((x) => x.owner === session)
  const sprOpen = mm ? spreads.filter((x) => x.owner !== session && (x.status === 'open' || x.quotes.some((q) => q.mine === session))) : []
  const myContracts = contracts.filter((c) => c.buyer === me.name || c.provider === me.name)

  const items = [
    ...physMine.map((r) => ({ key: r.id, sec: 'mine', r })), ...sprMine.map((x) => ({ key: x.id, sec: 'mine', x })),
    ...physOpen.map((r) => ({ key: r.id, sec: 'open', r })), ...sprOpen.map((x) => ({ key: x.id, sec: 'open', x })),
    ...myContracts.map((c) => ({ key: c.id, sec: 'del', c })),
  ]
  const cur = compose ? null : items.find((i) => i.key === sel) || items[0]
  const open = (k) => { setCompose(null); setSel(k) }

  const physCard = (r) => {
    const ref0 = refPrice(r, marks)
    const ok = r.quotes.filter((q) => !q.fails.length)
    const best = ok.length ? Math.min(...ok.map((q) => ref0 + q.norm)) : null
    return <Card key={r.id} on={cur?.key === r.id} onClick={() => open(r.id)} kind={r.kind === 'EFP' ? 'EFP' : 'RFQ'}
      title={`${r.sku} × ${r.gpus} GPUs · ${r.term} mo`} sub={`${r.region} · ${r.ic} · from ${r.start} · ${r.owner === session ? 'you' : r.buyer}`}
      status={r.status === 'open' ? `${r.quotes.length} responses · ${r.closes}` : 'awarded'} statusCls={r.status === 'open' ? 'warn' : 'good'}
      ladder={r.quotes.length ? <Ladder ref0={ref0} pts={ok.map((q) => ref0 + q.norm)} best={best} better="← lower is better" /> : <div className="ladder empty"><span className="note">Waiting for providers…</span></div>}
      foot={best != null ? <>Best all-in <b className="cream mono">${fmt(best, 3)}</b> · ref ${fmt(ref0)}</> : null} />
  }
  const sprCard = (x) => {
    const sg = x.side === 'Buy' ? 1 : -1, ref0 = marks[x.a] - x.ratio * marks[x.b]
    const best = x.quotes.length ? x.quotes.map((q) => q.px).reduce((b, p) => (sg * p < sg * b ? p : b)) : null
    return <Card key={x.id} on={cur?.key === x.id} onClick={() => open(x.id)} kind="Spread"
      title={`${x.side} ${x.a} / ${x.b.split(' ')[1] && x.a.split(' ')[0] === x.b.split(' ')[0] ? x.b.split(' ')[1] : x.b}`} sub={`${x.type} · ${x.qty} contracts · ${x.owner === session ? 'you' : x.by}`}
      status={x.status === 'open' ? `${x.quotes.length} responses` : 'traded'} statusCls={x.status === 'open' ? 'warn' : 'good'}
      ladder={x.quotes.length ? <Ladder ref0={ref0} pts={x.quotes.map((q) => q.px)} best={best} better={sg > 0 ? '← lower is better' : 'higher is better →'} /> : <div className="ladder empty"><span className="note">Waiting for market makers…</span></div>}
      foot={<>{x.status === 'done' ? 'Traded' : 'Best'} <b className="cream mono">{x.status === 'done' ? fmt(x.done.px) : best != null ? fmt(best) : '—'}</b> · screen {fmt(ref0)}</>} />
  }
  const delCard = (c) => <Card key={c.id} on={cur?.key === c.id} onClick={() => open(c.id)} kind="Delivery" title={`${c.sku} × ${c.gpus} · ${c.months} mo`} sub={`${c.id} · via ${c.via} · ${c.provider}`}
    status={c.stage === 5 ? `Live · ${c.month}/${c.months}` : D_STEPS[c.stage]} statusCls={c.failed ? 'crit' : 'good'}
    ladder={<div className="dsteps">{D_STEPS.map((d, i) => <i key={d} className={i <= c.stage ? 'on' : ''} title={d} />)}</div>} />
  const card = (i) => (i.r ? physCard(i.r) : i.x ? sprCard(i.x) : delCard(i.c))
  const section = (sec, title, empty) => {
    const list = items.filter((i) => i.sec === sec)
    if (!list.length && !empty) return null
    return <div className="rsec"><div className="eyebrow">{title} <span className="note">{list.length}</span></div>{list.length ? list.map(card) : <p className="note" style={{ margin: 0 }}>{empty}</p>}</div>
  }

  return (
    <div className="stack">
      <div><h1>Request</h1><p className="sub">{buyer ? 'Source GPUs, convert futures to physical, or trade spreads. Every request is anonymous and every response lands here.' : provider ? 'Quote buyers’ requests for capacity, and hedge with spread trades.' : 'Trade spreads between GPUs and months at one net price, or ask for anything not listed.'} Futures quotes on a single contract live in the Trade ticket.</p></div>

      <div className={'hero-rfq' + (compose ? ' compact' : '')}>
        <div className="hero-copy">
          <div className="hero-t">Request a quote</div>
          <div className="note">Anonymous. Firm quotes from {buyer ? 'providers and market makers' : 'market makers'}, usually in under a minute.</div>
        </div>
        <div className="tiles">
          {kinds.map((k) => (
            <button key={k} className={'tile' + (compose === k ? ' on' : '')} onClick={() => (k === 'EFP' ? props.setTab('convert') : setCompose(k))}>
              <span className="ti">{KINDS[k].icon}</span><b>{KINDS[k].title}</b><span className="note">{KINDS[k].blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rboard">
        <div className="rcol">
          {section('mine', 'Your requests', 'Nothing yet. Pick a request type above to start.')}
          {section('open', provider ? 'Buyers’ requests to quote' : 'Spread requests to quote')}
          {section('del', 'In delivery')}
        </div>
        <div className="rmain">
          {compose === 'RFQ' || compose === 'EFP' ? <NewRequest key={compose} acct={acct} marks={marks} createRequest={createRequest} prefill={{ ...(prefill || {}), kind: compose }} onCreated={open} />
            : compose === 'Spread' ? <SpreadNew marks={marks} tick={tick} createSpread={createSpread} onCreated={open} initial={prefill?.kind === 'Spread' ? prefill : prefill?.sym ? { a: prefill.sym } : null} />
            : compose === 'Flex' ? <FlexNew marks={marks} onDone={() => setCompose(null)} />
            : cur?.r ? <Detail r={cur.r} me={me} session={session} marks={marks} award={award} providerQuote={providerQuote} openContract={open} />
            : cur?.x ? <SpreadDetail key={cur.x.id} x={cur.x} session={session} marks={marks} tick={tick} hitSpread={hitSpread} quoteSpread={quoteSpread} />
            : cur?.c ? <Delivery c={cur.c} updateContract={updateContract} />
            : <Panel title="Nothing selected"><p className="note">Start a request above.</p></Panel>}
        </div>
      </div>
    </div>
  )
}
