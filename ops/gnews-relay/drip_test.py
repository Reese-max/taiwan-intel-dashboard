"""Real-time timing checks (local only): fetch_upstream must return within the Worker's 8 s limit
however the upstream stalls. Usage: python -I drip_test.py proxy.py"""
import importlib.util
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("proxy", sys.argv[1])
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/drip":  # one byte every 0.5 s
            body = b"<rss>" + b"x" * 40
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            for byte in body:
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
                time.sleep(0.5)
        elif self.path == "/stall":  # slow headers, then a body that never arrives
            time.sleep(3.9)
            self.send_response(200)
            self.send_header("Content-Length", "1")
            self.end_headers()
            self.wfile.flush()
            time.sleep(12)
        else:
            body = b"<rss>ok</rss>"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, *a):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_address[1]}"


def slow_open(request, timeout):  # the caller itself is slow before connecting
    time.sleep(3.0)
    return urllib.request.urlopen(request, timeout=timeout)


for name, path, open_fn, want_body in [
    ("normal", "/ok", None, True),
    ("drip", "/drip", None, False),
    ("stall+slow-open", "/stall", slow_open, False),
]:
    start = time.monotonic()
    body, why = proxy.fetch_upstream(base + path, open_fn=open_fn, may_retry=lambda: True)
    elapsed = time.monotonic() - start
    print(f"{name}: elapsed={elapsed:.2f}s body={'yes' if body else 'no'} reason={why or '-'}")
    assert elapsed < 8.0, f"{name} exceeded the Worker's 8 s limit"
    assert bool(body) == want_body, name
print("drip test ok")
server.shutdown()
