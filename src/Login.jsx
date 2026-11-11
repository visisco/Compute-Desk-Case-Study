import React, { useEffect, useRef, useState } from 'react'
import { ACCOUNTS } from './data.js'
import { Logo } from './ui.jsx'

// Sign in -> two-factor -> choose account. Any code works in the prototype.
export default function Login({ onDone }) {
  const [step, setStep] = useState(0)
  const [email, setEmail] = useState('priya@northwind.ai')
  const [pw, setPw] = useState('••••••••••••')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [busy, setBusy] = useState(false)
  const refs = useRef([])

  useEffect(() => { if (step === 1) refs.current[0]?.focus() }, [step])

  const go = (n, wait = 500) => { setBusy(true); setTimeout(() => { setBusy(false); setStep(n) }, wait) }
  const typeCode = (i, v) => {
    const d = v.replace(/\D/g, '').slice(-1)
    const next = [...code]; next[i] = d; setCode(next)
    if (d && i < 5) refs.current[i + 1]?.focus()
    if (d && i === 5) go(2, 600)
  }
  const autofill = () => { setCode(['4', '8', '1', '5', '2', '9']); go(2, 600) }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 26 }}><Logo /><span>Compute Desk Exchange</span></div>
        <ol className="login-steps">
          {['Sign in', 'Verify', 'Account'].map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>{s}</li>)}
        </ol>

        {step === 0 && (
          <form onSubmit={(e) => { e.preventDefault(); go(1) }} className="stack" style={{ gap: 14 }}>
            <h1>Sign in</h1>
            <p className="note" style={{ marginTop: -6 }}>Trade compute futures, request capacity, and track delivery.</p>
            <label>Work email<input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
            <div className="or"><span>or</span></div>
            <button type="button" className="btn ghost" onClick={() => go(1)}>Continue with SSO (Okta, Google Workspace)</button>
            <button type="button" className="btn ghost" onClick={() => go(1)}>Use a passkey</button>
          </form>
        )}

        {step === 1 && (
          <div className="stack" style={{ gap: 14 }}>
            <h1>Two-factor check</h1>
            <p className="note" style={{ marginTop: -6 }}>Enter the 6-digit code from your authenticator for {email}.</p>
            <div className="otp">
              {code.map((d, i) => (
                <input key={i} ref={(el) => (refs.current[i] = el)} inputMode="numeric" value={d} onChange={(e) => typeCode(i, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Backspace' && !d && i) refs.current[i - 1]?.focus() }} aria-label={`Digit ${i + 1}`} />
              ))}
            </div>
            <button className="btn" disabled={busy} onClick={autofill}>{busy ? 'Verifying…' : 'Verify'}</button>
            <span className="hint">Prototype: any code works.</span>
          </div>
        )}

        {step === 2 && (
          <div className="stack" style={{ gap: 12 }}>
            <h1>Choose an account</h1>
            <p className="note" style={{ marginTop: -6 }}>Your login has access to these entities. Each one is a different participant type.</p>
            {Object.entries(ACCOUNTS).map(([k, a]) => (
              <button key={k} className="acct-pick" onClick={() => onDone(k)}>
                <span className="avatar">{a.initials}</span>
                <span style={{ flex: 1, textAlign: 'left' }}><b>{a.name}</b><small>{a.type} · clears via {a.fcm}</small></span>
                <span className="pill good">KYC verified</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="note" style={{ textAlign: 'center' }}>Prototype · example data · not a live venue</p>
    </div>
  )
}
