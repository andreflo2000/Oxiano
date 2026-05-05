'use client'
import { useState, useEffect } from 'react'
import { login, register, getToken, logout, getUser } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/lib/LangContext'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://football-predictor-vlpp.onrender.com'

const TIER_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  free:    { label: 'Free',    color: '#9ca3af', bg: 'rgba(156,163,175,0.1)', border: 'rgba(156,163,175,0.2)' },
  analyst: { label: 'Analyst', color: '#22d3ee', bg: 'rgba(34,211,238,0.1)', border: 'rgba(34,211,238,0.25)' },
  pro:     { label: 'Pro',     color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
  vip:     { label: 'VIP',     color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
  owner:   { label: 'Owner',   color: '#f43f5e', bg: 'rgba(244,63,94,0.1)',  border: 'rgba(244,63,94,0.25)' },
}

type Mode = 'login' | 'register' | 'forgot' | 'reset'

export default function LoginPage() {
  const router = useRouter()
  const { lang } = useLang()
  const [mode, setMode]         = useState<Mode>('login')
  const [loggedIn, setLoggedIn] = useState(false)
  const [user, setUser]         = useState<ReturnType<typeof getUser>>(null)

  useEffect(() => {
    const u = getUser()
    setLoggedIn(!!getToken())
    setUser(u)
    if (getToken()) {
      fetch(`${API}/api/auth/notifications-consent`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
        .then(r => r.json())
        .then(d => setNotifConsent(!!d.notifications_consent))
        .catch(() => {})
    }
  }, [])

  const [email, setEmail]       = useState('')
  const [password, setPass]     = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Notificari email
  const [notifConsent, setNotifConsent] = useState(false)
  const [notifLoading, setNotifLoading] = useState(false)

  // Schimbare parola
  const [cpCurrent, setCpCurrent] = useState('')
  const [cpNew, setCpNew]         = useState('')
  const [cpMsg, setCpMsg]         = useState('')
  const [cpErr, setCpErr]         = useState('')
  const [cpLoading, setCpLoading] = useState(false)
  const [showCp, setShowCp]       = useState(false)

  // Forgot / Reset password
  const [forgotEmail, setForgotEmail]     = useState('')
  const [resetToken, setResetToken]       = useState('')
  const [resetPass, setResetPass]         = useState('')
  const [forgotMsg, setForgotMsg]         = useState('')
  const [forgotErr, setForgotErr]         = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setCpMsg(''); setCpErr('')
    setCpLoading(true)
    try {
      const r = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ current_password: cpCurrent, new_password: cpNew }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Eroare')
      setCpMsg(lang === 'en' ? 'Password changed successfully!' : 'Parola a fost schimbata cu succes!')
      setCpCurrent(''); setCpNew('')
    } catch (err: any) {
      setCpErr(err.message)
    } finally {
      setCpLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setForgotErr(''); setForgotMsg('')
    setForgotLoading(true)
    try {
      await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      })
      setForgotMsg(lang === 'en'
        ? 'If the email exists, you will receive a code shortly.'
        : 'Daca emailul exista, vei primi codul in cateva secunde.')
      setMode('reset')
    } catch {
      setForgotErr(lang === 'en' ? 'Error. Try again.' : 'Eroare. Incearca din nou.')
    } finally {
      setForgotLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setForgotErr(''); setForgotMsg('')
    setForgotLoading(true)
    try {
      const r = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, token: resetToken, new_password: resetPass }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Eroare')
      setForgotMsg(lang === 'en' ? 'Password reset! You can now sign in.' : 'Parola resetata! Te poti autentifica acum.')
      setTimeout(() => { setMode('login'); setForgotMsg('') }, 2000)
    } catch (err: any) {
      setForgotErr(err.message)
    } finally {
      setForgotLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
      router.push('/daily')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── CONT LOGAT ───────────────────────────────────────────────────────────
  if (loggedIn && user) {
    const tier = user.tier || 'free'
    const tl = TIER_LABELS[tier] || TIER_LABELS.free
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ background: '#1e293b', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '400px', border: '1px solid #334155' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>👤</div>
            <div style={{ color: '#f1f5f9', fontSize: '18px', fontWeight: 700 }}>{user.email}</div>
            <div style={{ marginTop: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 16px', borderRadius: '99px', background: tl.bg, border: `1px solid ${tl.border}` }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: tl.color, fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Plan: {tl.label}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Link href="/daily" style={{ display: 'block', textAlign: 'center', padding: '12px', borderRadius: '10px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
              🎯 {lang === 'en' ? 'Daily Picks' : 'Selectiile zilei'}
            </Link>
            {tier === 'free' && (
              <Link href="/upgrade" style={{ display: 'block', textAlign: 'center', padding: '12px', borderRadius: '10px', background: 'linear-gradient(90deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15))', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
                ⚡ {lang === 'en' ? 'Upgrade to Pro' : 'Upgrade la Pro'}
              </Link>
            )}
            <button onClick={() => setShowCp(v => !v)} style={{ padding: '12px', borderRadius: '10px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: '#60a5fa', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
              🔑 {lang === 'en' ? 'Change password' : 'Schimba parola'}
            </button>
            <button
              disabled={notifLoading}
              onClick={async () => {
                setNotifLoading(true)
                const next = !notifConsent
                try {
                  await fetch(`${API}/api/auth/notifications-consent`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                    body: JSON.stringify({ consent: next }),
                  })
                  setNotifConsent(next)
                } catch {}
                setNotifLoading(false)
              }}
              style={{ padding: '12px 16px', borderRadius: '10px', cursor: notifLoading ? 'not-allowed' : 'pointer', background: notifConsent ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${notifConsent ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`, color: notifConsent ? '#4ade80' : '#6b7280', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span>📧 {lang === 'en' ? 'Email notifications' : 'Notificari email'}</span>
              <span style={{ width: 36, height: 20, borderRadius: 10, background: notifConsent ? '#22c55e' : '#374151', position: 'relative', display: 'inline-block', transition: 'background 0.2s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: notifConsent ? 18 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </span>
            </button>
            <button onClick={() => { logout(); setLoggedIn(false); setUser(null); router.push('/') }} style={{ padding: '12px', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
              🚪 {lang === 'en' ? 'Sign out' : 'Iesire din cont'}
            </button>
            <button
              onClick={async () => {
                if (!confirm(lang === 'en' ? 'Are you sure? Your account and all data will be permanently deleted.' : 'Esti sigur? Contul si toate datele tale vor fi sterse permanent.')) return
                try {
                  await fetch(`${API}/api/auth/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } })
                  logout(); router.push('/')
                } catch { alert('Eroare. Contacteaza contact@oxiano.com') }
              }}
              style={{ color: '#475569', fontSize: '11px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace' }}
            >
              {lang === 'en' ? 'Delete account and all data' : 'Sterge contul si toate datele'}
            </button>
          </div>

          {showCp && (
            <form onSubmit={handleChangePassword} style={{ marginTop: '16px', background: '#0f172a', borderRadius: '10px', padding: '16px', border: '1px solid #1e3a5f' }}>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '4px' }}>{lang === 'en' ? 'Current password' : 'Parola curenta'}</label>
                <input type="password" value={cpCurrent} onChange={e => setCpCurrent(e.target.value)} required style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '4px' }}>{lang === 'en' ? 'New password' : 'Parola noua'}</label>
                <input type="password" value={cpNew} onChange={e => setCpNew(e.target.value)} required minLength={6} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              {cpErr && <div style={{ color: '#fca5a5', fontSize: '12px', marginBottom: '8px' }}>{cpErr}</div>}
              {cpMsg && <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>{cpMsg}</div>}
              <button type="submit" disabled={cpLoading} style={{ width: '100%', padding: '8px', borderRadius: '6px', background: '#3b82f6', color: '#fff', fontWeight: 700, fontSize: '13px', border: 'none', cursor: 'pointer' }}>
                {cpLoading ? '...' : (lang === 'en' ? 'Save' : 'Salveaza')}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  // ── FORGOT / RESET PASSWORD ──────────────────────────────────────────────
  if (mode === 'forgot' || mode === 'reset') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ background: '#1e293b', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '400px', border: '1px solid #334155' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '4px' }}>🔑</div>
            <div style={{ color: '#f1f5f9', fontSize: '20px', fontWeight: 700 }}>
              {lang === 'en' ? 'Reset password' : 'Resetare parola'}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
              {mode === 'forgot'
                ? (lang === 'en' ? 'Enter your email to receive a code' : 'Introdu emailul pentru a primi un cod')
                : (lang === 'en' ? 'Enter the code received by email' : 'Introdu codul primit pe email')}
            </div>
          </div>

          {mode === 'forgot' ? (
            <form onSubmit={handleForgot}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Email</label>
                <input
                  type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                  required placeholder="email@exemplu.com"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              {forgotErr && <div style={{ background: '#450a0a', border: '1px solid #991b1b', color: '#fca5a5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', marginBottom: '16px' }}>{forgotErr}</div>}
              {forgotMsg && <div style={{ background: '#052e16', border: '1px solid #166534', color: '#4ade80', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', marginBottom: '16px' }}>{forgotMsg}</div>}
              <button type="submit" disabled={forgotLoading} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#3b82f6', color: '#fff', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer', opacity: forgotLoading ? 0.7 : 1 }}>
                {forgotLoading ? '...' : (lang === 'en' ? 'Send code' : 'Trimite codul')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  {lang === 'en' ? 'Code (6 digits)' : 'Cod (6 cifre)'}
                </label>
                <input
                  type="text" value={resetToken} onChange={e => setResetToken(e.target.value)}
                  required maxLength={6} placeholder="123456"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: '28px', letterSpacing: '10px', textAlign: 'center', boxSizing: 'border-box', outline: 'none', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  {lang === 'en' ? 'New password' : 'Parola noua'}
                </label>
                <input
                  type="password" value={resetPass} onChange={e => setResetPass(e.target.value)}
                  required minLength={6}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              {forgotErr && <div style={{ background: '#450a0a', border: '1px solid #991b1b', color: '#fca5a5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', marginBottom: '16px' }}>{forgotErr}</div>}
              {forgotMsg && <div style={{ background: '#052e16', border: '1px solid #166534', color: '#4ade80', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', marginBottom: '16px' }}>{forgotMsg}</div>}
              <button type="submit" disabled={forgotLoading} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#3b82f6', color: '#fff', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer', opacity: forgotLoading ? 0.7 : 1 }}>
                {forgotLoading ? '...' : (lang === 'en' ? 'Reset password' : 'Reseteaza parola')}
              </button>
              <button type="button" onClick={() => setMode('forgot')} style={{ width: '100%', marginTop: '8px', padding: '10px', borderRadius: '8px', background: 'transparent', border: '1px solid #334155', color: '#64748b', fontSize: '13px', cursor: 'pointer' }}>
                {lang === 'en' ? 'Resend code' : 'Retrimite codul'}
              </button>
            </form>
          )}

          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button onClick={() => { setMode('login'); setForgotErr(''); setForgotMsg('') }} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer' }}>
              ← {lang === 'en' ? 'Back to sign in' : 'Inapoi la autentificare'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── LOGIN / REGISTER ─────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#1e293b', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '400px', border: '1px solid #334155' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '32px', marginBottom: '4px' }}>⚽</div>
          <div style={{ color: '#f1f5f9', fontSize: '20px', fontWeight: 700 }}>Oxiano</div>
          <div style={{ color: '#94a3b8', fontSize: '13px' }}>Quantitative Analysis</div>
        </div>

        <div style={{ display: 'flex', background: '#0f172a', borderRadius: '8px', padding: '4px', marginBottom: '24px' }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600, background: mode === m ? '#3b82f6' : 'transparent', color: mode === m ? '#fff' : '#94a3b8', transition: 'all 0.2s' }}>
              {m === 'login' ? (lang === 'en' ? 'Sign In' : 'Autentificare') : (lang === 'en' ? 'New account' : 'Cont nou')}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="email@exemplu.com" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }} />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
              {lang === 'en' ? 'Password' : 'Parola'}{mode === 'register' && <span style={{ color: '#64748b' }}> ({lang === 'en' ? 'min 6 characters' : 'minim 6 caractere'})</span>}
            </label>
            <div style={{ position: 'relative' }}>
              <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPass(e.target.value)} required minLength={6} placeholder="••••••••" style={{ width: '100%', padding: '10px 40px 10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }} />
              <button type="button" onClick={() => setShowPass(v => !v)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '16px', padding: '0' }}>
                {showPass ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginBottom: '16px' }}>
              <button type="button" onClick={() => { setForgotEmail(email); setMode('forgot'); setForgotErr(''); setForgotMsg('') }} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '12px', cursor: 'pointer', fontFamily: 'monospace' }}>
                {lang === 'en' ? 'Forgot password?' : 'Ai uitat parola?'}
              </button>
            </div>
          )}

          {mode === 'register' && <div style={{ marginBottom: '16px' }} />}

          {error && <div style={{ background: '#450a0a', border: '1px solid #991b1b', color: '#fca5a5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

          <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: loading ? '#1d4ed8' : '#3b82f6', color: '#fff', fontSize: '15px', fontWeight: 700, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? (lang === 'en' ? 'Processing...' : 'Se proceseaza...') : mode === 'login' ? (lang === 'en' ? 'Sign In' : 'Intra in cont') : (lang === 'en' ? 'Create account' : 'Creeaza cont')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <Link href="/daily" style={{ color: '#64748b', fontSize: '13px', textDecoration: 'none' }}>
            {lang === 'en' ? 'Continue without account →' : 'Continua fara cont →'}
          </Link>
        </div>

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #1e293b', textAlign: 'center' }}>
          <Link href="/terms" style={{ color: '#475569', fontSize: '10px', fontFamily: 'monospace', marginRight: '12px' }}>{lang === 'en' ? 'Terms' : 'Termeni'}</Link>
          <Link href="/privacy" style={{ color: '#475569', fontSize: '10px', fontFamily: 'monospace' }}>{lang === 'en' ? 'Privacy' : 'Confidentialitate'}</Link>
        </div>
      </div>
    </div>
  )
}
