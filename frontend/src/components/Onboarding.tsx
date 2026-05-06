'use client'
import { useState, useEffect } from 'react'
import { useLang } from '@/lib/LangContext'

const STEPS = {
  ro: [
    {
      icon: '🤖',
      title: 'Analiză AI în timp real',
      desc: 'Modelul XGBoost analizează 84 de variabile per meci: formă, Elo, xG, H2H și cote. Antrenat pe 225.000+ meciuri.',
    },
    {
      icon: '📊',
      title: 'Probabilități, nu certitudini',
      desc: 'Afișăm probabilități matematice. La confidence ≥65%, acuratețea istorică este ~75% pe piața 1X2. Performanțele trecute nu garantează viitorul.',
    },
    {
      icon: '⚠️',
      title: 'Scop educațional',
      desc: 'Oxiano este un instrument de business intelligence și analiză statistică. Nu reprezintă sfat de pariere sau recomandare financiară.',
    },
    {
      icon: '🎯',
      title: 'Gata de explorat',
      desc: 'Descoperă predicțiile zilei, generează analize complete pentru orice meci și urmărește performanța ta în Personal Tracker.',
    },
  ],
  en: [
    {
      icon: '🤖',
      title: 'Real-time AI Analysis',
      desc: 'The XGBoost model analyses 84 variables per match: form, Elo, xG, H2H and odds. Trained on 225,000+ matches.',
    },
    {
      icon: '📊',
      title: 'Probabilities, not certainties',
      desc: 'We display mathematical probabilities. At confidence ≥65%, historical accuracy is ~75% on the 1X2 market. Past performance does not guarantee future results.',
    },
    {
      icon: '⚠️',
      title: 'Educational purpose only',
      desc: 'Oxiano is a business intelligence and statistical analysis tool. It does not constitute betting advice or financial recommendation.',
    },
    {
      icon: '🎯',
      title: 'Ready to explore',
      desc: 'Discover today\'s predictions, generate full analysis for any match and track your performance in the Personal Tracker.',
    },
  ],
}

export default function Onboarding() {
  const [visible, setVisible] = useState(false)
  const [step, setStep]       = useState(0)
  const { lang }              = useLang()

  useEffect(() => {
    const seen = localStorage.getItem('flopi_onboarded')
    if (!seen) setVisible(true)
  }, [])

  function finish() {
    localStorage.setItem('flopi_onboarded', '1')
    setVisible(false)
  }

  if (!visible) return null

  const steps = STEPS[(lang === 'ro' ? 'ro' : 'en') as 'ro' | 'en']
  const s = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#1e293b', borderRadius: '20px',
        padding: '32px 24px', maxWidth: '380px', width: '100%',
        border: '1px solid rgba(59,130,246,0.3)',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '24px' }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: i === step ? '20px' : '6px', height: '6px',
              borderRadius: '3px', transition: 'all 0.3s',
              background: i === step ? '#3b82f6' : 'rgba(255,255,255,0.15)',
            }} />
          ))}
        </div>

        {/* Content */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '52px', marginBottom: '16px' }}>{s.icon}</div>
          <h2 style={{
            color: '#f1f5f9', fontSize: '20px', fontWeight: 800,
            fontFamily: 'monospace', margin: '0 0 12px',
            letterSpacing: '0.03em',
          }}>
            {s.title}
          </h2>
          <p style={{
            color: '#94a3b8', fontSize: '13px', lineHeight: 1.6,
            margin: 0,
          }}>
            {s.desc}
          </p>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{
                flex: 1, padding: '12px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.05)',
                color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)',
                fontSize: '13px', cursor: 'pointer', fontFamily: 'monospace',
              }}
            >
              {lang === 'en' ? 'Back' : 'Înapoi'}
            </button>
          )}
          <button
            onClick={isLast ? finish : () => setStep(s => s + 1)}
            style={{
              flex: 2, padding: '12px', borderRadius: '10px',
              background: isLast ? '#22c55e' : '#3b82f6',
              color: '#fff', border: 'none',
              fontSize: '14px', fontWeight: 700,
              cursor: 'pointer', fontFamily: 'monospace',
            }}
          >
            {isLast ? (lang === 'en' ? '🚀 Explore' : '🚀 Explorează') : (lang === 'en' ? 'Continue →' : 'Continuă →')}
          </button>
        </div>

        <button
          onClick={finish}
          style={{
            width: '100%', marginTop: '12px',
            background: 'none', border: 'none',
            color: '#475569', fontSize: '11px',
            cursor: 'pointer', fontFamily: 'monospace',
          }}
        >
          {lang === 'en' ? 'Skip' : 'Sari peste'}
        </button>
      </div>
    </div>
  )
}
