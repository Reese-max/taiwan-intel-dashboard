"""Real-time slow-drip check: upstream sends one byte every 0.5 s; fetch_upstream must give up within ~7.5 s."""
import importlib.util
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("proxy", sys.argv[1])
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class Drip(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"<rss>" + b"x" * 40
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        for byte in body:
            self.wfile.write(bytes([byte]))
            self.wfile.flush()
            time.sleep(0.5)

    def log_message(self, *a):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Drip)
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/rss"
start = time.monotonic()
body, why = proxy.fetch_upstream(url, may_retry=lambda: True)
elapsed = time.monotonic() - start
print(f"elapsed={elapsed:.2f}s body={'yes' if body else 'no'} reason={why}")
assert body is None and elapsed < 8.0, "must abort before the Worker's 8 s limit"
print("drip test ok")
server.shutdown()
