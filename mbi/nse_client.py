"""One HTTP client for every NSE call (spec section 4).

* single requests.Session with current browser headers
* warm-up GET of nseindia.com so cookies exist before any /api/ call
* re-warm (fresh session) on 401/403/empty body/JSONDecodeError, with backoff + jitter
* global rate limit (~2.5 req/s) and session rotation (~100 calls / ~5 min)
* Playwright browser fallback when requests keeps failing
* every failure/recovery is recorded in ``client.events`` for the status log
"""
from __future__ import annotations

import json
import logging
import random
import threading
import time
from typing import Any, Callable, Literal

import requests

log = logging.getLogger(__name__)

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS = {
    "User-Agent": CHROME_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.nseindia.com/",
    "Connection": "keep-alive",
    "sec-ch-ua": '"Chromium";v="141", "Google Chrome";v="141", "Not?A_Brand";v="8"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}

Kind = Literal["json", "bytes", "text"]


class NSEError(Exception):
    """The request failed after every retry and fallback."""

    def __init__(self, msg: str, *, network_down: bool = False):
        super().__init__(msg)
        self.network_down = network_down


class NSENotFound(NSEError):
    """HTTP 404 - for bhavcopy this means "no session that day", not an error."""


class _Retryable(Exception):
    pass


class NSEClient:
    BASE_URL = "https://www.nseindia.com"
    WARM_URLS = (BASE_URL + "/", BASE_URL + "/market-data/live-equity-market")

    def __init__(
        self,
        *,
        rate_per_sec: float = 2.5,
        max_retries: int = 4,
        backoff_base: float = 1.0,
        rotate_after_calls: int = 100,
        rotate_after_secs: float = 300.0,
        timeout: float = 30.0,
        use_playwright: bool = True,
        session_factory: Callable[[], requests.Session] = requests.Session,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.rate_per_sec = rate_per_sec
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.rotate_after_calls = rotate_after_calls
        self.rotate_after_secs = rotate_after_secs
        self.timeout = timeout
        self.use_playwright = use_playwright
        self.session_factory = session_factory
        self.sleep = sleep

        self.events: list[dict[str, Any]] = []
        self._session: requests.Session | None = None
        self._warmed = False
        self._calls = 0
        self._created = 0.0
        self._next_allowed = 0.0
        self._lock = threading.Lock()
        self.total_requests = 0

    # ------------------------------------------------------------------ bookkeeping
    def _record(self, kind: str, url: str, detail: str = "") -> None:
        ev = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind, "url": url, "detail": detail}
        self.events.append(ev)
        level = logging.WARNING if kind in ("retry", "failure", "playwright_failed") else logging.INFO
        log.log(level, "nse %s %s %s", kind, url, detail)

    def events_since(self, mark: int) -> list[dict[str, Any]]:
        return self.events[mark:]

    # ------------------------------------------------------------------ session
    def _throttle(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = self._next_allowed - now
            interval = (1.0 / self.rate_per_sec) * (1.0 + random.uniform(0.0, 0.3))
            self._next_allowed = max(now, self._next_allowed) + interval
        if wait > 0:
            self.sleep(wait)

    def _new_session(self) -> None:
        if self._session is not None:
            try:
                self._session.close()
            except Exception:  # noqa: BLE001
                pass
        s = self.session_factory()
        s.headers.update(DEFAULT_HEADERS)
        self._session = s
        self._warmed = False
        self._calls = 0
        self._created = time.monotonic()

    def warm_up(self) -> None:
        """Visit the home page (and a market page if needed) so NSE sets cookies."""
        if self._session is None:
            self._new_session()
        assert self._session is not None
        last_err: Exception | None = None
        for url in self.WARM_URLS:
            try:
                self._throttle()
                r = self._session.get(url, timeout=self.timeout)
                self.total_requests += 1
                if r.status_code < 400 and len(self._session.cookies) > 0:
                    self._warmed = True
                    return
                last_err = _Retryable(f"warm-up HTTP {r.status_code}, cookies={len(self._session.cookies)}")
            except requests.RequestException as e:
                last_err = e
        # Cookies might still be missing (e.g. archives host does not need them);
        # mark warmed and let the real call decide.
        self._warmed = True
        if last_err is not None:
            self._record("warmup_incomplete", self.BASE_URL, str(last_err))

    def _ensure_session(self) -> None:
        age = time.monotonic() - self._created
        if self._session is None:
            self._new_session()
        elif self._calls >= self.rotate_after_calls or age >= self.rotate_after_secs:
            self._record("rotate", self.BASE_URL, f"calls={self._calls} age={age:.0f}s")
            self._new_session()
        if not self._warmed:
            self.warm_up()

    def reset(self) -> None:
        """Drop cookies and start again (used by the re-warm path and tests)."""
        self._new_session()

    # ------------------------------------------------------------------ requests
    @staticmethod
    def _decode(body: bytes, kind: Kind):
        if kind == "bytes":
            return body
        if kind == "text":
            return body.decode("utf-8", errors="replace")
        return json.loads(body)

    def get(self, url: str, *, params: dict | None = None, kind: Kind = "json"):
        failures = 0
        network_errors = 0
        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                self._ensure_session()
                assert self._session is not None
                self._throttle()
                r = self._session.get(url, params=params, timeout=self.timeout)
                self._calls += 1
                self.total_requests += 1
                if r.status_code == 404:
                    raise NSENotFound(f"404 {url}")
                if r.status_code in (401, 403, 429) or r.status_code >= 500:
                    raise _Retryable(f"HTTP {r.status_code}")
                if r.status_code >= 400:
                    raise NSEError(f"HTTP {r.status_code} {url}")
                body = r.content
                if not body or not body.strip():
                    raise _Retryable("empty body")
                try:
                    data = self._decode(body, kind)
                except json.JSONDecodeError as e:
                    raise _Retryable(f"JSONDecodeError: {e}") from e
                if failures:
                    self._record("recovered", url, f"after {failures} failed attempt(s) (re-warm + retry)")
                return data
            except NSENotFound:
                raise
            except (_Retryable, requests.RequestException) as e:
                failures += 1
                last_exc = e
                if isinstance(e, (requests.ConnectionError, requests.Timeout)):
                    network_errors += 1
                self._record("retry", url, f"attempt {attempt}/{self.max_retries}: {e}")
                # re-warm: brand-new session + cookies before the next attempt
                self._session = None
                self._warmed = False
                if attempt < self.max_retries:
                    delay = self.backoff_base * (2 ** (attempt - 1)) + random.uniform(0, self.backoff_base)
                    self.sleep(delay)

        network_down = network_errors == failures and failures > 0
        if self.use_playwright and not network_down:
            try:
                data = self._playwright_get(url, params, kind)
                self._record("recovered", url, "via Playwright browser session")
                return data
            except NSENotFound:
                raise
            except Exception as e:  # noqa: BLE001
                self._record("playwright_failed", url, f"{type(e).__name__}: {e}")
        self._record("failure", url, str(last_exc))
        raise NSEError(f"{url}: {last_exc}", network_down=network_down)

    # ------------------------------------------------------------------ browser fallback
    def _playwright_get(self, url: str, params: dict | None, kind: Kind):
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except ImportError as e:
            raise RuntimeError("playwright not installed (pip install playwright && playwright install chromium)") from e
        full = requests.Request("GET", url, params=params).prepare().url
        assert full is not None
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(user_agent=CHROME_UA, locale="en-US")
                page = ctx.new_page()
                page.goto(self.BASE_URL, wait_until="domcontentloaded", timeout=45_000)
                resp = ctx.request.get(full, headers={"Referer": self.BASE_URL + "/"}, timeout=45_000)
                if resp.status == 404:
                    raise NSENotFound(f"404 {url}")
                if not resp.ok:
                    raise NSEError(f"browser HTTP {resp.status}")
                body = resp.body()
                # hand the browser's cookies to requests for the following calls
                cookies = ctx.cookies()
                self._new_session()
                assert self._session is not None
                for c in cookies:
                    self._session.cookies.set(c["name"], c["value"], domain=c.get("domain"), path=c.get("path", "/"))
                self._warmed = True
            finally:
                browser.close()
        return self._decode(body, kind)
