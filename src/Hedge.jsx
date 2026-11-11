import React, { useMemo, useRef, useState } from 'react'
import { SKUS, MONTHS, SIZE, sym, fmt, usd, usdK } from './data.js'
import { Panel, Stat, Seg } from './ui.jsx'
import { TYPES, REGIONS, TEMPLATE, SAMPLES, parseCsv, toCsv, contractLines, computeExposure, metrics, findHedges, applyHedges, monthLabel, period } from './exposure.js'
import './hedge.css'

// Exposure: participants enter or import their physical GPU position, see where they're exposed
// to rate moves, and get specific hedges with one-click handoffs into Trade and Request.

const store = {} // keeps each account's inputs while switching tabs
const blank = { type: 'need', sku: 'H100', region: 'US-East', start: 'JAN27', months: 6, gpus: 64, price: '', cp: '', notes: '' }
const KIND_CLS = { Spread: 'k-spread', Strip: 'k-strip', Future: 'k-strip', 'Block RFQ': 'k-block', EFP: 'k-phys', 'Regional RFQ': 'k-phys' }

function Heatmap({ ex, after, view, sel, onSel, marks }) {
  const data = view === 'after' ? after : ex
  const skus = Object.keys(SKUS).filter((k) => ex.phys[k].some((v) => v) || ex.fut[k].some((v) => v))
  const max = Math.max(1, ...skus.flatMap((k) => ex.net[k].map(Math.abs)))
  if (!skus.length) return <p className="note">No exposure on the listed curve yet.</p>
  return (
    <div className="tw">
      <table className="heat">
        <thead><tr><th>GPU · net GPUs</th>{MONTHS.map((m) => <th key={m} className="n">{monthLabel(m).slice(0, 3)} {m.slice(3)}</th>)}<th className="n">$ at risk ±10%</th></tr></thead>
        <tbody>
          {skus.map((k) => {
            const risk = data.net[k].reduce((a, v, i) => a + Math.abs(v) * SIZE * marks[sym(k, MONTHS[i])] * 0.1, 0)
            return (
              <tr key={k}>
                <td><b>{k}</b></td>
                {data.net[k].map((v, i) => {
                  const a = Math.min(1, Math.abs(v) / max)
                  const bg = v < 0 ? `rgba(226,128,111,${0.08 + a * 0.55})` : v > 0 ? `rgba(143,169,214,${0.08 + a * 0.55})` : 'transparent'
                  const on = sel && sel.k === k && sel.i === i
                  return <td key={i} className={'cell' + (on ? ' on' : '')} style={{ background: bg }} onClick={() => onSel(on ? null : { k, i })} title={`${sym(k, MONTHS[i])}: ${v > 0 ? '+' : ''}${v} GPUs`}>{v ? (v > 0 ? '+' : '') + v : '·'}</td>
                })}
                <td className="n">{usdK(risk)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CellDetail({ k, i, ex, after, lines, marks }) {
  const m = MONTHS[i]
  const rows = lines.filter((l) => l.sku === k && TYPES[l.type] && covers(l, i)).map((l) => ({ l }))
  const fut = ex.fut[k][i]
  return (
    <div className="cell-detail">
      <div className="row between"><b className="mono">{sym(k, m)} · {monthLabel(m)}</b><span className="note">mark ${fmt(marks[sym(k, m)])}/GPU-hr</span></div>
      <table className="dense">
        <tbody>
          {rows.map(({ l }, x) => <tr key={x}><td>{TYPES[l.type].label}<div className="note">{l.notes || l.cp} {l.region !== 'US-East' ? `· ${l.region}` : ''}</div></td><td className={'n ' + (TYPES[l.type].side < 0 ? 'dn' : TYPES[l.type].side > 0 ? 'up-b' : '')}>{TYPES[l.type].side ? (TYPES[l.type].side > 0 ? '+' : '−') + l.gpus : `(${l.gpus})`}</td></tr>)}
          <tr><td>CDX futures position</td><td className="n">{fut > 0 ? '+' : ''}{fut}</td></tr>
          <tr className="tot"><td>Net open</td><td className="n">{ex.net[k][i] > 0 ? '+' : ''}{ex.net[k][i]}</td></tr>
          <tr className="tot"><td>After selected hedges</td><td className="n">{after.net[k][i] > 0 ? '+' : ''}{after.net[k][i]}</td></tr>
        </tbody>
      </table>
      <p className="note">Bracketed lines are secured physically but still float with the index, so they don't change price exposure.</p>
    </div>
  )
}

// Does a line cover listed month i? Lines can start before the curve (e.g. a SEP26 contract).
function covers(l, i) {
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const abs = (m) => (2000 + +m.slice(3)) * 12 + MON.indexOf(m.slice(0, 3))
  const off = abs(l.start) - abs(MONTHS[0])
  return off <= i && i < off + l.months
}

function Importer({ onAdd, onClose, kind }) {
  const [mode, setMode] = useState('upload')
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [f, setF] = useState({ ...blank, type: kind === 'provider' ? 'fleet' : 'need' })
  const fileRef = useRef()
  const read = (t) => { setText(t); setParsed(parseCsv(t)) }
  const onFile = (file) => { if (!file) return; const r = new FileReader(); r.onload = () => read(String(r.result)); r.readAsText(file) }
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' })); a.download = 'cdx-exposure-template.csv'; a.click() }
  const types = Object.entries(TYPES)
  return (
    <Panel title="Add exposure" right={<button className="link" onClick={onClose}>Close</button>} className="importer">
      <Seg value={mode} onChange={setMode} options={[['upload', 'Upload CSV'], ['paste', 'Paste'], ['form', 'Add a line'], ['api', 'Connect']]} />
      {(mode === 'upload' || mode === 'paste') && (
        <div className="stack" style={{ marginTop: 14 }}>
          {mode === 'upload' ? (
            <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }} onClick={() => fileRef.current.click()}>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files[0])} />
              <b>Drop a CSV here or click to choose</b>
              <span className="note">One row per commitment: type, sku, region, start, months, gpus, price, counterparty, notes</span>
            </div>
          ) : (
            <textarea className="paste" rows={7} placeholder={TEMPLATE} value={text} onChange={(e) => read(e.target.value)} />
          )}
          <div className="row"><button className="link" onClick={dl}>Download template</button><span className="note">·</span><button className="link" onClick={() => read(TEMPLATE)}>Try the template rows</button></div>
          {parsed && (
            <div className="stack">
              <div className="row"><span className="pill good">{parsed.rows.length} rows ready</span>{parsed.errors.length > 0 && <span className="pill crit">{parsed.errors.length} need fixing</span>}</div>
              {parsed.errors.length > 0 && <ul className="errs">{parsed.errors.map((e) => <li key={e.line}>Line {e.line}: {e.msg}</li>)}</ul>}
              {parsed.rows.length > 0 && (
                <div className="tw"><table className="dense">
                  <thead><tr><th>Type</th><th>GPU</th><th>Region</th><th>Start</th><th className="n">Months</th><th className="n">GPUs</th><th className="n">$/GPU-hr</th></tr></thead>
                  <tbody>{parsed.rows.slice(0, 8).map((r, i) => <tr key={i}><td>{TYPES[r.type].label}</td><td>{r.sku}</td><td>{r.region}</td><td>{monthLabel(r.start)}</td><td className="n">{r.months}</td><td className="n">{r.gpus}</td><td className="n">{r.price ? fmt(r.price) : '–'}</td></tr>)}</tbody>
                </table></div>
              )}
              <div className="row">
                <button className="btn" disabled={!parsed.rows.length} onClick={() => onAdd(parsed.rows, false)}>Add {parsed.rows.length} rows</button>
                <button className="btn ghost" disabled={!parsed.rows.length} onClick={() => onAdd(parsed.rows, true)}>Replace my exposure</button>
              </div>
            </div>
          )}
        </div>
      )}
      {mode === 'form' && (
        <div className="form" style={{ marginTop: 14 }}>
          <label className="full">Type
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <optgroup label="Buying compute">{types.filter(([, t]) => t.who === 'buyer').map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</optgroup>
              <optgroup label="Selling compute">{types.filter(([, t]) => t.who === 'provider').map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</optgroup>
            </select>
            <span className="hint">{TYPES[f.type].hint}</span>
          </label>
          <label>GPU<select value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })}>{Object.keys(SKUS).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Region<select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label>Start month<select value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })}>{MONTHS.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          <label>Months<input type="number" min="1" max="36" value={f.months} onChange={(e) => setF({ ...f, months: +e.target.value })} /></label>
          <label>GPUs<input type="number" min="1" step="8" value={f.gpus} onChange={(e) => setF({ ...f, gpus: +e.target.value })} /></label>
          <label>Price $/GPU-hr (fixed only)<input type="number" step="0.01" value={f.price} disabled={!f.type.endsWith('fixed')} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="full">Notes<input value={f.notes} placeholder="e.g. Pre-training run, Provider A reserved" onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          <div className="full row"><button className="btn" disabled={!(f.gpus > 0 && f.months > 0)} onClick={() => onAdd([{ ...f, price: f.price ? +f.price : null, src: 'Manual' }], false)}>Add line</button></div>
        </div>
      )}
      {mode === 'api' && (
        <div className="stack" style={{ marginTop: 14 }}>
          <p className="note">Keep exposure in sync automatically instead of uploading files. (Prototype: not wired up.)</p>
          <div className="connectors">
            {[['REST', 'PUT /v1/exposure with the same columns as the CSV'], ['Cloud billing', 'Read committed-use and reserved contracts from AWS, GCP, Azure, CoreWeave'], ['Scheduler', 'Read planned jobs from Slurm or Kubernetes to estimate need'], ['Fleet / DCIM', 'Providers: read installed GPUs and contract book']].map(([t, d]) => <div key={t} className="conn"><b>{t}</b><span className="note">{d}</span><span className="chip">Coming soon</span></div>)}
          </div>
          <pre className="code">{`curl -X PUT https://api.computedesk.example/v1/exposure \\
  -H "Authorization: Bearer $CDX_KEY" -H "Content-Type: text/csv" \\
  --data-binary @exposure.csv`}</pre>
        </div>
      )}
    </Panel>
  )
}

function PlaceNow({ h, marks, placeOrder, onClose, onDone }) {
  const [res, setRes] = useState(null)
  const go = () => setRes(h.legs.map((l) => ({ l, r: placeOrder({ sym: l.sym, side: l.side, qty: l.qty, type: 'Market', px: 0, tif: 'IOC' }) })))
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{res ? 'Hedge placed' : 'Review hedge'}</h2>
        <p className="note">{h.title}. Market orders, one per contract, sent to the CLOB and cleared via your FCM.</p>
        <div className="tw scroll" style={{ maxHeight: 260 }}><table className="dense">
          <thead><tr><th>Contract</th><th>Side</th><th className="n">Qty</th><th className="n">{res ? 'Result' : 'Mark'}</th></tr></thead>
          <tbody>{(res || h.legs.map((l) => ({ l }))).map(({ l, r }, i) => <tr key={i}><td className="mono">{l.sym}</td><td className={l.side === 'Buy' ? 'up' : 'dn'}>{l.side}</td><td className="n">{l.qty}</td><td className="n">{r ? <span className={r.ok ? 'up' : 'note'}>{r.ok ? 'Filled' : 'Working'}</span> : fmt(marks[l.sym])}</td></tr>)}</tbody>
        </table></div>
        {!res && <div className="kv" style={{ marginTop: 10 }}><span>Initial margin (est.)</span><b>{usd(h.im)}</b></div>}
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          {res ? <button className="btn" onClick={onDone}>Done</button> : <><button className="btn ghost" onClick={onClose}>Cancel</button><button className={'btn ' + (h.side === 'Buy' ? 'buy' : 'sell')} onClick={go}>Place {h.legs.length} orders</button></>}
        </div>
      </div>
    </div>
  )
}

