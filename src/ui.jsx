import React from 'react'

export const Stat = ({ k, v, cls, sub }) => (
  <div className="stat"><div className="k">{k}</div><div className={'v ' + (cls || '')}>{v}</div>{sub && <div className="note">{sub}</div>}</div>
)

export const Steps = ({ items, at, bad }) => (
  <ol className="steps">
    {items.map((s, i) => <li key={s} className={bad === i ? 'bad' : i < at ? 'done' : i === at ? 'now' : ''}>{s}</li>)}
  </ol>
)

export const Seg = ({ value, options, onChange, small }) => (
  <div className={'seg' + (small ? ' small' : '')}>
    {options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o]
      return <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
    })}
  </div>
)

export function Spark({ pts, w = 120, h = 34, color }) {
  const lo = Math.min(...pts), hi = Math.max(...pts)
  const X = (i) => (i / (pts.length - 1)) * w
  const Y = (v) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)
  const up = pts[pts.length - 1] >= pts[0]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline fill="none" stroke={color || (up ? '#7cc59a' : '#e2806f')} strokeWidth="1.5" points={pts.map((p, i) => `${X(i)},${Y(p)}`).join(' ')} />
    </svg>
  )
}

export const Panel = ({ title, right, children, className, style }) => (
  <section className={'panel ' + (className || '')} style={style}>
    {(title || right) && <h2><span>{title}</span>{right}</h2>}
    {children}
  </section>
)

export const Logo = () => (
  <svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3c4 1 7 3 9 6l5-2-3 4c1 3 1 6 0 10-2-4-4-6-7-7l-4 2 2-4C5 10 4 7 5 3z" /></svg>
)

// Save a CSV. Inside a claude.ai artifact the viewer confirms through the downloads capability;
// in a normal browser tab it falls back to a plain download.
export async function saveCsv(filename, rows) {
  const body = rows.map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')
  let dl = null
  try { dl = window.claude?.use ? await window.claude.use('downloads') : null } catch { dl = null }
  if (dl) {
    try { await dl.save({ filename, data: body }); return 'saved' } catch (e) { return e?.code === 'declined' ? 'declined' : 'blocked' }
  }
  try {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
    a.download = filename
    a.click()
    return 'saved'
  } catch { return 'blocked' }
}
