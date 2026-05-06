'use client'
import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getToken, logout } from '@/lib/auth'
import { useLang } from '@/lib/LangContext'

const WEB_LINKS = {
  ro: [
    { href: '/',             label: 'Predicții',              icon: '🔮' },
    { href: '/daily',        label: 'Analize zilnice',        icon: '🎯' },
    { href: '/bet-builder',  label: 'Combo Analyzer',         icon: '🔢' },
    { href: '/track-record', label: 'Istoric & Performanță',  icon: '📊' },
    { href: '/blog',         label: 'Blog & Analize',         icon: '📝' },
    { href: '/despre',       label: 'Despre',                 icon: 'ℹ️'  },
    { href: '/upgrade',      label: 'Upgrade',                icon: '⚡', highlight: true },
  ],
  en: [
    { href: '/',             label: 'Predictions',            icon: '🔮' },
    { href: '/daily',        label: 'Daily Analysis',         icon: '🎯' },
    { href: '/bet-builder',  label: 'Combo Analyzer',         icon: '🔢' },
    { href: '/track-record', label: 'History & Performance',  icon: '📊' },
    { href: '/blog',         label: 'Blog & Analysis',        icon: '📝' },
    { href: '/despre',       label: 'About',                  icon: 'ℹ️'  },
    { href: '/upgrade',      label: 'Upgrade',                icon: '⚡', highlight: true },
  ],
}

// Versiunea Android: fara Bet-Builder, limbaj analytics pur
const NATIVE_LINKS = {
  ro: [
    { href: '/',             label: 'Predicții',              icon: '🔮' },
    { href: '/daily',        label: 'Analize zilnice',        icon: '🎯' },
    { href: '/track-record', label: 'Istoric & Performanță',  icon: '📊' },
    { href: '/despre',       label: 'Despre',                 icon: 'ℹ️'  },
    { href: '/upgrade',      label: 'Upgrade',                icon: '⚡', highlight: true },
  ],
  en: [
    { href: '/',             label: 'Predictions',            icon: '🔮' },
    { href: '/daily',        label: 'Daily Analysis',         icon: '🎯' },
    { href: '/track-record', label: 'History & Performance',  icon: '📊' },
    { href: '/despre',       label: 'About',                  icon: 'ℹ️'  },
    { href: '/upgrade',      label: 'Upgrade',                icon: '⚡', highlight: true },
  ],
}

