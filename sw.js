/* Offline cache, WhatsApp share target, and a best-effort daily reminder. */
const VERSION = "ledger-v6";
const SHELL = ["./", "index.html", "app.js", "parser.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // App files: network first (so updates arrive), cache when offline
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(VERSION)).put(e.request, res.clone());
      return res;
    } catch (err) {
      return (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match("index.html"));
    }
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
  const days = Number(daysRes ? await daysRes.text() : 3) || 3;
  const list = (await snap.json()).map((j) => {
    const [y, m, d] = j.due.split("-").map(Number);
    return { ...j, k: Math.round((new Date(y, m - 1, d) - today) / 86400000) };
  }).filter((j) => j.k <= days).sort((a, b) => a.k - b.k);
  if (!list.length) return;
  const word = (k) => (k === 1 ? "يوم" : k === 2 ? "يومين" : k + " أيام");
  const line = (j) => (j.k < 0 ? "متأخر " + word(-j.k) : j.k === 0 ? "التسليم اليوم" : j.k === 1 ? "التسليم غداً" : "متبقٍ " + word(j.k)) + ": " + j.title + (j.client ? " — " + j.client : "");
  await self.registration.showNotification("مواعيد تسليم قريبة", { body: list.slice(0, 4).map(line).join("\n"), tag: "due-today", icon: "icons/icon-192.png", badge: "icons/icon-192.png", dir: "rtl", lang: "ar" });
  if (self.navigator.setAppBadge) self.navigator.setAppBadge(list.length).catch(() => {});
  await c.put("last", new Response(key));
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((ws) => {
    for (const w of ws) if ("focus" in w) { w.navigate("./#jobs"); return w.focus(); }
    return self.clients.openWindow("./#jobs");
  }));
});
