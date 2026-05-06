'use client'

import { useState, useEffect } from 'react'
import { detectLang, t } from '../i18n'
import { getUser, getToken, authHeaders, login, register, logout as logoutAuth } from '@/lib/auth'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://football-predictor-vlpp.onrender.com'

interface TrackedMatch {
  id: string; home: string; away: string; league: string; flag: string
  date: string; time: string; prediction: string; market: string
  home_win: number; draw: number; away_win: number
  result: 'correct' | 'wrong' | 'pending'; addedAt: string
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtDate(d: string) {
  if (!d) return ''
  const [y,m,day] = d.split('-')
  return `${day}.${m}.${y}`
}
function dateLabel(d: string) {
  const todayStr = today()
  const tmDate = new Date(); tmDate.setDate(tmDate.getDate() + 1)
  const tm = `${tmDate.getFullYear()}-${String(tmDate.getMonth()+1).padStart(2,'0')}-${String(tmDate.getDate()).padStart(2,'0')}`
  const ydDate = new Date(); ydDate.setDate(ydDate.getDate() - 1)
  const yd = `${ydDate.getFullYear()}-${String(ydDate.getMonth()+1).padStart(2,'0')}-${String(ydDate.getDate()).padStart(2,'0')}`
  if (d === todayStr) return 'ðŸ“… Azi'
  if (d === tm) return 'ðŸ“… MÃ¢ine'
  if (d === yd) return 'ðŸ“… Ieri'
  return `ðŸ“… ${fmtDate(d)}`
}
function groupByDate(matches: TrackedMatch[]) {
  const groups: Record<string, TrackedMatch[]> = {}
  for (const m of matches) {
    const d = m.date || 'fÄƒrÄƒ datÄƒ'
    if (!groups[d]) groups[d] = []
    groups[d].push(m)
  }
  return groups
}
function shouldArchive(match: TrackedMatch): boolean {
  if (match.result === 'pending') return false
  const todayStr = today()
  if (match.date < todayStr) return true
  if (match.date === todayStr) {
    const now = new Date()
    if (now.getHours() > 23 || (now.getHours() === 23 && now.getMinutes() >= 55)) return true
  }
  return false
}
function rateColor(rate: number | null) {
  if (rate === null) return '#6b7280'
  return rate >= 60 ? '#10b981' : rate >= 45 ? '#f59e0b' : '#ef4444'
}

// â”€â”€ Auth Form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function AuthForm({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit() {
    if (!email || !password) { setError('CompleteazÄƒ email È™i parola!'); return }
    if (password.length < 6) { setError('Parola trebuie sÄƒ aibÄƒ minim 6 caractere!'); return }
    setLoading(true); setError(''); setSuccess('')
    try {
      if (mode === 'register') {
        await register(email, password)
        setSuccess('Cont creat! EÈ™ti conectat automat.')
        onAuth()
      } else {
        await login(email, password)
        onAuth()
      }
    } catch (e: any) {
      setError(e.message || 'Eroare. ÃŽncearcÄƒ din nou.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ overflowX: 'hidden', minHeight: '100vh' }} className="app-bg grid-bg">

      <main className="max-w-sm mx-auto px-4 py-12">
        <div className="text-center mb-8 fade-in">
          <div className="text-5xl mb-3">ðŸ”</div>
          <h1 className="font-display text-3xl text-white tracking-widest mb-2">
            {mode === 'login' ? 'CONECTARE' : 'CONT NOU'}
          </h1>
          <p className="text-gray-500 text-xs font-mono uppercase tracking-widest">
            {mode === 'login' ? 'IntrÄƒ Ã®n contul tÄƒu personal' : 'CreeazÄƒ-È›i contul gratuit'}
          </p>
        </div>

        <div className="card p-6 fade-in">
          {/* Toggle login/register */}
          <div className="flex gap-1 mb-6 bg-gray-800/50 p-1 rounded-xl">
            <button
              onClick={() => { setMode('login'); setError(''); setSuccess('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'login' ? 'bg-blue-600 text-white' : 'text-gray-500'}`}>
              Conectare
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); setSuccess('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'register' ? 'bg-blue-600 text-white' : 'text-gray-500'}`}>
              Cont nou
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Email</label>
              <input
                className="input-styled"
                type="email"
                placeholder="email@exemplu.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
<div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">ParolÄƒ</label>
              <div className="relative">
                <input
                  className="input-styled"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minim 6 caractere"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-sm">
                  {showPassword ? 'ðŸ™ˆ' : 'ðŸ‘ï¸'}
                </button>
              </div>
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-900/20 border border-red-700/40 text-red-400 text-xs font-mono">
                âŒ {error}
              </div>
            )}
            {success && (
              <div className="px-3 py-2 rounded-lg bg-emerald-900/20 border border-emerald-700/40 text-emerald-400 text-xs font-mono">
                âœ… {success}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn-accent w-full disabled:opacity-50">
              {loading ? 'â³ Se proceseazÄƒ...' : mode === 'login' ? 'ðŸ” Conectare' : 'âœ… Creare cont'}
            </button>
          </div>

          <div className="mt-4 text-center text-[10px] text-gray-600 font-mono">
            Contul tÄƒu e gratuit È™i Ã®È›i pÄƒstreazÄƒ pronosticurile pe orice dispozitiv
          </div>
        </div>
      </main>

      <footer className="border-t border-blue-900/40 mt-12 py-6">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-xs font-mono text-gray-700">Oxiano â€” Scop educaÈ›ional.</p>
          <a href="/privacy" className="text-xs font-mono text-blue-600 hover:text-blue-400 mt-1 block">PoliticÄƒ de confidenÈ›ialitate</a>
        </div>
      </footer>
    </div>
  )
}

// â”€â”€ Backend API helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function dbLoad(_userId: string): Promise<TrackedMatch[]> {
  try {
    const res = await fetch(`${API}/api/tracked-matches`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = await res.json()
    return (data.matches || []).map((row: any) => ({
      id: String(row.id), home: row.home, away: row.away, league: row.league, flag: row.flag,
      date: row.date, time: row.time || '', prediction: row.prediction, market: row.market,
      home_win: 45, draw: 27, away_win: 28,
      result: row.result as 'correct' | 'wrong' | 'pending', addedAt: row.added_at,
    }))
  } catch { return [] }
}
async function dbAdd(m: TrackedMatch, _userId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/api/tracked-matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        home: m.home, away: m.away, league: m.league, flag: m.flag,
        date: m.date, time: m.time, prediction: m.prediction, market: m.market,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return String(data.id)
  } catch { return null }
}
async function dbUpdate(id: string, result: string) {
  try {
    await fetch(`${API}/api/tracked-matches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ result }),
    })
  } catch {}
}
async function dbDelete(id: string) {
  try {
    await fetch(`${API}/api/tracked-matches/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
  } catch {}
}

function RateBar({ label, correct, total, highlight }: { label: string; correct: number; total: number; highlight?: boolean }) {
  const rate = total > 0 ? Math.round((correct / total) * 100) : null
  const color = rateColor(rate)
  return (
    <div className={`rounded-xl p-4 ${highlight ? 'bg-blue-900/20 border border-blue-600/30' : 'bg-gray-800/40'}`}>
      <div className="flex justify-between items-center mb-2">
        <span className={`text-xs font-bold uppercase tracking-widest ${highlight ? 'text-blue-300' : 'text-gray-400'}`}>{label}</span>
        <span className="text-2xl font-bold font-mono" style={{ color: rate !== null ? color : '#4b5563' }}>
          {rate !== null ? `${rate}%` : 'â€”'}
        </span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-1">
        {rate !== null && <div className="h-full rounded-full transition-all duration-700" style={{ width: `${rate}%`, backgroundColor: color }} />}
      </div>
      <div className="text-[10px] text-gray-600 font-mono">
        {total === 0 ? 'Niciun pronostic finalizat' : `${correct} corecte din ${total} finalizate`}
      </div>
    </div>
  )
}

function LeagueStats({ matches }: { matches: TrackedMatch[] }) {
  const resolved = matches.filter(m => m.result !== 'pending')
  if (resolved.length === 0) return null
  const byLeague: Record<string, { flag: string; correct: number; total: number }> = {}
  for (const m of resolved) {
    if (!byLeague[m.league]) byLeague[m.league] = { flag: m.flag, correct: 0, total: 0 }
    byLeague[m.league].total++
    if (m.result === 'correct') byLeague[m.league].correct++
  }
  const sorted = Object.entries(byLeague)
    .map(([league, data]) => ({ league, ...data, rate: Math.round((data.correct / data.total) * 100) }))
    .sort((a, b) => b.total - a.total).slice(0, 6)
  return (
    <div className="card p-5 mt-4">
      <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-4 text-center">ðŸŒ PerformanÈ›Äƒ pe ligÄƒ</div>
      <div className="space-y-2">
        {sorted.map(({ league, flag, correct, total, rate }) => (
          <div key={league} className="flex items-center gap-3">
            <span className="text-lg shrink-0">{flag}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-300 truncate">{league}</span>
                <span className="text-xs font-bold font-mono shrink-0 ml-2" style={{ color: rateColor(rate) }}>{rate}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${rate}%`, backgroundColor: rateColor(rate) }} />
              </div>
              <div className="text-[9px] text-gray-700 font-mono mt-0.5">{correct}/{total} corecte</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WeeklyChart({ matches }: { matches: TrackedMatch[] }) {
  const weeks: { label: string; correct: number; total: number }[] = []
  for (let i = 3; i >= 0; i--) {
    const start = new Date(); start.setDate(start.getDate() - (i + 1) * 7)
    const end = new Date(); end.setDate(end.getDate() - i * 7)
    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]
    const weekMatches = matches.filter(m => m.result !== 'pending' && m.date >= startStr && m.date < endStr)
    weeks.push({ label: `S-${i === 0 ? 'asta' : i}`, correct: weekMatches.filter(m => m.result === 'correct').length, total: weekMatches.length })
  }
  if (weeks.every(w => w.total === 0)) return null
  const maxTotal = Math.max(...weeks.map(w => w.total), 1)
  return (
    <div className="card p-5 mt-4">
      <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-4 text-center">ðŸ“ˆ PerformanÈ›Äƒ sÄƒptÄƒmÃ¢nalÄƒ</div>
      <div className="flex items-end justify-around gap-2" style={{ height: '80px' }}>
        {weeks.map((w, i) => {
          const rate = w.total > 0 ? Math.round((w.correct / w.total) * 100) : null
          const color = rateColor(rate)
          const height = w.total > 0 ? Math.max((w.total / maxTotal) * 70, 10) : 4
          return (
            <div key={i} className="flex flex-col items-center gap-1 flex-1">
              <div className="text-[9px] font-mono font-bold" style={{ color: rate !== null ? color : '#4b5563' }}>
                {rate !== null ? `${rate}%` : 'â€”'}
              </div>
              <div className="w-full rounded-t-md" style={{ height: `${height}px`, backgroundColor: rate !== null ? color : '#374151', opacity: 0.8 }} />
              <div className="text-[9px] text-gray-600 font-mono">{w.label}</div>
              <div className="text-[8px] text-gray-700 font-mono">{w.total > 0 ? `${w.correct}/${w.total}` : 'â€”'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatsPanel({ matches }: { matches: TrackedMatch[] }) {
  const yesterday = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()
  const todayStr = today()
  const resolved = matches.filter(m => m.result !== 'pending')
  const correct  = resolved.filter(m => m.result === 'correct').length
  const wrong    = resolved.filter(m => m.result === 'wrong').length
  const pending  = matches.filter(m => m.result === 'pending').length
  const ydResolved = matches.filter(m => m.date === yesterday && m.result !== 'pending')
  const tdResolved = matches.filter(m => m.date === todayStr && m.result !== 'pending')
  if (matches.length === 0) return null
  return (
    <div className="space-y-4 mb-6">
      <div className="card p-5">
        <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-3 text-center">ðŸ“Š Statistici generale</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total', value: matches.length, color: '#60a5fa' },
            { label: 'âœ… Corecte', value: correct, color: '#10b981' },
            { label: 'âŒ GreÈ™ite', value: wrong, color: '#ef4444' },
            { label: 'â³ AÈ™teptare', value: pending, color: '#f59e0b' },
          ].map(s => (
            <div key={s.label} className="bg-gray-800/50 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <RateBar label="ðŸ† RatÄƒ totalÄƒ" correct={correct} total={resolved.length} highlight />
          <RateBar label={`ðŸ“… Ieri (${fmtDate(yesterday)})`} correct={ydResolved.filter(m=>m.result==='correct').length} total={ydResolved.length} />
          <RateBar label={`ðŸ“… Azi (${fmtDate(todayStr)})`} correct={tdResolved.filter(m=>m.result==='correct').length} total={tdResolved.length} />
        </div>
        {resolved.length >= 2 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-800">
            <span className="text-[10px] text-gray-600 uppercase tracking-widest shrink-0">Ultimele 7:</span>
            <div className="flex gap-1">
              {[...resolved].slice(-7).map((m, i) => (
                <div key={i} className={`w-6 h-6 rounded text-xs flex items-center justify-center font-bold ${m.result==='correct' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                  {m.result==='correct' ? 'âœ“' : 'âœ—'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <WeeklyChart matches={matches} />
      <LeagueStats matches={matches} />
    </div>
  )
}

function MatchCard({ match, onResult, onDelete }: {
  match: TrackedMatch
  onResult: (id: string, r: 'correct' | 'wrong' | 'pending') => void
  onDelete: (id: string) => void
}) {
  const isCorrect = match.result === 'correct'
  const isWrong   = match.result === 'wrong'
  const isPending = match.result === 'pending'
  return (
    <div className={`card p-4 mb-3 border-l-4 transition-all ${isCorrect ? 'border-l-emerald-500' : isWrong ? 'border-l-red-500' : 'border-l-blue-600'}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span>{match.flag}</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest">{match.league}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-gray-600">{fmtDate(match.date)}{match.time ? ` Â· ${match.time}` : ''}</span>
          <button onClick={() => onDelete(match.id)} className="text-gray-700 hover:text-red-500 transition-colors text-xs">âœ•</button>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 mb-3">
        <span className="font-display text-white text-sm tracking-wide text-right flex-1">{match.home}</span>
        <span className="text-gray-600 font-mono text-xs">VS</span>
        <span className="font-display text-white text-sm tracking-wide flex-1">{match.away}</span>
      </div>
      <div className="flex items-center justify-center gap-2 mb-4">
        <span className="text-[10px] text-gray-600 uppercase tracking-widest">Pronostic:</span>
        <span className="px-3 py-1 rounded-full bg-blue-600/20 border border-blue-600/30 text-blue-300 text-xs font-mono font-bold">{match.prediction}</span>
        <span className="text-[10px] text-gray-700">[{match.market}]</span>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onResult(match.id, isCorrect ? 'pending' : 'correct')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${isCorrect ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-emerald-900/40 hover:text-emerald-400 border border-gray-700'}`}>
          âœ… Corect
        </button>
        <button onClick={() => onResult(match.id, isWrong ? 'pending' : 'wrong')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${isWrong ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-red-900/40 hover:text-red-400 border border-gray-700'}`}>
          âŒ GreÈ™it
        </button>
        {!isPending && (
          <button onClick={() => onResult(match.id, 'pending')}
            className="px-3 py-2 rounded-lg text-xs text-gray-600 hover:text-gray-400 bg-gray-800/50 border border-gray-800 transition-all"
            title="ReseteazÄƒ">â†©</button>
        )}
      </div>
    </div>
  )
}

function ArchiveSection({ matches, onResult, onDelete }: {
  matches: TrackedMatch[]
  onResult: (id: string, r: 'correct' | 'wrong' | 'pending') => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (matches.length === 0) return null
  const correct = matches.filter(m => m.result === 'correct').length
  const rate = Math.round((correct / matches.length) * 100)
  const grouped = groupByDate(matches)
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
  return (
    <div className="mt-10 fade-in">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-gray-800" />
        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">ArhivÄƒ</span>
        <div className="h-px flex-1 bg-gray-800" />
      </div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gray-800/40 border border-gray-700/40 hover:border-gray-600/60 transition-all group">
        <div className="flex items-center gap-3">
          <span className="text-lg">ðŸ—„ï¸</span>
          <div className="text-left">
            <div className="text-sm font-bold text-gray-300 group-hover:text-white">ArhivÄƒ meciuri finalizate</div>
            <div className="text-[10px] text-gray-600 font-mono mt-0.5">{matches.length} meciuri Â· {correct} âœ… Â· {matches.length - correct} âŒ</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${rateColor(rate)}20`, color: rateColor(rate), border: `1px solid ${rateColor(rate)}40` }}>
            {rate}%
          </span>
          <span className={`text-gray-500 text-sm transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>â–¼</span>
        </div>
      </button>
      {open && (
        <div className="mt-4 space-y-6 fade-in">
          {sortedDates.map(date => (
            <div key={date}>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-gray-800/60" />
                <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">{dateLabel(date)}</span>
                <span className="text-[10px] text-gray-700 font-mono">{grouped[date].length} meciuri</span>
                <div className="h-px flex-1 bg-gray-800/60" />
              </div>
              {grouped[date].map(m => (
                <div key={m.id} className="opacity-70 hover:opacity-100 transition-opacity">
                  <MatchCard match={m} onResult={onResult} onDelete={onDelete} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddModal({ onAdd, onClose }: { onAdd: (m: TrackedMatch) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    home: '', away: '', league: '', flag: 'âš½',
    date: today(), time: '', prediction: '', market: '1X2',
  })
  const flagOptions: Record<string, string> = {
    'ðŸ´ó §ó ¢ó ¥ó ®ó §ó ¿': 'Premier League', 'ðŸ‡ªðŸ‡¸': 'La Liga', 'ðŸ‡©ðŸ‡ª': 'Bundesliga',
    'ðŸ‡®ðŸ‡¹': 'Serie A', 'ðŸ‡«ðŸ‡·': 'Ligue 1', 'ðŸ†': 'Champions League',
    'ðŸ¥ˆ': 'Europa League', 'ðŸ¥‰': 'Conference League', 'ðŸ‡·ðŸ‡´': 'Superliga',
    'ðŸ‡µðŸ‡¹': 'Primeira Liga', 'ðŸ‡³ðŸ‡±': 'Eredivisie', 'âš½': 'AltÄƒ ligÄƒ',
  }
  const markets = ['1X2','Over 2.5','Under 2.5','BTTS Da','BTTS Nu',
    'È˜ansÄƒ dublÄƒ 1X','È˜ansÄƒ dublÄƒ X2','Over 1.5','Over 3.5','Cornere +9.5','Alt pariu']
  function submit() {
    if (!form.home || !form.away || !form.prediction) return
    onAdd({
      id: Date.now().toString(),
      home: form.home, away: form.away,
      league: form.league || flagOptions[form.flag] || 'LigÄƒ',
      flag: form.flag, date: form.date, time: form.time,
      prediction: form.prediction, market: form.market,
      home_win: 45, draw: 27, away_win: 28,
      result: 'pending', addedAt: today(),
    })
    onClose()
  }
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-display text-lg text-white tracking-wide">âž• AdaugÄƒ pronostic</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-white text-xl">âœ•</button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">LigÄƒ</label>
              <select className="select-styled text-sm" value={form.flag}
                onChange={e => setForm({...form, flag: e.target.value, league: flagOptions[e.target.value]||''})}>
                {Object.entries(flagOptions).map(([f,l]) => <option key={f} value={f}>{f} {l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">LigÄƒ (custom)</label>
              <input className="input-styled text-sm" value={form.league}
                onChange={e => setForm({...form, league: e.target.value})} placeholder="Premier League..." />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">EchipÄƒ gazdÄƒ</label>
            <input className="input-styled" value={form.home} onChange={e => setForm({...form, home: e.target.value})} placeholder="Arsenal" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">EchipÄƒ oaspete</label>
            <input className="input-styled" value={form.away} onChange={e => setForm({...form, away: e.target.value})} placeholder="Chelsea" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Data</label>
              <input type="date" className="input-styled text-sm" value={form.date}
                onChange={e => setForm({...form, date: e.target.value})}
                min={new Date(Date.now()-30*86400000).toISOString().split('T')[0]} />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Ora</label>
              <input type="time" className="input-styled text-sm" value={form.time}
                onChange={e => setForm({...form, time: e.target.value})} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Tip pariu</label>
            <select className="select-styled text-sm" value={form.market} onChange={e => setForm({...form, market: e.target.value})}>
              {markets.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Pronosticul tÄƒu</label>
            <input className="input-styled" value={form.prediction} onChange={e => setForm({...form, prediction: e.target.value})}
              placeholder="ex: Arsenal cÃ¢È™tigÄƒ 58% | Over 2.5 â€” 67%" />
          </div>
        </div>
        <button onClick={submit} disabled={!form.home || !form.away || !form.prediction}
          className="btn-accent w-full mt-5 disabled:opacity-40 disabled:cursor-not-allowed">
          âœ… AdaugÄƒ pronostic
        </button>
      </div>
    </div>
  )
}

export default function Weekly() {
  const [lang, setLang] = useState<import('@/lib/LangContext').Lang>('ro')
  const tr = t[(lang === 'ro' ? 'ro' : 'en') as 'ro' | 'en']
  const [user, setUser] = useState<any>(null)
  const [matches, setMatches] = useState<TrackedMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState<'all'|'pending'|'correct'|'wrong'>('all')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setLang(detectLang())
    setMounted(true)

    const currentUser = getUser()
    setUser(currentUser)
    if (currentUser) {
      dbLoad(currentUser.id).then(data => { setMatches(data); setLoading(false) })
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!mounted || !user) return
    const interval = setInterval(() => setMatches(prev => [...prev]), 60_000)
    return () => clearInterval(interval)
  }, [mounted, user])

  async function addMatch(m: TrackedMatch) {
    if (!user) return
    const newId = await dbAdd(m, user.id)
    if (newId) setMatches(prev => [{ ...m, id: newId }, ...prev])
  }
  async function setResult(id: string, result: 'correct'|'wrong'|'pending') {
    await dbUpdate(id, result)
    setMatches(prev => prev.map(m => m.id===id ? {...m, result} : m))
  }
  async function deleteMatch(id: string) {
    if (!confirm('È˜tergi acest pronostic?')) return
    await dbDelete(id)
    setMatches(prev => prev.filter(m => m.id!==id))
  }
  async function clearAll() {
    if (!confirm('È˜tergi toate pronosticurile?')) return
    await fetch(`${API}/api/tracked-matches`, { method: 'DELETE', headers: authHeaders() })
    setMatches([])
  }
  function logout() {
    logoutAuth()
  }

  if (!mounted) return null

  // DacÄƒ nu e logat, arÄƒtÄƒm formularul de autentificare
  if (!user) return <AuthForm onAuth={() => {
    const currentUser = getUser()
    setUser(currentUser)
    if (currentUser) {
      setLoading(true)
      dbLoad(currentUser.id).then(data => { setMatches(data); setLoading(false) })
    }
  }} />

  const activeMatches   = matches.filter(m => !shouldArchive(m))
  const archivedMatches = matches.filter(m => shouldArchive(m))
  const filteredActive  = filter==='all' ? activeMatches : activeMatches.filter(m => m.result===filter)
  const grouped = groupByDate(filteredActive)
  const sortedDates = Object.keys(grouped).sort((a,b) => b.localeCompare(a))

  return (
    <div className="app-bg grid-bg min-h-screen" style={{ overflowX: 'hidden' }}>

      <main className="max-w-4xl mx-auto px-4 py-8" style={{ overflowX: 'hidden' }}>
        <div className="text-center mb-8 fade-in">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Oxiano" className="w-20 h-20" />
          </div>
          <h1 className="font-display text-4xl sm:text-5xl text-white tracking-widest mb-1">{tr.weekly_title}</h1>
          <div className="text-blue-400 text-xs font-mono uppercase tracking-[0.25em] mb-1">Oxiano Â· Quantitative Analysis</div>
        </div>

        <StatsPanel matches={matches} />

        {loading && (
          <div className="text-center py-10">
            <div className="text-blue-500 text-xs font-mono animate-pulse">â³ Se Ã®ncarcÄƒ pronosticurile...</div>
          </div>
        )}

        {!loading && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex gap-1 flex-wrap">
                {([
                  {key:'all' as const, label: tr.filter_all},
                  {key:'pending' as const, label: tr.filter_pending},
                  {key:'correct' as const, label: tr.filter_correct},
                  {key:'wrong' as const, label: tr.filter_wrong},
                ]).map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                      ${filter===f.key ? 'bg-blue-600 text-white' : 'bg-gray-800/60 text-gray-500 hover:text-gray-300 border border-gray-700/50'}`}>
                    {f.label}
                    <span className="ml-1 opacity-70 text-[10px]">
                      ({f.key==='all' ? activeMatches.length : activeMatches.filter(m=>m.result===f.key).length})
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {matches.length>0 && (
                  <button onClick={clearAll}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:text-red-400 bg-gray-800/50 border border-gray-800 transition-all">
                    ðŸ—‘ È˜terge tot
                  </button>
                )}
                <button onClick={() => setShowAdd(true)} className="btn-accent px-4 py-1.5 text-sm">
                  {tr.add_prediction}
                </button>
              </div>
            </div>

            {sortedDates.length > 0 ? (
              sortedDates.map(date => (
                <div key={date} className="mb-6 fade-in">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px flex-1 bg-blue-900/30" />
                    <span className="text-xs font-bold text-blue-500 uppercase tracking-widest">{dateLabel(date)}</span>
                    <span className="text-[10px] text-gray-700 font-mono">{grouped[date].length} meciuri</span>
                    <div className="h-px flex-1 bg-blue-900/30" />
                  </div>
                  {grouped[date].map(m => (
                    <MatchCard key={m.id} match={m} onResult={setResult} onDelete={deleteMatch} />
                  ))}
                </div>
              ))
            ) : (
              <div className="text-center py-20 fade-in">
                <div className="text-6xl opacity-10 mb-4">ðŸ“Š</div>
                <p className="font-display text-xl text-gray-600 tracking-widest mb-2">{tr.no_predictions}</p>
                <p className="text-gray-700 text-sm font-mono mb-6">{filter==='all' ? tr.no_predictions_sub : tr.filter_all}</p>
                {filter==='all' && (
                  <button onClick={() => setShowAdd(true)} className="btn-accent px-6 py-2">{tr.add_first}</button>
                )}
              </div>
            )}

            <ArchiveSection matches={archivedMatches} onResult={setResult} onDelete={deleteMatch} />
          </>
        )}
      </main>

      <footer className="border-t border-blue-900/40 mt-12 py-6">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-xs font-mono text-gray-700">{tr.footer}</p>
          <a href="/privacy" className="text-xs font-mono text-blue-600 hover:text-blue-400 mt-1 block">PoliticÄƒ de confidenÈ›ialitate</a>
        </div>
      </footer>

      {showAdd && <AddModal onAdd={addMatch} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

