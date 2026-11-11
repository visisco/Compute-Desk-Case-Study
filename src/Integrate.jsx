import React, { useState } from 'react'
import { SIZE, TICK, fmt, sym } from './data.js'
import { Panel, Seg } from './ui.jsx'

const SCOPES = ['read:market', 'read:account', 'trade:futures', 'request:rfq', 'request:efp', 'delivery:attest']

export default function Integrate({ me, marks, feed }) {
  const [env, setEnv] = useState('Test')
  const [ch, setCh] = useState(me.kind === 'mm' || me.kind === 'spec' ? 'FIX' : 'REST')
  const [keys, setKeys] = useState([
    { id: 'ak_live_7f3c', name: me.kind === 'mm' ? 'Quoting engine' : 'Treasury system', scopes: ['read:market', 'read:account', 'trade:futures'], env: 'Production', created: '2026-09-02', last: '2 min ago' },
    { id: 'ak_test_19ab', name: 'Sandbox', scopes: SCOPES.slice(0, 4), env: 'Test', created: '2026-08-14', last: '3 days ago' },
  ])
  const [form, setForm] = useState(null)
  const [secret, setSecret] = useState(null)
  const s = sym('H100', 'JUN27'), px = fmt(marks[s])
  const host = env === 'Test' ? 'api.test.cdx.example' : 'api.cdx.example'

  const code = {
    REST: `POST https://${host}/v1/orders
Authorization: Bearer <api_key>   X-Signature: <hmac>   Idempotency-Key: 7f3c…
{ "symbol": "${s}", "side": "buy", "qty": 16, "type": "limit", "price": ${px}, "tif": "GTC" }
→ 201 { "order_id": "O-88213", "status": "filled", "fill_px": ${px}, "gpu_hrs": ${16 * SIZE} }

POST /v1/requests            { "kind": "efp", "sku": "H100", "gpus": 64, "start": "JUN27",
                               "term_months": 6, "region": "US-East", "max_basis": 0.15 }
POST /v1/requests/{id}/quotes { "basis": 0.08 }                 # providers
POST /v1/requests/{id}/award  { "quote_id": "Q-551" }           # buyer
GET  /v1/contracts/PC-1042/delivery
→ { "stage": "live", "month": 2, "verified_gpu_hrs": 93440, "uptime_30d": 99.71 }`,
    WebSocket: `wss://${host}/v1/stream
→ { "op": "auth", "key": "ak_…", "sig": "…" }
→ { "op": "subscribe", "channels": ["book.${s}", "trades.H1UF*", "index.H100", "curve.H100"] }
← { "ch": "book.${s}", "type": "snapshot", "seq": 88190,
    "bids": [[${fmt(marks[s] - TICK)}, 40], …], "asks": [[${fmt(marks[s] + TICK)}, 32], …] }
← { "ch": "book.${s}", "type": "delta", "seq": 88191, "asks": [[${fmt(marks[s] + TICK)}, 24]] }

Private: orders · fills · positions · requests · quotes · delivery
Gap in seq → fetch snapshot, then replay deltas.`,
    FIX: `8=FIX.4.4|35=A|49=${me.initials}|56=CDX|98=0|108=30|141=Y|           Logon
8=FIX.4.4|35=i|117=Q-5521|296=1|302=H1UF|295=12|                 MassQuote
  299=1|55=${s}|132=${fmt(marks[s] - TICK)}|133=${fmt(marks[s] + TICK)}|134=40|135=40| …
8=FIX.4.4|35=R|131=QR-77|55=${s}|38=100|                          QuoteRequest (RFQ)
8=FIX.4.4|35=8|39=2|150=F|55=${s}|54=1|32=40|31=${px}|            ExecutionReport
8=FIX.4.4|35=AE|828=EFP|55=${s}|32=64|31=${px}|                   TradeCaptureReport

Session: cancel-on-disconnect · kill switch · drop copy to FCM`,
  }

  const create = () => {
    const id = (form.env === 'Test' ? 'ak_test_' : 'ak_live_') + Math.random().toString(16).slice(2, 6)
    setKeys([{ id, name: form.name || 'New key', scopes: form.scopes, env: form.env, created: '2026-11-11', last: 'never' }, ...keys])
    setSecret({ id, secret: 'sk_' + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('') })
    setForm(null)
  }

  return (
    <div className="stack">
      <div className="row between">
        <div><h1>Integrate</h1><p className="sub">Same matching engine and the same FCM risk limits on every channel. Certify in Test, then go live.</p></div>
        <Seg value={env} options={['Test', 'Production']} onChange={setEnv} />
      </div>

      <div className="grid2">
        <Panel title="API keys" right={<button className="btn" onClick={() => setForm({ name: '', scopes: ['read:market', 'read:account'], env, ip: '' })}>Create key</button>}>
          {secret && <div className="callout good" style={{ marginBottom: 12 }}>Key <b className="mono">{secret.id}</b> created. Copy the secret now; it won’t be shown again.<div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>{secret.secret}</div></div>}
          {form && (
            <div className="callout" style={{ marginBottom: 12 }}>
              <div className="form">
                <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Risk system" /></label>
                <label>Environment<select value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })}><option>Test</option><option>Production</option></select></label>
                <label className="full">IP allowlist (optional)<input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="203.0.113.0/24" /></label>
                <div className="full row" style={{ gap: 6 }}>{SCOPES.map((sc) => <label key={sc} className="check"><input type="checkbox" checked={form.scopes.includes(sc)} onChange={() => setForm({ ...form, scopes: form.scopes.includes(sc) ? form.scopes.filter((x) => x !== sc) : [...form.scopes, sc] })} />{sc}</label>)}</div>
                <div className="full row"><button className="btn" onClick={create}>Create</button><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
              </div>
            </div>
          )}
          <div className="tw"><table>
            <thead><tr><th>Key</th><th>Name</th><th>Scopes</th><th>Env</th><th>Last used</th><th></th></tr></thead>
            <tbody>{keys.map((k) => <tr key={k.id}><td className="mono">{k.id}</td><td>{k.name}</td><td className="note">{k.scopes.join(', ')}</td><td>{k.env}</td><td className="note">{k.last}</td><td><button className="chip-btn" onClick={() => setKeys(keys.filter((x) => x.id !== k.id))}>Revoke</button></td></tr>)}</tbody>
          </table></div>
        </Panel>

        <Panel title="Connectivity" right={<span className="pill good">all systems normal</span>}>
          <div className="stack" style={{ gap: 9 }}>
            {[['REST', `https://${host}/v1`, 'ok'], ['WebSocket', `wss://${host}/v1/stream`, 'ok'], ['FIX order entry', `fix.${env === 'Test' ? 'test.' : ''}cdx.example:9880`, me.kind === 'mm' || me.kind === 'spec' ? 'logged on' : 'not configured'], ['FIX drop copy (FCM)', `${me.fcm}`, 'ok'], ['Market data latency (p50)', '4 ms in-region', 'ok']].map(([a, b, c]) => (
              <div key={a} className="row between"><span>{a}<div className="note mono">{b}</div></span><span className={'pill ' + (c === 'not configured' ? 'muted' : 'good')}>{c}</span></div>
            ))}
          </div>
          {(me.kind === 'mm' || me.kind === 'spec') && <div className="callout" style={{ marginTop: 14 }}>FIX certification: <b>passed</b> in Test on 2026-10-28. Rate limit {me.kind === 'mm' ? '1,000' : '100'} msg/s.</div>}
        </Panel>
      </div>

      <div className="grid2">
        <Panel title="Quickstart" right={<Seg small value={ch} options={['REST', 'WebSocket', 'FIX']} onChange={setCh} />}>
          <pre className="code">{code[ch]}</pre>
        </Panel>
        <Panel title="Live stream" right={<span className="pill good">connected</span>}>
          <div className="feed">
            {feed.length === 0 && <span>Waiting for messages…</span>}
            {feed.map((m, i) => <span key={m.t + i}><b>{m.t}</b> {m.ch}</span>)}
          </div>
        </Panel>
      </div>

      <Panel title="Entitlements by participant type">
        <div className="tw"><table>
          <thead><tr><th>Participant</th><th>Channels</th><th>Scope</th><th className="n">Rate limit (assumed)</th></tr></thead>
          <tbody>{[['End user', 'UI + REST', 'Futures, RFQ, EFP, delivery records', '20 req/s'], ['Provider', 'UI + REST', 'RFQ and EFP quotes, inventory, Clear Verified attestation', '20 req/s'], ['Speculator', 'FIX / WebSocket / UI', 'Futures, spreads, block and flex RFQ', '100 msg/s'], ['Market maker', 'FIX + WebSocket', 'Mass quote, full depth, RFQ responses, drop copy', '1,000 msg/s']].map((e) => <tr key={e[0]} className={me.type === e[0] ? 'sel' : ''}><td>{e[0]}</td><td>{e[1]}</td><td>{e[2]}</td><td className="n">{e[3]}</td></tr>)}</tbody>
        </table></div>
      </Panel>
    </div>
  )
}
