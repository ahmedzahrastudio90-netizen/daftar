/* دفتر المصمم — standalone app. Data lives on the device (localStorage) and syncs to the user's Google Sheet when online. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ---------- constants ----------
  const STATUS = {
    new:{t:"لم يبدأ",c:"st-new"}, work:{t:"قيد التنفيذ",c:"st-work"}, review:{t:"قيد مراجعة العميل",c:"st-review"},
    done:{t:"تم التسليم",c:"st-done"}, cancel:{t:"ملغي",c:"st-cancel"}
  };
  const CUR = {EGP:"ج.م", USD:"$", SAR:"ر.س", AED:"د.إ", KWD:"د.ك", EUR:"€"};
  const CUR_NAME = {EGP:"جنيه مصري", USD:"دولار", SAR:"ريال سعودي", AED:"درهم إماراتي", KWD:"دينار كويتي", EUR:"يورو"};
  const TYPES = ["لوجو","هوية بصرية","سوشيال ميديا","مطبوعات","تغليف","تايبوجرافي","استراتيجية","UI / UX","موشن","إليستريشن","أخرى"];
  const VIEWS = [["home","الرئيسية","i-home"],["jobs","المشاريع","i-jobs"],["money","الحسابات","i-pay"],["settings","الإعدادات","i-gear"]];
  const FILTERS = [["active","الجارية"],["late","متأخر"],["unpaid","مستحقات"],["done","مُسلَّمة"],["all","الكل"]];
  const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const DAYS = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

  // ---------- storage ----------
  const LS = {get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
              set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
  let all = LS.get("ledger.jobs", {});           // id -> job (incl. deleted tombstones)
  const settings = Object.assign({currency:"EGP", myName:"", sheetUrl:"", token:"", lastSync:0, lastBackup:"", remindDays:3, lastNotify:"",
    hideMoney:false, hideOnOpen:false, splash:"daily", lastSplashDay:"", zakatMode:"zakat", zakatRate:2.5, lock:{on:false}, lockAfter:0, altCur:"USD"}, LS.get("ledger.settings", {}));
  if (settings.hideOnOpen) settings.hideMoney = true;
  const saveSettings = () => LS.set("ledger.settings", settings);
  function persist(){ if (!LS.set("ledger.jobs", all)) toast("مساحة التخزين على الجهاز ممتلئة. نزّل نسخة احتياطية واحذف مشاريع قديمة."); }
  let jobs = [], expenses = [], gives = [];
  const refreshJobs = () => {
    const v = Object.values(all).filter(j => j && !j.deleted);
    jobs = v.filter(j => !j.kind); expenses = v.filter(j => j.kind === "expense"); gives = v.filter(j => j.kind === "give");
  };
  refreshJobs();

  let view = VIEWS.some(v=>v[0]===location.hash.slice(1)) ? location.hash.slice(1) : "home";
  let filter = LS.get("ledger.filter","active"), query = "", jobsTab = "projects";

  // ---------- helpers ----------
  function h(tag, attrs, ...kids){
    const el = document.createElement(tag);
    if (attrs) for (const [k,v] of Object.entries(attrs)){
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()){ if (c == null || c === false) continue; el.append(c instanceof Node ? c : String(c)); }
    return el;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function icon(id, cls){ const s = document.createElementNS(SVGNS,"svg"); if (cls) s.setAttribute("class",cls); s.setAttribute("aria-hidden","true"); const u = document.createElementNS(SVGNS,"use"); u.setAttribute("href","#"+id); s.append(u); return s; }
  const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
  const fmt = (v) => n(v).toLocaleString("en-US",{maximumFractionDigits:2});
  const rawFmt = (v) => n(v).toLocaleString("en-US",{maximumFractionDigits:2});
  const curOf = (j) => CUR[j && j.currency] ? j.currency : settings.currency;
  const money = (v, cur) => fmt(v) + " " + CUR[cur || settings.currency];
  const iso = (d) => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const todayStr = () => iso(new Date());
  const parseD = (s) => { if(!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
  const addDays = (s, k) => { const d = parseD(s) || parseD(todayStr()); d.setDate(d.getDate()+k); return iso(d); };
  const daysUntil = (s) => { const d = parseD(s); if(!d) return null; return Math.round((d - parseD(todayStr()))/86400000); };
  const dshort = (s) => { const d = parseD(s); return d ? d.getDate()+" "+MONTHS[d.getMonth()] : "—"; };
  const dlong = (s) => { const d = parseD(s); return d ? DAYS[d.getDay()]+" "+d.getDate()+" "+MONTHS[d.getMonth()] : "—"; };
  const paysOf = (j) => Array.isArray(j.payments) ? j.payments : [];
  const isRecv = (p) => p.received !== false;
  const recvDate = (p) => p.recvDate || p.date || "";
  const paidOf = (j) => paysOf(j).reduce((a,p)=>a+n(p.amount),0);
  const remOf = (j) => j.status === "cancel" ? 0 : Math.max(0, n(j.price) - paidOf(j));
  const isOpen = (j) => j.status !== "done" && j.status !== "cancel";
  // next thing to deliver: first unfinished phase, else the final delivery
  const phasesOf = (j) => Array.isArray(j.phases) ? j.phases : [];
  function nextDue(j){
    const p = phasesOf(j).filter(x => !x.done && x.due).sort((a,b) => a.due.localeCompare(b.due))[0];
    return p ? {date:p.due, label:p.title || "مرحلة"} : {date:j.due || "", label:""};
  }
  const isLate = (j) => { const d = nextDue(j).date; return isOpen(j) && !!d && daysUntil(d) < 0; };
  const meetingsOf = (j) => Array.isArray(j.meetings) ? j.meetings : [];
  function fmtTime(t){ if (!/^\d{1,2}:\d{2}$/.test(t||"")) return ""; let [hh,mm] = t.split(":").map(Number); const pm = hh >= 12; hh = hh % 12 || 12; return hh + ":" + String(mm).padStart(2,"0") + (pm ? " م" : " ص"); }
  const relDay = (s) => { const k = daysUntil(s); return k === 0 ? "اليوم" : k === 1 ? "غداً" : k === -1 ? "أمس" : dlong(s); };
  const dayWord = (k) => k === 1 ? "يوم" : k === 2 ? "يومين" : (k <= 10 ? k+" أيام" : k+" يوم");
  const typesOf = (j) => Array.isArray(j.types) && j.types.length ? j.types : (j.type ? String(j.type).split(/\s*\+\s*/) : []);
  const typeText = (j) => typesOf(j).join(" + ");
  const initials = (s) => (s||"؟").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("");
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const bodyOf = (j) => { const d = {...j}; delete d.id; delete d.dirty; return d; };

  // ---------- exchange rates ----------
  // A payment in another currency keeps the rate of its day: rate = units of the main currency for 1 unit.
  function lastRate(cur){ // the most recent rate you used for this currency
    let best = null, bd = "";
    for (const j of Object.values(all)){
      if (!j || j.deleted) continue;
      const list = j.kind === "expense" ? (j.currency === cur ? [j] : []) : (curOf(j) === cur ? paysOf(j) : []);
      for (const p of list) if (p.rate && p.rateBase === settings.currency && (p.date||"") >= bd){ best = n(p.rate); bd = p.date || ""; }
    }
    return best;
  }
  const manualRate = (cur) => { const m = settings.rateManual; return m && m.base === settings.currency && m.map && n(m.map[cur]) ? n(m.map[cur]) : 0; };
  const rateNow = (cur) => cur === settings.currency ? 1 : manualRate(cur) || (settings.rates && settings.rates.base === settings.currency && settings.rates.map[cur]) || lastRate(cur);
  const payBase = (p, cur) => cur === settings.currency ? n(p.amount)
    : (p.rate && p.rateBase === settings.currency ? n(p.amount) * n(p.rate) : (rateNow(cur) ? n(p.amount) * rateNow(cur) : null));
  // lock the second-currency (dollar) rate of the moment the money is recorded, so old amounts never drift
  const altStamp = () => { const a = settings.altCur && settings.altCur !== settings.currency && CUR[settings.altCur] ? settings.altCur : (settings.currency === "USD" ? "EGP" : "USD"); const r = a === settings.currency ? 1 : rateNow(a); return r ? {altCur:a, altRate:r, altBase:settings.currency} : {}; };
  const stampPay = (p, cur) => { const q = cur === settings.currency ? {...p} : {...p, rate: p.rate ? n(p.rate) : rateNow(cur), rateBase: settings.currency}; return p.received === false ? q : {...q, ...altStamp()}; };
  // the moment a transfer arrives: today's rate is locked for it
  const arrive = (q, cur) => ({...q, received:true, recvDate:todayStr(), ...(cur !== settings.currency ? {rate:rateNow(cur), rateBase:settings.currency} : {}), ...altStamp()});
  function altOf(base, amount, cur, rec){
    const a = altCode(); if (base == null) return null;
    if (cur === a) return n(amount);
    if (a === settings.currency) return base;
    const r = (rec && rec.altCur === a && rec.altBase === settings.currency && n(rec.altRate)) || rateNow(a);
    return r ? base / r : null;
  }
  const fmtRate = (r) => Number(r).toLocaleString("en-US", {maximumFractionDigits: r < 1 ? 4 : 2});
  function fetchRates(force){
    if (!navigator.onLine) return;
    const r = settings.rates;
    if (!force && r && r.base === settings.currency && Date.now() - r.at < 12 * 3600e3) return;
    fetch("https://open.er-api.com/v6/latest/" + settings.currency).then(x => x.json()).then(d => {
      if (!d || !d.rates) return;
      const map = {};
      for (const k of Object.keys(CUR)) if (k !== settings.currency && d.rates[k]) map[k] = Number((1 / d.rates[k]).toFixed(4));
      settings.rates = {base: settings.currency, at: Date.now(), map}; saveSettings(); render();
      if (force) toast("تم تحديث أسعار الصرف");
    }).catch(() => { if (force) toast("تعذّر تحديث أسعار الصرف حالياً"); });
  }
  // totals in the main currency + breakdown by currency
  function totals(items){ // items: [{amount, cur, base(nullable)}]
    const t = {base:0, alt:0, by:{}, missing:{}, foreign:false};
    for (const it of items){
      if (!it.amount) continue;
      addTo(t.by, it.cur, it.amount);
      if (it.cur !== settings.currency) t.foreign = true;
      if (it.base == null) addTo(t.missing, it.cur, it.amount); else { t.base += it.base; t.alt += it.alt != null ? it.alt : (altOf(it.base, it.amount, it.cur) || 0); }
    }
    return t;
  }
  function totalView(t, approx){
    const foreign = Object.keys(t.by).filter(k => k !== settings.currency);
    const lines = [];
    if (foreign.length) lines.push((approx ? "تقريباً · " : "") + "منها " + foreign.map(k => money(t.by[k], k)).join(" · "));
    if (Object.keys(t.missing).length) lines.push("+ " + moneyMap(t.missing) + " بدون سعر صرف");
    return [fmt(Math.round(t.base)), h("small",null,CUR[settings.currency]), lines.length ? h("span",{class:"alt num"}, lines.join(" — ")) : null];
  }

  // multi-currency sums: {EGP: 1200, USD: 300}
  const addTo = (m, cur, v) => { if (v) m[cur] = (m[cur]||0) + v; return m; };
  function moneyMap(m){
    const keys = Object.keys(m).filter(k=>m[k]).sort((a,b)=>(a===settings.currency?-1:b===settings.currency?1:m[b]-m[a]));
    return keys.length ? keys.map(k=>money(m[k],k)).join(" · ") : money(0);
  }
  function bigMoney(m){ // main currency big, others on a second line
    const keys = Object.keys(m).filter(k=>m[k]);
    const main = keys.includes(settings.currency) || !keys.length ? settings.currency : keys[0];
    const rest = keys.filter(k=>k!==main);
    return [fmt(m[main]||0), h("small",null,CUR[main]), rest.length ? h("span",{class:"alt num"}, "+ " + rest.map(k=>money(m[k],k)).join(" · ")) : null];
  }

  function countdown(j){
    if (j.status === "done") return {t:"تم التسليم" + (j.delivered ? " " + dshort(j.delivered) : ""), c:"c-done"};
    if (j.status === "cancel") return {t:"ملغي", c:"c-ok"};
    const nd = nextDue(j);
    if (!nd.date) return {t:"بدون موعد", c:"c-ok"};
    const k = daysUntil(nd.date);
    if (k < 0) return {t:"متأخر " + dayWord(-k), c:"c-late"};
    if (k === 0) return {t:"التسليم اليوم", c:"c-soon"};
    if (k === 1) return {t:"التسليم غداً", c:"c-soon"};
    return {t:"متبقٍ " + dayWord(k), c: k <= 3 ? "c-soon" : "c-ok"};
  }
  const cdChip = (j) => { const c = countdown(j); return h("span",{class:"cd "+c.c}, c.t); };
  const stPill = (j) => { const s = STATUS[j.status] || STATUS.new; return h("span",{class:"pill "+s.c}, s.t); };
  // ---------- date fields: always day/month/year, whatever the device language ----------
  function syncDates(root){
    (root || document).querySelectorAll('input[type="date"]').forEach(inp => {
      let wrap = inp.parentElement;
      if (!wrap.classList.contains("dwrap")){
        wrap = document.createElement("span"); wrap.className = "dwrap";
        inp.replaceWith(wrap); wrap.append(inp, Object.assign(document.createElement("span"), {className:"dtxt"}));
        inp.addEventListener("click", () => { try { inp.showPicker && inp.showPicker(); } catch(e){} });
      }
      const t = wrap.querySelector(".dtxt"), v = inp.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)){ const [y,m,d] = v.split("-"); t.textContent = d + "/" + m + "/" + y; t.classList.remove("ph"); }
      else { t.textContent = "يوم/شهر/سنة"; t.classList.add("ph"); }
    });
  }
  document.addEventListener("input", e => { if (e.target.type === "date") syncDates(e.target.parentElement.parentElement); });
  document.addEventListener("change", e => { if (e.target.type === "date") syncDates(e.target.parentElement.parentElement); });

  // open windows sit on the browser's top layer, so messages are moved into the top-most one to stay visible
  const topHost = () => [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  function toast(msg, ms){ const t=$("toast"); topHost().appendChild(t); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, ms || 2600); }

  // ---------- data writes ----------
  const store = {
    async save(id, data){ all[id] = {...data, id, updatedAt: Date.now(), dirty: true}; persist(); refreshJobs(); render(); scheduleSync(); },
    async remove(id){ all[id] = {id, deleted: true, updatedAt: Date.now(), dirty: true}; persist(); refreshJobs(); render(); scheduleSync(); }
  };

  // ---------- Google Sheet sync ----------
  let syncing = false, syncErr = "", syncTimer = null;
  function scheduleSync(ms){ clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms ?? 700); }
  const linked = () => !!(settings.drive || settings.sheetUrl);
  async function sync(manual){
    if (settings.drive) return driveSync(manual);
    if (!settings.sheetUrl){ if (manual) toast("أدخل رابط الشيت أولاً"); return; }
    if (!navigator.onLine){ syncErr = ""; renderSync(); if (manual) toast("لا يوجد اتصال بالإنترنت. التغييرات محفوظة على الجهاز وستُرسل عند عودة الاتصال."); return; }
    if (syncing) return;
    syncing = true; renderSync(); let pulled = false;
    const changes = Object.values(all).filter(j => j.dirty).map(j => { const c = {...j}; delete c.dirty; return c; });
    try {
      const res = await fetch(settings.sheetUrl, {method:"POST", body: JSON.stringify({token: settings.token, action:"sync", changes, since: n(settings.syncCursor), currency: settings.currency, remindDays: settings.remindDays})});
      const out = await res.json();
      if (!out || !out.ok) throw new Error(out && out.error === "token" ? "token" : "bad");
      const sent = Object.fromEntries(changes.map(c => [c.id, c.updatedAt]));
      for (const sj of out.jobs || []){
        if (!sj || typeof sj.id !== "string") continue;
        const lj = all[sj.id];
        if (lj && n(sj.updatedAt) === n(lj.updatedAt)) continue;
        if (!lj || (!lj.dirty && n(sj.updatedAt) >= n(lj.updatedAt)) || (lj.dirty && n(sj.updatedAt) > n(lj.updatedAt))){ all[sj.id] = {...sj}; pulled = true; }
      }
      if (out.now) settings.syncCursor = out.now;
      for (const [id, ts] of Object.entries(sent)) if (all[id] && all[id].updatedAt === ts) delete all[id].dirty;
      settings.lastSync = Date.now(); saveSettings(); syncErr = "";
      persist(); refreshJobs();
      if (manual) toast("تمت المزامنة مع الشيت ✓");
    } catch(e){
      syncErr = e && e.message === "token" ? "كلمة المرور غير صحيحة" : "تعذّر الاتصال بالشيت";
      if (manual) toast(syncErr === "كلمة المرور غير صحيحة" ? "كلمة المرور لا تطابق المسجّلة في الشيت" : "تعذّر الاتصال بالشيت. تأكد من الرابط.");
    } finally { syncing = false; if (pulled || manual) render(); else renderSync(); }
  }
  // ---------- Google sign-in + private Drive sync ----------
  // Data goes from this device straight to a hidden app folder in the user's own Google Drive.
  // The small auth server only swaps the sign-in code for a key and refreshes it; it stores nothing.
  const G = {
    client: "479845573465-cq6u247cdi3oa263bvlh35hvleop051t.apps.googleusercontent.com",
    auth: "https://daftar-auth.ahmedzahrastudio90.workers.dev",
    scope: "https://www.googleapis.com/auth/drive.appdata",
    api: "https://www.googleapis.com/drive/v3/files",
    up: "https://www.googleapis.com/upload/drive/v3/files",
    file: "daftar.json"
  };
  const gauth = Object.assign({rt:"", at:"", exp:0, email:"", fileId:"", ver:""}, LS.get("ledger.gauth", {}));
  const saveGauth = () => LS.set("ledger.gauth", gauth);
  let gBusy = false;
  const gsiReady = () => loadScript("https://accounts.google.com/gsi/client");
  async function authPost(path, body){
    const r = await fetch(G.auth + path, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error(r.status === 401 ? "relogin" : "auth");
    return d;
  }
  async function accessToken(force){
    if (!force && gauth.at && Date.now() < gauth.exp - 60000) return gauth.at;
    if (!gauth.rt) throw new Error("relogin");
    const d = await authPost("/refresh", {refresh_token: gauth.rt});
    gauth.at = d.access_token; gauth.exp = Date.now() + n(d.expires_in || 3600) * 1000; saveGauth();
    return gauth.at;
  }
  async function gfetch(url, opt = {}, retry = true){
    const r = await fetch(url, {...opt, headers: {...(opt.headers || {}), Authorization: "Bearer " + await accessToken()}});
    if (r.status === 401 && retry){ gauth.at = ""; return gfetch(url, opt, false); }
    if (r.status === 404 && url.includes(gauth.fileId || "§")){ gauth.fileId = ""; gauth.ver = ""; saveGauth(); throw new Error("gone"); }
    if (!r.ok) throw new Error("drive");
    return r;
  }
  function signIn(){
    gBusy = true; render();
    gsiReady().then(() => {
      google.accounts.oauth2.initCodeClient({
        client_id: G.client, scope: G.scope, ux_mode: "popup", select_account: true,
        callback: async (res) => {
          try {
            if (!res || !res.code) throw new Error("cancel");
            const d = await authPost("/token", {code: res.code});
            Object.assign(gauth, {rt: d.refresh_token || "", at: d.access_token, exp: Date.now() + n(d.expires_in || 3600) * 1000, fileId: "", ver: ""});
            // Google gives the long-lived key only on the first device; keep it in the app's hidden Drive folder for your other devices
            if (d.refresh_token) await keyFile(d.refresh_token).catch(() => {});
            else gauth.rt = await keyFile().catch(() => "");
            if (!gauth.rt) throw new Error("auth");
            try { const u = await (await gfetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)")).json(); gauth.email = (u.user && u.user.emailAddress) || ""; } catch(e){}
            saveGauth();
            settings.drive = true; settings.sheetUrl = ""; settings.token = ""; saveSettings();
            for (const j of Object.values(all)) j.dirty = true; persist();
            gBusy = false; syncErr = "";
            await driveSync();
            toast(syncErr ? syncErr : "تم الدخول ✓ وبياناتك بتتزامن على كل أجهزتك");
          } catch(e){ gBusy = false; toast(e.message === "cancel" ? "اتلغى الدخول" : "تعذّر الدخول. جرّب تاني."); }
          render();
        },
        error_callback: (e) => { gBusy = false; render(); if (e && e.type === "popup_failed_to_open") toast("المتصفح منع نافذة جوجل. اسمح بالنوافذ المنبثقة وجرّب تاني."); }
      }).requestCode();
    }).catch(() => { gBusy = false; render(); toast("محتاج نت علشان تسجّل الدخول"); });
  }
  async function signOut(wipe){
    try {
      if (wipe){
        const list = await (await gfetch(G.api + "?spaces=appDataFolder&fields=files(id)")).json();
        for (const f of list.files || []) await gfetch(G.api + "/" + f.id, {method:"DELETE"});
      }
      if (gauth.rt) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(gauth.rt), {method:"POST"}).catch(() => {});
    } catch(e){ if (wipe){ toast("تعذّر مسح النسخة. تأكد من النت وجرّب تاني."); return; } }
    for (const k of Object.keys(gauth)) gauth[k] = k === "exp" ? 0 : "";
    LS.set("ledger.gauth", {}); settings.drive = false; settings.lastSync = 0; saveSettings(); syncErr = "";
    toast(wipe ? "تم الخروج ومسح نسختك من جوجل درايف" : "تم الخروج. بياناتك لسه على الجهاز ده."); render();
  }
  async function keyFile(put){
    const q = encodeURIComponent("name='key.json' and trashed=false");
    const f = ((await (await gfetch(G.api + "?spaces=appDataFolder&q=" + q + "&fields=files(id)")).json()).files || [])[0];
    if (put === undefined) return f ? ((await (await gfetch(G.api + "/" + f.id + "?alt=media")).json()).rt || "") : "";
    const body = JSON.stringify({rt: put});
    if (f) return gfetch(G.up + "/" + f.id + "?uploadType=media", {method: "PATCH", headers: {"Content-Type": "application/json"}, body});
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify({name: "key.json", parents: ["appDataFolder"]})], {type: "application/json"}));
    fd.append("file", new Blob([body], {type: "application/json"}));
    return gfetch(G.up + "?uploadType=multipart&fields=id", {method: "POST", body: fd});
  }
  async function driveFile(){
    if (gauth.fileId) return gauth.fileId;
    const q = encodeURIComponent("name='" + G.file + "' and trashed=false");
    const list = await (await gfetch(G.api + "?spaces=appDataFolder&q=" + q + "&orderBy=createdTime&fields=files(id,version)")).json();
    if (list.files && list.files[0]){ gauth.fileId = list.files[0].id; saveGauth(); return gauth.fileId; }
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify({name: G.file, parents: ["appDataFolder"], mimeType: "application/json"})], {type: "application/json"}));
    fd.append("file", new Blob([JSON.stringify({v: 1, records: {}})], {type: "application/json"}));
    const f = await (await gfetch(G.up + "?uploadType=multipart&fields=id", {method: "POST", body: fd})).json();
    gauth.fileId = f.id; gauth.ver = ""; saveGauth(); return f.id;
  }
  async function driveSync(manual){
    const retried = manual && manual.retried; manual = manual === true;
    if (!navigator.onLine){ syncErr = ""; renderSync(); if (manual) toast("لا يوجد اتصال بالإنترنت. التغييرات محفوظة على الجهاز وستُرسل عند عودة الاتصال."); return; }
    if (syncing) return;
    syncing = true; renderSync(); let pulled = false, again = false;
    try {
      const id = await driveFile();
      const dirty = Object.values(all).some(j => j.dirty);
      const meta = await (await gfetch(G.api + "/" + id + "?fields=version")).json();
      if (dirty || meta.version !== gauth.ver){
        const remote = (await (await gfetch(G.api + "/" + id + "?alt=media")).json().catch(() => ({}))).records || {};
        for (const r of Object.values(remote)){
          if (!r || typeof r.id !== "string") continue;
          const l = all[r.id];
          if (!l || n(r.updatedAt) > n(l.updatedAt)){ all[r.id] = {...r}; delete all[r.id].dirty; pulled = true; }
        }
        const ahead = Object.values(all).some(l => !remote[l.id] || n(l.updatedAt) > n(remote[l.id].updatedAt));
        let ver = meta.version;
        if (ahead){
          const stamp = Object.fromEntries(Object.values(all).map(l => [l.id, l.updatedAt]));
          const records = Object.fromEntries(Object.values(all).map(l => { const c = {...l}; delete c.dirty; return [l.id, c]; }));
          const out = await (await gfetch(G.up + "/" + id + "?uploadType=media&fields=version", {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({v: 1, records})})).json();
          ver = out.version;
          for (const [k, ts] of Object.entries(stamp)) if (all[k] && all[k].updatedAt === ts) delete all[k].dirty;
        } else for (const l of Object.values(all)) delete l.dirty;
        gauth.ver = ver; saveGauth();
        persist(); refreshJobs();
      }
      settings.lastSync = Date.now(); saveSettings(); syncErr = "";
      if (manual) toast("تمت المزامنة ✓");
    } catch(e){
      if (e.message === "gone" && !retried) again = true;
      else syncErr = e.message === "relogin" ? "سجّل الدخول بجوجل تاني" : "تعذّر الاتصال بجوجل درايف";
      if (!again && manual) toast(syncErr);
    } finally { syncing = false; if (pulled || manual) render(); else renderSync(); }
    if (again) return driveSync({retried: true});
  }

  window.addEventListener("online", () => { renderSync(); scheduleSync(300); fetchRates(); });
  window.addEventListener("offline", renderSync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleSync(300); });
  // while the app is open, check for changes from your other devices every 10 seconds
  setInterval(() => { if (!document.hidden && linked() && !syncing) sync(); }, 10000);

  function syncState(){
    const pending = Object.values(all).some(j=>j.dirty);
    if (!linked()) return {c:"off", t:"محفوظ على الجهاز"};
    if (!navigator.onLine) return {c:"off", t: pending ? "غير متصل · ستتم المزامنة لاحقاً" : "غير متصل"};
    if (syncing) return {c:"busy", t:"جارٍ المزامنة…"};
    if (syncErr) return {c:"err", t: syncErr};
    if (pending) return {c:"busy", t:"في انتظار المزامنة"};
    return {c:"ok", t: settings.drive ? "متزامن مع حسابك على جوجل" : "متزامن مع الشيت"};
  }
  function renderSync(){
    const s = syncState();
    for (const id of ["syncSide","syncTop"]){ const el = $(id); el.className = "sync " + s.c; el.title = s.t; el.lastElementChild.textContent = s.t; }
  }

  // ---------- dialogs: phone "back" closes the open window instead of leaving the app ----------
  function openDlg(d){
    if (d.open) return;
    d.showModal();
    try { history.pushState({dlg: d.id}, ""); } catch(e){}
  }
  window.addEventListener("popstate", () => {
    const open = [...document.querySelectorAll("dialog[open]")];
    if (open.length){ const top = open[open.length - 1]; top._byBack = true; top.close(); }
  });
  for (const d of document.querySelectorAll("dialog")) d.addEventListener("close", () => {
    if (!d._byBack && history.state && history.state.dlg === d.id){ try { history.replaceState(null, ""); } catch(e){} }
    d._byBack = false;
  });

  // ---------- hide amounts ----------
  // amounts stay correct; when hidden they are blurred on screen. Tap a blurred amount to show all.
  const BLURRED = ".kpi .val,.kpi .foot,.alt-cur,.sumgrid b,.amt,.owed,.jrem,.jmoney,.mgrid b,.pays .a,.pays .hint,.months b,.zk b,.rem-line b,.mv";
  document.addEventListener("click", e => {
    if (!settings.hideMoney || !e.target.closest || !e.target.closest(BLURRED)) return;
    e.preventDefault(); e.stopPropagation(); reveal();
  }, true);
  const toggleMoney = () => { settings.hideMoney = !settings.hideMoney; saveSettings(); render(); };
  const reveal = () => { if (settings.hideMoney){ settings.hideMoney = false; saveSettings(); render(); return true; } return false; };
  const eyeBtn = () => h("button",{class:"eye-pill",type:"button",onclick:toggleMoney,"aria-pressed":String(settings.hideMoney)},
    icon(settings.hideMoney ? "i-eye" : "i-eyeoff"), settings.hideMoney ? "إظهار المبالغ" : "إخفاء المبالغ");
  function moneyHead(){ return h("div",{class:"sec-h"}, h("h2",null,"حساباتك"), eyeBtn()); }

  // ---------- navigation ----------
  function go(v){ view = v; try{ history.replaceState(null,"","#"+v); }catch(e){} render(); window.scrollTo(0,0); }
  window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS.some(x=>x[0]===v)) { view = v; render(); } });
  document.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => openForm(null)));
  document.querySelectorAll("[data-wa]").forEach(b => b.addEventListener("click", () => openWa()));

  function renderNav(){
    const late = jobs.filter(isLate).length;
    $("sideNav").replaceChildren(...VIEWS.map(([k,t,ic]) => h("button",{type:"button","aria-current":view===k?"page":null,onclick:()=>go(k)}, icon(ic), t,
      k==="jobs" && late ? h("span",{class:"badge num"}, late) : null)));
    const tb = VIEWS.map(([k,t,ic]) => h("button",{type:"button","aria-current":view===k?"page":null,onclick:()=>go(k)}, icon(ic), t));
    tb.splice(2,0,h("button",{type:"button",class:"add","aria-label":"مشروع جديد",onclick:()=>openForm(null)}, icon("i-plus")));
    $("tabBar").replaceChildren(...tb);
  }

  function render(){
    document.documentElement.toggleAttribute("data-hide", !!settings.hideMoney);
    renderNav(); renderSync(); clearTimeout(render._r); render._r = setTimeout(reminders, 400);
    $("pageTitle").textContent = VIEWS.find(v=>v[0]===view)[1];
    const nodes = view === "home" ? viewHome() : view === "jobs" ? (jobsTab === "clients" ? viewClients() : viewJobs()) : view === "money" ? viewMoney() : viewSettings();
    const active = document.activeElement && document.activeElement.id === "search";
    $("content").replaceChildren(...nodes.filter(Boolean));
    if (active){ const s = $("search"); if (s){ s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    if ($("sheetDlg").open) renderSheet();
    syncDates();
  }

  function emptyFirst(){
    return h("div",{class:"empty"},
      h("h2",null,"لا توجد مشاريع بعد"),
      h("p",null,"سجّل أول مشروع في خطوة واحدة، أو الصق رسائل الاتفاق من واتساب ليُسجَّل تلقائياً."),
      h("div",{class:"row-btns",style:"justify-content:center"},
        h("button",{class:"btn primary",type:"button",onclick:()=>openForm(null)}, icon("i-plus"), "سجّل أول مشروع"),
        h("button",{class:"btn wa",type:"button",onclick:()=>openWa()}, icon("i-wa"), "استيراد من واتساب")));
  }

  // ---------- income ----------
  function income(prefix){ // payments whose date starts with prefix ("2026-11" or "2026")
    const items = [];
    for (const j of jobs){ const cur = curOf(j); for (const p of paysOf(j)) if (isRecv(p) && recvDate(p).startsWith(prefix)) { const b = payBase(p, cur); items.push({amount:n(p.amount), cur, base:b, alt:altOf(b, p.amount, cur, p)}); } }
    return totals(items);
  }

  // ---------- home ----------
  // ---------- reminders ----------
  function dueSoon(){ return jobs.filter(j => { const d = nextDue(j).date; return isOpen(j) && d && daysUntil(d) <= settings.remindDays; }).sort((a,b)=>nextDue(a).date.localeCompare(nextDue(b).date)); }
  const reminderText = (j) => { const nd = nextDue(j), k = daysUntil(nd.date); return (k < 0 ? "متأخر " + dayWord(-k) : k === 0 ? "التسليم اليوم" : k === 1 ? "التسليم غداً" : "متبقٍ " + dayWord(k)) + ": " + (j.title||"") + (nd.label ? " (" + nd.label + ")" : "") + (j.client ? " — " + j.client : ""); };
  const todayMeetings = () => jobs.flatMap(j => meetingsOf(j).filter(m => !m.done && m.date === todayStr()).map(m => ({...m, client:j.client}))).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
  const meetTimers = [];
  // while the app is open (or in the background on a computer): a pop-up on screen 30 minutes before each meeting and
  // at 10 AM on delivery days, as a system notification when allowed, and inside the app either way
  async function alertNow(title, body, tag){
    const sys = "Notification" in window && Notification.permission === "granted";
    if (LS.get("ledger.alerted", {})[tag] || (!sys && document.hidden)) return;
    const seen = LS.get("ledger.alerted", {}); seen[tag] = todayStr(); for (const k in seen) if (seen[k] < addDays(todayStr(), -3)) delete seen[k]; LS.set("ledger.alerted", seen);
    if (sys){
      const opts = {body, tag, icon:"icons/icon-192.png", badge:"icons/icon-192.png", dir:"rtl", lang:"ar", requireInteraction:true};
      try { const reg = await navigator.serviceWorker?.getRegistration(); reg ? reg.showNotification(title, opts) : new Notification(title, opts); } catch(e){}
    }
    if (!document.hidden) toast("🔔 " + title + ": " + body, 9000);
  }
  function scheduleMeetingAlerts(){
    meetTimers.splice(0).forEach(clearTimeout);
    const now = Date.now(), plan = (at, fn) => { const ms = at - now; if (ms > -10*60e3 && ms < 13*3600e3) meetTimers.push(setTimeout(fn, Math.max(0, ms))); };
    for (const j of jobs) for (const m of meetingsOf(j)){
      if (m.done || !m.date || !m.time || daysUntil(m.date) < 0 || daysUntil(m.date) > 1) continue;
      const [y,mo,d] = m.date.split("-").map(Number), [hh,mm] = m.time.split(":").map(Number);
      const at = new Date(y, mo-1, d, hh, mm - 30).getTime();
      if (now < at + 30*60e3) plan(at, () => alertNow("ميتنج بعد نص ساعة", (m.title||"اجتماع") + " الساعة " + fmtTime(m.time), "meet-" + m.id + "-" + m.date + m.time));
    }
    for (const r of Object.values(all)){
      if (!r || r.kind !== "ping" || r.deleted) continue;
      if (now > n(r.at) + 10*60e3){ all[r.id] = {id:r.id, deleted:true, updatedAt:now, dirty:true}; persist(); scheduleSync(); continue; }
      plan(n(r.at), () => alertNow("ميتنج بعد نص ساعة", "عرض اسكتشات اللوجو — شركة نوفا (إشعار تجريبي)", r.id));
    }
    const ten = new Date(); ten.setHours(10, 0, 0, 0);
    const today = jobs.filter(j => isOpen(j) && nextDue(j).date === todayStr());
    if (today.length) plan(ten.getTime(), () => alertNow("تسليم النهارده", today.map(j => (j.title||"") + (nextDue(j).label ? " (" + nextDue(j).label + ")" : "") + (j.client ? " — " + j.client : "")).join("\n"), "due-" + todayStr()));
  }
  setInterval(() => scheduleMeetingAlerts(), 30*60e3);
  async function reminders(){
    const list = dueSoon(), meets = todayMeetings();
    try { if ("setAppBadge" in navigator) (list.length + meets.length) ? navigator.setAppBadge(list.length + meets.length) : navigator.clearAppBadge(); } catch(e){}
    scheduleMeetingAlerts();
    // snapshot for the background check in sw.js
    try { if ("caches" in window){ const c = await caches.open("reminders"); await c.put("snapshot", new Response(JSON.stringify(jobs.filter(j=>isOpen(j)&&nextDue(j).date).map(j=>({title:j.title + (nextDue(j).label ? " (" + nextDue(j).label + ")" : ""), client:j.client, due:nextDue(j).date}))))); await c.put("meetings", new Response(JSON.stringify(jobs.flatMap(j=>meetingsOf(j).filter(m=>!m.done).map(m=>({title:m.title, client:j.client, date:m.date, time:m.time})))))); await c.put("days", new Response(String(settings.remindDays))); } } catch(e){}
    // once a day, when the app opens
    if ((list.length || meets.length) && settings.lastNotify !== todayStr() && "Notification" in window && Notification.permission === "granted"){
      settings.lastNotify = todayStr(); saveSettings();
      try { const reg = await navigator.serviceWorker?.getRegistration(); const body = meets.map(m => "اجتماع " + fmtTime(m.time) + ": " + (m.title||"") ).concat(list.slice(0,4).map(reminderText)).join("\n");
        const opts = {body, tag:"due-today", icon:"icons/icon-192.png", badge:"icons/icon-192.png", dir:"rtl", lang:"ar"};
        const ttl = meets.length ? "مواعيد اليوم" : "مواعيد تسليم قريبة"; if (reg) reg.showNotification(ttl, opts); else new Notification(ttl, opts); } catch(e){}
    }
  }
  // test: a sample alert in 15 seconds on this device and on every device signed in with the same account
  async function testPing(){
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    const id = "ping-" + newId();
    all[id] = {id, kind:"ping", at: Date.now() + 15000, updatedAt: Date.now(), dirty: true};
    persist(); refreshJobs(); scheduleSync(0); scheduleMeetingAlerts();
    toast(linked() ? "الإشعار هيظهر بعد 15 ثانية هنا وعلى أجهزتك التانية المفتوحة" : "الإشعار هيظهر بعد 15 ثانية", 5000);
  }
  async function enableNotify(){
    if (!("Notification" in window)){ toast("هذا الجهاز لا يدعم إشعارات المتصفح. استخدم تنبيهات Google Calendar."); return; }
    const p = await Notification.requestPermission();
    if (p === "granted"){
      settings.lastNotify = ""; saveSettings();
      try { const reg = await navigator.serviceWorker?.ready; if (reg && reg.periodicSync) await reg.periodicSync.register("due-check", {minInterval: 12*60*60*1000}); } catch(e){}
      reminders(); toast("تم تفعيل الإشعارات");
    } else toast("الإشعارات معطّلة من إعدادات المتصفح");
    render();
  }
  // ---------- money helpers ----------
  function expBase(e){ const cur = CUR[e.currency] ? e.currency : settings.currency; return cur === settings.currency ? n(e.amount) : (e.rate && e.rateBase === settings.currency ? n(e.amount) * n(e.rate) : (rateNow(cur) ? n(e.amount) * rateNow(cur) : null)); }
  function expensesIn(ym){ // one month "YYYY-MM": one-off of that month + monthly ones running then
    return expenses.filter(e => {
      const m = (e.date||"").slice(0,7); if (!m) return false;
      return e.recurring ? (m <= ym && (!e.stopped || ym < e.stopped)) : m === ym;
    });
  }
  function expTotal(ym){ return totals(expensesIn(ym).map(e => { const cur = CUR[e.currency] ? e.currency : settings.currency, b = expBase(e); return {amount:n(e.amount), cur, base:b, alt:altOf(b, e.amount, cur, e)}; })); }
  function monthsOfYear(y){ const now = new Date(), last = String(now.getFullYear()) === y ? now.getMonth() : 11; const out = []; for (let i = 0; i <= last; i++) out.push(y + "-" + String(i+1).padStart(2,"0")); return out; }
  function yearNet(y){ let inc = 0, exp = 0, alt = 0; for (const ym of monthsOfYear(y)){ const i = income(ym), e = expTotal(ym); inc += i.base; exp += e.base; alt += i.alt - e.alt; } return {inc, exp, net: inc - exp, alt, months: monthsOfYear(y).length}; }
  const dueTotals = () => totals(jobs.map(j => { const cur = curOf(j), r = remOf(j); return {amount:r, cur, base: rateNow(cur) ? r * rateNow(cur) : null}; }));
  // the same amount in your second currency (dollar by default), small, under the main number
  const altCode = () => settings.altCur && settings.altCur !== settings.currency && CUR[settings.altCur] ? settings.altCur : (settings.currency === "USD" ? "EGP" : "USD");
  function altText(baseAmount, altAmount){
    const c = altCode();
    if (altAmount != null) return altAmount ? "≈ " + rawFmt(Math.round(altAmount)) + " " + CUR[c] : "";
    const r = c === settings.currency ? 1 : rateNow(c);
    if (!r || !baseAmount) return "";
    return "≈ " + rawFmt(Math.round(baseAmount / r)) + " " + CUR[c];
  }
  const big = (v, a) => [fmt(Math.round(v)), h("small",null,CUR[settings.currency]), altText(v, a) ? h("span",{class:"alt-cur num"}, altText(v, a)) : null];
  // the dollar (second currency) rate the totals use: shown, and you can set your own when your bank's rate differs
  let rateEdit = false;
  function rateLine(){
    const c = altCode(); if (c === settings.currency) return null;
    const r = rateNow(c), mine = !!manualRate(c);
    const label = "1 " + CUR[c] + " = ";
    if (rateEdit) return h("form",{class:"rate-line editing",onsubmit:e=>{
        e.preventDefault(); const v = n($("rateIn").value);
        if (!(v > 0)){ toast("اكتب السعر"); return; }
        settings.rateManual = {base: settings.currency, map: {...((settings.rateManual && settings.rateManual.base === settings.currency && settings.rateManual.map) || {}), [c]: v}, at: Date.now()};
        rateEdit = false; saveSettings(); toast("تم ✓ الحسابات ماشية على " + fmtRate(v)); render();
      }},
      h("span",null, label), h("input",{id:"rateIn",type:"number",min:"0",step:"any",inputmode:"decimal",value:r ? String(r) : "",style:"width:110px"}), h("span",null, CUR[settings.currency]),
      h("button",{class:"btn primary sm",type:"submit"},"حفظ"),
      mine ? h("button",{class:"btn sm",type:"button",onclick:()=>{ const m = {...settings.rateManual, map:{...settings.rateManual.map}}; delete m.map[c]; settings.rateManual = m; rateEdit = false; saveSettings(); fetchRates(true); render(); }},"سعر النت") : null,
      h("button",{class:"btn ghost sm",type:"button","aria-label":"إلغاء",onclick:()=>{ rateEdit = false; render(); }}, icon("i-x")));
    return h("button",{class:"rate-line",type:"button",onclick:()=>{ rateEdit = true; render(); setTimeout(()=>{ const i = $("rateIn"); if (i){ i.focus(); i.select(); } },30); }},
      h("span",null, (c === "USD" ? "سعر الدولار" : "سعر " + CUR_NAME[c]) + ": "), h("b",{class:"num"}, r ? label + fmtRate(r) + " " + CUR[settings.currency] : "مش متاح"),
      h("small",null, mine ? " · سعرك إنت" : settings.rates && settings.rates.at ? " · سعر النت " + dshort(new Date(settings.rates.at).toISOString().slice(0,10)) : ""),
      icon("i-edit"));
  }

  // ---------- home ----------
  function upcomingItems(){
    const items = [];
    for (const j of jobs){
      if (isOpen(j)){ const nd = nextDue(j); if (nd.date) items.push({kind:"due", date:nd.date, j, label:nd.label}); else items.push({kind:"due", date:"9999-12-31", j, label:""}); }
      for (const m of meetingsOf(j)) if (!m.done && m.date && daysUntil(m.date) >= 0 && daysUntil(m.date) <= 14) items.push({kind:"meet", date:m.date, time:m.time||"", j, m});
    }
    return items.sort((x,y) => (x.date + (x.time||"99")).localeCompare(y.date + (y.time||"99")));
  }
  function meetingsPanel(){
    const list = [];
    for (const j of jobs) for (const m of meetingsOf(j)) if (!m.done && m.date && daysUntil(m.date) >= 0 && daysUntil(m.date) <= 7) list.push({j, m});
    if (!list.length) return null;
    list.sort((x,y) => (x.m.date + (x.m.time||"99")).localeCompare(y.m.date + (y.m.time||"99")));
    return h("section",{class:"panel today"},
      h("div",{class:"panel-h"}, h("h2",null,"الاجتماعات")),
      h("ul",{class:"plist"}, ...list.slice(0, 5).map(({j, m}) => {
        const today = daysUntil(m.date) === 0, t = fmtTime(m.time);
        return h("li",{tabindex:"0",class:today?"is-today":"",onclick:()=>openSheet(j.id)},
          h("div",{class:"timebox"}, h("b",{class:"num"}, t ? t.split(" ")[0] : "—"), h("span",null, t ? t.split(" ")[1] : "")),
          h("div",{class:"grow"}, h("div",{class:"t"}, m.title || "اجتماع"), h("div",{class:"s"}, j.client || "")),
          h("span",{class:"cd " + (today ? "c-soon" : "c-ok")}, relDay(m.date)),
          h("span",{onclick:e=>e.stopPropagation()}, meetCheck(j, m)));
      })));
  }
  function markArrived(j, idx){
    const cur = curOf(j), nx = bodyOf(j);
    nx.payments = paysOf(j).map((q,i) => i === idx ? arrive(q, cur) : q);
    store.save(j.id, nx); praise("تم استلام " + money(paysOf(j)[idx].amount, cur));
  }
  function transitPanel(){
    const list = jobs.flatMap(j => paysOf(j).map((p, i) => ({j, p, i})).filter(x => !isRecv(x.p))).map(x => ({...x, age: -daysUntil(x.p.date || todayStr())}));
    if (!list.length) return null;
    list.sort((a,b) => b.age - a.age);
    return h("section",{class:"panel today"},
      h("div",{class:"panel-h"}, h("h2",null,"قيد التحويل"), h("span",{class:"hint"},"اضغط «وصلت» عند وصولها لحسابك")),
      h("ul",{class:"plist"}, ...list.map(({j, p, i, age}) => h("li",{tabindex:"0",class:age > 5 ? "is-late" : "",onclick:()=>openSheet(j.id)},
        h("div",{class:"timebox",style:age > 5 ? "background:var(--bad-soft)" : ""}, h("b",null,"⏳"), h("span",null,"")),
        h("div",{class:"grow"}, h("div",{class:"t"}, h("span",{class:"mv num"}, money(p.amount, curOf(j)))), h("div",{class:"s"}, (j.client || "") + " · " + (j.title || ""))),
        h("span",{class:"cd " + (age > 5 ? "c-late" : "c-ok")}, age <= 0 ? "اليوم" : age > 5 ? "متأخر " + dayWord(age) : "من " + dayWord(age)),
        h("button",{class:"btn sm",type:"button",onclick:e=>{ e.stopPropagation(); markArrived(j, i); }},"وصلت ✓")))));
  }
  function deliveriesPanel(){
    const open = jobs.filter(isOpen).sort((a,b) => (nextDue(a).date || "9999").localeCompare(nextDue(b).date || "9999")).slice(0, 6);
    const rows = [];
    for (const j of open){
      const nd = nextDue(j), d = parseD(nd.date);
      rows.push(h("li",{tabindex:"0",onclick:()=>openSheet(j.id)},
        h("div",{class:"datebox"+(isLate(j)?" late":"")}, h("b",{class:"num"}, d?d.getDate():"—"), h("span",null, d?MONTHS[d.getMonth()]:"بدون")),
        h("div",{class:"grow"}, h("div",{class:"t"}, j.title||"بدون اسم", nd.label ? h("span",{class:"tag"}, nd.label) : null), h("div",{class:"s"}, j.client||"—")),
        cdChip(j)));
    }
    return h("section",{class:"panel today"},
      h("div",{class:"panel-h"}, h("h2",null,"التسليمات"), h("button",{class:"btn ghost sm",type:"button",onclick:()=>{filter="active";jobsTab="projects";go("jobs")}},"كل المشاريع")),
      rows.length ? h("ul",{class:"plist"}, ...rows) : h("div",{class:"pempty"},"لا توجد تسليمات قادمة. يوم موفق 🌿"));
  }
  function moneyCards(){
    const now = new Date(), ym = todayStr().slice(0,7), y = String(now.getFullYear());
    const mIn = income(ym), mEx = expTotal(ym), yr = yearNet(y), due = dueTotals();
    const owing = clientsList().filter(c=>Object.values(c.rem).some(v=>v>0)).length;
    const kpi = (cls, lbl, val, foot) => h("div",{class:"kpi "+cls,tabindex:"0",role:"button",title:settings.hideMoney?"اضغط لإظهار المبالغ":"",onclick:()=>{ if (!reveal()) go("money"); },onkeydown:e=>{if(e.key==="Enter"){ if (!reveal()) go("money"); }}},
      h("div",{class:"lbl"}, lbl), h("div",{class:"val num"}, val), h("div",{class:"foot"}, foot));
    return h("section",{class:"kpis","aria-label":"الحسابات"},
      kpi("", "صافي " + MONTHS[now.getMonth()], big(mIn.base - mEx.base, mIn.alt - mEx.alt), "دخل " + fmt(Math.round(mIn.base)) + " · مصاريف " + fmt(Math.round(mEx.base))),
      kpi("owed", "مستحقات لدى العملاء", big(due.base), owing ? "لدى " + owing + " عميل" : "لا توجد مستحقات"),
      kpi("", "صافي " + y, big(yr.net, yr.alt), "متوسط الشهر " + fmt(Math.round(yr.net / Math.max(1, yr.months)))));
  }
  function viewHome(){
    if (!jobs.length && !expenses.length) return [waCard(), installCard(), emptyFirst()];
    return [waCard(), installCard(), linkCard(), meetingsPanel(), deliveriesPanel(), transitPanel(), moneyHead(), moneyCards(), rateLine()];
  }

  // ---------- accounts ----------
  function viewMoney(){
    const now = new Date(), ym = todayStr().slice(0,7), y = String(now.getFullYear());
    const mIn = income(ym), mEx = expTotal(ym);
    const owing = clientsList().filter(c=>Object.values(c.rem).some(v=>v>0));
    const transit = []; for (const j of jobs) paysOf(j).forEach(p => { if (!isRecv(p)) transit.push({j, p}); });
    const exList = expensesIn(ym).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    const months = monthsOfYear(y).map(k => ({k, net: income(k).base - expTotal(k).base, inc: income(k).base})).filter((m,i,arr) => m.inc || expTotal(m.k).base || i === arr.length-1);
    const maxV = Math.max(1, ...months.map(m => Math.abs(m.net)));
    const cell = (lbl, v, cls, style, a) => h("div",{class:cls||"",onclick:reveal}, h("span",null,lbl), h("b",{class:"num",style:style||""}, fmt(Math.round(v))), altText(v, a) ? h("small",{class:"alt-cur num"}, altText(v, a)) : null);
    return [
      h("div",{class:"sec-h"}, rateLine() || h("span"), h("span",{style:"margin-inline-end:auto"}), eyeBtn()),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null, MONTHS[now.getMonth()] + " " + y), h("button",{class:"btn primary sm",type:"button",onclick:()=>openExp(null)}, icon("i-plus"), "مصروف")),
        h("div",{class:"sumgrid"},
          cell("الدخل", mIn.base, "", "color:var(--ok)", mIn.alt),
          cell("المصاريف", mEx.base, "", "color:var(--bad)", mEx.alt),
          cell("الصافي", mIn.base - mEx.base, "net", "", mIn.alt - mEx.alt))),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"مصاريف الشغل"), h("span",{class:"hint"}, "هذا الشهر")),
        exList.length ? h("ul",{class:"xlist"}, ...exList.map(e => h("li",{tabindex:"0",onclick:()=>openExp(e.id)},
          h("div",{class:"grow"}, h("b",null, e.note || "مصروف", e.recurring ? h("span",{class:"tag"},"شهري") : null), h("span",null, e.recurring ? "كل شهر من " + dshort(e.date) : dlong(e.date))),
          h("span",{class:"amt num",style:"color:var(--bad)"}, money(e.amount, CUR[e.currency] ? e.currency : settings.currency)))))
          : h("div",{class:"pempty"},"لا توجد مصاريف هذا الشهر.")),
      transit.length ? h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"قيد التحويل"), h("span",{class:"hint"},"اضغط «تم الاستلام» عند وصولها")),
        h("ul",{class:"xlist"}, ...transit.map(({j,p}) => h("li",{tabindex:"0",onclick:()=>openSheet(j.id)},
          h("div",{class:"grow"}, h("b",null, j.client || "—"), h("span",null, (j.title||"") + " · " + dshort(p.date))),
          h("span",{class:"amt num"}, money(p.amount, curOf(j))))))) : null,
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"مستحقات لدى العملاء"), h("b",{class:"num",style:"color:var(--owed)"}, money(Math.round(dueTotals().base)))),
        owing.length ? h("ul",{class:"plist"}, ...owing.slice(0,8).map(c =>
          h("li",{tabindex:"0",onclick:()=>showClient(c.name),onkeydown:e=>{if(e.key==="Enter")showClient(c.name)}},
            h("span",{class:"avatar"}, initials(c.name)),
            h("div",{class:"grow"}, h("div",{class:"t"}, c.name), h("div",{class:"s"}, c.phone || " ")),
            owedCell(c.rem)))) : h("div",{class:"pempty"},"لا توجد مستحقات.")),
      zakatPanel(),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"صافي الدخل · " + y), h("b",{class:"num",style:"color:var(--ok)"}, money(Math.round(yearNet(y).net)))),
        h("ul",{class:"months"}, ...months.reverse().map(m => { const i = Number(m.k.slice(5)) - 1; return h("li",null,
          h("span",{class:i===now.getMonth()?"now":""}, MONTHS[i]),
          h("span",{class:"barw"}, h("i",{style:"width:"+(Math.max(0,m.net)/maxV*100).toFixed(1)+"%"})),
          h("b",{class:"num",style:m.net<0?"color:var(--bad)":""}, money(Math.round(m.net)))); })))
    ];
  }

  function owedCell(rem){ // e.g. "200 $" and under it "≈ 10,000 ج.م"
    const keys = Object.keys(rem).filter(k => rem[k] > 0);
    const foreign = keys.some(k => k !== settings.currency);
    const baseSum = keys.reduce((a,k) => a + (k === settings.currency ? rem[k] : (rateNow(k) ? rem[k] * rateNow(k) : 0)), 0);
    return h("div",{class:"owed"}, h("span",{class:"amt num"}, moneyMap(rem)),
      foreign && baseSum ? h("small",{class:"alt-cur num"}, "≈ " + rawFmt(Math.round(baseSum)) + " " + CUR[settings.currency]) : null);
  }

  // ---------- zakat / sadaqa per finished project ----------
  const zkWord = () => settings.zakatMode === "sadaqa" ? "صدقة" : "زكاة";
  function recvBase(j){ const cur = curOf(j); return paysOf(j).filter(isRecv).reduce((a,p)=>a+(payBase(p,cur)||0),0); }
  function zakatDue(j){
    if (settings.zakatMode === "off" || j.status !== "done") return 0;
    return Math.max(0, Math.round(recvBase(j) * n(settings.zakatRate) / 100) - n(j.zakatPaid));
  }
  function markZakat(j){
    const amt = zakatDue(j); if (!amt) return;
    const nx = bodyOf(j); nx.zakatPaid = n(j.zakatPaid) + amt; nx.zakatLog = [...(Array.isArray(j.zakatLog) ? j.zakatLog : []), {amount:amt, date:todayStr(), mode:settings.zakatMode}];
    store.save(j.id, nx); toast("تقبّل الله منك");
  }
  let giveOpen = false;
  // record any amount you gave; it also settles what's pending on finished projects (oldest first)
  function saveGive(amount, date, note){
    let left = amount;
    for (const j of jobs.filter(j => zakatDue(j) > 0).sort((a,b) => (a.delivered||a.due||"").localeCompare(b.delivered||b.due||""))){
      if (left <= 0) break;
      const take = Math.min(left, zakatDue(j)); left -= take;
      const nx = bodyOf(j); nx.zakatPaid = n(j.zakatPaid) + take; all[j.id] = {...nx, id:j.id, updatedAt: Date.now(), dirty: true};
    }
    const id = newId();
    all[id] = {id, kind:"give", amount, date, note, mode: settings.zakatMode, ...altStamp(), updatedAt: Date.now(), dirty: true};
    persist(); refreshJobs(); render(); scheduleSync(); praise("تقبّل الله منك");
  }
  function zakatPanel(){
    if (settings.zakatMode === "off") return null;
    const y = String(new Date().getFullYear());
    const yGives = gives.filter(g => (g.date||"").startsWith(y)).sort((a,b) => (b.date||"").localeCompare(a.date||""));
    const paidYear = jobs.reduce((a,j) => a + (Array.isArray(j.zakatLog) ? j.zakatLog : []).filter(z => (z.date||"").startsWith(y)).reduce((x,z)=>x+n(z.amount),0), 0) + yGives.reduce((a,g)=>a+n(g.amount),0);
    const pend = jobs.filter(j => zakatDue(j) > 0);
    const pendSum = pend.reduce((a,j)=>a+zakatDue(j),0);
    const giveForm = giveOpen ? h("form",{class:"mini",style:"margin:0 18px 14px",onsubmit:e=>{
        e.preventDefault(); const a = n($("gvAmt").value); if (!(a > 0)){ toast("اكتب المبلغ"); return; }
        giveOpen = false; saveGive(a, $("gvDate").value || todayStr(), $("gvNote").value.trim());
      }},
      h("label",{class:"f money-in"},"المبلغ (" + CUR[settings.currency] + ")", h("input",{id:"gvAmt",type:"number",min:"0",step:"any",inputmode:"decimal",value: pendSum ? String(pendSum) : ""})),
      h("label",{class:"f"},"التاريخ", h("input",{id:"gvDate",type:"date",value:todayStr()})),
      h("label",{class:"f full"},"ملاحظة (اختياري)", h("input",{id:"gvNote",placeholder:"لمين أو فين…"})),
      h("div",{class:"full",style:"display:flex;gap:8px"}, h("button",{class:"btn primary sm",type:"submit"},"حفظ"), h("button",{class:"btn sm",type:"button",onclick:()=>{giveOpen=false;render();}},"إلغاء"))) : null;
    return h("section",{class:"panel"},
      h("div",{class:"panel-h"}, h("h2",null, zkWord()), !giveOpen ? h("button",{class:"btn primary sm",type:"button",onclick:()=>{ giveOpen = true; render(); setTimeout(()=>$("gvAmt")?.select(),30); }}, icon("i-plus"), "أخرجت مبلغ") : null),
      giveForm,
      h("div",{class:"sumgrid",style:"grid-template-columns:1fr 1fr"},
        h("div",null, h("span",null,"أخرجت في " + y), h("b",{class:"num",style:"color:var(--ok)"}, money(paidYear))),
        h("div",null, h("span",null,"لم تُخرج بعد"), h("b",{class:"num"}, money(pend.reduce((a,j)=>a+zakatDue(j),0))))),
      pend.length ? h("ul",{class:"xlist"}, ...pend.map(j => h("li",null,
        h("div",{class:"grow",onclick:()=>openSheet(j.id)}, h("b",null, j.title || "مشروع"), h("span",null, j.client || "")),
        h("span",{class:"amt num"}, money(zakatDue(j))),
        h("button",{class:"btn sm",type:"button",onclick:()=>markZakat(j)},"تم الإخراج ✓")))) : null,
      yGives.length ? h("ul",{class:"xlist"}, ...yGives.slice(0, 6).map(g => h("li",null,
        h("div",{class:"grow"}, h("b",null, g.note || (g.mode === "zakat" ? "زكاة" : "صدقة")), h("span",null, dlong(g.date))),
        h("span",{class:"amt num",style:"color:var(--ok)"}, money(n(g.amount))),
        h("button",{class:"btn ghost sm danger",type:"button","aria-label":"حذف",onclick:()=>{ if (confirm("تمسح المبلغ ده من السجل؟")) store.remove(g.id); }}, icon("i-x"))))) : null,
      h("div",{class:"hint",style:"padding:0 18px 10px"}, n(settings.zakatRate) + "% من كل مشروع بيخلص بتتحسب لوحدها هنا."),
      h("details",{class:"more",style:"padding:0 18px 14px"}, h("summary",null,"حاسبة الزكاة السنوية"), zakatCalc()),
      h("div",{class:"note",style:"padding:0 18px 14px"}, settings.zakatMode === "sadaqa"
        ? "تُسجَّل كصدقة. والزكاة الواجبة تكون على المال المدّخر إذا بلغ النصاب ومرّ عليه عام هجري."
        : "إخراجها مع كل مشروع جائز كتعجيل للزكاة، ويُحسب من زكاة العام. وتُصرف لمستحقي الزكاة. لحالتك الخاصة اسأل دار الإفتاء."));
  }
  function zakatCalc(){
    const out = h("div",{class:"note",style:"font-size:.9rem;color:var(--ink)"});
    const calc = () => {
      const g = n($("zkGold").value), sv = n($("zkSave").value);
      if (!g || !sv){ out.textContent = ""; return; }
      const nisab = 85 * g;
      out.textContent = sv >= nisab
        ? "مدخراتك فوق النصاب (" + rawFmt(Math.round(nisab)) + " " + CUR.EGP + "). الزكاة: " + rawFmt(Math.round(sv * 0.025)) + " " + CUR.EGP + " إذا مرّ عليها عام هجري."
        : "مدخراتك أقل من النصاب (" + rawFmt(Math.round(nisab)) + " " + CUR.EGP + "). لا زكاة واجبة عليها.";
    };
    return h("div",{class:"fgrid",style:"margin-top:10px"},
      h("label",{class:"f"},"سعر جرام الذهب عيار 21 اليوم", h("input",{id:"zkGold",type:"number",inputmode:"decimal",min:"0",oninput:calc})),
      h("label",{class:"f"},"كل المدخرات (نقدي + بنك + محافظ)", h("input",{id:"zkSave",type:"number",inputmode:"decimal",min:"0",oninput:calc})),
      h("div",{class:"full"}, out),
      h("div",{class:"full note"}, "النصاب = 85 جرام ذهب عيار 21 حسب دار الإفتاء المصرية، والزكاة 2.5%."));
  }

  // ---------- expenses ----------
  const ex = {id:null, cur:"EGP"};
  const EX_SUGG = ["اشتراك Adobe","Canva","Envato","كورس","إنترنت","أجهزة","طباعة","إعلانات"];
  function openExp(id){
    const e = id ? all[id] : null;
    ex.id = id; ex.cur = e && CUR[e.currency] ? e.currency : settings.currency;
    $("exTitle").textContent = e ? "تعديل مصروف" : "مصروف جديد";
    $("exAmt").value = e ? e.amount : ""; $("exNote").value = e ? (e.note||"") : "";
    $("exDate").value = e ? (e.date||todayStr()) : todayStr(); $("exRec").checked = !!(e && e.recurring);
    $("exDel").hidden = !e;
    document.querySelectorAll("#expDlg label.f.err").forEach(l=>l.classList.remove("err"));
    renderExp(); openDlg($("expDlg"));
    setTimeout(()=>$("exAmt").focus(), 40);
  }
  function renderExp(){
    $("exCur").replaceChildren(...CUR_ORDER.slice(0,3).concat(CUR_ORDER.slice(3)).map(k => h("button",{type:"button",class:"pick","aria-pressed":String(ex.cur===k),onclick:()=>{ex.cur=k;renderExp();}}, CUR[k])));
    $("exSugg").replaceChildren(...EX_SUGG.map(t => h("button",{type:"button",class:"pick",onclick:()=>{$("exNote").value=t; $("exNote").focus();}}, t)));
    syncDates($("expDlg"));
  }
  $("exClose").onclick = $("exCancel").onclick = () => $("expDlg").close();
  $("exDel").onclick = () => {
    const e = all[ex.id]; if (!e) return;
    if (e.recurring && !e.stopped){ const nx = bodyOf(e); nx.stopped = todayStr().slice(0,7); store.save(e.id, nx); toast("تم إيقاف المصروف الشهري"); }
    else { store.remove(ex.id); toast("تم حذف المصروف"); }
    $("expDlg").close();
  };
  $("exForm").addEventListener("submit", e => {
    e.preventDefault();
    const amt = n($("exAmt").value), note = $("exNote").value.trim();
    $("lExAmt").classList.toggle("err", !(amt > 0)); $("lExNote").classList.toggle("err", !note);
    if (!(amt > 0) || !note){ toast("أدخل المبلغ والوصف"); return; }
    const old = ex.id ? all[ex.id] : null;
    const data = {...(old ? bodyOf(old) : {}), kind:"expense", amount:amt, currency:ex.cur, note, date:$("exDate").value || todayStr(), recurring:$("exRec").checked};
    if (!data.recurring) delete data.stopped;
    if (ex.cur !== settings.currency && !(data.rate && data.rateBase === settings.currency)){ data.rate = rateNow(ex.cur); data.rateBase = settings.currency; }
    if (!(data.altRate && data.altBase === settings.currency)) Object.assign(data, altStamp());
    store.save(ex.id || newId(), data);
    $("expDlg").close(); toast(old ? "تم حفظ التعديل" : "تم تسجيل المصروف");
  });

  function waCard(){
    return h("button",{class:"wa-bar",type:"button",onclick:()=>openWa()},
      h("span",{class:"ic"}, icon("i-wa")), h("b",null,"الصق اتفاق من واتساب"), icon("i-chev","chev"));
  }

  // ---------- jobs ----------
  const matches = (j) => !query || [j.client,j.title,j.phone,typeText(j),j.notes].join(" ").toLowerCase().includes(query.toLowerCase());
  function jobsFiltered(){
    return jobs.filter(matches).filter(j => {
      switch(filter){
        case "active": return isOpen(j);
        case "late": return isLate(j);
        case "unpaid": return remOf(j) > 0;
        case "done": return j.status === "done";
        default: return true;
      }
    }).sort((a,b) => {
      const ao = isOpen(a), bo = isOpen(b);
      if (ao !== bo) return ao ? -1 : 1;
      if (ao) return (a.due||"9999").localeCompare(b.due||"9999");
      return (b.delivered||b.due||"").localeCompare(a.delivered||a.due||"");
    });
  }
  const searchBox = (ph) => h("label",{class:"search-w"}, icon("i-search"), h("input",{class:"search",id:"search",type:"search",placeholder:ph,value:query,oninput:e=>{query=e.target.value;render();}}));
  const jobsTabs = () => h("div",{class:"tabs2",role:"tablist"},
    h("button",{type:"button",role:"tab","aria-selected":String(jobsTab==="projects"),onclick:()=>{jobsTab="projects";render();}}, icon("i-jobs"), "المشاريع"),
    h("button",{type:"button",role:"tab","aria-selected":String(jobsTab==="clients"),onclick:()=>{jobsTab="clients";render();}}, icon("i-user"), "العملاء"));
  function viewJobs(){
    if (!jobs.length) return [emptyFirst()];
    const counts = {active:jobs.filter(isOpen).length, late:jobs.filter(isLate).length, unpaid:jobs.filter(j=>remOf(j)>0).length, done:jobs.filter(j=>j.status==="done").length, all:jobs.length};
    const tb = h("div",{class:"jtools"},
      h("div",{class:"jbar"}, jobsTabs(), searchBox("ابحث بالعميل أو المشروع أو الرقم")),
      h("div",{class:"chips",role:"group","aria-label":"فلتر"}, ...FILTERS.map(([k,t]) => h("button",{type:"button",class:"chip" + (k==="late" && counts[k] ? " warn" : "") + (!counts[k] ? " zero" : ""),"aria-pressed":String(filter===k),onclick:()=>{filter=k;LS.set("ledger.filter",k);render();}}, t, h("b",{class:"num"},counts[k])))));
    const list = jobsFiltered();
    if (!list.length) return [tb, h("div",{class:"empty"}, h("h2",null,"لا توجد مشاريع"), h("p",null, query ? "لا توجد نتائج لهذا البحث." : "جرّب فلتراً آخر."),
      query ? h("button",{class:"btn",type:"button",onclick:()=>{query="";render();}},"مسح البحث") : null)];
    return [tb, h("div",{class:"jtable"},
      h("div",{class:"jhead"}, h("span",null,"المشروع"), h("span",null,"الحالة"), h("span",null,"التسليم"), h("span",null,"الدفع"), h("span",null,"المتبقي"), h("span")),
      ...list.map(jobRow))];
  }
  function jobRow(j){
    const paid = paidOf(j), price = n(j.price), rem = remOf(j), cur = curOf(j);
    const pct = price ? Math.min(100, paid/price*100) : 0;
    return h("button",{type:"button",class:"jrow"+(isLate(j)?" is-late":""),onclick:()=>openSheet(j.id)},
      h("div",{class:"jt"}, h("b",null, j.title||"بدون اسم"), h("span",null, (j.client||"—") + (typeText(j) ? " · " + typeText(j) : ""))),
      h("div",{class:"jst"}, stPill(j)),
      h("div",{class:"jdue"}, h("span",{class:"num"}, dshort(j.due)), cdChip(j)),
      h("div",{class:"jmoney"}, h("span",{class:"num"}, "المدفوع "+fmt(paid)+" من "+money(price,cur)), h("div",{class:"meter"+(pct>=100?" full":"")}, h("i",{style:"width:"+pct.toFixed(1)+"%"}))),
      h("div",{class:"jremw"}, h("span",{class:"lbl-m"},"المتبقي"), h("span",{class:"jrem num "+(rem>0?"has":"zero")}, rem>0?money(rem,cur):"مدفوع بالكامل")),
      icon("i-chev","chev"));
  }

  // ---------- clients ----------
  function clientsList(){
    const map = new Map();
    for (const j of jobs){
      const key = (j.client||"—").trim();
      if (!map.has(key)) map.set(key,{name:key, phone:"", count:0, open:0, paid:{}, rem:{}});
      const c = map.get(key);
      if (j.phone && !c.phone) c.phone = j.phone;
      c.count++; if (isOpen(j)) c.open++;
      addTo(c.paid, curOf(j), paidOf(j)); addTo(c.rem, curOf(j), remOf(j));
    }
    const remMain = (c) => Object.values(c.rem).reduce((a,b)=>a+b,0);
    return [...map.values()].sort((a,b)=> remMain(b) - remMain(a) || b.count - a.count);
  }
  function viewClients(){
    if (!jobs.length) return [emptyFirst()];
    const list = clientsList().filter(c => !query || (c.name+" "+c.phone).toLowerCase().includes(query.toLowerCase()));
    const tb = h("div",{class:"jtools"}, h("div",{class:"jbar"}, jobsTabs(), searchBox("ابحث باسم العميل أو رقمه")));
    if (!list.length) return [tb, h("div",{class:"empty"}, h("h2",null,"لا يوجد عميل بهذا الاسم"))];
    return [tb, h("div",{class:"cgrid"}, ...list.map(c => {
      const owes = Object.values(c.rem).some(v=>v>0);
      return h("article",{class:"ccard"},
        h("div",{class:"top"}, h("span",{class:"avatar"}, initials(c.name)), h("div",null, h("b",null,c.name), h("span",null,c.phone||"بدون رقم"))),
        h("div",{class:"stats"},
          h("div",null, h("span",null,"المشاريع"), h("b",{class:"num"}, c.count + (c.open ? " ("+c.open+" جاري)" : ""))),
          h("div",null, h("span",null,"المدفوع"), h("b",{class:"num"}, moneyMap(c.paid))),
          h("div",null, h("span",null,"المتبقي"), h("b",{class:"num jrem "+(owes?"has":"zero")}, owes ? moneyMap(c.rem) : "مدفوع بالكامل"))),
        h("div",{class:"acts"},
          h("button",{class:"btn sm",type:"button",onclick:()=>showClient(c.name)},"مشاريعه"),
          h("button",{class:"btn sm",type:"button",onclick:()=>openForm(null,{client:c.name,phone:c.phone})}, icon("i-plus"), "مشروع جديد له")));
    }))];
  }
  function showClient(name){ query = name; filter = "all"; jobsTab = "projects"; go("jobs"); }

  // ---------- settings ----------
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; render(); });
  window.addEventListener("appinstalled", () => { installEvt = null; toast("تم تثبيت التطبيق ✓"); render(); });
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const inAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|; wv\)|Claude/i.test(navigator.userAgent);
  const isIOSSafari = isIOS && /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
  function installCard(){
    if (isStandalone() || LS.get("ledger.hideInstall", false)) return null;
    const close = h("button",{class:"btn ghost sm",type:"button","aria-label":"إخفاء",onclick:()=>{ LS.set("ledger.hideInstall", true); render(); }}, icon("i-x"));
    let text, btn = null;
    if (installEvt){ text = "ثبّت التطبيق على جهازك علشان يفتح بأيقونته ويشتغل من غير نت."; btn = h("button",{class:"btn primary",type:"button",onclick:async()=>{ installEvt.prompt(); try{ await installEvt.userChoice; }catch(e){} installEvt=null; render(); }}, "ثبّت التطبيق"); }
    else if (inAppBrowser) text = "علشان تثبّت التطبيق، افتح اللينك ده من متصفح Chrome (أو Safari على الآيفون)، مش من جوه واتساب أو أي تطبيق تاني.";
    else if (isIOS && !isIOSSafari) text = "على الآيفون التثبيت بيتعمل من Safari بس: افتح اللينك في Safari، واضغط زرار المشاركة، واختار «إضافة إلى الشاشة الرئيسية».";
    else if (isIOS) text = "علشان تثبّت التطبيق: اضغط زرار المشاركة تحت، واختار «إضافة إلى الشاشة الرئيسية».";
    else text = "علشان تثبّت التطبيق: من قايمة المتصفح ⋮ اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».";
    return h("div",{class:"wa-card",style:"background:var(--grad-soft),var(--card)"},
      h("span",{class:"ic",style:"background:var(--grad);color:#fff"}, icon("i-reg")),
      h("div",{class:"tx"}, h("b",null,"نزّل «دفتر المصمم» كتطبيق"), h("span",null,text)),
      btn, close);
  }

  function viewSettings(){
    const curSel = (id, val, onch) => h("select",{id,class:"search",style:"flex:none;width:auto",onchange:onch}, ...Object.keys(CUR).map(k=>h("option",{value:k,selected:val===k?true:null}, CUR_NAME[k]+" ("+CUR[k]+")")));
    const st = syncState();
    const last = settings.lastBackup; const age = last ? -daysUntil(last) : null;
    const fileIn = h("input",{type:"file",id:"bkFile",accept:".json,application/json",hidden:true,onchange:e=>{ if (e.target.files[0]) readBackup(e.target.files[0]); e.target.value=""; }});
    return [h("div",{class:"sets"},
      linkPanel(),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"عام")),
        h("div",null,
          h("label",{class:"f"},"العملة الأساسية", curSel("sCur", settings.currency, e=>{settings.currency=e.target.value; saveSettings(); fetchRates(true); render();})),
          h("div",null, h("span",{class:"flabel"},"العملة اللي تظهر تحت المبالغ بخط صغير"),
            h("div",{class:"picks"}, ...CUR_ORDER.filter(k => k !== settings.currency).map(k => h("button",{type:"button",class:"pick","aria-pressed":String(altCode()===k),onclick:()=>{settings.altCur=k; saveSettings(); render();}}, CUR_NAME[k] + " " + CUR[k])))),
          h("div",null,
            h("p",null, settings.rates && settings.rates.base === settings.currency && Object.keys(settings.rates.map).length
              ? "أسعار الصرف (" + new Date(settings.rates.at).toLocaleDateString("ar-EG") + "): " + ["USD","SAR","AED","KWD","EUR"].filter(k=>k!==settings.currency && settings.rates.map[k]).map(k => "1 " + CUR[k] + " = " + fmtRate(settings.rates.map[k]) + " " + CUR[settings.currency]).join(" · ")
              : "لم يتم تحميل أسعار الصرف بعد. يتم تحديثها تلقائياً عند الاتصال بالإنترنت."),
            h("button",{class:"btn sm ghost",type:"button",style:"color:var(--accent);padding-inline:0",onclick:()=>fetchRates(true)},"تحديث أسعار الصرف")),
          h("label",{class:"f"},"اسمك كما يظهر في واتساب", h("input",{id:"sName",value:settings.myName,placeholder:"ليميّز الدفتر بين رسائلك ورسائل العميل",onchange:e=>{settings.myName=e.target.value.trim(); saveSettings(); toast("تم الحفظ");}})),
          isStandalone() ? h("p",null,"✓ التطبيق مثبّت على هذا الجهاز.")
            : installEvt ? h("button",{class:"btn primary",type:"button",onclick:async()=>{ installEvt.prompt(); try{ await installEvt.userChoice; }catch(e){} installEvt=null; render(); }}, "تثبيت التطبيق على هذا الجهاز")
            : h("p",null, isIOS ? "للتثبيت على الآيفون: اضغط زر المشاركة في Safari واختر «Add to Home Screen»." : "للتثبيت: من قائمة المتصفح اختر «Install app» أو «Add to Home screen».")
        )),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"الخصوصية والحماية")),
        h("div",null, ...lockSettings(),
          h("label",{style:"display:flex;gap:8px;align-items:center"}, h("input",{type:"checkbox",checked:settings.hideOnOpen?true:null,style:"width:18px;height:18px",onchange:e=>{settings.hideOnOpen=e.target.checked; saveSettings(); toast(e.target.checked ? "المبالغ هتبقى مخفية عند فتح التطبيق" : "تم");}}), "إخفاء المبالغ عند فتح التطبيق"),
          h("p",{class:"note"},"زر العين بجانب عنوان الصفحة يُظهر المبالغ ويخفيها في أي وقت."))),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"شاشة البداية")),
        h("div",null,
          h("p",null,"دعاء قصير عند فتح التطبيق، ويُغلق وحده بعد ثوانٍ قليلة أو بلمسة."),
          h("div",{class:"picks"}, ...[["daily","أول مرة في اليوم"],["always","كل مرة"],["off","إيقاف"]].map(([k,t]) => h("button",{type:"button",class:"pick","aria-pressed":String(settings.splash===k),onclick:()=>{settings.splash=k; saveSettings(); render();}}, t))))),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"الزكاة")),
        h("div",null,
          h("p",null,"عند تسليم كل مشروع يظهر " + n(settings.zakatRate) + "% مما استلمته منه، لتُخرجه وتضغط «تم الإخراج»."),
          h("div",{class:"picks"}, ...[["zakat","زكاة معجّلة"],["sadaqa","صدقة"],["off","إيقاف"]].map(([k,t]) => h("button",{type:"button",class:"pick","aria-pressed":String(settings.zakatMode===k),onclick:()=>{settings.zakatMode=k; saveSettings(); render();}}, t))),
          h("p",{class:"note"}, "الزكاة المعجّلة تُحسب من زكاة العام وتُصرف لمستحقيها، والصدقة لأي باب خير. لحالتك الخاصة اسأل دار الإفتاء."))),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"التنبيهات")),
        h("div",null,
          h("p",null,"التذكير قبل موعد التسليم بـ:"),
          h("div",{class:"picks"}, ...[1,2,3,4].map(k => h("button",{type:"button",class:"pick","aria-pressed":String(settings.remindDays===k),onclick:()=>{ settings.remindDays=k; saveSettings(); for (const j of Object.values(all)) if (!j.deleted && j.due) j.dirty = true; persist(); render(); scheduleSync(); }}, dayWord(k)))),
          h("p",{class:"note"},"التطبيق بيطلّعلك إشعار قبل الميتنج بنص ساعة، والساعة 10 الصبح يوم التسليم، وهو مفتوح أو في الخلفية. ولو عايز تتفكّر والتطبيق مقفول خالص، دوس زرار 📅 وضيف الميعاد لتقويمك."),
          h("div",{class:"row-btns"},
            "Notification" in window && Notification.permission === "granted" ? h("span",{class:"cd c-done"},"✓ إشعارات التطبيق مفعّلة")
              : h("button",{class:"btn sm",type:"button",onclick:enableNotify},"تفعيل إشعارات التطبيق"),
            h("button",{class:"btn sm primary",type:"button",onclick:testPing}, "🔔 جرّب الإشعار"),
            h("span",{class:"hint"},"وتعرض أيقونة التطبيق عدد المشاريع التي اقترب موعد تسليمها.")))),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"نسخة احتياطية"), h("span",{class:"cd " + (jobs.length && (age===null||age>14) ? "c-soon" : "c-ok")}, last ? "آخر نسخة " + (age === 0 ? "اليوم" : "من " + dayWord(age)) : "لم يتم إنشاء نسخة بعد")),
        h("div",null,
          h("p",null,"ملف Excel يُفتح في أي برنامج، والنسخة الكاملة تستعيد الدفتر كما هو على أي جهاز، بما في ذلك النسخة المنزّلة من دفتر Claude."),
          bk.pending ? h("div",{class:"confirm",style:"background:var(--warn-soft);color:var(--warn)"},
            "سيتم استعادة " + bk.pending.list.length + " مشروع (" + bk.pending.isNew + " جديد، والباقي سيُحدَّث).",
            h("button",{class:"btn sm primary",type:"button",onclick:restore},"استعادة"),
            h("button",{class:"btn sm",type:"button",onclick:()=>{bk.pending=null;render();}},"إلغاء")) : null,
          h("div",{class:"row-btns"},
            h("button",{class:"btn sm",type:"button",disabled:!(jobs.length||expenses.length)?true:null,onclick:()=>download("دفتر-المصمم-"+todayStr()+".csv", backupCsv(), "text/csv")},"تنزيل ملف Excel"),
            h("button",{class:"btn sm",type:"button",disabled:!(jobs.length||expenses.length)?true:null,onclick:()=>download("دفتر-المصمم-نسخة-"+todayStr()+".json", backupJson(), "application/json")},"تنزيل نسخة كاملة"),
            h("label",{class:"btn sm ghost",for:"bkFile",style:"color:var(--accent)"},"استعادة من نسخة"), fileIn)))
    )];
  }

  // ---------- backup ----------
  const bk = {pending:null};
  function download(name, data, type){
    const blob = new Blob([data], {type: type + ";charset=utf-8"});
    const a = h("a",{href:URL.createObjectURL(blob),download:name});
    document.body.append(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    settings.lastBackup = todayStr(); saveSettings(); render();
  }
  const backupJson = () => JSON.stringify({app:"studio-ledger", version:2, exportedAt:new Date().toISOString(), currency:settings.currency, jobs: jobs.concat(expenses, gives).map(j=>({...bodyOf(j), id:j.id}))}, null, 1);
  function backupCsv(){
    const cell = v => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g,'""') + '"'; };
    const head = ["العميل","الرقم","المشروع","النوع","الحالة","العملة","السعر","المدفوع","المدفوع بالـ" + CUR[settings.currency],"المتبقي","البدء","الإنجاز","التسليم","تم التسليم","التعديلات","الدفعات","ملاحظات"];
    const rows = jobs.map(j => [j.client, j.phone, j.title, typeText(j), (STATUS[j.status]||STATUS.new).t, CUR[curOf(j)], n(j.price), paidOf(j), Math.round(paysOf(j).reduce((a,p)=>a+(payBase(p,curOf(j))||0),0)), remOf(j), j.start, j.finish, j.due, j.delivered, j.revisions,
      paysOf(j).map(p => rawFmt(p.amount) + " (" + (p.date||"") + (p.rate ? " سعر " + fmtRate(p.rate) : "") + (p.note ? " " + p.note : "") + ")").join(" + "), j.notes]);
    return "﻿" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
  }
  function readBackup(file){
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(String(r.result));
        const list = Array.isArray(obj) ? obj : obj && Array.isArray(obj.jobs) ? obj.jobs : null;
        const clean = (list||[]).filter(j => j && typeof j === "object" && typeof j.id === "string" && j.id.length < 200).slice(0, 5000);
        if (!clean.length) throw 0;
        bk.pending = {list: clean, isNew: clean.filter(j=>!all[j.id]).length, currency: obj.currency};
        render();
      } catch(e){ toast("هذا الملف ليس نسخة احتياطية من الدفتر"); }
    };
    r.readAsText(file);
  }
  function restore(){
    const p = bk.pending; if (!p) return;
    const fallbackCur = Object.values(CUR).indexOf(p.currency) >= 0 ? Object.keys(CUR)[Object.values(CUR).indexOf(p.currency)] : (CUR[p.currency] ? p.currency : settings.currency);
    for (const j of p.list){
      const data = bodyOf(j);
      data.payments = Array.isArray(data.payments) ? data.payments : [];
      if (!CUR[data.currency]) data.currency = fallbackCur;
      all[j.id] = {...data, id:j.id, updatedAt: Date.now(), dirty: true};
    }
    persist(); refreshJobs(); bk.pending = null; render(); scheduleSync();
    toast("تمت استعادة " + p.list.length + " مشروع");
  }

  // ---------- add / edit form ----------
  const wz = {id:null, types:[], cur:"EGP", phases:[], finishAuto:true, depRecv:false, onSaved:null};
  const daysBetween = (a, b) => { const x = parseD(a), y = parseD(b); return x && y ? Math.round((y - x) / 86400000) : ""; };
  const CUR_ORDER = ["EGP","SAR","USD","AED","KWD","EUR"];
  function openForm(id, preset){
    const j = id ? all[id] : null;
    wz.id = id; wz.onSaved = preset?.onSaved || null; wz.depRecv = false;
    $("wzTitle").textContent = j ? "تعديل المشروع" : "مشروع جديد";
    $("wzSave").textContent = j ? "حفظ التعديلات" : "حفظ المشروع";
    const src = j || preset || {};
    $("fClient").value = src.client || "";
    $("fPhone").value = src.phone || "";
    $("fTitle").value = src.title || "";
    $("fPrice").value = src.price ?? "";
    wz.cur = CUR[src.currency] ? src.currency : settings.currency;
    $("fRate").value = "";
    $("fDeposit").value = !j && preset?.deposit ? preset.deposit : "";
    $("lDeposit").hidden = !!j;
    $("fRevs").value = src.revisions !== "" && src.revisions != null ? src.revisions : "";
    $("fStart").value = src.start || (j ? "" : todayStr());
    $("fDue").value = src.due || "";
    $("fFinish").value = src.finish || "";
    wz.finishAuto = !src.finish;
    wz.phases = backfillPhases(phasesOf(src), src.start);
    $("fDays").value = src.due ? daysBetween($("fStart").value || todayStr(), src.due) : "";
    $("fNotes").value = src.notes || "";
    wz.types = typesOf(src).filter(t => TYPES.includes(t));
    $("more").open = !!(src.notes || src.revisions);
    document.querySelectorAll("label.f.err").forEach(l=>l.classList.remove("err"));
    renderForm();
    openDlg($("wizDlg"));
    setTimeout(()=>{ const f = !$("fClient").value ? $("fClient") : !$("fTitle").value ? $("fTitle") : $("fPrice"); f.focus(); }, 40);
  }
  function renderForm(){
    const names = clientsList().filter(c=>c.name!=="—").slice(0,8);
    $("clientPicks").replaceChildren(...(names.length && !wz.id ? [h("span",{class:"flabel"},"عميل سابق؟ اختر اسمه"),
      h("div",{class:"picks"}, ...names.map(c => h("button",{type:"button",class:"pick","aria-pressed":String($("fClient").value.trim()===c.name),
        onclick:()=>{ $("fClient").value=c.name; $("fPhone").value=c.phone||""; renderForm(); $("fTitle").focus(); }}, c.name)))] : []));
    $("curPicks").replaceChildren(...CUR_ORDER.map(k => h("button",{type:"button",class:"pick","aria-pressed":String(wz.cur===k),onclick:()=>{wz.cur=k; renderForm();}}, CUR_NAME[k] + " " + CUR[k])));
    document.querySelectorAll("#wizDlg .cur").forEach(e => e.textContent = CUR[wz.cur]);
    const foreign = wz.cur !== settings.currency && !wz.id;
    $("lRate").hidden = !foreign;
    if (foreign){ $("lRateT").textContent = "سعر الصرف: 1 " + CUR[wz.cur] + " = " + CUR[settings.currency]; if (!$("fRate").value && rateNow(wz.cur)) $("fRate").value = rateNow(wz.cur); }
    $("typePicks").replaceChildren(...TYPES.map(t => h("button",{type:"button",class:"pick","aria-pressed":String(wz.types.includes(t)),onclick:()=>{wz.types = wz.types.includes(t) ? wz.types.filter(x=>x!==t) : [...wz.types, t]; renderForm();}}, t)));
    renderPhases();
    updateRemLine();
    syncDates($("wizDlg"));
  }
  function renderDepRecv(){
    $("depRecv").hidden = !!wz.id || !n($("fDeposit").value);
    $("depRecv").replaceChildren(...[[false,"قيد التحويل"],[true,"وصل حسابي"]].map(([v,t]) => h("button",{type:"button",class:"pick","aria-pressed":String(wz.depRecv===v),onclick:()=>{wz.depRecv=v; renderDepRecv();}}, t)));
  }
  function updateRemLine(){
    renderDepRecv();
    const el = $("remLine"), price = n($("fPrice").value);
    const paid = wz.id && all[wz.id] ? paidOf(all[wz.id]) : n($("fDeposit").value);
    if (!$("fPrice").value || !price){ el.hidden = true; return; }
    el.hidden = false;
    el.replaceChildren(price - paid > 0 ? "المتبقي على العميل: " : "", price - paid > 0 ? h("b",{class:"num"}, rawFmt(price - paid) + " " + CUR[wz.cur]) : h("b",{class:"num",style:"color:var(--ok)"}, "مدفوع بالكامل ✓"));
  }
  $("fPrice").addEventListener("input", updateRemLine);
  $("fDeposit").addEventListener("input", updateRemLine);
  // phases: each phase has its own start and end; the whole project runs from the first start to the last end
  function backfillPhases(list, start){
    let cur = start || todayStr();
    return list.map(p => { const st = p.start || cur, du = p.due || addDays(st, n(p.days) || 7); cur = du; return {...p, start:st, due:du}; });
  }
  const phaseCount = (k) => k === 1 ? "مرحلة واحدة" : k === 2 ? "مرحلتين" : k + " مراحل";
  function syncFromPhases(){
    const has = wz.phases.length > 0;
    $("daysRow").classList.toggle("computed", has); $("startRow").classList.toggle("computed", has);
    $("fDays").readOnly = has; $("fDue").readOnly = has; $("fStart").readOnly = has;
    $("phSum").hidden = !has;
    if (has){
      const starts = wz.phases.map(p => p.start).filter(Boolean).sort(), ends = wz.phases.map(p => p.due).filter(Boolean).sort();
      const s0 = starts[0] || todayStr(), e1 = ends[ends.length-1] || s0, total = daysBetween(s0, e1);
      $("fStart").value = s0; $("fDue").value = e1; $("fDays").value = total;
      if (wz.finishAuto) $("fFinish").value = addDays(e1, -1);
      $("phSum").replaceChildren("المشروع كله: من ", h("b",null, dshort(s0)), " لـ ", h("b",null, dshort(e1)), " · " + dayWord(total) + " · " + phaseCount(wz.phases.length));
    }
    syncDates($("wizDlg"));
  }
  function renderPhases(){
    $("phases").replaceChildren(...wz.phases.map((p, i) => {
      const sIn = h("input",{type:"date",value:p.start||"","aria-label":"تبدأ"});
      const eIn = h("input",{type:"date",value:p.due||"","aria-label":"تخلص"});
      const dIn = h("input",{type:"number",min:"1",inputmode:"numeric",value:p.start && p.due ? daysBetween(p.start, p.due) : "","aria-label":"عدد الأيام"});
      sIn.addEventListener("input", () => { p.start = sIn.value; if (p.start && dIn.value !== ""){ p.due = addDays(p.start, n(dIn.value)); eIn.value = p.due; } syncFromPhases(); });
      eIn.addEventListener("input", () => { p.due = eIn.value; dIn.value = p.start && p.due ? daysBetween(p.start, p.due) : ""; syncFromPhases(); });
      dIn.addEventListener("input", () => { if (p.start && dIn.value !== ""){ p.due = addDays(p.start, n(dIn.value)); eIn.value = p.due; } syncFromPhases(); });
      return h("div",{class:"ph-card"},
        h("div",{class:"ph-top"}, h("span",{class:"ph-n num"}, String(i+1)),
          h("input",{class:"ph-title",value:p.title||"",placeholder:"اسم المرحلة (مثلاً: اللوجو)","aria-label":"اسم المرحلة",oninput:e=>{p.title=e.target.value;}}),
          h("button",{class:"btn ghost sm danger",type:"button","aria-label":"حذف المرحلة",onclick:()=>{wz.phases.splice(i,1); renderPhases();}}, icon("i-x"))),
        h("div",{class:"ph-dates"}, h("label",{class:"f"},"تبدأ", sIn), h("label",{class:"f"},"تخلص", eIn), h("label",{class:"f ph-days"},"أيام", dIn)));
    }));
    $("addPhase").lastChild.textContent = wz.phases.length ? "مرحلة أخرى" : "تقسيم التسليم على مراحل";
    syncFromPhases();
  }
  $("addPhase").addEventListener("click", () => {
    const last = wz.phases[wz.phases.length-1];
    const start = last && last.due ? last.due : ($("fStart").value || todayStr());
    const days = !wz.phases.length ? (n($("fDays").value) || 7) : 7;
    wz.phases.push({id:newId(), title:"", start, due:addDays(start, days)});
    renderPhases();
    const ins = $("phases").querySelectorAll(".ph-title"); ins[ins.length-1].focus();
  });
  $("fDays").addEventListener("input", () => {
    if (wz.phases.length) return;
    const d = $("fDays").value;
    if (d === "") return;
    $("fDue").value = addDays($("fStart").value || todayStr(), n(d));
    if (wz.finishAuto) $("fFinish").value = addDays($("fDue").value, -1);
    syncDates($("wizDlg"));
  });
  $("fDue").addEventListener("input", () => {
    if (wz.phases.length) return;
    $("fDays").value = $("fDue").value ? daysBetween($("fStart").value || todayStr(), $("fDue").value) : "";
    if (wz.finishAuto && $("fDue").value) $("fFinish").value = addDays($("fDue").value, -1);
  });
  $("fFinish").addEventListener("input", () => { wz.finishAuto = !$("fFinish").value; });
  $("fStart").addEventListener("input", () => { if (wz.phases.length) return; else if ($("fDays").value !== "") $("fDays").dispatchEvent(new Event("input")); });
  $("wzClose").onclick = $("wzCancel").onclick = () => $("wizDlg").close();
  $("wzForm").addEventListener("submit", e => { e.preventDefault(); saveForm(); });
  function saveForm(){
    let first = null;
    const mark = (lid, bad) => { $(lid).classList.toggle("err", bad); if (bad && !first) first = $(lid).querySelector("input"); };
    mark("lClient", !$("fClient").value.trim()); mark("lTitle", !$("fTitle").value.trim()); mark("lPrice", $("fPrice").value === "" || n($("fPrice").value) < 0);
    if (first){ first.focus(); toast("أدخل اسم العميل واسم المشروع والسعر"); return; }
    const j = wz.id ? all[wz.id] : null;
    const start = $("fStart").value || (j ? "" : todayStr());
    const data = j ? bodyOf(j) : {payments:[], status: start > todayStr() ? "new" : "work", delivered:"", createdAt:new Date().toISOString()};
    Object.assign(data, {
      client:$("fClient").value.trim(), phone:$("fPhone").value.trim(), title:$("fTitle").value.trim(), types: wz.types.length ? wz.types : ["أخرى"], type: (wz.types.length ? wz.types : ["أخرى"]).join(" + "),
      price:n($("fPrice").value), currency:wz.cur, revisions: $("fRevs").value === "" ? "" : n($("fRevs").value),
      start, due:$("fDue").value, finish:$("fFinish").value, notes:$("fNotes").value.trim()
    });
    data.phases = wz.phases.filter(p => p.start && p.due).map((p,i) => ({id:p.id || newId(), title:(p.title||"").trim() || "المرحلة " + (i+1), start:p.start, due:p.due, days:daysBetween(p.start, p.due), done:!!p.done, doneDate:p.doneDate||"", ...(p.state ? {state:p.state} : {}), ...(p.notes ? {notes:p.notes} : {})}));
    if (data.phases.length){ data.start = data.phases.map(p=>p.start).sort()[0]; data.due = data.phases.map(p=>p.due).sort().pop(); }
    if (!j){ const dep = n($("fDeposit").value); if (dep > 0) data.payments = [stampPay({amount:dep, date:start||todayStr(), note:"عربون", rate: n($("fRate").value) || null, ...(wz.depRecv ? {} : {received:false})}, wz.cur)]; }
    const id = wz.id || newId();
    store.save(id, data);
    $("wizDlg").close();
    if (wz.onSaved){ const cb = wz.onSaved; wz.onSaved = null; cb(id); }
    toast(j ? "تم حفظ التعديلات" : "تم تسجيل المشروع");
  }

  // ---------- details sheet ----------

  // ---------- project stages: ordered, each with a clear state, its review meeting and its own notes ----------
  const STAGE = {todo:{t:"لسه",c:"st-todo"}, doing:{t:"قيد التنفيذ",c:"st-doing"}, done:{t:"تمت ✓",c:"st-done"}};
  function stageState(list, i){
    const p = list[i]; if (p.done) return "done";
    if (p.state === "doing" || p.state === "todo") return p.state;
    return list.findIndex(q => !q.done) === i ? "doing" : "todo";
  }
  let stageAdd = null, stageMeet = null;
  function setStage(j, i, st){
    const list = phasesOf(j), was = stageState(list, i);
    if (was === st) return;
    const nx = bodyOf(j);
    nx.phases = list.map((q, k) => k !== i ? q : {...q, state: st, done: st === "done", doneDate: st === "done" ? todayStr() : ""});
    if (st === "done"){ const nxt = nx.phases.findIndex((q, k) => k > i && !q.done); if (nxt >= 0 && !nx.phases.some(q => q.state === "doing" && !q.done)) nx.phases[nxt] = {...nx.phases[nxt], state:"doing"}; }
    store.save(j.id, nx);
    if (st === "done") praise("خلصت مرحلة «" + (list[i].title || ("المرحلة " + (i+1))) + "»", true); else toast("تم الحفظ ✓ " + STAGE[st].t);
  }
  const noteTimers = {};
  function saveStageNote(j, pid, val){
    clearTimeout(noteTimers[pid]);
    noteTimers[pid] = setTimeout(() => {
      const cur = jobs.find(x => x.id === j.id); if (!cur) return;
      const nx = bodyOf(cur); nx.phases = phasesOf(cur).map(q => q.id === pid ? {...q, notes: val} : q);
      all[cur.id] = {...nx, id: cur.id, updatedAt: Date.now(), dirty: true}; persist(); refreshJobs(); scheduleSync();
    }, 600);
  }
  const saveJ = (j, nx, msg) => { store.save(j.id, nx); toast(msg); };
  function meetDone(j, m){
    const nx = bodyOf(j); nx.meetings = meetingsOf(j).map(x => x.id === m.id ? {...x, done: !m.done} : x);
    saveJ(j, nx, m.done ? "تم الحفظ ✓" : "تم الاجتماع ✓");
  }
  const meetCheck = (j, m) => h("button",{class:"chk" + (m.done ? " on" : ""),type:"button","aria-pressed":String(!!m.done),title:m.done ? "تم" : "علّم إنه تم","aria-label":"تم الاجتماع",onclick:()=>meetDone(j, m)}, m.done ? "✓" : "");
  const MEET_KINDS = [["ideas","عرض أفكار"],["sketch","اسكتشات وتجارب"],["dir","دايركشنز"],["strategy","استراتيجية"],["final","عرض الشغل"],["client","طلب من العميل"]];
  const kindName = (k) => (MEET_KINDS.find(x => x[0] === k) || [])[1] || "";
  const meetTitle = (m) => { const t = m.title || "اجتماع", k = kindName(m.kind); return k && t.startsWith(k + " — ") ? t.slice(k.length + 3) : t; };
  // one tap picks the meeting type and writes the title for you (you can still change it)
  function kindPicks(inputId, about, cur){
    return h("div",{class:"full kind-picks"}, ...MEET_KINDS.map(([k, t]) => h("button",{type:"button",class:"pick sm","aria-pressed":String(cur === k),onclick:e=>{
      const f = e.target.closest("form"), inp = $(inputId), on = f.dataset.kind !== k;
      f.dataset.kind = on ? k : "";
      for (const b of f.querySelectorAll(".kind-picks .pick")) b.setAttribute("aria-pressed", "false");
      e.target.setAttribute("aria-pressed", String(on));
      if (on && inp) inp.value = t + (about ? " — " + about : "");
    }}, t)));
  }
  let meetEdit = "";
  // edit a meeting in place: tap ✎, change anything, save
  function meetEditForm(j, m){
    const ph = phasesOf(j).find(p => p.id === m.phaseId);
    return h("form",{class:"mini meet-edit","data-kind":m.kind || "",onsubmit:e=>{
        e.preventDefault();
        const nx = bodyOf(j), kind = e.target.dataset.kind || "";
        nx.meetings = meetingsOf(j).map(x => x.id !== m.id ? x : {...x, kind, title:$("meT").value.trim() || "اجتماع", date:$("meD").value || x.date, time:$("meH").value || "", notes:$("meN").value.trim()});
        meetEdit = ""; saveJ(j, nx, "تم تعديل الاجتماع ✓");
      }},
      kindPicks("meT", ph ? ph.title : j.client, m.kind),
      h("label",{class:"f full"},"العنوان", h("input",{id:"meT",value:m.title || ""})),
      h("label",{class:"f"},"اليوم", h("input",{id:"meD",type:"date",value:m.date || todayStr()})),
      h("label",{class:"f"},"الساعة", h("input",{id:"meH",type:"time",value:m.time || ""})),
      h("label",{class:"f full"},"تفاصيل", h("textarea",{id:"meN",rows:"2",placeholder:"المكان، اللينك، اللي هتعرضه…"}, m.notes || "")),
      h("div",{class:"full",style:"display:flex;gap:8px"},
        h("button",{class:"btn primary sm",type:"submit"},"حفظ التعديل"),
        h("button",{class:"btn sm",type:"button",onclick:()=>{meetEdit="";renderSheet();}},"إلغاء")));
  }
  const meetEditBtn = (m, at) => h("button",{class:"btn ghost sm icon-only",type:"button","aria-label":"تعديل الاجتماع",title:"تعديل",onclick:()=>{ meetEdit = at + ":" + m.id; renderSheet(); setTimeout(()=>$("meT")?.focus(),30); }}, icon("i-edit"));
  function stagesBlock(j){
    const list = phasesOf(j), meets = meetingsOf(j);
    const doneN = list.filter(p => p.done).length;
    const addForm = stageAdd ? h("form",{class:"mini",onsubmit:e=>{
        e.preventDefault();
        const t = $("sgTitle").value.trim(); if (!t) return;
        const last = list[list.length-1], start = last && last.due ? last.due : (j.start || todayStr());
        const nx = bodyOf(j); nx.phases = [...list, {id:newId(), title:t, start, due:addDays(start, 7), days:7, done:false, doneDate:""}];
        nx.start = nx.phases.map(p=>p.start).sort()[0]; nx.due = nx.phases.map(p=>p.due).sort().pop();
        stageAdd = null; saveJ(j, nx, "تمت إضافة المرحلة ✓");
      }},
      h("label",{class:"f full"},"اسم المرحلة", h("input",{id:"sgTitle",placeholder:"لوجو، هوية بصرية، تغليف…"})),
      h("div",{class:"full",style:"display:flex;gap:8px"}, h("button",{class:"btn primary sm",type:"submit"},"إضافة"), h("button",{class:"btn sm",type:"button",onclick:()=>{stageAdd=null;renderSheet();}},"إلغاء"))) : null;
    return h("div",{class:"blk"},
      h("div",{style:"display:flex;align-items:center;gap:8px"},
        h("h3",{style:"margin:0;flex:1"}, "المراحل" + (list.length ? " · " + doneN + " من " + list.length : "")),
        !stageAdd ? h("button",{class:"btn ghost sm",type:"button",style:"color:var(--accent)",onclick:()=>{stageAdd={}; renderSheet(); setTimeout(()=>$("sgTitle")?.focus(),30);}}, icon("i-plus"), "مرحلة") : null),
      list.length ? h("div",{class:"meter" + (doneN === list.length ? " full" : ""),style:"margin:10px 0 4px"}, h("i",{style:"width:" + (doneN/list.length*100).toFixed(1) + "%"})) : null,
      list.length ? h("ol",{class:"stages"}, ...list.map((p, i) => {
        const st = stageState(list, i), pm = meets.filter(m => m.phaseId === p.id).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
        return h("li",{class:"stage " + STAGE[st].c},
          h("div",{class:"sg-h"},
            h("span",{class:"sg-n"}, st === "done" ? "✓" : String(i+1)),
            h("div",{class:"grow"}, h("b",null, p.title || ("المرحلة " + (i+1))),
              h("div",{class:"hint"}, (p.start ? dshort(p.start) + " ← " : "حتى ") + dshort(p.due) + (st !== "done" && p.due && daysUntil(p.due) < 0 ? " · متأخرة" : st === "done" && p.doneDate ? " · خلصت " + dshort(p.doneDate) : ""))),
            st !== "done" && p.due && daysUntil(p.due) >= 0 ? calButton(deliveryEvent(j, p), "") : null),
          h("div",{class:"seg sg-seg",role:"group","aria-label":"حالة المرحلة"}, ...["todo","doing","done"].map(k => h("button",{type:"button","aria-pressed":String(st===k),onclick:()=>setStage(j, i, k)}, STAGE[k].t))),
          pm.length ? h("ul",{class:"sg-meet"}, ...pm.map(m => "s:" + m.id === meetEdit ? h("li",{class:"editing"}, meetEditForm(j, m)) : h("li",{class:m.done ? "done" : ""}, meetCheck(j, m),
            h("span",{class:"grow"}, m.kind ? h("i",{class:"kind k-" + m.kind}, kindName(m.kind)) : null, meetTitle(m) + " · " + (m.done ? "تم ✓" : relDay(m.date) + (m.time ? " " + fmtTime(m.time) : "")), m.notes ? h("small",{class:"m-notes"}, m.notes) : null),
            !m.done && daysUntil(m.date) >= 0 ? calButton(meetingEvent(j, m), "") : null, meetEditBtn(m, "s")))) : null,
          stageMeet === p.id ? h("form",{class:"mini",onsubmit:e=>{
              e.preventDefault();
              const m = {id:newId(), phaseId:p.id, kind:e.target.dataset.kind || "", title:$("smTitle").value.trim() || "عرض «" + (p.title||"المرحلة") + "»", date:$("smDate").value || todayStr(), time:$("smTime").value || ""};
              const nx = bodyOf(j); nx.meetings = [...meets, m]; stageMeet = null; justMeet = m.id;
              saveJ(j, nx, "تم حفظ الميتنج ✓");
              if ("Notification" in window && Notification.permission === "default") enableNotify();
            }},
            kindPicks("smTitle", p.title, ""),
            h("label",{class:"f full"},"العنوان", h("input",{id:"smTitle",value:"عرض «" + (p.title||"المرحلة") + "» على " + (j.client||"العميل")})),
            h("label",{class:"f"},"اليوم", h("input",{id:"smDate",type:"date",value:p.due || todayStr()})),
            h("label",{class:"f"},"الساعة", h("input",{id:"smTime",type:"time",value:"12:00"})),
            h("div",{class:"full",style:"display:flex;gap:8px"}, h("button",{class:"btn primary sm",type:"submit"},"حفظ"), h("button",{class:"btn sm",type:"button",onclick:()=>{stageMeet=null;renderSheet();}},"إلغاء")))
          : st !== "done" ? h("button",{class:"btn ghost sm sg-add",type:"button",onclick:()=>{stageMeet=p.id; renderSheet();}}, icon("i-plus"), "ميتنج") : null,
          h("textarea",{class:"sg-notes",rows:"2",placeholder:"ملاحظات المرحلة: طلبات العميل، اللي اتفقنا عليه في الميتنج…",oninput:e=>saveStageNote(j, p.id, e.target.value)}, p.notes || ""));
      })) : (!stageAdd ? h("div",{class:"hint",style:"margin-top:4px"},"قسّم الشغل مراحل (لوجو ← هوية ← تغليف) عشان تتابع كل واحدة لوحدها.") : null),
      addForm);
  }
  let sheetId = null, confirmDel = false, payDraft = null;
  let meetDraft = null, payOpen = false, justMeet = "";
  function openSheet(id){ sheetId = id; meetEdit = ""; stageAdd = null; stageMeet = null; confirmDel = false; payDraft = null; meetDraft = null; payOpen = false; justMeet = ""; calMenu = ""; renderSheet(); openDlg($("sheetDlg")); }
  function praise(sub, fw){
    const p = $("praise"); topHost().appendChild(p); $("praiseSub").textContent = sub || "";
    p.hidden = true; void p.offsetWidth; p.hidden = false;
    p.classList.toggle("long", !!fw);
    if (fw) fireworks(p);
    clearTimeout(praise._t); praise._t = setTimeout(() => { p.hidden = true; }, fw ? 3000 : 2200);
  }
  // a short, light burst of gold and brand-colored sparks
  function fireworks(host){
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    host.querySelector("canvas")?.remove();
    const cv = document.createElement("canvas"), dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.className = "fw"; host.prepend(cv);
    const cx = cv.getContext("2d"); cx.scale(dpr, dpr);
    const cols = ["#FDE68A","#F59E0B","#FBBF24","#22D3EE","#818CF8","#F0ABFC","#FFFFFF"], parts = [];
    const burst = (x, y) => { const c = cols[(Math.random() * cols.length) | 0], k = 46; for (let i = 0; i < k; i++){ const a = i / k * Math.PI * 2, v = 2.2 + Math.random() * 2.6; parts.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: Math.random() < .25 ? "#FFFFFF" : c}); } };
    const spots = [[.25,.28],[.75,.24],[.5,.16],[.18,.5],[.82,.48]];
    spots.forEach(([fx, fy], i) => setTimeout(() => burst(W * fx, H * fy), i * 260));
    const t0 = performance.now();
    (function frame(t){
      cx.clearRect(0, 0, W, H);
      for (const q of parts){ q.vx *= .975; q.vy = q.vy * .975 + .05; q.x += q.vx; q.y += q.vy; q.life -= .011;
        if (q.life > 0){ cx.globalAlpha = Math.max(0, q.life); cx.fillStyle = q.c; cx.beginPath(); cx.arc(q.x, q.y, 2.1, 0, 7); cx.fill(); } }
      if (t - t0 < 2900 && !host.hidden) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }
  for (const d of ["sheetDlg","wizDlg","waDlg","expDlg"]) $(d).addEventListener("click", e => { if (e.target === $(d)) $(d).close(); });

  function renderSheet(){
    const j = jobs.find(x=>x.id===sheetId);
    if (!j){ if ($("sheetDlg").open) $("sheetDlg").close(); return; }
    if ($("pAmt")) payDraft = {amt:$("pAmt").value, date:$("pDate").value, note:$("pNote").value, rate: $("pRate") ? $("pRate").value : "", recv: payDraft ? payDraft.recv : false};
    const paid = paidOf(j), rem = remOf(j), price = n(j.price), cur = curOf(j);
    const pays = paysOf(j).map((p,i)=>({...p,i})).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    const digits = (j.phone||"").replace(/[^\d]/g,"");
    const wa = digits.startsWith("0") && digits.length === 11 ? "2" + digits : digits;
    const save = (next, msg) => { store.save(j.id, next); toast(msg); };
    const setStatus = (s) => {
      const was = j.status, nx = bodyOf(j); nx.status = s; nx.delivered = s === "done" ? (nx.delivered || todayStr()) : "";
      if (s === "done") nx.phases = phasesOf(j).map(p => p.done ? p : {...p, done:true, doneDate:todayStr()});
      store.save(j.id, nx);
      if (s === "done" && was !== "done") praise("تم تسليم " + (j.title || "المشروع")); else toast("تم الحفظ ✓ " + STATUS[s].t);
    };
    const remindMsg = "أهلاً " + (j.client || "") + "،\nحبيت أفكّر حضرتك بالمتبقي من حساب مشروع «" + (j.title || "") + "»: " + rawFmt(rem) + " " + CUR[cur] + ".\nشكراً لحضرتك.";

    const canPay = j.status !== "cancel" && rem > 0;
    const payBtn = canPay && !payOpen ? h("button",{class:"btn sm",type:"button",style:"margin-top:10px",onclick:()=>{payOpen=true; payDraft=null; renderSheet(); setTimeout(()=>$("pAmt")?.focus(),30);}}, icon("i-plus"), "تسجيل دفعة") : null;
    const payForm = canPay && payOpen ? h("form",{class:"payform",onsubmit:e=>{
        e.preventDefault();
        const amt = n($("pAmt").value); if (amt <= 0){ toast("أدخل المبلغ"); return; }
        const nx = bodyOf(j); nx.payments = [...paysOf(j), stampPay({amount:amt, date:$("pDate").value||todayStr(), note:$("pNote").value.trim(), rate: $("pRate") ? n($("pRate").value) || null : null, ...(payDraft && payDraft.recv ? {} : {received:false})}, cur)];
        const recvNow = payDraft && payDraft.recv; payOpen = false; payDraft = null;
        if (recvNow){ store.save(j.id, nx); praise("تم استلام " + money(amt, cur)); } else save(nx, "تم الحفظ ✓ دفعة قيد التحويل");
      }},
      h("label",{class:"f money-in"},"المبلغ ("+CUR[cur]+")", h("input",{id:"pAmt",type:"number",min:"0",step:"any",inputmode:"decimal",value:payDraft?payDraft.amt:String(rem)})),
      h("label",{class:"f"},"التاريخ", h("input",{id:"pDate",type:"date",value:payDraft?payDraft.date:todayStr()})),
      cur !== settings.currency ? h("label",{class:"f full"}, "سعر الصرف: 1 " + CUR[cur] + " = " + CUR[settings.currency],
        h("input",{id:"pRate",type:"number",min:"0",step:"any",inputmode:"decimal",placeholder:"سعر اليوم",value:payDraft ? payDraft.rate : (rateNow(cur) || "")}),
        h("span",{class:"hint"}, "تُحتسب الدفعة بهذا السعر. عدّله إذا احتسب البنك أو المحفظة سعراً مختلفاً.")) : null,
      h("div",{class:"full picks",id:"pRecv"}, ...[[false,"قيد التحويل"],[true,"وصل حسابي"]].map(([v,t]) => h("button",{type:"button",class:"pick","aria-pressed":String(!!(payDraft && payDraft.recv) === v),onclick:()=>{ payDraft = {amt:$("pAmt").value, date:$("pDate").value, note:$("pNote").value, rate: $("pRate") ? $("pRate").value : "", recv:v}; renderSheet(); }}, t))),
      h("label",{class:"f full"},"طريقة الدفع", h("input",{id:"pNote",placeholder:"نقدي، فودافون كاش، إنستاباي، تحويل بنكي…",value:payDraft?payDraft.note:""})),
      h("div",{class:"full",style:"display:flex;gap:8px"}, h("button",{class:"btn primary",type:"submit",style:"flex:1;justify-content:center"}, "حفظ الدفعة"), h("button",{class:"btn",type:"button",onclick:()=>{payOpen=false;payDraft=null;renderSheet();}},"إلغاء"))) : null;

    $("sheet").replaceChildren(
      h("div",{class:"sh-h"},
        h("button",{class:"back",type:"button",onclick:()=>$("sheetDlg").close()}, icon("i-back"), "رجوع"),
        h("div",{class:"row"}, h("h2",null, j.title||"بدون اسم")),
        h("div",{class:"who"}, (j.client||"—") + (typeText(j) ? " · " + typeText(j) : "")),
        h("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, stPill(j), cdChip(j))),
      h("div",{class:"sh-b"},
        stagesBlock(j),
        h("div",{class:"blk"},
          h("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"}, h("h3",{style:"margin:0;flex:1"},"الحساب · " + CUR_NAME[cur]), eyeBtn()),
          h("div",{class:"mgrid"},
            h("div",null, h("span",null,"السعر"), h("b",{class:"num"}, fmt(price))),
            h("div",null, h("span",null,"المدفوع"), h("b",{class:"num",style:"color:var(--ok)"}, fmt(paid))),
            h("div",null, h("span",null,"المتبقي"), h("b",{class:"num jrem "+(rem>0?"has":"zero")}, rem>0?fmt(rem):"مدفوع بالكامل ✓"))),
          h("div",{class:"meter"+(price&&paid>=price?" full":""),style:"margin-top:10px"}, h("i",{style:"width:"+(price?Math.min(100,paid/price*100):0).toFixed(1)+"%"})),
          j.status === "done" && settings.zakatMode !== "off" && (zakatDue(j) > 0 || n(j.zakatPaid) > 0) ? h("div",{class:"zk",style:"margin-top:12px"},
            h("div",{class:"grow"}, zkWord() + " المشروع (" + n(settings.zakatRate) + "%): ", h("b",{class:"num"}, money(zakatDue(j) || n(j.zakatPaid)))),
            zakatDue(j) > 0 ? h("button",{class:"btn sm",type:"button",onclick:()=>markZakat(j)},"تم الإخراج ✓") : h("span",{class:"cd c-done"},"تم الإخراج ✓")) : null),
        h("div",{class:"blk"},
          h("h3",null,"الدفعات"),
          pays.length ? h("ul",{class:"pays"}, ...pays.map(p => h("li",null,
            h("span",{class:"a num"}, money(p.amount,cur)), h("span",null, dshort(p.date) + (p.recvDate && p.recvDate !== p.date ? " · استُلم " + dshort(p.recvDate) : "")),
            cur !== settings.currency ? h("span",{class:"hint num"}, payBase(p,cur) != null ? "= " + money(Math.round(payBase(p,cur))) + (p.rate && p.rateBase === settings.currency ? " (سعر " + fmtRate(p.rate) + ")" : " تقريباً") : "بدون سعر صرف") : null,
            h("span",{class:"n"}, p.note||""),
            h("div",{class:"seg pstat",role:"group","aria-label":"حالة الدفعة"},
              h("button",{type:"button","aria-pressed":String(!isRecv(p)),onclick:()=>{ if (!isRecv(p)) return; const nx = bodyOf(j); nx.payments = paysOf(j).map((q,i)=> { if (i !== p.i) return q; const r = {...q, received:false}; delete r.recvDate; return r; }); save(nx, "تم الحفظ ✓ قيد التحويل"); }},"قيد التحويل"),
              h("button",{type:"button","aria-pressed":String(isRecv(p)),onclick:()=>{ if (isRecv(p)) return; const nx = bodyOf(j); nx.payments = paysOf(j).map((q,i)=> i===p.i ? arrive(q, cur) : q); store.save(j.id, nx); praise("تم استلام " + money(p.amount,cur)); }},"وصلت")),
            h("button",{class:"btn ghost sm danger",type:"button","aria-label":"حذف الدفعة",onclick:()=>{ const nx = bodyOf(j); nx.payments = paysOf(j).filter((_,i)=>i!==p.i); save(nx,"تم حذف الدفعة"); }}, icon("i-x"))
          ))) : h("div",{class:"hint"},"لا توجد دفعات بعد."),
          payBtn, payForm),
        h("div",{class:"blk"},
          h("div",{style:"display:flex;align-items:center;gap:8px"}, h("h3",{style:"margin:0;flex:1"},"الاجتماعات"),
            !meetDraft ? h("button",{class:"btn ghost sm",type:"button",style:"color:var(--accent)",onclick:()=>{meetDraft={title:"اجتماع مع " + (j.client||"العميل"), date:todayStr(), time:"12:00"}; renderSheet(); setTimeout(()=>$("mTitle")?.focus(),30);}}, icon("i-plus"), "اجتماع") : null),
          meetingsOf(j).length ? h("ul",{class:"mt",style:"margin-top:8px"}, ...meetingsOf(j).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(m => "g:" + m.id === meetEdit ? h("li",{class:"editing"}, meetEditForm(j, m)) : h("li",{class:m.done ? "done" : ""},
            meetCheck(j, m), h("div",{class:"grow"}, m.kind ? h("i",{class:"kind k-" + m.kind}, kindName(m.kind)) : null, h("b",null, meetTitle(m)), h("div",{class:"hint"}, relDay(m.date) + (m.time ? " · " + fmtTime(m.time) : "") + (m.done ? " · تم ✓" : !m.done && daysUntil(m.date) < 0 ? " · علّم عليه لو تم" : "")), m.notes ? h("div",{class:"m-notes"}, m.notes) : null),
            !m.done && daysUntil(m.date) >= 0 && m.id !== justMeet ? calButton(meetingEvent(j, m), "") : null,
            meetEditBtn(m, "g"),
            h("button",{class:"btn ghost sm danger",type:"button","aria-label":"حذف الاجتماع",onclick:()=>{ const nx = bodyOf(j); nx.meetings = meetingsOf(j).filter(x=>x.id!==m.id); save(nx,"تم حذف الاجتماع"); }}, icon("i-x"))))) : (!meetDraft ? h("div",{class:"hint",style:"margin-top:4px"},"لا توجد اجتماعات.") : null),
          justMeet && meetingsOf(j).some(m => m.id === justMeet) ? h("div",{class:"cal-tip"},
            h("div",null, h("b",null,"خلّي موبايلك يفكّرك"), h("span",null,"أضفه لتقويمك، فيجيلك تنبيه قبله بنص ساعة حتى لو التطبيق مقفول.")),
            calButton({...meetingEvent(j, meetingsOf(j).find(m => m.id === justMeet)), key:"tip-" + justMeet}),
            h("button",{class:"btn ghost sm",type:"button","aria-label":"إغلاق",onclick:()=>{ justMeet = ""; renderSheet(); }}, icon("i-x"))) : null,
          meetDraft ? h("form",{class:"mini",onsubmit:e=>{
              e.preventDefault();
              const m = {id:newId(), kind:e.target.dataset.kind || "", title:$("mTitle").value.trim() || "اجتماع", date:$("mDate").value || todayStr(), time:$("mTime").value || "", notes:($("mNotes")?.value || "").trim()};
              const nx = bodyOf(j); nx.meetings = [...meetingsOf(j), m]; meetDraft = null;
              justMeet = m.id;
              save(nx, "تم حفظ الاجتماع ✓");
              if ("Notification" in window && Notification.permission === "default") enableNotify();
            }},
            kindPicks("mTitle", j.client, ""),
            h("label",{class:"f full"},"العنوان", h("input",{id:"mTitle",value:meetDraft.title,oninput:e=>{meetDraft.title=e.target.value;}})),
            h("label",{class:"f"},"اليوم", h("input",{id:"mDate",type:"date",value:meetDraft.date,oninput:e=>{meetDraft.date=e.target.value;}})),
            h("label",{class:"f"},"الساعة", h("input",{id:"mTime",type:"time",value:meetDraft.time,oninput:e=>{meetDraft.time=e.target.value;}})),
            h("label",{class:"f full"},"تفاصيل (اختياري)", h("textarea",{id:"mNotes",rows:"2",placeholder:"المكان، اللينك، اللي هتعرضه…",oninput:e=>{meetDraft.notes=e.target.value;}}, meetDraft.notes || "")),
            h("div",{class:"full",style:"display:flex;gap:8px"}, h("button",{class:"btn primary sm",type:"submit"},"حفظ"), h("button",{class:"btn sm",type:"button",onclick:()=>{meetDraft=null;renderSheet();}},"إلغاء"))) : null),
        h("div",{class:"blk"}, h("h3",null,"الحالة"),
          h("div",{class:"picks"}, ...Object.entries(STATUS).map(([k,v]) => h("button",{class:"pick",type:"button","aria-pressed":String(j.status===k),onclick:()=>setStatus(k)}, v.t)))),
        h("div",{class:"blk"},
          h("h3",null,"البيانات والمواعيد"),
          h("div",{class:"kv"},
            h("span",null,"الرقم"), h("div",{class:"phone"}, h("code",null, j.phone||"—"),
              j.phone ? h("button",{class:"btn sm",type:"button",onclick:async()=>{try{await navigator.clipboard.writeText(j.phone);toast("تم نسخ الرقم")}catch(e){toast("حدّد الرقم وانسخه")}}},"نسخ") : null,
              wa ? h("a",{class:"btn sm",href:"https://wa.me/"+wa,target:"_blank",rel:"noopener"},"واتساب") : null,
              wa && rem > 0 && j.status !== "cancel" ? h("a",{class:"btn sm wa",href:"https://wa.me/"+wa+"?text="+encodeURIComponent(remindMsg),target:"_blank",rel:"noopener"},"ذكّر العميل") : null),
            h("span",null,"البدء"), h("span",null, dlong(j.start)),
            h("span",null,"الإنجاز"), h("span",null, dlong(j.finish)),
            h("span",null, phasesOf(j).length ? "التسليم النهائي" : "التسليم"), h("div",{class:"phone"}, h("b",null, dlong(j.due)), isOpen(j) && j.due && daysUntil(j.due) >= 0 ? calButton(deliveryEvent(j), "للتقويم") : null),
            j.status==="done" ? h("span",null,"تم التسليم") : null, j.status==="done" ? h("span",null, dlong(j.delivered)) : null,
            h("span",null,"التعديلات"), h("span",null, j.revisions!==""&&j.revisions!=null ? j.revisions+" متفق عليها" : "—"))),
        j.notes ? h("div",{class:"blk"}, h("h3",null,"ملاحظات"), h("div",{style:"white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem"}, j.notes)) : null,
        confirmDel ? h("div",{class:"confirm"}, "حذف هذا المشروع ودفعاته نهائياً؟",
          h("button",{class:"btn sm danger solid",type:"button",onclick:()=>{store.remove(j.id);$("sheetDlg").close();toast("تم حذف المشروع")}},"حذف"),
          h("button",{class:"btn sm",type:"button",onclick:()=>{confirmDel=false;renderSheet()}},"إلغاء")) : null),
      h("div",{class:"sh-f"},
        h("button",{class:"btn primary",type:"button",onclick:()=>{$("sheetDlg").close();openForm(j.id)}}, icon("i-edit"), "تعديل بيانات المشروع"),
        h("button",{class:"btn",type:"button",onclick:()=>{$("sheetDlg").close();openForm(null,{client:j.client,phone:j.phone,currency:j.currency})}}, icon("i-plus"), "مشروع جديد لنفس العميل"),
        h("span",{class:"sp"}),
        !confirmDel ? h("button",{class:"btn ghost danger",type:"button",onclick:()=>{confirmDel=true;renderSheet()}},"حذف") : null));
  }

  { const _rs = renderSheet; renderSheet = function(){ _rs(); syncDates($("sheet")); }; }

  // ---------- add to the phone/computer calendar (reliable reminders, even when the app is closed) ----------
  const isAndroid = /android/i.test(navigator.userAgent);
  const isMobile = isAndroid || isIOS;
  let calMenu = "";
  const pad2 = (x) => String(x).padStart(2, "0");
  function calStamp(date, time, addMin){
    const [y,mo,d] = date.split("-").map(Number), [hh,mm] = (time || "10:00").split(":").map(Number);
    const t = new Date(y, mo - 1, d, hh, mm + (addMin || 0));
    return t.getFullYear() + pad2(t.getMonth()+1) + pad2(t.getDate()) + "T" + pad2(t.getHours()) + pad2(t.getMinutes()) + "00";
  }
  function meetingEvent(j, m){
    return {key:"m-" + m.id, title:(m.title || "اجتماع") + (j.client && !(m.title||"").includes(j.client) ? " — " + j.client : ""),
      date:m.date, time:m.time || "10:00", dur:60, alarms:[30], details:(m.notes ? m.notes + "\n" : "") + "مشروع: " + (j.title || "") + (j.phone ? "\nرقم العميل: " + j.phone : "")};
  }
  function deliveryEvent(j, p){
    return {key:"d-" + j.id + (p ? "-" + p.id : ""), title:"تسليم" + (p ? " مرحلة «" + (p.title || "") + "»" : "") + ": " + (j.title || "") + (j.client ? " — " + j.client : ""),
      date:p ? p.due : j.due, time:"10:00", dur:30, alarms:[1440, 0], details:"من دفتر المصمم" + (j.phone ? "\nرقم العميل: " + j.phone : "")};
  }
  function googleUrl(ev){
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "Africa/Cairo";
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(ev.title) +
      "&dates=" + calStamp(ev.date, ev.time) + "/" + calStamp(ev.date, ev.time, ev.dur) + "&details=" + encodeURIComponent(ev.details) + "&ctz=" + encodeURIComponent(tz);
  }
  function icsText(ev){
    const esc = (x) => String(x).replace(/\\/g,"\\\\").replace(/([,;])/g,"\\$1").replace(/\n/g,"\\n");
    const now = new Date(), stamp = now.getUTCFullYear() + pad2(now.getUTCMonth()+1) + pad2(now.getUTCDate()) + "T" + pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + "00Z";
    return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Daftar//AR","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",
      "UID:" + ev.key + "@daftar","DTSTAMP:" + stamp,"DTSTART:" + calStamp(ev.date, ev.time),"DTEND:" + calStamp(ev.date, ev.time, ev.dur),
      "SUMMARY:" + esc(ev.title),"DESCRIPTION:" + esc(ev.details),
      ...ev.alarms.flatMap(a => ["BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:" + esc(ev.title),"TRIGGER:" + (a ? "-PT" + a + "M" : "PT0M"),"END:VALARM"]),
      "END:VEVENT","END:VCALENDAR"].join("\r\n");
  }
  function openGoogle(ev){ const a = h("a",{href:googleUrl(ev),target:"_blank",rel:"noopener"}); document.body.append(a); a.click(); a.remove(); }
  function saveIcs(ev){
    const url = URL.createObjectURL(new Blob([icsText(ev)], {type:"text/calendar;charset=utf-8"}));
    const a = h("a",{href:url,download:"daftar-" + ev.date + ".ics"}); document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function calButton(ev, label){
    if (!ev.date) return null;
    const txt = label === "" ? null : (label || (isMobile ? "أضف لتقويم موبايلي" : "أضف للتقويم"));
    const at = {class:"btn sm cal" + (txt ? "" : " icon-only"),type:"button",title:"أضف للتقويم","aria-label":"أضف للتقويم"};
    if (isAndroid) return h("button",{...at,onclick:()=>openGoogle(ev)}, icon("i-cal"), txt);
    if (isIOS) return h("button",{...at,onclick:()=>{ saveIcs(ev); toast("افتح الملف واضغط «إضافة» في التقويم"); }}, icon("i-cal"), txt);
    // computer: Google Calendar or a calendar file for Outlook / Mac Calendar
    if (calMenu !== ev.key) return h("button",{...at,onclick:()=>{ calMenu = ev.key; renderSheet(); }}, icon("i-cal"), txt);
    return h("span",{class:"cal-menu"},
      h("button",{class:"btn sm cal",type:"button",onclick:()=>{ calMenu = ""; openGoogle(ev); renderSheet(); }}, "Google Calendar"),
      h("button",{class:"btn sm cal",type:"button",onclick:()=>{ calMenu = ""; saveIcs(ev); toast("افتح الملف ليُضاف إلى Outlook أو تقويم ماك"); renderSheet(); }}, "Outlook / تقويم ماك"),
      h("button",{class:"btn ghost sm",type:"button","aria-label":"إلغاء",onclick:()=>{ calMenu = ""; renderSheet(); }}, icon("i-x")));
  }

  // ---------- link my devices (your own Google Sheet in the middle; pair other devices with a QR) ----------
  const lk = {step:0, token:"", showQR:false, url:""};
  const scriptLoads = {};
  const loadScript = (src) => scriptLoads[src] || (scriptLoads[src] = new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = () => { delete scriptLoads[src]; rej(); }; document.head.append(sc); }));
  const b64url = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const unb64url = (str) => decodeURIComponent(escape(atob(str.replace(/-/g,"+").replace(/_/g,"/"))));
  const pairLink = () => location.origin + location.pathname + "#pair=" + b64url(JSON.stringify({u:settings.sheetUrl, t:settings.token}));
  function connect(url, token, msg){
    settings.sheetUrl = url; settings.token = token; settings.syncCursor = 0; saveSettings();
    for (const j of Object.values(all)) j.dirty = true; persist();
    lk.step = 0; lk.showQR = false;
    sync(true).then(() => { if (!syncErr) toast(msg || "تم الربط ✓"); render(); });
  }
  function applyPair(code){
    try {
      const raw = String(code).trim(), m = raw.match(/pair=([A-Za-z0-9_-]+)/), data = JSON.parse(unb64url(m ? m[1] : raw));
      if (!data.u || !/^https:\/\/script\.google(usercontent)?\.com\//.test(data.u)) throw 0;
      connect(data.u, data.t || "", "تم ربط الجهاز ✓ وبياناتك بتنزل دلوقتي");
      return true;
    } catch(e){ toast("الكود ده مش كود ربط من دفتر المصمم"); return false; }
  }
  async function copyScript(){
    if (!lk.token) lk.token = b64u(crypto.getRandomValues(new Uint8Array(18)));
    try {
      const txt = (await (await fetch("google-sheet-script.gs", {cache:"no-cache"})).text()).replace(/const TOKEN = ".*?";/, 'const TOKEN = "' + lk.token + '";');
      await navigator.clipboard.writeText(txt); toast("تم نسخ الكود ✓"); lk.step = Math.max(lk.step, 4); render();
    } catch(e){ toast("محتاج نت علشان أنسخ الكود"); }
  }
  async function renderQR(el){
    try { await loadScript("lib/qrcode.js"); const q = qrcode(0, "M"); q.addData(pairLink()); q.make(); el.innerHTML = q.createSvgTag({cellSize:5, margin:3, scalable:true}); }
    catch(e){ el.textContent = "تعذّر عرض الكود"; }
  }
  const gLogo = () => { const sp = document.createElement("span"); sp.className = "g-logo"; sp.innerHTML = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'; return sp; };
  function linkPanel(){
    const st = syncState();
    const head = h("div",{class:"panel-h"}, h("h2",null,"ربط أجهزتي"), linked() ? h("span",{class:"cd " + (st.c==="ok"?"c-done":st.c==="err"?"c-late":"c-ok")}, st.t) : null);
    const gBtn = (label) => h("button",{class:"btn primary g-btn",type:"button",disabled:gBusy,onclick:signIn}, gLogo(), gBusy ? "لحظة…" : label);
    if (settings.drive){
      return h("section",{class:"panel"}, head, h("div",null,
        h("p",null,"✓ داخل بحساب جوجل" + (gauth.email ? ": " : ""), gauth.email ? h("b",{dir:"ltr"}, gauth.email) : null),
        h("p",{class:"note"},"على أي جهاز تاني: افتح دفتر المصمم، واضغط «الدخول بحساب جوجل» بنفس الحساب. أي تعديل هيظهر على الكل خلال ثواني."),
        syncErr === "سجّل الدخول بجوجل تاني" ? h("div",{class:"row-btns"}, gBtn("الدخول تاني"))
          : h("div",{class:"row-btns"}, h("button",{class:"btn",type:"button",onclick:()=>sync(true)},"مزامنة الآن")),
        settings.lastSync ? h("p",{class:"hint"}, "آخر مزامنة: " + new Date(settings.lastSync).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"})) : null,
        h("details",{class:"more"}, h("summary",null,"تسجيل الخروج"),
          h("p",{class:"note"},"بياناتك هتفضل على الجهاز ده، بس التعديلات مش هتتزامن مع أجهزتك التانية."),
          h("div",{class:"row-btns"},
            h("button",{class:"btn sm ghost",type:"button",onclick:()=>signOut(false)},"خروج"),
            h("button",{class:"btn sm ghost danger",type:"button",onclick:()=>{ if (confirm("هتتمسح نسخة بياناتك من جوجل درايف، وأجهزتك التانية مش هتتزامن تاني. البيانات اللي على الجهاز ده هتفضل. متأكد؟")) signOut(true); }},"خروج ومسح نسختي من درايف")))));
    }
    if (settings.sheetUrl){
      const qrBox = h("div",{class:"qr"}); if (lk.showQR) renderQR(qrBox);
      return h("section",{class:"panel"}, head, h("div",null,
        h("p",null,"✓ الجهاز ده مربوط. أي تعديل بيظهر على كل أجهزتك خلال ثواني."),
        lk.showQR ? h("div",{class:"pair"}, qrBox,
            h("ol",null, h("li",null,"افتح دفتر المصمم على الجهاز التاني."), h("li",null,"الإعدادات ← «ربط بجهاز موجود»."), h("li",null,"امسح الكود ده، أو امسحه بكاميرا التليفون.")),
            h("div",{class:"row-btns"},
              h("button",{class:"btn sm",type:"button",onclick:async()=>{ try { await navigator.clipboard.writeText(pairLink()); toast("تم نسخ كود الربط"); } catch(e){ toast("انسخه يدوياً"); } }},"نسخ كود الربط"),
              h("button",{class:"btn sm ghost",type:"button",onclick:()=>{lk.showQR=false;render();}},"إخفاء")),
            h("p",{class:"note"},"الكود ده بيفتح بياناتك، فمتبعتهوش لحد غيرك."))
          : h("div",{class:"row-btns"},
              h("button",{class:"btn primary",type:"button",onclick:()=>{lk.showQR=true;render();}}, "ربط جهاز جديد"),
              h("button",{class:"btn",type:"button",onclick:()=>sync(true)},"مزامنة الآن")),
        settings.lastSync ? h("p",{class:"hint"}, "آخر مزامنة: " + new Date(settings.lastSync).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"})) : null,
        h("details",{class:"more"}, h("summary",null,"فك ربط الجهاز ده"),
          h("p",{class:"note"},"بياناتك هتفضل على الجهاز ده وفي الشيت، بس التعديلات مش هتتزامن تاني."),
          h("button",{class:"btn sm ghost danger",type:"button",onclick:()=>{ settings.sheetUrl=""; settings.token=""; settings.syncCursor=0; saveSettings(); toast("تم فك الربط"); render(); }},"فك الربط"))));
    }
    if (!lk.step){ gsiReady().catch(() => {}); return h("section",{class:"panel"}, head, h("div",null,
      h("p",null,"ادخل بحساب جوجل على تليفونك والكمبيوتر، وأي حاجة تضيفها أو تعدّلها في أي مكان تظهر على الكل خلال ثواني."),
      h("div",{class:"row-btns"}, gBtn("الدخول بحساب جوجل")),
      h("p",{class:"note"},"🔒 بياناتك بتتحفظ في فولدر مخفي خاص بالتطبيق جوه جوجل درايف بتاعك. محدش غيرك يقدر يشوفها، والتطبيق مايقدرش يشوف أي ملفات تانية عندك."),
      h("details",{class:"more"}, h("summary",null,"طريقة تانية: شيت جوجل"),
        h("div",{class:"row-btns"},
          h("button",{class:"btn sm",type:"button",onclick:()=>{lk.step=1;render();}},"أول جهاز: ابدأ الربط"),
          h("button",{class:"btn sm",type:"button",onclick:openScan}, "ربط بجهاز موجود"))))); }
    const stepRow = (k, title, body) => h("li",{class:"lk-step" + (lk.step > k ? " done" : lk.step === k ? " on" : "")}, h("b",null, title), body);
    return h("section",{class:"panel"}, head, h("div",null,
      h("p",{class:"note"},"خطوات مرة واحدة بس (حوالي 3 دقايق). خلّيك مسجّل دخول بحساب جوجل."),
      h("ol",{class:"lk"},
        stepRow(1, "افتح شيت جديد", h("div",{class:"row-btns"}, h("a",{class:"btn sm",href:"https://sheets.new",target:"_blank",rel:"noopener",onclick:()=>{lk.step=Math.max(lk.step,2);setTimeout(render,300);}},"افتح Google Sheets"))),
        stepRow(2, "من القايمة فوق: Extensions ← Apps Script", h("span",{class:"note"},"بالعربي: الإضافات ← Apps Script. هتفتح صفحة فيها كود.")),
        stepRow(3, "انسخ الكود والصقه هناك", h("div",null, h("div",{class:"row-btns"}, h("button",{class:"btn sm primary",type:"button",onclick:copyScript},"انسخ الكود")),
          h("span",{class:"note"},"امسح كل اللي مكتوب في الصفحة، والصق الكود، واضغط حفظ 💾."))),
        stepRow(4, "انشره", h("span",{class:"note"},"اضغط Deploy ← New deployment ← اختار Web app ← خلي Who has access: Anyone ← Deploy. وافق على الصلاحيات، ولو ظهر تحذير اضغط Advanced ← Go to … (unsafe)، ده طبيعي لأنه كودك إنت.")),
        stepRow(5, "الصق الرابط هنا", h("div",null,
          h("input",{id:"lkUrl",type:"url",dir:"ltr",class:"search",style:"width:100%",placeholder:"https://script.google.com/macros/s/…/exec",value:lk.url,oninput:e=>{lk.url=e.target.value;}}),
          h("div",{class:"row-btns",style:"margin-top:8px"},
            h("button",{class:"btn primary",type:"button",onclick:()=>{
              const u = (lk.url||"").trim();
              if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)){ toast("الرابط لازم يبدأ بـ https://script.google.com"); return; }
              if (!lk.token){ toast("انسخ الكود الأول من الخطوة 3"); return; }
              connect(u, lk.token, "تم الربط ✓ دلوقتي اربط أجهزتك التانية بالـ QR");
              lk.showQR = true;
            }},"اربط"),
            h("button",{class:"btn ghost",type:"button",onclick:()=>{lk.step=0;render();}},"إلغاء"))))),
    ));
  }
  // scanner: BarcodeDetector where available, jsQR elsewhere; manual paste as a fallback
  let scanStream = null, scanTimer = null;
  async function openScan(){
    const d = $("scanDlg");
    $("scanMsg").textContent = "وجّه الكاميرا على كود الربط اللي على الجهاز التاني";
    openDlg(d);
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}, audio:false});
      const v = $("scanVideo"); v.srcObject = scanStream; await v.play();
      let detector = null;
      try { if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("qr_code")) detector = new BarcodeDetector({formats:["qr_code"]}); } catch(e){}
      if (!detector) await loadScript("lib/jsQR.js");
      const cv = document.createElement("canvas"), cx = cv.getContext("2d", {willReadFrequently:true});
      const tick = async () => {
        if (!d.open) return;
        let text = "";
        try {
          if (detector){ const r = await detector.detect(v); if (r[0]) text = r[0].rawValue; }
          else if (v.videoWidth){ cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0); const img = cx.getImageData(0, 0, cv.width, cv.height); const r = jsQR(img.data, img.width, img.height); if (r) text = r.data; }
        } catch(e){}
        if (text && text.includes("pair=")){ d.close(); applyPair(text); return; }
        scanTimer = setTimeout(tick, 250);
      };
      tick();
    } catch(e){ $("scanMsg").textContent = "مقدرتش أفتح الكاميرا. الصق كود الربط تحت بدلها."; }
  }
  $("scanDlg").addEventListener("close", () => { clearTimeout(scanTimer); if (scanStream){ scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } });
  $("scanClose").onclick = () => $("scanDlg").close();
  $("scanPaste").onclick = () => { const v = $("scanCode").value; if (v && applyPair(v)) $("scanDlg").close(); };
  function linkCard(){
    if (linked() || LS.get("ledger.hideLink", false) || !(jobs.length || expenses.length)) return null;
    return h("div",{class:"wa-card",style:"background:var(--grad-soft),var(--card)"},
      h("span",{class:"ic",style:"background:var(--grad);color:#fff"}, icon("i-reg")),
      h("div",{class:"tx"}, h("b",null,"اربط تليفونك والكمبيوتر"), h("span",null,"مرة واحدة، وأي تعديل يظهر على الكل خلال ثواني.")),
      h("button",{class:"btn primary sm",type:"button",onclick:()=>go("settings")},"اربط"),
      h("button",{class:"btn ghost sm",type:"button","aria-label":"إخفاء",onclick:()=>{ LS.set("ledger.hideLink", true); render(); }}, icon("i-x")));
  }

  // ---------- WhatsApp ----------
  const wa = {text:"", result:null, created:{}, timer:null};
  function openWa(text){
    if (typeof text === "string"){ wa.text = text; wa.result = null; }
    else if (wa.result && wa.result.actions.every(a=>a.state!=="pending")){ wa.text = ""; wa.result = null; }
    if (wa.text && !wa.result) analyze();
    renderWa(); openDlg($("waDlg"));
    setTimeout(()=>{ const t = $("waText"); if (t && !wa.text) t.focus(); }, 40);
  }
  function analyze(){
    if (!wa.text.trim()){ wa.result = null; return; }
    const ctx = {today: todayStr(), myName: settings.myName, currency: settings.currency,
      clients: clientsList().filter(c=>c.name!=="—").map(c=>({name:c.name, phone:c.phone})),
      jobs: jobs.map(j=>({id:j.id, client:j.client, phone:j.phone, title:j.title, type:typeText(j), types:typesOf(j), price:n(j.price), remaining:remOf(j), status:j.status, due:j.due||"", open:isOpen(j)}))};
    let r;
    try { r = WAParser.parse(wa.text.slice(-60000), ctx); } catch(e){ r = {summary:"تعذّرت قراءة هذه الرسائل.", actions:[]}; }
    r.summary = String(r.summary||"").replace(/\b(EGP|USD|SAR|AED|KWD|EUR)\b/g, (m) => CUR[m]);
    r.actions.forEach(a => { a.uid = newId(); a.state = "pending"; if (a.kind === "new_job" && !CUR[a.currency]) a.currency = settings.currency; });
    wa.result = r; wa.created = {};
  }
  async function readFiles(files){
    for (const f of files){
      if (/\.zip$/i.test(f.name) || f.type === "application/zip"){ const t = await unzipText(f).catch(()=>""); if (t) wa.text += (wa.text ? "\n" : "") + t; else toast("لم يتم العثور على ملف المحادثة داخل الملف المضغوط"); }
      else if (/^text\//.test(f.type) || /\.txt$/i.test(f.name)) wa.text += (wa.text ? "\n" : "") + await f.text();
      else toast("يقرأ الدفتر نص الرسائل فقط. انسخ الرسائل أو صدّر المحادثة.");
    }
    analyze(); renderWa();
  }
  // minimal unzip: finds the chat .txt inside a WhatsApp export zip
  async function unzipText(file){
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
    let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    if (eocd < 0) return "";
    let p = dv.getUint32(eocd + 16, true); const count = dv.getUint16(eocd + 10, true);
    for (let k = 0; k < count; k++){
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/\.txt$/i.test(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = buf.slice(start, start + csize);
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8 && "DecompressionStream" in window) return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    }
    return "";
  }

  function renderWa(){
    const head = h("div",{class:"wz-h",style:"padding-bottom:4px"},
      h("div",{class:"row"}, h("h2",{id:"waTitle"},"استيراد من واتساب"), h("button",{class:"btn ghost sm",type:"button","aria-label":"إغلاق",onclick:()=>$("waDlg").close()}, icon("i-x"))));
    const ta = h("textarea",{id:"waText",rows:"5",placeholder:"الصق رسائل الاتفاق أو الدفع هنا…\nمثال: تمام اللوجو بـ 1500 جنيه، حولتلك 500 عربون، ومحتاجه الخميس",
      oninput:e=>{ wa.text = e.target.value; clearTimeout(wa.timer); wa.timer = setTimeout(()=>{ analyze(); renderResults(); }, 500); }});
    ta.value = wa.text;
    const fileIn = h("input",{type:"file",id:"waFile",accept:".txt,.zip,text/plain,application/zip",multiple:true,hidden:true,onchange:e=>{ readFiles([...e.target.files]); e.target.value=""; }});
    const body = h("div",{class:"wz-b wa-in"},
      h("div",{class:"wa-tools"},
        navigator.clipboard && navigator.clipboard.readText ? h("button",{class:"btn wa sm",type:"button",onclick:async()=>{
          try { const t = await navigator.clipboard.readText(); if (!t.trim()){ toast("الحافظة فارغة. انسخ الرسائل من واتساب أولاً."); return; } wa.text = t; analyze(); renderWa(); }
          catch(e){ toast("اسمح بالوصول إلى الحافظة، أو الصق يدوياً في المربع"); } }}, "لصق المنسوخ") : null,
        h("label",{class:"btn sm",for:"waFile"}, icon("i-clip"), "ملف محادثة مُصدَّر"), fileIn,
        wa.text ? h("button",{class:"btn ghost sm",type:"button",onclick:()=>{ wa.text=""; wa.result=null; renderWa(); $("waText").focus(); }},"حذف") : null),
      ta,
      h("div",{id:"waResults",class:"wa-live"}));
    const foot = h("div",{class:"wz-f",id:"waFoot"});
    $("wa").replaceChildren(head, body, foot);
    renderResults();
  }
  function renderResults(){
    const box = $("waResults"), foot = $("waFoot"); if (!box) return;
    if (!wa.result){
      box.replaceChildren(h("div",{class:"steps-tip"},
        h("div",null, h("b",null,"1. انسخ"), "في واتساب حدّد رسائل الاتفاق واضغط نسخ"),
        h("div",null, h("b",null,"2. الصق"), "تُقرأ الرسائل فوراً، حتى بدون إنترنت"),
        h("div",null, h("b",null,"3. اعتمد"), "راجع النتائج واضغط اعتماد")));
      foot.replaceChildren(h("button",{class:"btn",type:"button",onclick:()=>$("waDlg").close()},"إغلاق"));
      return;
    }
    const acts = wa.result.actions;
    const pending = acts.filter(a=>a.state==="pending" && canApply(a));
    box.replaceChildren(h("div",{class:"wa-sum"}, wa.result.summary), ...acts.map(actCard));
    foot.replaceChildren(
      pending.length ? h("button",{class:"btn primary",type:"button",onclick:applyAll}, "اعتماد الكل (" + pending.length + ")") : null,
      h("span",{class:"sp"}),
      h("button",{class:"btn ghost",type:"button",onclick:()=>$("waDlg").close()},"إغلاق"));
  }

  const jobFor = (id) => all[id] && !all[id].deleted ? {...all[id]} : null;
  function payTarget(a){
    if (a.jobId) return a.jobId;
    if (wa.created[a.client]) return wa.created[a.client];
    const m = jobs.filter(j => (j.client||"").trim() === a.client && remOf(j) > 0);
    return m.length === 1 ? m[0].id : "";
  }
  const canApply = (a) => a.kind === "new_job" ? a.price !== null && !!a.client : a.kind === "payment" ? !!payTarget(a) : true;

  function actCard(a){
    const done = a.state === "done", skip = a.state === "skip";
    const lines = (...pairs) => h("div",{class:"lines"}, ...pairs.filter(Boolean).flatMap(([k,v]) => [h("span",null,k), h("b",null,v)]));
    const btns = [];
    let kind, title, content;
    if (a.kind === "new_job"){
      kind = h("span",{class:"kind k-new"},"مشروع جديد");
      title = a.title;
      const known = clientsList().some(c=>c.name===a.client);
      content = lines(["العميل", a.client ? a.client + (a.phone ? " · " + a.phone : "") + (known ? " (عميل حالي)" : " (عميل جديد)") : "غير محدد في الرسائل"],
        ["السعر", a.price !== null ? money(a.price, a.currency) : "غير محدد"], a.deposit ? ["العربون", money(a.deposit, a.currency)] : null,
        ["التسليم", a.due ? dlong(a.due) : "غير محدد"], a.revisions ? ["التعديلات", a.revisions] : null);
      if (!done && !skip){
        if (canApply(a)) btns.push(h("button",{class:"btn primary sm",type:"button",onclick:()=>{ applyOne(a); renderResults(); }},"تسجيل"));
        btns.push(h("button",{class:"btn sm",type:"button",onclick:()=>openForm(null,{...a, onSaved:(id)=>{ a.state="done"; wa.created[a.client]=id; renderResults(); }})}, canApply(a) ? "مراجعة قبل التسجيل" : "استكمال البيانات"));
      }
    } else if (a.kind === "payment"){
      const target = payTarget(a), tj = target && jobFor(target);
      const cur = tj ? curOf(tj) : settings.currency;
      kind = h("span",{class:"kind k-pay"},"دفعة");
      title = money(a.amount, cur) + (a.client ? " من " + a.client : "");
      if (!done && !skip){
        const opts = [h("option",{value:""},"اختر المشروع"),
          ...jobs.slice().sort((x,y)=>remOf(y)-remOf(x)).map(j => h("option",{value:j.id,selected:target===j.id?true:null}, (j.title||"") + " — " + (j.client||"") + (remOf(j)>0 ? " (متبقٍ "+money(remOf(j),curOf(j))+")" : "")))];
        content = h("div",{class:"row"},
          h("label",{class:"f"},"المبلغ", h("input",{type:"number",min:"0",step:"any",value:String(a.amount),oninput:e=>{a.amount=n(e.target.value);}})),
          h("label",{class:"f",style:"flex:2 1 200px"},"المشروع", h("select",{onchange:e=>{a.jobId=e.target.value; renderResults();}}, ...opts)));
        if (target) btns.push(h("button",{class:"btn primary sm",type:"button",onclick:()=>{ applyOne(a); renderResults(); }},"تسجيل الدفعة"));
      } else content = lines(["التاريخ", dlong(a.date)], a.note ? ["الطريقة", a.note] : null);
    } else {
      const j = jobFor(a.jobId), c = a.changes;
      kind = h("span",{class:"kind k-upd"},"تحديث");
      title = j ? j.title + " — " + j.client : "مشروع";
      content = lines(c.due ? ["موعد التسليم", dlong(c.due)] : null, c.price !== undefined ? ["السعر", money(c.price, j && curOf(j))] : null,
        c.status ? ["الحالة", STATUS[c.status].t] : null, c.phone ? ["الرقم", c.phone] : null, c.notesAppend ? ["ملاحظة", c.notesAppend] : null);
      if (!done && !skip) btns.push(h("button",{class:"btn primary sm",type:"button",onclick:()=>{ applyOne(a); renderResults(); }},"تطبيق"));
    }
    if (!done && !skip) btns.push(h("button",{class:"btn ghost sm",type:"button",onclick:()=>{a.state="skip";renderResults();}},"تجاهل"));
    return h("div",{class:"act"+(done?" done":"")+(skip?" skip":"")},
      h("div",{class:"act-h"}, kind, h("b",null,title), done ? h("span",{class:"cd c-done"},"تم التسجيل ✓") : skip ? h("span",{class:"cd c-ok"},"تم التجاهل") : null),
      content, a.reason && !done && !skip ? h("div",{class:"why"}, a.reason) : null,
      btns.length ? h("div",{class:"row"}, ...btns) : null);
  }

  function applyOne(a){
    if (a.kind === "new_job"){
      if (!canApply(a)) return false;
      const data = {payments:[], status: a.start > todayStr() ? "new" : "work", delivered:"", createdAt:new Date().toISOString(), source:"whatsapp",
        client:a.client, phone:a.phone, title:a.title, types:a.types, type:a.types.join(" + "), price:a.price, currency:a.currency, revisions:a.revisions ?? "", start:a.start,
        due:a.due, finish:a.finish, notes:a.notes || ""};
      if (a.deposit > 0) data.payments = [stampPay({amount:a.deposit, date:a.start, note:"عربون", received:false}, a.currency)];
      const id = newId(); store.save(id, data); wa.created[a.client] = id;
    } else if (a.kind === "payment"){
      const id = payTarget(a), j = id && jobFor(id);
      if (!j || !(a.amount > 0)) return false;
      const nx = bodyOf(j); nx.payments = [...paysOf(j), stampPay({amount:a.amount, date:a.date || todayStr(), note:a.note || "واتساب", received:false}, curOf(j))];
      store.save(id, nx);
    } else {
      const j = jobFor(a.jobId); if (!j) return false;
      const nx = bodyOf(j), c = a.changes;
      if (c.due) nx.due = c.due;
      if (c.price !== undefined) nx.price = c.price;
      if (c.phone) nx.phone = c.phone;
      if (c.status){ nx.status = c.status; if (c.status === "done" && !nx.delivered) nx.delivered = todayStr(); }
      if (c.notesAppend) nx.notes = (nx.notes ? nx.notes + "\n" : "") + c.notesAppend;
      store.save(a.jobId, nx);
    }
    a.state = "done"; toast("تم التسجيل");
    return true;
  }
  function applyAll(){
    let ok = 0, left = 0;
    for (const a of wa.result.actions){ if (a.state !== "pending") continue; if (applyOne(a)) ok++; else left++; }
    renderResults();
    toast(left ? "تم تسجيل " + ok + "، ومتبقٍ " + left + " تحتاج استكمالاً" : "تم تسجيل الكل ✓");
  }

  // shared from WhatsApp via the system share menu (installed app)
  async function takeShared(){
    if (!/[?&]share=1/.test(location.search) || !("caches" in window)) return;
    try {
      const c = await caches.open("share-inbox");
      const keys = await c.keys();
      let text = ""; const files = [];
      for (const req of keys){
        const res = await c.match(req);
        if (req.url.endsWith("/text")) text += await res.text();
        else files.push(new File([await res.blob()], decodeURIComponent(res.headers.get("x-name") || "chat.txt"), {type: res.headers.get("content-type") || ""}));
        await c.delete(req);
      }
      history.replaceState(null, "", location.pathname + "#home");
      wa.text = text; wa.result = null;
      openWa(); if (files.length) await readFiles(files); else { analyze(); renderWa(); }
    } catch(e){}
  }

  // ---------- app lock (PIN + fingerprint/face) ----------
  const lockUI = {pin:"", msg:"", forgot:false, wipe:false};
  const setup = {step:0, first:"", msg:""};
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const unb64u = (str) => Uint8Array.from(atob(str.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
  async function sha(str){ const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)); return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join(""); }
  const isLocked = () => document.documentElement.hasAttribute("data-locked");
  let bioAvail = false;
  try { window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(v => { bioAvail = !!v; if (view === "settings") render(); }).catch(()=>{}); } catch(e){}
  function lockNow(){
    if (!settings.lock || !settings.lock.on) return;
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    document.documentElement.setAttribute("data-locked","1");
    Object.assign(lockUI, {pin:"", msg:"", forgot:false, wipe:false}); renderLock();
    if (settings.lock.cred && !document.documentElement.hasAttribute("data-splash")) setTimeout(tryBio, 250);
  }
  function unlockNow(){ document.documentElement.removeAttribute("data-locked"); settings.lock.fails = 0; settings.lock.until = 0; saveSettings(); lastHidden = 0; }
  let bioBusy = false;
  async function tryBio(){
    if (!settings.lock.cred || !window.PublicKeyCredential || bioBusy) return;
    bioBusy = true;
    try {
      await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)), allowCredentials:[{type:"public-key", id:unb64u(settings.lock.cred)}], userVerification:"required", timeout:60000}});
      unlockNow();
    } catch(e){ lockUI.msg = ""; renderLock(); }
    finally { setTimeout(() => { bioBusy = false; }, 800); }
  }
  async function pressKey(k){
    if (Date.now() < (settings.lock.until || 0)){ lockUI.msg = "محاولات كثيرة. انتظر دقيقة."; renderLock(); return; }
    if (k === "del") lockUI.pin = lockUI.pin.slice(0, -1); else if (lockUI.pin.length < 4) lockUI.pin += k;
    lockUI.msg = ""; renderLock();
    if (lockUI.pin.length === 4){
      if ((await sha(settings.lock.salt + ":" + lockUI.pin)) === settings.lock.hash) return unlockNow();
      settings.lock.fails = (settings.lock.fails || 0) + 1;
      if (settings.lock.fails >= 5){ settings.lock.until = Date.now() + 60000; settings.lock.fails = 0; lockUI.msg = "محاولات كثيرة. انتظر دقيقة."; }
      else lockUI.msg = "الرمز غير صحيح";
      saveSettings(); lockUI.pin = ""; renderLock();
      try { navigator.vibrate && navigator.vibrate(120); } catch(e){}
    }
  }
  function renderLock(){
    const L = $("lock");
    if (lockUI.forgot){
      L.replaceChildren(icon("i-reg","logo"), h("h2",null,"نسيت الرمز؟"),
        h("div",{class:"forgot"}, settings.lock.cred ? "افتح بالبصمة. " : "", "أو امسح بيانات التطبيق من هذا الجهاز، ثم استرجعها من شيت جوجل أو من النسخة الاحتياطية."),
        lockUI.wipe ? h("div",{class:"forgot",style:"background:rgba(244,63,94,.18)"}, "سيتم حذف كل البيانات من هذا الجهاز. متأكد؟",
            h("div",{style:"display:flex;gap:8px;justify-content:center;margin-top:10px"},
              h("button",{class:"btn sm danger solid",type:"button",onclick:()=>{ try { Object.keys(localStorage).filter(k=>k.startsWith("ledger.")).forEach(k=>localStorage.removeItem(k)); } catch(e){} location.reload(); }},"احذف البيانات"),
              h("button",{class:"btn sm",type:"button",onclick:()=>{lockUI.wipe=false;renderLock();}},"إلغاء")))
          : h("button",{class:"btn sm",type:"button",style:"background:rgba(255,255,255,.1);color:#fff;border-color:transparent",onclick:()=>{lockUI.wipe=true;renderLock();}},"مسح البيانات من هذا الجهاز"),
        settings.lock.cred ? h("button",{class:"btn primary sm",type:"button",onclick:tryBio}, icon("i-finger"), "فتح بالبصمة") : null,
        h("button",{class:"link",type:"button",onclick:()=>{lockUI.forgot=false;lockUI.wipe=false;renderLock();}},"رجوع"));
      return;
    }
    const keys = ["1","2","3","4","5","6","7","8","9", settings.lock.cred ? "bio" : "", "0", "del"];
    L.replaceChildren(icon("i-reg","logo"), h("h2",null,"أدخل الرمز"),
      h("div",{class:"dots","aria-label":"الرمز"}, ...[0,1,2,3].map(i => h("i",{class:i < lockUI.pin.length ? "on" : ""}))),
      h("div",{class:"msg",role:"alert"}, lockUI.msg),
      h("div",{class:"pad"}, ...keys.map(k => k === "" ? h("span") :
        h("button",{type:"button",class:k==="bio"||k==="del"?"ghost":"","aria-label":k==="bio"?"البصمة":k==="del"?"مسح":k,onclick:()=>k==="bio"?tryBio():pressKey(k)},
          k === "bio" ? icon("i-finger") : k === "del" ? "⌫" : k))),
      h("button",{class:"link",type:"button",onclick:()=>{lockUI.forgot=true;renderLock();}},"نسيت الرمز؟"));
  }
  document.addEventListener("keydown", e => { if (!isLocked() || lockUI.forgot) return; if (/^[0-9]$/.test(e.key)) pressKey(e.key); else if (e.key === "Backspace") pressKey("del"); });
  let lastHidden = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden){ if (!bioBusy) lastHidden = Date.now(); return; }
    if (bioBusy) return;
    if (settings.lock && settings.lock.on && !isLocked() && n(settings.lockAfter) >= 0 && lastHidden && Date.now() - lastHidden >= n(settings.lockAfter) * 60000) lockNow();
  });
  async function enableBio(){
    try {
      const cred = await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)), rp:{name:"دفتر المصمم"},
        user:{id:crypto.getRandomValues(new Uint8Array(16)), name:"daftar", displayName:"دفتر المصمم"},
        pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],
        authenticatorSelection:{authenticatorAttachment:"platform", userVerification:"required", residentKey:"discouraged"}, timeout:60000, attestation:"none"}});
      settings.lock.cred = b64u(cred.rawId); saveSettings(); toast("تم تفعيل البصمة ✓"); render();
    } catch(e){ toast("لم يتم تفعيل البصمة"); }
  }
  function lockSettings(){
    const L = settings.lock || {};
    if (setup.step){
      const inp = h("input",{id:"pinIn",type:"password",inputmode:"numeric",maxlength:"4",autocomplete:"off",placeholder:"••••",style:"letter-spacing:.5em;text-align:center;font-size:1.3rem",
        oninput:async e => {
          const v = e.target.value.replace(/\D/g,"").slice(0,4); e.target.value = v;
          if (v.length < 4) return;
          if (setup.step === 1){ setup.first = v; setup.step = 2; setup.msg = ""; render(); setTimeout(()=>$("pinIn")?.focus(),30); return; }
          if (v !== setup.first){ setup.step = 1; setup.first = ""; setup.msg = "الرمزان غير متطابقين. حاول مرة أخرى."; render(); setTimeout(()=>$("pinIn")?.focus(),30); return; }
          const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
          settings.lock = {...L, on:true, salt, hash: await sha(salt + ":" + v), fails:0, until:0};
          saveSettings(); setup.step = 0; setup.first = "";
          toast(linked() ? "تم تفعيل القفل ✓" : "تم تفعيل القفل ✓ — يُفضّل تنزيل نسخة احتياطية");
          render();
        }});
      return [h("label",{class:"f"}, setup.step === 1 ? "اختر رمزاً من 4 أرقام" : "أعد كتابة الرمز للتأكيد", inp),
        setup.msg ? h("div",{class:"note",style:"color:var(--bad)"}, setup.msg) : null,
        h("button",{class:"btn sm",type:"button",style:"align-self:flex-start",onclick:()=>{setup.step=0;setup.first="";setup.msg="";render();}},"إلغاء")];
    }
    if (!L.on) return [h("p",null,"اقفل التطبيق برمز سري أو البصمة، فلا يفتحه أحد غيرك."),
      h("button",{class:"btn primary sm",type:"button",style:"align-self:flex-start",onclick:()=>{setup.step=1;render();setTimeout(()=>$("pinIn")?.focus(),30);}}, "تفعيل قفل التطبيق")];
    return [h("div",{class:"row-btns"}, h("span",{class:"cd c-done"},"✓ القفل مفعّل"),
        L.cred ? h("span",{class:"cd c-done"},"✓ البصمة") : bioAvail ? h("button",{class:"btn sm",type:"button",onclick:enableBio}, icon("i-finger"), "تفعيل البصمة") : null),
      h("div",null, h("span",{class:"flabel"},"يُقفل بعد الخروج منه"), n(settings.lockAfter) < 0 ? h("div",{class:"note"},"«مفتوح»: يطلب الرمز فقط عند فتح التطبيق من جديد.") : null,
        h("div",{class:"picks"}, ...[[0,"فوراً"],[0.5,"30 ثانية"],[1,"دقيقة"],[2,"دقيقتين"],[-1,"مفتوح"]].map(([k,t]) => h("button",{type:"button",class:"pick","aria-pressed":String(n(settings.lockAfter)===k),onclick:()=>{settings.lockAfter=k;saveSettings();render();}}, t)))),
      h("div",{class:"row-btns"},
        h("button",{class:"btn sm",type:"button",onclick:()=>{setup.step=1;render();setTimeout(()=>$("pinIn")?.focus(),30);}},"تغيير الرمز"),
        L.cred ? h("button",{class:"btn sm ghost",type:"button",onclick:()=>{delete settings.lock.cred;saveSettings();render();}},"إيقاف البصمة") : null,
        h("button",{class:"btn sm ghost danger",type:"button",onclick:()=>{settings.lock={on:false};saveSettings();toast("تم إيقاف القفل");render();}},"إيقاف القفل"))];
  }

  // ---------- start screen (dua) ----------
  function runSplash(){
    if (!document.documentElement.hasAttribute("data-splash")) return;
    const d = new Date(); settings.lastSplashDay = d.getFullYear() + "-" + (d.getMonth()+1) + "-" + d.getDate(); settings.lastSplashAt = Date.now(); saveSettings();
    const sp = $("splash"); let done = false;
    const hide = () => { if (done) return; done = true; sp.classList.add("out");
      setTimeout(() => { document.documentElement.removeAttribute("data-splash"); sp.classList.remove("out"); if (isLocked() && settings.lock.cred) tryBio(); }, 350); };
    setTimeout(hide, 4500); sp.addEventListener("click", hide);
  }

  // ---------- boot ----------
  // first run on a new device: nothing local, sheet linked → pull
  if ("serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))){
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    // a new version took over: reload once, but never in the middle of the start screen or an open window
    const reloadWhenFree = () => { if (reloaded) return; if (document.documentElement.hasAttribute("data-splash") || document.querySelector("dialog[open]")){ setTimeout(reloadWhenFree, 1500); return; } reloaded = true; location.reload(); };
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) reloadWhenFree(); });
    navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(()=>{});
  }
  if (location.hash.startsWith("#pair=")){ const code = location.hash; try { history.replaceState(null, "", location.pathname + "#home"); } catch(e){} setTimeout(() => applyPair(code), 300); }
  if (isLocked()){ if (settings.lock && settings.lock.on) renderLock(); else document.documentElement.removeAttribute("data-locked"); }
  render();
  runSplash();
  if (isLocked() && settings.lock.cred && !document.documentElement.hasAttribute("data-splash")) setTimeout(tryBio, 300);
  fetchRates();
  takeShared();
  scheduleSync(500);
})();
