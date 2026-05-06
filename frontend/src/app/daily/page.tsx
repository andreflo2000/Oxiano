'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getUser, logout, isVip, getToken, type AuthUser } from '@/lib/auth'
import PickSkeleton from '@/components/PickSkeleton'
import { getBetBuilder, saveBetBuilder } from '@/lib/betBuilder'
import { useLang } from '@/lib/LangContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://football-predictor-vlpp.onrender.com'

function today() {
  return new Date().toISOString().split('T')[0]
}
function addDays(iso: string, n: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}
function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

interface Pick {
  home: string
  away: string
  league: string
  flag: string
  time: string
  home_win: number
  draw: number
  away_win: number
  prediction: 'H' | 'D' | 'A'
  prediction_label: string
  confidence: number
  confidence_level: 'high' | 'medium' | 'low'
  high_confidence: boolean
  home_elo: number
  away_elo: number
  home_form: number
  away_form: number
  home_venue_form?: number
  away_venue_form?: number
  btts_rate?: number
  over25_rate?: number
  competition_code?: string
  has_odds?: boolean
  odds_home?: number | null
  odds_draw?: number | null
  odds_away?: number | null
  // BI signals
  edge?: number
  value_bet?: boolean
  market_signal?: string
  upset_risk?: boolean
}

