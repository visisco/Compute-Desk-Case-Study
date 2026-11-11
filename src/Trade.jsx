import React, { useEffect, useMemo, useState } from 'react'
import { SKUS, MONTHS, SIZE, TICK, IM_RATE, FEE, INSTRUMENTS, fmt, usd, sym, skuOf, roundTick, contractName } from './data.js'

// 'DEC26' -> 'Dec 2026'
const monthName = (m) => `${m[0]}${m.slice(1, 3).toLowerCase()} 20${m.slice(3)}`
import { candles, stats24, book, TF, simulate, top } from './market.js'
import { Seg, saveCsv } from './ui.jsx'

const WIDGETS = [['markets', 'Markets'], ['chart', 'Price chart'], ['depth', 'Depth chart'], ['book', 'Order book'], ['ticket', 'Order ticket'], ['bottom', 'Positions & blotter']]
const PRESETS = {
  pro: { label: 'Pro', w: { markets: true, chart: true, depth: true, book: true, ticket: true, bottom: true } },
  chart: { label: 'Chart focus', w: { markets: false, chart: true, depth: false, book: true, ticket: true, bottom: true } },
  mm: { label: 'Market maker', w: { markets: true, chart: false, depth: true, book: true, ticket: true, bottom: true } },
}

function loadLayout() {
  try { return JSON.parse(localStorage.getItem('cdx-layout')) || PRESETS.pro.w } catch { return PRESETS.pro.w }
}
function saveLayout(w) {
  try { localStorage.setItem('cdx-layout', JSON.stringify(w)) } catch { /* storage unavailable */ }
}

