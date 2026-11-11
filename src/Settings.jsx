import React, { useState } from 'react'
import { INSTRUMENTS, SIZE, IM_RATE, fmt } from './data.js'
import { Panel, Seg, saveCsv } from './ui.jsx'
import { ApiKeys } from './Integrate.jsx'

const SECTIONS = [['profile', 'Profile & security'], ['appearance', 'Appearance'], ['alerts', 'Notifications & alerts'], ['trading', 'Trading preferences'], ['keys', 'API keys'], ['reports', 'Reports & exports']]
const CHANNELS = ['In-app', 'Email', 'SMS', 'Webhook']
const EVENTS = [
  ['fill', 'Order filled', 'In-app Email'], ['partial', 'Partial fill', 'In-app'], ['cancel', 'Order cancelled or expired', 'In-app'],
  ['rfq', 'New response to my request', 'In-app Email'], ['traded', 'Request awarded or traded', 'In-app Email'], ['inbox', 'New request I can quote', 'In-app'],
  ['margin', 'Margin usage above threshold', 'In-app Email SMS'], ['settle', 'Daily settlement prices', 'Email'], ['ltd', 'Last trading day approaching', 'In-app Email'],
  ['delivery', 'Delivery milestones', 'In-app Email'], ['verify', 'Clear Verified check failed', 'In-app Email SMS'],
]

function load(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } }

