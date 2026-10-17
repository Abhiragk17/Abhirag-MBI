"""Acceptance 4: cookie warm-up and 403 -> re-warm -> retry."""
import json

import pytest
import requests

from mbi.nse_client import NSEClient, NSEError, NSENotFound


class FakeResp:
    def __init__(self, status=200, body=b""):
        self.status_code = status
        self.content = body


class FakeSession:
    """Mimics NSE: /api/ calls need the cookie set by visiting the home page."""
    instances: list["FakeSession"] = []
    script: list[int] = []  # forced status codes for successive /api/ calls
    log: list[str] = []

    def __init__(self):
        self.headers = {}
        self.cookies = requests.cookies.RequestsCookieJar()
        FakeSession.instances.append(self)

    def get(self, url, params=None, timeout=None):
        FakeSession.log.append(url)
        if url.rstrip("/") == "https://www.nseindia.com":
            self.cookies.set("nsit", "abc")
            return FakeResp(200, b"<html>")
        if "/api/" in url:
            if FakeSession.script:
                code = FakeSession.script.pop(0)
                if code != 200:
                    return FakeResp(code, b"")
            if "nsit" not in self.cookies:
                return FakeResp(401, b"")
            return FakeResp(200, json.dumps({"ok": True}).encode())
        if url.endswith("missing.zip"):
            return FakeResp(404, b"")
        return FakeResp(200, b"bytes")

    def close(self):
        pass


@pytest.fixture(autouse=True)
def reset():
    FakeSession.instances = []
    FakeSession.script = []
    FakeSession.log = []


def client(**kw):
    return NSEClient(session_factory=FakeSession, sleep=lambda s: None, rate_per_sec=1000,
                     use_playwright=False, **kw)


def test_first_call_succeeds_with_no_cookies():
    c = client()
    assert c.get("https://www.nseindia.com/api/x") == {"ok": True}
    # warm-up happened before the API call
    assert FakeSession.log[0].rstrip("/") == "https://www.nseindia.com"
    assert FakeSession.log[-1].endswith("/api/x")
    assert not [e for e in c.events if e["kind"] in ("retry", "failure")]


def test_forced_403_triggers_rewarm_and_retry():
    c = client()
    c.get("https://www.nseindia.com/api/x")
    FakeSession.script = [403]
    assert c.get("https://www.nseindia.com/api/y") == {"ok": True}
    kinds = [e["kind"] for e in c.events]
    assert "retry" in kinds and "recovered" in kinds
    assert len(FakeSession.instances) == 2  # session was recreated
    i = len(FakeSession.log) - 1
    assert FakeSession.log[i - 1].rstrip("/") == "https://www.nseindia.com"  # re-warmed before retry


def test_json_decode_and_empty_body_are_retried():
    c = client()
    FakeSession.script = [200]  # first call ok but we sabotage via an empty-body status below
    c.get("https://www.nseindia.com/api/x")
    FakeSession.script = [500, 403]
    assert c.get("https://www.nseindia.com/api/z") == {"ok": True}


def test_gives_up_after_retries():
    c = client(max_retries=3)
    FakeSession.script = [403, 403, 403]
    with pytest.raises(NSEError):
        c.get("https://www.nseindia.com/api/x")
    assert c.events[-1]["kind"] == "failure"


def test_404_is_not_retried():
    c = client()
    with pytest.raises(NSENotFound):
        c.get("https://nsearchives.nseindia.com/content/missing.zip", kind="bytes")
    assert not [e for e in c.events if e["kind"] == "retry"]


def test_network_down_flag():
    class Down(FakeSession):
        def get(self, url, params=None, timeout=None):
            raise requests.ConnectionError("no route")

    c = NSEClient(session_factory=Down, sleep=lambda s: None, rate_per_sec=1000, use_playwright=True,
                  max_retries=2)
    with pytest.raises(NSEError) as ei:
        c.get("https://www.nseindia.com/api/x")
    assert ei.value.network_down
    # Playwright is not attempted when the network itself is down
    assert not [e for e in c.events if e["kind"] == "playwright_failed"]


def test_session_rotation():
    c = client(rotate_after_calls=3)
    for _ in range(7):
        c.get("https://www.nseindia.com/api/x")
    assert len(FakeSession.instances) >= 3
    assert any(e["kind"] == "rotate" for e in c.events)
