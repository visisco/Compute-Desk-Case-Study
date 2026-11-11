import React, { useEffect, useMemo, useState } from 'react'
import { ROLES, TABS, SKUS, MONTHS, SEED_POSITIONS, SEED_CONTRACTS, curvePx, sym, roundTick, TICK } from './data.js'
import { Onboard, Markets, Trader, Efp, Delivery, Api } from './screens.jsx'

// One app, four ICPs. The role switcher changes which tabs show, the seeded positions,
// and the default screen. Market data is simulated locally (random walk around the curve).

export default function App() {
  const [role, setRole] = useState('end_user')
  const [tab, setTab] = useState(ROLES.end_user.home)
  const [positions, setPositions] = useState(SEED_POSITIONS)
  const [contracts, setContracts] = useState(SEED_CONTRACTS)
  const [onboardStep, setOnboardStep] = useState({ end_user: 4, provider: 4, spec: 3, mm: 3 })
  const [drift, setDrift] = useState({ H100: 0, H200: 0, B200: 0, B300: 0 })
  const [tick, setTick] = useState(0)
  const [feed, setFeed] = useState([])

  // Simulated market: small random walk per SKU, plus a WebSocket-style message feed.
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1)
      setDrift((d) => {
        const n = { ...d }
        for (const k of Object.keys(n)) {
          const r = Math.random(), step = r < 0.3 ? -TICK : r > 0.7 ? TICK : 0
          n[k] = Math.max(-0.08, Math.min(0.08, Math.round((n[k] + step) / TICK) * TICK))
        }
        return n
      })
    }, 1400)
    return () => clearInterval(t)
  }, [])

  const marks = useMemo(() => {
    const out = {}
    for (const sku of Object.keys(SKUS)) MONTHS.forEach((m, i) => (out[sym(sku, m)] = curvePx(sku, i, drift[sku])))
    return out
  }, [drift])

  useEffect(() => {
    if (!tick) return
    const sku = ['H100', 'B200', 'H100', 'B300'][tick % 4]
    const m = MONTHS[(tick * 5) % 12]
    const s = sym(sku, m)
    const px = marks[s]
    const kinds = [
      `{"ch":"book.${s}","bid":${(px - TICK).toFixed(3)},"ask":${(px + TICK).toFixed(3)},"seq":${88200 + tick}}`,
      `{"ch":"trades.${s}","px":${px.toFixed(3)},"qty":${8 + (tick % 5) * 8},"seq":${88200 + tick}}`,
      `{"ch":"curve.${sku}","pts":12,"front":${marks[sym(sku, 'DEC26')].toFixed(3)}}`,
    ]
    const msg = { t: new Date().toISOString().slice(11, 19), ch: kinds[tick % 3] }
    setFeed((f) => [msg, ...f].slice(0, 16))
  }, [tick])

  const switchRole = (r) => {
    setRole(r)
    setTab(ROLES[r].home)
  }

  const myPos = positions[role]
  const setMyPos = (fn) => setPositions((p) => ({ ...p, [role]: fn(p[role]) }))
  const addContract = (c) => setContracts((cs) => [c, ...cs])
  const updateContract = (id, fn) => setContracts((cs) => cs.map((c) => (c.id === id ? fn(c) : c)))

  const shared = { role, marks, drift, tick, myPos, setMyPos, contracts, addContract, updateContract, setTab, feed }

  return (
    <div className="app">
      <nav className="rail" aria-label="Compute Desk">
        <svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3c4 1 7 3 9 6l5-2-3 4c1 3 1 6 0 10-2-4-4-6-7-7l-4 2 2-4C5 10 4 7 5 3z" /></svg>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l5-6 4 3 7-9" /></svg>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8M8 14h5" /></svg>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /></svg>
        <span className="sp" />
        <span className="avatar">CD</span>
      </nav>
      <main className="wrap">
        <div className="top">
          <div>
            <div className="crumbs"><span>Exchange</span><i>/</i><span>{ROLES[role].who}</span><i>/</i><b>{TABS[tab]}</b></div>
            <h1>Compute Desk Exchange</h1>
            <p className="sub">One platform for GPU compute: trade cash-settled futures on Compute Signal indexes, or contract physical capacity with verified delivery. EFP connects the two.</p>
          </div>
          <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
            <span className="note">Viewing as</span>
            <div className="seg" role="tablist" aria-label="Participant type">
              {Object.entries(ROLES).map(([k, r]) => (
                <button key={k} className={role === k ? 'on' : ''} onClick={() => switchRole(k)}>{r.label}</button>
              ))}
            </div>
            <span className="tag">Prototype · example data</span>
          </div>
        </div>

        <div className="ticker" aria-label="Compute Signal indexes">
          {Object.entries(SKUS).map(([k, s]) => (
            <div className="tk" key={k}>
              <div className="k">{k} · 1Y US index</div>
              <div><span className="v">${s.index.toFixed(2)}</span><span className={'c ' + (s.chg.startsWith('-') ? 'dn' : 'up')}>{s.chg} 90d</span></div>
            </div>
          ))}
          <div className="tk">
            <div className="k">H100 front future</div>
            <div><span className="v" style={{ color: 'var(--fg)' }}>${marks['H100-DEC26'].toFixed(3)}</span></div>
          </div>
        </div>

        <div className="tabs" role="tablist">
          {ROLES[role].tabs.map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{TABS[t]}</button>
          ))}
        </div>

        {tab === 'onboard' && <Onboard {...shared} step={onboardStep[role]} setStep={(n) => setOnboardStep((s) => ({ ...s, [role]: n }))} />}
        {tab === 'markets' && <Markets {...shared} />}
        {tab === 'trader' && <Trader {...shared} />}
        {tab === 'efp' && <Efp {...shared} />}
        {tab === 'delivery' && <Delivery {...shared} />}
        {tab === 'api' && <Api {...shared} />}
      </main>
    </div>
  )
}

export { roundTick }
