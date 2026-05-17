"""
Supabase client + helpers pentru logging predicții.
"""
import os
import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

_client = None
_init_error: str = ""


def get_init_error() -> str:
    return _init_error


def get_client():
    """Returnează clientul Supabase (singleton, lazy init)."""
    global _client
    if _client is not None:
        return _client

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "") or os.getenv("SUPABASE_SERVICE_KEY", "")

    global _init_error
    if not url or not key:
        _init_error = "SUPABASE_URL/KEY missing"
        logger.warning("SUPABASE_URL / SUPABASE_SERVICE_KEY lipsesc - DB logging dezactivat")
        return None

    try:
        from supabase import create_client
        _client = create_client(url, key)
        _init_error = ""
        logger.info("Supabase conectat: %s", url)
    except Exception as e:
        _init_error = str(e)
        logger.error("Supabase init failed: %s", e)
        _client = None

    return _client


def log_prediction(
    match_date: str,
    home_team: str,
    away_team: str,
    league: str,
    market: str,
    model_prob: float,
    confidence: float,
    odds_used: Optional[float] = None,
) -> bool:
    """
    Salvează o predicție în tabelul `predictions`.
    Returnează True dacă a reușit, False altfel.
    """
    client = get_client()
    if client is None:
        return False

    try:
        client.table("predictions").insert({
            "match_date":  match_date,
            "home_team":   home_team,
            "away_team":   away_team,
            "league":      league,
            "market":      market,
            "model_prob":  round(model_prob, 4),
            "confidence":  round(confidence, 4),
            "odds_used":   odds_used,
        }).execute()
        return True
    except Exception as e:
        logger.error("log_prediction failed: %s", e)
        return False


def log_predictions_bulk(picks: list[dict], match_date: str) -> int:
    """
    Salvează în bulk toate pick-urile zilei.
    picks = lista de dict-uri din /api/daily
    Returnează numărul de rânduri inserate.
    """
    client = get_client()
    if client is None:
        return 0

    rows = []
    for p in picks:
        # Market principal = prediction_label (ex: "Victorie acasă")
        market = p.get("prediction_label") or p.get("prediction", "1X2")
        rows.append({
            "match_date":  match_date,
            "home_team":   p["home"],
            "away_team":   p["away"],
            "league":      p.get("league", ""),
            "market":      market,
            "model_prob":  round(p["confidence"] / 100, 4),
            "confidence":  round(p["confidence"] / 100, 4),
        })

    if not rows:
        return 0

    try:
        client.table("predictions").insert(rows).execute()
        return len(rows)
    except Exception as e:
        logger.error("log_predictions_bulk failed: %s", e)
        return 0
