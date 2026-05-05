# Oxiano (Football Predictor) — CLAUDE.md
# Actualizat: 5 mai 2026

## Stack & Deploy
- **Backend**: FastAPI → Render Starter ($7/lună) → `https://football-predictor-vlpp.onrender.com`
- **Frontend**: Next.js 14 → Vercel → `https://flopiforecastro.vercel.app`
- **DB**: Supabase PostgreSQL (tabele: `users`, `predictions`, `daily_picks`, `pick_results`, `password_resets`)
- **Cache**: Upstash Redis REST + fallback in-memory (`cache.py`)
- **Model**: XGBoost `xgb-v2` (84 features) — dual pkl: `model.pkl` + `model_no_odds.pkl` (ambele în repo, nu în .gitignore)
- **Repo**: `https://github.com/andreflo2000/football-predictor`

## Structura backend (`/backend`)
```
main.py             # FastAPI app, toate endpoint-urile + scheduler APScheduler
predictor.py        # predict_match(), ~80 features XGBoost+Elo+Poisson+Market Intel
ingestion.py        # compute_and_store_picks(), load_picks_from_db(), auto_mark_results()
fixtures.py         # get_today_fixtures(), get_today_odds(), get_injuries_today()
circuit_breaker.py  # CircuitBreaker thread-safe — football-data/api-football/the-odds-api
club_elo.py         # fetch_club_elo() — clubelo.com, cache Redis 24h, 47 echipe mappate
cache.py            # Redis REST cache cu fallback in-memory, inclusiv ttl()
bet_signal.py       # pipeline dual-model pentru semnale (intern, nu expus ca "pariu")
calibrator.py       # CalibratedXGB — isotonic regression pe set separat
auth.py             # JWT register/login/forgot-password/reset-password/RBAC/GDPR
db.py               # get_client() → Supabase service_role client
notifications.py    # Telegram bot + Resend email digest
train.py            # antrenare model XGBoost (cu odds)
train_no_odds.py    # antrenare model XGBoost (fara odds)
model.pkl           # model principal (cu odds) — in repo
model_no_odds.pkl   # model fara odds — in repo
```

## Structura frontend (`/frontend/src/app`)
```
page.tsx            # Homepage
daily/              # Probability outputs zilnice (picks) — pagina principala
login/              # Register/Login/Forgot password/Reset password (cod 6 cifre email)
upgrade/            # Pricing Analyst 39 RON / Pro 99 RON (Gumroad)
track-record/       # Statistici acuratete live — breakdown per confidence tier
despre/             # Metodologie quant analytics — fara "86.1%", acum "62-67%"
predictii/[liga]/   # SEO pages per liga — ISR 1h, JSON-LD
ghid-piete/         # Ghid piete de pariu
blog/               # Blog posts
admin/              # Admin panel
bet-builder/        # Combo Analyzer Kelly
weekly/             # Picks saptamanale
terms/, privacy/    # Legal ONJN-safe
```

## Scheduler APScheduler (main.py startup)
```
07:00 Bucuresti  → compute_and_store_picks() [picks AZI]
07:30 Bucuresti  → compute_and_store_picks(azi+1) [picks MAINE]
08:00 Bucuresti  → compute_and_store_picks(azi+2) [picks POIMAINE]
09:00 Bucuresti  → bet_signal.run_pipeline()
13:00 Bucuresti  → compute_and_store_picks() [refresh picks AZI]
23:30 Bucuresti  → auto_mark_results() [WIN/LOSS în pick_results]
23:45 Bucuresti  → bet_signal.update_results()
06:00 Bucuresti  → refresh_clubelo() [Elo extern]
```

## Rezilienta (implementata 5 mai 2026)
- **circuit_breaker.py**: 3 failures → circuit deschis 5 min pentru football-data/api-football/the-odds-api
- **Request coalescing**: `_coalesced_compute()` în main.py — un singur thread calculeaza, restul asteapta
- **Stale-while-revalidate**: TTL < 5 min → serve stale + refresh BackgroundTask
- **cache.ttl()**: returneaza TTL ramas pentru detectie stale
- **`/api/health/circuits`**: endpoint admin (header X-Admin-Secret) pentru status circuite

## Variabile de mediu (Render)
```
SUPABASE_URL, SUPABASE_KEY (service_role — NU anon key!)
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
FOOTBALL_DATA_KEY       # football-data.org
API_FOOTBALL_KEY        # api-football.com
ODDS_API_KEY            # the-odds-api.com
JWT_SECRET
TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID
RESEND_API_KEY
SENTRY_DSN
FRONTEND_URL
ADMIN_SECRET
GUMROAD_SELLER_ID       # validare webhook Gumroad (prin body, nu query param)
```

## Stare features (5 mai 2026)
- [x] Auth JWT + bcrypt + RBAC + rate limiting + GDPR
- [x] Forgot password (cod 6 cifre email via Resend, tabel password_resets)
- [x] XGBoost xgb-v2 dual model (cu/fara odds) + isotonic calibration
- [x] 3-layer cache Redis→Supabase→live + circuit breaker + coalescing + stale-while-revalidate
- [x] APScheduler 07:00/07:30/08:00/09:00/13:00/23:30/23:45/06:00
- [x] Telegram + Email notifications
- [x] Gumroad webhook conectat (seller_id body validation, URL corect vlpp)
- [x] Auto-mark WIN/LOSS la 23:30 (auto_mark_results in ingestion.py)
- [x] ClubElo.com integrat — 47 echipe mapate corect (fix 17 nume 5 mai 2026)
- [x] SEO pages /predictii/[liga] — ISR 1h, JSON-LD, sitemap
- [x] Track record live — breakdown per confidence tier, UX de-emphasize 47% overall
- [x] Market intelligence: sharp vs soft, edge, kelly, value_zone, bookmaker divergence
- [x] Injury adjustment post-predictie (max ±6%, 5 ligi majore)
- [x] VIP blur overlay (tier pro/vip/owner vede toate picks)
- [x] Google Analytics 4 + Sentry
- [x] Android Capacitor 8.3.0 (build ready)
- [x] SQL migrations rulate: model_version, stripe_sub_id, password_resets, pick_results

