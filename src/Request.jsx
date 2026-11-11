import React, { useEffect, useState } from 'react'
import { SKUS, MONTHS, SIZE, TICK, INSTRUMENTS, fmt, usd, sym, skuOf, roundTick } from './data.js'
import { Panel, Seg, Stat, Steps } from './ui.jsx'

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

/* ---------- Block RFQ for futures (speculators, market makers) ---------- */
function BlockRfq({ marks, placeOrder, initial }) {
  const [mode, setMode] = useState('Listed')
  const [flex, setFlex] = useState({ sku: 'H200', region: 'EU', start: 'MAR27', term: 3, settle: 'Cash' })
  const [s, setS] = useState(initial || sym('B200', 'MAR27'))
  const [side, setSide] = useState('Buy')
  const [qty, setQty] = useState(100)
  const [quotes, setQuotes] = useState(null)
  const [done, setDone] = useState(null)
  const ask = () => {
    setDone(null); setQuotes([])
    if (mode === 'Flex') {
      const bench = marks[sym(flex.sku, flex.start)]
      const prem = flex.region === 'EU' ? 0.06 : 0
      ;['Lattice Trading', 'MM 2', 'MM 3'].forEach((n, i) => setTimeout(() => setQuotes((q) => [...(q || []), { n, px: roundTick(bench + prem + 0.02 * (i + 1)), spread: roundTick(prem + 0.02 * (i + 1)) }].sort((a, b) => a.px - b.px)), 800 * (i + 1)))
      return
    }
    ;['Lattice Trading', 'MM 2', 'MM 3'].forEach((n, i) => setTimeout(() => setQuotes((q) => [...(q || []), { n, px: roundTick(marks[s] + (side === 'Buy' ? 1 : -1) * TICK * (1 + i)) }].sort((a, b) => (side === 'Buy' ? a.px - b.px : b.px - a.px))), 700 * (i + 1)))
  }
  return (
    <div className="grid2">
      <Panel title="If it’s not on the screen, ask for it" right={<Seg small value={mode} options={['Listed', 'Flex']} onChange={(m) => { setMode(m); setQuotes(null); setDone(null) }} />}>
        <p className="note" style={{ marginTop: -4 }}>{mode === 'Listed' ? 'Anonymous RFQ on any listed month, even with an empty book. Market makers must respond under the MM programme. Blocks (25+ contracts) print to the tape after execution.' : 'Flex contract: pick the SKU, region, start and term you need, cash or physical. Quoted as a spread to the listed benchmark and cleared the same way. Popular flex terms get promoted to listed contracts.'}</p>
        <div className="form">
          {mode === 'Listed' ? <label>Contract<select value={s} onChange={(e) => setS(e.target.value)}>{INSTRUMENTS.map((i) => <option key={i.sym}>{i.sym}</option>)}</select></label> : <>
            <label>SKU<select value={flex.sku} onChange={(e) => setFlex({ ...flex, sku: e.target.value })}>{Object.keys(SKUS).map((k) => <option key={k}>{k}</option>)}</select></label>
            <label>Region<select value={flex.region} onChange={(e) => setFlex({ ...flex, region: e.target.value })}><option>US</option><option>EU</option></select></label>
            <label>Start<select value={flex.start} onChange={(e) => setFlex({ ...flex, start: e.target.value })}>{MONTHS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label>Term (months)<select value={flex.term} onChange={(e) => setFlex({ ...flex, term: Number(e.target.value) })}>{[1, 2, 3, 6, 9, 12].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label>Settlement<select value={flex.settle} onChange={(e) => setFlex({ ...flex, settle: e.target.value })}><option>Cash</option><option>Physical</option></select></label>
          </>}
          <label>Side<select value={side} onChange={(e) => setSide(e.target.value)}><option>Buy</option><option>Sell</option></select></label>
          <label>Contracts (min 25)<input type="number" min="25" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></label>
          <label>Screen mid<input disabled value={fmt(marks[s])} /></label>
          <button className="btn full" disabled={qty < 25} onClick={ask}>Request block quotes</button>
        </div>
      </Panel>
      <Panel title="Block quotes">
        {!quotes && <p className="note">Quotes from market makers appear here, firm for 15 seconds.</p>}
        {quotes && quotes.map((q, i) => (
          <div key={q.n} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{q.n}</span><span className="mono cream">{fmt(q.px)}{q.spread != null && <span className="note"> (bench +{fmt(q.spread)})</span>}</span><span className="note">{qty} × {SIZE} GPU-hrs</span>
            <button className="btn" disabled={!!done} onClick={() => { if (mode === 'Listed') placeOrder({ sym: s, side, qty, type: 'Market', px: q.px, tif: 'IOC', venue: 'Block' }); setDone(q) }}>{i === 0 ? 'Hit best' : 'Hit'}</button>
          </div>
        ))}
        {done && <div className="callout good" style={{ marginTop: 12 }}>{mode === 'Listed' ? `Executed with ${done.n}: ${side.toLowerCase()} ${qty} ${s}. Cleared via your FCM.` : `Flex trade agreed with ${done.n}: ${flex.sku} ${flex.region} ${flex.start} × ${flex.term} mo, ${flex.settle.toLowerCase()}-settled at $${fmt(done.px)}. Booked as a flex contract and cleared via your FCM.`}</div>}
      </Panel>
    </div>
  )
}

/* ---------- Page ---------- */
export default function Request(props) {
  const { me, session, acct, marks, requests, contracts, createRequest, providerQuote, award, updateContract, prefill, setPrefill, placeOrder } = props
  const buyer = me.kind === 'end_user'
  const provider = me.kind === 'provider'
  const [view, setView] = useState(prefill?.sym ? 'block' : prefill ? (provider ? 'inbox' : 'new') : buyer ? 'mine' : 'inbox')
  const [sel, setSel] = useState(null)
  const [selC, setSelC] = useState(null)
  useEffect(() => () => setPrefill(null), [])

  if (!buyer && !provider) return <div className="stack"><div><h1>Request</h1><p className="sub">Ask market makers for a price on any listed month, a block, or a flex contract.</p></div><BlockRfq marks={marks} placeOrder={placeOrder} initial={prefill?.sym} /></div>

  const inbox = requests.filter((r) => r.owner !== session && r.status === 'open')
  const mine = requests.filter((r) => r.owner === session)
  const quoted = requests.filter((r) => r.quotes.some((q) => q.mine === session))
  const myContracts = contracts.filter((c) => c.buyer === me.name || c.provider === me.name)
  const list = view === 'inbox' ? inbox : view === 'quoted' ? quoted : mine
  const cur = requests.find((r) => r.id === sel) || (view === 'inbox' && prefill?.kind === 'EFP' ? inbox.find((r) => r.kind === 'EFP') : null) || list[0]
  const curC = myContracts.find((c) => c.id === selC) || myContracts[0]
  const views = buyer ? [['mine', `My requests · ${mine.length}`], ['new', '+ New request'], ['contracts', `Contracts · ${myContracts.length}`], ['block', 'Futures RFQ']] : [['inbox', `Inbox · ${inbox.length}`], ['quoted', `My quotes · ${quoted.length}`], ['contracts', `Contracts · ${myContracts.length}`], ['block', 'Futures RFQ']]

  return (
    <div className="stack">
      <div className="row between">
        <div><h1>Request</h1><p className="sub">{buyer ? 'Source physical capacity by blind RFQ, or convert your futures into GPUs.' : 'Quote buyers’ requests for capacity, including EFPs that take your futures hedge.'}</p></div>
        <Seg value={view} options={views} onChange={(v) => { setView(v); setSel(null) }} />
      </div>
      {view === 'new' && <NewRequest acct={acct} marks={marks} createRequest={createRequest} prefill={prefill} onCreated={(id) => { setSel(id); setView('mine') }} />}
      {(view === 'mine' || view === 'inbox' || view === 'quoted') && (
        <div className="rq">
          <div className="rq-list">
            {list.length === 0 && <p className="note" style={{ padding: 14 }}>{buyer ? 'No requests yet. Start one with “New request”.' : 'Nothing here yet.'}</p>}
            {list.map((r) => (
              <button key={r.id} className={'rq-item' + (cur && cur.id === r.id ? ' on' : '')} onClick={() => setSel(r.id)}>
                <div className="row between"><b className="mono">{r.id}</b><span className={'chip' + (r.kind === 'EFP' ? ' accent' : '')}>{r.kind === 'EFP' ? 'EFP' : 'RFQ'}</span></div>
                <span>{r.sku} × {r.gpus} · {r.region}</span>
                <span className="note">{r.start} · {r.term} mo · max +{fmt(r.maxBasis)}</span>
                <span className={'pill ' + (r.status === 'open' ? 'warn' : 'good')}>{r.status === 'open' ? `${r.quotes.length} quotes · ${r.closes}` : 'awarded'}</span>
              </button>
            ))}
          </div>
          <div>{cur ? <Detail r={cur} me={me} session={session} marks={marks} award={award} providerQuote={providerQuote} openContract={(id) => { setSelC(id); setView('contracts') }} /> : null}</div>
        </div>
      )}
      {view === 'block' && <BlockRfq marks={marks} placeOrder={placeOrder} initial={prefill?.sym} />}
      {view === 'contracts' && (
        <div className="rq">
          <div className="rq-list">
            {myContracts.map((c) => (
              <button key={c.id} className={'rq-item' + (curC && curC.id === c.id ? ' on' : '')} onClick={() => setSelC(c.id)}>
                <div className="row between"><b className="mono">{c.id}</b><span className="chip">{c.via}</span></div>
                <span>{c.sku} × {c.gpus} · {c.months} mo</span>
                <span className="pill good">{c.stage === 5 ? `Live · ${c.month}/${c.months}` : D_STEPS[c.stage]}</span>
              </button>
            ))}
          </div>
          <div>{curC && <Delivery c={curC} updateContract={updateContract} />}</div>
        </div>
      )}
    </div>
  )
}
