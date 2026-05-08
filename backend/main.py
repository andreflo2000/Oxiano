"""
OXIANO — Backend API v2
"""

import os
import math
import datetime
import time
import logging
import threading
import requests
from fastapi import FastAPI, HTTPException, Query, Request, Depends, Header, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import sentry_sdk

from predictor import predict_match, load_model, get_known_teams
from fixtures import get_today_fixtures, get_today_odds, _fetch_fixtures_for_range, fetch_competition_fixtures
from db import log_predictions_bulk, get_client
import cache as redis_cache
from auth import register_user, login_user, get_current_user, require_user, require_admin, request_password_reset, reset_password
from ingestion import compute_and_store_picks, load_picks_from_db, auto_mark_results

logger = logging.getLogger(__name__)

# ── Request coalescing — un singur compute per data ──────────────────────────
_pick_events: dict[str, threading.Event] = {}
_pick_events_lock = threading.Lock()


def _coalesced_compute(target: str) -> dict | None:
    """
    Garanteaza ca compute_and_store_picks() ruleaza o singura data per `target`,
    indiferent de cate threaduri cer simultan (thundering herd prevention).
    """
    with _pick_events_lock:
        if target in _pick_events:
            event = _pick_events[target]
            is_leader = False
        else:
            event = threading.Event()
            _pick_events[target] = event
            is_leader = True

    if not is_leader:
        event.wait(timeout=90)
        return load_picks_from_db(target)

    try:
        return compute_and_store_picks(target)
    except Exception as e:
        logger.warning("[coalesced] compute esuat pentru %s: %s", target, e)
        return None
    finally:
        event.set()
        with _pick_events_lock:
            _pick_events.pop(target, None)

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")

# ── Sentry (erori in productie) ─────────────────────────────
_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    sentry_sdk.init(dsn=_sentry_dsn, traces_sample_rate=0.1)

# ── Rate limiter ─────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

app = FastAPI(title="Oxiano API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = [
    "https://oxiano.com",
    "https://www.oxiano.com",
    # Capacitor Android app
    "https://localhost",
    "capacitor://localhost",
    # development local
    "http://localhost:3000",
    "http://localhost:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "stripe-signature"],
    allow_credentials=True,
    max_age=600,  # cache preflight 10 minute
)



@app.on_event("startup")
async def startup_event():
    load_model()
    # Incarca Elo-uri externe de la clubelo.com (mai precise decat cele din model)
    try:
        from predictor import refresh_clubelo
        import cache as _cache_mod
        refresh_clubelo(_cache_mod)
    except Exception as _e:
        logger.warning("Club-elo refresh esuat la startup: %s", _e)
    # Goleste cache la fiecare restart — evita date invechite
    try:
        import cache as _c
        for ns in ("daily", "fixtures"):
            import datetime as _dt
            today_str = _dt.date.today().isoformat()
            _c.delete(ns, f"{today_str}:0.5")
            _c.delete(ns, f"{today_str}:0.45")
    except Exception:
        pass

    # Scheduler-ul rulează în worker.py (serviciu Render separat).
    # API-ul este pur serving — zero compute la startup.


CACHE_TTL_DAILY    = 900    # 15 minute
CACHE_TTL_FIXTURES = 86400  # 24 ore


# ─────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────
@app.get("/")
@app.head("/")
def api_root():
    return {"status": "ok", "service": "Oxiano API"}

@app.get("/health")
@app.get("/api/health")
def api_health():
    import predictor as _pred
    now = datetime.datetime.utcnow().isoformat()
    status = "ok"
    model_status = "ok"
    supabase_status = "ok"

    # Model — foloseste globalele incarcate la startup, fara reload
    try:
        vals = [_pred._model, _pred._features, _pred._team_stats, _pred._label_encoder]
        missing = [k for k, v in zip(["model", "features", "team_stats", "label_encoder"], vals) if v is None]
        if missing:
            model_status = f"not loaded: {missing}"
            status = "error"
    except Exception as e:
        model_status = str(e)
        status = "error"

    # Supabase — query simplu
    try:
        get_client().table("daily_picks").select("id").limit(1).execute()
    except Exception as e:
        supabase_status = str(e)
        status = "error"

    payload = {"status": status, "model": model_status, "supabase": supabase_status, "timestamp": now}
    if model_status != "ok":
        return JSONResponse(status_code=503, content=payload)
    return payload

@app.get("/ping")
@app.head("/ping")
def ping():
    """Keep-alive endpoint — pinged every 5 min by UptimeRobot."""
    return "pong"


@app.get("/api/health/circuits")
def health_circuits(admin_secret: str = Header(None, alias="X-Admin-Secret")):
    """Status circuit breaker per API extern."""
    if admin_secret != ADMIN_SECRET:
        raise HTTPException(403, "Forbidden")
    from circuit_breaker import cb
    return {"circuits": cb.status() or "all closed"}


# ─────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────
class AuthRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
@limiter.limit("5/minute")
def auth_register(req: AuthRequest, request: Request):
    """Inregistrare cont nou."""
    if len(req.password) < 6:
        raise HTTPException(400, "Parola trebuie sa aiba minim 6 caractere")
    return register_user(req.email, req.password)


@app.post("/api/auth/login")
@limiter.limit("10/minute")
def auth_login(req: AuthRequest, request: Request):
    """Login — returneaza JWT token."""
    return login_user(req.email, req.password)


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(require_user)):
    """Returneaza datele utilizatorului curent cu tier live din DB."""
    from db import get_client
    from datetime import datetime, timezone
    client = get_client()
    if client:
        rows = client.table("users").select("tier,tier_expires").eq("id", int(user["id"])).execute()
        if rows.data:
            row = rows.data[0]
            tier = row["tier"]
            tier_expires = row.get("tier_expires")
            role = row.get("role", "user") or "user"
            # Daca tier-ul are expirare si a expirat, retrogradam la free
            if tier_expires and tier in ("pro", "analyst", "vip"):
                try:
                    exp_dt = datetime.fromisoformat(tier_expires.replace("Z", "+00:00"))
                    if datetime.now(timezone.utc) > exp_dt:
                        client.table("users").update({"tier": "free", "tier_expires": None}).eq("id", int(user["id"])).execute()
                        tier = "free"
                except Exception:
                    pass
            user = {**user, "tier": tier, "role": role}
    return user


@app.post("/api/auth/change-password")
@limiter.limit("5/minute")
def auth_change_password(request: Request, body: dict, user: dict = Depends(require_user)):
    """Schimba parola utilizatorului autentificat."""
    from db import get_client
    from auth import _verify, _hash
    current = body.get("current_password", "")
    new_pw  = body.get("new_password", "")
    if not current or not new_pw:
        raise HTTPException(400, "Parola curenta si parola noua sunt obligatorii")
    if len(new_pw) < 6:
        raise HTTPException(400, "Parola noua trebuie sa aiba minim 6 caractere")
    if len(new_pw.encode("utf-8")) > 72:
        raise HTTPException(400, "Parola prea lunga (max 72 caractere)")
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    rows = client.table("users").select("password_hash").eq("id", int(user["id"])).execute()
    if not rows.data:
        raise HTTPException(404, "User negasit")
    if not _verify(current, rows.data[0]["password_hash"]):
        raise HTTPException(401, "Parola curenta incorecta")
    client.table("users").update({"password_hash": _hash(new_pw)}).eq("id", int(user["id"])).execute()
    return {"message": "Parola a fost schimbata cu succes"}


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    token: str
    new_password: str

@app.post("/api/auth/forgot-password")
@limiter.limit("3/minute")
def auth_forgot_password(req: ForgotPasswordRequest, request: Request):
    """Trimite cod de resetare parola pe email."""
    request_password_reset(req.email)
    return {"message": "Daca emailul exista in sistem, vei primi codul in cateva secunde."}


