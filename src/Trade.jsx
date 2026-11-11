import React, { useMemo, useState } from 'react'
import { SKUS, MONTHS, SIZE, TICK, IM_RATE, FEE, INSTRUMENTS, fmt, usd, sym, skuOf, roundTick, contractName } from './data.js'
import { candles, stats24, book, TF } from './market.js'
import { Seg } from './ui.jsx'

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
function Markets({ marks, focus, setFocus, positions }) {
  const [sku, setSku] = useState('All')
  const [q, setQ] = useState('')
  const [held, setHeld] = useState(false)
  const [fav, setFav] = useState([sym('H100', 'JUN27'), sym('B200', 'MAR27')])
  const [favOnly, setFavOnly] = useState(false)
  const list = INSTRUMENTS.filter((i) => (sku === 'All' || i.sku === sku) && (!q || i.sym.toLowerCase().includes(q.toLowerCase()) || i.m.toLowerCase().includes(q.toLowerCase())) && (!held || positions[i.sym]) && (!favOnly || fav.includes(i.sym)))
  return (
    <div className="w w-markets">
      <div className="w-head"><span>Markets</span><span className="note">{list.length} contracts</span></div>
      <div className="w-tools">
        <input placeholder="Search H1UF, JUN27…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Seg small value={sku} options={['All', ...Object.keys(SKUS)]} onChange={setSku} />
        <div className="row" style={{ gap: 6 }}>
          <button className={'chip-btn' + (held ? ' on' : '')} onClick={() => setHeld(!held)}>Held</button>
          <button className={'chip-btn' + (favOnly ? ' on' : '')} onClick={() => setFavOnly(!favOnly)}>★ Watchlist</button>
        </div>
      </div>
      <div className="w-body scroll">
        <table className="dense">
          <thead><tr><th></th><th>Contract</th><th className="n">Last</th><th className="n">24h</th><th className="n">Vol</th></tr></thead>
          <tbody>
            {list.map((i) => {
              const st = stats24(i.sym, marks[i.sym])
              return (
                <tr key={i.sym} className={'click ' + (i.sym === focus ? 'sel' : '')} onClick={() => setFocus(i.sym)}>
                  <td><button className={'star' + (fav.includes(i.sym) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); setFav(fav.includes(i.sym) ? fav.filter((x) => x !== i.sym) : [...fav, i.sym]) }} aria-label="Watchlist">★</button></td>
                  <td><b className="mono">{i.sym}</b>{positions[i.sym] && <span className="dot" title="Held" />}<div className="note">{i.sku} · {i.m}</div></td>
                  <td className="n">{fmt(marks[i.sym])}</td>
                  <td className={'n ' + (st.chg >= 0 ? 'up' : 'dn')}>{st.chg >= 0 ? '+' : ''}{st.chg.toFixed(2)}%</td>
                  <td className="n">{st.vol.toLocaleString()}</td>
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
  const W = 900, H = 360, VH = showVol ? 50 : 0, padR = 56
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
  const W = 600, H = 170
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
function Book({ focus, marks, tick, tape, onPx }) {
  const [tab, setTab] = useState('Book')
  const { bids, asks } = book(focus, marks[focus], tick, 11)
  const max = Math.max(...bids.map((b) => b.q), ...asks.map((a) => a.q))
  const trades = tape.filter((t) => t.sym === focus).slice(0, 18)
  return (
    <div className="w w-book">
      <div className="w-head"><Seg small value={tab} options={['Book', 'Trades']} onChange={setTab} /><span className="note">spread {fmt(2 * TICK)}</span></div>
      <div className="w-body">
        {tab === 'Book' ? (
          <table className="dense book">
            <thead><tr><th>Price</th><th className="n">Size</th><th className="n">GPU-hrs</th></tr></thead>
            <tbody>
              {[...asks].reverse().map((a) => <tr key={'a' + a.px} className="ask click" onClick={() => onPx(a.px)}><td className="depthbar"><i style={{ width: `${(a.q / max) * 100}%` }} />{fmt(a.px)}</td><td className="n">{a.q}</td><td className="n">{(a.q * SIZE).toLocaleString()}</td></tr>)}
              <tr className="mid"><td colSpan={3}>{fmt(marks[focus])} <span className="note">index {fmt(SKUS[skuOf(focus)].index)}</span></td></tr>
              {bids.map((b) => <tr key={'b' + b.px} className="bid click" onClick={() => onPx(b.px)}><td className="depthbar"><i style={{ width: `${(b.q / max) * 100}%` }} />{fmt(b.px)}</td><td className="n">{b.q}</td><td className="n">{(b.q * SIZE).toLocaleString()}</td></tr>)}
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

/* ---------- Order ticket ---------- */
function Ticket({ focus, marks, placeOrder, px, setPx, positions, askQuote }) {
  const [side, setSide] = useState('Buy')
  const [type, setType] = useState('Limit')
  const [qty, setQty] = useState(16)
  const [tif, setTif] = useState('GTC')
  const [msg, setMsg] = useState(null)
  const mid = marks[focus]
  const price = type === 'Market' ? roundTick(mid + (side === 'Buy' ? TICK : -TICK)) : px !== '' ? Number(px) : roundTick(mid + (side === 'Buy' ? TICK : -TICK))
  const q = Math.max(1, Math.round(Number(qty) || 0))
  const notional = q * SIZE * price
  const pos = positions[focus]
  const submit = () => setMsg(placeOrder({ sym: focus, side, qty: q, type, px: price, tif }))
  return (
    <div className="w w-ticket">
      <div className="w-head"><span>Order ticket</span><span className="note mono">{focus}</span></div>
      <div className="w-body stack" style={{ gap: 10 }}>
        <div className="sides"><button className={side === 'Buy' ? 'on buy' : ''} onClick={() => setSide('Buy')}>Buy</button><button className={side === 'Sell' ? 'on sell' : ''} onClick={() => setSide('Sell')}>Sell</button></div>
        <Seg small value={type} options={['Limit', 'Market', 'Stop']} onChange={setType} />
        <div className="form">
          <label>Contracts<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <label>{type === 'Stop' ? 'Trigger' : 'Price'} $/GPU-hr<input disabled={type === 'Market'} placeholder={fmt(price)} value={type === 'Market' ? '' : px} onChange={(e) => setPx(e.target.value)} /></label>
        </div>
        <div className="row" style={{ gap: 6 }}>{[8, 16, 64, 128].map((n) => <button key={n} className="chip-btn" onClick={() => setQty(n)}>{n}</button>)}<span className="note">contracts</span></div>
        {type !== 'Market' && <Seg small value={tif} options={['GTC', 'Day', 'IOC']} onChange={setTif} />}
        <div className="kv"><span>GPU-hours</span><b>{(q * SIZE).toLocaleString()}</b></div>
        <div className="kv"><span>Notional</span><b>{usd(notional)}</b></div>
        <div className="kv"><span>Initial margin (est.)</span><b>{usd(notional * IM_RATE)}</b></div>
        <div className="kv"><span>Fee (est.)</span><b>{usd(q * SIZE * FEE)}</b></div>
        {pos && <div className="kv"><span>Current position</span><b className={pos.qty > 0 ? 'up' : 'dn'}>{pos.qty > 0 ? '+' : ''}{pos.qty} @ {fmt(pos.avg)}</b></div>}
        <button className={'btn ' + (side === 'Buy' ? 'buy' : 'sell')} onClick={submit}>{side} {q} {focus}</button>
        {msg && <div className={'callout ' + (msg.ok ? 'good' : '')}>{msg.msg}</div>}
        <button className="link" onClick={askQuote}>Not on the screen? Ask for a quote (RFQ, block or flex) →</button>
        <span className="note">{contractName(skuOf(focus), INSTRUMENTS.find((i) => i.sym === focus).m)}. Cash settles to Signal Settlement (monthly index average).</span>
      </div>
    </div>
  )
}

/* ---------- Bottom: positions, orders, closed, blotter ---------- */
function Bottom({ me, acct, marks, placeOrder, cancelOrder, setFocus, setTab, setPrefill }) {
  const [tab, setBTab] = useState('Positions')
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
  const exportCsv = () => {
    const csv = ['time,contract,side,qty,price,venue,status', ...fills.map((f) => [f.ts, f.sym, f.side, f.qty, f.px, f.venue, f.status].join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'blotter.csv'; a.click()
  }
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
                  <tr key={k}>
                    <td className="click" onClick={() => setFocus(k)}><b className="mono">{k}</b></td>
                    <td className={'n ' + (p.qty > 0 ? 'up' : 'dn')}>{p.qty > 0 ? '+' : ''}{p.qty}</td>
                    <td className="n">{(p.qty * SIZE).toLocaleString()}</td>
                    <td className="n">{fmt(p.avg)}</td><td className="n">{fmt(marks[k])}</td>
                    <td className={'n ' + (pnl >= 0 ? 'up' : 'dn')}>{usd(pnl)}</td>
                    <td className="n">{usd(Math.abs(p.qty) * SIZE * marks[k] * IM_RATE)}</td>
                    <td className="actions">
                      <button className="chip-btn" onClick={() => placeOrder({ sym: k, side: p.qty > 0 ? 'Sell' : 'Buy', qty: Math.abs(p.qty), type: 'Market', px: 0, tif: 'IOC' })}>Close</button>
                      {canConvert && <button className="chip-btn accent" onClick={() => { setPrefill({ kind: 'EFP', sku: skuOf(k), start: INSTRUMENTS.find((i) => i.sym === k).m }); setTab('request') }}>Convert to Physical</button>}
                    </td>
                  </tr>
                )
              }) : <tr><td colSpan={8} className="note">No open positions.</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'Open orders' && (
          <table className="dense">
            <thead><tr><th>Time</th><th>Contract</th><th>Side</th><th>Type</th><th className="n">Qty</th><th className="n">Price</th><th>TIF</th><th></th></tr></thead>
            <tbody>{orders.length ? orders.map((o) => <tr key={o.id}><td className="mono note">{o.ts}</td><td className="mono">{o.sym}</td><td className={o.side === 'Buy' ? 'up' : 'dn'}>{o.side}</td><td>{o.type}</td><td className="n">{o.qty}</td><td className="n">{fmt(o.px)}</td><td>{o.tif}</td><td className="actions"><button className="chip-btn" onClick={() => cancelOrder(o.id)}>Cancel</button></td></tr>) : <tr><td colSpan={8} className="note">No working orders. Place a limit away from the market to see one here.</td></tr>}</tbody>
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
            <thead><tr><th>Time</th><th>Fill ID</th><th>Contract</th><th>Side</th><th className="n">Qty</th><th className="n">Price</th><th>Venue</th><th>Clearing</th></tr></thead>
            <tbody>{fills.map((f) => <tr key={f.id}><td className="mono note">{f.ts}</td><td className="mono note">{f.id}</td><td className="mono">{f.sym}</td><td className={f.side === 'Buy' ? 'up' : 'dn'}>{f.side}</td><td className="n">{f.qty}</td><td className="n">{fmt(f.px)}</td><td>{f.venue}</td><td><span className="pill good">{f.status}</span></td></tr>)}</tbody>
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
  const set = (nw) => { setW(nw); saveLayout(nw) }
  const ins = INSTRUMENTS.find((i) => i.sym === focus)
  const st = stats24(focus, marks[focus])
  const idx = SKUS[ins.sku].index
  const preset = Object.entries(PRESETS).find(([, p]) => WIDGETS.every(([k]) => p.w[k] === w[k]))?.[0] || 'custom'
  const pickFocus = (s) => { setFocus(s); setPx('') }
  const center = w.chart || w.depth
  const right = w.book || w.ticket
  const cols = [w.markets && '300px', center && 'minmax(0,1fr)', w.book && (center ? '290px' : 'minmax(0,1fr)'), w.ticket && '300px'].filter(Boolean).join(' ')

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
          <div><span>Mark</span><b className="cream">{fmt(marks[focus])}</b></div>
          <div><span>24h</span><b className={st.chg >= 0 ? 'up' : 'dn'}>{st.chg >= 0 ? '+' : ''}{st.chg.toFixed(2)}%</b></div>
          <div><span>Index</span><b>{fmt(idx)}</b></div>
          <div><span>Basis</span><b className={marks[focus] >= idx ? 'up' : 'dn'}>{marks[focus] >= idx ? '+' : ''}{fmt(marks[focus] - idx)}</b></div>
          <div><span>24h vol</span><b>{st.vol.toLocaleString()}</b></div>
          <div><span>Open int.</span><b>{st.oi.toLocaleString()}</b></div>
          <div><span>Settles</span><b>Signal avg, {ins.m.slice(0, 3)} 20{ins.m.slice(3)}</b></div>
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
          {w.markets && <Markets marks={marks} focus={focus} setFocus={pickFocus} positions={acct.positions} />}
          {center && <div className="col">{w.chart && <Chart focus={focus} marks={marks} positions={acct.positions} />}{w.depth && <Depth focus={focus} marks={marks} tick={tick} />}</div>}
          {w.book && <div className="col"><Book focus={focus} marks={marks} tick={tick} tape={tape} onPx={(p) => setPx(fmt(p))} /></div>}
          {w.ticket && <div className="col"><Ticket focus={focus} marks={marks} placeOrder={placeOrder} px={px} setPx={setPx} positions={acct.positions} askQuote={() => { props.setPrefill({ sym: focus }); props.setTab('request') }} /></div>}
        </div>
      )}
      {w.bottom && <Bottom {...props} setFocus={pickFocus} />}
    </div>
  )
}
