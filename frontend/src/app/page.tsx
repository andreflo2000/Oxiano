'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { t } from './i18n'
import axios from 'axios'
import { useLang } from '@/lib/LangContext'
import { getUser, logout, refreshTier, type AuthUser } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://football-predictor-vlpp.onrender.com'

function getNextDays(n: number): string[] {
  const days = []
  for (let i = 0; i < n; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

function formatDateRO(isoDate: string): string {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

function getDayLabel(isoDate: string): string {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const after = new Date(Date.now() + 172800000).toISOString().split('T')[0]
  if (isoDate === today) return 'Azi'
  if (isoDate === tomorrow) return 'Mâine'
  if (isoDate === after) return 'Poimâine'
  return formatDateRO(isoDate)
}

interface League { id: number; code: string; name: string; country: string; flag: string; confederation: string; rating: number }
interface Fixture { id: number; home: string; away: string; home_id: number; away_id: number; date: string; time?: string }
interface StandingRow {
  position: number; team: string; team_full?: string; team_tla?: string; team_id: number; played: number
  won: number; draw: number; lost: number
  goals_for: number; goals_against: number; goal_diff: number; points: number; form: string
}
interface Prediction {
  home_team: string; away_team: string
  prediction: { home_win: number; draw: number; away_win: number; method: string }
  top_scores: Array<{ score: string; probability: number }>
  expected_goals: { home: number; away: number }
  home_stats: any; away_stats: any
  markets?: any
  model_breakdown?: any
}

function getProbColor(p: number) {
  if (p >= 60) return '#10b981'
  if (p >= 40) return '#f59e0b'
  return '#ef4444'
}

// ── Calcul scor de încredere ──────────────────────────────────────────────────
function calcConfidence(home_w: number, draw: number, away_w: number, lang = 'ro'): { score: number; label: string; color: string } {
  const max = Math.max(home_w, draw, away_w)
  const second = [home_w, draw, away_w].sort((a, b) => b - a)[1]
  const gap = max - second
  let score = Math.round(40 + gap * 1.2 + (max - 33) * 0.5)
  score = Math.min(98, Math.max(42, score))
  const label = lang !== 'ro'
    ? (score >= 80 ? 'Very high' : score >= 65 ? 'High' : score >= 50 ? 'Medium' : 'Low')
    : (score >= 80 ? 'Foarte ridicată' : score >= 65 ? 'Ridicată' : score >= 50 ? 'Medie' : 'Scăzută')
  const color = score >= 80 ? '#10b981' : score >= 65 ? '#f59e0b' : score >= 50 ? '#f97316' : '#ef4444'
  return { score, label, color }
}

// ── Poisson helper ────────────────────────────────────────────────────────────
function poissonCDF(lambda: number, k: number): number {
  // P(X <= k) pentru distributia Poisson cu medie lambda
  let prob = 0, term = Math.exp(-lambda)
  for (let i = 0; i <= k; i++) {
    prob += term
    term *= lambda / (i + 1)
  }
  return Math.min(prob, 1)
}
function pOver(lambda: number, k: number) { // P(X > k)
  return Math.round((1 - poissonCDF(lambda, k)) * 100)
}

// ── Calcul toate piețele disponibile ─────────────────────────────────────────
function calcAllMarkets(prediction: Prediction, lang = 'ro') {
  const en = lang !== 'ro'
  const pred = prediction.prediction || {}
  const home_w = pred.home_win ?? 0
  const draw   = pred.draw ?? 0
  const away_w = pred.away_win ?? 0
  const xgHome  = prediction.expected_goals?.home ?? 1.4
  const xgAway  = prediction.expected_goals?.away ?? 1.2
  const totalXg = xgHome + xgAway

  // Cap: nicio probabilitate nu poate fi 0% sau 100%
  const capP = (p: number) => Math.min(99, Math.max(1, p))

  // Full-time Over/Under (Poisson)
  const over05 = capP(pOver(totalXg, 0))
  const over15 = capP(pOver(totalXg, 1))
  const over25 = capP(pOver(totalXg, 2))
  const over35 = capP(pOver(totalXg, 3))
  const over45 = capP(pOver(totalXg, 4))

  // BTTS (independent Poisson pentru fiecare echipă)
  const pHomeSc = capP(Math.round((1 - poissonCDF(xgHome, 0)) * 100))
  const pAwaySc = capP(Math.round((1 - poissonCDF(xgAway, 0)) * 100))
  const btts    = capP(Math.round(pHomeSc * pAwaySc / 100))
  const bttsNo  = capP(100 - btts)

  // Șansă dublă — probabilitate directă fara factor artificial
  const dc1x = Math.min(97, Math.round(home_w + draw))
  const dcx2 = Math.min(97, Math.round(draw + away_w))
  const dc12 = Math.min(97, Math.round(home_w + away_w))


  // Pauză — xG la pauză ≈ 42% din total
  const htH = xgHome * 0.42
  const htA = xgAway * 0.42
  const htTotal = htH + htA

  const htOver05 = capP(pOver(htTotal, 0))
  const htOver15 = capP(pOver(htTotal, 1))
  const htOver25 = capP(pOver(htTotal, 2))

  // Rezultat pauză — Poisson bivariate exact (matrice 5x5)
  const poiP = (l: number, k: number) => { let t = Math.exp(-l); for (let i = 0; i < k; i++) t *= l / (i + 1); return t }
  let htHomeP = 0, htDrawP = 0, htAwayP = 0
  for (let h = 0; h <= 4; h++) {
    for (let a = 0; a <= 4; a++) {
      const p = poiP(htH, h) * poiP(htA, a)
      if (h > a) htHomeP += p
      else if (h === a) htDrawP += p
      else htAwayP += p
    }
  }
  const htHome = Math.round(htHomeP * 100)
  const htDraw = Math.round(htDrawP * 100)
  const htAway = Math.max(1, Math.round(htAwayP * 100))

  const margin = 1.08
  const odd = (p: number) => Math.max(1.01, 100 / (capP(p) * margin)).toFixed(2)

  // Clean Sheet — P(echipa adversara nu marcheaza)
  const homeCS = capP(Math.round(poissonCDF(xgAway, 0) * 100))  // home clean sheet
  const awayCS = capP(Math.round(poissonCDF(xgHome, 0) * 100))  // away clean sheet

  // Win to Nil — P(echipa marcheaza >= 1) × P(adversarul marcheaza 0)
  // Corect: folosim pHomeSc/pAwaySc (Poisson), nu probabilitatea 1X2 din model
  const homeWtN = capP(Math.round((pHomeSc / 100) * (homeCS / 100) * 100))
  const awayWtN = capP(Math.round((pAwaySc / 100) * (awayCS / 100) * 100))

  return [
    {
      category: en ? '⚽ Match Result (1X2)' : '⚽ Rezultat meci (1X2)', items: [
        { name: en ? `1 — ${prediction.home_team} Win` : `1 — Victorie ${prediction.home_team}`, probability: capP(home_w), odds: odd(home_w) },
        { name: en ? 'X — Draw' : 'X — Egal', probability: capP(draw), odds: odd(draw) },
        { name: en ? `2 — ${prediction.away_team} Win` : `2 — Victorie ${prediction.away_team}`, probability: capP(away_w), odds: odd(away_w) },
      ]
    },
    {
      category: en ? '🎯 Double Chance' : '🎯 Șansă dublă', items: [
        { name: en ? `1X — ${prediction.home_team} or Draw` : `1X — ${prediction.home_team} sau Egal`, probability: capP(dc1x), odds: odd(dc1x) },
        { name: en ? `X2 — Draw or ${prediction.away_team}` : `X2 — Egal sau ${prediction.away_team}`, probability: capP(dcx2), odds: odd(dcx2) },
        { name: en ? '12 — No Draw' : '12 — Fără egal', probability: capP(dc12), odds: odd(dc12) },
      ]
    },
    {
      category: en ? '📊 Total Goals (full match)' : '📊 Total goluri (meci întreg)', items: [
        { name: en ? 'Over 0.5 goals' : 'Peste 0.5 goluri în meci', probability: capP(over05), odds: odd(over05) },
        { name: en ? 'Under 0.5 goals' : 'Sub 0.5 goluri în meci', probability: capP(100 - over05), odds: odd(100 - over05) },
        { name: en ? 'Over 1.5 goals' : 'Peste 1.5 goluri în meci', probability: capP(over15), odds: odd(over15) },
        { name: en ? 'Under 1.5 goals' : 'Sub 1.5 goluri în meci', probability: capP(100 - over15), odds: odd(100 - over15) },
        { name: en ? 'Over 2.5 goals' : 'Peste 2.5 goluri în meci', probability: capP(over25), odds: odd(over25) },
        { name: en ? 'Under 2.5 goals' : 'Sub 2.5 goluri în meci', probability: capP(100 - over25), odds: odd(100 - over25) },
        { name: en ? 'Over 3.5 goals' : 'Peste 3.5 goluri în meci', probability: capP(over35), odds: odd(over35) },
        { name: en ? 'Under 3.5 goals' : 'Sub 3.5 goluri în meci', probability: capP(100 - over35), odds: odd(100 - over35) },
        { name: en ? 'Over 4.5 goals' : 'Peste 4.5 goluri în meci', probability: capP(over45), odds: odd(over45) },
        { name: en ? 'Under 4.5 goals' : 'Sub 4.5 goluri în meci', probability: capP(100 - over45), odds: odd(100 - over45) },
      ]
    },
    {
      category: en ? '🔄 Both Teams to Score (BTTS)' : '🔄 Ambele înscriu (BTTS)', items: [
        { name: en ? 'BTTS — Yes' : 'BTTS — Da', probability: capP(btts), odds: odd(btts) },
        { name: en ? 'BTTS — No' : 'BTTS — Nu', probability: capP(bttsNo), odds: odd(bttsNo) },
      ]
    },
    {
      category: en ? '⏸️ Half-Time — Total Goals' : '⏸️ Pauză — Total goluri', items: [
        { name: en ? 'HT Over 0.5' : 'La pauză Peste 0.5 goluri', probability: capP(htOver05), odds: odd(htOver05) },
        { name: en ? 'HT Under 0.5' : 'La pauză Sub 0.5 goluri', probability: capP(100 - htOver05), odds: odd(100 - htOver05) },
        { name: en ? 'HT Over 1.5' : 'La pauză Peste 1.5 goluri', probability: capP(htOver15), odds: odd(htOver15) },
        { name: en ? 'HT Under 1.5' : 'La pauză Sub 1.5 goluri', probability: capP(100 - htOver15), odds: odd(100 - htOver15) },
        { name: en ? 'HT Over 2.5' : 'La pauză Peste 2.5 goluri', probability: capP(htOver25), odds: odd(htOver25) },
        { name: en ? 'HT Under 2.5' : 'La pauză Sub 2.5 goluri', probability: capP(100 - htOver25), odds: odd(100 - htOver25) },
      ]
    },
    {
      category: en ? '🕐 Half-Time Result' : '🕐 Rezultat la pauză', items: [
        { name: en ? `HT 1 — ${prediction.home_team} leads` : `Pauză 1 — ${prediction.home_team} conduce`, probability: capP(htHome), odds: odd(htHome) },
        { name: en ? 'HT X — Draw at half-time' : 'Pauză X — Egal la pauză', probability: capP(htDraw), odds: odd(htDraw) },
        { name: en ? `HT 2 — ${prediction.away_team} leads` : `Pauză 2 — ${prediction.away_team} conduce`, probability: capP(htAway), odds: odd(htAway) },
      ]
    },
    {
      category: en ? '🧤 Clean Sheet' : '🧤 Fără gol primit', items: [
        { name: en ? `${prediction.home_team} — Clean Sheet` : `${prediction.home_team} — Fără gol primit`, probability: homeCS, odds: odd(homeCS) },
        { name: en ? `${prediction.away_team} — Clean Sheet` : `${prediction.away_team} — Fără gol primit`, probability: awayCS, odds: odd(awayCS) },
      ]
    },
    {
      category: en ? '🏆 Win to Nil' : '🏆 Victorie la zero', items: [
        { name: en ? `${prediction.home_team} — Win to Nil` : `${prediction.home_team} — Victorie la zero`, probability: homeWtN, odds: odd(homeWtN) },
        { name: en ? `${prediction.away_team} — Win to Nil` : `${prediction.away_team} — Victorie la zero`, probability: awayWtN, odds: odd(awayWtN) },
      ]
    },
  ]
}

// ── Bet Value — pariuri cu convingere ridicată + cote estimate ───────────────
function calcBetValue(prediction: Prediction, lang = 'ro') {
  const markets = calcAllMarkets(prediction, lang)
  const mkt_margin = 1.08  // marja tipica bookmaker ~8%
  const results: Array<{
    name: string; probability: number
    fair_odds: number; est_bk_odds: number
    conviction: number; rating: string; color: string
  }> = []

  for (const group of markets) {
    for (const item of group.items) {
      const p = item.probability / 100
      if (p < 0.55) continue  // doar pariuri cu convingere reala

      // Cota corecta a modelului (fara marja): 1/p
      const fair_odds = parseFloat(Math.max(1.01, 1 / p).toFixed(2))
      // Cota estimata bookmaker (cu marja 8%): 1/(p * 1.08) — mai mica decat fair
      const est_bk_odds = parseFloat(Math.max(1.01, 1 / (p * mkt_margin)).toFixed(2))
      // Convingere = cat depaseste pragul de 55%
      const conviction = Math.round((p - 0.55) * 100)

      const rating = lang !== 'ro'
        ? (p >= 0.75 ? '🔥 High conviction' : p >= 0.65 ? '✅ Good conviction' : '⚡ Moderate')
        : (p >= 0.75 ? '🔥 Convingere ridicată' : p >= 0.65 ? '✅ Convingere bună' : '⚡ Moderat')
      const color = p >= 0.75 ? '#10b981' : p >= 0.65 ? '#f59e0b' : '#6b7280'

      results.push({ name: item.name, probability: item.probability, fair_odds, est_bk_odds, conviction, rating, color })
    }
  }

  return results.sort((a, b) => b.probability - a.probability).slice(0, 8)
}

// ── Top 3 cele mai sigure pariuri ─────────────────────────────────────────────
function getTop3Bets(prediction: Prediction, lang = 'ro') {
  const markets = calcAllMarkets(prediction, lang)
  const all: Array<{ name: string; probability: number; odds: string }> = []
  for (const group of markets) {
    for (const item of group.items) {
      all.push(item)
    }
  }
  return all
    .filter(b => {
      const odds = parseFloat(b.odds)
      // Exclude pariuri triviale (cota < 1.15 = probabilitate > ~85%) si sub pragul de convingere
      return b.probability >= 55 && odds >= 1.15
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3)
    .map(b => ({
      ...b,
      confidence: lang !== 'ro'
        ? (b.probability >= 70 ? '🟢 Confident' : '🟡 Moderate')
        : (b.probability >= 70 ? '🟢 Sigur' : '🟡 Moderat'),
    }))
}

// ── Share WhatsApp ────────────────────────────────────────────────────────────
function shareOnWhatsApp(prediction: Prediction, fixture: Fixture) {
  const pred = prediction.prediction || {}
  const home_w = pred.home_win ?? 0
  const draw = pred.draw ?? 0
  const away_w = pred.away_win ?? 0
  const conf = calcConfidence(home_w, draw, away_w)
  const top3 = getTop3Bets(prediction)
  const text = `⚽ *OXIANO — Predicție AI*\n\n` +
    `🏟️ *${prediction.home_team}* vs *${prediction.away_team}*\n` +
    `📅 ${getDayLabel(fixture.date)} · ${formatDateRO(fixture.date)}${fixture.time ? ` · 🕐 ${fixture.time}` : ''}\n` +
    `🎯 Încredere AI: *${conf.score}%* (${conf.label})\n\n` +
    `📊 *Probabilități:*\n` +
    `1️⃣ ${prediction.home_team}: *${home_w}%* (cotă ~${(100/(Math.max(home_w,1)*1.08)).toFixed(2)})\n` +
    `🤝 Egal: *${draw}%* (cotă ~${(100/(Math.max(draw,1)*1.08)).toFixed(2)})\n` +
    `2️⃣ ${prediction.away_team}: *${away_w}%* (cotă ~${(100/(Math.max(away_w,1)*1.08)).toFixed(2)})\n\n` +
    `🏆 *Top 3 pariuri recomandate:*\n` +
    top3.map((b, i) => `${i+1}. ${b.name} — ${b.probability}% ${b.confidence}`).join('\n') + '\n\n' +
    `🔮 _Generat de Oxiano_\n🌐 oxiano.com`
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
}

function shareOnTelegram(prediction: Prediction, fixture: Fixture) {
  const pred = prediction.prediction || {}
  const home_w = pred.home_win ?? 0
  const draw = pred.draw ?? 0
  const away_w = pred.away_win ?? 0
  const conf = calcConfidence(home_w, draw, away_w)
  const top3 = getTop3Bets(prediction)
  const text = `⚽ OXIANO — Predicție AI\n\n` +
    `🏟️ ${prediction.home_team} vs ${prediction.away_team}\n` +
    `📅 ${getDayLabel(fixture.date)} · ${formatDateRO(fixture.date)}${fixture.time ? ` · ${fixture.time}` : ''}\n` +
    `🎯 Încredere AI: ${conf.score}% (${conf.label})\n\n` +
    `📊 Probabilități:\n` +
    `1. ${prediction.home_team}: ${home_w}%\n` +
    `X. Egal: ${draw}%\n` +
    `2. ${prediction.away_team}: ${away_w}%\n\n` +
    `🏆 Top 3 pariuri:\n` +
    top3.map((b, i) => `${i+1}. ${b.name} — ${b.probability}%`).join('\n') + '\n\n' +
    `🔮 Oxiano\n🌐 oxiano.com`
  window.open(`https://t.me/share/url?url=oxiano.com&text=${encodeURIComponent(text)}`, '_blank')
}

function FormBadge({ result }: { result: string }) {
  const cfg: Record<string, string> = {
    W: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    D: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
    L: 'bg-red-500/20 text-red-400 border border-red-500/30',
  }
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold font-mono ${cfg[result] || cfg.D}`}>
      {result}
    </span>
  )
}

function StatBar({ label, homeVal, awayVal, format = (v: number) => v.toFixed(2) }: {
  label: string; homeVal: number; awayVal: number; format?: (v: number) => string
}) {
  const total = homeVal + awayVal || 1
  const homeW = Math.round((homeVal / total) * 100)
  const awayW = 100 - homeW
  const homeBetter = homeVal >= awayVal
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs font-mono mb-1">
        <span className={homeBetter ? 'text-blue-300 font-bold' : 'text-gray-400'}>{format(homeVal)}</span>
        <span className="text-gray-500 uppercase tracking-widest text-[10px]">{label}</span>
        <span className={!homeBetter ? 'text-blue-300 font-bold' : 'text-gray-400'}>{format(awayVal)}</span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-800">
        <div className="h-full rounded-l-full transition-all" style={{ width: `${homeW}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)' }} />
        <div className="h-full rounded-r-full transition-all" style={{ width: `${awayW}%`, background: 'linear-gradient(90deg, #f97316, #fb923c)' }} />
      </div>
    </div>
  )
}

function ProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center" style={{ maxWidth: '30%' }}>
      <div className="relative h-24 flex items-end justify-center mb-2">
        <div className="w-12 rounded-t-lg transition-all duration-700"
          style={{ height: `${Math.max(value, 5)}%`, backgroundColor: color, opacity: 0.9 }} />
      </div>
      <div className="text-xl font-bold font-mono" style={{ color }}>{value}%</div>
      <div className="text-xs text-gray-500 uppercase tracking-widest mt-1" style={{ fontSize: '9px', wordBreak: 'break-word' }}>{label}</div>
    </div>
  )
}

