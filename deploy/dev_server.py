"""Local preview of the portal and Assistants hub, laid out as in production.

    python deploy/dev_server.py            -> http://localhost:8080/aiportal/

Serves this folder at /aiportal/ and proxies each assistant like deploy/nginx-assistants.conf does,
streaming responses through so answers arrive token by token. Start the assistant apps first
(Research on :8000, Policy on :8020, Staff Handbook on :8030); any that aren't running show as
"not available" in the hub. Teag-Ask's API is expected on :8040.
"""

import http.client
import http.server
import os
import sys
from urllib.parse import urlsplit

PORTAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = "/aiportal/"
UPSTREAMS = {
    "/aiportal/assistants/research/": "http://127.0.0.1:8000/",
    "/aiportal/assistants/policy/": "http://127.0.0.1:8020/",
    "/aiportal/assistants/handbook/": "http://127.0.0.1:8030/",
    "/aiportal/teagask/api/": "http://127.0.0.1:8040/api/",
}
HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PORTAL_DIR, **kwargs)

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()

    def route(self):
        for prefix, upstream in UPSTREAMS.items():
            if self.path.rstrip("/") == prefix.rstrip("/") and not self.path.endswith("/"):
                return self.redirect(prefix)
            if self.path.startswith(prefix):
                return self.proxy(upstream, self.path[len(prefix):])
        if self.path == "/" or self.path + "/" == PREFIX:
            return self.redirect(PREFIX)
        if not self.path.startswith(PREFIX) or self.command != "GET":
            return self.send_error(404)
        self.path = "/" + self.path[len(PREFIX):]
        super().do_GET()

    def end_headers(self):
        # Like production (see nginx-assistants.conf): browsers re-check files, so updates show at once.
        if not self.path.startswith(tuple(UPSTREAMS)):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def redirect(self, location):
        self.send_response(301)
        self.send_header("Location", location)
        self.end_headers()

    def proxy(self, upstream, rest):
        target = urlsplit(upstream)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_HEADERS}
        Connection = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
        conn = Connection(target.netloc, timeout=300)
        try:
            conn.request(self.command, target.path + rest, body=body, headers=headers)
            resp = conn.getresponse()
        except OSError as exc:
            return self.send_error(502, f"Assistant not reachable at {target.netloc}: {exc}")
        self.send_response(resp.status)
        for key, value in resp.getheaders():
            if key.lower() not in HOP_HEADERS:
                self.send_header(key, value)
        self.send_header("Connection", "close")
        self.end_headers()
        while chunk := resp.read1(8192):
            self.wfile.write(chunk)
            self.wfile.flush()
        conn.close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Portal: http://localhost:{port}{PREFIX}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
