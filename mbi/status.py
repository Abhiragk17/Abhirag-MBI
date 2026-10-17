"""data_status.json writer (spec section 9).

Layout:
{
  "updated_at": ISO,
  "offline": bool, "offline_since": ISO|null,
  "last_run": {command, started_at, finished_at, ok, error, traceback, log_file},
  "universe": {version, source, age_days, nanocap_stale, nanocap_note, warnings[]},
  "calendar": {source, note},
  "days": {"YYYY-MM-DD": {status, source, attempts, errors[], missing_symbols[],
                          excluded_symbols[], suspected_events[], recovered_events[],
                          notes[], stale, updated_at}},
  "events": [{ts, kind, detail, url?, date?}]   # most recent 300
}
"""
from __future__ import annotations

import traceback as tb
from datetime import date, datetime, timezone
from typing import Any

from . import paths
from .store import atomic_write_json, read_json

DAY_STATUSES = ("ok", "recovered", "fallback", "partial", "failed")
SOURCES = ("nse_bhavcopy", "nse_api", "yfinance", "cache")
MAX_EVENTS = 300


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _blank() -> dict[str, Any]:
    return {
        "updated_at": None,
        "offline": False,
        "offline_since": None,
        "last_run": None,
        "universe": None,
        "calendar": None,
        "days": {},
        "events": [],
    }


class StatusStore:
    """Small wrapper; every mutation is written straight to disk (atomically) so a
    crash mid-run still leaves an accurate log behind."""

    def __init__(self, autosave: bool = True):
        self.autosave = autosave
        self.data = read_json(paths.status_file(), None) or _blank()
        for k, v in _blank().items():
            self.data.setdefault(k, v)

    # ------------------------------------------------------------------ persistence
    def save(self) -> None:
        self.data["updated_at"] = now_iso()
        atomic_write_json(paths.status_file(), self.data)

    def _touch(self) -> None:
        if self.autosave:
            self.save()

    # ------------------------------------------------------------------ events
    def event(self, kind: str, detail: str, **extra: Any) -> None:
        ev = {"ts": now_iso(), "kind": kind, "detail": detail}
        ev.update({k: v for k, v in extra.items() if v is not None})
        self.data["events"].append(ev)
        self.data["events"] = self.data["events"][-MAX_EVENTS:]
        self._touch()

    # ------------------------------------------------------------------ days
    def day(self, d: date | str) -> dict[str, Any] | None:
        key = d if isinstance(d, str) else d.isoformat()
        return self.data["days"].get(key)

    def set_day(self, d: date | str, **fields: Any) -> dict[str, Any]:
        key = d if isinstance(d, str) else d.isoformat()
        entry = self.data["days"].get(key) or {
            "status": "ok", "source": "nse_bhavcopy", "attempts": 0, "errors": [],
            "missing_symbols": [], "excluded_symbols": [], "suspected_events": [],
            "recovered_events": [], "notes": [], "stale": False, "updated_at": None,
        }
        entry.update(fields)
        entry["updated_at"] = now_iso()
        self.data["days"][key] = entry
        self._touch()
        return entry

    def drop_day(self, d: date | str) -> None:
        key = d if isinstance(d, str) else d.isoformat()
        if self.data["days"].pop(key, None) is not None:
            self._touch()

    # ------------------------------------------------------------------ run tracking
    def run_started(self, command: str, log_file: str | None) -> None:
        self.data["last_run"] = {
            "command": command, "started_at": now_iso(), "finished_at": None,
            "ok": None, "error": None, "traceback": None, "log_file": log_file,
            "summary": None,
        }
        self._touch()

    def run_finished(self, ok: bool, summary: str | None = None,
                     exc: BaseException | None = None) -> None:
        run = self.data.get("last_run") or {}
        run["finished_at"] = now_iso()
        run["ok"] = ok
        run["summary"] = summary
        if exc is not None:
            run["error"] = f"{type(exc).__name__}: {exc}"
            frames = tb.format_exception(type(exc), exc, exc.__traceback__)
            # summary: last few frames only (spec: "traceback summary")
            run["traceback"] = "".join(frames[-6:])[-4000:]
        self.data["last_run"] = run
        self._touch()

    def set_offline(self, offline: bool) -> None:
        if offline and not self.data.get("offline"):
            self.data["offline_since"] = now_iso()
        if not offline:
            self.data["offline_since"] = None
        self.data["offline"] = offline
        self._touch()

    def set_universe(self, **fields: Any) -> None:
        u = self.data.get("universe") or {}
        u.update(fields)
        self.data["universe"] = u
        self._touch()

    def set_calendar(self, source: str, note: str | None = None) -> None:
        self.data["calendar"] = {"source": source, "note": note, "checked_at": now_iso()}
        self._touch()

    def stale_mark_all_recent(self, stale: bool) -> None:
        for v in self.data["days"].values():
            v["stale"] = stale
        self._touch()