@app.post("/api/auth/reset-password")
@limiter.limit("5/minute")
def auth_reset_password(req: ResetPasswordRequest, request: Request):
    """Reseteaza parola folosind codul primit pe email."""
    reset_password(req.email, req.token, req.new_password)
    return {"message": "Parola a fost resetata. Te poti autentifica acum."}


@app.patch("/api/auth/notifications-consent")
def auth_notifications_consent(body: dict, user: dict = Depends(require_user)):
    """Seteaza consimtamantul pentru notificari email (GDPR opt-in)."""
    from db import get_client
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    consent = bool(body.get("consent", False))
    client.table("users").update({"notifications_consent": consent}).eq("id", int(user["id"])).execute()
    return {"notifications_consent": consent}


@app.get("/api/auth/notifications-consent")
def auth_get_notifications_consent(user: dict = Depends(require_user)):
    """Returneaza starea consimtamantului pentru notificari email."""
    from db import get_client
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    rows = client.table("users").select("notifications_consent").eq("id", int(user["id"])).execute()
    if not rows.data:
        return {"notifications_consent": False}
    return {"notifications_consent": bool(rows.data[0].get("notifications_consent", False))}


@app.delete("/api/auth/account")
def auth_delete_account(user: dict = Depends(require_user)):
    """Sterge contul si toate datele asociate (GDPR Art. 17)."""
    from db import get_client
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    try:
        uid = int(user["id"])
        client.table("predictions").delete().eq("user_id", uid).execute()
        client.table("users").delete().eq("id", uid).execute()
        return {"message": "Contul și datele tale au fost șterse complet."}
    except Exception as e:
        logger.error("[delete_account] %s", e)
        raise HTTPException(500, "Eroare la ștergere")


