'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getUser, AuthUser, createCheckoutSession, isPaid } from '@/lib/auth'
import { useLang } from '@/lib/LangContext'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://football-predictor-vlpp.onrender.com'

const PLANS = (lang: import('@/lib/LangContext').Lang) => [
  {
    id: 'analyst' as const,
    name: 'Analyst',
    price: 39,
    priceUsd: 8,
    badge: null,
    featureCount: 5,
    features: lang !== 'ro' ? [
      'All HIGH confidence predictions',
      'Full markets (Over/Under · BTTS · Double Chance)',
      'Daily 3-fold accumulator',
      'Telegram notifications (2×/day)',
      'Basic track record (last 7 days)',
    ] : [
      'Toate predicțiile HIGH confidence',
      'Piețe complete (Over/Under · BTTS · Șansă dublă)',
      'Acumulator zilnic 3-fold',
      'Notificări Telegram (2×/zi)',
      'Track record de bază (ultimele 7 zile)',
    ],
    notIncluded: lang !== 'ro' ? [
      'xG + Elo + Model breakdown',
      'Value Signal with edge vs. market',
      'Full track record + personal ROI',
      'Exclusive VIP picks',
      'Priority support',
    ] : [
      'xG + Elo + Model breakdown',
      'Semnal Valoare cu avantaj față de piață',
      'Track record complet + ROI personal',
      'Picks VIP exclusive',
      'Suport prioritar',
    ],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: 99,
    priceUsd: 20,
    badge: lang !== 'ro' ? 'Best Value' : 'Cea mai bună alegere',
    featureCount: 10,
    features: lang !== 'ro' ? [
      'Everything in Analyst (5 features)',
      'xG + Elo + full model breakdown',
      'VALUE BET marked with edge vs. market',
      'Score Matrix — Poisson bivariate',
      'Complete track record + personal ROI',
      'Exclusive VIP picks (top 3 daily · confidence ≥75%)',
      '5-fold AI-optimized accumulator',
      'Odds comparator — is your bet worth it?',
      'Priority support 24/7',
      'Beta access to new features',
    ] : [
      'Tot ce include Analyst (5 funcții)',
      'xG + Elo + detalii complete model',
      'VALUE BET marcat cu avantaj față de piață',
      'Score Matrix — Poisson bivariate',
      'Track record complet + ROI personal',
      'Picks VIP exclusive (top 3 zilnic · confidence ≥75%)',
      'Acumulator 5-fold optimizat AI',
      'Comparator cote — merită pariul tău?',
      'Suport prioritar 24/7',
      'Acces beta funcții noi',
    ],
    notIncluded: [],
  },
]