export default function Navbar() {
  const pathname  = usePathname()
  const router    = useRouter()
  const [open, setOpen]     = useState(false)
  const [logged, setLogged] = useState(false)
  const [isNative, setIsNative] = useState(false)
  const { lang, setLang }   = useLang()

  useEffect(() => {
    setLogged(!!getToken())
    // Detecteaza Capacitor native (Android/iOS)
    const cap = (window as any).Capacitor
    setIsNative(cap?.isNativePlatform?.() === true)
  }, [pathname])

  const navLang = (lang === 'ro' ? 'ro' : 'en') as 'ro' | 'en'
  const links = (isNative ? NATIVE_LINKS : WEB_LINKS)[navLang]

  return (
    <>
      {/* ── Desktop / Mobile top bar ─────────────────────────── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'rgba(5, 15, 10, 0.97)',
        borderBottom: '1px solid rgba(34,197,94,0.18)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        paddingTop: 'env(safe-area-inset-top)',
      }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: '0 16px',
          height: 80,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>

          {/* Logo */}
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
            <img src="/logo-icon.jpg" alt="Oxiano" className="navbar-logo" style={{ objectFit: 'contain' }} />
          </Link>

          {/* Desktop links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 2 }} className="desktop-nav">
            {links.map(l => {
              const active = pathname === l.href || (l.href !== '/' && pathname?.startsWith(l.href))
              return (
                <Link key={l.href} href={l.href} style={{
                  padding: '6px 10px',
                  borderRadius: 7,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: l.highlight ? '#f59e0b' : active ? '#4ade80' : '#9ca3af',
                  background: active ? 'rgba(34,197,94,0.10)' : 'transparent',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}>
                  {l.icon} {l.label}
                </Link>
              )
            })}

            {/* Telegram */}
            <a href="https://t.me/Oxianoo" target="_blank" rel="noopener noreferrer" style={{
              marginLeft: 4,
              padding: '6px 10px',
              borderRadius: 7,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
              color: '#22d3ee',
              background: 'rgba(34,211,238,0.08)',
              border: '1px solid rgba(34,211,238,0.2)',
              whiteSpace: 'nowrap',
            }}>
              ✈️ Telegram
            </a>

            {/* Lang toggle */}
            <select
              value={lang}
              onChange={e => setLang(e.target.value as import('@/lib/LangContext').Lang)}
              style={{
                marginLeft: 8,
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.06)',
                color: '#e5e7eb',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'monospace',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="ro" style={{ background: '#0a1628', color: '#e5e7eb' }}>RO</option>
              <option value="en" style={{ background: '#0a1628', color: '#e5e7eb' }}>EN</option>
              <option value="de" style={{ background: '#0a1628', color: '#e5e7eb' }}>DE</option>
              <option value="es" style={{ background: '#0a1628', color: '#e5e7eb' }}>ES</option>
              <option value="pt" style={{ background: '#0a1628', color: '#e5e7eb' }}>PT</option>
            </select>

            <Link href="/login" style={{
              marginLeft: 8,
              padding: '6px 14px',
              borderRadius: 7,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
              color: logged ? '#4ade80' : '#fff',
              background: logged ? 'rgba(34,197,94,0.12)' : 'rgba(37,99,235,0.25)',
              border: `1px solid ${logged ? 'rgba(34,197,94,0.3)' : 'rgba(37,99,235,0.4)'}`,
              whiteSpace: 'nowrap',
            }}>
              {logged ? (lang === 'ro' ? '👤 Cont' : '👤 Account') : '🔑 Login'}
            </Link>
          </nav>

          {/* Mobile: lang + hamburger */}
          <div className="mobile-menu-btn" style={{ display: 'none', alignItems: 'center', gap: 8 }}>
            <select
              value={lang}
              onChange={e => setLang(e.target.value as import('@/lib/LangContext').Lang)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.08)',
                color: '#e5e7eb',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'monospace',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="ro" style={{ background: '#0a1628', color: '#e5e7eb' }}>RO</option>
              <option value="en" style={{ background: '#0a1628', color: '#e5e7eb' }}>EN</option>
              <option value="de" style={{ background: '#0a1628', color: '#e5e7eb' }}>DE</option>
              <option value="es" style={{ background: '#0a1628', color: '#e5e7eb' }}>ES</option>
              <option value="pt" style={{ background: '#0a1628', color: '#e5e7eb' }}>PT</option>
            </select>
            <button
              onClick={() => setOpen(v => !v)}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, cursor: 'pointer',
                color: '#e5e7eb', fontSize: 26, padding: '6px 12px',
              }}
              aria-label="Menu"
            >
              {open ? '✕' : '☰'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile drawer ────────────────────────────────────── */}
      {open && (
        <div
          style={{
            position: 'fixed', top: 'calc(80px + env(safe-area-inset-top))', left: 0, right: 0, bottom: 0,
            background: 'rgba(3, 10, 6, 0.98)',
            zIndex: 999,
            padding: '20px 16px 16px',
            display: 'flex', flexDirection: 'column', gap: 4,
            overflowY: 'auto',
          }}
          onClick={() => setOpen(false)}
        >
          {links.map(l => {
            const active = pathname === l.href || (l.href !== '/' && pathname?.startsWith(l.href))
            return (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} style={{
                padding: '14px 18px',
                borderRadius: 10,
                textDecoration: 'none',
                fontSize: 16,
                fontWeight: active ? 700 : 500,
                color: l.highlight ? '#f59e0b' : active ? '#4ade80' : '#e5e7eb',
                background: active ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)'}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 20 }}>{l.icon}</span>
                {l.label}
                {active && <span style={{ marginLeft: 'auto', color: '#4ade80', fontSize: 12 }}>●</span>}
              </Link>
            )
          })}

          {/* Lang toggle mobile */}
          <div style={{ padding: '4px 18px' }} onClick={e => e.stopPropagation()}>
            <select
              value={lang}
              onChange={e => setLang(e.target.value as import('@/lib/LangContext').Lang)}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
                color: '#e5e7eb',
                fontSize: 14,
                fontWeight: 700,
                fontFamily: 'monospace',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="ro" style={{ background: '#0a1628', color: '#e5e7eb' }}>RO</option>
              <option value="en" style={{ background: '#0a1628', color: '#e5e7eb' }}>EN</option>
              <option value="de" style={{ background: '#0a1628', color: '#e5e7eb' }}>DE</option>
              <option value="es" style={{ background: '#0a1628', color: '#e5e7eb' }}>ES</option>
              <option value="pt" style={{ background: '#0a1628', color: '#e5e7eb' }}>PT</option>
            </select>
          </div>

          <a href="https://t.me/Oxianoo" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} style={{
            padding: '14px 18px',
            borderRadius: 10,
            textDecoration: 'none',
            fontSize: 16,
            fontWeight: 600,
            color: '#22d3ee',
            background: 'rgba(34,211,238,0.06)',
            border: '1px solid rgba(34,211,238,0.2)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>✈️</span>
            Telegram
          </a>

          <Link href="/login" onClick={() => setOpen(false)} style={{
            marginTop: 4,
            padding: '14px 18px',
            borderRadius: 10,
            textDecoration: 'none',
            fontSize: 16,
            fontWeight: 600,
            color: logged ? '#4ade80' : '#fff',
            background: logged ? 'rgba(34,197,94,0.10)' : 'rgba(37,99,235,0.20)',
            border: `1px solid ${logged ? 'rgba(34,197,94,0.3)' : 'rgba(37,99,235,0.4)'}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>{logged ? '👤' : '🔑'}</span>
            {logged
              ? (lang === 'ro' ? 'Contul meu' : 'My Account')
              : (lang === 'ro' ? 'Login / Înregistrare' : 'Login / Register')}
          </Link>

          {logged && (
            <button
              onClick={(e) => { e.stopPropagation(); logout(); setLogged(false); setOpen(false) }}
              style={{
                marginTop: 4,
                padding: '12px 18px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                color: '#6b7280',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.05)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {lang === 'ro' ? 'Deconectare' : 'Sign out'}
            </button>
          )}
        </div>
      )}

      {/* Spacer */}
      <div style={{ height: 80 }} />

      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
          .navbar-logo { height: 52px; width: auto; max-width: 160px; }
        }
        @media (min-width: 769px) {
          .navbar-logo { height: 56px; width: auto; max-width: 180px; }
        }
      `}</style>
    </>
  )
}
