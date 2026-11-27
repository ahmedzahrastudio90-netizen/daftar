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
  const TYPES = ["لوجو","هوية بصرية","سوشيال ميديا","مطبوعات","تغليف","UI / UX","موشن","إليستريشن","أخرى"];
  const DURS = [[3,"3 أيام"],[5,"5 أيام"],[7,"أسبوع"],[14,"أسبوعين"],[30,"شهر"]];
  const VIEWS = [["home","الرئيسية","i-home"],["jobs","المشاريع","i-jobs"],["clients","العملاء","i-clients"],["settings","الإعدادات","i-gear"]];
  const FILTERS = [["active","الجارية"],["late","متأخر"],["unpaid","مستحقات"],["done","مُسلَّمة"],["all","الكل"]];
  const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const DAYS = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

  // ---------- storage ----------
  const LS = {get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
              set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
  let all = LS.get("ledger.jobs", {});           // id -> job (incl. deleted tombstones)
  const settings = Object.assign({currency:"EGP", myName:"", sheetUrl:"", token:"", lastSync:0, lastBackup:"", remindDays:3, lastNotify:""}, LS.get("ledger.settings", {}));
  const saveSettings = () => LS.set("ledger.settings", settings);
  function persist(){ if (!LS.set("ledger.jobs", all)) toast("مساحة التخزين على الجهاز ممتلئة. نزّل نسخة احتياطية واحذف مشاريع قديمة."); }
  let jobs = [];
  const refreshJobs = () => { jobs = Object.values(all).filter(j => j && !j.deleted); };
  refreshJobs();

  let view = VIEWS.some(v=>v[0]===location.hash.slice(1)) ? location.hash.slice(1) : "home";
  let filter = LS.get("ledger.filter","active"), query = "";

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
  const isLate = (j) => isOpen(j) && !!j.due && daysUntil(j.due) < 0;
  const dayWord = (k) => k === 1 ? "يوم" : k === 2 ? "يومين" : (k <= 10 ? k+" أيام" : k+" يوم");
  const typesOf = (j) => Array.isArray(j.types) && j.types.length ? j.types : (j.type ? String(j.type).split(/\s*\+\s*/) : []);
  const typeText = (j) => typesOf(j).join(" + ");
  const initials = (s) => (s||"؟").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("");
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const bodyOf = (j) => { const d = {...j}; delete d.id; delete d.dirty; return d; };

  // ---------- exchange rates ----------
  // A payment in another currency keeps the rate of its day: rate = units of the main currency for 1 unit.
  const rateNow = (cur) => cur === settings.currency ? 1 : (settings.rates && settings.rates.base === settings.currency && settings.rates.map[cur]) || null;
  const payBase = (p, cur) => cur === settings.currency ? n(p.amount)
    : (p.rate && p.rateBase === settings.currency ? n(p.amount) * n(p.rate) : (rateNow(cur) ? n(p.amount) * rateNow(cur) : null));
  const stampPay = (p, cur) => cur === settings.currency ? p : {...p, rate: p.rate ? n(p.rate) : rateNow(cur), rateBase: settings.currency};
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
    const t = {base:0, by:{}, missing:{}, foreign:false};
    for (const it of items){
      if (!it.amount) continue;
      addTo(t.by, it.cur, it.amount);
      if (it.cur !== settings.currency) t.foreign = true;
      if (it.base == null) addTo(t.missing, it.cur, it.amount); else t.base += it.base;
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
    if (!j.due) return {t:"بدون موعد", c:"c-ok"};
    const k = daysUntil(j.due);
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

  function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2600); }

  // ---------- data writes ----------
  const store = {
    async save(id, data){ all[id] = {...data, id, updatedAt: Date.now(), dirty: true}; persist(); refreshJobs(); render(); scheduleSync(); },
    async remove(id){ all[id] = {id, deleted: true, updatedAt: Date.now(), dirty: true}; persist(); refreshJobs(); render(); scheduleSync(); }
  };

  // ---------- Google Sheet sync ----------
  let syncing = false, syncErr = "", syncTimer = null;
  function scheduleSync(ms){ clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms ?? 1500); }
  async function sync(manual){
    if (!settings.sheetUrl){ if (manual) toast("أدخل رابط الشيت أولاً"); return; }
    if (!navigator.onLine){ syncErr = ""; renderSync(); if (manual) toast("لا يوجد اتصال بالإنترنت. التغييرات محفوظة على الجهاز وستُرسل عند عودة الاتصال."); return; }
    if (syncing) return;
    syncing = true; renderSync();
    const changes = Object.values(all).filter(j => j.dirty).map(j => { const c = {...j}; delete c.dirty; return c; });
    try {
      const res = await fetch(settings.sheetUrl, {method:"POST", body: JSON.stringify({token: settings.token, action:"sync", changes, currency: settings.currency, remindDays: settings.remindDays})});
      const out = await res.json();
      if (!out || !out.ok) throw new Error(out && out.error === "token" ? "token" : "bad");
      const sent = Object.fromEntries(changes.map(c => [c.id, c.updatedAt]));
      for (const sj of out.jobs || []){
        if (!sj || typeof sj.id !== "string") continue;
        const lj = all[sj.id];
        if (!lj || (!lj.dirty && n(sj.updatedAt) >= n(lj.updatedAt)) || (lj.dirty && n(sj.updatedAt) > n(lj.updatedAt))) all[sj.id] = {...sj};
      }
      for (const [id, ts] of Object.entries(sent)) if (all[id] && all[id].updatedAt === ts) delete all[id].dirty;
      settings.lastSync = Date.now(); saveSettings(); syncErr = "";
      persist(); refreshJobs();
      if (manual) toast("تمت المزامنة مع الشيت ✓");
    } catch(e){
      syncErr = e && e.message === "token" ? "كلمة المرور غير صحيحة" : "تعذّر الاتصال بالشيت";
      if (manual) toast(syncErr === "كلمة المرور غير صحيحة" ? "كلمة المرور لا تطابق المسجّلة في الشيت" : "تعذّر الاتصال بالشيت. تأكد من الرابط.");
    } finally { syncing = false; render(); }
  }
  window.addEventListener("online", () => { renderSync(); scheduleSync(300); fetchRates(); });
  window.addEventListener("offline", renderSync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleSync(300); });
  setInterval(() => { if (!document.hidden) sync(); }, 120000);

  function syncState(){
    const pending = Object.values(all).some(j=>j.dirty);
    if (!settings.sheetUrl) return {c:"off", t:"محفوظ على الجهاز"};
    if (!navigator.onLine) return {c:"off", t: pending ? "غير متصل · ستتم المزامنة لاحقاً" : "غير متصل"};
    if (syncing) return {c:"busy", t:"جارٍ المزامنة…"};
    if (syncErr) return {c:"err", t: syncErr};
    if (pending) return {c:"busy", t:"في انتظار المزامنة"};
    return {c:"ok", t:"متزامن مع الشيت"};
  }
  function renderSync(){
    const s = syncState();
    for (const id of ["syncSide","syncTop"]){ const el = $(id); el.className = "sync " + s.c; el.title = s.t; el.lastElementChild.textContent = s.t; }
  }

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
    renderNav(); renderSync(); clearTimeout(render._r); render._r = setTimeout(reminders, 400);
    $("pageTitle").textContent = VIEWS.find(v=>v[0]===view)[1];
    const nodes = view === "home" ? viewHome() : view === "jobs" ? viewJobs() : view === "clients" ? viewClients() : viewSettings();
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
    for (const j of jobs){ const cur = curOf(j); for (const p of paysOf(j)) if (isRecv(p) && recvDate(p).startsWith(prefix)) items.push({amount:n(p.amount), cur, base:payBase(p, cur)}); }
    return totals(items);
  }

  // ---------- home ----------
  // ---------- reminders ----------
  function dueSoon(){ return jobs.filter(j => isOpen(j) && j.due && daysUntil(j.due) <= settings.remindDays).sort((a,b)=>a.due.localeCompare(b.due)); }
  const reminderText = (j) => { const k = daysUntil(j.due); return (k < 0 ? "متأخر " + dayWord(-k) : k === 0 ? "التسليم اليوم" : k === 1 ? "التسليم غداً" : "متبقٍ " + dayWord(k)) + ": " + (j.title||"") + (j.client ? " — " + j.client : ""); };
  async function reminders(){
    const list = dueSoon();
    try { if ("setAppBadge" in navigator) list.length ? navigator.setAppBadge(list.length) : navigator.clearAppBadge(); } catch(e){}
    // snapshot for the background check in sw.js
    try { if ("caches" in window){ const c = await caches.open("reminders"); await c.put("snapshot", new Response(JSON.stringify(jobs.filter(j=>isOpen(j)&&j.due).map(j=>({title:j.title, client:j.client, due:j.due}))))); await c.put("days", new Response(String(settings.remindDays))); } } catch(e){}
    // once a day, when the app opens
    if (list.length && settings.lastNotify !== todayStr() && "Notification" in window && Notification.permission === "granted"){
      settings.lastNotify = todayStr(); saveSettings();
      try { const reg = await navigator.serviceWorker?.getRegistration(); const body = list.slice(0,4).map(reminderText).join("\n");
        const opts = {body, tag:"due-today", icon:"icons/icon-192.png", badge:"icons/icon-192.png", dir:"rtl", lang:"ar"};
        if (reg) reg.showNotification("مواعيد تسليم قريبة", opts); else new Notification("مواعيد تسليم قريبة", opts); } catch(e){}
    }
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
  function transitStrip(){
    const items = []; for (const j of jobs) paysOf(j).forEach(p => { if (!isRecv(p)) items.push(money(p.amount, curOf(j)) + " من " + (j.client||"—")); });
    if (!items.length) return null;
    return h("div",{class:"exbar"}, h("span",null, h("b",null,"مدفوعات قيد التحويل: "), items.slice(0,3).join(" · ") + (items.length>3 ? " · و" + (items.length-3) + " أخرى" : "") + ". عند وصولها لحسابك افتح المشروع واضغط «تم الاستلام»."));
  }
  function remindStrip(){
    const list = dueSoon(); if (!list.length) return null;
    return h("div",{class:"exbar",style:"background:var(--bad-soft);color:var(--bad)"},
      h("span",null, h("b",null,"تذكير: "), list.slice(0,3).map(reminderText).join(" · ") + (list.length > 3 ? " · و" + (list.length-3) + " أخرى" : "")),
      h("button",{class:"btn sm",type:"button",onclick:()=>{filter="active";go("jobs");}},"عرض"));
  }

  function viewHome(){
    if (!jobs.length) return [waCard(), emptyFirst()];
    const now = new Date(), ym = todayStr().slice(0,7), y = String(now.getFullYear());
    const prev = new Date(now.getFullYear(), now.getMonth()-1, 1), prevYm = iso(prev).slice(0,7);
    const mIn = income(ym), yIn = income(y), pIn = income(prevYm);
    const transit = totals(jobs.flatMap(j => { const cur = curOf(j); return paysOf(j).filter(p => !isRecv(p)).map(p => ({amount:n(p.amount), cur, base:payBase(p, cur)})); }));
    const transitN = jobs.reduce((a,j)=>a+paysOf(j).filter(p=>!isRecv(p)).length, 0);
    const due = totals(jobs.map(j => { const cur = curOf(j), r = remOf(j); return {amount:r, cur, base: rateNow(cur) ? r * rateNow(cur) : null}; }));
    const open = jobs.filter(isOpen), late = jobs.filter(isLate);
    const owing = clientsList().filter(c=>Object.values(c.rem).some(v=>v>0));

    const kpi = (cls, dot, lbl, val, foot) => h("div",{class:"kpi "+cls},
      h("div",{class:"lbl"}, h("i",{style:"background:"+dot}), lbl), h("div",{class:"val num"}, val), h("div",{class:"foot"}, foot));
    const upcoming = open.slice().sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999")).slice(0,6);

    // months of this year
    const months = [];
    for (let i = 0; i <= now.getMonth(); i++){ const k = y + "-" + String(i+1).padStart(2,"0"); const m = income(k); if (i === now.getMonth() || Object.keys(m.by).length) months.push([i, m]); }
    const maxMain = Math.max(1, ...months.map(([,m]) => m.base));

    return [
      remindStrip(),
      transitStrip(),
      waCard(),
      h("section",{class:"kpis","aria-label":"الملخص"},
        kpi("", "var(--ok)", "الدخل في " + MONTHS[now.getMonth()], totalView(mIn), transitN ? "قيد التحويل: " + money(Math.round(transit.base)) + (Object.keys(transit.missing).length ? " + " + moneyMap(transit.missing) : "") : "الشهر السابق: " + money(Math.round(pIn.base))),
        kpi("", "var(--cyan)", "الدخل في " + y, totalView(yIn), "المتوسط الشهري: " + money(Math.round(yIn.base/(now.getMonth()+1)))),
        kpi("owed", "var(--magenta)", "مستحقات لدى العملاء", totalView(due, due.foreign), owing.length ? "لدى " + owing.length + " عميل" : "لا توجد مستحقات"),
        kpi("late", "var(--bad)", "مشاريع جارية", h("span",{class:late.length?"":"",style:late.length?"color:var(--bad)":""}, open.length), late.length ? late.length + " متأخر عن موعده" : "جميعها في موعدها")
      ),
      h("section",{class:"panels"},
        h("div",{class:"panel"},
          h("div",{class:"panel-h"}, h("h2",null,"التسليمات القادمة"), h("button",{class:"btn ghost sm",type:"button",onclick:()=>{filter="active";go("jobs")}},"الكل")),
          upcoming.length ? h("ul",{class:"plist"}, ...upcoming.map(j => {
            const d = parseD(j.due);
            return h("li",{tabindex:"0",onclick:()=>openSheet(j.id),onkeydown:e=>{if(e.key==="Enter")openSheet(j.id)}},
              h("div",{class:"datebox"+(isLate(j)?" late":"")}, h("b",{class:"num"}, d?d.getDate():"—"), h("span",null, d?MONTHS[d.getMonth()]:"بدون")),
              h("div",{class:"grow"}, h("div",{class:"t"}, j.title||"بدون اسم"), h("div",{class:"s"}, j.client||"—")),
              cdChip(j));
          })) : h("div",{class:"pempty"},"لا توجد مشاريع جارية حالياً.")),
        h("div",{class:"panel"},
          h("div",{class:"panel-h"}, h("h2",null,"مستحقات لدى العملاء"), h("button",{class:"btn ghost sm",type:"button",onclick:()=>{filter="unpaid";go("jobs")}},"التفاصيل")),
          owing.length ? h("ul",{class:"plist"}, ...owing.slice(0,6).map(c =>
            h("li",{tabindex:"0",onclick:()=>showClient(c.name),onkeydown:e=>{if(e.key==="Enter")showClient(c.name)}},
              h("span",{class:"avatar"}, initials(c.name)),
              h("div",{class:"grow"}, h("div",{class:"t"}, c.name), h("div",{class:"s"}, c.phone || " ")),
              h("span",{class:"amt num"}, moneyMap(c.rem))))) : h("div",{class:"pempty"},"لا توجد مستحقات متأخرة."))
      ),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"الدخل الشهري · " + y), h("b",{class:"num",style:"color:var(--ok)"}, money(Math.round(yIn.base)))),
        h("ul",{class:"months"}, ...months.reverse().map(([i,m]) => h("li",null,
          h("span",{class:i===now.getMonth()?"now":""}, MONTHS[i]),
          h("span",{class:"barw"}, h("i",{style:"width:"+(m.base/maxMain*100).toFixed(1)+"%"})),
          h("b",{class:"num",title:moneyMap(m.by)}, Object.keys(m.by).length ? money(Math.round(m.base)) : "—")))))
    ];
  }

  function waCard(){
    return h("div",{class:"wa-card"},
      h("span",{class:"ic"}, icon("i-wa")),
      h("div",{class:"tx"}, h("b",null,"اتفاق جديد على واتساب؟"), h("span",null,"الصق رسائل الاتفاق، ويستخرج الدفتر العميل والسعر والعربون وموعد التسليم تلقائياً.")),
      h("button",{class:"btn wa",type:"button",onclick:()=>openWa()}, icon("i-wa"), "استيراد من واتساب"));
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
  const searchBox = (ph) => h("input",{class:"search",id:"search",type:"search",placeholder:ph,value:query,oninput:e=>{query=e.target.value;render();}});
  function viewJobs(){
    if (!jobs.length) return [emptyFirst()];
    const counts = {active:jobs.filter(isOpen).length, late:jobs.filter(isLate).length, unpaid:jobs.filter(j=>remOf(j)>0).length, done:jobs.filter(j=>j.status==="done").length, all:jobs.length};
    const tb = h("div",{class:"toolbar"},
      h("div",{class:"seg",role:"group","aria-label":"فلتر"}, ...FILTERS.map(([k,t]) => h("button",{type:"button","aria-pressed":String(filter===k),onclick:()=>{filter=k;LS.set("ledger.filter",k);render();}}, t, h("b",{class:"num"},counts[k])))),
      searchBox("ابحث باسم العميل أو المشروع أو الرقم…"));
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
    const tb = h("div",{class:"toolbar"}, searchBox("ابحث باسم العميل أو رقمه…"));
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
  function showClient(name){ query = name; filter = "all"; go("jobs"); }

  // ---------- settings ----------
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (view === "settings") render(); });
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function viewSettings(){
    const curSel = (id, val, onch) => h("select",{id,class:"search",style:"flex:none;width:auto",onchange:onch}, ...Object.keys(CUR).map(k=>h("option",{value:k,selected:val===k?true:null}, CUR_NAME[k]+" ("+CUR[k]+")")));
    const st = syncState();
    const last = settings.lastBackup; const age = last ? -daysUntil(last) : null;
    const fileIn = h("input",{type:"file",id:"bkFile",accept:".json,application/json",hidden:true,onchange:e=>{ if (e.target.files[0]) readBackup(e.target.files[0]); e.target.value=""; }});
    return [h("div",{class:"sets"},
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"الربط بشيت جوجل"), h("span",{class:"cd " + (st.c==="ok"?"c-done":st.c==="err"?"c-late":"c-ok")}, st.t)),
        h("div",null,
          h("p",null,"يعمل الدفتر بدون إنترنت ويحفظ البيانات على الجهاز. عند ربطه بشيت جوجل تُرسل كل التعديلات تلقائياً عند توفر الاتصال، ويمكنك فتح نفس البيانات من أي جهاز أو تنزيلها كملف Excel."),
          h("label",{class:"f"},"رابط الشيت (Web App URL)", h("input",{id:"sUrl",type:"url",dir:"ltr",placeholder:"https://script.google.com/macros/s/…/exec",value:settings.sheetUrl})),
          h("label",{class:"f"},"كلمة المرور المسجّلة في الشيت", h("input",{id:"sTok",type:"password",dir:"ltr",value:settings.token,autocomplete:"off"})),
          h("div",{class:"row-btns"},
            h("button",{class:"btn primary",type:"button",onclick:()=>{
              const u = $("sUrl").value.trim();
              if (u && !/^https:\/\/script\.google(usercontent)?\.com\//.test(u)){ toast("يجب أن يبدأ الرابط بـ https://script.google.com"); return; }
              settings.sheetUrl = u; settings.token = $("sTok").value.trim(); saveSettings();
              if (u){ for (const j of Object.values(all)) j.dirty = true; persist(); sync(true); } else { toast("تم إلغاء الربط"); render(); }
            }}, settings.sheetUrl ? "حفظ ومزامنة" : "ربط بالشيت"),
            settings.sheetUrl ? h("button",{class:"btn",type:"button",onclick:()=>sync(true)},"مزامنة الآن") : null),
          settings.lastSync ? h("p",{class:"hint"}, "آخر مزامنة: " + new Date(settings.lastSync).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"})) : null,
          h("details",{class:"more"}, h("summary",null,"طريقة إعداد الشيت (مرة واحدة، 3 دقائق)"),
            h("ol",{style:"margin-top:10px"},
              h("li",null,"افتح ", h("b",null,"sheets.new"), " وأنشئ شيتاً جديداً باسم «دفتر المصمم»."),
              h("li",null,"من القائمة: Extensions ← Apps Script."),
              h("li",null,"احذف المحتوى الموجود والصق محتوى ملف ", h("code",{class:"k"},"google-sheet-script.gs"), " المرفق مع التطبيق، وغيّر كلمة المرور في السطر الأول."),
              h("li",null,"Deploy ← New deployment ← النوع Web app ← Execute as: Me ← Who has access: Anyone ← Deploy، ووافق على الصلاحيات."),
              h("li",null,"انسخ رابط الـ Web app والصقه هنا مع كلمة المرور، ثم اضغط «ربط بالشيت».")))
        )),
      h("section",{class:"panel"},
        h("div",{class:"panel-h"}, h("h2",null,"عام")),
        h("div",null,
          h("label",{class:"f"},"العملة الأساسية", curSel("sCur", settings.currency, e=>{settings.currency=e.target.value; saveSettings(); fetchRates(true); render();})),
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
        h("div",{class:"panel-h"}, h("h2",null,"التنبيهات")),
        h("div",null,
          h("p",null,"التذكير قبل موعد التسليم بـ:"),
          h("div",{class:"picks"}, ...[1,2,3,4].map(k => h("button",{type:"button",class:"pick","aria-pressed":String(settings.remindDays===k),onclick:()=>{ settings.remindDays=k; saveSettings(); for (const j of Object.values(all)) if (!j.deleted && j.due) j.dirty = true; persist(); render(); scheduleSync(); }}, dayWord(k)))),
          h("p",null, h("b",null,"على الهاتف والكمبيوتر: "), "عند ربط الدفتر بالشيت، يُضاف كل موعد تسليم إلى Google Calendar في تقويم «دفتر المصمم»، وتصلك تنبيهات في العاشرة صباحاً يومياً خلال هذه الفترة حتى يوم التسليم، حتى لو كان التطبيق مغلقاً. ويمكنك إضافة ويدجت Google Calendar على شاشة الهاتف أو الكمبيوتر."),
          h("div",{class:"row-btns"},
            "Notification" in window && Notification.permission === "granted" ? h("span",{class:"cd c-done"},"✓ إشعارات التطبيق مفعّلة")
              : h("button",{class:"btn sm",type:"button",onclick:enableNotify},"تفعيل إشعارات التطبيق"),
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
            h("button",{class:"btn sm",type:"button",disabled:!jobs.length?true:null,onclick:()=>download("دفتر-الاستوديو-"+todayStr()+".csv", backupCsv(), "text/csv")},"تنزيل ملف Excel"),
            h("button",{class:"btn sm",type:"button",disabled:!jobs.length?true:null,onclick:()=>download("دفتر-الاستوديو-نسخة-"+todayStr()+".json", backupJson(), "application/json")},"تنزيل نسخة كاملة"),
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
  const backupJson = () => JSON.stringify({app:"studio-ledger", version:2, exportedAt:new Date().toISOString(), currency:settings.currency, jobs: jobs.map(j=>({...bodyOf(j), id:j.id}))}, null, 1);
  function backupCsv(){
    const cell = v => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g,'""') + '"'; };
    const head = ["العميل","الرقم","المشروع","النوع","الحالة","العملة","السعر","المدفوع","المدفوع بالـ" + CUR[settings.currency],"المتبقي","البدء","الإنجاز","التسليم","تم التسليم","التعديلات","الدفعات","ملاحظات"];
    const rows = jobs.map(j => [j.client, j.phone, j.title, typeText(j), (STATUS[j.status]||STATUS.new).t, CUR[curOf(j)], n(j.price), paidOf(j), Math.round(paysOf(j).reduce((a,p)=>a+(payBase(p,curOf(j))||0),0)), remOf(j), j.start, j.finish, j.due, j.delivered, j.revisions,
      paysOf(j).map(p => fmt(p.amount) + " (" + (p.date||"") + (p.rate ? " سعر " + fmtRate(p.rate) : "") + (p.note ? " " + p.note : "") + ")").join(" + "), j.notes]);
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
  const wz = {id:null, types:[], cur:"EGP", dur:null, onSaved:null};
  const CUR_ORDER = ["EGP","SAR","USD","AED","KWD","EUR"];
  function openForm(id, preset){
    const j = id ? all[id] : null;
    wz.id = id; wz.dur = null; wz.onSaved = preset?.onSaved || null;
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
    $("fNotes").value = src.notes || "";
    wz.types = typesOf(src).filter(t => TYPES.includes(t));
    $("more").open = !!(src.notes || src.revisions);
    document.querySelectorAll("label.f.err").forEach(l=>l.classList.remove("err"));
    renderForm();
    $("wizDlg").showModal();
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
    $("durPicks").replaceChildren(...DURS.map(([k,t]) => h("button",{type:"button",class:"pick","aria-pressed":String(wz.dur===k),onclick:()=>{
      wz.dur = k; const st = $("fStart").value || todayStr();
      $("fDue").value = addDays(st, k); $("fFinish").value = addDays(st, Math.max(1, k - (k>=7?2:1))); renderForm(); }}, t)));
    syncDates($("wizDlg"));
  }
  $("fDue").addEventListener("input", () => { wz.dur = null; renderForm(); });
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
    if (!j){ const dep = n($("fDeposit").value); if (dep > 0) data.payments = [stampPay({amount:dep, date:start||todayStr(), note:"عربون", rate: n($("fRate").value) || null}, wz.cur)]; }
    const id = wz.id || newId();
    store.save(id, data);
    $("wizDlg").close();
    if (wz.onSaved){ const cb = wz.onSaved; wz.onSaved = null; cb(id); }
    toast(j ? "تم حفظ التعديلات" : "تم تسجيل المشروع");
  }

  // ---------- details sheet ----------
  let sheetId = null, confirmDel = false, payDraft = null;
  function openSheet(id){ sheetId = id; confirmDel = false; payDraft = null; renderSheet(); $("sheetDlg").showModal(); }
  for (const d of ["sheetDlg","wizDlg","waDlg"]) $(d).addEventListener("click", e => { if (e.target === $(d)) $(d).close(); });

  function renderSheet(){
    const j = jobs.find(x=>x.id===sheetId);
    if (!j){ if ($("sheetDlg").open) $("sheetDlg").close(); return; }
    if ($("pAmt")) payDraft = {amt:$("pAmt").value, date:$("pDate").value, note:$("pNote").value, rate: $("pRate") ? $("pRate").value : "", recv: $("pRecv") ? $("pRecv").checked : true};
    const paid = paidOf(j), rem = remOf(j), price = n(j.price), cur = curOf(j);
    const pays = paysOf(j).map((p,i)=>({...p,i})).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    const digits = (j.phone||"").replace(/[^\d]/g,"");
    const wa = digits.startsWith("0") && digits.length === 11 ? "2" + digits : digits;
    const save = (next, msg) => { store.save(j.id, next); toast(msg); };
    const setStatus = (s) => { const nx = bodyOf(j); nx.status = s; nx.delivered = s === "done" ? (nx.delivered || todayStr()) : ""; save(nx, "الحالة: " + STATUS[s].t); };

    const payForm = j.status !== "cancel" && rem > 0 ? h("form",{class:"payform",onsubmit:e=>{
        e.preventDefault();
        const amt = n($("pAmt").value); if (amt <= 0){ toast("أدخل المبلغ"); return; }
        const nx = bodyOf(j); nx.payments = [...paysOf(j), stampPay({amount:amt, date:$("pDate").value||todayStr(), note:$("pNote").value.trim(), rate: $("pRate") ? n($("pRate").value) || null : null, ...($("pRecv").checked ? {} : {received:false})}, cur)];
        payDraft = null; save(nx, "تم تسجيل دفعة " + money(amt, cur));
      }},
      h("label",{class:"f money-in"},"المبلغ ("+CUR[cur]+")", h("input",{id:"pAmt",type:"number",min:"0",step:"any",inputmode:"decimal",value:payDraft?payDraft.amt:String(rem)})),
      h("label",{class:"f"},"التاريخ", h("input",{id:"pDate",type:"date",value:payDraft?payDraft.date:todayStr()})),
      cur !== settings.currency ? h("label",{class:"f full"}, "سعر الصرف: 1 " + CUR[cur] + " = " + CUR[settings.currency],
        h("input",{id:"pRate",type:"number",min:"0",step:"any",inputmode:"decimal",placeholder:"سعر اليوم",value:payDraft ? payDraft.rate : (rateNow(cur) || "")}),
        h("span",{class:"hint"}, "تُحتسب الدفعة بهذا السعر. عدّله إذا احتسب البنك أو المحفظة سعراً مختلفاً.")) : null,
      h("label",{class:"full",style:"display:flex;gap:8px;align-items:center;font-size:.9rem"}, h("input",{id:"pRecv",type:"checkbox",checked:payDraft && payDraft.recv === false ? null : true,style:"width:18px;height:18px"}), "تم استلام المبلغ في حسابي"),
      h("label",{class:"f full"},"طريقة الدفع", h("input",{id:"pNote",placeholder:"نقدي، فودافون كاش، إنستاباي، تحويل بنكي…",value:payDraft?payDraft.note:""})),
      h("button",{class:"btn primary full",type:"submit",style:"justify-content:center"}, icon("i-plus"), "تسجيل دفعة")) : null;

    $("sheet").replaceChildren(
      h("div",{class:"sh-h"},
        h("div",{class:"row"}, h("h2",null, j.title||"بدون اسم"), h("button",{class:"btn ghost sm",type:"button","aria-label":"إغلاق",onclick:()=>$("sheetDlg").close()}, icon("i-x"))),
        h("div",{class:"who"}, (j.client||"—") + (typeText(j) ? " · " + typeText(j) : "")),
        h("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, stPill(j), cdChip(j))),
      h("div",{class:"sh-b"},
        h("div",{class:"blk"},
          h("h3",null,"الحساب · " + CUR_NAME[cur]),
          h("div",{class:"mgrid"},
            h("div",null, h("span",null,"السعر"), h("b",{class:"num"}, fmt(price))),
            h("div",null, h("span",null,"المدفوع"), h("b",{class:"num",style:"color:var(--ok)"}, fmt(paid))),
            h("div",null, h("span",null,"المتبقي"), h("b",{class:"num jrem "+(rem>0?"has":"zero")}, rem>0?fmt(rem):"مدفوع بالكامل ✓"))),
          h("div",{class:"meter"+(price&&paid>=price?" full":""),style:"margin-top:10px"}, h("i",{style:"width:"+(price?Math.min(100,paid/price*100):0).toFixed(1)+"%"}))),
        h("div",{class:"blk"},
          h("h3",null,"الدفعات"),
          pays.length ? h("ul",{class:"pays"}, ...pays.map(p => h("li",null,
            h("span",{class:"a num"}, money(p.amount,cur)), h("span",null, dshort(p.date) + (p.recvDate && p.recvDate !== p.date ? " · استُلم " + dshort(p.recvDate) : "")),
            cur !== settings.currency ? h("span",{class:"hint num"}, payBase(p,cur) != null ? "= " + money(Math.round(payBase(p,cur))) + (p.rate && p.rateBase === settings.currency ? " (سعر " + fmtRate(p.rate) + ")" : " تقريباً") : "بدون سعر صرف") : null,
            h("span",{class:"n"}, p.note||""),
            !isRecv(p) ? h("span",{class:"cd c-soon"},"قيد التحويل") : null,
            !isRecv(p) ? h("button",{class:"btn sm",type:"button",onclick:()=>{ const nx = bodyOf(j); nx.payments = paysOf(j).map((q,i)=> i===p.i ? {...q, received:true, recvDate:todayStr(), ...(cur!==settings.currency && !(q.rate && q.rateBase===settings.currency) ? {rate:rateNow(cur), rateBase:settings.currency} : {})} : q); save(nx, "تم استلام " + money(p.amount,cur) + " ✓"); }},"تم الاستلام") : null,
            h("button",{class:"btn ghost sm danger",type:"button","aria-label":"حذف الدفعة",onclick:()=>{ const nx = bodyOf(j); nx.payments = paysOf(j).filter((_,i)=>i!==p.i); save(nx,"تم حذف الدفعة"); }}, icon("i-x"))
          ))) : h("div",{class:"hint"},"لا توجد دفعات بعد."),
          payForm),
        h("div",{class:"blk"}, h("h3",null,"الحالة"),
          h("div",{class:"picks"}, ...Object.entries(STATUS).map(([k,v]) => h("button",{class:"pick",type:"button","aria-pressed":String(j.status===k),onclick:()=>setStatus(k)}, v.t)))),
        h("div",{class:"blk"},
          h("h3",null,"البيانات والمواعيد"),
          h("div",{class:"kv"},
            h("span",null,"الرقم"), h("div",{class:"phone"}, h("code",null, j.phone||"—"),
              j.phone ? h("button",{class:"btn sm",type:"button",onclick:async()=>{try{await navigator.clipboard.writeText(j.phone);toast("تم نسخ الرقم")}catch(e){toast("حدّد الرقم وانسخه")}}},"نسخ") : null,
              wa ? h("a",{class:"btn sm",href:"https://wa.me/"+wa,target:"_blank",rel:"noopener"},"واتساب") : null),
            h("span",null,"البدء"), h("span",null, dlong(j.start)),
            h("span",null,"الإنجاز"), h("span",null, dlong(j.finish)),
            h("span",null,"التسليم"), h("b",null, dlong(j.due)),
            j.status==="done" ? h("span",null,"تم التسليم") : null, j.status==="done" ? h("span",null, dlong(j.delivered)) : null,
            h("span",null,"التعديلات"), h("span",null, j.revisions!==""&&j.revisions!=null ? j.revisions+" متفق عليها" : "—"))),
        j.notes ? h("div",{class:"blk"}, h("h3",null,"ملاحظات"), h("div",{style:"white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem"}, j.notes)) : null,
        confirmDel ? h("div",{class:"confirm"}, "حذف هذا المشروع ودفعاته نهائياً؟",
          h("button",{class:"btn sm danger solid",type:"button",onclick:()=>{store.remove(j.id);$("sheetDlg").close();toast("تم حذف المشروع")}},"حذف"),
          h("button",{class:"btn sm",type:"button",onclick:()=>{confirmDel=false;renderSheet()}},"إلغاء")) : null),
      h("div",{class:"sh-f"},
        h("button",{class:"btn primary",type:"button",onclick:()=>{$("sheetDlg").close();openForm(j.id)}},"تعديل"),
        h("button",{class:"btn",type:"button",onclick:()=>{$("sheetDlg").close();openForm(null,{client:j.client,phone:j.phone,currency:j.currency})}}, icon("i-plus"), "مشروع جديد لنفس العميل"),
        h("span",{class:"sp"}),
        !confirmDel ? h("button",{class:"btn ghost danger",type:"button",onclick:()=>{confirmDel=true;renderSheet()}},"حذف") : null));
  }

  { const _rs = renderSheet; renderSheet = function(){ _rs(); syncDates($("sheet")); }; }

  // ---------- WhatsApp ----------
  const wa = {text:"", result:null, created:{}, timer:null};
  function openWa(text){
    if (typeof text === "string"){ wa.text = text; wa.result = null; }
    else if (wa.result && wa.result.actions.every(a=>a.state!=="pending")){ wa.text = ""; wa.result = null; }
    if (wa.text && !wa.result) analyze();
    renderWa(); if (!$("waDlg").open) $("waDlg").showModal();
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

  // ---------- boot ----------
  // first run on a new device: nothing local, sheet linked → pull
  if ("serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) navigator.serviceWorker.register("sw.js").catch(()=>{});
  render();
  fetchRates();
  takeShared();
  scheduleSync(500);
})();
