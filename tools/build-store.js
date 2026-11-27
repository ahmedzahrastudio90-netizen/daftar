// Renders app icons, Google Play icon, feature graphic and phone screenshots.
// Usage: node tools/build-store.js   (needs Playwright + Chromium)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.dirname(__dirname);
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, "brand/brand.json"), "utf8"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
const iso = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10); };
const t = Date.now();
const DEMO = {
  d1: { id: "d1", client: "مطعم الريحان", phone: "01012345678", title: "لوجو وهوية بصرية", types: ["لوجو", "هوية بصرية"], type: "لوجو + هوية بصرية", status: "work", price: 6000, currency: "EGP", payments: [{ amount: 3000, date: iso(-8), note: "عربون - إنستاباي" }, { amount: 1500, date: iso(0), note: "إنستاباي", received: false }], start: iso(-8), due: iso(2), finish: iso(1), revisions: 2, notes: "3 اقتراحات لوجو + دليل ألوان وخطوط", updatedAt: t },
  d2: { id: "d2", client: "Khalid Store", phone: "", title: "حملة سوشيال ديسمبر", types: ["سوشيال ميديا"], type: "سوشيال ميديا", status: "review", price: 1200, currency: "SAR", payments: [{ amount: 600, date: iso(-5), note: "تحويل بنكي", rate: 13.2, rateBase: "EGP" }], start: iso(-5), due: iso(-1), finish: iso(-2), notes: "12 بوست + 4 ستوري", updatedAt: t },
  d3: { id: "d3", client: "Nova Agency", phone: "", title: "لاندينج بيدج", types: ["UI / UX"], type: "UI / UX", status: "done", price: 450, currency: "USD", payments: [{ amount: 450, date: iso(-12), note: "PayPal", rate: 49.6, rateBase: "EGP" }], start: iso(-25), due: iso(-12), delivered: iso(-12), updatedAt: t },
  d4: { id: "d4", client: "كافيه بُن", phone: "01198765432", title: "منيو وتغليف", types: ["مطبوعات", "تغليف"], type: "مطبوعات + تغليف", status: "work", price: 3500, currency: "EGP", payments: [{ amount: 1000, date: iso(-3), note: "فودافون كاش" }], start: iso(-3), due: iso(6), finish: iso(5), updatedAt: t },
  d5: { id: "d5", client: "مطعم الريحان", phone: "01012345678", title: "منيو", types: ["مطبوعات"], type: "مطبوعات", status: "done", price: 1500, currency: "EGP", payments: [{ amount: 1500, date: iso(-40), note: "نقدي" }], start: iso(-48), due: iso(-40), delivered: iso(-40), updatedAt: t },
};
const SETTINGS = { currency: "EGP", myName: "Ahmed", rates: { base: "EGP", at: t, map: { USD: 50.1, SAR: 13.35, AED: 13.64, KWD: 163.2, EUR: 54.2 } } };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = "http://localhost:" + server.address().port + "/";
  const b = await chromium.launch();
  const svg = fs.readFileSync(path.join(ROOT, "icons/icon.svg"), "utf8");
  const page = await b.newPage();
  // square = full-bleed (Play Store and Android "maskable" icons get their corners from the system)
  const shotSvg = async (file, size, square) => {
    await page.setViewportSize({ width: size, height: size });
    const inner = (square ? svg.replace(/rx="112"/, 'rx="0"') : svg).replace("<svg ", '<svg width="100%" height="100%" ');
    await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${inner}</div></body>`);
    await page.screenshot({ path: path.join(ROOT, file), omitBackground: !square });
  };
  await shotSvg("icons/icon-192.png", 192); await shotSvg("icons/icon-512.png", 512); await shotSvg("icons/icon-maskable-512.png", 512, true);
  await shotSvg("store/icon-512.png", 512, true);

  // feature graphic 1024x500
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.setContent(`<meta charset="utf-8"><body style="margin:0"><div style="width:1024px;height:500px;direction:rtl;display:flex;align-items:center;gap:48px;padding:0 72px;box-sizing:border-box;color:#fff;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;
    background:radial-gradient(60% 80% at 100% 0%,rgba(6,182,212,.35),transparent 60%),radial-gradient(60% 80% at 0% 100%,rgba(124,58,237,.45),transparent 60%),linear-gradient(135deg,#0B1424,#16244A 55%,#2A1A5E)">
    <div style="width:220px;height:220px;flex:none;filter:drop-shadow(0 18px 40px rgba(0,0,0,.45))">${svg.replace("<svg ", '<svg width="220" height="220" ')}</div>
    <div><div style="font-size:64px;font-weight:700;line-height:1.15">${brand.name}</div>
    <div style="font-size:28px;opacity:.85;margin-top:10px">${brand.tagline}</div>
    <div style="display:flex;gap:10px;margin-top:26px;font-size:18px">${["يعمل بدون إنترنت", "أكثر من عملة", "من واتساب مباشرة"].map((x) => `<span style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 16px">${x}</span>`).join("")}</div></div></div></body>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ROOT, "store/feature-graphic.png") });

  // phone screenshots 1080x2160
  const ctx = await b.newContext({ viewport: { width: 360, height: 720 }, deviceScaleFactor: 3, colorScheme: "light", serviceWorkers: "block" });
  const p = await ctx.newPage();
  await p.goto(base); await p.evaluate(([j, s]) => { localStorage.setItem("ledger.jobs", JSON.stringify(j)); localStorage.setItem("ledger.settings", JSON.stringify(s)); }, [DEMO, SETTINGS]);
  await p.goto(base + "#home"); await p.reload(); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(ROOT, "store/screenshot-1.png") });
  await p.locator(".tabbar button").nth(1).click(); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(ROOT, "store/screenshot-2.png") });
  await p.locator(".mbar [data-wa]").click(); await p.waitForTimeout(200);
  await p.fill("#waText", `27/11/2026, 3:15 PM - محمد سامي: عايز لوجو وهوية لمحل ورد
27/11/2026, 3:16 PM - Ahmed: تمام السعر 2500 جنيه و3 تعديلات
27/11/2026, 3:20 PM - محمد سامي: حولتلك 800 عربون إنستاباي، ومحتاجه يوم الخميس`);
  await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(ROOT, "store/screenshot-3.png") });
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  await p.locator(".jrow").first().click(); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(ROOT, "store/screenshot-4.png") });
  await b.close(); server.close();
  console.log("store assets ready");
})();