# ─────────────────────────────────────────────
# LIGI
# ─────────────────────────────────────────────
@app.get("/api/leagues")
def api_leagues():
    return {"leagues": [
        # Div 1
        {"id": 39,  "code": "PL",  "name": "Premier League",   "country": "England",     "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "confederation": "UEFA", "rating": 100},
        {"id": 140, "code": "PD",  "name": "La Liga",           "country": "Spain",       "flag": "🇪🇸",       "confederation": "UEFA", "rating": 95},
        {"id": 135, "code": "SA",  "name": "Serie A",           "country": "Italy",       "flag": "🇮🇹",       "confederation": "UEFA", "rating": 90},
        {"id": 78,  "code": "BL1", "name": "Bundesliga",        "country": "Germany",     "flag": "🇩🇪",       "confederation": "UEFA", "rating": 88},
        {"id": 61,  "code": "FL1", "name": "Ligue 1",           "country": "France",      "flag": "🇫🇷",       "confederation": "UEFA", "rating": 82},
        {"id": 2,   "code": "CL",  "name": "Champions League",  "country": "Europe",      "flag": "🏆",        "confederation": "UEFA", "rating": 99},
        {"id": 94,  "code": "PPL", "name": "Primeira Liga",     "country": "Portugal",    "flag": "🇵🇹",       "confederation": "UEFA", "rating": 72},
        {"id": 88,  "code": "DED", "name": "Eredivisie",        "country": "Netherlands", "flag": "🇳🇱",       "confederation": "UEFA", "rating": 70},
        # Div 2 (doar Championship disponibil pe free tier)
        {"id": 40,  "code": "ELC", "name": "Championship",      "country": "England",     "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "confederation": "UEFA", "rating": 75},
    ]}


# ─────────────────────────────────────────────
# DAILY PICKS — endpoint principal
# ─────────────────────────────────────────────

FREE_PICKS_LIMIT = 3


def _mask_vip_picks(picks: list, user: Optional[dict]) -> list:
    """Mascheaza datele vip_only pentru useri non-pro/vip."""
    tier = (user or {}).get("tier", "free")
    role = (user or {}).get("role", "user")
    if tier in ("pro", "vip", "owner") or role in ("owner", "admin"):
        result = []
        for p in picks:
            if p.get("vip_only") and p.get("home_win") is None:
                # Calculeaza predicția on-the-fly dacă lipseste din DB
                try:
                    pred = predict_match(p["home"], p["away"])
                    p = {**p,
                         "home_win":         round(pred["home_win"] * 100, 1),
                         "draw":             round(pred["draw"] * 100, 1),
                         "away_win":         round(pred["away_win"] * 100, 1),
                         "prediction":       pred["prediction"],
                         "prediction_label": {"H": "Victorie gazda", "D": "Egal", "A": "Victorie oaspete"}.get(pred["prediction"], pred["prediction"]),
                         "confidence":       round(pred["confidence"] * 100, 1),
                         "confidence_level": pred["confidence_level"],
                         "high_confidence":  pred["confidence"] >= 0.65,
                         "home_elo":         pred.get("home_elo"),
                         "away_elo":         pred.get("away_elo"),
                         "home_form":        round(pred.get("home_form", 0.4) * 100, 1),
                         "away_form":        round(pred.get("away_form", 0.4) * 100, 1),
                    }
                except Exception as e:
                    logger.warning("[mask_vip] predict_match failed pentru %s vs %s: %s", p.get("home"), p.get("away"), e)
            result.append(p)
        return result
    result = []
    for p in picks:
        if p.get("vip_only"):
            result.append({
                **p,
                "home_win": None, "draw": None, "away_win": None,
                "prediction": None, "prediction_label": "VIP",
                "confidence": None, "confidence_level": "vip",
                "high_confidence": True,
                "home_elo": None, "away_elo": None,
                "home_form": None, "away_form": None,
                "edge": None, "value_bet": None,
                "market_signal": None, "upset_risk": None,
            })
        else:
            result.append(p)

    # Free users: max 3 picks vizibile
    tier = (user or {}).get("tier", "free")
    role = (user or {}).get("role", "user")
    if tier not in ("pro", "vip", "analyst", "owner") and role not in ("owner", "admin"):
        result = result[:FREE_PICKS_LIMIT]

    return result


@app.get("/api/daily")
@limiter.limit("30/minute")
def daily_picks(
    request: Request,
    background_tasks: BackgroundTasks,
    date: Optional[str] = None,
    min_confidence: float = Query(0.50, ge=0.0, le=1.0),
    user: Optional[dict] = Depends(get_current_user),
):
    """
    Returneaza predictiile zilei, sortate descrescator dupa confidence.
    - date: YYYY-MM-DD (default: azi)
    - min_confidence: prag minim 0.0-1.0 (default: 0.50)

    Confidence levels:
    - >= 0.65  →  HIGH    (acuratete reala ~75%)
    - >= 0.55  →  MEDIUM  (acuratete reala ~65%)
    - < 0.55   →  LOW     (acuratete reala ~57%)
    """
    target    = date or datetime.date.today().isoformat()
    today_str = datetime.date.today().isoformat()

    cache_key = f"{target}:{min_confidence}"

    # 1. Redis cache (cel mai rapid) — stale-while-revalidate
    cached = redis_cache.get("daily", cache_key)
    if cached and cached.get("total_picks", 0) > 0:
        remaining_ttl = redis_cache.ttl("daily", cache_key)
        if 0 < remaining_ttl < 300 and target >= today_str:
            # Cache aproape expirat — refresh in background, servim stale acum
            background_tasks.add_task(compute_and_store_picks, target)
            logger.info("[daily] stale-while-revalidate pentru %s (ttl=%ds)", target, remaining_ttl)
        return {**cached, "picks": _mask_vip_picks(cached["picks"], user)}

    # 2. Supabase daily_picks — look-ahead pana la 4 zile cand nu e data explicita
    search_dates = [target]
    if not date:
        for i in range(1, 5):
            search_dates.append(
                (datetime.date.today() + datetime.timedelta(days=i)).isoformat()
            )

    for search_date in search_dates:
        db_data = load_picks_from_db(search_date)
        if not db_data or db_data.get("total_picks", 0) == 0:
            continue
        all_picks = db_data["picks"]
        filtered  = [p for p in all_picks if p["confidence"] >= min_confidence * 100]
        if not filtered and search_date != target:
            continue
        db_data["picks"]       = filtered
        db_data["total_picks"] = len(filtered)
        db_data["high_conf"]   = len([p for p in filtered if p["confidence"] >= 65])
        db_data["med_conf"]    = len([p for p in filtered if 55 <= p["confidence"] < 65])
        db_data["low_conf"]    = len([p for p in filtered if p["confidence"] < 55])
        redis_cache.set("daily", cache_key, db_data, ttl=CACHE_TTL_DAILY)
        return {**db_data, "picks": _mask_vip_picks(db_data["picks"], user)}

    # 3. Calcul live cu coalescing — un singur thread calculeaza, restul asteapta
    if target >= today_str:
        live_data = _coalesced_compute(target)
        if live_data and live_data.get("total_picks", 0) > 0:
            all_picks = live_data.get("picks", [])
            filtered  = [p for p in all_picks if p.get("confidence", 0) >= min_confidence * 100]
            live_data["picks"]       = filtered
            live_data["total_picks"] = len(filtered)
            live_data["high_conf"]   = len([p for p in filtered if p.get("confidence", 0) >= 65])
            live_data["med_conf"]    = len([p for p in filtered if 55 <= p.get("confidence", 0) < 65])
            redis_cache.set("daily", cache_key, live_data, ttl=CACHE_TTL_DAILY)
            return {**live_data, "picks": _mask_vip_picks(filtered, user)}

    # 4. Nu exista date — picks in curs de calcul (scheduler 07:00/13:00)
    return {
        "date":           target,
        "requested_date": target,
        "total_fixtures": 0,
        "total_picks":    0,
        "high_conf":      0,
        "med_conf":       0,
        "low_conf":       0,
        "picks":          [],
        "errors":         [],
        "cached":         False,
        "source":         "pending",
    }


LEGACY_MAP = {
    "39": "PL", "78": "BL1", "135": "SA", "140": "PD", "61": "FL1",
    "88": "DED", "94": "PPL", "2": "CL", "3": "EL",
    "40": "ELC", "79": "BL2", "136": "SB", "62": "FL2", "141": "SD",
}


# ─────────────────────────────────────────────
# FIXTURES pentru o liga
# ─────────────────────────────────────────────
@app.get("/api/fixtures/{competition_code}")
@limiter.limit("20/minute")
def get_fixtures(request: Request, competition_code: str, date: Optional[str] = None):
    code  = LEGACY_MAP.get(str(competition_code), competition_code.upper())
    base  = datetime.date.fromisoformat(date) if date else datetime.date.today()
    cache_key = f"{code}:{base.isoformat()}"

    cached = redis_cache.get("fixtures", cache_key)
    if cached:
        return cached

    known   = get_known_teams()
    date_to = (base + datetime.timedelta(days=9)).isoformat()   # max 10 zile

    api_debug: dict = {}
    filtered = fetch_competition_fixtures(code, base.isoformat(), date_to, known, _debug=api_debug)

    result = {
        "fixtures": [
            {
                "id":      idx,
                "home":    f["home"],
                "away":    f["away"],
                "home_id": 0,
                "away_id": 0,
                "date":    f.get("date", base.isoformat()),
                "time":    f.get("time", ""),
            }
            for idx, f in enumerate(filtered)
        ],
        "debug": {
            "code_requested": code,
            "date_from": base.isoformat(),
            "date_to": date_to,
            "http_status": api_debug.get("http_status"),
            "error": api_debug.get("error"),
            "raw_match_count": api_debug.get("raw_match_count", 0),
            "filtered_count": len(filtered),
        }
    }

    redis_cache.set("fixtures", cache_key, result, ttl=CACHE_TTL_FIXTURES)
    return result


# ─────────────────────────────────────────────
# PREDICȚIE MECI (POST — cu cote optionale)
# ─────────────────────────────────────────────
class MatchRequest(BaseModel):
    home_team: str
    away_team: str
    odds_b365h: Optional[float] = None
    odds_b365d: Optional[float] = None
    odds_b365a: Optional[float] = None
    odds_psh:   Optional[float] = None
    odds_psd:   Optional[float] = None
    odds_psa:   Optional[float] = None
    odds_avgh:  Optional[float] = None
    odds_avgd:  Optional[float] = None
    odds_avga:  Optional[float] = None
    odds_maxh:  Optional[float] = None
    odds_maxd:  Optional[float] = None
    odds_maxa:  Optional[float] = None
    league_id:  int = 0
    month:      Optional[int] = None
    neutral:    bool = False
    tournament: str = "Friendly"


@app.post("/predict")
@app.post("/api/predict")
@limiter.limit("20/minute")
def predict(req: MatchRequest, request: Request):
    try:
        odds = None
        if req.odds_b365h and req.odds_b365d and req.odds_b365a:
            odds = {
                "B365H": req.odds_b365h, "B365D": req.odds_b365d, "B365A": req.odds_b365a,
                "PSH":  req.odds_psh  or req.odds_b365h,
                "PSD":  req.odds_psd  or req.odds_b365d,
                "PSA":  req.odds_psa  or req.odds_b365a,
                "AvgH": req.odds_avgh or req.odds_b365h,
                "AvgD": req.odds_avgd or req.odds_b365d,
                "AvgA": req.odds_avga or req.odds_b365a,
                "MaxH": req.odds_maxh or req.odds_b365h,
                "MaxD": req.odds_maxd or req.odds_b365d,
                "MaxA": req.odds_maxa or req.odds_b365a,
            }
        result = predict_match(
            home_team=req.home_team,
            away_team=req.away_team,
            odds=odds,
            league_id=req.league_id,
            month=req.month,
        )
        return result
    except Exception as e:
        logger.warning("[predict] %s", e)
        raise HTTPException(status_code=500, detail="Eroare interna")


@app.get("/predict/{home_team}/{away_team}")
@app.get("/api/predict/{home_team}/{away_team}")
def predict_simple(home_team: str, away_team: str):
    try:
        return predict_match(home_team=home_team, away_team=away_team)
    except Exception as e:
        logger.warning("[predict_simple] %s", e)
        raise HTTPException(status_code=500, detail="Eroare interna")


@app.get("/api/predict")
def predict_get(
    home_team: str,
    away_team: str,
    league_id: int = 0,
    home_team_id: Optional[int] = None,
    away_team_id: Optional[int] = None,
):
    """GET variant for frontend — returns nested format expected by page.tsx"""
    try:
        result = predict_match(home_team=home_team, away_team=away_team, league_id=league_id)
    except Exception as e:
        logger.warning("[predict_get] %s", e)
        raise HTTPException(status_code=500, detail="Eroare interna")

    hw = round(result["home_win"] * 100, 1)
    dr = round(result["draw"] * 100, 1)
    aw = round(result["away_win"] * 100, 1)

    xg_home = round(result.get("home_goals_avg", max(0.3, 1.0 + (result["home_win"] - 0.333) * 2.5)), 2)
    xg_away = round(result.get("away_goals_avg", max(0.3, 0.9 + (result["away_win"] - 0.333) * 2.5)), 2)

    home_elo = result.get("home_elo", 1500)
    away_elo = result.get("away_elo", 1500)
    home_form_pct = result.get("home_form", 0.4)
    away_form_pct = result.get("away_form", 0.4)

    # ── Elo model (formula clasica Bradley-Terry) ──────────────
    elo_diff = home_elo - away_elo
    elo_hw   = round(1 / (1 + 10 ** (-elo_diff / 400)) * 100, 1)
    elo_aw   = round(1 / (1 + 10 ** (elo_diff / 400)) * 100, 1)
    elo_dr   = round(max(0, 100 - elo_hw - elo_aw), 1)
    # Redistribuim draw mai realist (15-25% din spatiu)
    draw_share = min(28, max(15, 22 - abs(elo_diff) * 0.02))
    elo_hw2 = round((elo_hw / (elo_hw + elo_aw)) * (100 - draw_share), 1)
    elo_aw2 = round((elo_aw / (elo_hw + elo_aw)) * (100 - draw_share), 1)
    elo_dr2 = round(100 - elo_hw2 - elo_aw2, 1)

    # ── Poisson model (Dixon-Coles simplificat) ────────────────
    def poisson_pmf(lam: float, k: int) -> float:
        return (lam ** k) * math.exp(-lam) / math.factorial(k)

    p_home, p_draw, p_away = 0.0, 0.0, 0.0
    for i in range(8):
        for j in range(8):
            p = poisson_pmf(xg_home, i) * poisson_pmf(xg_away, j)
            if i > j:   p_home += p
            elif i == j: p_draw += p
            else:        p_away += p
    poi_hw = round(p_home * 100, 1)
    poi_dr = round(p_draw * 100, 1)
    poi_aw = round(p_away * 100, 1)

    def form_str(form_val: float) -> list:
        wins   = round(form_val * 5)
        draws  = 1 if wins < 5 else 0
        losses = max(0, 5 - wins - draws)
        return (['W'] * wins + ['D'] * draws + ['L'] * losses)[:5]

    return {
        "home_team": home_team,
        "away_team": away_team,
        "prediction": {
            "home_win": hw,
            "draw":     dr,
            "away_win": aw,
            "method":   "XGBoost + Elo + Poisson",
        },
        "top_scores": [
            {"score": "1-0", "probability": round(hw * 0.28)},
            {"score": "2-1", "probability": round(hw * 0.20)},
            {"score": "1-1", "probability": round(dr * 0.45)},
            {"score": "0-0", "probability": round(dr * 0.30)},
            {"score": "0-1", "probability": round(aw * 0.28)},
            {"score": "0-2", "probability": round(aw * 0.20)},
        ],
        "expected_goals": {
            "home": xg_home,
            "away": xg_away,
        },
        "home_stats": {
            "form":        form_str(home_form_pct),
            "elo_rating":  home_elo,
            "goals_avg":   xg_home,
            "xg_for":      xg_home,
            "xg_against":  xg_away * 0.8,
        },
        "away_stats": {
            "form":        form_str(away_form_pct),
            "elo_rating":  away_elo,
            "goals_avg":   xg_away,
            "xg_for":      xg_away,
            "xg_against":  xg_home * 0.8,
        },
        "confidence":       round(result["confidence"] * 100, 1),
        "confidence_level": result.get("confidence_level", "LOW"),
        "model_breakdown": {
            "xgboost": {"home_win": hw,      "draw": dr,      "away_win": aw},
            "elo":     {"home_win": elo_hw2, "draw": elo_dr2, "away_win": elo_aw2},
            "poisson": {"home_win": poi_hw,  "draw": poi_dr,  "away_win": poi_aw},
        },
    }


# ─────────────────────────────────────────────
# STANDINGS — football-data.org v4
# ─────────────────────────────────────────────
@app.get("/api/standings/{league}")
def api_standings(league: str):
    """Returneaza clasamentul curent pentru o liga (football-data.org)."""
    from fixtures import API_KEY, BASE_URL
    code = LEGACY_MAP.get(str(league), league.upper())
    if not API_KEY:
        return {"standings": [], "league": code}
    try:
        r = requests.get(
            f"{BASE_URL}/competitions/{code}/standings",
            headers={"X-Auth-Token": API_KEY},
            timeout=10,
        )
        if r.status_code != 200:
            logger.warning("[standings] %s HTTP %s", code, r.status_code)
            return {"standings": [], "league": code}
        data = r.json()
        table = data.get("standings", [{}])[0].get("table", [])
        standings = []
        for row in table:
            team = row.get("team", {})
            standings.append({
                "position":      row.get("position", 0),
                "team":          team.get("shortName") or team.get("name", ""),
                "team_full":     team.get("name", ""),
                "team_tla":      team.get("tla", ""),
                "team_id":       team.get("id", 0),
                "played":        row.get("playedGames", 0),
                "won":           row.get("won", 0),
                "draw":          row.get("draw", 0),
                "lost":          row.get("lost", 0),
                "goals_for":     row.get("goalsFor", 0),
                "goals_against": row.get("goalsAgainst", 0),
                "goal_diff":     row.get("goalDifference", 0),
                "points":        row.get("points", 0),
                "form":          row.get("form") or "",
            })
        return {"standings": standings, "league": code}
    except Exception as e:
        logger.warning("[standings] %s: %s", code, e)
        return {"standings": [], "league": code}


# ─────────────────────────────────────────────
# PREDICȚII BATCH cu filtrare confidence
# ─────────────────────────────────────────────
class BatchRequest(BaseModel):
    matches: list[dict]
    min_confidence: float = 0.0


@app.post("/api/predict/batch")
def predict_batch(req: BatchRequest):
    results = []
    for m in req.matches:
        try:
            odds = None
            if m.get("odds_b365h") and m.get("odds_b365d") and m.get("odds_b365a"):
                odds = {
                    "B365H": m["odds_b365h"], "B365D": m["odds_b365d"], "B365A": m["odds_b365a"],
                    "PSH": m.get("odds_psh", m["odds_b365h"]),
                    "PSD": m.get("odds_psd", m["odds_b365d"]),
                    "PSA": m.get("odds_psa", m["odds_b365a"]),
                    "AvgH": m.get("odds_avgh", m["odds_b365h"]),
                    "AvgD": m.get("odds_avgd", m["odds_b365d"]),
                    "AvgA": m.get("odds_avga", m["odds_b365a"]),
                    "MaxH": m.get("odds_maxh", m["odds_b365h"]),
                    "MaxD": m.get("odds_maxd", m["odds_b365d"]),
                    "MaxA": m.get("odds_maxa", m["odds_b365a"]),
                }
            result = predict_match(
                home_team=m["home_team"],
                away_team=m["away_team"],
                odds=odds,
                league_id=m.get("league_id", 0),
                month=m.get("month"),
            )
            if result["confidence"] >= req.min_confidence:
                results.append(result)
        except Exception:
            continue
    results.sort(key=lambda x: x["confidence"], reverse=True)
    return {"count": len(results), "min_confidence": req.min_confidence, "predictions": results}


# ─────────────────────────────────────────────
# DEBUG — starea API-urilor externe
# ─────────────────────────────────────────────
@app.get("/api/debug")
def debug_status():
    import os, requests as req
    fd_key   = os.getenv("FOOTBALL_DATA_KEY", "")
    odds_key = os.getenv("ODDS_API_KEY", "")

    result = {
        "football_data_key_set": bool(fd_key),
        "odds_api_key_set":      bool(odds_key),
        "football_data_status":  None,
        "football_data_matches": None,
    }

    if fd_key:
        try:
            import datetime
            today = datetime.date.today().isoformat()
            r = req.get(
                "https://api.football-data.org/v4/matches",
                headers={"X-Auth-Token": fd_key},
                params={"dateFrom": today, "dateTo": today},
                timeout=10,
            )
            result["football_data_status"] = r.status_code
            if r.status_code == 200:
                data = r.json()
                result["football_data_matches"] = len(data.get("matches", []))
                result["competitions_today"] = list({
                    m.get("competition", {}).get("code", "?")
                    for m in data.get("matches", [])
                })
        except Exception as e:
            result["football_data_error"] = str(e)

    # Status Club-elo — test fetch live
    try:
        import predictor as _pred
        result["clubelo_loaded"] = len(_pred._clubelo_ratings)
        if not _pred._clubelo_ratings:
            # Incearca fetch live pt diagnostic
            try:
                import requests as _r
                resp = _r.get("http://api.clubelo.com/2026-04-16", timeout=8)
                result["clubelo_http_status"] = resp.status_code
                result["clubelo_http_bytes"] = len(resp.content)
            except Exception as _fe:
                result["clubelo_fetch_error"] = str(_fe)
        else:
            result["clubelo_sample"] = {
                k: round(v) for k, v in list(_pred._clubelo_ratings.items())[:5]
            }
    except Exception as _ce:
        result["clubelo_loaded"] = 0
        result["clubelo_error"] = str(_ce)

    return result


@app.get("/api/debug/odds")
@limiter.limit("5/minute")
def debug_odds(request: Request, admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret")):
    """Test direct Odds API — arata ce cote returneaza pentru La Liga azi."""
    if not (admin_secret and ADMIN_SECRET and admin_secret == ADMIN_SECRET):
        raise HTTPException(403, "Unauthorized")
    import requests as req
    odds_key = os.getenv("ODDS_API_KEY", "")
    if not odds_key:
        return {"error": "ODDS_API_KEY not set"}
    try:
        r = req.get(
            "https://api.the-odds-api.com/v4/sports/soccer_spain_la_liga/odds/",
            params={"apiKey": odds_key, "regions": "eu", "markets": "h2h", "oddsFormat": "decimal"},
            timeout=10,
        )
        return {
            "status_code": r.status_code,
            "requests_remaining": r.headers.get("x-requests-remaining"),
            "requests_used": r.headers.get("x-requests-used"),
            "events_count": len(r.json()) if r.status_code == 200 else 0,
            "events": r.json() if r.status_code == 200 else r.text[:500],
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────────
# BET SIGNALS — admin endpoints
# ─────────────────────────────────────────────

@app.post("/api/admin/bet-signals/run")
@limiter.limit("5/minute")
def admin_bet_signals_run(request: Request, admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret")):
    """Triggereaza manual pipeline-ul de semnale BET (fetch + analiza + insert Supabase)."""
    if not (admin_secret and ADMIN_SECRET and admin_secret == ADMIN_SECRET):
        raise HTTPException(403, "Unauthorized")
    try:
        from bet_signal import run_pipeline
        import threading
        threading.Thread(target=run_pipeline, daemon=True).start()
        return {"status": "started", "message": "Pipeline bet_signal pornit in background"}
    except RuntimeError as e:
        logger.warning("[bet-signals/run] %s", e)
        raise HTTPException(503, "Serviciu temporar indisponibil")
    except Exception as e:
        logger.error("[bet-signals/run] %s", e)
        raise HTTPException(500, "Eroare interna")


@app.post("/api/admin/bet-signals/update-results")
@limiter.limit("5/minute")
def admin_bet_signals_results(request: Request, admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret")):
    """Triggereaza manual update-ul rezultatelor pendente (W/L/P)."""
    if not (admin_secret and ADMIN_SECRET and admin_secret == ADMIN_SECRET):
        raise HTTPException(403, "Unauthorized")
    try:
        from bet_signal import update_results
        import threading
        threading.Thread(target=update_results, daemon=True).start()
        return {"status": "started", "message": "Update rezultate pornit in background"}
    except RuntimeError as e:
        logger.warning("[bet-signals/results] %s", e)
        raise HTTPException(503, "Serviciu temporar indisponibil")
    except Exception as e:
        logger.error("[bet-signals/results] %s", e)
        raise HTTPException(500, "Eroare interna")


@app.get("/api/admin/bet-signals")
@limiter.limit("10/minute")
def admin_bet_signals_list(request: Request, limit: int = 50, admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret")):
    """Returneaza ultimele semnale BET din Supabase."""
    if not (admin_secret and ADMIN_SECRET and admin_secret == ADMIN_SECRET):
        raise HTTPException(403, "Unauthorized")
    client = get_client()
    if not client:
        raise HTTPException(503, "Supabase indisponibil")
    try:
        resp = (
            client.table("bet_signals")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = resp.data or []
        total_w = sum(1 for r in rows if r.get("result") == "W")
        total_l = sum(1 for r in rows if r.get("result") == "L")
        total_p = sum(1 for r in rows if r.get("result") == "P" or r.get("result") is None)
        profit  = sum(r.get("profit_loss") or 0 for r in rows)
        return {
            "count": len(rows),
            "summary": {"W": total_w, "L": total_l, "P": total_p, "profit_loss": round(profit, 4)},
            "signals": rows,
        }
    except Exception as e:
        logger.error("[bet-signals] %s", e)
        raise HTTPException(500, "Eroare interna")


@app.get("/api/bet-signals/stats")
def bet_signals_stats():
    """Statistici publice bet_signals: win rate, ROI, ultimele 10 semnale finalizate."""
    client = get_client()
    if not client:
        return {"total": 0, "wins": 0, "losses": 0, "win_rate": 0, "roi_total": 0, "avg_odds": 0, "recent": []}
    try:
        resp = client.table("bet_signals").select("*").order("match_date", desc=True).execute()
        rows = resp.data or []
        completed = [r for r in rows if r.get("result") in ("W", "L")]
        wins = sum(1 for r in completed if r.get("result") == "W")
        losses = len(completed) - wins
        roi = round(sum(r.get("profit_loss") or 0 for r in completed), 2)
        odds_vals = [r["odds_at_signal"] for r in completed if r.get("odds_at_signal")]
        avg_odds = round(sum(odds_vals) / len(odds_vals), 2) if odds_vals else 0
        win_rate = round(wins / len(completed) * 100, 1) if completed else 0
        recent = completed[:10]
        return {
            "total": len(completed),
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "roi_total": roi,
            "avg_odds": avg_odds,
            "recent": recent,
        }
    except Exception as e:
        logger.error("[bet-signals/stats] %s", e)
        raise HTTPException(500, "Eroare interna")


# ─────────────────────────────────────────────
# TRACK RECORD
# ─────────────────────────────────────────────
@app.get("/api/track-record")
def track_record():
    """Statistici acuratete live din pick_results (auto-marcate zilnic la 23:30)."""
    client = get_client()
    if client is None:
        return {"total": 0, "tracking_since": "Aprilie 2026"}
    try:
        # Citeste toate pick_results marcate WIN/LOSS
        pr_rows = client.table("pick_results").select("*").execute()
        pr_data = pr_rows.data or []
        resolved = [r for r in pr_data if r.get("result") in ("win", "loss")]

        def acc(lst):
            wins = sum(1 for r in lst if r["result"] == "win")
            return round(wins / len(lst) * 100, 1) if lst else 0

        def group(lst, min_c, max_c=None):
            if max_c is None:
                return [r for r in lst if (r.get("confidence") or 0) >= min_c]
            return [r for r in lst if min_c <= (r.get("confidence") or 0) < max_c]

        # Confidence breakdown (confidence stocat ca fractie 0-1 in DB)
        above_70  = group(resolved, 0.70)
        above_65  = group(resolved, 0.65)
        above_60  = group(resolved, 0.60)
        med_band  = group(resolved, 0.55, 0.65)

        # Tracking since = primul pick_date din pick_results
        since = "Aprilie 2026"
        days  = 0
        if resolved:
            dates = [r["pick_date"] for r in resolved if r.get("pick_date")]
            if dates:
                since = min(dates)
                try:
                    days = (datetime.date.today() - datetime.date.fromisoformat(since)).days
                except Exception:
                    pass

        # Per-liga breakdown din pick_results (home/away → liga nu e stocata direct,
        # dar o putem aproxima din daily_picks JSONB)
        league_stats = _compute_league_stats(client, resolved)

        wins_total = sum(1 for r in resolved if r["result"] == "win")
        final_equity = round(wins_total - (len(resolved) - wins_total), 2)

        return {
            "total":               len(resolved),
            "high_conf_total":     len(above_65),
            "high_conf_wins":      sum(1 for r in above_65 if r["result"] == "win"),
            "high_conf_accuracy":  acc(above_65),
            "med_conf_total":      len(med_band),
            "med_conf_wins":       sum(1 for r in med_band if r["result"] == "win"),
            "med_conf_accuracy":   acc(med_band),
            "tracking_since":      since,
            "days_tracked":        days,
            "final_equity":        final_equity,
            # Breakdown detaliat pe praguri — înlocuiește valorile hardcodate din frontend
            "confidence_breakdown": [
                {
                    "label":    "Confidence >70%",
                    "total":    len(above_70),
                    "wins":     sum(1 for r in above_70 if r["result"] == "win"),
                    "accuracy": acc(above_70),
                },
                {
                    "label":    "Confidence ≥65%",
                    "total":    len(above_65),
                    "wins":     sum(1 for r in above_65 if r["result"] == "win"),
                    "accuracy": acc(above_65),
                },
                {
                    "label":    "Confidence ≥60%",
                    "total":    len(above_60),
                    "wins":     sum(1 for r in above_60 if r["result"] == "win"),
                    "accuracy": acc(above_60),
                },
                {
                    "label":    "Toate predicțiile",
                    "label_en": "All predictions",
                    "total":    len(resolved),
                    "wins":     sum(1 for r in resolved if r["result"] == "win"),
                    "accuracy": acc(resolved),
                },
            ],
            "league_stats": league_stats,
        }
    except Exception as e:
        logger.error("[track-record] %s", e)
        return {"total": 0, "tracking_since": "Aprilie 2026", "error": str(e)}


def _compute_league_stats(client, resolved: list) -> list:
    """
    Calculeaza acuratete per liga din daily_picks JSONB.
    Incruciseaza pick_results cu informatia de liga din daily_picks.
    """
    try:
        # Incarca daily_picks pentru datele din pick_results
        dates = list({r["pick_date"] for r in resolved if r.get("pick_date")})
        if not dates:
            return []

        # Build index: (date, home_lower, away_lower) -> result
        result_index = {
            (r["pick_date"], r["home"].lower(), r["away"].lower()): r["result"]
            for r in resolved
        }
        conf_index = {
            (r["pick_date"], r["home"].lower(), r["away"].lower()): r.get("confidence", 0.6)
            for r in resolved
        }

        league_map: dict = {}  # league_name -> {total, wins, total65, wins65}

        for date in dates:
            rows = client.table("daily_picks").select("picks").eq("pick_date", date).execute()
            if not rows.data:
                continue
            import json as _json
            picks_raw = rows.data[0].get("picks", "[]")
            picks = _json.loads(picks_raw) if isinstance(picks_raw, str) else picks_raw
            for p in picks:
                key = (date, p["home"].lower(), p["away"].lower())
                if key not in result_index:
                    continue
                league = p.get("league", "Unknown")
                conf   = conf_index.get(key, 0.6)
                res    = result_index[key]
                if league not in league_map:
                    league_map[league] = {"total": 0, "wins": 0, "total65": 0, "wins65": 0}
                league_map[league]["total"] += 1
                if res == "win":
                    league_map[league]["wins"] += 1
                if conf >= 0.65:
                    league_map[league]["total65"] += 1
                    if res == "win":
                        league_map[league]["wins65"] += 1

        result = []
        for league, s in league_map.items():
            if s["total"] < 3:  # ignora ligile cu prea putine date
                continue
            acc_all = round(s["wins"] / s["total"] * 100, 1) if s["total"] else 0
            acc65   = round(s["wins65"] / s["total65"] * 100, 1) if s["total65"] else 0
            result.append({
                "league":   league,
                "total":    s["total"],
                "total65":  s["total65"],
                "accuracy": acc_all,
                "acc65":    acc65,
            })
        result.sort(key=lambda x: x["acc65"], reverse=True)
        return result
    except Exception as e:
        logger.warning("[track-record] league_stats failed: %s", e)
        return []


@app.get("/api/track-record/history")
def track_record_history(limit: int = Query(100, le=500)):
    """Returneaza istoricul individual al pick-urilor marcate WIN/LOSS/VOID."""
    client = get_client()
    if client is None:
        return {"results": []}
    try:
        rows = client.table("pick_results").select("*").order("pick_date", desc=True).limit(limit).execute()
        data = rows.data or []

        # Calculeaza equity curve (stake fix 1 unitate, odds medii 2.0)
        results = []
        running_units = 0.0
        for r in reversed(data):  # cronologic pentru equity
            if r["result"] == "win":
                running_units += 1.0
            elif r["result"] == "loss":
                running_units -= 1.0
            results.append({
                "date":         r["pick_date"],
                "home":         r["home"],
                "away":         r["away"],
                "result":       r["result"],
                "prediction":   r.get("prediction", ""),
                "confidence":   round(r.get("confidence", 0.6) * 100, 1),
                "actual_score": r.get("actual_score", ""),
                "equity":       round(running_units, 2),
                "created_at":   r.get("created_at", ""),
            })

        results.reverse()  # cel mai recent primul

        resolved = [r for r in data if r["result"] in ("win", "loss")]
        wins = sum(1 for r in resolved if r["result"] == "win")
        high = [r for r in resolved if r.get("confidence", 0) >= 0.65]
        high_wins = sum(1 for r in high if r["result"] == "win")

        return {
            "results": results,
            "summary": {
                "total":         len(resolved),
                "wins":          wins,
                "losses":        len(resolved) - wins,
                "accuracy":      round(wins / len(resolved) * 100, 1) if resolved else 0,
                "high_conf_accuracy": round(high_wins / len(high) * 100, 1) if high else 0,
                "final_equity":  round(running_units, 2),
            }
        }
    except Exception as e:
        return {"results": [], "error": str(e)}


@app.get("/api/track-record/vip")
def track_record_vip():
    """Stats VIP picks (confidence >= 75%) — afisate pe pagina Pro."""
    import datetime as _dt
    client = get_client()
    if client is None:
        return {"total": 0, "wins": 0, "accuracy": 0, "this_month_total": 0, "this_month_wins": 0, "this_month_accuracy": 0}
    try:
        now = _dt.date.today()
        month_start = now.replace(day=1).isoformat()

        rows = client.table("pick_results").select("confidence, result, pick_date").execute()
        data = rows.data or []

        vip_all = [r for r in data if r.get("result") in ("win", "loss") and (r.get("confidence") or 0) >= 0.75]
        this_month = [r for r in vip_all if (r.get("pick_date") or "") >= month_start]

        wins_all = sum(1 for r in vip_all if r["result"] == "win")
        wins_month = sum(1 for r in this_month if r["result"] == "win")

        return {
            "total":                len(vip_all),
            "wins":                 wins_all,
            "accuracy":             round(wins_all / len(vip_all) * 100, 1) if vip_all else 0,
            "this_month_total":     len(this_month),
            "this_month_wins":      wins_month,
            "this_month_accuracy":  round(wins_month / len(this_month) * 100, 1) if this_month else 0,
        }
    except Exception as e:
        return {"total": 0, "wins": 0, "accuracy": 0, "this_month_total": 0, "this_month_wins": 0, "this_month_accuracy": 0, "error": str(e)}


# ─────────────────────────────────────────────
# ADMIN — gestionare useri
# ─────────────────────────────────────────────
class SetTierRequest(BaseModel):
    email: str
    tier: str          # 'free' | 'analyst' | 'pro' | 'vip'
    days: Optional[int] = None  # None = nelimitat

@app.post("/api/admin/set-tier")
def admin_set_tier(
    req: SetTierRequest,
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    current_user: Optional[dict] = Depends(get_current_user),
):
    is_jwt_admin = current_user and current_user.get("role") in ("owner", "admin")
    if not is_jwt_admin and (not ADMIN_SECRET or x_admin_key != ADMIN_SECRET):
        raise HTTPException(403, "Acces interzis")
    if req.tier not in ("free", "analyst", "pro", "vip"):
        raise HTTPException(400, "Tier invalid")
    client = get_client()
    if not client:
        raise HTTPException(503, "DB indisponibil")
    rows = client.table("users").select("id,email,tier").eq("email", req.email).execute()
    if not rows.data:
        raise HTTPException(404, f"User negasit: {req.email}")
    user = rows.data[0]
    expires = None
    if req.days and req.tier != "free":
        from datetime import datetime, timezone, timedelta
        expires = (datetime.now(timezone.utc) + timedelta(days=req.days)).isoformat()
    client.table("users").update({"tier": req.tier, "tier_expires": expires}).eq("id", user["id"]).execute()
    return {"ok": True, "email": req.email, "tier": req.tier, "tier_expires": expires}

@app.get("/api/admin/users")
def admin_list_users(
    search: Optional[str] = Query(None),
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    current_user: Optional[dict] = Depends(get_current_user),
):
    is_jwt_admin = current_user and current_user.get("role") in ("owner", "admin")
    if not is_jwt_admin and (not ADMIN_SECRET or x_admin_key != ADMIN_SECRET):
        raise HTTPException(403, "Acces interzis")
    client = get_client()
    if not client:
        raise HTTPException(503, "DB indisponibil")
    q = client.table("users").select("id,email,tier,tier_expires,created_at")
    if search:
        q = q.ilike("email", f"%{search}%")
    rows = q.order("created_at", desc=True).limit(50).execute()
    return rows.data


# ADMIN — marcare rezultate WIN/LOSS
# ─────────────────────────────────────────────
class PickResultRequest(BaseModel):
    pick_date: str           # YYYY-MM-DD
    home: str
    away: str
    result: str              # 'win' | 'loss' | 'void'
    confidence: float = 0.6  # 0.0-1.0
    actual_score: Optional[str] = None


@app.post("/api/admin/picks/result")
def admin_set_pick_result(
    req: PickResultRequest,
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    """Marcheaza rezultatul unui pick (WIN/LOSS). Necesita X-Admin-Key header."""
    if not ADMIN_SECRET or x_admin_key != ADMIN_SECRET:
        raise HTTPException(403, "Unauthorized")
    if req.result not in ("win", "loss", "void"):
        raise HTTPException(400, "result must be win, loss, or void")
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    try:
        client.table("pick_results").upsert({
            "pick_date":    req.pick_date,
            "home":         req.home,
            "away":         req.away,
            "result":       req.result,
            "confidence":   req.confidence,
            "actual_score": req.actual_score,
        }, on_conflict="pick_date,home,away").execute()
        return {"ok": True, "saved": f"{req.home} vs {req.away} ({req.pick_date}) = {req.result}"}
    except Exception as e:
        logger.error("[admin/picks/result] %s", e)
        raise HTTPException(500, "Eroare interna")


@app.post("/api/admin/picks/auto-results")
def admin_auto_results(
    background_tasks: BackgroundTasks,
    date: Optional[str] = Query(None),
    user: dict = Depends(require_admin),
):
    """Trigger manual auto-marcare WIN/LOSS pentru o data. Ruleaza in background."""
    background_tasks.add_task(auto_mark_results, date)
    return {"started": True, "date": date or "today"}


@app.post("/api/admin/rerun-picks")
def admin_rerun_picks(
    date: Optional[str] = Query(None),
    user: dict = Depends(require_admin),
):
    """Trigger manual compute_and_store_picks via JWT admin. Folosit din admin panel."""
    try:
        result = compute_and_store_picks(date)
        return {"ok": True, "picks": result.get("total_picks", 0), "date": result.get("date")}
    except Exception as e:
        logger.error("[admin/rerun-picks] %s", e)
        raise HTTPException(status_code=500, detail="Eroare interna")


@app.api_route("/api/admin/cache/clear-odds", methods=["GET", "POST"])
def admin_clear_odds_cache(x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"), user: dict = Depends(get_current_user)):
    """Sterge cache-ul de odds si picks, recompute picks de azi cu cotele noi."""
    is_admin_key = x_admin_secret and ADMIN_SECRET and x_admin_secret == ADMIN_SECRET
    is_jwt_admin = user and user.get("role") in ("owner", "admin")
    if not is_admin_key and not is_jwt_admin:
        raise HTTPException(403, "Unauthorized")
    import datetime as _dt
    today = _dt.date.today().isoformat()
    import cache as redis_cache
    redis_cache.delete("odds_daily", today)
    redis_cache.delete("daily", f"{today}:0.5")
    redis_cache.delete("daily", f"{today}:0.45")
    redis_cache.delete("odds_quota_exhausted", today)
    # Sterge si din Supabase ca sa forteze recompute
    client = get_client()
    if client:
        client.table("daily_picks").delete().eq("pick_date", today).execute()
    # Recompute sincron
    from ingestion import compute_and_store_picks
    result = compute_and_store_picks(today)
    return {"cleared": True, "date": today, "picks_recomputed": result.get("total_picks", 0)}


@app.get("/api/admin/send-telegram")
@limiter.limit("5/minute")
def admin_send_telegram(request: Request, x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"), user: dict = Depends(get_current_user)):
    """Trimite manual combo Telegram pentru picks de azi. Protejat cu ADMIN_SECRET sau owner."""
    is_authorized = (x_admin_secret and ADMIN_SECRET and x_admin_secret == ADMIN_SECRET) or \
                    (user and user.get("role") in ("owner", "admin"))
    if not is_authorized:
        raise HTTPException(403, "Unauthorized")

    import datetime as _dt
    from ingestion import load_picks_from_db
    from notifications import send_combo_telegram

    today = _dt.date.today().isoformat()
    db_data = load_picks_from_db(today)
    if not db_data or not db_data.get("picks"):
        return {"sent": False, "reason": "no picks for today"}

    picks = db_data["picks"]
    date_fmt = _dt.datetime.strptime(today, "%Y-%m-%d").strftime("%d.%m.%Y")
    sent = send_combo_telegram(picks, date_fmt)
    return {"sent": sent, "date": today, "picks_count": len(picks)}


@app.post("/api/admin/picks/backfill")
def admin_backfill_results(
    background_tasks: BackgroundTasks,
    date_from: str = Query(...),
    date_to: Optional[str] = Query(None),
    user: dict = Depends(require_admin),
):
    """Backfill WIN/LOSS pentru un interval de date. Ruleaza in background."""
    import datetime as _dt, time as _time

    def _run():
        end = date_to or date_from
        current = _dt.date.fromisoformat(date_from)
        stop    = _dt.date.fromisoformat(end)
        while current <= stop:
            try:
                auto_mark_results(current.isoformat())
            except Exception as e:
                logger.warning("[backfill] Eroare la %s: %s", current, e)
            current += _dt.timedelta(days=1)
            _time.sleep(2)

    background_tasks.add_task(_run)
    import datetime as _dt2
    days = (_dt2.date.fromisoformat(date_to or date_from) - _dt2.date.fromisoformat(date_from)).days + 1
    return {"started": True, "date_from": date_from, "date_to": date_to or date_from, "days": days}


@app.get("/api/admin/picks/results")
@limiter.limit("10/minute")
def admin_get_pick_results(
    request: Request,
    date: Optional[str] = None,
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    """Lista rezultatele salvate. Necesita X-Admin-Key header."""
    if not ADMIN_SECRET or x_admin_key != ADMIN_SECRET:
        raise HTTPException(403, "Unauthorized")
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    try:
        q = client.table("pick_results").select("*").order("pick_date", desc=True)
        if date:
            q = q.eq("pick_date", date)
        rows = q.execute()
        return {"results": rows.data or []}
    except Exception as e:
        logger.error("[admin/picks/results] %s", e)
        raise HTTPException(500, "Eroare interna")


# ─────────────────────────────────────────────
# TRACKED MATCHES — tracker personal al userului
# ─────────────────────────────────────────────
class TrackedMatchRequest(BaseModel):
    home: str
    away: str
    league: str
    flag: str = "⚽"
    date: str
    time: str = ""
    prediction: str
    market: str = "1X2"


class MatchResultUpdate(BaseModel):
    result: str   # 'pending' | 'correct' | 'wrong'


@app.get("/api/tracked-matches")
def get_tracked_matches(user: dict = Depends(require_user)):
    """Returneaza toate meciurile tracked ale userului curent."""
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    rows = client.table("tracked_matches").select("*").eq("user_id", user["id"]).order("added_at", desc=True).execute()
    return {"matches": rows.data or []}


@app.post("/api/tracked-matches")
def add_tracked_match(req: TrackedMatchRequest, user: dict = Depends(require_user)):
    """Adauga un meci in tracker-ul personal."""
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    row = client.table("tracked_matches").insert({
        "user_id":    user["id"],
        "home":       req.home,
        "away":       req.away,
        "league":     req.league,
        "flag":       req.flag,
        "date":       req.date,
        "time":       req.time,
        "prediction": req.prediction,
        "market":     req.market,
        "result":     "pending",
        "added_at":   datetime.date.today().isoformat(),
    }).execute()
    return row.data[0]


@app.patch("/api/tracked-matches/{match_id}")
def update_tracked_match(match_id: int, body: MatchResultUpdate, user: dict = Depends(require_user)):
    """Actualizeaza rezultatul unui meci tracked."""
    if body.result not in ("pending", "correct", "wrong"):
        raise HTTPException(400, "result must be pending, correct, or wrong")
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    existing = client.table("tracked_matches").select("user_id").eq("id", match_id).execute()
    if not existing.data or str(existing.data[0]["user_id"]) != str(user["id"]):
        raise HTTPException(404, "Not found")
    client.table("tracked_matches").update({"result": body.result}).eq("id", match_id).execute()
    return {"ok": True}


@app.delete("/api/tracked-matches/{match_id}")
def delete_tracked_match(match_id: int, user: dict = Depends(require_user)):
    """Sterge un meci din tracker."""
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    existing = client.table("tracked_matches").select("user_id").eq("id", match_id).execute()
    if not existing.data or str(existing.data[0]["user_id"]) != str(user["id"]):
        raise HTTPException(404, "Not found")
    client.table("tracked_matches").delete().eq("id", match_id).execute()
    return {"ok": True}


@app.delete("/api/tracked-matches")
def clear_tracked_matches(user: dict = Depends(require_user)):
    """Sterge toate meciurile tracked ale userului."""
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")
    client.table("tracked_matches").delete().eq("user_id", user["id"]).execute()
    return {"ok": True}


# ─────────────────────────────────────────────
# GUMROAD CHECKOUT
# ─────────────────────────────────────────────
GUMROAD_PRODUCTS = {
    "analyst": {
        "permalink": "xzbxnc",
        "url":       "https://florianparv.gumroad.com/l/xzbxnc",
        "name":      "Analyst",
        "price_usd": 8,
        "tier":      "analyst",
    },
    "pro": {
        "permalink": "lnjfx",
        "url":       "https://florianparv.gumroad.com/l/lnjfx",
        "name":      "Pro",
        "price_usd": 20,
        "tier":      "pro",
    },
}


@app.get("/api/stripe/plans")
def gumroad_plans():
    """Returneaza planurile disponibile."""
    return {
        k: {
            "name":      v["name"],
            "price_usd": v["price_usd"],
            "tier":      v["tier"],
        }
        for k, v in GUMROAD_PRODUCTS.items()
    }


class CheckoutRequest(BaseModel):
    plan: str   # "analyst" | "pro"


@app.post("/api/checkout/session")
@limiter.limit("10/minute")
def create_checkout_session(
    req: CheckoutRequest,
    request: Request,
    user: dict = Depends(require_user),
):
    """Returneaza URL-ul Gumroad pentru checkout. Necesita autentificare."""
    plan = GUMROAD_PRODUCTS.get(req.plan)
    if not plan:
        raise HTTPException(400, f"Plan necunoscut: {req.plan}")

    # Trimitem email-ul userului catre Gumroad pentru pre-fill
    import urllib.parse
    params = urllib.parse.urlencode({
        "email":   user["email"],
        "wanted":  "true",
        # user_id ca referinta pentru webhook
        "referral_code": str(user["id"]),
    })
    checkout_url = f"{plan['url']}?{params}"

    return {"url": checkout_url}


GUMROAD_SELLER_ID = os.getenv("GUMROAD_SELLER_ID", "")

@app.post("/api/webhook/gumroad")
async def gumroad_webhook(request: Request):
    """
    Ping Gumroad — upgradeaza/downgradeaza tier dupa events de plata.
    Setat in Gumroad Settings -> Advanced -> Ping URL:
      https://football-predictor-api-n9sl.onrender.com/api/webhook/gumroad
    """
    try:
        body = await request.body()
        from urllib.parse import parse_qs
        data = {k: v[0] for k, v in parse_qs(body.decode("utf-8")).items()}
    except Exception:
        raise HTTPException(400, "Payload invalid")

    # Validare seller_id daca e setat
    if GUMROAD_SELLER_ID:
        seller = data.get("seller_id", "")
        if seller != GUMROAD_SELLER_ID:
            logger.warning("[gumroad] Seller ID invalid: %s", seller)
            raise HTTPException(status_code=403, detail="Forbidden")

    email        = data.get("email", "")
    permalink    = data.get("product_permalink", "")
    cancelled    = data.get("cancelled", "false").lower() == "true"
    refunded     = data.get("refunded", "false").lower() == "true"

    logger.info("[gumroad] Ping: permalink=%s email=%s cancelled=%s", permalink, email, cancelled)

    if not email:
        return {"received": True}

    # Identifica tier-ul din permalink
    tier = "free"
    for plan_key, plan_data in GUMROAD_PRODUCTS.items():
        if plan_data["permalink"] == permalink:
            tier = plan_data["tier"]
            break

    client = get_client()
    if not client:
        return {"received": True}

    try:
        rows = client.table("users").select("id").eq("email", email).execute()
        if not rows.data:
            logger.warning("[gumroad] User negasit pentru email: %s", email)
            return {"received": True}

        user_id = rows.data[0]["id"]

        if cancelled or refunded:
            client.table("users").update({"tier": "free"}).eq("id", user_id).execute()
            logger.info("[gumroad] Downgraded user %s -> free", user_id)
        else:
            client.table("users").update({"tier": tier}).eq("id", user_id).execute()
            logger.info("[gumroad] Upgraded user %s -> %s", user_id, tier)

    except Exception as e:
        logger.error("[gumroad] DB update failed: %s", e)

    return {"received": True}


# ─────────────────────────────────────────────
# ADMIN — TEST TELEGRAM
# ─────────────────────────────────────────────
@app.post("/api/admin/test-telegram")
def admin_test_telegram(
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    if not ADMIN_SECRET or x_admin_key != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    from notifications import send_telegram
    import datetime
    fake_picks = [{
        "home": "Real Madrid", "away": "Barcelona",
        "league": "La Liga", "time": "21:00",
        "flag": "🇪🇸", "confidence": 72,
        "prediction": "H", "prediction_label": "1",
        "edge": 4.2, "value_bet": True, "has_odds": True,
    }]
    date_str = datetime.datetime.now().strftime("%d.%m.%Y")
    ok = send_telegram(fake_picks, date_str)
    return {"sent": ok}


@app.post("/api/admin/refresh-picks")
def admin_refresh_picks(
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    date: Optional[str] = None,
):
    """Trigger manual compute_and_store_picks. Necesita X-Admin-Key header."""
    if not ADMIN_SECRET or x_admin_key != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        result = compute_and_store_picks(date)
        return {"ok": True, "picks": result.get("total_picks", 0), "date": result.get("date")}
    except Exception as e:
        logger.error("[admin/refresh-picks] %s", e)
        raise HTTPException(status_code=500, detail="Eroare interna")



# ─────────────────────────────────────────────
# ECHIPE CUNOSCUTE
# ─────────────────────────────────────────────
@app.get("/teams")
@app.get("/api/teams")
def teams():
    return {"teams": get_known_teams()}
