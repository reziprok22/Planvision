#!/usr/bin/env python3
"""
Lasttest für Planvision-Analyse (CPU-intensiv) – nur Standardbibliothek.

Misst, wie sich /analyze_page unter parallelen Anfragen verhält: Latenzen,
Erfolg/Fehler, Timeouts. Damit lässt sich vor dem Beta-Launch abschätzen, ob ein
CX22 (2 vCPU / 4 GB) reicht.

WICHTIG: Auf dem ZIEL-Server laufen lassen (oder gegen dessen URL), nicht auf dem
Dev-Rechner mit GPU – nur die CPU-Zeiten des CX22 sind aussagekräftig. Ideal vom
Server selbst gegen http://127.0.0.1:8000 (bzw. den gunicorn-Socket/Port), damit
das Netz nicht mitmisst.

Ablauf:
  1. GET /app/        -> holt das csrftoken-Cookie
  2. POST /upload     -> lädt einmal eine Test-PDF hoch, bekommt session_id
  3. N x POST /analyze_page mit Parallelität C -> misst die Analyse unter Last

Aufruf:
  python scripts/loadtest.py --url http://127.0.0.1:8000 --pdf plan.pdf -n 12 -c 3
  python scripts/loadtest.py --url https://planli.net --pdf plan.pdf -n 20 -c 5 --page 1

Begleitend auf dem Server beobachten (zweites Terminal):
  watch -n1 'free -m; echo; ps -C gunicorn -o pid,rss,%cpu,cmd --no-headers'
"""

import argparse
import json
import sys
import time
import uuid
import http.cookiejar
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from statistics import median


def build_opener():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    return opener, jar


def get_cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return None


def cookie_header(jar):
    return "; ".join(f"{c.name}={c.value}" for c in jar)


def encode_multipart(fields, file_field, filename, file_bytes, content_type):
    boundary = "----planvision" + uuid.uuid4().hex
    nl = b"\r\n"
    body = b""
    for k, v in fields.items():
        body += b"--" + boundary.encode() + nl
        body += f'Content-Disposition: form-data; name="{k}"'.encode() + nl + nl
        body += str(v).encode() + nl
    body += b"--" + boundary.encode() + nl
    body += (f'Content-Disposition: form-data; name="{file_field}"; '
             f'filename="{filename}"').encode() + nl
    body += f"Content-Type: {content_type}".encode() + nl + nl
    body += file_bytes + nl
    body += b"--" + boundary.encode() + b"--" + nl
    return body, f"multipart/form-data; boundary={boundary}"


def main():
    ap = argparse.ArgumentParser(description="Lasttest für /analyze_page")
    ap.add_argument("--url", required=True, help="Basis-URL, z.B. http://127.0.0.1:8000")
    ap.add_argument("--pdf", required=True, help="Pfad zur Test-PDF (wird einmal hochgeladen)")
    ap.add_argument("-n", "--requests", type=int, default=12, help="Anzahl Analyse-Requests gesamt")
    ap.add_argument("-c", "--concurrency", type=int, default=3, help="parallele Requests")
    ap.add_argument("--page", type=int, default=1, help="welche Seite analysieren")
    ap.add_argument("--plan-scale", type=float, default=100)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--timeout", type=float, default=310,
                    help="Request-Timeout in s (knapp über gunicorn 300, um Timeouts zu sehen)")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    opener, jar = build_opener()

    # 1) csrftoken holen
    opener.open(base + "/app/", timeout=30).read()
    csrf = get_cookie(jar, "csrftoken")
    if not csrf:
        print("FEHLER: kein csrftoken-Cookie von /app/ erhalten.", file=sys.stderr)
        sys.exit(1)

    # 2) PDF einmal hochladen -> session_id
    with open(args.pdf, "rb") as f:
        pdf_bytes = f.read()
    body, ctype = encode_multipart({}, "file", args.pdf.split("/")[-1], pdf_bytes, "application/pdf")
    req = urllib.request.Request(base + "/upload", data=body, method="POST")
    req.add_header("Content-Type", ctype)
    req.add_header("X-CSRFToken", csrf)
    # Über HTTPS prüft Django CSRF zusätzlich Origin/Referer gegen CSRF_TRUSTED_ORIGINS
    # – ohne diese Header gibt es 403, obwohl der Token stimmt.
    req.add_header("Origin", base)
    req.add_header("Referer", base + "/app/")
    up = json.loads(opener.open(req, timeout=120).read())
    session_id = up["session_id"]
    page_count = up.get("page_count", 1)
    print(f"Upload ok: session={session_id}, Seiten={page_count}")
    page = min(args.page, page_count)

    # Cookies + csrf für die parallelen Threads einmal einfrieren (thread-safe ohne shared opener)
    cookies = cookie_header(jar)
    headers = {"Cookie": cookies, "X-CSRFToken": csrf,
               "Content-Type": "application/x-www-form-urlencoded",
               "Origin": base, "Referer": base + "/app/"}
    payload = urllib.parse.urlencode({
        "session_id": session_id, "page": page,
        "format_width": 210, "format_height": 297, "dpi": 150,
        "plan_scale": args.plan_scale, "threshold": args.threshold,
    }).encode()

    def one_call(i):
        t0 = time.perf_counter()
        req = urllib.request.Request(base + "/analyze_page", data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=args.timeout) as r:
                data = json.loads(r.read())
            dt = time.perf_counter() - t0
            return ("ok", dt, data.get("count"))
        except urllib.error.HTTPError as e:
            return (f"HTTP {e.code}", time.perf_counter() - t0, None)
        except Exception as e:
            return (f"{type(e).__name__}", time.perf_counter() - t0, None)

    print(f"Starte {args.requests} Analysen, Parallelität {args.concurrency}, Seite {page} …\n")
    results = []
    wall0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = {ex.submit(one_call, i): i for i in range(args.requests)}
        for fut in as_completed(futs):
            status, dt, count = fut.result()
            results.append((status, dt))
            mark = "✓" if status == "ok" else "✗"
            print(f"  {mark} {status:<14} {dt:6.1f}s  Objekte={count}")
    wall = time.perf_counter() - wall0

    oks = [dt for s, dt in results if s == "ok"]
    fails = [s for s, _ in results if s != "ok"]
    print("\n── Ergebnis ─────────────────────────────────────────────")
    print(f"Erfolgreich: {len(oks)}/{len(results)}   Fehler: {len(fails)}")
    if fails:
        from collections import Counter
        print("Fehlerarten:", dict(Counter(fails)))
    if oks:
        oks.sort()
        p90 = oks[min(len(oks) - 1, int(len(oks) * 0.9))]
        print(f"Analyse-Latenz (s): min {oks[0]:.1f}  median {median(oks):.1f}  "
              f"p90 {p90:.1f}  max {oks[-1]:.1f}")
    print(f"Gesamtdauer: {wall:.1f}s   Durchsatz: {len(oks)/wall:.2f} Analysen/s")
    if any(s.startswith(("HTTP 502", "HTTP 504")) or s == "URLError" for s in fails):
        print("\n⚠ Timeouts/502/504 aufgetreten -> gunicorn-Timeout gerissen oder Worker überlastet.")


if __name__ == "__main__":
    main()