export default function Exposure({ session, me, acct, marks, contracts, placeOrder, setTab, setFocus, setPrefill }) {
  const kind = me.kind === 'provider' ? 'provider' : 'end_user'
  const init = store[session] || { lines: me.kind === 'end_user' || me.kind === 'provider' ? SAMPLES[kind].map((l) => ({ ...l, src: 'Example' })) : [], ratio: 0.8, off: {} }
  const [lines, setLinesRaw] = useState(init.lines)
  const [ratio, setRatioRaw] = useState(init.ratio)
  const [off, setOffRaw] = useState(init.off)
  const [importing, setImporting] = useState(!init.lines.length)
  const [view, setView] = useState('before')
  const [sel, setSel] = useState(null)
  const [placing, setPlacing] = useState(null)
  const save = (patch) => (store[session] = { lines, ratio, off, ...patch })
  const setLines = (v) => { setLinesRaw(v); save({ lines: v }) }
  const setRatio = (v) => { setRatioRaw(v); save({ ratio: v }) }
  const setOff = (v) => { setOffRaw(v); save({ off: v }) }

  const cdx = useMemo(() => contractLines(contracts, me), [contracts, me])
  const all = useMemo(() => [...cdx, ...lines], [cdx, lines])
  const ex = useMemo(() => computeExposure(all, acct.positions), [all, acct.positions])
  // Hedge ideas use a stable price snapshot so the list doesn't jump with every tick.
  const hedges = useMemo(() => findHedges(ex, marks, ratio, kind), [ex, ratio, kind, Math.round(marks[sym('H100', MONTHS[0])] * 10)])
  const chosen = hedges.filter((h) => !off[h.title])
  const after = useMemo(() => applyHedges(ex, chosen), [ex, chosen])
  const m0 = metrics(ex, marks), m1 = metrics(after, marks)
  const im = chosen.reduce((a, h) => a + h.im, 0)

  const go = (h) => {
    const g = h.go
    setPrefill(g.prefill || null)
    if (g.focus) setFocus(g.focus)
    setTab(g.tab)
  }
  const exportCsv = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCsv(lines)], { type: 'text/csv' })); a.download = `${me.name.replace(/\s/g, '-').toLowerCase()}-exposure.csv`; a.click() }

  return (
    <div className="stack hedge">
      <div className="row between">
        <div>
          <h1>Exposure</h1>
          <p className="sub">Tell us the compute you've committed to and the compute you'll need{kind === 'provider' ? ' or sell' : ''}. We show where a move in GPU rates hurts you and the trades that hedge it.</p>
        </div>
        <div className="row">
          {lines.length > 0 && <button className="btn ghost" onClick={exportCsv}>Export CSV</button>}
          <button className="btn" onClick={() => setImporting(!importing)}>{importing ? 'Hide import' : '+ Add exposure'}</button>
        </div>
      </div>

      {importing && <Importer kind={kind} onClose={() => setImporting(false)} onAdd={(rows, replace) => { setLines(replace ? rows : [...lines, ...rows]); setImporting(false); setSel(null) }} />}

      {!all.length ? (
        <Panel>
          <div className="empty">
            <b>No exposure yet</b>
            <p className="note">Upload a CSV of your reserved and planned GPUs, add lines by hand, or load an example portfolio to see how hedging works.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn ghost" onClick={() => setLines(SAMPLES.end_user.map((l) => ({ ...l, src: 'Example' })))}>Example: AI lab (buyer)</button>
              <button className="btn ghost" onClick={() => setLines(SAMPLES.provider.map((l) => ({ ...l, src: 'Example' })))}>Example: GPU cloud (provider)</button>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <Panel>
            <div className="stats">
              <Stat k="Physical exposure" v={`${m0.gross.toLocaleString()}`} sub="GPU-months on the curve" />
              <Stat k="Hedged today" v={`${Math.round(m0.cover * 100)}%`} cls={m0.cover >= 0.5 ? 'up' : 'dn'} sub="offset by CDX futures" />
              <Stat k="At risk, ±10% rates" v={usdK(m0.risk)} cls="dn" sub="open exposure × mark × 10%" />
              <Stat k="With selected hedges" v={`${Math.round(m1.cover * 100)}%`} cls="cream" sub={`at risk ${usdK(m1.risk)}`} />
              <Stat k="Margin for hedges" v={usdK(im)} sub={`${chosen.length} trades selected`} />
            </div>
            {ex.beyond > 0 && <p className="note" style={{ marginTop: 12 }}>{ex.beyond.toLocaleString()} GPU-months fall after {monthLabel(MONTHS[MONTHS.length - 1])}, past the listed curve. Use a flex RFQ in Request to hedge those.</p>}
          </Panel>

          <Panel title="Where you're exposed" right={<div className="row"><span className="legend-i"><i className="sw dn-sw" />short: hurt if rates rise</span><span className="legend-i"><i className="sw up-sw" />long: hurt if rates fall</span><Seg small value={view} onChange={setView} options={[['before', 'Today'], ['after', 'After hedges']]} /></div>}>
            <Heatmap ex={ex} after={after} view={view} sel={sel} onSel={setSel} marks={marks} />
            {sel ? <CellDetail k={sel.k} i={sel.i} ex={ex} after={after} lines={all} marks={marks} /> : <p className="note" style={{ marginTop: 10 }}>Net GPUs per month after your physical contracts and CDX futures. Click a cell to see what makes it up.</p>}
          </Panel>

          <Panel title={`Hedge ideas · ${hedges.length}`} right={
            <label className="ratio">Hedge ratio <input type="range" min="0.25" max="1" step="0.05" value={ratio} onChange={(e) => setRatio(+e.target.value)} /> <b className="mono">{Math.round(ratio * 100)}%</b></label>
          }>
            {!hedges.length && <p className="note">Nothing to hedge at this ratio. You're within {Math.round((1 - ratio) * 100)}% of flat on every month.</p>}
            <div className="ideas">
              {hedges.map((h) => (
                <div key={h.id} className={'idea' + (off[h.title] ? ' off' : '')}>
                  <div className="row between">
                    <span className={'kind ' + KIND_CLS[h.kind]}>{h.kind}</span>
                    {!h.physical && <label className="check"><input type="checkbox" checked={!off[h.title]} onChange={() => setOff({ ...off, [h.title]: !off[h.title] })} />In plan</label>}
                  </div>
                  <b className="idea-t">{h.title}</b>
                  <p className="note">{h.why}</p>
                  {h.legs.length > 0 && (
                    <div className="legs">
                      {[...new Set(h.legs.map((l) => l.sym))].slice(0, 6).map((s) => <span key={s} className="chip">{s}</span>)}
                      {new Set(h.legs.map((l) => l.sym)).size > 6 && <span className="chip">+{new Set(h.legs.map((l) => l.sym)).size - 6}</span>}
                    </div>
                  )}
                  <div className="idea-kv">
                    {h.px != null && <div><span>{h.pxLabel}</span><b>{h.px >= 0 || h.kind !== 'Spread' ? '$' : '-$'}{fmt(Math.abs(h.px))}</b></div>}
                    <div><span>{h.physical ? 'GPUs' : 'Per month'}</span><b>{h.qty}</b></div>
                    {h.legs.length > 0 && <div><span>Covers</span><b>{(h.qty * h.n).toLocaleString()} GPU-mo</b></div>}
                    {h.im > 0 && <div><span>Margin</span><b>{usdK(h.im)}</b></div>}
                  </div>
                  <div className="row">
                    <button className="btn" onClick={() => go(h)}>{h.go.label} →</button>
                    {h.legs.length > 0 && h.kind !== 'Block RFQ' && <button className="btn ghost" onClick={() => setPlacing(h)}>Place now</button>}
                  </div>
                </div>
              ))}
            </div>
            <p className="note" style={{ marginTop: 12 }}>Ideas are sized to hedge {Math.round(ratio * 100)}% of each month's open exposure, rounded to whole nodes (8 GPUs). Example data and assumed margin ({'15%'} of notional, spreads at half). Not advice.</p>
          </Panel>

          <Panel title={`Your exposure lines · ${all.length}`} right={<button className="link" onClick={() => setImporting(true)}>+ Add</button>}>
            <div className="tw"><table className="dense">
              <thead><tr><th>Type</th><th>GPU</th><th>Region</th><th>Period</th><th className="n">GPUs</th><th className="n">$/GPU-hr</th><th>Counterparty / notes</th><th>Source</th><th></th></tr></thead>
              <tbody>
                {all.map((l, i) => {
                  const t = TYPES[l.type], li = i - cdx.length
                  const per = period(l.start, l.months)
                  return (
                    <tr key={i}>
                      <td><span className={'sgn ' + (t.side < 0 ? 'dn' : t.side > 0 ? 'up-b' : 'muted')}>{t.side < 0 ? '−' : t.side > 0 ? '+' : '○'}</span> {t.label}</td>
                      <td>{l.sku}</td><td>{l.region}</td><td>{per}</td>
                      <td className="n">{l.gpus.toLocaleString()}</td><td className="n">{l.price ? fmt(l.price) : '–'}</td>
                      <td className="note">{[l.cp, l.notes].filter(Boolean).join(' · ')}</td>
                      <td><span className={'chip' + (l.src === 'CDX' ? ' accent' : '')}>{l.src}</span></td>
                      <td>{!l.locked && <button className="link" onClick={() => setLines(lines.filter((_, x) => x !== li))}>Remove</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
            <p className="note" style={{ marginTop: 8 }}>Lines marked CDX come from your Node-Month Contracts and update on their own. Futures positions are read live from your account.</p>
          </Panel>
        </>
      )}
      {placing && <PlaceNow h={placing} marks={marks} placeOrder={placeOrder} onClose={() => setPlacing(null)} onDone={() => setPlacing(null)} />}
    </div>
  )
}
