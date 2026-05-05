"""
Cache layer — Upstash Redis (REST API) cu fallback la dict in memorie.
"""
import os
import json
import time
import logging
import hashlib

import requests as req

logger = logging.getLogger(__name__)

_REDIS_URL   = None
_REDIS_TOKEN = None
_mem_cache: dict = {}   # fallback daca Redis nu e configurat


def _init():
    global _REDIS_URL, _REDIS_TOKEN
    _REDIS_URL   = os.getenv("UPSTASH_REDIS_REST_URL", "").rstrip("/")
    _REDIS_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
    if _REDIS_URL and _REDIS_TOKEN:
        logger.info("Redis cache activ: %s", _REDIS_URL)
    else:
        logger.warning("Redis neconfigurat - folosesc cache in memorie")


def _redis(command: list):
    """Executa o comanda Redis via REST API. Returneaza result sau None."""
    if not _REDIS_URL:
        return None
    try:
        r = req.post(
            f"{_REDIS_URL}/{'/'.join(str(c) for c in command)}",
            headers={"Authorization": f"Bearer {_REDIS_TOKEN}"},
            timeout=3,
        )
        if r.status_code == 200:
            return r.json().get("result")
    except Exception as e:
        logger.warning("Redis error: %s", e)
    return None


def _make_key(namespace: str, key: str) -> str:
    h = hashlib.md5(key.encode()).hexdigest()[:8]
    return f"flopi:{namespace}:{h}"


def get(namespace: str, key: str):
    """Returnează valoarea din cache sau None dacă lipsește/expirat."""
    if not _REDIS_URL:
        entry = _mem_cache.get(f"{namespace}:{key}")
        if entry and time.time() < entry["exp"]:
            return entry["data"]
        return None

    rkey = _make_key(namespace, key)
    raw  = _redis(["GET", rkey])
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def set(namespace: str, key: str, value, ttl: int = 600):
    """Salvează valoarea în cache cu TTL în secunde."""
    if not _REDIS_URL:
        _mem_cache[f"{namespace}:{key}"] = {
            "data": value,
            "exp":  time.time() + ttl,
        }
        return

    rkey = _make_key(namespace, key)
    serialized = json.dumps(value, default=str)
    _redis(["SET", rkey, serialized, "EX", ttl])


def delete(namespace: str, key: str):
    """Șterge o cheie din cache."""
    if not _REDIS_URL:
        _mem_cache.pop(f"{namespace}:{key}", None)
        return
    _redis(["DEL", _make_key(namespace, key)])


def ttl(namespace: str, key: str) -> int:
    """Returneaza TTL-ul ramas in secunde. -2 daca lipseste, -1 daca nu are expirare."""
    if not _REDIS_URL:
        entry = _mem_cache.get(f"{namespace}:{key}")
        if not entry:
            return -2
        return max(0, int(entry["exp"] - time.time()))
    rkey = _make_key(namespace, key)
    result = _redis(["TTL", rkey])
    return int(result) if result is not None else -2


# Init la import
_init()
