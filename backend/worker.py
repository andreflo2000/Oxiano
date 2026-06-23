"""
OXIANO — Background Worker
Rulează separat de API: compute picks, auto-mark results, refresh Elo.
Pornit de Render ca serviciu de tip 'worker'.
"""

import datetime
import logging
import time

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [worker] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def _load():
    """Incarca modelul si refresheaza Elo la pornire."""
    from predictor import load_model, refresh_clubelo
    import cache as _cache
    load_model()
    logger.info("Model incarcat.")
    try:
        refresh_clubelo(_cache)
        logger.info("Club-elo refreshed.")
    except Exception as e:
        logger.warning("Club-elo refresh esuat: %s", e)


def _compute_today():
    from ingestion import compute_and_store_picks
    target = datetime.date.today().isoformat()
    logger.info("Compute picks pentru %s ...", target)
    try:
        result = compute_and_store_picks(target)
        logger.info("Picks %s: %d total", target, result.get("total_picks", 0))
    except Exception as e:
        logger.error("Compute %s esuat: %s", target, e)


def _compute_tomorrow():
    from ingestion import compute_and_store_picks
    target = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    logger.info("Compute picks pentru %s ...", target)
    try:
        result = compute_and_store_picks(target)
        logger.info("Picks %s: %d total", target, result.get("total_picks", 0))
    except Exception as e:
        logger.error("Compute %s esuat: %s", target, e)


def _compute_day_after():
    from ingestion import compute_and_store_picks
    target = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
    logger.info("Compute picks pentru %s ...", target)
    try:
        result = compute_and_store_picks(target)
        logger.info("Picks %s: %d total", target, result.get("total_picks", 0))
    except Exception as e:
        logger.error("Compute %s esuat: %s", target, e)


def _auto_mark():
    from ingestion import auto_mark_results
    logger.info("Auto-mark results ...")
    try:
        auto_mark_results()
        logger.info("Auto-mark done.")
    except Exception as e:
        logger.error("Auto-mark esuat: %s", e)


def _refresh_elo():
    from predictor import refresh_clubelo
    import cache as _cache
    try:
        refresh_clubelo(_cache)
        logger.info("Club-elo refreshed.")
    except Exception as e:
        logger.warning("Club-elo refresh esuat: %s", e)


def _run_bet_pipeline():
    try:
        from bet_signal import run_pipeline
        run_pipeline()
    except RuntimeError as e:
        logger.warning("Bet signal dezactivat: %s", e)
    except Exception as e:
        logger.error("Bet signal pipeline esuat: %s", e)


def _update_bet_results():
    try:
        from bet_signal import update_results
        update_results()
    except RuntimeError as e:
        logger.warning("Bet signal dezactivat: %s", e)
    except Exception as e:
        logger.error("Bet signal update results esuat: %s", e)


def _keepalive_db():
    """Ping Supabase zilnic ca sa evitam pauza pe free tier (7 zile inactivitate)."""
    from db import get_client
    try:
        client = get_client()
        if client:
            client.table("daily_picks").select("id").limit(1).execute()
            logger.info("DB keepalive OK.")
    except Exception as e:
        logger.warning("DB keepalive esuat: %s", e)


if __name__ == "__main__":
    logger.info("=== OXIANO WORKER PORNIT ===")

    # Incarca modelul si Elo la startup
    _load()

    # Compute initial pentru azi + urmatoarele 2 zile
    _compute_today()
    _compute_tomorrow()
    _compute_day_after()
    _keepalive_db()

    scheduler = BlockingScheduler(timezone="Europe/Bucharest")

    # Picks: azi la 07:00 si 13:00
    scheduler.add_job(_compute_today, CronTrigger(hour=7,  minute=0),  id="picks_07")
    scheduler.add_job(_compute_today, CronTrigger(hour=13, minute=0),  id="picks_13")
    # Picks: maine la 07:30
    scheduler.add_job(_compute_tomorrow,   CronTrigger(hour=7, minute=30), id="picks_tomorrow")
    # Picks: poimaine la 08:00
    scheduler.add_job(_compute_day_after,  CronTrigger(hour=8, minute=0),  id="picks_day_after")
    # Auto-mark WIN/LOSS la 23:30
    scheduler.add_job(_auto_mark, CronTrigger(hour=23, minute=30), id="auto_mark")
    # Refresh Elo zilnic la 06:00
    scheduler.add_job(_refresh_elo, CronTrigger(hour=6, minute=0), id="elo_refresh")
    # Bet signals: pipeline 09:00, rezultate 23:45
    scheduler.add_job(_run_bet_pipeline,   CronTrigger(hour=9,  minute=0),  id="bet_pipeline")
    scheduler.add_job(_update_bet_results, CronTrigger(hour=23, minute=45), id="bet_results")
    # Keepalive Supabase: ping zilnic la 12:00 — evita pauza free tier (7 zile inactivitate)
    scheduler.add_job(_keepalive_db, CronTrigger(hour=12, minute=0), id="db_keepalive")

    logger.info("Scheduler pornit. Jobs active: %s", [j.id for j in scheduler.get_jobs()])
    scheduler.start()