function MarketRow({ market }: { market: any }) {
  const color = getProbColor(market.probability)
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800/50 last:border-0">
      <span className="text-xs text-gray-400 flex-1 truncate">{market.name}</span>
      <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(market.probability, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold font-mono w-10 text-right" style={{ color }}>{market.probability}%</span>
      {market.odds && <span className="text-[10px] text-gray-600 w-10 text-right font-mono">~{market.odds}</span>}
    </div>
  )
}

function StandingsTable({ standings, highlightTeams }: { standings: StandingRow[]; highlightTeams: string[] }) {
  if (!standings.length) return (
    <div className="text-center py-8 text-gray-600 text-sm">Clasamentul nu e disponibil pentru această ligă</div>
  )
  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table style={{ width: '100%', tableLayout: 'fixed' }} className="text-xs font-mono">
        <thead>
          <tr className="text-gray-600 uppercase tracking-widest border-b border-gray-800">
            <th className="text-left pb-2 w-6">#</th>
            <th className="text-left pb-2">Echipă</th>
            <th className="text-center pb-2 w-8">J</th>
            <th className="text-center pb-2 w-8">V</th>
            <th className="text-center pb-2 w-8">E</th>
            <th className="text-center pb-2 w-8">Î</th>
            <th className="text-center pb-2 w-12">GD</th>
            <th className="text-center pb-2 w-8 font-bold text-blue-500">Pct</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => {
            const norm = (s: string) => s.toLowerCase()
              .replace(/ö/g,'o').replace(/ü/g,'u').replace(/ä/g,'a').replace(/ß/g,'ss')
              .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim()
            const rowNames = [row.team, row.team_full, row.team_tla].filter(Boolean).map(n => norm(n!))
            const GENERIC = new Set(['united', 'fc', 'club', 'sport', 'sporting'])
            const isHighlighted = highlightTeams.some(t => {
              const pt = norm(t)
              const ptWords = pt.split(' ').filter(w => w.length > 3 && !GENERIC.has(w))
              return rowNames.some(rn => {
                if (rn === pt || rn.includes(pt) || pt.includes(rn)) return true
                if (!ptWords.length) return false
                const rnWords = rn.split(' ').filter(w => w.length > 3 && !GENERIC.has(w))
                return ptWords.some(pw => rnWords.some(rw => rw.includes(pw) || pw.includes(rw)))
              })
            })
            return (
              <tr key={row.position}
                className={`border-b border-gray-800/30 transition-colors ${isHighlighted ? 'bg-blue-900/20 text-white' : 'text-gray-400 hover:bg-gray-800/20'}`}>
                <td className="py-1.5 text-gray-600">{row.position}</td>
                <td className="py-1.5 font-semibold truncate max-w-[100px]">
                  {isHighlighted && <span className="text-blue-400 mr-1">›</span>}
                  {row.team}
                </td>
                <td className="py-1.5 text-center">{row.played}</td>
                <td className="py-1.5 text-center text-emerald-500">{row.won}</td>
                <td className="py-1.5 text-center text-gray-500">{row.draw}</td>
                <td className="py-1.5 text-center text-red-500">{row.lost}</td>
                <td className={`py-1.5 text-center ${row.goal_diff > 0 ? 'text-emerald-400' : row.goal_diff < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                  {row.goal_diff > 0 ? '+' : ''}{row.goal_diff}
                </td>
                <td className="py-1.5 text-center font-bold text-white">{row.points}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TeamStatsCard({ stats, teamName, color }: { stats: any; teamName: string; color: string }) {
  const { lang } = useLang()
  if (!stats) return null
  const form = stats.form || []
  const xgFor = stats.xg_for_history || stats.xg_for || []
  const xgAg = stats.xg_against_history || stats.xg_against || []
  const avgXgFor = Array.isArray(xgFor) ? xgFor.reduce((a: number, b: number) => a + b, 0) / (xgFor.length || 1) : xgFor
  const avgXgAg = Array.isArray(xgAg) ? xgAg.reduce((a: number, b: number) => a + b, 0) / (xgAg.length || 1) : xgAg
  const wins = form.filter((r: string) => r === 'W').length
  const draws = form.filter((r: string) => r === 'D').length
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-6 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="font-display text-base text-white tracking-wide truncate">{teamName}</h3>
      </div>
      {form.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">{lang !== 'ro' ? 'Recent matches' : 'Ultimele meciuri'}</div>
          <div className="flex gap-1">{form.map((r: string, i: number) => <FormBadge key={i} result={r} />)}</div>
          <div className="text-xs text-gray-500 mt-2 font-mono">
            {wins}V · {draws}E · {form.length - wins - draws}Î
            <span className="ml-2 text-blue-400">{Math.round((wins / (form.length || 1)) * 100)}% win rate</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {[
          { label: 'xG For', value: avgXgFor.toFixed(2), icon: '⚽' },
          { label: 'xG Against', value: avgXgAg.toFixed(2), icon: '🛡️' },
          { label: lang !== 'ro' ? 'Goals/match' : 'Goluri/meci', value: stats.goals_avg?.toFixed(2) || avgXgFor.toFixed(2), icon: '📊' },
          { label: 'Elo Rating', value: stats.elo_rating || '—', icon: '📈' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/40 rounded-lg p-2.5">
            <div className="text-[10px] text-gray-600 uppercase tracking-widest">{s.icon} {s.label}</div>
            <div className="text-lg font-bold font-mono text-white mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>
      {Array.isArray(xgFor) && xgFor.length > 0 && (
        <div>
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">{lang !== 'ro' ? 'xG recent matches' : 'xG ultimele meciuri'}</div>
          <div className="flex items-end gap-1 h-10">
            {xgFor.slice(-5).map((v: number, i: number) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full rounded-t-sm" style={{ height: `${Math.min(v * 25, 40)}px`, backgroundColor: color, opacity: 0.7 }} />
              </div>
            ))}
          </div>
          <div className="text-[9px] text-gray-700 text-center mt-1 font-mono">{lang !== 'ro' ? 'recent matches →' : 'meciuri recente →'}</div>
        </div>
      )}
    </div>
  )
}

// ── Comparator cotă reală introdusă de user ───────────────────────────────────
function OddsComparator({ prediction }: { prediction: Prediction }) {
  const { lang } = useLang()
  const [inputOdd, setInputOdd] = useState('')
  const [market, setMarket]     = useState('1')
  const pred = prediction.prediction || {}
  const probMap: Record<string, number> = {
    '1': pred.home_win ?? 0,
    'X': pred.draw ?? 0,
    '2': pred.away_win ?? 0,
  }
  const prob     = (probMap[market] ?? 0) / 100
  const odd      = parseFloat(inputOdd)
  const hasValue = !isNaN(odd) && odd > 0 && prob > 0
  const impliedP = hasValue ? 1 / odd : 0
  const edge     = hasValue ? Math.round((prob - impliedP) * 100) : 0
  const ev       = hasValue ? Math.round((prob * odd - 1) * 100) / 100 : 0
  const isValue  = edge > 0

  return (
    <div className="mt-5 pt-5 border-t border-gray-800/50">
      <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-3 text-center">{lang !== 'ro' ? '🔍 Check your odds — Value or not?' : '🔍 Verifică cota ta — Valoare sau nu?'}</div>
      <div className="flex gap-2 mb-3">
        {['1','X','2'].map(m => (
          <button key={m} onClick={() => setMarket(m)}
            className="flex-1 py-2 rounded-xl text-sm font-bold font-mono transition-all"
            style={{
              background: market === m ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${market === m ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
              color: market === m ? '#60a5fa' : '#6b7280',
            }}>
            {m === '1' ? `1 ${prediction.home_team.split(' ')[0]}` : m === '2' ? `2 ${prediction.away_team.split(' ')[0]}` : (lang !== 'ro' ? 'X Draw' : 'X Egal')}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="number" step="0.01" min="1.01" placeholder={lang !== 'ro' ? 'Bookmaker odds (e.g. 2.15)' : 'Cota la bookmaker (ex: 2.15)'}
          value={inputOdd}
          onChange={e => setInputOdd(e.target.value)}
          className="flex-1 bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
        />
      </div>
      {hasValue && (
        <div className="mt-3 p-4 rounded-xl" style={{
          background: isValue ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${isValue ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          <div className="text-center mb-3">
            <div className="text-2xl font-bold font-mono" style={{ color: isValue ? '#10b981' : '#ef4444' }}>
              {isValue ? (lang !== 'ro' ? '✅ HIGH EDGE' : '✅ EDGE RIDICAT') : (lang !== 'ro' ? '❌ No edge' : '❌ Fără edge')}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-1">
              {lang !== 'ro' ? 'Model probability' : 'Probabilitate model'}: {Math.round(prob*100)}% · {lang !== 'ro' ? 'Implied odds prob.' : 'Prob. implicită cotă'}: {Math.round(impliedP*100)}%
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-900/50 rounded-lg p-2 text-center">
              <div className="text-[10px] text-gray-600 uppercase tracking-widest">{lang !== 'ro' ? 'Edge vs odds' : 'Avantaj față de cotă'}</div>
              <div className="text-base font-bold font-mono" style={{ color: isValue ? '#10b981' : '#ef4444' }}>
                {edge > 0 ? '+' : ''}{edge}%
              </div>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-2 text-center">
              <div className="text-[10px] text-gray-600 uppercase tracking-widest">EV / 10 RON</div>
              <div className="text-base font-bold font-mono" style={{ color: ev > 0 ? '#10b981' : '#ef4444' }}>
                {ev > 0 ? '+' : ''}{(ev * 10).toFixed(2)} RON
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tier comparison table ─────────────────────────────────────────────────────
function TierComparisonTable() {
  const { lang } = useLang()
  const ro = lang === 'ro'
  const feats = (ok1: boolean, ok2: boolean, ok3: boolean, ro: string, en: string) => [
    { label: ro ? ro : en, ok: ok1 }, { label: ro ? ro : en, ok: ok2 }, { label: ro ? ro : en, ok: ok3 }
  ]
  const labels = [
    { ro: 'Acces pagina Predicții',             en: 'Predictions page access',           free: true,  analyst: true,  pro: true  },
    { ro: 'Direcție meci (1 / X / 2)',          en: 'Match direction (1 / X / 2)',       free: true,  analyst: true,  pro: true  },
    { ro: 'Toate ligile disponibile',           en: 'All leagues available',             free: true,  analyst: true,  pro: true  },
    { ro: 'Probabilități exacte (%)',           en: 'Exact probabilities (%)',           free: false, analyst: true,  pro: true  },
    { ro: 'Piețe complete (Over/Under, BTTS)',  en: 'Full markets (Over/Under, BTTS)',   free: false, analyst: true,  pro: true  },
    { ro: 'Acumulator 3-fold zilnic',           en: '3-fold daily accumulator',          free: false, analyst: true,  pro: true  },
    { ro: 'Notificări Telegram (2×/zi)',        en: 'Telegram alerts (2×/day)',          free: false, analyst: true,  pro: true  },
    { ro: 'Track record (7 zile)',              en: 'Track record (7 days)',             free: false, analyst: true,  pro: true  },
    { ro: 'xG + Elo + Model breakdown',         en: 'xG + Elo + Model breakdown',        free: false, analyst: false, pro: true  },
    { ro: 'Market Divergence Signal (edge față de piață)', en: 'Market Divergence Signal (market edge)', free: false, analyst: false, pro: true  },
    { ro: 'Score Matrix (Poisson bivariate)',   en: 'Score Matrix (Poisson bivariate)',  free: false, analyst: false, pro: true  },
    { ro: 'Track record complet + ROI',         en: 'Full track record + ROI',           free: false, analyst: false, pro: true  },
    { ro: 'VIP Outputs — confidence ≥75%',       en: 'VIP Outputs — confidence ≥75%',     free: false, analyst: false, pro: true  },
    { ro: 'Acumulator 5-fold optimizat AI',     en: '5-fold AI accumulator',             free: false, analyst: false, pro: true  },
  ]
  const tiers = [
    { name: 'Free',    price: ro ? '0 RON' : '$0',           color: '#6b7280',  highlight: false, key: 'free'    as const, count: 3 },
    { name: 'Analyst', price: ro ? '39 RON/lună' : '$8/mo',  color: '#3b82f6',  highlight: false, key: 'analyst' as const, count: 8 },
    { name: 'Pro',     price: ro ? '99 RON/lună' : '$20/mo', color: '#f59e0b',  highlight: true,  key: 'pro'     as const, count: 14 },
  ]
  return (
    <div className="card p-5 mb-6 fade-in" style={{ overflow: 'hidden' }}>
      <div className="text-center mb-5">
        <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">
          {ro ? 'Ce primești la fiecare plan' : 'What you get with each plan'}
        </div>
        <div className="text-xs text-gray-600 font-mono">
          {ro ? 'Alege planul potrivit pentru stilul tău de analiză' : 'Choose the plan that fits your analysis style'}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiers.map(tier => (
          <div key={tier.name} className="rounded-xl p-3 flex flex-col"
            style={{
              background: tier.highlight ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${tier.highlight ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.06)'}`,
            }}>
            {tier.highlight && (
              <div className="text-center mb-1">
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-600/80 text-white uppercase tracking-widest">
                  {ro ? 'Popular' : 'Popular'}
                </span>
              </div>
            )}
            <div className="text-center mb-3">
              <div className="text-sm font-bold" style={{ color: tier.color }}>{tier.name}</div>
              <div className="text-[10px] font-mono text-gray-500 mt-0.5">{tier.price}</div>
              {tier.count > 0 && (
                <div className="text-[9px] font-bold mt-1 px-2 py-0.5 rounded-full inline-block"
                  style={{ background: `${tier.color}15`, color: tier.color, border: `1px solid ${tier.color}30` }}>
                  {tier.count} {ro ? 'funcții' : 'features'}
                </div>
              )}
            </div>
            <div className="space-y-1.5 flex-1">
              {labels.map((f, i) => {
                const ok = f[tier.key]
                return (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="shrink-0 mt-0.5" style={{ color: ok ? '#10b981' : '#374151', fontSize: '10px' }}>
                      {ok ? '✓' : '✗'}
                    </span>
                    <span className={`text-[10px] leading-tight ${ok ? 'text-gray-300' : 'text-gray-700'}`}>
                      {ro ? f.ro : f.en}
                    </span>
                  </div>
                )
              })}
            </div>
            {tier.name !== 'Free' && (
              <a href="/upgrade" className="mt-3 block text-center py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wide transition-all"
                style={{ background: `${tier.color}20`, color: tier.color, border: `1px solid ${tier.color}40` }}>
                {ro ? 'Activează' : 'Activate'}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PredictionDisplay({ prediction, fixture, standings, user }: {
  prediction: Prediction; fixture: Fixture; standings: StandingRow[]; user: AuthUser | null
}) {
  const isFree = !user || user.tier === 'free'
  const isProOrOwner = user?.tier === 'pro' || user?.tier === 'vip' || user?.tier === 'owner'
  const { lang } = useLang()
  const [activeTab, setActiveTab] = useState('markets')
  const pred = prediction.prediction || {}
  const home_w = pred.home_win ?? 0
  const draw   = pred.draw ?? 0
  const away_w = pred.away_win ?? 0
  const breakdown = prediction.model_breakdown || {}
  const conf = calcConfidence(home_w, draw, away_w, lang)
  const allMarkets = calcAllMarkets(prediction, lang)
  const top3 = getTop3Bets(prediction, lang)

  const valueBets = calcBetValue(prediction, lang)

  const tabs = [
    { key: 'markets',   label: lang !== 'ro' ? '🎯 Markets' : '🎯 Piețe' },
    { key: 'value',     label: `💎 ${lang !== 'ro' ? 'Value' : 'Valoare'}${isProOrOwner && valueBets.length > 0 ? ` (${valueBets.length})` : ''}`, locked: !isProOrOwner },
    { key: 'scores',    label: lang !== 'ro' ? '⚽ Scores' : '⚽ Scoruri', locked: isFree },
    { key: 'stats',     label: '📊 Stats' },
    { key: 'standings', label: lang !== 'ro' ? '🏆 Stand.' : '🏆 Clas.' },
    { key: 'models',    label: lang !== 'ro' ? '🤖 Models' : '🤖 Modele', locked: !isProOrOwner },
  ]

  return (
    <div className="fade-in" style={{ width: '100%', overflow: 'hidden' }}>
      {/* Card principal meci */}
      <div className="card p-4 mb-4" style={{ overflow: 'hidden' }}>
        <div className="text-center mb-4">
          <div className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">
            {getDayLabel(fixture.date)} · {formatDateRO(fixture.date)}{fixture.time ? ` · 🕐 ${fixture.time}` : ''}
          </div>
          <div className="flex items-center justify-center gap-2">
            <div className="text-right" style={{ flex: 1, minWidth: 0 }}>
              <div className="font-display text-base text-white tracking-wide truncate">{prediction.home_team}</div>
              <div className="text-xs text-gray-600 font-mono mt-1">{lang !== 'ro' ? 'HOME' : 'GAZDĂ'}</div>
            </div>
            <div className="shrink-0 px-2 py-1 rounded-lg bg-gray-800/60 border border-gray-700">
              <span className="font-mono text-gray-500 text-sm">VS</span>
            </div>
            <div className="text-left" style={{ flex: 1, minWidth: 0 }}>
              <div className="font-display text-base text-white tracking-wide truncate">{prediction.away_team}</div>
              <div className="text-xs text-gray-600 font-mono mt-1">{lang !== 'ro' ? 'AWAY' : 'OASPETE'}</div>
            </div>
          </div>
        </div>

        {isFree ? (
          <div className="relative mt-4">
            <div style={{ filter: 'blur(6px)' }} className="pointer-events-none select-none flex justify-around items-end">
              <ProbBar label={prediction.home_team.split(' ')[0]} value={home_w} color="#3b82f6" />
              <ProbBar label={lang !== 'ro' ? 'Draw' : 'Egal'} value={draw} color="#6b7280" />
              <ProbBar label={prediction.away_team.split(' ')[0]} value={away_w} color="#f97316" />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="text-white text-xs font-bold">🔒 {lang !== 'ro' ? 'Probabilities locked' : 'Probabilități blocate'}</span>
              <a href="/upgrade" className="px-4 py-1.5 rounded-full text-xs font-bold"
                style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', color: 'white' }}>
                ⚡ {lang !== 'ro' ? 'Unlock — $8/mo' : 'Deblochează — 39 RON/lună'}
              </a>
            </div>
          </div>
        ) : (
          <div className="flex justify-around items-end mt-4">
            <ProbBar label={prediction.home_team.split(' ')[0]} value={home_w} color="#3b82f6" />
            <ProbBar label="Egal" value={draw} color="#6b7280" />
            <ProbBar label={prediction.away_team.split(' ')[0]} value={away_w} color="#f97316" />
          </div>
        )}

        <div className="mt-3 text-center text-xs font-mono text-gray-700">{pred.method || 'XGBoost + Poisson + Elo'}</div>

        {/* Scor de încredere AI */}
        <div className="flex justify-center mt-3">
          {isFree ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-gray-700/40 bg-gray-800/30">
              <div className="w-2 h-2 rounded-full bg-gray-600" />
              <span className="text-xs font-bold font-mono text-gray-600" style={{ filter: 'blur(4px)' }}>
                {lang !== 'ro' ? 'AI Confidence' : 'Încredere AI'}: {conf.score}%
              </span>
              <span className="text-[10px] text-gray-600">🔒</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border"
              style={{ borderColor: `${conf.color}40`, backgroundColor: `${conf.color}15` }}>
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: conf.color }} />
              <span className="text-xs font-bold font-mono" style={{ color: conf.color }}>
                {lang !== 'ro' ? 'AI Confidence' : 'Încredere AI'}: {conf.score}%
              </span>
              <span className="text-[10px] text-gray-500">({conf.label})</span>
            </div>
          )}
        </div>

        {/* Cote bookmakers */}
        <div className="mt-4 pt-4 border-t border-gray-800/60">
          <div className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-3 text-center">
            💰 {isFree ? (lang !== 'ro' ? 'Estimated bookmaker odds' : 'Cote estimate bookmakers') : (lang !== 'ro' ? 'Estimated bookmaker odds' : 'Cote estimate bookmakers')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: lang !== 'ro' ? '1 Home' : '1 Gazdă', odd: (100/(Math.max(home_w,1)*1.08)).toFixed(2), color: '#3b82f6' },
              { label: lang !== 'ro' ? 'X Draw' : 'X Egal', odd: (100/(Math.max(draw,1)*1.08)).toFixed(2), color: '#6b7280' },
              { label: lang !== 'ro' ? '2 Away' : '2 Oaspete', odd: (100/(Math.max(away_w,1)*1.08)).toFixed(2), color: '#f97316' },
            ].map(o => (
              <div key={o.label} className="bg-gray-800/50 rounded-xl p-3 text-center border border-gray-700/30">
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{o.label}</div>
                <div className="text-xl font-bold font-mono" style={{ color: o.color }}>{o.odd}</div>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-gray-700 text-center mt-2 font-mono">{lang !== 'ro' ? '* Estimated odds with 8% margin · Verify at Betano/bet365' : '* Cote estimate cu marjă 8% · Verifică la Betano/bet365'}</div>
        </div>

        {/* Top 3 pariuri */}
        <div className="mt-4 pt-4 border-t border-gray-800/60">
          <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-3 text-center">🏆 {lang !== 'ro' ? 'Top 3 recommended analyses' : 'Top 3 analize recomandate'}</div>
          <div className="space-y-2">
            {top3.map((bet, i) => (
              <div key={i} className="flex items-center gap-3 bg-gray-800/40 rounded-xl px-3 py-2.5">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: i === 0 ? '#f59e0b' : i === 1 ? '#9ca3af' : '#b45309', color: '#000' }}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white font-semibold truncate">{bet.name}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{bet.confidence} · {lang !== 'ro' ? 'odds ~' : 'cotă ~'}{bet.odds}</div>
                </div>
                <div className="text-sm font-bold font-mono shrink-0" style={{ color: getProbColor(bet.probability) }}>
                  {bet.probability}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Butoane share */}
        <div className="flex gap-2 mt-4">
          <button onClick={() => shareOnWhatsApp(prediction, fixture)}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)', color: 'white' }}>
            📤 WhatsApp
          </button>
          <button onClick={() => shareOnTelegram(prediction, fixture)}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', color: 'white' }}>
            ✈️ Telegram
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4" style={{ overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button key={tab.key}
            className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all
              ${activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-gray-800/60 text-gray-500 hover:text-gray-300 border border-gray-700/50'}
              ${(tab as any).locked ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => { if (!(tab as any).locked) setActiveTab(tab.key) }}>
            {(tab as any).locked ? `🔒 ${tab.label}` : tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Pariuri — TOATE piețele */}
      {activeTab === 'markets' && (
        <div className="card p-5 fade-in" style={{ overflow: 'visible' }}>
          {(() => {
            const groups = allMarkets
            if (isFree) {
              // Show 1X2 group, blur the rest
              const first = groups[0]
              return (
                <>
                  <div className="mb-5">
                    <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <div className="h-px flex-1 bg-blue-900/40" />
                      <span>{first?.category}</span>
                      <div className="h-px flex-1 bg-blue-900/40" />
                    </div>
                    {first?.items.map((item: any, ii: number) => (
                      <div key={ii} className="flex items-center gap-3 py-2 border-b border-gray-800/50 last:border-0">
                        <span className="text-xs text-gray-400 flex-1 truncate">{item.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold font-mono text-gray-600" style={{ filter: 'blur(4px)' }}>
                            {item.probability}%
                          </span>
                          <span className="text-[10px] text-gray-700" style={{ filter: 'blur(3px)' }}>~{item.odds}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="relative rounded-xl overflow-hidden" style={{ minHeight: 180 }}>
                    <div style={{ filter: 'blur(6px)', pointerEvents: 'none', userSelect: 'none' }}>
                      {groups.slice(1, 4).map((group: any, gi: number) => (
                        <div key={gi} className="mb-4">
                          <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2">{group.category}</div>
                          {group.items.slice(0, 3).map((item: any, ii: number) => <MarketRow key={ii} market={item} />)}
                        </div>
                      ))}
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                      style={{ background: 'rgba(0,0,0,0.5)' }}>
                      <div className="text-white text-sm font-bold text-center">🔒 {lang !== 'ro' ? 'Markets locked' : 'Piețe blocate'}</div>
                      <div className="text-gray-400 text-xs text-center px-4">Over/Under · BTTS · {lang !== 'ro' ? 'Double Chance' : 'Șansă dublă'} · Score Matrix</div>
                      <a href="/upgrade" className="px-5 py-2 rounded-full text-xs font-bold"
                        style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', color: 'white' }}>
                        ⚡ Analyst — {lang !== 'ro' ? '$8/mo' : '39 RON/lună'}
                      </a>
                    </div>
                  </div>
                </>
              )
            }
            return (
              <>
                <div style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace', marginBottom: 8 }}>
                  {groups.length} categorii disponibile
                </div>
                {groups.map((group: any, gi: number) => (
                  <div key={gi} className="mb-5">
                    <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <div className="h-px flex-1 bg-blue-900/40" />
                      <span>{group.category}</span>
                      <div className="h-px flex-1 bg-blue-900/40" />
                    </div>
                    {group.items.map((item: any, ii: number) => <MarketRow key={ii} market={item} />)}
                  </div>
                ))}
              </>
            )
          })()}

        </div>
      )}

      {/* Tab: Bet Value */}
      {activeTab === 'value' && !isProOrOwner && (
        <div className="card p-6 fade-in text-center" style={{ overflow: 'hidden' }}>
          <div className="text-3xl mb-3">💎</div>
          <div className="text-sm font-bold text-white mb-2">{lang !== 'ro' ? 'Value Signal — Pro feature' : 'Semnal Valoare — funcție Pro'}</div>
          <div className="text-xs text-gray-500 mb-4 px-4">{lang !== 'ro' ? 'See exactly which selections have positive expected value vs. the market. Exclusive to Pro.' : 'Vezi exact ce selecții au valoare așteptată pozitivă față de piață. Exclusiv Pro.'}</div>
          <a href="/upgrade" className="inline-block px-6 py-2.5 rounded-full text-sm font-bold"
            style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: 'white' }}>
            {lang !== 'ro' ? 'Upgrade to Pro — $20/mo' : 'Upgrade la Pro — 99 RON/lună'}
          </a>
        </div>
      )}
      {activeTab === 'value' && isProOrOwner && (
        <div className="card p-5 fade-in" style={{ overflow: 'hidden' }}>
          <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1 text-center">💎 {lang !== 'ro' ? 'High Conviction Markets' : 'Piețe cu Convingere Ridicată'}</div>
          <div className="text-[10px] text-gray-600 text-center mb-1 font-mono">{lang !== 'ro' ? 'Markets where model confidence ≥55% · Estimated odds only' : 'Piețe cu probabilitate model ≥55% · Cote doar estimate'}</div>
          <div className="text-[10px] text-amber-600 text-center mb-4 font-mono">
            {lang !== 'ro' ? '⚠️ Estimated odds — always verify at your bookmaker before betting' : '⚠️ Cote estimate — verifică întotdeauna la bookmaker-ul tău înainte de a paria'}
          </div>
          {valueBets.length === 0 ? (
            <div className="text-center py-8 text-gray-600 text-sm">{lang !== 'ro' ? 'No high-conviction bets for this match' : 'Nu există pariuri cu convingere ridicată pentru acest meci'}</div>
          ) : (
            <div className="space-y-3">
              {valueBets.map((bet, i) => (
                <div key={i} className="bg-gray-800/40 rounded-xl p-4 border" style={{ borderColor: `${bet.color}30` }}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{bet.name}</div>
                      <div className="text-[10px] font-bold mt-0.5" style={{ color: bet.color }}>{bet.rating}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold font-mono" style={{ color: bet.color }}>{bet.probability}%</div>
                      <div className="text-[10px] text-gray-600 font-mono">{lang !== 'ro' ? 'model probability' : 'probabilitate model'}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="bg-gray-900/50 rounded-lg p-2 text-center">
                      <div className="text-[10px] text-gray-600 uppercase tracking-widest">{lang !== 'ro' ? 'Fair odds (model)' : 'Cotă corectă (model)'}</div>
                      <div className="text-sm font-bold font-mono text-white">{bet.fair_odds}</div>
                      <div className="text-[9px] text-gray-700 mt-0.5">{lang !== 'ro' ? 'bet if odds ≥ this' : 'pariază dacă cota ≥ asta'}</div>
                    </div>
                    <div className="bg-gray-900/50 rounded-lg p-2 text-center">
                      <div className="text-[10px] text-gray-600 uppercase tracking-widest">{lang !== 'ro' ? 'Est. bookmaker odds*' : 'Cotă est. bookmaker*'}</div>
                      <div className="text-sm font-bold font-mono" style={{ color: bet.color }}>{bet.est_bk_odds}</div>
                      <div className="text-[9px] text-gray-700 mt-0.5">{lang !== 'ro' ? '~8% margin applied' : 'marjă ~8% aplicată'}</div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="text-[10px] text-gray-700 text-center mt-3 font-mono px-4">
                {lang !== 'ro' ? '* Estimated odds based on model probabilities + 8% bookmaker margin. Not real market odds. Always verify before betting. Bet responsibly.' : '* Cote estimate pe baza probabilităților modelului + marjă 8%. Nu sunt cote reale de piață. Verificați întotdeauna înainte de a paria. Pariați responsabil.'}
              </div>
            </div>
          )}

          {/* ── Comparator cotă reală vs. model ───────────────────────── */}
          <OddsComparator prediction={prediction} />
        </div>
      )}

      {/* Tab: Scoruri + Score Matrix */}
      {activeTab === 'scores' && !isFree && (
        <div className="card p-5 fade-in" style={{ overflow: 'hidden' }}>
          <div className="flex gap-4 mb-4 text-center">
            {[
              { label: lang !== 'ro' ? 'xG Home' : 'xG Gazdă', value: prediction.expected_goals?.home?.toFixed(2) ?? '—', color: '#3b82f6' },
              { label: lang !== 'ro' ? 'xG Away' : 'xG Oaspete', value: prediction.expected_goals?.away?.toFixed(2) ?? '—', color: '#f97316' },
            ].map(s => (
              <div key={s.label} className="flex-1 bg-gray-800/40 rounded-xl p-4">
                <div className="text-3xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs text-gray-600 uppercase tracking-widest mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Score Matrix — Poisson bivariate */}
          {(() => {
            const lH = prediction.expected_goals?.home ?? 1.4
            const lA = prediction.expected_goals?.away ?? 1.2
            const poi = (l: number, k: number) => {
              let t = Math.exp(-l); for (let i = 0; i < k; i++) t *= l / (i + 1); return t
            }
            const rows = [0,1,2,3,4]
            const maxP = Math.max(...rows.flatMap(h => rows.map(a => poi(lH,h)*poi(lA,a))))
            return (
              <div className="mb-5">
                <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2 text-center">🎯 Score Matrix — Probabilitate per scor exact</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr>
                        <td className="text-gray-700 text-center pb-1 pr-1">G↓ A→</td>
                        {rows.map(a => <th key={a} className="text-orange-400 text-center pb-1 w-10">{a}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(h => (
                        <tr key={h}>
                          <td className="text-blue-400 font-bold text-center pr-1 py-0.5">{h}</td>
                          {rows.map(a => {
                            const p = poi(lH, h) * poi(lA, a)
                            const pct = Math.round(p * 100)
                            const intensity = p / maxP
                            const bg = h > a
                              ? `rgba(59,130,246,${intensity * 0.7})`
                              : a > h
                              ? `rgba(249,115,22,${intensity * 0.7})`
                              : `rgba(107,114,128,${intensity * 0.7})`
                            return (
                              <td key={a} className="text-center py-1 rounded" style={{ backgroundColor: bg }}>
                                <span className="text-white font-bold">{pct}%</span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-3 justify-center mt-2 text-[9px] font-mono text-gray-600">
                  <span><span className="text-blue-400">■</span> {lang !== 'ro' ? 'Home win' : 'Victorie gazdă'}</span>
                  <span><span className="text-gray-400">■</span> {lang !== 'ro' ? 'Draw' : 'Egal'}</span>
                  <span><span className="text-orange-400">■</span> {lang !== 'ro' ? 'Away win' : 'Victorie oaspete'}</span>
                </div>
              </div>
            )
          })()}

          <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-3 text-center">{lang !== 'ro' ? 'Most likely scores' : 'Top scoruri probabile'}</div>
          <div className="grid grid-cols-2 gap-2">
            {(prediction.top_scores || []).slice(0, 8).map((s: any, i: number) => (
              <div key={i} className="flex justify-between items-center bg-gray-800/30 rounded-lg px-3 py-2">
                <span className="font-display text-lg text-white tracking-widest">{s.score}</span>
                <span className="text-xs font-mono text-blue-400">{s.probability}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Statistici + Head-to-Head */}
      {activeTab === 'stats' && (
        <div className="fade-in space-y-4" style={{ overflow: 'hidden' }}>
          {prediction.home_stats && prediction.away_stats && (
            <div className="card p-5">
              <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-4 text-center">⚔️ Head-to-Head</div>
              <div className="flex justify-between items-center mb-4">
                <div className="text-center" style={{ flex: 1 }}>
                  <div className="text-sm font-bold text-blue-400 truncate">{prediction.home_team.split(' ').slice(-1)[0]}</div>
                  <div className="text-[10px] text-gray-600">{lang !== 'ro' ? 'HOME' : 'GAZDĂ'}</div>
                </div>
                <div className="text-gray-600 text-xs font-mono px-3">VS</div>
                <div className="text-center" style={{ flex: 1 }}>
                  <div className="text-sm font-bold text-orange-400 truncate">{prediction.away_team.split(' ').slice(-1)[0]}</div>
                  <div className="text-[10px] text-gray-600">{lang !== 'ro' ? 'AWAY' : 'OASPETE'}</div>
                </div>
              </div>
              {prediction.home_stats.h2h_home_wins !== undefined && (
                <div className="mb-4 bg-gray-800/30 rounded-xl p-3">
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2 text-center">📚 {lang !== 'ro' ? 'Recent head-to-head' : 'Meciuri directe recente'}</div>
                  <div className="flex justify-around">
                    {[
                      { label: lang !== 'ro' ? 'Home wins' : 'Victorii gazdă', value: prediction.home_stats.h2h_home_wins, color: '#3b82f6' },
                      { label: lang !== 'ro' ? 'Draws' : 'Egaluri', value: prediction.home_stats.h2h_draws, color: '#6b7280' },
                      { label: lang !== 'ro' ? 'Away wins' : 'Victorii oaspete', value: prediction.home_stats.h2h_away_wins, color: '#f97316' },
                    ].map(h => (
                      <div key={h.label} className="text-center">
                        <div className="text-2xl font-bold font-mono" style={{ color: h.color }}>{h.value}</div>
                        <div className="text-[9px] text-gray-600 uppercase tracking-widest mt-1">{h.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <StatBar label="xG For" homeVal={prediction.home_stats.xg_for ?? 1.5} awayVal={prediction.away_stats.xg_for ?? 1.2} />
              <StatBar label="xG Against" homeVal={prediction.home_stats.xg_against ?? 1.2} awayVal={prediction.away_stats.xg_against ?? 1.5} />
              <StatBar label={lang !== 'ro' ? 'Goals/match' : 'Goluri/meci'} homeVal={prediction.home_stats.goals_avg ?? 1.5} awayVal={prediction.away_stats.goals_avg ?? 1.2} />
              <StatBar label="Elo Rating" homeVal={prediction.home_stats.elo_rating ?? 1500} awayVal={prediction.away_stats.elo_rating ?? 1500} format={(v) => Math.round(v).toString()} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            <TeamStatsCard stats={prediction.home_stats} teamName={prediction.home_team} color="#3b82f6" />
            <TeamStatsCard stats={prediction.away_stats} teamName={prediction.away_team} color="#f97316" />
          </div>
        </div>
      )}

      {/* Tab: Clasament */}
      {activeTab === 'standings' && (
        <div className="card p-5 fade-in" style={{ overflow: 'hidden' }}>
          <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-4 text-center">{lang !== 'ro' ? 'Standings · Current season' : 'Clasament · Sezon curent'}</div>
          <StandingsTable standings={standings} highlightTeams={[prediction.home_team, prediction.away_team]} />
          {standings.length === 0 && (
            <p className="text-center text-xs text-gray-600 mt-2">{lang !== 'ro' ? 'Standings available for major leagues' : 'Clasamentul e disponibil pentru ligile majore'}</p>
          )}
        </div>
      )}

      {/* Tab: Modele */}
      {activeTab === 'models' && !isProOrOwner && (
        <div className="card p-6 fade-in text-center" style={{ overflow: 'hidden' }}>
          <div className="text-3xl mb-3">🤖</div>
          <div className="text-sm font-bold text-white mb-2">{lang !== 'ro' ? 'Model breakdown — Pro feature' : 'Detalii model — funcție Pro'}</div>
          <div className="text-xs text-gray-500 mb-4 px-4">{lang !== 'ro' ? 'Full XGBoost + Elo + Poisson breakdown with weights and probabilities per model. Exclusive to Pro.' : 'Detalii complete XGBoost + Elo + Poisson cu ponderi și probabilități per model. Exclusiv Pro.'}</div>
          <a href="/upgrade" className="inline-block px-6 py-2.5 rounded-full text-sm font-bold"
            style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: 'white' }}>
            {lang !== 'ro' ? 'Upgrade to Pro — $20/mo' : 'Upgrade la Pro — 99 RON/lună'}
          </a>
        </div>
      )}
      {activeTab === 'models' && isProOrOwner && (
        <div className="card p-5 fade-in" style={{ overflow: 'hidden' }}>
          <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-4 text-center">{lang !== 'ro' ? 'Prediction model details' : 'Detalii modele predicție'}</div>
          <div className="space-y-4">
            {[
              { key: 'elo',     label: '⚡ Elo Rating', color: '#a78bfa', weight: '15-20%' },
              { key: 'poisson', label: '📐 Poisson xG',  color: '#34d399', weight: '35-40%' },
              { key: 'xgboost', label: '🤖 XGBoost',     color: '#60a5fa', weight: '40-50%' },
            ].map(({ key, label, color, weight }) => {
              const data = breakdown[key]
              if (!data) return null
              return (
                <div key={key} className="bg-gray-800/30 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-bold" style={{ color }}>{label}</span>
                    <span className="text-[10px] text-gray-600 font-mono">{lang !== 'ro' ? 'Weight' : 'Pondere'}: {weight}</span>
                  </div>
                  <div className="flex justify-around">
                    {[
                      { l: '1', v: data.home_win ?? data.home },
                      { l: 'X', v: data.draw },
                      { l: '2', v: data.away_win ?? data.away },
                    ].map(({ l, v }) => (
                      <div key={l} className="text-center">
                        <div className="text-lg font-bold font-mono" style={{ color }}>{v ?? '—'}%</div>
                        <div className="text-[10px] text-gray-600 uppercase">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const QUICK_LEAGUES = [
  { id: 39,  flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', nameRo: 'Premier League', nameEn: 'Premier League', acc: 70.0 },
  { id: 140, flag: '🇪🇸',       nameRo: 'La Liga',        nameEn: 'La Liga',        acc: 64.5 },
  { id: 78,  flag: '🇩🇪',       nameRo: 'Bundesliga',     nameEn: 'Bundesliga',     acc: 79.4 },
  { id: 135, flag: '🇮🇹',       nameRo: 'Serie A',        nameEn: 'Serie A',        acc: 71.1 },
  { id: 61,  flag: '🇫🇷',       nameRo: 'Ligue 1',        nameEn: 'Ligue 1',        acc: 79.4 },
  { id: 94,  flag: '🇵🇹',       nameRo: 'Primeira Liga',  nameEn: 'Primeira Liga',  acc: 73.2 },
  { id: 88,  flag: '🇳🇱',       nameRo: 'Eredivisie',     nameEn: 'Eredivisie',     acc: null },
  { id: 40,  flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', nameRo: 'Championship',   nameEn: 'Championship',   acc: null },
  { id: 2,   flag: '🏆',        nameRo: 'Champions Lg',   nameEn: 'Champions Lg',   acc: null },
]

function Home() {
  const { lang } = useLang()
  const tr = t[lang]
  const searchParams = useSearchParams()
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  useEffect(() => {
    setUser(getUser())
    refreshTier().then(() => setUser(getUser()))
  }, [])
  const [leagues, setLeagues] = useState<League[]>([])
  const [selectedLeague, setSelectedLeague] = useState<number | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [standings, setStandings] = useState<StandingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingFixtures, setLoadingFixtures] = useState(false)
  const [predError, setPredError] = useState<string | null>(null)

  const nextDays = getNextDays(10)

  useEffect(() => {
    axios.get(`${API_BASE}/api/leagues`).then(r => setLeagues(r.data.leagues || []))
  }, [])

  // Auto-selecteaza liga din URL ?league=ID
  useEffect(() => {
    const leagueParam = searchParams.get('league')
    if (leagueParam) {
      const id = Number(leagueParam)
      if (!isNaN(id) && id > 0) setSelectedLeague(id)
    }
  }, [searchParams])

  const selectLeague = (id: number) => {
    setSelectedLeague(id)
    router.replace(`/?league=${id}`, { scroll: false })
  }

  useEffect(() => {
    if (!selectedLeague) return
    setFixtures([]); setSelectedFixture(null); setPrediction(null); setStandings([])
    setLoadingFixtures(true)
    const leagueCode = leagues.find(l => l.id === selectedLeague)?.code || String(selectedLeague)
    const KNOCKOUT_LEAGUES = [2, 3] // CL, EL — faza eliminatorie, standings irelevante
    const standingsPromise = KNOCKOUT_LEAGUES.includes(selectedLeague)
      ? Promise.resolve({ data: { standings: [] } })
      : axios.get(`${API_BASE}/api/standings/${leagueCode}`).catch(() => ({ data: { standings: [] } }))
    Promise.all([
      axios.get(`${API_BASE}/api/fixtures/${selectedLeague}`).catch(() => ({ data: { fixtures: [] } })),
      standingsPromise,
    ]).then(([fixtRes, standRes]) => {
      const all: Fixture[] = fixtRes.data.fixtures || []
      const todayStr = new Date().toISOString().split('T')[0]
      const upcoming = all.filter((f: Fixture) => f.date && f.date >= todayStr).sort((a: Fixture, b: Fixture) => (a.date || '').localeCompare(b.date || '')).slice(0, 30)
      const filtered = all.filter((f: Fixture) => nextDays.includes(f.date))
      setFixtures(filtered.length > 0 ? filtered : upcoming.length > 0 ? upcoming : all.slice(0, 30))
      setStandings(standRes.data.standings || [])
    }).finally(() => setLoadingFixtures(false))
  }, [selectedLeague])

  const predict = async (fix?: Fixture) => {
    const fixture = fix || selectedFixture
    if (!fixture) return
    setLoading(true); setPrediction(null); setPredError(null)
    try {
      const r = await axios.get(`${API_BASE}/api/predict`, {
        params: {
          home_team: fixture.home,
          away_team: fixture.away,
          league_id: selectedLeague || 39,
          home_team_id: fixture.home_id,
          away_team_id: fixture.away_id,
        }
      })
      setPrediction(r.data)
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || 'Eroare la generarea predicției'
      setPredError(detail)
    } finally { setLoading(false) }
  }

  const confGroups = ['UEFA', 'CONMEBOL', 'CONCACAF', 'AFC', 'CAF', 'OFC']
  const grouped = confGroups.reduce((acc, c) => {
    acc[c] = leagues.filter(l => l.confederation === c)
    return acc
  }, {} as Record<string, League[]>)

  const fixturesByDay = nextDays.reduce((acc, day) => {
    const dayFixtures = fixtures.filter(f => f.date === day)
    if (dayFixtures.length > 0) acc[day] = dayFixtures
    return acc
  }, {} as Record<string, Fixture[]>)

  const hasDatedFixtures = Object.keys(fixturesByDay).length > 0
  const fixturesWithoutDate = fixtures.filter(f => !f.date || !nextDays.includes(f.date))

  return (
    <div style={{ overflowX: 'hidden', minHeight: '100vh' }} className="app-bg grid-bg">

      <main style={{ maxWidth: '72rem', overflowX: 'hidden', padding: '0 16px' }} className="mx-auto py-8">
        <div className="text-center mb-10 fade-in">
          <div className="flex justify-center mb-5">
            <div className="relative">
              <img src="/logo-icon.jpg" alt="Oxiano"
                style={{ width: 220, height: 220, objectFit: 'contain' }} />
            </div>
          </div>
          <div className="text-blue-400 text-sm font-mono uppercase tracking-widest mb-3">{lang !== 'ro' ? 'Defining the Edge' : 'Definim avantajul'}</div>
          <p className="text-gray-500 text-xs font-mono uppercase tracking-widest">{tr.hero_sub}</p>
        </div>

        {/* ── Ligi rapide ─────────────────────────────────────────── */}
        <div className="mb-6 fade-in">
          <div className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-3 text-center">
            {lang !== 'ro' ? 'Quick select — top leagues' : 'Selectare rapidă — ligi principale'}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {QUICK_LEAGUES.map(ql => {
              const active = selectedLeague === ql.id
              return (
                <button
                  key={ql.id}
                  onClick={() => selectLeague(ql.id)}
                  style={{
                    flexShrink: 0,
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: `1px solid ${active ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.07)'}`,
                    background: active ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    minWidth: 90,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{ql.flag}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#4ade80' : '#d1d5db', whiteSpace: 'nowrap' }}>
                    {lang !== 'ro' ? ql.nameEn : ql.nameRo}
                  </div>
                  {ql.acc && (
                    <div style={{ fontSize: 9, fontFamily: 'monospace', color: active ? '#86efac' : '#4b5563', marginTop: 2 }}>
                      {ql.acc}% acc
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <TierComparisonTable />

        <div className="card p-6 mb-6 fade-in">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">{tr.select_league}</label>
              <select className="select-styled" value={selectedLeague || ''} onChange={e => selectLeague(Number(e.target.value))}>
                <option value="">{tr.select_league_placeholder}</option>
                {confGroups.map(conf => (
                  grouped[conf]?.length > 0 && (
                    <optgroup key={conf} label={`── ${conf} ──`}>
                      {grouped[conf].map(l => (
                        <option key={l.id} value={l.id}>{l.flag} {l.name} — {l.country}</option>
                      ))}
                    </optgroup>
                  )
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Meci {fixtures.length > 0 && <span className="text-blue-500 ml-1">({fixtures.length} disponibile)</span>}
              </label>
              {loadingFixtures ? (
                <div className="select-styled flex items-center gap-2 text-gray-500">
                  <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Se încarcă meciurile...
                </div>
              ) : (
                <select className="select-styled"
                  value={selectedFixture ? fixtures.indexOf(selectedFixture) : ''}
                  onChange={e => {
                    const val = e.target.value
                    const f = val !== '' ? fixtures[Number(val)] : null
                    setSelectedFixture(f || null)
                    setPrediction(null)
                    setPredError(null)
                    if (f) predict(f)
                  }}
                  disabled={fixtures.length === 0}>
                  <option value="">{fixtures.length === 0 ? tr.select_match_placeholder : tr.select_match_placeholder2}</option>
                  {hasDatedFixtures ? (
                    nextDays.map(day => (
                      fixturesByDay[day]?.length > 0 && (
                        <optgroup key={day} label={`── ${getDayLabel(day)} · ${formatDateRO(day)} ──`}>
                          {fixturesByDay[day].map(f => {
                            const idx = fixtures.indexOf(f)
                            return <option key={idx} value={idx}>{f.home} vs {f.away}{f.time ? ` · ${f.time}` : ''}</option>
                          })}
                        </optgroup>
                      )
                    ))
                  ) : (
                    fixtures.map((f, idx) => (
                      <option key={idx} value={idx}>
                        {f.home} vs {f.away}{f.date ? ` · ${formatDateRO(f.date)}` : ''}{f.time ? ` · ${f.time}` : ''}
                      </option>
                    ))
                  )}
                  {hasDatedFixtures && fixturesWithoutDate.length > 0 && (
                    <optgroup label="── Alte meciuri ──">
                      {fixturesWithoutDate.map(f => {
                        const idx = fixtures.indexOf(f)
                        return <option key={idx} value={idx}>{f.home} vs {f.away}</option>
                      })}
                    </optgroup>
                  )}
                </select>
              )}
            </div>
            <div>
              <button className="btn-accent w-full" onClick={() => predict()} disabled={!selectedFixture || loading}>
                {loading ? '⏳ ...' : tr.predict_btn}
              </button>
              {selectedFixture && (
                <p className="text-[11px] font-mono text-gray-500 mt-2 text-center">
                  {getDayLabel(selectedFixture.date)} · {formatDateRO(selectedFixture.date)}
                  {selectedFixture.time && ` · 🕐 ${selectedFixture.time}`}
                </p>
              )}
              {predError && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 12, fontFamily: 'monospace', textAlign: 'center' }}>
                  ⚠️ {predError}
                </div>
              )}
            </div>
          </div>

          {standings.length > 0 && !prediction && !loading && (
            <div className="mt-5 pt-5 border-t border-gray-800">
              <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-3 text-center">🏆 Clasament · Selectează un meci din lista de sus</div>
              <StandingsTable standings={standings} highlightTeams={[]} />
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 fade-in">
            <div className="text-center">
              <div className="spinner mx-auto mb-4" />
              <p className="text-blue-300 text-sm font-mono uppercase tracking-widest">Calculez predicțiile AI...</p>
            </div>
          </div>
        )}

        {prediction && !loading && selectedFixture && (
          <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
            <PredictionDisplay prediction={prediction} fixture={selectedFixture} standings={standings} user={user} />
          </div>
        )}

        {!prediction && !loading && !selectedLeague && (
          <div className="text-center py-20 fade-in">
            <div className="text-6xl opacity-10 mb-4">⚽</div>
            <p className="font-display text-2xl text-gray-600 tracking-widest mb-2">{tr.empty_title}</p>
            <p className="text-gray-700 text-sm font-mono">{tr.empty_sub}</p>
          </div>
        )}
      </main>

      <footer className="border-t border-blue-900/40 mt-12 py-6">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-xs font-mono text-gray-700">{tr.footer}</p>
<a href="/privacy" className="text-xs font-mono text-blue-600 hover:text-blue-400 mt-1 block">Politică de confidențialitate</a>
        </div>
      </footer>
    </div>
  )
}

export default function HomeWithSuspense() {
  return (
    <Suspense fallback={<div className="app-bg grid-bg" style={{ minHeight: '100vh' }} />}>
      <Home />
    </Suspense>
  )
}