export default function UpgradePage() {
  const { lang } = useLang()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isNative, setIsNative] = useState(false)
  const [liveStats, setLiveStats] = useState<{ total: number; high_conf_accuracy: number; final_equity: number } | null>(null)
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    setUser(getUser())
    const cap = (window as any).Capacitor
    setIsNative(cap?.isNativePlatform?.() === true)
    fetch(`${API}/api/track-record`)
      .then(r => r.json())
      .then(d => {
        if (d?.total > 0) setLiveStats({ total: d.total, high_conf_accuracy: d.high_conf_accuracy, final_equity: d.final_equity ?? 0 })
      })
      .catch(() => null)
  }, [])

  useEffect(() => {
    function tick() {
      const now = new Date()
      const next = new Date()
      next.setHours(7, 0, 0, 0)
      if (now >= next) next.setDate(next.getDate() + 1)
      const diff = next.getTime() - now.getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setCountdown(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  async function handleUpgrade(plan: 'analyst' | 'pro') {
    if (!user) {
      window.location.href = '/login?redirect=/upgrade'
      return
    }
    setLoading(plan)
    setError(null)
    try {
      const url = await createCheckoutSession(plan)
      window.location.href = url
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscuta')
      setLoading(null)
    }
  }

  const alreadyPaid = isPaid()

  // Pe native (Android/iOS) nu afisam checkout — Google Play policy
  if (isNative) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#f1f5f9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 24 }}>🌐</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12, color: '#f1f5f9' }}>
          {lang !== 'ro' ? 'Manage your subscription on the web' : 'Gestionează abonamentul pe web'}
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, maxWidth: 320, marginBottom: 32 }}>
          {lang !== 'ro'
            ? 'Subscriptions for Oxiano are managed exclusively on oxiano.com. Tap below to open the website in your browser.'
            : 'Abonamentele Oxiano se gestionează exclusiv pe oxiano.com. Apasă mai jos pentru a deschide site-ul în browser.'}
        </p>
        <a
          href="https://oxiano.com/upgrade"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            padding: '16px 32px',
            borderRadius: 14,
            background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
            marginBottom: 16,
          }}
        >
          {lang !== 'ro' ? 'Open oxiano.com →' : 'Deschide oxiano.com →'}
        </a>
        <p style={{ color: '#475569', fontSize: 11, marginTop: 16 }}>
          {lang !== 'ro'
            ? 'Analyst — $8/mo · Pro — $20/mo · Cancel anytime'
            : 'Analyst — 39 RON/lună · Pro — 99 RON/lună · Anulezi oricând'}
        </p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#f1f5f9' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: 18, color: '#60a5fa', textDecoration: 'none' }}>
          Oxiano
        </Link>
        <Link href="/daily" style={{ color: '#94a3b8', fontSize: 14, textDecoration: 'none' }}>
          Selectiile zilei
        </Link>
      </nav>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', letterSpacing: 2, marginBottom: 12, textTransform: 'uppercase' }}>
            {lang !== 'ro' ? 'Upgrade account' : 'Upgrade cont'}
          </div>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 800, marginBottom: 16, lineHeight: 1.15 }}>
            {lang !== 'ro' ? <>Professional analytics.<br /><span style={{ color: '#60a5fa' }}>No noise.</span></> : <>Analitica profesionala.<br /><span style={{ color: '#60a5fa' }}>Fara zgomot.</span></>}
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 16, maxWidth: 520, margin: '0 auto' }}>
            {lang !== 'ro'
              ? <>Our XGBoost model achieves {liveStats ? `${liveStats.high_conf_accuracy}%` : '75%+'} accuracy on HIGH confidence predictions.{liveStats && liveStats.final_equity > 0 ? <> <span style={{ color: '#4ade80' }}>+{liveStats.final_equity}u profit = ~${(liveStats.final_equity * 4).toFixed(0)} at $2/pick.</span></> : null} Choose the plan that fits your analysis style.</>
              : <>Modelul nostru XGBoost înregistrează {liveStats ? `${liveStats.high_conf_accuracy}%` : '75%+'} acuratețe la predicțiile HIGH confidence.{liveStats && liveStats.final_equity > 0 ? <> <span style={{ color: '#4ade80' }}>+{liveStats.final_equity}u profit = ~{(liveStats.final_equity * 20).toFixed(0)} RON dacă joci 20 RON/pick.</span></> : null} Alege planul potrivit pentru stilul tău de analiză.</>}
          </p>
        </div>

        {/* Live track record banner */}
        {liveStats && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12,
            marginBottom: 36, padding: '16px 24px', borderRadius: 16,
            background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)',
          }}>
            {[
              { val: `${liveStats.high_conf_accuracy}%`, label: lang !== 'ro' ? 'accuracy ≥65% conf · live' : 'acuratețe ≥65% conf · live', color: '#4ade80' },
              { val: `${liveStats.total}`, label: lang !== 'ro' ? 'verified picks' : 'picks verificate', color: '#60a5fa' },
              { val: `${liveStats.final_equity >= 0 ? '+' : ''}${liveStats.final_equity}u`, label: lang !== 'ro' ? 'profit (1u stake)' : 'profit (1u miză)', color: liveStats.final_equity >= 0 ? '#4ade80' : '#f87171' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', padding: '4px 20px' }}>
                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'monospace', color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
              </div>
            ))}
            <div style={{ width: '100%', textAlign: 'center', marginTop: 4 }}>
              <Link href="/track-record" style={{ fontSize: 11, color: '#22c55e', textDecoration: 'none', fontFamily: 'monospace' }}>
                {lang !== 'ro' ? '→ Full transparent track record' : '→ Track record complet, transparent'}
              </Link>
            </div>
          </div>
        )}

        {!alreadyPaid && countdown && (
          <div style={{ textAlign: 'center', padding: '12px 24px', marginBottom: 24, borderRadius: 12, background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>
              {lang !== 'ro' ? "Tomorrow's picks unlock at 07:00 · " : 'Picks de mâine se deblochează la 07:00 · '}
            </span>
            <span style={{ color: '#60a5fa', fontSize: 15, fontWeight: 700, fontFamily: 'monospace' }}>{countdown}</span>
          </div>
        )}

        {alreadyPaid && (
          <div style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid #22c55e', borderRadius: 12, padding: '16px 24px', marginBottom: 32, textAlign: 'center', color: '#4ade80' }}>
            {lang !== 'ro' ? `You already have an active subscription (${user?.tier}). Thank you for your trust!` : `Ai deja un abonament activ (${user?.tier}). Multumim pentru incredere!`}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: 12, padding: '16px 24px', marginBottom: 32, textAlign: 'center', color: '#f87171' }}>
            {error}
          </div>
        )}

        {/* Pricing cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 48 }}>
          {PLANS(lang).map((plan) => (
            <div
              key={plan.id}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: plan.badge ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 20,
                padding: '32px 28px',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {plan.badge && (
                <div style={{
                  position: 'absolute',
                  top: -14,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  padding: '4px 16px',
                  borderRadius: 99,
                }}>
                  {plan.badge}
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {plan.name}
                  </div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                    padding: '3px 10px', borderRadius: 99,
                    background: plan.badge ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                    color: plan.badge ? '#f59e0b' : '#60a5fa',
                    border: `1px solid ${plan.badge ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)'}`,
                  }}>
                    {(plan as any).featureCount} {lang !== 'ro' ? 'features' : 'funcții'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  {lang !== 'ro' ? (
                    <>
                      <span style={{ fontSize: 42, fontWeight: 800, color: '#f1f5f9' }}>${plan.priceUsd}</span>
                      <span style={{ fontSize: 16, color: '#64748b' }}>/month</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 42, fontWeight: 800, color: '#f1f5f9' }}>{plan.price}</span>
                      <span style={{ fontSize: 16, color: '#64748b' }}>RON/lună</span>
                    </>
                  )}
                </div>
                {plan.badge && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                    {lang !== 'ro' ? '2.5× more features · same low price ratio' : 'De 2× mai multe funcții · cel mai bun raport calitate/preț'}
                  </div>
                )}
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px 0', flexGrow: 1 }}>
                {plan.features.map((f, i) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, color: '#cbd5e1', fontSize: 13 }}>
                    <span style={{
                      color: i === 0 && plan.id === 'pro' ? '#94a3b8' : '#4ade80',
                      fontWeight: 700, flexShrink: 0, marginTop: 1,
                      fontSize: i === 0 && plan.id === 'pro' ? 11 : 13,
                    }}>
                      {i === 0 && plan.id === 'pro' ? '↳' : '✓'}
                    </span>
                    <span style={{ color: i === 0 && plan.id === 'pro' ? '#64748b' : '#cbd5e1' }}>{f}</span>
                  </li>
                ))}
                {plan.notIncluded.length > 0 && (
                  <>
                    <li style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '14px 0 10px' }} />
                    <li style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      {lang !== 'ro' ? 'Not included' : 'Nu include'}
                    </li>
                  </>
                )}
                {plan.notIncluded.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8, color: '#374151', fontSize: 12 }}>
                    <span style={{ flexShrink: 0, marginTop: 1 }}>✗</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleUpgrade(plan.id)}
                disabled={!!loading || alreadyPaid}
                style={{
                  width: '100%',
                  padding: '14px 24px',
                  borderRadius: 12,
                  border: 'none',
                  cursor: loading || alreadyPaid ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: 15,
                  transition: 'opacity 0.2s',
                  opacity: loading && loading !== plan.id ? 0.5 : 1,
                  background: plan.badge
                    ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                    : 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
                  color: '#fff',
                }}
              >
                {loading === plan.id ? (lang !== 'ro' ? 'Redirecting...' : 'Se redirectioneaza...') : alreadyPaid ? (lang !== 'ro' ? 'Active subscription' : 'Abonament activ') : (lang !== 'ro' ? `Choose ${plan.name}` : `Alege ${plan.name}`)}
              </button>
            </div>
          ))}
        </div>

        {/* Free tier comparison */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: '24px 28px',
          marginBottom: 48,
        }}>
          <div style={{ fontWeight: 600, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 }}>
            {lang !== 'ro' ? 'Free (existing account)' : 'Gratuit (cont existent)'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {(lang !== 'ro' ? [
              'MEDIUM + LOW confidence predictions',
              'Public accumulators',
              'Public track record',
              'Share on WhatsApp/Telegram',
            ] : [
              'Predictii MEDIUM + LOW confidence',
              'Acumulatoare publice',
              'Track record public',
              'Share pe WhatsApp/Telegram',
            ]).map((f) => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 14 }}>
                <span style={{ color: '#4ade80' }}>✓</span> {f}
              </div>
            ))}
          </div>
        </div>

        {/* Trust badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 32, marginBottom: 48, color: '#64748b', fontSize: 13 }}>
          {(lang !== 'ro' ? [
            { icon: '🔒', text: 'Secure Gumroad payment' },
            { icon: '↩️', text: 'Cancel anytime' },
            { icon: '📊', text: liveStats ? `${liveStats.high_conf_accuracy}% verified accuracy` : '75%+ verified accuracy' },
            { icon: '🇷🇴', text: 'Price in RON' },
          ] : [
            { icon: '🔒', text: 'Plata securizata Gumroad' },
            { icon: '↩️', text: 'Anulezi oricand' },
            { icon: '📊', text: liveStats ? `${liveStats.high_conf_accuracy}% acuratete verificata` : '75%+ acuratete verificata' },
            { icon: '🇷🇴', text: 'Pretul in RON' },
          ]).map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div style={{ textAlign: 'center', color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
          {lang !== 'ro' ? <>By subscribing you agree to our{' '}
          <Link href="/terms" style={{ color: '#60a5fa', textDecoration: 'none' }}>Terms & Conditions</Link>
          {' '}and{' '}
          <Link href="/privacy" style={{ color: '#60a5fa', textDecoration: 'none' }}>Privacy Policy</Link>.
          Oxiano provides statistical analysis. Not betting advice. Gambling can be addictive. 18+</> : <>Prin abonare esti de acord cu{' '}
          <Link href="/terms" style={{ color: '#60a5fa', textDecoration: 'none' }}>Termenii si Conditiile</Link>
          {' '}si{' '}
          <Link href="/privacy" style={{ color: '#60a5fa', textDecoration: 'none' }}>Politica de Confidentialitate</Link>.
          Oxiano ofera analize statistice. Nu constituie sfat de pariere. Jocul de noroc poate crea dependenta. 18+</>}
        </div>
      </div>
    </div>
  )
}
