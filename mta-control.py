#!/usr/bin/env python3
import hmac
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "0.0.0.0"
PORT = int(os.environ.get("MTA_CONTROL_PORT", "10026"))
SECRET = os.environ.get("MTA_CONTROL_SECRET") or os.environ.get("BOUNCE_SECRET") or ""
QUEUE_ID = re.compile(r"^[A-F0-9]{5,32}$", re.I)


def queue_contains(queue_id: str) -> bool:
    result = subprocess.run(["postqueue", "-p"], capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "postqueue failed")[:500])
    return re.search(rf"(?m)^{re.escape(queue_id)}[*!]?\s", result.stdout) is not None


class Handler(BaseHTTPRequestHandler):
    server_version = "NexiMailMtaControl/1.0"

    def log_message(self, fmt, *args):
        print("[mta-control] " + (fmt % args), flush=True)

    def send_json(self, status: int, payload: dict):
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self) -> bool:
        if not SECRET:
            return False
        supplied = self.headers.get("X-NexiMail-Token", "")
        return hmac.compare_digest(supplied, SECRET)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, "control": bool(SECRET)})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/queue/delete":
            self.send_json(404, {"error": "not_found"})
            return
        if not self.authorized():
            self.send_json(401, {"error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 4096:
            self.send_json(400, {"error": "invalid_body"})
            return

        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.send_json(400, {"error": "invalid_json"})
            return

        queue_id = str(body.get("queueId", "")).strip().upper()
        if not QUEUE_ID.fullmatch(queue_id):
            self.send_json(400, {"error": "invalid_queue_id"})
            return

        try:
            if not queue_contains(queue_id):
                self.send_json(404, {"ok": True, "deleted": False, "reason": "not_found"})
                return
            result = subprocess.run(["postsuper", "-d", queue_id], capture_output=True, text=True, timeout=15)
            output = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
            if result.returncode != 0:
                self.send_json(500, {"ok": False, "deleted": False, "error": output[:1000] or "postsuper_failed"})
                return
            self.send_json(200, {"ok": True, "deleted": True, "queueId": queue_id, "detail": output[:1000]})
        except Exception as exc:
            self.send_json(500, {"ok": False, "deleted": False, "error": str(exc)[:1000]})


if __name__ == "__main__":
    if not SECRET:
        print("[mta-control] disabled: MTA_CONTROL_SECRET/BOUNCE_SECRET not configured", flush=True)
    else:
        print(f"[mta-control] listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