interface DailyResponse {
  date: string
  total_fixtures: number
  total_picks: number
  high_conf: number
  med_conf: number
  picks: Pick[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeKelly(confidence: number, edge: number | undefined, hasOdds: boolean): number {
  const p = confidence / 100
  let odds: number
  if (hasOdds && edge !== undefined && edge > 0) {
    // Edge real disponibil: derivam cotele din edge
    const pMarket = Math.max(0.05, p - edge / 100)
    odds = 1 / pMarket
  } else {
    // Fara edge: presupunem marja de 8% a bookmakerului
    odds = 1 / (p * 1.08)
  }
  const b = odds - 1
  const kelly = (b * p - (1 - p)) / b
  return Math.max(0, Math.min(0.10, kelly))  // cap 0-10%
}

function confColor(level: string, lang: import('@/lib/LangContext').Lang = 'ro') {
  if (level === 'high')   return { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.35)',  text: '#22c55e', label: lang !== 'ro' ? 'HIGH' : 'RIDICATĂ' }
  if (level === 'medium') return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', text: '#f59e0b', label: lang !== 'ro' ? 'MEDIUM' : 'MEDIE' }
  return                         { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.30)', text: '#818cf8', label: lang !== 'ro' ? 'LOW' : 'SCĂZUTĂ' }
}

// Returneaza cota reala daca exista, altfel estimeaza din probabilitate
function getOdd(p: Pick, prediction: 'H' | 'D' | 'A', prob: number): { odd: string; isReal: boolean } {
  if (prediction === 'H' && p.odds_home) return { odd: p.odds_home.toFixed(2), isReal: true }
  if (prediction === 'D' && p.odds_draw) return { odd: p.odds_draw.toFixed(2), isReal: true }
  if (prediction === 'A' && p.odds_away) return { odd: p.odds_away.toFixed(2), isReal: true }
  return { odd: Math.max(1.20, 100 / (Math.max(prob, 1) * 1.08)).toFixed(2), isReal: false }
}

function predLabel(p: Pick, lang: import('@/lib/LangContext').Lang = 'ro') {
  if (p.prediction === 'H') return { emoji: '◀', short: '1',  full: p.home,  prob: p.home_win }
  if (p.prediction === 'A') return { emoji: '▶', short: '2',  full: p.away,  prob: p.away_win }
  return                           { emoji: '▬', short: 'X',  full: lang !== 'ro' ? 'Draw' : 'Egal',  prob: p.draw }
}

// ── Format share Telegram ────────────────────────────────────────────────────
function buildShareCard(p: Pick, dateStr: string): string {
  const pred  = predLabel(p)
  const bar   = (pct: number) => '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
  const conf  = p.confidence >= 65 ? '🟢 HIGH' : p.confidence >= 55 ? '🟡 MEDIUM' : '🔵 LOW'

  return [
    `╔══════════════════════════╗`,
    `   ⚽ OXIANO · PREDICȚIE AI`,
    `╚══════════════════════════╝`,
    ``,
    `${p.flag} ${p.league}`,
    `📅 ${dateStr}  ·  ${p.time || '—'}`,
    ``,
    `  🏠  ${p.home}`,
    `  ✈️  ${p.away}`,
    ``,
    `──────────────────────────`,
    `📊 PROBABILITĂȚI`,
    ``,
    `  1  ${bar(p.home_win)}  ${p.home_win}%`,
    `  X  ${bar(p.draw)}  ${p.draw}%`,
    `  2  ${bar(p.away_win)}  ${p.away_win}%`,
    ``,
    `──────────────────────────`,
    `🎯 PREDICȚIE: ${pred.emoji} ${pred.short} — ${pred.full}`,
    `📈 Confidence: ${p.confidence}% · ${conf}`,
    `⚡ Elo: ${p.home_elo} vs ${p.away_elo}`,
    ``,
    `🤖 XGBoost + Elo + Poisson`,
    `──────────────────────────`,
    `⚠️  Analiză statistică.`,
    `    Nu constituie sfat de pariere.`,
    ``,
    `🌐 oxiano.com`,
  ].join('\n')
}

// ── Format share WhatsApp (markdown nativ WA) ────────────────────────────────
function buildShareCardWA(p: Pick, dateStr: string): string {
  const pred = predLabel(p)
  const conf = p.confidence >= 65 ? '🟢 *HIGH*' : p.confidence >= 55 ? '🟡 *MEDIUM*' : '🔵 *LOW*'
  const edge = p.edge && p.edge > 0 ? `📐 Edge: *+${p.edge.toFixed(1)}%*` : ''

  return [
    `⚽ *OXIANO — PREDICȚIE AI*`,
    ``,
    `${p.flag} *${p.league}*  ·  📅 ${dateStr}${p.time ? `  ·  🕐 ${p.time}` : ''}`,
    ``,
    `🏠 *${p.home}*`,
    `✈️ *${p.away}*`,
    ``,
    `📊 *Probabilități*`,
    `  1️⃣  ${p.home_win}%   🤝  ${p.draw}%   2️⃣  ${p.away_win}%`,
    ``,
    `🎯 *Predicție: ${pred.short} — ${pred.full}*`,
    `📈 Confidence: *${p.confidence}%* · ${conf}`,
    p.value_bet ? `⚡ *MARKET DIVERGENCE detectat*` : '',
    edge,
    `⚡ Elo: ${p.home_elo} vs ${p.away_elo}`,
    ``,
    `_🤖 Model: XGBoost + Elo + Poisson_`,
    `_⚠️ Analiză statistică — nu constituie sfat de pariere._`,
    ``,
    `🌐 *oxiano.com*`,
  ].filter(Boolean).join('\n')
}

function buildAccumulatorCard(picks: Pick[], dateStr: string): string {
  const lines = picks.slice(0, 3).map((p, i) => {
    const pred = predLabel(p)
    const odd  = (100 / (Math.max(pred.prob, 1) * 1.08)).toFixed(2)
    const medals = ['🥇', '🥈', '🥉']
    return `${medals[i]} ${p.flag} ${p.home} vs ${p.away}\n   ➤ ${pred.short} — ${pred.full}  |  ~${odd}  |  ${p.confidence}% conf`
  })
  const combo = picks.slice(0, 3).reduce((acc, p) => {
    const pred = predLabel(p)
    return acc * (100 / (Math.max(pred.prob, 1) * 1.08))
  }, 1)

  return [
    `╔══════════════════════════╗`,
    `  🎁 OXIANO · 3 PONTURI`,
    `╚══════════════════════════╝`,
    ``,
    `📅 ${dateStr}`,
    ``,
    ...lines,
    ``,
    `──────────────────────────`,
    `📦 ACUMULATOR: x${combo.toFixed(2)}`,
    `──────────────────────────`,
    `⚠️  Analiză statistică.`,
    `    Nu constituie sfat de pariere.`,
    ``,
    `🌐 oxiano.com`,
  ].join('\n')
}

// ── Tracker personal (localStorage) ─────────────────────────────────────────
interface TrackedBet { id: string; match: string; pick: string; odd: number; result: 'win'|'loss'|'pending'; date: string }

function PersonalTracker({ picks }: { picks: Pick[] }) {
  const { lang } = useLang()
  const [bets, setBets]       = useState<TrackedBet[]>([])
  const [open, setOpen]       = useState(false)
  const [stake, setStake]     = useState('10')

  useEffect(() => {
    try { setBets(JSON.parse(localStorage.getItem('flopi_bets') || '[]')) } catch {}
  }, [])

  const save = (updated: TrackedBet[]) => {
    setBets(updated)
    localStorage.setItem('flopi_bets', JSON.stringify(updated))
  }

  const addBet = (p: Pick) => {
    const pred   = predLabel(p)
    const odd    = parseFloat(Math.max(1.20, 100 / (Math.max(pred.prob, 1) * 1.08)).toFixed(2))
    const id     = `${p.home}-${p.away}-${Date.now()}`
    const bet: TrackedBet = {
      id, odd,
      match: `${p.home} vs ${p.away}`,
      pick:  `${pred.short} — ${pred.full}`,
      result: 'pending',
      date: new Date().toLocaleDateString('ro-RO'),
    }
    save([...bets, bet])
  }

  const markResult = (id: string, result: 'win'|'loss') =>
    save(bets.map(b => b.id === id ? { ...b, result } : b))

  const removeBet = (id: string) => save(bets.filter(b => b.id !== id))

  const wins   = bets.filter(b => b.result === 'win').length
  const losses = bets.filter(b => b.result === 'loss').length
  const total  = wins + losses
  const stakeN = parseFloat(stake) || 10
  const roi    = total > 0
    ? bets.filter(b => b.result !== 'pending').reduce((acc, b) =>
        acc + (b.result === 'win' ? b.odd * stakeN - stakeN : -stakeN), 0)
    : 0
  const roiPct = total > 0 ? Math.round((roi / (total * stakeN)) * 100) : 0

  return (
    <div className="mt-6">
      <button onClick={() => setOpen(o => !o)} className="w-full py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2"
        style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}>
        📓 {lang !== 'ro' ? 'Personal Tracker' : 'Tracker Personal'} {bets.length > 0 && `· ${bets.length} ${lang !== 'ro' ? 'bets' : 'pariuri'}`} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-3 card p-4 fade-in">
          {/* Stats */}
          {total > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { label: lang !== 'ro' ? 'Won' : 'Câștigate', val: wins, color: '#22c55e' },
                { label: lang !== 'ro' ? 'Lost' : 'Pierdute', val: losses, color: '#ef4444' },
                { label: 'ROI', val: `${roiPct > 0 ? '+' : ''}${roiPct}%`, color: roiPct >= 0 ? '#22c55e' : '#ef4444' },
                { label: `P/L (${stake} RON)`, val: `${roi > 0 ? '+' : ''}${roi.toFixed(0)}`, color: roi >= 0 ? '#22c55e' : '#ef4444' },
              ].map(s => (
                <div key={s.label} className="bg-gray-800/40 rounded-xl p-2 text-center">
                  <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.val}</div>
                  <div className="text-[9px] text-gray-600 uppercase tracking-widest mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Stake input */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] text-gray-500 font-mono shrink-0">{lang !== 'ro' ? 'Stake per bet:' : 'Miză per pariu:'}</span>
            <input type="number" value={stake} onChange={e => setStake(e.target.value)} min="1"
              className="w-20 bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm font-mono focus:outline-none focus:border-blue-500" />
            <span className="text-[10px] text-gray-600 font-mono">RON</span>
          </div>

          {/* Add from today's picks */}
          <div className="mb-4">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 font-mono">{lang !== 'ro' ? "Add from today's picks:" : 'Adaugă din pick-urile de azi:'}</div>
            <div className="space-y-1">
              {picks.slice(0, 5).map((p, i) => {
                const pred = predLabel(p)
                const already = bets.some(b => b.match === `${p.home} vs ${p.away}`)
                return (
                  <button key={i} onClick={() => !already && addBet(p)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all"
                    style={{
                      background: already ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.08)',
                      border: `1px solid ${already ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.2)'}`,
                      opacity: already ? 0.5 : 1,
                    }}>
                    <span className="text-[11px] text-white font-mono truncate">{p.flag} {p.home} vs {p.away} · <span className="text-indigo-400">{pred.short}</span></span>
                    <span className="text-[10px] text-gray-500 shrink-0 ml-2">{already ? (lang !== 'ro' ? '✓ added' : '✓ adăugat') : (lang !== 'ro' ? '+ add' : '+ adaugă')}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Bet history */}
          {bets.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">{lang !== 'ro' ? 'Your history:' : 'Istoricul tău:'}</div>
              {[...bets].reverse().slice(0, 10).map(b => (
                <div key={b.id} className="flex items-center gap-2 bg-gray-800/30 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-white font-mono truncate">{b.match}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{b.pick} · ~{b.odd} · {b.date}</div>
                  </div>
                  {b.result === 'pending' ? (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => markResult(b.id, 'win')}
                        className="text-[10px] px-2 py-1 rounded-lg font-bold" style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}>W</button>
                      <button onClick={() => markResult(b.id, 'loss')}
                        className="text-[10px] px-2 py-1 rounded-lg font-bold" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>L</button>
                      <button onClick={() => removeBet(b.id)}
                        className="text-[10px] px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', color: '#6b7280' }}>✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm">{b.result === 'win' ? '✅' : '❌'}</span>
                      <span className="text-[10px] font-bold font-mono" style={{ color: b.result === 'win' ? '#22c55e' : '#ef4444' }}>
                        {b.result === 'win' ? `+${((b.odd - 1) * stakeN).toFixed(0)}` : `-${stakeN}`} RON
                      </span>
                      <button onClick={() => removeBet(b.id)} className="text-gray-700 text-[10px] ml-1">✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Streak Badges ────────────────────────────────────────────────────────────
function StreakBadges({ pick }: { pick: Pick }) {
  const { lang } = useLang()
  const badges: { text: string; color: string }[] = []

  // Forma acasa (pentru gazda) / forma deplasare (pentru oaspete) — evita contradictii vizuale
  const hVenue = pick.home_venue_form ?? pick.home_form
  const aVenue = pick.away_venue_form ?? pick.away_form

  if (hVenue >= 65)
    badges.push({ text: `🔥 ${pick.home.split(' ')[0]} ${lang !== 'ro' ? 'strong at home' : 'formă acasă'}`, color: '#f97316' })
  if (aVenue >= 65)
    badges.push({ text: `🔥 ${pick.away.split(' ')[0]} ${lang !== 'ro' ? 'strong away' : 'formă deplasare'}`, color: '#f97316' })
  if (hVenue <= 30)
    badges.push({ text: `📉 ${pick.home.split(' ')[0]} ${lang !== 'ro' ? 'weak at home' : 'slab acasă'}`, color: '#ef4444' })
  if (aVenue <= 30)
    badges.push({ text: `📉 ${pick.away.split(' ')[0]} ${lang !== 'ro' ? 'weak away' : 'slab în deplasare'}`, color: '#ef4444' })

  const eloDiff = Math.abs(pick.home_elo - pick.away_elo)
  if (eloDiff >= 150) {
    const fav = pick.home_elo > pick.away_elo ? pick.home : pick.away
    badges.push({ text: `⚡ ${fav.split(' ')[0]} ${lang !== 'ro' ? `Elo favourite (+${eloDiff})` : `favorit Elo (+${eloDiff})`}`, color: '#a78bfa' })
  }

  // Model contrazice favoritul Elo — evidentiaza subtil
  const eloFavIsHome = pick.home_elo > pick.away_elo
  const modelUpset = eloDiff >= 100 && (
    (pick.prediction === 'H' && !eloFavIsHome) ||
    (pick.prediction === 'A' && eloFavIsHome)
  )
  if (modelUpset)
    badges.push({ text: lang !== 'ro' ? '🔄 Model vs Elo favourite' : '🔄 Model contra favorit Elo', color: '#94a3b8' })

  if (eloDiff < 30 && Math.abs(hVenue - aVenue) < 10)
    badges.push({ text: lang !== 'ro' ? '⚖️ Even match' : '⚖️ Meci echilibrat', color: '#6b7280' })

  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {badges.slice(0, 4).map((b, i) => (
        <span key={i} className="text-[9px] font-mono px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${b.color}18`, color: b.color, border: `1px solid ${b.color}30` }}>
          {b.text}
        </span>
      ))}
    </div>
  )
}

// ── Goal Suggestions ─────────────────────────────────────────────────────────
function GoalSuggestions({ pick, lang }: { pick: Pick; lang: import('@/lib/LangContext').Lang }) {
  const over25 = pick.over25_rate ?? 50
  const btts   = pick.btts_rate   ?? 50
  const chips: { label: string; prob: number; color: string }[] = []

  if (over25 >= 62)
    chips.push({ label: 'O 2.5', prob: over25, color: '#10b981' })
  else if (over25 <= 38)
    chips.push({ label: 'U 2.5', prob: 100 - over25, color: '#60a5fa' })

  if (btts >= 60)
    chips.push({ label: lang !== 'ro' ? 'BTTS Yes' : 'Ambele marchează', prob: btts, color: '#a78bfa' })
  else if (btts <= 35)
    chips.push({ label: lang !== 'ro' ? 'BTTS No' : 'Clean sheet posibil', prob: 100 - btts, color: '#f97316' })

  if (chips.length === 0) return null
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {lang !== 'ro' ? 'Goals' : 'Goluri'}
      </span>
      {chips.map(ch => (
        <span key={ch.label} style={{
          padding: '2px 9px', borderRadius: 99,
          background: `${ch.color}15`, border: `1px solid ${ch.color}35`,
          fontSize: 10, color: ch.color, fontFamily: 'monospace', fontWeight: 700,
          letterSpacing: '0.04em',
        }}>
          {ch.label} · {ch.prob}%
        </span>
      ))}
    </div>
  )
}

function FormBar({ pct, label }: { pct: number; label: string }) {
  const color = pct >= 60 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-500 font-mono w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-mono shrink-0" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ── Bet Builder ───────────────────────────────────────────────────────────────

function AddToBetBuilder({ pick }: { pick: Pick }) {
  const [added, setAdded] = useState(false)

  useEffect(() => {
    const bb = getBetBuilder()
    setAdded(bb.some(p => p.home === pick.home && p.away === pick.away))
  }, [pick.home, pick.away])

  function toggle() {
    const bb = getBetBuilder()
    if (added) {
      saveBetBuilder(bb.filter(p => !(p.home === pick.home && p.away === pick.away)))
      setAdded(false)
    } else {
      saveBetBuilder([...bb, pick])
      setAdded(true)
    }
  }

  return (
    <button onClick={toggle}
      className="text-[9px] font-bold px-2.5 py-1 rounded-lg font-mono"
      style={{
        background: added ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
        color: added ? '#4ade80' : '#6b7280',
        border: `1px solid ${added ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
        transition: 'all 0.15s',
      }}>
      {added ? '✓ În bilet' : '+ Bilet'}
    </button>
  )
}

// ── TelegramSendButton ───────────────────────────────────────────────────────

function TelegramSendButton({ picks }: { picks: Pick[] }) {
  const { lang } = useLang()
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const send = async () => {
    setStatus('sending')
    try {
      const token = getToken()
      const r = await fetch(`${API_BASE}/api/admin/send-telegram`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await r.json()
      setStatus(data.sent ? 'sent' : 'error')
      setTimeout(() => setStatus('idle'), 4000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  const label = {
    idle:    lang !== 'ro' ? '✈️ Send on Telegram' : '✈️ Trimite pe Telegram',
    sending: lang !== 'ro' ? '⏳ Sending...' : '⏳ Se trimite...',
    sent:    lang !== 'ro' ? '✅ Sent!' : '✅ Trimis!',
    error:   lang !== 'ro' ? '❌ Error — no combo valid' : '❌ Eroare — no combo valid',
  }[status]

  return (
    <div className="mb-4 fade-in">
      <button
        onClick={send}
        disabled={status === 'sending'}
        style={{
          width: '100%',
          padding: '10px 16px',
          borderRadius: 12,
          border: `1px solid ${status === 'sent' ? 'rgba(34,197,94,0.4)' : status === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(34,211,238,0.3)'}`,
          background: status === 'sent' ? 'rgba(34,197,94,0.1)' : status === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(34,211,238,0.08)',
          color: status === 'sent' ? '#4ade80' : status === 'error' ? '#f87171' : '#22d3ee',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: 'monospace',
          cursor: status === 'sending' ? 'wait' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {label}
      </button>
    </div>
  )
}

// ── PickCard ─────────────────────────────────────────────────────────────────

function PickCard({ pick, rank, userTier }: { pick: Pick; rank: number; userTier?: string }) {
  const { lang } = useLang()
  const c    = confColor(pick.confidence_level, lang)
  const pred = predLabel(pick, lang)
  const isLocked = (pick as any).vip_only && userTier !== 'vip' && userTier !== 'pro' && userTier !== 'owner'

  if (isLocked) {
    return (
      <div className="card p-4 mb-3" style={{ borderColor: 'rgba(234,179,8,0.4)', position: 'relative' }}>
        {/* Vizibil: liga, echipe, confidence */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{pick.flag}</span>
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{pick.league}</span>
            {pick.time && <span className="text-[10px] font-mono text-gray-600 ml-1">· {pick.time}</span>}
          </div>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full font-mono"
            style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: '#eab308', border: '1px solid rgba(234,179,8,0.3)' }}>
            👑 VIP
          </span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-bold text-white">{pick.home}</div>
          <div className="text-gray-600 font-bold text-sm mx-3">VS</div>
          <div className="text-base font-bold text-white text-right">{pick.away}</div>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-mono font-bold" style={{ color: '#eab308' }}>
            {lang !== 'ro' ? 'Confidence' : 'Certitudine'}: {pick.confidence}%
          </span>
          {pick.value_bet && <span className="text-[10px] font-mono" style={{ color: '#f59e0b' }}>💎 EDGE+</span>}
        </div>

        {/* Blur: predictie + probabilitati + Kelly */}
        <div style={{ filter: 'blur(6px)', pointerEvents: 'none', userSelect: 'none' }}>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {['1', 'X', '2'].map((l) => (
              <div key={l} className="rounded-lg py-2 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="text-[10px] font-mono text-gray-500">{l}</div>
                <div className="text-lg font-bold font-mono text-gray-400">??%</div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[11px] font-mono text-gray-600">
            <span>Pred: ??</span><span>Kelly: ??%</span>
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid rgba(234,179,8,0.15)' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {lang !== 'ro' ? 'Unlock prediction & probabilities' : 'Deblochează predicția și probabilitățile'}
          </span>
          <a href="/upgrade" style={{
            padding: '6px 14px', background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
            color: '#fff', borderRadius: 7, fontWeight: 700, fontSize: 12, textDecoration: 'none',
          }}>
            Pro →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4 mb-3" style={{ borderColor: c.border }}>

      {/* Header: Liga + ora + rank */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-base">{pick.flag}</span>
          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{pick.league}</span>
          {pick.time && <span className="text-[10px] font-mono text-gray-600 ml-1">· {pick.time}</span>}
        </div>
        <div className="flex items-center gap-2">
          {pick.high_confidence && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full font-mono"
              style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
              ⚡ HIGH CONF
            </span>
          )}
          <span className="text-[10px] font-mono text-gray-700">#{rank}</span>
        </div>
      </div>

      {/* Echipe */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-white leading-tight truncate">{pick.home}</div>
          <div className="text-[10px] font-mono text-gray-500 mt-0.5">
            Elo {pick.home_elo} · {lang !== 'ro' ? 'Home' : 'Acasă'} {pick.home_venue_form ?? pick.home_form}%
          </div>
        </div>
        <div className="text-gray-600 font-bold text-sm mx-3 shrink-0">VS</div>
        <div className="flex-1 min-w-0 text-right">
          <div className="text-base font-bold text-white leading-tight truncate">{pick.away}</div>
          <div className="text-[10px] font-mono text-gray-500 mt-0.5">
            Elo {pick.away_elo} · {lang !== 'ro' ? 'Away' : 'Depl.'} {pick.away_venue_form ?? pick.away_form}%
          </div>
        </div>
      </div>

      {/* Probabilitati */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {[
          { label: '1', val: pick.home_win, active: pick.prediction === 'H' },
          { label: 'X', val: pick.draw,     active: pick.prediction === 'D' },
          { label: '2', val: pick.away_win, active: pick.prediction === 'A' },
        ].map(({ label, val, active }) => (
          <div key={label} className="rounded-lg py-2 text-center"
            style={{
              background: active ? c.bg : 'rgba(255,255,255,0.03)',
              border: `1px solid ${active ? c.border : 'rgba(255,255,255,0.06)'}`,
            }}>
            <div className="text-[10px] font-mono text-gray-500 uppercase">{label}</div>
            <div className="text-lg font-bold font-mono" style={{ color: active ? c.text : '#6b7280' }}>
              {val != null ? `${val}%` : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Predictie + Confidence */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl"
        style={{ background: c.bg, border: `1px solid ${c.border}` }}>
        <div className="flex items-center gap-2">
          <span className="text-base">{pred.emoji}</span>
          <div>
            <div className="text-xs font-bold" style={{ color: c.text }}>
              {pred.short} — {pred.full}
            </div>
            <div className="text-[10px] font-mono text-gray-500">{lang !== 'ro' ? 'AI Prediction' : 'Predicție AI'}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold font-mono" style={{ color: c.text }}>
            {pick.confidence}%
          </div>
          <div className="text-[9px] font-mono" style={{ color: c.text }}>
            {c.label}
          </div>
        </div>
      </div>

      {/* BI Market Signals */}
      {pick.has_odds && (pick.value_bet || pick.upset_risk) && (
        <div className="flex flex-wrap gap-1.5 mt-2 mb-1">
          {pick.value_bet && (
            <span style={{
              background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
              color: '#f59e0b', fontSize: 10, fontWeight: 700, padding: '3px 8px',
              borderRadius: 6, fontFamily: 'monospace', letterSpacing: '0.05em',
            }}>
              ⚡ DIVERGENCE +{pick.edge}%
            </span>
          )}
          {pick.market_signal === 'VALUE_HOME' || pick.market_signal === 'VALUE_AWAY' ? (
            <span style={{
              background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.35)',
              color: '#10b981', fontSize: 10, fontWeight: 700, padding: '3px 8px',
              borderRadius: 6, fontFamily: 'monospace',
            }}>
              📊 {lang !== 'ro' ? 'MARKET UNDERVALUED' : 'PIAȚA SUBEVALUATĂ'}
            </span>
          ) : null}
          {pick.upset_risk && (
            <span style={{
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)',
              color: '#f87171', fontSize: 10, fontWeight: 700, padding: '3px 8px',
              borderRadius: 6, fontFamily: 'monospace',
            }}>
              ⚠️ {lang !== 'ro' ? 'UPSET RISK' : 'RISC SURPRIZĂ'}
            </span>
          )}
        </div>
      )}

      {/* Kelly Criterion */}
      {(() => {
        const kelly = computeKelly(pick.confidence, pick.edge, pick.has_odds ?? false)
        if (kelly === 0) return null
        const pct = Math.round(kelly * 100)
        return (
          <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest shrink-0">Kelly</span>
            <span className="text-[11px] font-bold font-mono text-indigo-400">{pct}% bankroll</span>
            <span className="text-[9px] text-gray-600 font-mono">· {lang !== 'ro' ? 'suggested stake' : 'miza sugerată'}</span>
          </div>
        )
      })()}

      {/* Goal suggestions (O/U 2.5 · BTTS) */}
      <GoalSuggestions pick={pick} lang={lang} />

      {/* Streak indicators + Share + Bet Builder */}
      <StreakBadges pick={pick} />
      <div className="flex gap-2 mt-2 flex-wrap">
        <button
          onClick={() => {
            const dateStr = pick.time
              ? `${new Date().toLocaleDateString('ro-RO')} · ${pick.time}`
              : new Date().toLocaleDateString('ro-RO')
            const text = buildShareCardWA(pick, dateStr)
            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
          }}
          className="text-[9px] font-bold px-2.5 py-1 rounded-lg font-mono"
          style={{ background: 'rgba(37,211,102,0.1)', color: '#25d366', border: '1px solid rgba(37,211,102,0.2)' }}>
          💬 WA
        </button>
        <button
          onClick={() => {
            const dateStr = pick.time
              ? `${new Date().toLocaleDateString('ro-RO')} · ${pick.time}`
              : new Date().toLocaleDateString('ro-RO')
            const text = buildShareCard(pick, dateStr)
            navigator.clipboard?.writeText(text).then(() => alert('Copiat pentru Telegram!'))
          }}
          className="text-[9px] font-bold px-2.5 py-1 rounded-lg font-mono"
          style={{ background: 'rgba(38,120,188,0.1)', color: '#2678bc', border: '1px solid rgba(38,120,188,0.2)' }}>
          ✈️ TG
        </button>
        <AddToBetBuilder pick={pick} />
      </div>
    </div>
  )
}

// ── 3 Ponturi Gratuite ───────────────────────────────────────────────────────

function FreePicks({ picks, userTier }: { picks: Pick[], userTier?: string }) {
  const { lang } = useLang()
  const [mode, setMode] = useState<'result' | 'goals'>('result')
  if (picks.length === 0) return null

  const oddSingle = (prob: number) => parseFloat(Math.max(1.20, 100 / (Math.max(prob, 1) * 1.08)).toFixed(2))

  // Top 3 picks valide (non-VIP, cu probabilitati reale)
  const seen = new Set<string>()
  const isPrivileged = userTier === 'vip' || userTier === 'pro' || userTier === 'owner'
  const validPicks: Pick[] = []
  for (const p of picks) {
    const hasData = p.home_win !== null && p.home_win !== undefined
    const isVip = (p as any).vip_only
    if (!hasData && !(isVip && isPrivileged)) continue
    if (isVip && !isPrivileged) continue
    const key = `${p.home}-${p.away}`
    if (!seen.has(key)) { seen.add(key); validPicks.push(p) }
  }

  const top3Result = validPicks.slice(0, 3)

  // Varianta goluri — Top 3 BTTS Yes (btts_rate direct din model, cote 1.55–1.85)
  interface GoalPick { pick: Pick; label: string; prob: number }
  const goalCandidates: GoalPick[] = []
  const seenGoals = new Set<string>()
  for (const p of validPicks) {
    const key = `${p.home}-${p.away}`
    if (seenGoals.has(key)) continue
    const btts = p.btts_rate ?? 50
    const bttsOdd = parseFloat((100 / (Math.max(btts, 1) * 1.08)).toFixed(2))
    if (btts >= 50 && bttsOdd >= 1.30) {
      goalCandidates.push({
        pick: p,
        label: lang !== 'ro' ? 'BTTS — Yes' : 'Ambele marchează',
        prob: btts,
      })
      seenGoals.add(key)
    }
  }
  goalCandidates.sort((a, b) => b.prob - a.prob)
  goalCandidates.splice(3)

  const top3 = mode === 'result' ? top3Result : goalCandidates.map(g => g.pick)
  if (top3.length < 1) return null

  const comboOdd = mode === 'result'
    ? top3Result.reduce((acc, p) => {
        const prob = p.prediction === 'H' ? p.home_win : p.prediction === 'A' ? p.away_win : p.draw
        return acc * oddSingle(prob)
      }, 1)
    : goalCandidates.slice(0, 3).reduce((acc, g) => acc * oddSingle(g.prob), 1)

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="mb-6 fade-in">
      <div className="rounded-2xl p-4 mb-3"
        style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(245,158,11,0.06))', border: '1px solid rgba(251,191,36,0.3)' }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-bold text-amber-400 uppercase tracking-widest">🎁 {lang !== 'ro' ? 'Free Analysis' : 'Analize Gratuite'}</div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {mode === 'result'
                ? (lang !== 'ro' ? 'Top 3 · Match result' : 'Top 3 · Rezultat meci')
                : (lang !== 'ro' ? 'Top 3 · Goals market' : 'Top 3 · Piața golurilor')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">{lang !== 'ro' ? 'Est. accumulator' : 'Acumulator est.'}</div>
            <div className="text-2xl font-bold font-mono text-amber-400">x{comboOdd.toFixed(2)}</div>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex gap-1 mb-3">
          {(['result', 'goals'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="flex-1 py-1.5 rounded-lg text-[11px] font-bold font-mono transition-all"
              style={{
                background: mode === m ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${mode === m ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.08)'}`,
                color: mode === m ? '#fbbf24' : '#6b7280',
              }}>
              {m === 'result' ? (lang !== 'ro' ? '⚽ 1X2' : '⚽ Rezultate') : (lang !== 'ro' ? '🎯 Goals' : '🎯 Goluri')}
            </button>
          ))}
        </div>

        {/* Picks */}
        {mode === 'result' ? (
          <div className="space-y-2">
            {top3Result.map((p, i) => {
              const pred = predLabel(p, lang)
              const prob = pred.prob
              const odd  = oddSingle(prob)
              const c    = confColor(p.confidence_level, lang)
              return (
                <div key={i} className="flex items-center gap-3 bg-black/20 rounded-xl px-3 py-2.5">
                  <span className="text-base shrink-0">{medals[i]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      {p.flag} {p.home} <span className="text-gray-500">vs</span> {p.away}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono"
                        style={{ backgroundColor: `${c.text}20`, color: c.text }}>
                        {pred.short} — {pred.full}
                      </span>
                      <span className="text-[10px] text-gray-600 font-mono">{p.league}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold font-mono text-amber-400">~{odd.toFixed(2)}</div>
                    <div className="text-[10px] font-mono text-gray-500">{prob}%</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : goalCandidates.length === 0 ? (
          <div className="text-center py-6 text-gray-600 text-xs font-mono">
            {lang !== 'ro' ? 'No clear goal signals today' : 'Niciun semnal clar pe goluri azi'}
          </div>
        ) : (
          <div className="space-y-2">
            {goalCandidates.slice(0, 3).map((g, i) => {
              const odd = oddSingle(g.prob)
              const color = g.prob >= 65 ? '#10b981' : '#f59e0b'
              return (
                <div key={i} className="flex items-center gap-3 bg-black/20 rounded-xl px-3 py-2.5">
                  <span className="text-base shrink-0">{medals[i]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      {g.pick.flag} {g.pick.home} <span className="text-gray-500">vs</span> {g.pick.away}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono"
                        style={{ backgroundColor: `${color}20`, color }}>
                        {g.label}
                      </span>
                      <span className="text-[10px] text-gray-600 font-mono">{g.pick.league}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold font-mono text-amber-400">~{odd.toFixed(2)}</div>
                    <div className="text-[10px] font-mono text-gray-500">{g.prob}%</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 pt-3 border-t border-amber-900/30 flex items-center justify-between gap-2">
          <div className="text-[10px] text-gray-600 font-mono">{lang !== 'ro' ? '* Estimated odds with 8% margin' : '* Cote estimate cu marjă 8%'}</div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const dateStr = formatDate(new Date().toISOString().split('T')[0])
                const text = buildAccumulatorCard(top3Result, dateStr)
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
              }}
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(37,211,102,0.15)', color: '#25d366', border: '1px solid rgba(37,211,102,0.3)' }}>
              💬 WhatsApp
            </button>
            <button
              onClick={() => {
                const dateStr = formatDate(new Date().toISOString().split('T')[0])
                const text = buildAccumulatorCard(top3Result, dateStr)
                navigator.clipboard?.writeText(text).then(() => alert(lang !== 'ro' ? 'Copied! Paste in Telegram.' : 'Copiat! Lipește în Telegram.'))
              }}
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(38,120,188,0.15)', color: '#2678bc', border: '1px solid rgba(38,120,188,0.3)' }}>
              ✈️ Telegram
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Banker of the Week ───────────────────────────────────────────────────────
function BankerCard({ picks }: { picks: Pick[] }) {
  const { lang } = useLang()
  const validPicks = picks.filter(p => p.home_win !== null && p.home_win !== undefined && !(p as any).vip_only)
  if (!validPicks.length) return null

  // Candidati: toate cele 3 directii din fiecare pick
  type Cand = { pick: Pick; dir: 'H' | 'D' | 'A'; prob: number; oddVal: number; isReal: boolean; score: number }
  const candidates: Cand[] = []
  for (const p of validPicks) {
    const opts: Array<{ dir: 'H' | 'D' | 'A'; prob: number; realOdd: number | null }> = [
      { dir: 'H', prob: p.home_win, realOdd: p.odds_home ?? null },
      { dir: 'D', prob: p.draw,     realOdd: p.odds_draw ?? null },
      { dir: 'A', prob: p.away_win, realOdd: p.odds_away ?? null },
    ]
    for (const o of opts) {
      if (!o.prob || o.prob < 55) continue
      const isReal = !!o.realOdd
      const oddVal = o.realOdd ?? Math.max(1.01, 100 / (o.prob * 1.08))
      if (oddVal < 1.50) continue
      candidates.push({ pick: p, dir: o.dir, prob: o.prob, oddVal, isReal, score: o.prob * Math.log(oddVal) })
    }
  }
  // Sortam dupa scor (probabilitate × log(cota)) — cel mai bun raport
  candidates.sort((a, b) => b.score - a.score)

  // Daca nu gasim nimic cu cota >= 1.50, fallback la cel mai sigur pick
  const best = candidates[0]
  const banker = best ? best.pick : validPicks.sort((a, b) => b.confidence - a.confidence)[0]
  const bankerDir: 'H' | 'D' | 'A' = best ? best.dir : banker.prediction
  const bankerProb = best ? best.prob : (bankerDir === 'H' ? banker.home_win : bankerDir === 'A' ? banker.away_win : banker.draw)
  const bankerOdd = best ? best.oddVal.toFixed(2) : Math.max(1.01, 100 / (bankerProb * 1.08)).toFixed(2)
  const bankerIsReal = best ? best.isReal : false

  const dirLabel = (dir: 'H' | 'D' | 'A') => {
    if (dir === 'H') return { short: '1', full: banker.home }
    if (dir === 'A') return { short: '2', full: banker.away }
    return { short: 'X', full: lang !== 'ro' ? 'Draw' : 'Egal' }
  }
  const pred = dirLabel(bankerDir)
  const odd = bankerOdd
  const isReal = bankerIsReal

  return (
    <div className="mb-4 fade-in">
      <div className="rounded-2xl p-4"
        style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(109,40,217,0.08))', border: '1px solid rgba(139,92,246,0.35)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">🏦</span>
          <div>
            <div className="text-xs font-bold text-purple-400 uppercase tracking-widest">Banker of the Day</div>
            <div className="text-[10px] text-gray-500 font-mono">{lang !== 'ro' ? 'Highest confidence · Recommended analysis' : 'Cea mai mare convingere · Analiză recomandată'}</div>
          </div>
          <div className="ml-auto">
            <span className="text-[9px] font-bold px-2 py-1 rounded-full font-mono"
              style={{ backgroundColor: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.4)' }}>
              {bankerProb}% prob
            </span>
          </div>
        </div>
        <div className="bg-black/20 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-white">{banker.flag} {banker.home} <span className="text-gray-500">vs</span> {banker.away}</div>
            <div className="text-xs font-mono mt-1">
              <span className="text-purple-300 font-bold">{pred.short} — {pred.full}</span>
              <span className="text-gray-600 ml-2">{banker.league}</span>
            </div>
          </div>
          <div className="text-right ml-4 shrink-0">
            <div className="text-2xl font-bold font-mono text-purple-400">{isReal ? '' : '~'}{odd}</div>
            <div className="text-[9px] font-mono" style={{ color: isReal ? '#10b981' : '#6b7280' }}>
              {isReal ? (lang !== 'ro' ? '✓ live odds' : '✓ cotă live') : (lang !== 'ro' ? 'estimated odds' : 'cotă estimată')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Loading ───────────────────────────────────────────────────────────────────

function LoadingState() {
  const { lang } = useLang()
  const [step, setStep] = useState(0)
  const steps = lang !== 'ro' ? [
    "Loading today's matches...",
    'AI analysing each match...',
    'Computing Elo + form + probabilities...',
    'Filtering by confidence...',
  ] : [
    'Se încarcă meciurile zilei...',
    'AI analizează fiecare meci...',
    'Calculez Elo + formă + probabilități...',
    'Filtrare după confidence...',
  ]
  useEffect(() => {
    const t = setInterval(() => setStep(s => Math.min(s + 1, steps.length - 1)), 1800)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="card p-10 text-center">
      <div className="spinner mx-auto mb-6" />
      <div className="text-green-400 text-sm font-mono mb-1">{steps[step]}</div>
      <div className="text-gray-600 text-[11px] font-mono">{lang !== 'ro' ? 'XGBoost model · 225K matches trained' : 'Model XGBoost · 225K meciuri antrenament'}</div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface VipStats { total: number; wins: number; accuracy: number; this_month_total: number; this_month_wins: number; this_month_accuracy: number }
interface PickResult { date: string; home: string; away: string; result: 'win' | 'loss' | 'void'; confidence: number }

// ── Model Streak Bar ──────────────────────────────────────────────────────────
function ModelStreakBar({ results, lang }: { results: PickResult[]; lang: import('@/lib/LangContext').Lang }) {
  if (!results.length) return null
  const last10 = results.slice(0, 10).reverse()  // oldest → newest
  const decisive = results.filter(r => r.result !== 'void')

  // Calculate current streak
  let streak = 0
  let streakType: 'win' | 'loss' | null = null
  for (const r of results) {  // results is newest-first from API
    if (r.result === 'void') continue
    if (streakType === null) { streakType = r.result; streak = 1 }
    else if (r.result === streakType) streak++
    else break
  }

  const dot = (r: PickResult, i: number) => {
    const color = r.result === 'win' ? '#22c55e' : r.result === 'loss' ? '#ef4444' : '#4b5563'
    const bg    = r.result === 'win' ? 'rgba(34,197,94,0.2)' : r.result === 'loss' ? 'rgba(239,68,68,0.2)' : 'rgba(75,85,99,0.2)'
    const label = r.result === 'win' ? 'W' : r.result === 'loss' ? 'L' : '—'
    return (
      <span key={i} title={`${r.home} vs ${r.away} · ${r.result.toUpperCase()}`}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: '50%',
          background: bg, border: `1px solid ${color}50`,
          fontSize: 8, fontWeight: 700, color, fontFamily: 'monospace',
        }}>
        {label}
      </span>
    )
  }

  const acc = decisive.length > 0
    ? Math.round(decisive.filter(r => r.result === 'win').length / decisive.length * 100)
    : null

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <span style={{ fontSize: 9, color: '#4b5563', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
        {lang !== 'ro' ? 'Last 10' : 'Ultimele 10'}
      </span>
      <div className="flex items-center gap-0.5">
        {last10.map((r, i) => dot(r, i))}
      </div>
      {streakType && streak >= 2 && (
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: 'monospace',
          color: streakType === 'win' ? '#22c55e' : '#ef4444',
          whiteSpace: 'nowrap',
        }}>
          {streak}{streakType === 'win' ? '🔥' : '❄️'}
        </span>
      )}
      {acc !== null && (
        <span style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          · {acc}%
        </span>
      )}
    </div>
  )
}

export default function DailyPage() {
  const [data, setData]               = useState<DailyResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState<'all' | 'high'>('all')
  const [error, setError]             = useState('')
  const [notifPerm, setNotifPerm]     = useState<string>('default')
  const [user, setUser]               = useState<AuthUser | null>(null)
  const [vipStats, setVipStats]       = useState<VipStats | null>(null)
  const [streakResults, setStreakResults] = useState<PickResult[]>([])
  const { lang }                      = useLang()
  const router                        = useRouter()

  useEffect(() => { setUser(getUser()) }, [])

  useEffect(() => {
    setLoading(true)
    setData(null)
    const token = getToken()
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    Promise.all([
      fetch(`${API_BASE}/api/daily?min_confidence=0.55`, { headers: authHeaders }).then(r => r.json()).then(d => {
        // Daca nu sunt picks la 55%, cade la 45%
        if (!d?.picks?.length) return fetch(`${API_BASE}/api/daily?min_confidence=0.45`, { headers: authHeaders }).then(r => r.json())
        return d
      }),
      fetch(`${API_BASE}/api/track-record/vip`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/track-record/history?limit=10`).then(r => r.json()).catch(() => null),
    ]).then(([d, v, h]) => {
      setData(d)
      if (v) setVipStats(v)
      if (h?.results) setStreakResults(h.results)
      setLoading(false)
    }).catch(() => setLoading(false))
    if ('Notification' in window) setNotifPerm(Notification.permission)
  }, [])

  const enableNotifications = async () => {
    if (!('Notification' in window)) return
    const perm = await Notification.requestPermission()
    setNotifPerm(perm)
    if (perm === 'granted') {
      new Notification('🎯 Oxiano activat!', {
        body: 'Vei fi notificat când apar pick-uri noi cu confidence ridicat.',
        icon: '/logo.png',
      })
    }
  }

  const picks = data?.picks ?? []
  const shown = filter === 'high' ? picks.filter(p => p.high_confidence) : picks

  function shareText() {
    const top = shown.slice(0, 5)
    const lines = top.map((p, i) => {
      const pred = predLabel(p)
      return `${i + 1}. ${p.flag} ${p.home} vs ${p.away}\n   ${pred.short} — ${pred.full} · ${p.confidence}% conf`
    }).join('\n\n')
    return `🎯 OXIANO — Predicțiile zilei ${formatDate(today())}\n\n${lines}\n\n🤖 Model AI · oxiano.com`
  }

  return (
    <div className="app-bg grid-bg" style={{ minHeight: '100vh', overflowX: 'hidden' }}>


      <main className="max-w-2xl mx-auto px-4 py-8">

        {/* Hero */}
        <div className="text-center mb-6 fade-in">
          <div className="text-4xl mb-2">🎯</div>
          <h1 className="font-display text-4xl text-white mb-1" style={{ letterSpacing: '0.05em' }}>
            {lang !== 'ro' ? 'DAILY ANALYSIS' : 'ANALIZA ZILEI'}
          </h1>
          <div className="text-green-400 text-sm font-mono uppercase tracking-widest mb-1">
            {data ? formatDate(data.date) : formatDate(today())}
            {data && data.date !== today() && (
              <span className="text-yellow-500 text-[10px] ml-2">(next matchday)</span>
            )}
          </div>
          <p className="text-gray-500 text-xs font-mono">
            {lang !== 'ro' ? 'XGBoost + Elo · 225K matches trained · Sorted by confidence' : 'XGBoost + Elo · 225K meciuri antrenament · Sortat după confidence'}
          </p>

          {/* VIP accuracy pill */}
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)' }}>
              <span className="text-sm">👑</span>
              <span className="text-[11px] font-bold font-mono text-amber-400">VIP Picks</span>
              <span className="text-[11px] font-mono text-gray-400">
                {vipStats && vipStats.this_month_total > 0
                  ? `${vipStats.this_month_wins}/${vipStats.this_month_total} · ${vipStats.this_month_accuracy}% ${lang !== 'ro' ? 'this month' : 'luna aceasta'}`
                  : lang !== 'ro' ? '~78.5% accuracy (backtest)' : '~78.5% acuratețe (backtest)'}
              </span>
              <a href="/upgrade" className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1"
                style={{ background: 'rgba(234,179,8,0.2)', color: '#fbbf24' }}>
                {lang !== 'ro' ? 'Pro $20 →' : 'Pro 99 RON →'}
              </a>
            </div>
          </div>

          {/* Model streak bar */}
          {streakResults.length > 0 && (
            <div className="flex justify-center mt-2">
              <ModelStreakBar results={streakResults} lang={lang} />
            </div>
          )}

          {notifPerm !== 'granted' && notifPerm !== 'denied' && (
            <button onClick={enableNotifications}
              className="mt-3 px-4 py-2 rounded-full text-xs font-bold font-mono transition-all"
              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}>
              🔔 {lang !== 'ro' ? 'Enable alerts for new picks' : 'Activează alertele pentru pick-uri noi'}
            </button>
          )}
          {notifPerm === 'granted' && (
            <div className="mt-3 text-[10px] font-mono text-green-600">🔔 {lang !== 'ro' ? 'Alerts active' : 'Alerte active'}</div>
          )}
        </div>


        {loading && (
          <div>
            {[0,1,2,3].map(i => <PickSkeleton key={i} />)}
          </div>
        )}
        {!loading && (!data || data.picks?.length === 0) && (
          <div className="card p-8 text-center" style={{ border: '1px solid rgba(34,197,94,0.15)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
            <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {lang !== 'ro' ? 'Picks being calculated...' : 'Picks în curs de calcul...'}
            </div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              {lang !== 'ro'
                ? 'Auto-updated at 07:00 and 13:00 EET (Eastern European Time).'
                : 'Actualizare automată la 07:00 și 13:00 ora României (EET).'}
            </div>
          </div>
        )}

        {!loading && data && data.picks?.length > 0 && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {[
                { label: lang !== 'ro' ? 'Matches analysed' : 'Meciuri analizate', val: data.total_fixtures, color: '#818cf8' },
                { label: lang !== 'ro' ? 'Active picks' : 'Pick-uri active',        val: data.total_picks,    color: '#f59e0b' },
                { label: 'High confidence',                                          val: data.high_conf,      color: '#22c55e' },
              ].map(({ label, val, color }) => (
                <div key={label} className="card p-3 text-center">
                  <div className="text-2xl font-bold font-mono" style={{ color }}>{val}</div>
                  <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Track Record Banner */}
            <div className="block mb-5 fade-in cursor-pointer" onClick={() => router.push('/track-record')}>
              <div className="rounded-2xl px-4 py-3 flex items-center justify-between"
                style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,185,129,0.04))', border: '1px solid rgba(34,197,94,0.2)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">📊</span>
                  <div>
                    <div className="text-xs font-bold text-green-400 font-mono uppercase tracking-widest">
                      {lang !== 'ro' ? 'Live Performance' : 'Performanță Live'}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                      {lang !== 'ro' ? 'Every pick verified in real time · 100% transparent' : 'Fiecare pick verificat în timp real · 100% transparent'}
                    </div>
                  </div>
                </div>
                <span className="text-green-400 font-mono text-sm font-bold shrink-0">→</span>
              </div>
            </div>

            {/* 3 Ponturi Gratuite */}
            <FreePicks picks={picks} userTier={user?.tier} />

            {/* Banker of the Week */}
            <BankerCard picks={picks} />

            {/* Buton Telegram manual — doar owner/pro */}
            {(user?.tier === 'pro' || user?.tier === 'vip' || user?.tier === 'owner') && (
              <TelegramSendButton picks={picks} />
            )}

            {/* Filter tabs */}
            <div className="flex gap-2 mb-5">
              {[
                { key: 'all',  label: `${lang !== 'ro' ? 'All' : 'Toate'} (${data.total_picks})` },
                { key: 'high', label: `⚡ High Conf (${data.high_conf})` },
              ].map(({ key, label }) => (
                <button key={key}
                  onClick={() => setFilter(key as any)}
                  className="flex-1 py-2 rounded-xl text-sm font-mono font-bold transition-all"
                  style={{
                    background: filter === key ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${filter === key ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: filter === key ? '#22c55e' : '#6b7280',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Accuracy info */}
            {filter === 'high' && data.high_conf > 0 && (
              <div className="mb-4 px-4 py-3 rounded-xl text-xs font-mono"
                style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <span className="text-green-400 font-bold">⚡ High Confidence</span>
                <span className="text-gray-400 ml-2">= confidence ≥ 60% · {lang !== 'ro' ? 'real accuracy ~70%+ on 33K match backtest' : 'acuratețe reală ~70%+ pe backtesting 33K meciuri'}</span>
              </div>
            )}

            {/* Picks */}
            {shown.length === 0 ? (
              <div className="card p-10 text-center fade-in">
                <div style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.3 }}>
                  {filter === 'high' ? '⚡' : '📅'}
                </div>
                <div className="font-display text-xl text-gray-500 tracking-widest mb-2">
                  {filter === 'high'
                    ? (lang !== 'ro' ? 'No HIGH confidence picks' : 'Niciun pick HIGH confidence')
                    : (lang !== 'ro' ? 'No matches available today' : 'Niciun meci disponibil azi')}
                </div>
                <div className="text-gray-600 text-sm font-mono mb-4">
                  {filter === 'high'
                    ? (lang !== 'ro' ? 'Model found no matches with confidence ≥65% today.' : 'Modelul nu a găsit meciuri cu confidence ≥65% azi.')
                    : (lang !== 'ro' ? 'Supported leagues have no scheduled matches. Come back tomorrow.' : 'Ligile suportate nu au meciuri programate. Revino mâine.')}
                </div>
                {filter === 'high' && (
                  <button
                    onClick={() => setFilter('all')}
                    className="text-xs font-mono px-4 py-2 rounded-lg"
                    style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>
                    {lang !== 'ro' ? 'See all outputs →' : 'Vezi toate analizele →'}
                  </button>
                )}
              </div>
            ) : (
              (() => {
                const isFree = !user || user.tier === 'free'
                const FREE_LIMIT = 3
                return (
                  <>
                    {shown.map((pick, i) => {
                      if (isFree && i >= FREE_LIMIT) return null
                      return <PickCard key={i} pick={pick} rank={i + 1} userTier={user?.tier} />
                    })}
                    {isFree && shown.length > FREE_LIMIT && (
                      <div className="relative mt-2 mb-4">
                        {/* Picks blur preview */}
                        <div style={{ filter: 'blur(4px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.5 }}>
                          {shown.slice(FREE_LIMIT, FREE_LIMIT + 2).map((pick, i) => (
                            <PickCard key={i} pick={pick} rank={FREE_LIMIT + i + 1} userTier="free" />
                          ))}
                        </div>
                        {/* CTA overlay */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl"
                          style={{ background: 'linear-gradient(180deg, transparent 0%, rgba(10,17,40,0.97) 40%)' }}>
                          <div className="text-center px-6 py-6">
                            <div className="text-2xl mb-2">🔒</div>
                            <div className="text-white font-bold text-base mb-1">
                              {lang !== 'ro' ? `${shown.length - FREE_LIMIT} more outputs locked` : `Încă ${shown.length - FREE_LIMIT} analize blocate`}
                            </div>
                            <div className="text-gray-400 text-xs font-mono mb-4">
                              {lang !== 'ro' ? 'Upgrade to Analyst to unlock all outputs + Kelly% + stats' : 'Upgrade la Analyst pentru toate analizele + Kelly% + statistici'}
                            </div>
                            <a href="/upgrade"
                              className="inline-block px-6 py-2.5 rounded-xl font-bold text-sm"
                              style={{ background: 'linear-gradient(135deg, #22d3ee, #3b82f6)', color: '#000' }}>
                              {lang !== 'ro' ? '⚡ Unlock all outputs — $8/mo' : '⚡ Deblochează toate — 39 RON/lună'}
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()
            )}

            {/* Share */}
            {shown.length > 0 && (
              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText())}`, '_blank')}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)', color: 'white' }}>
                  📤 WhatsApp
                </button>
                <button
                  onClick={() => window.open(`https://t.me/share/url?url=oxiano.com&text=${encodeURIComponent(shareText())}`, '_blank')}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', color: 'white' }}>
                  ✈️ Telegram
                </button>
              </div>
            )}

            {/* Tracker personal */}
            <PersonalTracker picks={shown} />

            {/* Model info */}
            <div className="card p-5 mt-6">
              <div className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-3 text-center">
                {lang !== 'ro' ? 'ℹ️ How it works' : 'ℹ️ Cum funcționează'}
              </div>
              <div className="space-y-2 text-xs text-gray-500 font-mono">
                <div className="flex items-start gap-2">
                  <span className="text-green-400 shrink-0">🤖</span>
                  <span>{lang !== 'ro' ? 'XGBoost model trained on 225,000 matches from 20+ European leagues' : 'Model XGBoost antrenat pe 225,000 meciuri din 20+ ligi europene'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-400 shrink-0">📊</span>
                  <span>{lang !== 'ro' ? '84 features: bookmaker odds, Elo per league, recent form, H2H, xG' : '84 features: cote bookmakers, Elo per ligă, formă recentă, H2H, xG'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-400 shrink-0">⚡</span>
                  <span>{lang !== 'ro' ? 'High Confidence (≥60%): ~70% accuracy on 33,572 match backtest' : 'High Confidence (≥60%): ~70% acuratețe pe backtesting 33,572 meciuri'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-gray-600 shrink-0">⚠️</span>
                  <span>{lang !== 'ro' ? 'Educational purpose only. Not financial or betting advice.' : 'Scop educațional. Nu reprezintă sfaturi financiare sau de pariuri.'}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-green-900/30 mt-12 py-6">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-xs font-mono text-gray-700">
            {lang !== 'ro' ? 'Oxiano — Educational purpose only. Not betting advice.' : 'Oxiano — Scop educațional. Nu reprezintă sfaturi de pariuri.'}
          </p>
          <a href="/privacy" className="text-xs font-mono text-green-600 hover:text-green-400 mt-1 block">
            {lang !== 'ro' ? 'Privacy Policy' : 'Politică de confidențialitate'}
          </a>
        </div>
      </footer>
    </div>
  )
}