## Acuratete model (track record live, 5 mai 2026)
```
Confidence ≥65%:  66.7% (10/15 picks) — publicat corect pe "despre" ca "62-67%"
Confidence ≥60%:  60.0% (15/25 picks)
Toate picks:      47.8% (54/113 picks) — include confidence redus, de-emphasized in UI
```
Pagina "despre": cifra "86.1% La Liga" eliminata complet, inlocuita cu "62-67%"
Track-record UI: ≥65% conf proeminent (verde, border, badge "Recomandat"), overall gri/opacity 0.6

## Pricing
- Analyst: 39 RON/lună = ~$8 (Gumroad)
- Pro: 99 RON/lună = ~$20 (Gumroad)

## Brand / pozitionare
- **Oxiano este platformă SaaS de analiză cantitativă sportivă** — NU site de ponturi
- Terminologie corecta: "probability outputs", "model assessments", "market divergence"
- NU: "picks", "value bet", "predicții de pariu"
- Disclaimer obligatoriu: "Analiză statistică în scop educațional · Nu constituie sfat de pariere"
- bet_signal.py este modul intern — nu expus ca "recomandare de pariu" catre useri

## ROADMAP — DE IMPLEMENTAT SESIUNEA URMATOARE

### Prioritate 1 — Imbunatatiri model (free, fara costuri API)
1. **Understat xG real** — scraping understat.com, inlocuieste proxy-ul `(atk+def)/2`
   - Fisiere de modificat: `download_data.py` (nou scraper), `train.py` (feature nou), `predictor.py`
   - Necesita retrain dupa integrare
   - Impact: credibilitate tehnica majora ("xG real, nu proxy")

2. **Home advantage per liga in Elo** — inlocuieste `elo_diff_adj = elo_diff + 50` (fix global)
   - Fisier: `predictor.py` linia 137 si `train.py`
   - Calculeaza `home_adv` per liga din CSV training data (media home_goals - away_goals)
   - Zero cost, zero dependente, model mai precis

3. **Draw calibrare per liga** — inlocuieste `DRAW_BOOST = 1.4` global
   - Fisier: `predictor.py` linia 356
   - Dict `DRAW_BOOST_PER_LEAGUE = {"PL": 1.3, "SA": 1.5, "BL1": 1.2, "PD": 1.4, ...}`
   - Calculeaza din recall draw pe setul de validare per liga

4. **Ligi noi training data** — football-data.co.uk CSV gratuit
   - Adauga: Süper Lig Turcia, Belgian Pro League, Scottish Premiership, Austrian Bundesliga, Swiss Super League
   - Fisier: `download_data.py` (adauga URL-uri noi), `fixtures.py` (COMPETITIONS dict)
   - Retrain dupa download

### Prioritate 2 — Valoare de piata (free, frontend/marketing)
5. **Pagina /developers** — B2B API landing page
   - Fisier nou: `frontend/src/app/developers/page.tsx`
   - Continut: Free tier / Analytics API €299/luna / Enterprise white-label
   - Nu trebuie functional — trebuie sa existe pentru pozitionare B2B

6. **Rebrand terminologie frontend**
   - "picks" → "probability outputs" sau "model assessments"
   - "Picks de azi" → "Probability Report — Today" (sau pastreaza bilingv)
   - `value_bet` afisat user → "market divergence signal"
   - Fisiere: `app/daily/page.tsx`, `app/page.tsx`, `components/`

### Prioritate 3 — Limbi noi (valoare piata europeana)
7. **Adauga DE, ES, PT** — piete de 10x mai mari ca Romania
   - Sistem de i18n existent: `lib/LangContext`, `app/i18n.ts`
   - Adauga german, spaniol, portughez la toate textele

## Comenzi utile
```bash
# Backend local
cd backend && uvicorn main:app --reload --port 8000

# Frontend local
cd frontend && npm run dev

# Antrenare model (cu odds)
cd backend && python train.py

# Antrenare model (fara odds)
cd backend && python train_no_odds.py

# Android build
cd frontend && npm run build && npx cap sync android

# Test circuit breaker status (Render)
curl -H "X-Admin-Secret: ADMIN_SECRET" https://football-predictor-vlpp.onrender.com/api/health/circuits
```

## Reguli critice
- Nu schimba `MODEL_VERSION` din `ingestion.py` fara confirmare (invalideaza tot cache-ul Supabase)
- Nu push/deploy fara confirmare explicita
- `SUPABASE_KEY` pe Render = service_role (NU anon key — a cauzat erori in trecut)
- Gumroad webhook URL: `https://football-predictor-vlpp.onrender.com/api/webhook/gumroad` (fara query params)
- model.pkl si model_no_odds.pkl sunt in `/backend/` (nu `/backend/models/`) — in repo, deployate cu codul
- Comunicare: **romana, brutal de sincer**

## Valoare estimata curenta (5 mai 2026)
- Acum (0 useri platitori): €10.000–18.000 (tehnic solid, rezilienta adaugata)
- Cu roadmap implementat (xG real + ligi noi + /developers): +€17.000–45.000 estimat
- Cu 30 useri platitori + track record 3 luni: €25.000–45.000
- Cu 100 useri + 6 luni date reale: €80.000–150.000
