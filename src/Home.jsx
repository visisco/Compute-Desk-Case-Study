import React from 'react'
import { SKUS, MONTHS, SIZE, IM_RATE, NEWS, sym, fmt, usd, usdK, skuOf } from './data.js'
import { candles, stats24 } from './market.js'
import { Panel, Stat, Spark } from './ui.jsx'

const STAGES = ['Signed', 'Escrow funded', 'Bond posted', 'Nodes handed over', 'Accepted', 'Live']

export default function Home({ me, session, acct, marks, contracts, requests, setTab, setFocus, setPrefill }) {
  const rows = Object.entries(acct.positions).map(([k, p]) => ({ k, ...p, mark: marks[k], pnl: p.qty * SIZE * (marks[k] - p.avg), notional: Math.abs(p.qty) * SIZE * marks[k] }))
  const upnl = rows.reduce((a, r) => a + r.pnl, 0)
  const im = rows.reduce((a, r) => a + r.notional * IM_RATE, 0)
  const mine = contracts.filter((c) => c.buyer === me.name || c.provider === me.name)
  const escrow = mine.filter((c) => c.buyer === me.name && c.stage >= 1).reduce((a, c) => a + c.gpus * SIZE * c.price, 0)
  const bonds = mine.filter((c) => c.provider === me.name && c.stage >= 2).reduce((a, c) => a + c.gpus * SIZE * c.price, 0)
  const equity = acct.cash + upnl
  const excess = equity - im
  const hedged = rows.reduce((a, r) => a + r.qty * SIZE, 0)
  const total = im + Math.max(excess, 0) + escrow + bonds
  const openReq = requests.filter((r) => r.status === 'open' && (me.kind === 'provider' ? r.owner !== session : r.owner === session))

  const insight = {
    end_user: { t: `Your H100 Jun–Nov 2027 hedge is ${usd(rows.filter((r) => skuOf(r.k) === 'H100').reduce((a, r) => a + r.pnl, 0))} in the money.`, b: 'Convert it to physical GPUs now to lock the basis before the providers re-price.', cta: 'Convert to Physical', go: () => { setPrefill({ kind: 'EFP', at: Date.now() }); setTab('convert') } },
    provider: { t: `${openReq.length} open requests match your H100 and B200 inventory.`, b: 'One is an EFP where the buyer will take your short futures hedge off your hands.', cta: 'Quote the EFP', go: () => setTab('convert') },
    spec: { t: `B200 Mar/Sep 2027 calendar spread at ${fmt(marks[sym('B200', 'SEP27')] - marks[sym('B200', 'MAR27')])}.`, b: 'Contango is widening as Blackwell supply tightens into H2 2027.', cta: 'Open Trade', go: () => { setFocus(sym('B200', 'MAR27')); setTab('trade') } },
    mm: { t: 'Quoting uptime today: 98.7% vs a 95% obligation. Rebate tier 2 is on track.', b: 'H100 Jan 2027 spread is 2 ticks wide; obligation is 4 ticks maximum.', cta: 'Open Integrate', go: () => setTab('integrate') },
  }[me.kind]

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Good morning, {me.user.split(' ')[0]}</h1>
          <p className="sub">{me.name} · {me.type} · clears via {me.fcm}</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => setTab('request')}>{me.kind === 'provider' ? 'Quote requests' : 'Request capacity'}</button>
          <button className="btn" onClick={() => setTab('trade')}>Trade</button>
        </div>
      </div>

      <div className="grid-home">
        <Panel title="Account overview">
          <div className="stats">
            <Stat k="Equity" v={usdK(equity)} cls="cream" />
            <Stat k="Unrealised P&L" v={usd(upnl)} cls={upnl >= 0 ? 'up' : 'dn'} />
            <Stat k="Net GPU-hrs hedged" v={hedged.toLocaleString()} />
            <Stat k="Open positions" v={rows.length} />
          </div>
          <div className="eyebrow" style={{ marginTop: 22 }}>Collateral</div>
          <div className="cbar">
            <i style={{ width: `${(im / total) * 100}%`, background: '#e8e2b9' }} title="Initial margin" />
            <i style={{ width: `${(Math.max(excess, 0) / total) * 100}%`, background: '#3a3936' }} title="Excess" />
            <i style={{ width: `${(escrow / total) * 100}%`, background: '#8fa9d6' }} title="Escrow" />
            <i style={{ width: `${(bonds / total) * 100}%`, background: '#7cc59a' }} title="Bonds" />
          </div>
          <div className="legend">
            <span><b style={{ background: '#e8e2b9' }} />Initial margin at FCM <em>{usd(im)}</em></span>
            <span><b style={{ background: '#3a3936' }} />Excess (withdrawable) <em>{usd(excess)}</em></span>
            <span><b style={{ background: '#8fa9d6' }} />Clear Escrow (buyer) <em>{usd(escrow)}</em></span>
            <span><b style={{ background: '#7cc59a' }} />Performance bonds <em>{usd(bonds)}</em></span>
          </div>
          <p className="note" style={{ marginBottom: 0 }}>Futures margin sits with your FCM and the DCO. Escrow and bonds sit with the escrow agent. Compute Desk Exchange holds neither.</p>
        </Panel>

        <Panel title="For you" right={<span className="meth">Insight</span>}>
          <div className="stack" style={{ gap: 10 }}>
            <b style={{ fontSize: 17, fontWeight: 600 }}>{insight.t}</b>
            <span className="note">{insight.b}</span>
            <div><button className="btn" onClick={insight.go}>{insight.cta} →</button></div>
          </div>
          <div className="eyebrow" style={{ marginTop: 22 }}>Account status</div>
          <div className="stack" style={{ gap: 7 }}>
            {['KYC / KYB verified', `FCM linked: ${me.fcm}`, me.kind === 'provider' ? 'Clear Verified agent on 48 nodes' : me.kind === 'mm' ? 'FIX certified, MM agreement active' : 'Escrow account open', 'API keys active'].map((x) => (
              <div key={x} className="row between"><span>{x}</span><span className="pill good">ok</span></div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Compute Signal indexes and front futures" right={<span className="meth">Signal Settlement methodology</span>}>
        <div className="prices">
          {Object.entries(SKUS).map(([k, s]) => {
            const f = sym(k, 'DEC26')
            const pts = candles(f, marks[f], '1M').map((c) => c.c)
            const st = stats24(f, marks[f])
            return (
              <button key={k} className="price-card" onClick={() => { setFocus(f); setTab('trade') }}>
                <div className="row between"><span className="eyebrow" style={{ margin: 0 }}>{k} · 1Y US index</span><span className={s.chg >= 0 ? 'up mono' : 'dn mono'}>{s.chg >= 0 ? '+' : ''}{s.chg}% 90d</span></div>
                <div className="big">${s.index.toFixed(2)}</div>
                <Spark pts={pts} w={220} h={44} />
                <div className="row between note"><span>{f} {fmt(marks[f])}</span><span className={st.chg >= 0 ? 'up' : 'dn'}>{st.chg >= 0 ? '+' : ''}{st.chg.toFixed(2)}% 24h</span></div>
              </button>
            )
          })}
        </div>
      </Panel>

      <div className="grid-home">
        <Panel title="Positions" right={<button className="link" onClick={() => setTab('trade')}>All in Trade →</button>}>
          {rows.length ? (
            <div className="tw"><table>
              <thead><tr><th>Contract</th><th className="n">Qty</th><th className="n">Avg</th><th className="n">Mark</th><th className="n">P&L</th></tr></thead>
              <tbody>{rows.sort((a, b) => b.notional - a.notional).slice(0, 6).map((r) => (
                <tr key={r.k} className="click" onClick={() => { setFocus(r.k); setTab('trade') }}><td>{r.k}</td><td className={'n ' + (r.qty > 0 ? 'up' : 'dn')}>{r.qty > 0 ? '+' : ''}{r.qty}</td><td className="n">{fmt(r.avg)}</td><td className="n">{fmt(r.mark)}</td><td className={'n ' + (r.pnl >= 0 ? 'up' : 'dn')}>{usd(r.pnl)}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="note">No open positions.</p>}
          {(me.kind === 'end_user' || me.kind === 'provider') && (
            <>
              <div className="eyebrow" style={{ marginTop: 18 }}>Node-Month Contracts</div>
              {mine.length ? mine.slice(0, 4).map((c) => (
                <div key={c.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span>{c.id} · {c.sku} × {c.gpus} · {c.via}</span>
                  <span className="pill good">{c.stage === 5 ? `Live · month ${c.month}/${c.months}` : STAGES[c.stage]}</span>
                </div>
              )) : <p className="note">None yet.</p>}
            </>
          )}
        </Panel>

        <Panel title="Market developments">
          <div className="stack" style={{ gap: 14 }}>
            {NEWS.map((n) => (
              <div key={n.head} className="news">
                <div className="row" style={{ gap: 8 }}><span className="chip">{n.tag}</span><span className="note">{n.t} ago</span></div>
                <b>{n.head}</b>
                <span className="note">{n.body}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