/* ---------- Markets table ---------- */
const SORTS = [['curve', 'Curve'], ['vol', 'Volume'], ['spread', 'Tightest'], ['depth', 'Deepest']]
function Markets({ marks, tick, focus, setFocus, positions, flash, onHit }) {
  const [sku, setSku] = useState('All')
  const [q, setQ] = useState('')
  const [exp, setExp] = useState('All')
  const [sort, setSort] = useState('curve')
  const [held, setHeld] = useState(false)
  const [fav, setFav] = useState([sym('H100', 'JUN27'), sym('B200', 'MAR27')])
  const [favOnly, setFavOnly] = useState(false)
  const rows = INSTRUMENTS.filter((i) => (sku === 'All' || i.sku === sku) && (exp === 'All' || i.i < 3) && (!q || [i.sym, i.m, i.sku, `${i.sku} ${monthName(i.m)}`].some((t) => t.toLowerCase().includes(q.toLowerCase()))) && (!held || positions[i.sym]) && (!favOnly || fav.includes(i.sym)))
    .map((i) => ({ ...i, st: stats24(i.sym, marks[i.sym]), t: top(i.sym, marks[i.sym], tick) }))
  if (sort === 'vol') rows.sort((x, y) => y.st.vol - x.st.vol)
  if (sort === 'spread') rows.sort((x, y) => x.t.spread - y.t.spread || y.t.depth - x.t.depth)
  if (sort === 'depth') rows.sort((x, y) => y.t.depth - x.t.depth)
  return (
    <div className="w w-markets">
      <div className="w-head"><span>Markets</span><span className="note">{rows.length} contracts</span></div>
      <div className="w-tools">
        <input placeholder="Search H100, Jun 2027, H1UF…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Seg small value={sku} options={['All', ...Object.keys(SKUS)]} onChange={setSku} />
        <div className="row" style={{ gap: 6 }}>
          <Seg small value={exp} options={[['All', 'All months'], ['Front', 'Front 3']]} onChange={setExp} />
          <button className={'chip-btn' + (held ? ' on' : '')} onClick={() => setHeld(!held)}>Held</button>
          <button className={'chip-btn' + (favOnly ? ' on' : '')} onClick={() => setFavOnly(!favOnly)}>★</button>
        </div>
        <div className="sortby"><span>Sort</span><select className="mini" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div className="w-body scroll">
        <table className="dense">
          <thead><tr><th></th><th>Contract</th><th className="n">Bid</th><th className="n">Ask</th><th className="n" title="Spread in ticks ($0.01)">Spr</th><th className="n" title="Contracts on the top 5 levels, both sides">Depth</th></tr></thead>
          <tbody>
            {rows.map((i) => {
              const ticks = Math.round(i.t.spread / TICK)
              return (
                <tr key={i.sym} className={'click ' + (i.sym === focus ? 'sel ' : '') + (flash.includes(i.sym) ? 'flash' : '')} onClick={() => setFocus(i.sym)}>
                  <td><button className={'star' + (fav.includes(i.sym) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); setFav(fav.includes(i.sym) ? fav.filter((x) => x !== i.sym) : [...fav, i.sym]) }} aria-label="Watchlist">★</button></td>
                  <td><b className="mono">{i.sym}</b>{positions[i.sym] && <span className="dot" title="Held" />}<div className="note" title={`24h ${i.st.chg >= 0 ? '+' : ''}${i.st.chg.toFixed(2)}%`}>{i.sku} · {monthName(i.m)}</div></td>
                  <td className="n up hit" title={`Sell at ${fmt(i.t.bid.px)}`} onClick={(e) => { e.stopPropagation(); onHit(i.sym, 'Sell', i.t.bid.px) }}>{fmt(i.t.bid.px)}</td>
                  <td className="n dn hit" title={`Buy at ${fmt(i.t.ask.px)}`} onClick={(e) => { e.stopPropagation(); onHit(i.sym, 'Buy', i.t.ask.px) }}>{fmt(i.t.ask.px)}</td>
                  <td className={'n ' + (ticks > 4 ? 'warn-t' : '')}>{ticks}</td>
                  <td className="n"><span className="liq"><i style={{ width: Math.min(100, i.t.depth / 6) + '%' }} /></span>{i.t.depth}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------- Price chart ---------- */
function Chart({ focus, marks, positions }) {
  const [tf, setTf] = useState('1D')
  const [view, setView] = useState('Price')
  const [style, setStyle] = useState('Candles')
  const [showIdx, setShowIdx] = useState(true)
  const [showVol, setShowVol] = useState(true)
  const sku = skuOf(focus)
  const cs = useMemo(() => candles(focus, marks[focus], tf), [focus, tf, Math.round(marks[focus] * 100)])
  const idx = SKUS[sku].index
  const W = 520, H = 320, VH = showVol ? 44 : 0, padR = 48
  const pos = positions[focus]

  if (view === 'Curve') {
    const pts = MONTHS.map((m) => marks[sym(sku, m)])
    const lo = Math.min(...pts, idx) - 0.04, hi = Math.max(...pts, idx) + 0.04
    const X = (i) => 30 + (i * (W - padR - 40)) / 11
    const Y = (v) => 20 + (1 - (v - lo) / (hi - lo)) * (H - 50)
    return (
      <div className="w w-chart">
        <ChartHead {...{ view, setView, tf, setTf, style, setStyle, showIdx, setShowIdx, showVol, setShowVol, focus }} />
        <div className="w-body">
          <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${sku} forward curve`}>
            {[0, 1, 2, 3].map((g) => { const v = lo + ((hi - lo) * g) / 3; return <g key={g}><line x1="30" x2={W - padR} y1={Y(v)} y2={Y(v)} stroke="#2d2c2a" /><text x={W - padR + 6} y={Y(v) + 4} className="axis">{fmt(v)}</text></g> })}
            <line x1="30" x2={W - padR} y1={Y(idx)} y2={Y(idx)} stroke="#8fa9d6" strokeDasharray="5 5" />
            <text x="34" y={Y(idx) - 6} fill="#8fa9d6" className="axis">Compute Signal index {fmt(idx)}</text>
            <polyline fill="none" stroke="#e8e2b9" strokeWidth="2" points={pts.map((p, i) => `${X(i)},${Y(p)}`).join(' ')} />
            {pts.map((p, i) => <g key={i}><circle cx={X(i)} cy={Y(p)} r={sym(sku, MONTHS[i]) === focus ? 6 : 3.5} fill={sym(sku, MONTHS[i]) === focus ? '#e8e2b9' : '#1b1a19'} stroke="#e8e2b9" /><text x={X(i)} y={H - 8} textAnchor="middle" className="axis">{MONTHS[i].slice(0, 3)}</text></g>)}
          </svg>
        </div>
      </div>
    )
  }

  // Scale to the candles; reference lines far outside the range are pinned to the edge with a label.
  const cLo = Math.min(...cs.map((c) => c.l)), cHi = Math.max(...cs.map((c) => c.h)), pad = Math.max((cHi - cLo) * 0.08, 0.01)
  const near = (v) => v >= cLo - (cHi - cLo) * 0.6 && v <= cHi + (cHi - cLo) * 0.6
  const lo = Math.min(cLo, showIdx && near(idx) ? idx : Infinity, pos && near(pos.avg) ? pos.avg : Infinity) - pad
  const hi = Math.max(cHi, showIdx && near(idx) ? idx : -Infinity, pos && near(pos.avg) ? pos.avg : -Infinity) + pad
  const clampY = (v) => Math.max(10, Math.min(H - VH - 20, Y(v)))
  const cw = (W - padR - 10) / cs.length
  const Y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (H - VH - 30)
  const vmax = Math.max(...cs.map((c) => c.v))
  const last = cs[cs.length - 1]
  return (
    <div className="w w-chart">
      <ChartHead {...{ view, setView, tf, setTf, style, setStyle, showIdx, setShowIdx, showVol, setShowVol, focus }} />
      <div className="w-body">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${focus} price chart`}>
          {[0, 1, 2, 3, 4].map((g) => { const v = lo + ((hi - lo) * g) / 4; return <g key={g}><line x1="0" x2={W - padR} y1={Y(v)} y2={Y(v)} stroke="#262523" /><text x={W - padR + 6} y={Y(v) + 4} className="axis">{fmt(v)}</text></g> })}
          {showVol && cs.map((c, i) => <rect key={'v' + i} x={10 + i * cw + cw * 0.15} width={cw * 0.7} y={H - 20 - (c.v / vmax) * VH} height={(c.v / vmax) * VH} fill={c.c >= c.o ? '#7cc59a' : '#e2806f'} opacity="0.25" />)}
          {style === 'Candles' ? cs.map((c, i) => {
            const x = 10 + i * cw + cw / 2, up = c.c >= c.o, col = up ? '#7cc59a' : '#e2806f'
            return <g key={i}><line x1={x} x2={x} y1={Y(c.h)} y2={Y(c.l)} stroke={col} /><rect x={x - cw * 0.32} width={cw * 0.64} y={Y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(Y(c.o) - Y(c.c)))} fill={col} /></g>
          }) : <polyline fill="none" stroke="#e8e2b9" strokeWidth="1.8" points={cs.map((c, i) => `${10 + i * cw + cw / 2},${Y(c.c)}`).join(' ')} />}
          {showIdx && <><line x1="0" x2={W - padR} y1={clampY(idx)} y2={clampY(idx)} stroke="#8fa9d6" strokeDasharray="5 5" opacity={near(idx) ? 1 : 0.5} /><text x="8" y={clampY(idx) + (idx > cHi ? 14 : -6)} fill="#8fa9d6" className="axis">Index {fmt(idx)}{near(idx) ? '' : idx > cHi ? ' ↑' : ' ↓'}</text></>}
          {pos && <><line x1="0" x2={W - padR} y1={clampY(pos.avg)} y2={clampY(pos.avg)} stroke="#d9b26a" strokeDasharray="2 4" opacity={near(pos.avg) ? 1 : 0.5} /><text x={W - padR - 8} textAnchor="end" y={clampY(pos.avg) + (pos.avg > cHi ? 14 : -6)} fill="#d9b26a" className="axis">Your avg {fmt(pos.avg)} ({pos.qty > 0 ? '+' : ''}{pos.qty}){near(pos.avg) ? '' : pos.avg > cHi ? ' ↑' : ' ↓'}</text></>}
          <rect x={W - padR} y={Y(last.c) - 10} width={padR} height="20" fill="#e8e2b9" rx="3" />
          <text x={W - padR + 6} y={Y(last.c) + 4} fill="#141413" className="axis" fontWeight="600">{fmt(last.c)}</text>
        </svg>
      </div>
    </div>
  )
}

function ChartHead({ view, setView, tf, setTf, style, setStyle, showIdx, setShowIdx, showVol, setShowVol, focus }) {
  return (
    <div className="w-head">
      <div className="row" style={{ gap: 8 }}>
        <Seg small value={view} options={['Price', 'Curve']} onChange={setView} />
        {view === 'Price' && <Seg small value={tf} options={Object.keys(TF)} onChange={setTf} />}
        {view === 'Price' && <Seg small value={style} options={['Candles', 'Line']} onChange={setStyle} />}
      </div>
      {view === 'Price' && (
        <div className="row" style={{ gap: 6 }}>
          <button className={'chip-btn' + (showIdx ? ' on' : '')} onClick={() => setShowIdx(!showIdx)}>Index</button>
          <button className={'chip-btn' + (showVol ? ' on' : '')} onClick={() => setShowVol(!showVol)}>Volume</button>
          <span className="note">{TF[tf].label}</span>
        </div>
      )}
    </div>
  )
}

/* ---------- Depth chart ---------- */
function Depth({ focus, marks, tick }) {
  const { bids, asks } = book(focus, marks[focus], tick, 20)
  let cb = 0, ca = 0
  const B = bids.map((b) => ({ px: b.px, c: (cb += b.q) }))
  const A = asks.map((a) => ({ px: a.px, c: (ca += a.q) }))
  const lo = B[B.length - 1].px, hi = A[A.length - 1].px, max = Math.max(cb, ca)
  const W = 440, H = 170
  const X = (p) => 10 + ((p - lo) / (hi - lo)) * (W - 20)
  const Y = (c) => H - 22 - (c / max) * (H - 40)
  const step = (arr) => arr.map((p, i) => `${X(p.px)},${Y(p.c)}`).join(' ')
  return (
    <div className="w w-depth">
      <div className="w-head"><span>Depth · {focus}</span><span className="note">Bids {cb.toLocaleString()} · Offers {ca.toLocaleString()} contracts</span></div>
      <div className="w-body">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Depth chart">
          <polygon points={`${X(B[0].px)},${H - 22} ${step(B)} ${X(lo)},${H - 22}`} fill="#7cc59a" opacity="0.18" stroke="#7cc59a" />
          <polygon points={`${X(A[0].px)},${H - 22} ${step(A)} ${X(hi)},${H - 22}`} fill="#e2806f" opacity="0.18" stroke="#e2806f" />
          <line x1={X(marks[focus])} x2={X(marks[focus])} y1="10" y2={H - 22} stroke="#e8e2b9" strokeDasharray="3 3" />
          <text x={X(marks[focus])} y="14" textAnchor="middle" className="axis" fill="#e8e2b9">mid {fmt(marks[focus])}</text>
          <text x="10" y={H - 6} className="axis">{fmt(lo)}</text>
          <text x={W - 10} y={H - 6} textAnchor="end" className="axis">{fmt(hi)}</text>
        </svg>
      </div>
    </div>
  )
}

/* ---------- Order book + trades ---------- */
function Book({ focus, marks, tick, tape, onPx, orders }) {
  const [tab, setTab] = useState('Book')
  const { bids, asks } = book(focus, marks[focus], tick, 11)
  const max = Math.max(...bids.map((b) => b.q), ...asks.map((a) => a.q))
  const trades = tape.filter((t) => t.sym === focus).slice(0, 18)
  const mine = (orders || []).filter((o) => o.sym === focus && o.type === 'Limit')
  const tag = (px) => { const n = mine.filter((o) => Math.abs(o.px - px) < 1e-9).reduce((a, o) => a + o.qty, 0); return n ? <span className="mine">yours {n}</span> : null }
  return (
    <div className="w w-book">
      <div className="w-head"><Seg small value={tab} options={['Book', 'Trades']} onChange={setTab} /><span className="note">spread {fmt(asks[0].px - bids[0].px)} · {Math.round((asks[0].px - bids[0].px) / TICK)} ticks</span></div>
      <div className="w-body">
        {tab === 'Book' ? (
          <table className="dense book">
            <thead><tr><th>Price</th><th className="n">Size</th><th className="n">GPU-hrs</th></tr></thead>
            <tbody>
              {[...asks].reverse().map((a) => <tr key={'a' + a.px} className="ask click" title={`Buy at ${fmt(a.px)}`} onClick={() => onPx(a.px, 'Buy')}><td className="depthbar"><i style={{ width: `${(a.q / max) * 100}%` }} />{fmt(a.px)}</td><td className="n">{tag(a.px)}{a.q}</td><td className="n">{(a.q * SIZE).toLocaleString()}</td></tr>)}
              <tr className="mid"><td colSpan={3}>{fmt(marks[focus])} <span className="note">mid · index {fmt(SKUS[skuOf(focus)].index)}</span>{mine.filter((o) => o.px < asks[0].px - 1e-9 && o.px > bids[0].px + 1e-9).map((o) => <span key={o.id} className="mine">yours {o.side.toLowerCase()} {o.qty} @ {fmt(o.px)}</span>)}</td></tr>
              {bids.map((b) => <tr key={'b' + b.px} className="bid click" title={`Sell at ${fmt(b.px)}`} onClick={() => onPx(b.px, 'Sell')}><td className="depthbar"><i style={{ width: `${(b.q / max) * 100}%` }} />{fmt(b.px)}</td><td className="n">{tag(b.px)}{b.q}</td><td className="n">{(b.q * SIZE).toLocaleString()}</td></tr>)}
            </tbody>
          </table>
        ) : (
          <table className="dense">
            <thead><tr><th>Time</th><th className="n">Price</th><th className="n">Size</th></tr></thead>
            <tbody>{trades.length ? trades.map((t, i) => <tr key={t.t + i}><td className="mono note">{t.t}</td><td className={'n ' + (t.side === 'buy' ? 'up' : 'dn')}>{fmt(t.px)}</td><td className="n">{t.qty}</td></tr>) : <tr><td colSpan={3} className="note">Waiting for prints…</td></tr>}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ---------- Bottom: positions, orders, closed, blotter ---------- */
function Bottom({ me, acct, marks, cancelOrder, setFocus, setTab, setPrefill, btab: tab, setBTab, flash, onClose }) {
  const [sku, setSku] = useState('All')
  const [venue, setVenue] = useState('All')
  const [side, setSide] = useState('All')
  const okSku = (s) => sku === 'All' || skuOf(s) === sku
  const pos = Object.entries(acct.positions).filter(([k]) => okSku(k))
  const fills = acct.fills.filter((f) => okSku(f.sym) && (venue === 'All' || f.venue === venue) && (side === 'All' || f.side === side))
  const closed = acct.closed.filter((c) => okSku(c.sym))
  const orders = acct.orders.filter((o) => okSku(o.sym))
  const canConvert = me.kind === 'end_user' || me.kind === 'provider'
  const tabs = [['Positions', pos.length], ['Open orders', orders.length], ['Closed & settled', closed.length], ['Trade blotter', fills.length]]
  const exportCsv = () => saveCsv('cdx-blotter.csv', [['time', 'fill_id', 'order_id', 'contract', 'side', 'qty', 'price', 'venue', 'status'], ...fills.map((f) => [f.ts, f.id, f.order || '', f.sym, f.side, f.qty, f.px, f.venue, f.status])])
  return (
    <div className="w w-bottom">
      <div className="w-head">
        <div className="btabs">{tabs.map(([t, n]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setBTab(t)}>{t} <span className="note">{n}</span></button>)}</div>
        <div className="row" style={{ gap: 8 }}>
          <Seg small value={sku} options={['All', ...Object.keys(SKUS)]} onChange={setSku} />
          {tab === 'Trade blotter' && <><Seg small value={side} options={['All', 'Buy', 'Sell']} onChange={setSide} /><select className="mini" value={venue} onChange={(e) => setVenue(e.target.value)}>{['All', 'CLOB', 'Block', 'EFP', 'Final settlement'].map((v) => <option key={v}>{v}</option>)}</select><button className="chip-btn" onClick={exportCsv}>Export CSV</button></>}
        </div>
      </div>
      <div className="w-body scroll">
        {tab === 'Positions' && (
          <table className="dense">
            <thead><tr><th>Contract</th><th className="n">Qty</th><th className="n">GPU-hrs</th><th className="n">Avg</th><th className="n">Mark</th><th className="n">Unrealised P&L</th><th className="n">Init. margin</th><th></th></tr></thead>
            <tbody>
              {pos.length ? pos.map(([k, p]) => {
                const pnl = p.qty * SIZE * (marks[k] - p.avg)
                return (
                  <tr key={k} className={flash.includes(k) ? 'flash' : ''}>
                    <td className="click" onClick={() => setFocus(k)}><b className="mono">{k}</b></td>
                    <td className={'n ' + (p.qty > 0 ? 'up' : 'dn')}>{p.qty > 0 ? '+' : ''}{p.qty}</td>
                    <td className="n">{(p.qty * SIZE).toLocaleString()}</td>
                    <td className="n">{fmt(p.avg)}</td><td className="n">{fmt(marks[k])}</td>
                    <td className={'n ' + (pnl >= 0 ? 'up' : 'dn')}>{usd(pnl)}</td>
                    <td className="n">{usd(Math.abs(p.qty) * SIZE * marks[k] * IM_RATE)}</td>
                    <td className="actions">
                      <button className="chip-btn" title="Load the closing order into the ticket for review" onClick={() => onClose(k, p.qty > 0 ? 'Sell' : 'Buy', Math.abs(p.qty))}>Close</button>
                      {canConvert && <button className="chip-btn accent" onClick={() => { setPrefill({ kind: 'EFP', sku: skuOf(k), start: INSTRUMENTS.find((i) => i.sym === k).m, at: Date.now() }); setTab('convert') }}>Convert to Physical</button>}
                    </td>
                  </tr>
                )
              }) : <tr><td colSpan={8} className="note">No open positions.</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'Open orders' && (
          <table className="dense">
            <thead><tr><th>Time</th><th>Order</th><th>Contract</th><th>Side</th><th>Type</th><th className="n">Working</th><th className="n">Filled</th><th className="n">Price</th><th>TIF</th><th>Status</th><th></th></tr></thead>
            <tbody>{orders.length ? orders.map((o) => <tr key={o.id} className={flash.includes(o.sym) ? 'flash' : ''}><td className="mono note">{o.ts}</td><td className="mono note">{o.id}</td><td className="mono">{o.sym}</td><td className={o.side === 'Buy' ? 'up' : 'dn'}>{o.side}</td><td>{o.type}</td><td className="n">{o.qty}</td><td className="n">{o.done || 0}/{o.orig || o.qty}</td><td className="n">{fmt(o.px)}</td><td>{o.tif}</td><td><span className={'pill ' + (o.done ? 'warn' : 'muted')}>{o.status || 'Working'}</span></td><td className="actions"><button className="chip-btn" onClick={() => cancelOrder(o.id)}>Cancel</button></td></tr>) : <tr><td colSpan={11} className="note">No working orders. Place a limit away from the market to see one here.</td></tr>}</tbody>
          </table>
        )}
        {tab === 'Closed & settled' && (
          <table className="dense">
            <thead><tr><th>Date</th><th>Contract</th><th className="n">Qty</th><th className="n">Entry</th><th className="n">Exit / settle</th><th className="n">Realised P&L</th><th>How</th></tr></thead>
            <tbody>{closed.length ? closed.map((c, i) => { const r = c.qty * SIZE * (c.exit - c.entry); return <tr key={i}><td className="mono note">{c.date}</td><td className="mono">{c.sym}</td><td className="n">{c.qty > 0 ? '+' : ''}{c.qty}</td><td className="n">{fmt(c.entry)}</td><td className="n">{fmt(c.exit)}</td><td className={'n ' + (r >= 0 ? 'up' : 'dn')}>{usd(r)}</td><td className="note">{c.how}</td></tr> }) : <tr><td colSpan={7} className="note">Nothing closed yet.</td></tr>}</tbody>
          </table>
        )}
        {tab === 'Trade blotter' && (
          <table className="dense">
            <thead><tr><th>Time</th><th>Fill ID</th><th>Order</th><th>Contract</th><th>Side</th><th className="n">Qty</th><th className="n">Price</th><th>Venue</th><th>Clearing</th></tr></thead>
            <tbody>{fills.map((f) => <tr key={f.id} className={flash.includes(f.sym) && f.ts === fills[0].ts ? 'flash' : ''}><td className="mono note">{f.ts}</td><td className="mono note">{f.id}</td><td className="mono note">{f.order || '—'}</td><td className="mono">{f.sym}</td><td className={f.side === 'Buy' ? 'up' : 'dn'}>{f.side}</td><td className="n">{f.qty}</td><td className="n">{fmt(f.px)}</td><td>{f.venue}</td><td><span className="pill good">{f.status}</span></td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ---------- Page ---------- */
export default function Trade(props) {
  const { focus, setFocus, marks, tick, tape, acct, placeOrder } = props
  const [w, setW] = useState(loadLayout)
  const [open, setOpen] = useState(false)
  const [px, setPx] = useState('')
  // An order loaded from a click elsewhere on the screen (bid/ask, book level, Close). The ticket picks it up.
  const [load, setLoad] = useState(null)
  const loadOrder = (s, side, price, extra = {}) => { setFocus(s); setPx(price == null ? '' : fmt(price)); setLoad({ side, at: Date.now(), ...extra }) }
  const [btab, setBTab] = useState('Positions')
  const [flash, setFlash] = useState([])
  useEffect(() => { if (!flash.length) return; const t = setTimeout(() => setFlash([]), 1800); return () => clearTimeout(t) }, [flash])
  const onExec = (syms) => { setFlash(syms); setBTab((t) => (t === 'Closed & settled' ? 'Positions' : t)) }
  const set = (nw) => { setW(nw); saveLayout(nw) }
  const ins = INSTRUMENTS.find((i) => i.sym === focus)
  const st = stats24(focus, marks[focus])
  const tb = top(focus, marks[focus], tick)
  const idx = SKUS[ins.sku].index
  const preset = Object.entries(PRESETS).find(([, p]) => WIDGETS.every(([k]) => p.w[k] === w[k]))?.[0] || 'custom'
  const pickFocus = (s) => { setFocus(s); setPx('') }
  const center = w.chart || w.depth
  const right = w.book || w.ticket
  const cols = [w.markets && '340px', center && 'minmax(0,1fr)', w.book && (center ? '290px' : 'minmax(0,1fr)'), w.ticket && '300px'].filter(Boolean).join(' ')

  return (
    <div className="trade">
      <div className="inst-bar">
        <div className="row" style={{ gap: 14 }}>
          <select className="inst-select" value={focus} onChange={(e) => pickFocus(e.target.value)}>
            {INSTRUMENTS.map((i) => <option key={i.sym} value={i.sym}>{i.sym}</option>)}
          </select>
          <span className="note">{contractName(ins.sku, ins.m)}</span>
        </div>
        <div className="inst-stats">
          <div><span>Bid</span><b className="up">{fmt(tb.bid.px)} <small>×{tb.bid.q}</small></b></div>
          <div><span>Ask</span><b className="dn">{fmt(tb.ask.px)} <small>×{tb.ask.q}</small></b></div>
          <div><span>Spread</span><b>{Math.round(tb.spread / TICK)} ticks</b></div>
          <div><span>Depth (5 lvls)</span><b>{tb.depth.toLocaleString()}</b></div>
          <div><span>Mark</span><b className="cream">{fmt(marks[focus])}</b></div>
          <div><span>24h</span><b className={st.chg >= 0 ? 'up' : 'dn'}>{st.chg >= 0 ? '+' : ''}{st.chg.toFixed(2)}%</b></div>
          <div><span>Index</span><b>{fmt(idx)}</b></div>
          <div title="Futures price minus today's Compute Signal index"><span>vs index</span><b className={marks[focus] >= idx ? 'up' : 'dn'}>{marks[focus] >= idx ? '+' : ''}{fmt(marks[focus] - idx)}</b></div>
          <div><span>24h vol</span><b>{st.vol.toLocaleString()}</b></div>
          <div title={`Cash-settles to the average of the daily Compute Signal ${ins.sku} index over ${monthName(ins.m)}`}><span>Settles to</span><b>Index avg, {monthName(ins.m)}</b></div>
        </div>
        <div className="row" style={{ gap: 8, position: 'relative' }}>
          <Seg small value={preset} options={Object.entries(PRESETS).map(([k, p]) => [k, p.label])} onChange={(k) => set(PRESETS[k].w)} />
          <button className="chip-btn" onClick={() => setOpen(!open)}>Widgets ▾</button>
          {open && (
            <div className="menu right" onMouseLeave={() => setOpen(false)}>
              {WIDGETS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={!!w[k]} onChange={() => set({ ...w, [k]: !w[k] })} />{l}</label>)}
              <hr /><button onClick={() => set(PRESETS.pro.w)}>Reset layout</button>
            </div>
          )}
        </div>
      </div>

      {(w.markets || center || right) && (
        <div className="tgrid" style={{ gridTemplateColumns: cols }}>
          {w.markets && <Markets marks={marks} tick={tick} focus={focus} setFocus={pickFocus} positions={acct.positions} flash={flash} onHit={(s, side, p) => loadOrder(s, side, p)} />}
          {center && <div className="col">{w.chart && <Chart focus={focus} marks={marks} positions={acct.positions} />}{w.depth && <Depth focus={focus} marks={marks} tick={tick} />}</div>}
          {w.book && <div className="col"><Book focus={focus} marks={marks} tick={tick} tape={tape} onPx={(p, side) => loadOrder(focus, side, p)} orders={acct.orders} /></div>}
          {w.ticket && <div className="col"><Ticket load={load} focus={focus} marks={marks} tick={tick} placeOrder={placeOrder} px={px} setPx={setPx} positions={acct.positions} onExec={onExec} setBTab={setBTab} setFocus={pickFocus} prefill={props.prefill} setPrefill={props.setPrefill} askQuote={() => { props.setPrefill({ sym: focus }); props.setTab('request') }} /></div>}
        </div>
      )}
      {w.bottom && <Bottom {...props} setFocus={pickFocus} btab={btab} setBTab={setBTab} flash={flash} onClose={(s, side, qty) => { if (!w.ticket) set({ ...w, ticket: true }); loadOrder(s, side, null, { qty, type: 'Market', review: true }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
    </div>
  )
}

/* ---------- Order ticket: single or strip, review, execution receipt, block RFQ ---------- */
const STATUS = ['Accepted', 'Filled', 'Sent to FCM', 'Cleared by DCO']

function loadSkip() { try { return localStorage.getItem('cdx-skip-review') === '1' } catch { return false } }
function saveSkip(v) { try { localStorage.setItem('cdx-skip-review', v ? '1' : '0') } catch { /* storage unavailable */ } }

function effect(pos, side, q) {
  const cur = pos?.qty || 0, d = side === 'Buy' ? q : -q, n = cur + d
  if (!cur) return 'Opens'
  if (Math.sign(cur) === Math.sign(d)) return 'Adds'
  if (n === 0) return 'Closes'
  return Math.sign(n) === Math.sign(cur) ? 'Reduces' : 'Flips'
}

function Ticket({ load, focus, setFocus, marks, tick, placeOrder, px, setPx, positions, onExec, setBTab, askQuote, prefill, setPrefill }) {
  const pf = prefill?.strip || prefill?.rfq
  const [mode, setMode] = useState(prefill?.strip ? 'Strip' : prefill?.rfq ? 'RFQ' : 'Single')
  const [side, setSide] = useState(pf?.side || 'Buy')
  const [type, setType] = useState('Limit')
  const [qty, setQty] = useState(pf?.qty || 16)
  const [tif, setTif] = useState('GTC')
  const [n, setN] = useState(prefill?.strip?.n || 6)
  useEffect(() => {
    if (prefill?.strip) setFocus(sym(prefill.strip.sku, prefill.strip.from))
    if (pf) setPrefill(null)
  }, [])
  const [thru, setThru] = useState(0) // strip limit: ticks through the best price
  const [autoReview, setAutoReview] = useState(0)
  const [review, setReview] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [rfq, setRfq] = useState(null)
  const [skip, setSkip] = useState(loadSkip)
  const ins = INSTRUMENTS.find((i) => i.sym === focus)
  const mid = marks[focus]
  const q = Math.max(1, Math.round(Number(qty) || 0))
  const sgn = side === 'Buy' ? 1 : -1
  const touch = (s) => { const t = top(s, marks[s], tick, 1); return side === 'Buy' ? t.ask.px : t.bid.px }
  const singlePx = type === 'Market' ? touch(focus) : px !== '' ? Number(px) : touch(focus)
  const stripSyms = MONTHS.slice(ins.i, ins.i + n).map((m) => sym(ins.sku, m))

  const legs = () => (mode !== 'Strip' ? [{ sym: focus, qty: q, px: singlePx }] : stripSyms.map((s) => ({ sym: s, qty: q, px: roundTick(touch(s) + sgn * thru * TICK) })))
  const plan = () => legs().map((l) => {
    const sim = type === 'Stop' ? { fills: [], filled: 0, avg: 0, left: l.qty, slip: 0 } : simulate(l.sym, marks[l.sym], tick, side, l.qty, mode === 'Strip' ? type === 'Market' ? 'Market' : 'Limit' : type, l.px)
    return { ...l, sim, mid: marks[l.sym], eff: effect(positions[l.sym], side, l.qty) }
  })

  const execute = (p, venue) => {
    const execs = p.map((l) => placeOrder({ sym: l.sym, side, qty: l.qty, type: venue === 'Block' ? 'Market' : mode === 'Strip' && type === 'Stop' ? 'Limit' : type, px: venue === 'Block' ? l.blockPx : l.px, tif, venue }))
    setReview(null); setRfq(null)
    setReceipt({ execs, stage: 0, venue })
    onExec(p.map((l) => l.sym))
    ;[1, 2, 3].forEach((k) => setTimeout(() => setReceipt((r) => (r ? { ...r, stage: Math.max(r.stage, k) } : r)), 450 * k))
  }
  const submit = () => { const p = plan(); if (skip) execute(p); else setReview(p) }

  // A click on a bid, ask or book level loads that side and price; Close also loads size and opens the review.
  useEffect(() => {
    if (!load) return
    setMode('Single'); setReceipt(null); setRfq(null); setReview(null)
    setSide(load.side)
    setType(load.type || 'Limit')
    if (load.qty) setQty(load.qty)
    if (load.review) setAutoReview(load.at)
  }, [load?.at])
  useEffect(() => { if (autoReview) { setReview(plan()); setAutoReview(0) } }, [autoReview])

  if (receipt) {
    const e = receipt.execs
    const filled = e.reduce((a, x) => a + x.filled, 0), rest = e.reduce((a, x) => a + x.rest, 0), cancelled = e.reduce((a, x) => a + x.cancelled, 0)
    const avg = filled ? e.reduce((a, x) => a + x.avg * x.filled, 0) / filled : 0
    return (
      <div className="w w-ticket">
        <div className="w-head"><span>Execution {receipt.venue === 'Block' ? '· block' : ''}</span><span className="note mono">{e[0].ts}</span></div>
        <div className="w-body stack" style={{ gap: 12 }}>
          <ol className="status">{STATUS.map((s, i) => <li key={s} className={!filled && i > 0 ? 'skip' : i <= receipt.stage ? 'done' : ''}>{s}</li>)}</ol>
          <div className="receipt-head">
            <b className={side === 'Buy' ? 'up' : 'dn'}>{side} {filled} of {e.reduce((a, x) => a + x.qty, 0)}</b>
            <span className="mono">avg {filled ? fmt(avg, 3) : '—'}</span>
          </div>
          {e.map((x) => (
            <div key={x.id} className="leg">
              <div className="row between"><b className="mono">{x.sym}</b><span className="note">{x.id} · {x.venue}</span></div>
              {x.fills.map((f, i) => <div key={i} className="kv"><span>{f.q} @ {fmt(f.px)}</span><b>{(f.q * SIZE).toLocaleString()} GPU-hrs</b></div>)}
              {x.rest > 0 && <div className="kv"><span className="warn-t">{x.rest} resting @ {fmt(x.fills.length ? x.fills.at(-1).px : x.avg || 0)}{' '}</span><b className="warn-t">{x.filled ? 'partially filled' : 'working'}</b></div>}
              {x.cancelled > 0 && <div className="kv"><span className="dn">{x.cancelled} cancelled</span><b className="dn">{x.type === 'Market' ? 'book exhausted' : 'IOC remainder'}</b></div>}
            </div>
          ))}
          {filled > 0 && <div className="kv"><span>Notional</span><b>{usd(filled * SIZE * avg)}</b></div>}
          {rest > 0 && <div className="callout">The rest is working on the book. It fills if the market reaches your price, or cancel it in Open orders.</div>}
          {cancelled > 0 && <div className="callout crit">{cancelled} contracts did not trade. For size, ask for a block quote.</div>}
          <div className="row">
            <button className="btn" onClick={() => setReceipt(null)}>New order</button>
            <button className="btn ghost" onClick={() => setBTab(rest ? 'Open orders' : 'Trade blotter')}>{rest ? 'Open orders' : 'View in blotter'}</button>
          </div>
        </div>
      </div>
    )
  }

  if (rfq) return <BlockPanel rfq={rfq} setRfq={setRfq} side={side} marks={marks} execute={execute} />

  if (review) {
    const tot = review.reduce((a, l) => a + l.qty, 0)
    const notional = review.reduce((a, l) => a + l.qty * SIZE * (l.sim.filled ? l.sim.avg : l.px), 0)
    const imNow = Object.entries(positions).reduce((a, [k, p]) => a + Math.abs(p.qty) * SIZE * marks[k] * IM_RATE, 0)
    const imAfter = imNow + review.reduce((a, l) => { const c = positions[l.sym]?.qty || 0, nq = c + sgn * l.qty; return a + (Math.abs(nq) - Math.abs(c)) * SIZE * l.mid * IM_RATE }, 0)
    const big = review.some((l) => l.sim.left > 0 || l.sim.slip > 3 * TICK + 1e-9)
    return (
      <div className="w w-ticket">
        <div className="w-head"><span>Review order</span><span className="note">{review.length > 1 ? `strip · ${review.length} contracts` : 'single'}</span></div>
        <div className="w-body stack" style={{ gap: 10 }}>
          <table className="dense">
            <thead><tr><th>Contract</th><th className="n">Qty</th><th className="n">Est. avg</th><th className="n">Fills now</th></tr></thead>
            <tbody>{review.map((l) => (
              <tr key={l.sym}><td className="mono">{l.sym}<div className="note">{type === 'Market' ? 'Market' : 'Limit ' + fmt(l.px)} · {l.eff}</div></td><td className={'n ' + (side === 'Buy' ? 'up' : 'dn')}>{sgn > 0 ? '+' : '-'}{l.qty}</td><td className="n">{l.sim.filled ? fmt(l.sim.avg, 3) : '—'}</td><td className={'n ' + (l.sim.left ? 'warn-t' : '')}>{l.sim.filled}/{l.qty}</td></tr>
            ))}</tbody>
          </table>
          <div className="kv"><span>Total</span><b>{tot} contracts · {(tot * SIZE).toLocaleString()} GPU-hrs</b></div>
          <div className="kv"><span>Notional (est.)</span><b>{usd(notional)}</b></div>
          <div className="kv"><span>Slippage vs mid (est.)</span><b>{usd(review.reduce((a, l) => a + l.sim.filled * SIZE * l.sim.slip, 0))}</b></div>
          <div className="kv"><span>Initial margin</span><b>{usd(imNow)} → {usd(imAfter)}</b></div>
          <div className="kv"><span>Fee (est.)</span><b>{usd(tot * SIZE * FEE)}</b></div>
          {review.some((l) => l.sim.left > 0) && type !== 'Market' && tif !== 'IOC' && <div className="note">Unfilled size rests on the book as a working order (partial fill).</div>}
          {big && (
            <div className="callout">
              <b>Large for the screen.</b> Part of this would {type === 'Market' ? 'run out of displayed depth' : 'not fill now'} or slip more than 3 ticks. A block quote from market makers may price it better.
              <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => { setRfq({ legs: review }); setReview(null) }}>Get a block quote instead →</button></div>
            </div>
          )}
          <div className="row">
            <button className={'btn ' + (side === 'Buy' ? 'buy' : 'sell')} onClick={() => execute(review)}>Confirm {side.toLowerCase()}</button>
            <button className="btn ghost" onClick={() => setReview(null)}>Edit</button>
          </div>
          <label className="check"><input type="checkbox" checked={skip} onChange={() => { setSkip(!skip); saveSkip(!skip) }} />Skip review next time</label>
        </div>
      </div>
    )
  }

  const pos = positions[focus]
  const notional = q * SIZE * singlePx * (mode === 'Strip' ? n : 1)
  return (
    <div className="w w-ticket">
      <div className="w-head"><Seg small value={mode} options={['Single', 'Strip', ['RFQ', 'Quote']]} onChange={setMode} /><span className="note mono">{mode === 'Strip' ? `${stripSyms[0]} → ${stripSyms.at(-1).split(' ')[1]}` : focus}</span></div>
      <div className="w-body stack" style={{ gap: 10 }}>
        <div className="sides"><button className={side === 'Buy' ? 'on buy' : ''} onClick={() => setSide('Buy')}>Buy</button><button className={side === 'Sell' ? 'on sell' : ''} onClick={() => setSide('Sell')}>Sell</button></div>
        {mode !== 'RFQ' && <Seg small value={type} options={mode === 'Strip' ? ['Limit', 'Market'] : ['Limit', 'Market', 'Stop']} onChange={setType} />}
        {mode === 'RFQ' && <p className="note" style={{ margin: 0 }}>Ask market makers for a firm price on this contract, at any size, even with an empty book. Anonymous; 25+ contracts trade as a block and print after execution.</p>}
        <div className="form">
          <label>{mode === 'Strip' ? 'Contracts per month' : 'Contracts'}<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          {mode === 'RFQ' ? <label>Screen mid<input disabled value={fmt(mid)} /></label> : mode === 'Single'
            ? <label>{type === 'Stop' ? 'Trigger' : 'Price'} $/GPU-hr<input disabled={type === 'Market'} placeholder={fmt(singlePx)} value={type === 'Market' ? '' : px} onChange={(e) => setPx(e.target.value)} /></label>
            : <label>Months<select value={n} onChange={(e) => setN(Number(e.target.value))}>{[...new Set([2, 3, 6, 9, 12, n])].sort((x, y) => x - y).filter((k) => ins.i + k <= 12 || k === n).map((k) => <option key={k}>{k}</option>)}</select></label>}
        </div>
        {mode === 'Strip' && type === 'Limit' && <label>Limit per leg: ticks through best price<input type="number" min="0" max="10" value={thru} onChange={(e) => setThru(Number(e.target.value))} /></label>}
        {mode === 'Strip' && <div className="strip">{stripSyms.map((s) => <span key={s}><b className="mono">{s.split(' ')[1]}</b>{fmt(marks[s])}</span>)}</div>}
        <div className="row" style={{ gap: 6 }}>{[8, 16, 64, 128].map((k) => <button key={k} className="chip-btn" onClick={() => setQty(k)}>{k}</button>)}<span className="note">contracts</span></div>
        {type !== 'Market' && mode !== 'RFQ' && <Seg small value={tif} options={['GTC', 'Day', 'IOC']} onChange={setTif} />}
        <div className="kv" title="1 contract = 1 GPU for one month (730 GPU-hours)"><span>Covers</span><b>{q.toLocaleString()} GPU{q === 1 ? '' : 's'} × {mode === 'Strip' ? `${n} months` : monthName(ins.m)}</b></div>
        <div className="kv"><span>GPU-hours</span><b>{(q * SIZE * (mode === 'Strip' ? n : 1)).toLocaleString()}</b></div>
        <div className="kv"><span>Notional (approx.)</span><b>{usd(notional)}</b></div>
        {pos && mode === 'Single' && <div className="kv"><span>Current position</span><b className={pos.qty > 0 ? 'up' : 'dn'}>{pos.qty > 0 ? '+' : ''}{pos.qty} @ {fmt(pos.avg)}</b></div>}
        {mode === 'RFQ'
          ? <button className={'btn ' + (side === 'Buy' ? 'buy' : 'sell')} onClick={() => setRfq({ legs: plan() })}>Request quotes · {side.toLowerCase()} {q}</button>
          : <><button className={'btn ' + (side === 'Buy' ? 'buy' : 'sell')} onClick={submit}>{skip ? '' : 'Review '}{side.toLowerCase()} {mode === 'Strip' ? `${n}-month strip` : `${q} ${focus}`}</button>
        <button className="btn ghost" onClick={() => setRfq({ legs: plan() })}>Request a block quote</button></>}
        <button className="link" onClick={askQuote}>Trade this against another GPU or month? Spread RFQ →</button>
        <span className="note">{mode === 'RFQ' ? 'Quotes are firm for 15 seconds and compared with the screen.' : mode === 'Strip' ? 'A strip sends one order per month. Each is a separate contract on the order book.' : `Cash-settles to the average of the daily Compute Signal ${ins.sku} index over ${monthName(ins.m)}. 1 contract = 1 GPU for the month.`}</span>
      </div>
    </div>
  )
}

// Block RFQ inside the ticket: same legs, quotes from market makers, compared with the screen.
function BlockPanel({ rfq, setRfq, side, marks, execute }) {
  const [quotes, setQuotes] = useState([])
  const sgn = side === 'Buy' ? 1 : -1
  const tot = rfq.legs.reduce((a, l) => a + l.qty, 0)
  const screen = rfq.legs.reduce((a, l) => a + l.qty * (l.sim.filled ? (l.sim.avg * l.sim.filled + (l.sim.left ? (l.px + sgn * TICK * 3) * l.sim.left : 0)) / l.qty : l.px + sgn * TICK * 3), 0) / tot
  React.useEffect(() => {
    const t = ['Lattice Trading', 'MM 2', 'MM 3'].map((name, i) => setTimeout(() => setQuotes((qs) => [...qs, { name, off: [1, 2, 2][i] + (i === 2 ? 1 : 0) }].sort((a, b) => a.off - b.off)), 700 * (i + 1)))
    return () => t.forEach(clearTimeout)
  }, [])
  const priced = (qt) => rfq.legs.map((l) => ({ ...l, blockPx: roundTick(l.mid + sgn * qt.off * TICK) }))
  const avgOf = (qt) => priced(qt).reduce((a, l) => a + l.blockPx * l.qty, 0) / tot
  return (
    <div className="w w-ticket">
      <div className="w-head"><span>Block quote</span><span className="note">{rfq.legs.length > 1 ? `strip · ${rfq.legs.length} legs` : rfq.legs[0].sym} · {side.toLowerCase()} {tot}</span></div>
      <div className="w-body stack" style={{ gap: 10 }}>
        <p className="note" style={{ margin: 0 }}>Anonymous request to market makers. Quotes are firm for 15 seconds and trade off the order book, then print to the tape.</p>
        <div className="kv"><span>Screen estimate (walk the book)</span><b>{fmt(screen, 3)}</b></div>
        {quotes.length === 0 && <span className="note">Waiting for quotes…</span>}
        {quotes.map((qt, i) => {
          const a = avgOf(qt), save = (screen - a) * sgn * tot * SIZE
          return (
            <div key={qt.name} className="quote-row">
              <span>{qt.name}</span><b className="mono cream">{fmt(a, 3)}</b>
              <span className={save >= 0 ? 'up note' : 'dn note'}>{save >= 0 ? 'saves ' : 'costs '}{usd(Math.abs(save))}</span>
              <button className="btn" onClick={() => execute(priced(qt), 'Block')}>{i === 0 ? 'Hit best' : 'Hit'}</button>
            </div>
          )
        })}
        <button className="btn ghost" onClick={() => setRfq(null)}>Back to order</button>
      </div>
    </div>
  )
}
