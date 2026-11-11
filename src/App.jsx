import React, { useEffect, useMemo, useState } from 'react'
import { ACCOUNTS, SEED, SKUS, MONTHS, SIZE, TICK, IM_RATE, INSTRUMENTS, SEED_CONTRACTS, INCOMING, PROVIDERS, curvePx, sym, roundTick, fmt, scoreQuote } from './data.js'
import { Logo } from './ui.jsx'
import Login from './Login.jsx'
import Home from './Home.jsx'
import Trade from './Trade.jsx'
import Request from './Request.jsx'
import Integrate from './Integrate.jsx'

// Compute Desk Exchange prototype. Login picks an account (each stands in for a participant
// type); all market data is simulated locally around the example forward curves.

const TABS = [['home', 'Home'], ['trade', 'Trade'], ['request', 'Request'], ['integrate', 'Integrate']]

let seq = 4100
const nextId = (p) => `${p}-${++seq}`
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ')

function seedFills(key) {
  const s = SEED[key]
  const open = Object.entries(s.positions).map(([k, p], i) => ({
    id: nextId('F'), ts: `2026-${String(8 + (i % 3)).padStart(2, '0')}-${String(3 + i * 4).padStart(2, '0')} 14:${String(10 + i * 7).padStart(2, '0')}`,
    sym: k, side: p.qty > 0 ? 'Buy' : 'Sell', qty: Math.abs(p.qty), px: p.avg, venue: i % 3 === 2 ? 'Block' : 'CLOB', status: 'Cleared',
  }))
  const closed = s.closed.map((c) => ({ id: nextId('F'), ts: c.date + ' 16:00', sym: c.sym, side: c.qty >= 0 ? 'Sell' : 'Buy', qty: Math.abs(c.qty) || 620, px: c.exit, venue: c.how.startsWith('Cash') ? 'Final settlement' : 'CLOB', status: 'Settled' }))
  return [...open, ...closed].sort((a, b) => (a.ts < b.ts ? 1 : -1))
}

// Apply a fill to a position map. Returns the new map plus any quantity it closed.
export function applyFill(pos, s, delta, px) {
  const cur = pos[s] || { qty: 0, avg: px }
  const q = cur.qty + delta
  let avg = cur.avg
  if (cur.qty === 0 || Math.sign(cur.qty) === Math.sign(delta)) avg = (cur.avg * Math.abs(cur.qty) + px * Math.abs(delta)) / Math.abs(q)
  else if (q !== 0 && Math.sign(q) !== Math.sign(cur.qty)) avg = px
  const next = { ...pos }
  if (q === 0) delete next[s]
  else next[s] = { qty: q, avg }
  const reducing = cur.qty !== 0 && Math.sign(cur.qty) !== Math.sign(delta)
  return { next, closedQty: reducing ? Math.min(Math.abs(delta), Math.abs(cur.qty)) * Math.sign(cur.qty) : 0, entry: cur.avg }
}