export default function Settings({ me, acct, marks, keys, setKeys, theme, setTheme, requests, spreads, contracts, session }) {
  const [sec, setSec] = useState('appearance')
  const [density, setDensity] = useState(() => load('cdx-density', 'Comfortable'))
  const [matrix, setMatrix] = useState(() => load('cdx-alerts', Object.fromEntries(EVENTS.map(([k, , d]) => [k, d.split(' ')]))))
  const [threshold, setThreshold] = useState(() => load('cdx-margin-threshold', 80))
  const [quiet, setQuiet] = useState(() => load('cdx-quiet', true))
  const [alerts, setAlerts] = useState(() => load('cdx-price-alerts', [{ id: 1, sym: INSTRUMENTS[5].sym, dir: 'above', px: 3.0 }]))
  const [na, setNa] = useState({ sym: INSTRUMENTS[5].sym, dir: 'below', px: '' })
  const [skip, setSkip] = useState(() => { try { return localStorage.getItem('cdx-skip-review') === '1' } catch { return false } })
  const [prefs, setPrefs] = useState(() => load('cdx-trade-prefs', { qty: 16, tif: 'GTC', confirmLarge: true, guided: false }))
  const [range, setRange] = useState('MTD')
  const [sent, setSent] = useState(null)
  const [scheduled, setScheduled] = useState(() => load('cdx-scheduled', { daily: true, monthly: true }))

  const toggle = (k, c) => { const cur = matrix[k] || []; const next = { ...matrix, [k]: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] }; setMatrix(next); save('cdx-alerts', next) }
  const setP = (p) => { setPrefs(p); save('cdx-trade-prefs', p) }
  const addAlert = () => { if (!na.px) return; const next = [...alerts, { id: Date.now(), ...na, px: Number(na.px) }]; setAlerts(next); save('cdx-price-alerts', next); setNa({ ...na, px: '' }) }
  const delAlert = (id) => { const next = alerts.filter((a) => a.id !== id); setAlerts(next); save('cdx-price-alerts', next) }

  const reports = [
    ['blotter', 'Trade blotter', 'Every fill with order ID, venue and clearing status.', () => [['time', 'fill_id', 'order_id', 'contract', 'side', 'qty', 'price', 'venue', 'status'], ...acct.fills.map((f) => [f.ts, f.id, f.order || '', f.sym, f.side, f.qty, f.px, f.venue, f.status])]],
    ['positions', 'Positions and margin', 'Open positions at mark, unrealised P&L and initial margin.', () => [['contract', 'qty', 'gpu_hours', 'avg', 'mark', 'unrealised_pnl', 'initial_margin'], ...Object.entries(acct.positions).map(([k, p]) => [k, p.qty, p.qty * SIZE, fmt(p.avg), fmt(marks[k]), Math.round(p.qty * SIZE * (marks[k] - p.avg)), Math.round(Math.abs(p.qty) * SIZE * marks[k] * IM_RATE)])]],
    ['closed', 'Closed and settled', 'Realised P&L by close, EFP and final settlement.', () => [['date', 'contract', 'qty', 'entry', 'exit', 'realised_pnl', 'how'], ...acct.closed.map((c) => [c.date, c.sym, c.qty, fmt(c.entry), fmt(c.exit), Math.round(c.qty * SIZE * (c.exit - c.entry)), c.how])]],
    ['requests', 'Requests and quotes', 'Your RFQs, EFPs and spread requests with every response.', () => [['id', 'kind', 'detail', 'status', 'responses'], ...requests.filter((r) => r.owner === session).map((r) => [r.id, r.kind, `${r.sku} x ${r.gpus} ${r.start} ${r.term}mo`, r.status, r.quotes.length]), ...spreads.filter((x) => x.owner === session).map((x) => [x.id, 'Spread', `${x.side} ${x.a} / ${x.b} x ${x.qty}`, x.status, x.quotes.length])]],
    ['delivery', 'Delivery and attestation', 'Node-Month Contracts, Clear Verified results and monthly settlements.', () => [['contract', 'sku', 'gpus', 'months', 'price', 'provider', 'stage', 'month', 'uptime'], ...contracts.filter((c) => c.buyer === me.name || c.provider === me.name).map((c) => [c.id, c.sku, c.gpus, c.months, fmt(c.price, 3), c.provider, c.stage, c.month, c.uptime])]],
  ]
  const download = async (r) => { const st = await saveCsv(`cdx-${r[0]}-${range.toLowerCase()}.csv`, r[3]()); setSent(st === 'saved' ? r[1] : st) }

  return (
    <div className="stack">
      <div><h1>Settings</h1><p className="sub">{me.name} · {me.user} · clearing via {me.fcm}</p></div>
      <div className="settings">
        <nav className="snav">{SECTIONS.map(([k, l]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>{l}</button>)}</nav>
        <div className="stack">
          {sec === 'profile' && (
            <Panel title="Profile & security">
              <div className="kv"><span>Name</span><b>{me.user}</b></div>
              <div className="kv"><span>Email</span><b>{me.email}</b></div>
              <div className="kv"><span>Entity</span><b>{me.name} · KYC verified</b></div>
              <div className="kv"><span>Clearing</span><b>{me.fcm}</b></div>
              <div className="kv"><span>Two-factor</span><b className="up">Authenticator app · on</b></div>
              <div className="kv"><span>Passkey</span><b>1 registered</b></div>
              <div className="kv"><span>Active sessions</span><b>2 · <button className="link">Sign out others</button></b></div>
            </Panel>
          )}

          {sec === 'appearance' && (
            <Panel title="Appearance">
              <div className="srow"><div><b>Theme</b><div className="note">Dark suits a trading desk; light is easier to present on a projector.</div></div>
                <Seg value={theme} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]} onChange={setTheme} /></div>
              <div className="srow"><div><b>Density</b><div className="note">Compact fits more rows in tables and the order book.</div></div>
                <Seg value={density} options={['Comfortable', 'Compact']} onChange={(d) => { setDensity(d); save('cdx-density', d); document.documentElement.dataset.density = d.toLowerCase() }} /></div>
              <div className="theme-prev"><div className="tp dark"><i /><i /><i /></div><div className="tp light"><i /><i /><i /></div></div>
            </Panel>
          )}

          {sec === 'alerts' && (
            <>
              <Panel title="Notifications" right={<span className="note">Choose where each event reaches you</span>}>
                <div className="tw"><table className="dense matrix">
                  <thead><tr><th>Event</th>{CHANNELS.map((c) => <th key={c} className="c">{c}</th>)}</tr></thead>
                  <tbody>{EVENTS.map(([k, l]) => (
                    <tr key={k}><td>{l}{k === 'margin' && <span className="note"> at <input className="mini-in" type="number" value={threshold} onChange={(e) => { setThreshold(Number(e.target.value)); save('cdx-margin-threshold', Number(e.target.value)) }} />% of limit</span>}</td>
                      {CHANNELS.map((c) => <td key={c} className="c"><input type="checkbox" aria-label={`${l} by ${c}`} checked={(matrix[k] || []).includes(c)} onChange={() => toggle(k, c)} /></td>)}</tr>
                  ))}</tbody>
                </table></div>
                <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={quiet} onChange={() => { setQuiet(!quiet); save('cdx-quiet', !quiet) }} />Quiet hours 22:00–07:00 (margin and Clear Verified alerts still come through)</label>
              </Panel>
              <Panel title="Price alerts">
                {alerts.map((a) => <div key={a.id} className="row between srow"><span><b className="mono">{a.sym}</b> {a.dir} <b className="mono cream">{fmt(a.px)}</b> <span className="note">now {fmt(marks[a.sym])}</span></span><button className="chip-btn" onClick={() => delAlert(a.id)}>Remove</button></div>)}
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <select className="mini" value={na.sym} onChange={(e) => setNa({ ...na, sym: e.target.value })}>{INSTRUMENTS.map((i) => <option key={i.sym}>{i.sym}</option>)}</select>
                  <select className="mini" value={na.dir} onChange={(e) => setNa({ ...na, dir: e.target.value })}><option>above</option><option>below</option></select>
                  <input className="mini-in wide" placeholder={fmt(marks[na.sym])} value={na.px} onChange={(e) => setNa({ ...na, px: e.target.value })} />
                  <button className="btn" onClick={addAlert}>Add alert</button>
                </div>
              </Panel>
            </>
          )}

          {sec === 'trading' && (
            <Panel title="Trading preferences">
              <div className="srow"><div><b>Review step before sending</b><div className="note">Shows fills, slippage and margin before an order goes out.</div></div>
                <Seg value={skip ? 'off' : 'on'} options={[['on', 'On'], ['off', 'Skip']]} onChange={(v) => { setSkip(v === 'off'); try { localStorage.setItem('cdx-skip-review', v === 'off' ? '1' : '0') } catch { /* storage unavailable */ } }} /></div>
              <div className="srow"><div><b>Always confirm large orders</b><div className="note">Even with review skipped, confirm orders that would slip more than 3 ticks.</div></div>
                <Seg value={prefs.confirmLarge ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => setP({ ...prefs, confirmLarge: v === 'on' })} /></div>
              <div className="srow"><div><b>Default size</b><div className="note">Contracts. One contract is 730 GPU-hours.</div></div>
                <input className="mini-in wide" type="number" value={prefs.qty} onChange={(e) => setP({ ...prefs, qty: Number(e.target.value) })} /></div>
              <div className="srow"><div><b>Default time in force</b></div><Seg value={prefs.tif} options={['GTC', 'Day', 'IOC']} onChange={(v) => setP({ ...prefs, tif: v })} /></div>
              <div className="srow"><div><b>Guided mode</b> <span className="chip">coming next</span><div className="note">Plain-language tickets in GPUs and months for first-time hedgers.</div></div>
                <Seg value={prefs.guided ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => setP({ ...prefs, guided: v === 'on' })} /></div>
            </Panel>
          )}

          {sec === 'keys' && <ApiKeys keys={keys} setKeys={setKeys} />}

          {sec === 'reports' && (
            <>
              <Panel title="Download reports" right={<Seg small value={range} options={['Today', 'MTD', 'YTD', 'All']} onChange={setRange} />}>
                <div className="reports">
                  {reports.map((r) => (
                    <div key={r[0]} className="report"><div><b>{r[1]}</b><div className="note">{r[2]}</div></div><button className="btn ghost" onClick={() => download(r)}>CSV ↓</button></div>
                  ))}
                </div>
                {sent && sent !== 'declined' && <div className={'callout ' + (sent === 'blocked' ? '' : 'good')} style={{ marginTop: 12 }}>{sent === 'blocked' ? 'Downloads are not available in this view. Open the prototype in a browser tab to save CSVs.' : `${sent} saved (${range}).`}</div>}
                <p className="note">Official monthly statements and tax forms come from your FCM ({me.fcm}). These are exchange-side records.</p>
              </Panel>
              <Panel title="Scheduled reports">
                <label className="check"><input type="checkbox" checked={scheduled.daily} onChange={() => { const n = { ...scheduled, daily: !scheduled.daily }; setScheduled(n); save('cdx-scheduled', n) }} />Daily: blotter and positions by email after settlement (17:00 ET)</label>
                <label className="check"><input type="checkbox" checked={scheduled.monthly} onChange={() => { const n = { ...scheduled, monthly: !scheduled.monthly }; setScheduled(n); save('cdx-scheduled', n) }} />Monthly: closed and settled, delivery and attestation</label>
                <label className="check"><input type="checkbox" defaultChecked={false} />Also deliver to SFTP for the back office</label>
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
