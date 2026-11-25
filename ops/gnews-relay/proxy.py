"""Google News RSS search relay for taiwan-intel-dashboard's /api/search.

Google rate-limits Cloudflare Worker egress IPs (429/503), so the Worker asks this
relay instead. The upstream is fixed to news.google.com RSS search and the query
rules mirror static/_worker.js, so this cannot be used to reach any other host.
"""
import hmac
import os
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST, PORT = "127.0.0.1", 8331
KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "relay.key")


def load_key(path: str = KEY_FILE) -> str | None:
    """Shared key from the Worker (X-Relay-Key). No key file = not enforced yet (staged rollout).
    A key file that exists but is empty fails closed instead of silently disabling the check."""
    try:
        with open(path, encoding="utf-8") as fh:
            key = fh.read().strip()
    except FileNotFoundError:
        return None
    if not key:
        raise SystemExit(f"{path} exists but is empty; refusing to start without a key")
    return key


def key_ok(expected: str | None, presented: str | None) -> bool:
    return expected is None or hmac.compare_digest(expected.encode(), (presented or "").encode())

DAYS = {"1", "2", "3", "7", "30"}
CACHE_SECONDS = 600
RATE_PER_MINUTE = 60  # shortcut: one global bucket; per-client limits if abuse ever shows up
# 上游偶發 502／逾時（2026-11-25 實測 8 秒後即恢復）：短逾時重試一次，兩次合計 7 秒，仍在 Worker 的 8 秒內。
UPSTREAM_TIMEOUTS = (4, 3)
TOTAL_BUDGET = 7.0  # 整個請求（含重試與讀取）的上限，低於 Worker 的 8 秒
MAX_BODY = 2_000_000
CACHE_MAX_BYTES = 32_000_000  # well under the unit's MemoryMax=128M
UA = "Mozilla/5.0 (compatible; taiwan-intel-dashboard/1.0; +https://taiwan-intel-dashboard.pages.dev)"

_cache: dict[tuple[str, str], tuple[float, bytes]] = {}
_hits: list[float] = []
_lock = threading.Lock()


def validate(params: dict[str, list[str]]) -> tuple[str, str] | None:
    """Same rules as the Worker: 1-120 chars, no control/format chars, days in DAYS."""
    raw = (params.get("q") or [""])[0]
    days = (params.get("days") or [""])[0]
    query = " ".join(raw.split())
    if not query or len(raw.strip()) > 120 or days not in DAYS:
        return None
    if any(unicodedata.category(ch) in ("Cc", "Cf") for ch in raw):
        return None
    return query, days


def upstream_url(query: str, days: str) -> str:
    params = urllib.parse.urlencode({"q": f"{query} when:{days}d", "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"})
    return f"https://news.google.com/rss/search?{params}"


def allow_request(now: float) -> bool:
    with _lock:
        while _hits and now - _hits[0] > 60:
            _hits.pop(0)
        if len(_hits) >= RATE_PER_MINUTE:
            return False
        _hits.append(now)
        return True


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # the Worker does not follow redirects either
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def cache_put(key: tuple[str, str], now: float, body: bytes) -> None:
    """Store a response, dropping expired entries, then the oldest until under CACHE_MAX_BYTES."""
    with _lock:
        _cache[key] = (now, body)
        for stale in [k for k, (t, _) in _cache.items() if now - t >= CACHE_SECONDS]:
            del _cache[stale]
        total = sum(len(b) for _, b in _cache.values())
        for oldest in sorted(_cache, key=lambda k: _cache[k][0]):
            if total <= CACHE_MAX_BYTES:
                break
            total -= len(_cache.pop(oldest)[1])


