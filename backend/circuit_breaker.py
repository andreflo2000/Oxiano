"""
Circuit breaker pentru API-uri externe.
Dupa N esecuri consecutive, circuitul se deschide si blocheaza requesturile
pentru reset_timeout secunde, protejand sistemul de cascade failures.
"""
import time
import threading
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)


class CircuitBreaker:
    def __init__(self, failures_threshold: int = 3, reset_timeout: int = 300):
        self._lock = threading.Lock()
        self._failures: dict = defaultdict(int)
        self._opened_at: dict = {}
        self.threshold = failures_threshold
        self.timeout = reset_timeout

    def is_open(self, name: str) -> bool:
        with self._lock:
            if name not in self._opened_at:
                return False
            if time.time() - self._opened_at[name] > self.timeout:
                self._failures[name] = 0
                del self._opened_at[name]
                logger.info("[cb] %s: circuit resetat dupa %ds", name, self.timeout)
                return False
            return True

    def record_failure(self, name: str) -> None:
        with self._lock:
            self._failures[name] += 1
            if self._failures[name] >= self.threshold and name not in self._opened_at:
                self._opened_at[name] = time.time()
                logger.warning("[cb] %s: circuit DESCHIS dupa %d esecuri", name, self._failures[name])

    def record_success(self, name: str) -> None:
        with self._lock:
            self._failures[name] = 0
            self._opened_at.pop(name, None)

    def status(self) -> dict:
        with self._lock:
            return {
                name: {
                    "open": True,
                    "opened_ago_s": int(time.time() - ts),
                    "resets_in_s": max(0, int(self.timeout - (time.time() - ts))),
                }
                for name, ts in self._opened_at.items()
            }


cb = CircuitBreaker(failures_threshold=3, reset_timeout=300)