export default function App() {
  const [session, setSession] = useState(null)
  const [tab, setTab] = useState('home')
  const [menu, setMenu] = useState(false)
  const [accts, setAccts] = useState(() => Object.fromEntries(Object.keys(ACCOUNTS).map((k) => [k, { cash: SEED[k].cash, positions: SEED[k].positions, closed: SEED[k].closed, orders: [], fills: seedFills(k) }])))
  const [contracts, setContracts] = useState(SEED_CONTRACTS)
  const [requests, setRequests] = useState(INCOMING.map((r) => ({ ...r, status: 'open', quotes: [] })))
  const [drift, setDrift] = useState({ H100: 0, H200: 0, B200: 0, B300: 0 })
  const [tick, setTick] = useState(0)
  const [feed, setFeed] = useState([])
  const [tape, setTape] = useState([])
  const [prefill, setPrefill] = useState(null)
  const [focus, setFocus] = useState(sym('H100', 'JUN27'))

  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1)
      setDrift((d) => {
        const n = { ...d }
        for (const k of Object.keys(n)) {
          const r = Math.random(), step = r < 0.3 ? -TICK : r > 0.7 ? TICK : 0
          n[k] = Math.max(-0.1, Math.min(0.1, roundTick(n[k] + step)))
        }
        return n
      })
    }, 1300)
    return () => clearInterval(t)
  }, [])

  const marks = useMemo(() => {
    const out = {}
    for (const sku of Object.keys(SKUS)) MONTHS.forEach((m, i) => (out[sym(sku, m)] = curvePx(sku, i, drift[sku])))
    return out
  }, [drift])

  // Simulated market prints: a public tape and a WebSocket-style feed.
  useEffect(() => {
    if (!tick) return
    const ins = Math.random() < 0.5 ? INSTRUMENTS.find((x) => x.sym === focus) : INSTRUMENTS[(tick * 7) % INSTRUMENTS.length]
    const side = Math.random() < 0.5 ? 'buy' : 'sell'
    const px = roundTick(marks[ins.sym] + (side === 'buy' ? TICK : -TICK))
    const qty = 8 * (1 + Math.floor(Math.random() * 6))
    const t = new Date().toISOString().slice(11, 19)
    setTape((x) => [{ t, sym: ins.sym, px, qty, side }, ...x].slice(0, 40))
    const kinds = [
      `{"ch":"trades.${ins.sym}","px":${fmt(px)},"qty":${qty},"side":"${side}","seq":${88200 + tick}}`,
      `{"ch":"book.${ins.sym}","bid":${fmt(marks[ins.sym] - TICK)},"ask":${fmt(marks[ins.sym] + TICK)},"seq":${88200 + tick}}`,
      `{"ch":"index.${ins.sku}","px":${SKUS[ins.sku].index.toFixed(2)},"asof":"2026-11-11"}`,
    ]
    setFeed((f) => [{ t, ch: kinds[tick % 3] }, ...f].slice(0, 18))
  }, [tick])

  const acct = session && accts[session]
  const setAcct = (fn) => setAccts((a) => ({ ...a, [session]: fn(a[session]) }))

  const placeOrder = (o) => {
    const mid = marks[o.sym], bestAsk = roundTick(mid + TICK), bestBid = roundTick(mid - TICK)
    const marketable = o.type === 'Market' || (o.type === 'Limit' && (o.side === 'Buy' ? o.px >= bestAsk - 1e-9 : o.px <= bestBid + 1e-9))
    const ts = now()
    if (marketable) {
      const fill = o.venue === 'Block' ? o.px : o.side === 'Buy' ? bestAsk : bestBid
      setAcct((a) => {
        const r = applyFill(a.positions, o.sym, o.side === 'Buy' ? o.qty : -o.qty, fill)
        const closed = r.closedQty ? [{ sym: o.sym, qty: r.closedQty, entry: r.entry, exit: fill, how: 'Closed on CLOB', date: ts.slice(0, 10) }, ...a.closed] : a.closed
        return { ...a, positions: r.next, closed, fills: [{ id: nextId('F'), ts, sym: o.sym, side: o.side, qty: o.qty, px: fill, venue: o.venue || 'CLOB', status: 'Cleared' }, ...a.fills] }
      })
      return { ok: true, msg: `Filled: ${o.side.toLowerCase()} ${o.qty} ${o.sym} @ $${fmt(fill)}. Sent to the DCO via your FCM.` }
    }
    if (o.tif === 'IOC') return { ok: false, msg: 'IOC order was not marketable, so it was cancelled.' }
    setAcct((a) => ({ ...a, orders: [{ id: nextId('O'), ts, ...o, status: 'Working' }, ...a.orders] }))
    return { ok: false, msg: `${o.type} order working: ${o.side.toLowerCase()} ${o.qty} ${o.sym} @ $${fmt(o.px)}` }
  }
  const cancelOrder = (id) => setAcct((a) => ({ ...a, orders: a.orders.filter((x) => x.id !== id) }))

  // Working limit orders fill when the market moves through them; stops trigger into market orders.
  useEffect(() => {
    if (!session) return
    const a = accts[session]
    const hit = a.orders.find((o) => (o.type === 'Limit' && (o.side === 'Buy' ? roundTick(marks[o.sym] + TICK) <= o.px : roundTick(marks[o.sym] - TICK) >= o.px)) || (o.type === 'Stop' && (o.side === 'Buy' ? marks[o.sym] >= o.px : marks[o.sym] <= o.px)))
    if (!hit) return
    const fill = hit.type === 'Stop' ? roundTick(marks[hit.sym] + (hit.side === 'Buy' ? TICK : -TICK)) : hit.px
    setAcct((x) => {
      const r = applyFill(x.positions, hit.sym, hit.side === 'Buy' ? hit.qty : -hit.qty, fill)
      const closed = r.closedQty ? [{ sym: hit.sym, qty: r.closedQty, entry: r.entry, exit: fill, how: 'Closed on CLOB', date: now().slice(0, 10) }, ...x.closed] : x.closed
      return { ...x, positions: r.next, closed, orders: x.orders.filter((o) => o.id !== hit.id), fills: [{ id: nextId('F'), ts: now(), sym: hit.sym, side: hit.side, qty: hit.qty, px: fill, venue: 'CLOB', status: 'Cleared' }, ...x.fills] }
    })
  }, [marks])

  const createRequest = (req) => {
    const id = nextId(req.kind === 'EFP' ? 'EFP' : 'RFQ')
    setRequests((rs) => [{ ...req, id, buyer: ACCOUNTS[session].name, owner: session, status: 'open', quotes: [], closes: '30m' }, ...rs])
    PROVIDERS.forEach((p) => setTimeout(() => setRequests((rs) => rs.map((x) => (x.id === id && x.status === 'open' ? { ...x, quotes: [...x.quotes, scoreQuote(p, x)] } : x))), p.delay))
    return id
  }

  const providerQuote = (reqId, basis) => {
    const me = ACCOUNTS[session]
    setRequests((rs) => rs.map((x) => (x.id === reqId ? { ...x, myQuote: basis, quotes: [...x.quotes.filter((q) => q.mine !== session), scoreQuote({ id: 'ME-' + session, name: me.name, mine: session, region: x.region === 'Any US' ? 'US-East' : x.region, ic: x.ic, tier: 'Tier 1', basis, uptime: 99.5 }, x)] } : x)))
  }

  // Award a quote. For an EFP both futures legs book at the same time as the physical contract.
  const award = (reqId, quoteId) => {
    const r = requests.find((x) => x.id === reqId)
    const q = r.quotes.find((x) => x.id === quoteId)
    const i0 = MONTHS.indexOf(r.start)
    const strip = MONTHS.slice(i0, i0 + r.term).map((m) => sym(r.sku, m))
    const fAvg = r.kind === 'EFP' ? strip.reduce((a, s) => a + marks[s], 0) / strip.length : SKUS[r.sku].index
    const price = fAvg + q.norm
    const id = nextId('PC')
    let efp = null
    if (r.kind === 'EFP') {
      const owner = r.owner || 'northwind'
      const ts = now()
      const held = accts[owner].positions
      efp = {
        fAvg, n: r.gpus * r.term,
        gainPerHr: strip.reduce((a, s) => a + (marks[s] - (held[s]?.avg ?? marks[s])), 0) / strip.length,
        realised: strip.reduce((a, s) => a + (marks[s] - (held[s]?.avg ?? marks[s])) * r.gpus * SIZE, 0),
        imReleased: strip.reduce((a, s) => a + r.gpus * SIZE * marks[s] * IM_RATE, 0),
      }
      const legs = (key, sign) => setAccts((all) => {
        const a = all[key]
        let pos = a.positions, fills = a.fills, closed = a.closed
        for (const s of strip) {
          const res = applyFill(pos, s, -sign * r.gpus, marks[s])
          pos = res.next
          fills = [{ id: nextId('F'), ts, sym: s, side: sign > 0 ? 'Sell' : 'Buy', qty: r.gpus, px: marks[s], venue: 'EFP', status: 'Cleared' }, ...fills]
          if (res.closedQty) closed = [{ sym: s, qty: res.closedQty, entry: res.entry, exit: marks[s], how: `EFP into ${id}`, date: ts.slice(0, 10) }, ...closed]
        }
        return { ...all, [key]: { ...a, positions: pos, fills, closed } }
      })
      legs(owner, 1)
      if (q.mine) legs(q.mine, -1)
    }
    setRequests((rs) => rs.map((x) => (x.id === reqId ? { ...x, status: 'awarded', awardedTo: q.name, awardedId: q.id, contractId: id, price, efp } : x)))
    setContracts((cs) => [{ id, sku: r.sku, gpus: r.gpus, months: r.term, start: r.start, price, buyer: r.buyer, provider: q.name, via: r.kind, stage: 0, failed: false, month: 0, uptime: 0, log: [r.kind === 'EFP' ? `EFP booked: ${r.gpus * r.term} contracts at strip avg $${fmt(fAvg)}; physical at +$${fmt(q.norm, 3)} basis` : `Contract signed with ${q.name} via blind RFQ`] }, ...cs])
    return id
  }

  const updateContract = (id, fn) => setContracts((cs) => cs.map((c) => (c.id === id ? fn(c) : c)))

  if (!session) return <Login onDone={(k) => { setSession(k); setTab('home') }} />

  const me = ACCOUNTS[session]
  const ctx = { session, me, acct, marks, tick, tape, feed, contracts, requests, placeOrder, cancelOrder, createRequest, providerQuote, award, updateContract, setTab, prefill, setPrefill, focus, setFocus }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="row" style={{ gap: 22 }}>
          <div className="brand"><Logo /><span>Compute Desk Exchange</span></div>
          <nav className="nav">
            {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </nav>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <div className="mini-tk">
            {Object.entries(SKUS).map(([k, s]) => (
              <span key={k}><i>{k}</i> <b>{s.index.toFixed(2)}</b> <em className={s.chg >= 0 ? 'up' : 'dn'}>{s.chg >= 0 ? '+' : ''}{s.chg}%</em></span>
            ))}
          </div>
          <span className="tag">Example data</span>
          <div className="acct">
            <button className="acct-btn" onClick={() => setMenu(!menu)}><span className="avatar">{me.initials}</span><span className="acct-name">{me.name}<small>{me.type}</small></span></button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                <div className="note" style={{ padding: '6px 10px' }}>Signed in as {me.email}</div>
                {Object.entries(ACCOUNTS).map(([k, a]) => (
                  <button key={k} className={k === session ? 'on' : ''} onClick={() => { setSession(k); setMenu(false) }}>{a.name} <small>{a.type}</small></button>
                ))}
                <hr />
                <button onClick={() => { setSession(null); setMenu(false) }}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main key={session} className={tab === 'trade' ? 'wrap wide' : 'wrap'}>
        {tab === 'home' && <Home {...ctx} />}
        {tab === 'trade' && <Trade {...ctx} />}
        {tab === 'request' && <Request {...ctx} />}
        {tab === 'integrate' && <Integrate {...ctx} />}
      </main>
    </div>
  )
}
