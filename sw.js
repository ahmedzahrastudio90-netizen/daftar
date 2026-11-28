/* Offline cache, WhatsApp share target, and a best-effort daily reminder. */
const VERSION = "ledger-v32";
const SHELL = ["./", "index.html", "app.js?v=32", "parser.js?v=32", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", "fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", "fonts/ibm-plex-sans-arabic-latin-400-normal.woff2",
  "fonts/ibm-plex-sans-arabic-latin-600-normal.woff2", "fonts/readex-pro-arabic-600-normal.woff2", "fonts/readex-pro-latin-600-normal.woff2", "fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2", "lib/qrcode.js"];

self.addEventListener("install", (e) => {
  // "reload" skips the browser's HTTP cache, so a new version never mixes with old files
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ledger-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Share target: WhatsApp → Share → دفتر المصمم
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const inbox = await caches.open("share-inbox");
      const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n");
      if (text) await inbox.put("text", new Response(text));
      let i = 0;
      for (const f of form.getAll("files")) {
        if (f && typeof f === "object") await inbox.put("file" + i++, new Response(f, { headers: { "content-type": f.type || "", "x-name": encodeURIComponent(f.name || "chat.txt") } }));
      }
      return Response.redirect("./?share=1#home", 303);
    })());
    return;
  }
  if (e.request.method !== "GET") return;

  // Google Fonts: cache after first use so the app looks the same offline
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION + "-fonts").then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try { const res = await fetch(e.request); if (res.ok || res.type === "opaque") c.put(e.request, res.clone()); return res; } catch (err) { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // App files: open instantly from the phone; refresh in the background for next time
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const isPage = e.request.mode === "navigate";
    const hit = isPage ? (await cache.match("./")) || (await cache.match("index.html")) : await cache.match(e.request);
    const net = fetch(url.href, { cache: "no-cache", credentials: "same-origin" })
      .then((res) => { if (res.ok && !res.redirected) cache.put(isPage ? "./" : e.request, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (await cache.match("./")) || Response.error();
  })());
});

// Background check (Chrome on Android/desktop for installed apps; the browser decides the exact time)
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "due-check") e.waitUntil(checkDue());
});
async function checkDue() {
  const c = await caches.open("reminders");
  const snap = await c.match("snapshot"), daysRes = await c.match("days"), last = await c.match("last");
  if (!snap) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const key = today.toISOString().slice(0, 10);
  if (last && (await last.text()) === key) return;
  const days = Number(daysRes ? await daysRes.text() : 7) || 7;
  const meetRes = await c.match("meetings");
  const kOf = (ds) => { const [y, m, d] = String(ds).split("-").map(Number); return Math.round((new Date(y, m - 1, d) - today) / 86400000); };
  const word = (k) => (k === 1 ? "يوم" : k === 2 ? "يومين" : k + " أيام");
  const left = (k) => (k === 0 ? "النهارده" : k === 1 ? "بكرة" : k === 2 ? "بعد بكرة" : "باقي " + word(k));
  const meets = meetRes ? (await meetRes.json()).map((m) => ({ ...m, k: kOf(m.date) })).filter((m) => m.k >= 0 && m.k <= days) : [];
  const list = (await snap.json()).map((j) => ({ ...j, k: kOf(j.due) })).filter((j) => j.k <= days);
  if (!list.length && !meets.length) return;
  const lines = meets.map((m) => ({ at: m.date + (m.time || "99"), t: (m.k <= 1 ? left(m.k) + (m.time ? " " + m.time : "") + ": " : "") + (m.title || "ميتنج") + (m.client ? " — " + m.client : "") + (m.k > 1 ? " · " + left(m.k) : "") }))
    .concat(list.map((j) => ({ at: j.due + "00", t: "تسليم «" + j.title + "»" + (j.client ? " — " + j.client : "") + " · " + (j.k < 0 ? "متأخر " + word(-j.k) + "! خلصته؟" : j.k === 0 ? "النهارده! جاهز؟" : j.k === 1 ? "بكرة. خلصت الشغل؟" : left(j.k) + ". ماشي فيه؟") })))
    .sort((a, b) => a.at.localeCompare(b.at)).slice(0, 6).map((x) => "• " + x.t);
  await self.registration.showNotification("فكّرتك 🔔", { body: lines.join("\n"), tag: "due-today", icon: "icons/icon-192.png", badge: "icons/icon-192.png", dir: "rtl", lang: "ar" });
  if (self.navigator.setAppBadge) self.navigator.setAppBadge(lines.length).catch(() => {});
  await c.put("last", new Response(key));
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((ws) => {
    for (const w of ws) if ("focus" in w) { w.navigate("./#home"); return w.focus(); }
    return self.clients.openWindow("./#home");
  }));
});
