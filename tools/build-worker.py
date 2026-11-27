#!/usr/bin/env python3
"""Bundle the app into one Cloudflare Worker script: dist/worker.js"""
import base64, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["index.html", "app.js", "parser.js", "sw.js", "manifest.webmanifest", "privacy.html", "google-sheet-script.gs",
         "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", ".well-known/assetlinks.json"]
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json",
         ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".gs": "text/plain; charset=utf-8"}
assets = {}
for f in FILES:
    data = open(os.path.join(ROOT, f), "rb").read()
    ext = os.path.splitext(f)[1]
    text = not ext == ".png"
    assets["/" + f] = {"t": TYPES[ext], "b": data.decode("utf-8") if text else base64.b64encode(data).decode(), "bin": not text}
worker = """const A = %s;
const SEC = {"x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-frame-options":"DENY","permissions-policy":"camera=(), microphone=(), geolocation=()"};
const bin = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export default {
  async fetch(req) {
    const url = new URL(req.url);
    let p = url.pathname;
    if (p === "/" ) p = "/index.html";
    if (req.method === "POST" && p === "/share-target") return Response.redirect(url.origin + "/?share=1#home", 303);
    const a = A[p];
    if (!a) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    const cache = p === "/sw.js" || p.endsWith(".html") || p.endsWith(".webmanifest") ? "no-cache" : "public, max-age=3600";
    const headers = { "content-type": a.t, "cache-control": cache, ...SEC };
    if (p === "/sw.js") headers["service-worker-allowed"] = "/";
    if (p.startsWith("/.well-known/")) headers["access-control-allow-origin"] = "*";
    return new Response(a.bin ? bin(a.b) : a.b, { headers });
  },
};
""" % json.dumps(assets, ensure_ascii=False)
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
open(os.path.join(ROOT, "dist/worker.js"), "w", encoding="utf-8").write(worker)
print("dist/worker.js", round(len(worker.encode()) / 1024), "KB")
