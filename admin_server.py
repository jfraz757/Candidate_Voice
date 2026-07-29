"""
Minimal local-only static file server for admin.html and its assets, so it can be
accessed at http://localhost:8766/admin.html instead of a raw file:// path.

This exists because the taskbar badge feature (navigator.setAppBadge) and the service
worker it depends on both require a "secure context" -- https:// or localhost -- and
explicitly do NOT work over file://. Binds to 127.0.0.1 only, never exposed externally.

Meant to run persistently (e.g. via Task Scheduler at login) so admin.html is always
reachable without the user needing to manually start anything.
"""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path(__file__).parent
PORT = 8766

# Binding to 127.0.0.1 stops remote machines connecting, but it does NOT stop a web page
# you happen to be visiting from making requests to this port -- the browser is on this
# machine, so localhost resolves fine from its perspective. That is DNS rebinding: an
# attacker's page points a hostname it controls at 127.0.0.1, the browser sends the request
# here with Host: attacker.tld, and a server that ignores Host serves it happily.
#
# This directory contains admin.html, which holds the service role key. So the whole
# database is one unguarded GET away. Same-origin policy is not a defense here: with a
# rebound hostname the browser believes it IS the same origin, so it will read the response.
#
# Only these Host values are legitimate for a loopback-only server. A rebound request
# carries the attacker's hostname instead and gets rejected before any file is read.
ALLOWED_HOSTS = {
    f"localhost:{PORT}",
    f"127.0.0.1:{PORT}",
    f"[::1]:{PORT}",
    # Bare forms, in case a client omits the port.
    "localhost",
    "127.0.0.1",
    "[::1]",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def _host_ok(self):
        """Reject anything whose Host header is not a loopback name (DNS rebinding guard)."""
        host = (self.headers.get("Host") or "").strip().lower()
        if host in ALLOWED_HOSTS:
            return True
        self.send_error(421, "Misdirected Request")  # 421 is the correct code for a bad Host
        return False

    # Every verb must be gated, not just GET -- HEAD leaks existence and size, and a future
    # handler added without this check would silently reopen the hole.
    def do_GET(self):
        if self._host_ok():
            super().do_GET()

    def do_HEAD(self):
        if self._host_ok():
            super().do_HEAD()

    def end_headers(self):
        # Nothing served from here should ever be cached by, or embedded in, anything else.
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass  # keep stdout quiet


def run():
    # ThreadingHTTPServer, not plain HTTPServer -- the single-threaded version can get
    # stuck handling one connection (e.g. a lingering keep-alive) and block every other
    # request until it times out. Confirmed 2026-07-25: this caused the server to stop
    # responding entirely shortly after the first successful requests.
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving {BASE_DIR} on http://localhost:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    run()