class Handler(BaseHTTPRequestHandler):
    server_version = "gnews-relay"
    sys_version = ""  # do not advertise the Python version

    def _send(self, status: int, body: bytes, ctype: str = "text/plain; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        if url.path not in ("/rss", "/gnews/rss"):
            return self._send(404, b"not found")
        if not key_ok(RELAY_KEY, self.headers.get("X-Relay-Key")):
            return self._send(401, b"unauthorized")
        parsed = validate(urllib.parse.parse_qs(url.query, keep_blank_values=True))
        if not parsed:
            return self._send(400, b"bad query")
        key = parsed
        now = time.time()
        with _lock:
            hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return self._send(200, hit[1], "application/rss+xml; charset=utf-8")
        if not allow_request(now):
            return self._send(429, b"relay rate limited")
        body, reason = fetch_upstream(upstream_url(*parsed))
        if body is None:
            sys.stderr.write(f"upstream failed: {reason}\n")  # 只記原因，不記查詢內容
            return self._send(502, f"upstream {reason}".encode())
        cache_put(key, now, body)
        self._send(200, body, "application/rss+xml; charset=utf-8")

    def log_message(self, fmt: str, *args) -> None:  # one line per request, no query text (privacy)
        sys.stderr.write(f"{self.command} {urllib.parse.urlsplit(self.path).path} {args[1] if len(args) > 1 else ''}\n")


def read_with_deadline(response, deadline: float, clock=time.monotonic) -> bytes:
    """Socket timeouts bound each read, not the whole body; a slow-drip upstream could outlast the Worker."""
    chunks, size = [], 0
    while True:
        if clock() > deadline:
            raise TimeoutError("upstream body exceeded deadline")
        # read1 回傳目前可得的資料；read(n) 遇到 Content-Length 會一直等到湊滿才回來，期限檢查形同虛設（實測 22 秒）
        reader = getattr(response, "read1", None) or response.read
        chunk = reader(65536)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        size += len(chunk)
        if size > MAX_BODY:
            return b"".join(chunks)


def fetch_upstream(url: str, open_fn=None, timeouts=UPSTREAM_TIMEOUTS, may_retry=None,
                   budget: float = TOTAL_BUDGET, clock=time.monotonic) -> tuple[bytes | None, str]:
    """Return (rss body, "") or (None, reason). Retries once on 5xx, timeouts and non-RSS bodies.
    429 is never retried (it would amplify the rate limit), and a retry must take its own slot from
    the relay's per-minute budget (may_retry), so upstream calls stay within RATE_PER_MINUTE.
    Everything finishes within `budget` seconds, under the Worker's 8 s abort."""
    open_fn = open_fn or OPENER.open
    may_retry = may_retry or (lambda: allow_request(time.time()))
    deadline = clock() + budget
    reason = "no attempt"
    for attempt, timeout in enumerate(timeouts):
        remaining = deadline - clock()
        if attempt and remaining < 1:
            return None, f"{reason} (retry skipped: deadline)"
        if attempt and not may_retry():
            return None, f"{reason} (retry skipped: relay budget)"
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml"})
        try:
            with open_fn(request, timeout=min(timeout, max(remaining, 0.1))) as response:
                body = read_with_deadline(response, deadline, clock)
        except urllib.error.HTTPError as error:
            reason = f"HTTP {error.code}"
            if error.code < 500:
                return None, reason  # 4xx（含 429）重試也一樣，429 重試還會加重限流
            continue
        except Exception as error:  # timeout, DNS, TLS
            reason = type(error).__name__
            continue
        if len(body) > MAX_BODY or b"<rss" not in body[:2000]:
            reason = "not rss"
            continue
        return body, ""
    return None, reason


def self_test() -> None:
    q = lambda **kw: {k: [v] for k, v in kw.items()}
    assert validate(q(q="電信  5G", days="7")) == ("電信 5G", "7")
    assert validate(q(q="", days="7")) is None
    assert validate(q(q="字" * 121, days="7")) is None
    assert validate(q(q="字", days="99")) is None
    assert validate(q(q="字", days="07")) is None
    assert validate(q(q="字\n", days="7")) is None
    assert validate(q(q="字​", days="7")) is None
    assert validate({"q": ["字"]}) is None
    u = urllib.parse.urlsplit(upstream_url("電信", "7"))
    assert u.scheme == "https" and u.netloc == "news.google.com" and u.path == "/rss/search"
    assert urllib.parse.parse_qs(u.query)["q"] == ["電信 when:7d"]
    _hits.clear()
    assert all(allow_request(1000.0) for _ in range(RATE_PER_MINUTE)) and not allow_request(1000.0)
    assert allow_request(1061.0)
    _cache.clear()
    chunk = b"x" * (CACHE_MAX_BYTES // 2 - 1)
    for i in range(3):
        cache_put((f"q{i}", "7"), 2000.0 + i, chunk)
    assert sum(len(b) for _, b in _cache.values()) <= CACHE_MAX_BYTES
    assert ("q0", "7") not in _cache and ("q2", "7") in _cache
    cache_put(("q3", "7"), 2002.0 + CACHE_SECONDS, b"<rss/>")
    assert list(_cache) == [("q3", "7")]
    _cache.clear()
    assert key_ok(None, None) and key_ok(None, "x")
    assert key_ok("k1", "k1") and not key_ok("k1", "k2") and not key_ok("k1", None) and not key_ok("k1", "")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        assert load_key(os.path.join(tmp, "no-such.key")) is None
        empty = os.path.join(tmp, "empty.key")
        with open(empty, "w", encoding="utf-8") as fh:
            fh.write(" \n")
        try:
            load_key(empty)
            raise AssertionError("empty key file must fail closed")
        except SystemExit:
            pass
        good = os.path.join(tmp, "good.key")
        with open(good, "w", encoding="utf-8") as fh:
            fh.write("k1\n")
        assert load_key(good) == "k1"
    class _Resp:
        def __init__(self, body): self.body = body
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n):
            out, self.body = self.body[:n], self.body[n:]
            return out

    def opener(script):
        calls = []
        def open_fn(request, timeout):
            calls.append(timeout)
            step = script[len(calls) - 1]
            if isinstance(step, Exception): raise step
            return _Resp(step)
        return open_fn, calls

    err = lambda code: urllib.error.HTTPError("u", code, "x", None, None)
    fn, calls = opener([err(502), b"<rss>ok</rss>"])
    assert fetch_upstream("https://news.google.com/rss/search?q=x", fn, may_retry=lambda: True) == (b"<rss>ok</rss>", "") and calls == [4, 3]
    fn, calls = opener([TimeoutError(), b"<rss/>"])
    assert fetch_upstream("https://news.google.com/rss/search?q=x", fn, may_retry=lambda: True)[0] == b"<rss/>"
    fn, calls = opener([err(404)])
    assert fetch_upstream("https://news.google.com/rss/search?q=x", fn, may_retry=lambda: True) == (None, "HTTP 404") and calls == [4]
    fn, calls = opener([err(503), err(503)])
    assert fetch_upstream("https://news.google.com/rss/search?q=x", fn, may_retry=lambda: True) == (None, "HTTP 503") and calls == [4, 3]
    fn, calls = opener([err(429), b"<rss/>"])
    assert fetch_upstream("https://news.google.com/rss/search?q=x", fn, may_retry=lambda: True) == (None, "HTTP 429") and calls == [4]
    fn, calls = opener([err(502), b"<rss/>"])
    body, why = fetch_upstream("https://news.google.com/rss/search?q=x", fn, may_retry=lambda: False)
    assert body is None and "retry skipped" in why and calls == [4]
    fn, calls = opener([b"<html>", b"<html>"])
    assert fetch_upstream("https://news.google.com/rss/search?q=x", fn, may_retry=lambda: True) == (None, "not rss")
    class _Drip:
        def __init__(self): self.n = 0
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n):
            self.n += 1
            return b"<rss>" if self.n == 1 else b"x"
    fake_now = [0.0]
    def drip_open(request, timeout): return _Drip()
    def fake_clock():
        fake_now[0] += 0.5  # 每次讀取耗 0.5 秒（慢速滴流）
        return fake_now[0]
    body, why = fetch_upstream("https://news.google.com/rss/search?q=x", drip_open, may_retry=lambda: True, budget=7.0, clock=fake_clock)
    # 假時鐘每次被呼叫都前進 0.5 秒（含期限計算），所以只驗證：逾期中止、且沒有進入重試
    assert body is None and why.startswith("TimeoutError") and "deadline" in why, (why, fake_now[0])
    print("self-test ok")


RELAY_KEY = load_key()

if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
