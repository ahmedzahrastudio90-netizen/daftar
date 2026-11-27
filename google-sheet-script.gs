/**
 * دفتر المصمم — سكريبت الشيت
 * 1) غيّر كلمة السر اللي تحت لكلمة سر من عندك، وحط نفس الكلمة في إعدادات التطبيق.
 * 2) Deploy ← New deployment ← Web app ← Execute as: Me ← Who has access: Anyone.
 * الشيت ده نسخة للقراية: التعديل بيتم من التطبيق، والشيت بيتحدّث لوحده.
 * كمان بيحط مواعيد التسليم في Google Calendar (تقويم «دفتر المصمم») بتنبيه الساعة 10 الصبح.
 */
const TOKEN = "غيّر-كلمة-السر-دي";
const CAL_NAME = "دفتر المصمم";
const REMIND_HOUR = 10;

const CUR = { EGP: "ج.م", USD: "$", SAR: "ر.س", AED: "د.إ", KWD: "د.ك", EUR: "€" };
const STATUS = { new: "لم يبدأ", work: "قيد التنفيذ", review: "قيد مراجعة العميل", done: "تم التسليم", cancel: "ملغي" };

function doGet() { return out({ ok: true, app: "studio-ledger" }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const req = JSON.parse(e.postData.contents || "{}");
    if (req.token !== TOKEN) return out({ ok: false, error: "token" });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = sheet_(ss, "_data", true);
    const last = data.getLastRow();
    const rows = last > 1 ? data.getRange(2, 1, last - 1, 4).getValues() : [];
    const map = {};
    rows.forEach((r) => { if (r[0]) map[r[0]] = { updatedAt: Number(r[1]) || 0, json: String(r[2]), at: Number(r[3]) || 0 }; });
    const now = Date.now();

    const changes = Array.isArray(req.changes) ? req.changes : [];
    let changed = false;
    changes.forEach((j) => {
      if (!j || typeof j.id !== "string") return;
      const cur = map[j.id];
      if (!cur || (Number(j.updatedAt) || 0) >= cur.updatedAt) { map[j.id] = { updatedAt: Number(j.updatedAt) || 0, json: JSON.stringify(j), at: now }; changed = true; }
    });

    const ids = Object.keys(map);
    if (changed) {
      data.clearContents();
      data.getRange(1, 1, 1, 4).setValues([["id", "updatedAt", "json", "savedAt"]]);
      if (ids.length) data.getRange(2, 1, ids.length, 4).setValues(ids.map((id) => [id, map[id].updatedAt, map[id].json, map[id].at]));
    }
    const jobs = ids.map((id) => JSON.parse(map[id].json));
    if (changed) {
      writeViews_(ss, jobs.filter((j) => !j.deleted && !j.kind), req.currency);
      writeExpenses_(ss, jobs.filter((j) => !j.deleted && j.kind === "expense"), req.currency);
      try { syncCalendar_(jobs.filter((j) => !j.kind), Number(req.remindDays) || 3); } catch (err) { console.warn(err); }
    }
    // only what changed since this device last asked (everything on first sync)
    const since = Number(req.since) || 0;
    const fresh = since ? ids.filter((id) => map[id].at > since).map((id) => JSON.parse(map[id].json)) : jobs;
    return out({ ok: true, jobs: fresh, now: now });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function sheet_(ss, name, hidden) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (hidden) sh.hideSheet(); }
  sh.setRightToLeft(true);
  return sh;
}
const num_ = (v) => (isFinite(Number(v)) ? Number(v) : 0);
const paid_ = (j) => (j.payments || []).reduce((a, p) => a + num_(p.amount), 0);
const rem_ = (j) => (j.status === "cancel" ? 0 : Math.max(0, num_(j.price) - paid_(j)));
const types_ = (j) => (Array.isArray(j.types) && j.types.length ? j.types.join(" + ") : j.type || "");

function fill_(sh, head, rows) {
  sh.clearContents();
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight("bold").setBackground("#0F1C2B").setFontColor("#FFFFFF");
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.setFrozenRows(1);
}

function writeViews_(ss, jobs, defCur) {
  const cur = (j) => CUR[j.currency] || CUR[defCur] || "ج.م";
  jobs.sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));
  fill_(sheet_(ss, "المشاريع"),
    ["العميل", "رقم الهاتف", "المشروع", "النوع", "الحالة", "العملة", "السعر", "المدفوع", "المتبقي", "البدء", "الإنجاز", "التسليم", "تاريخ التسليم الفعلي", "ملاحظات"],
    jobs.map((j) => [j.client || "", j.phone ? "'" + j.phone : "", j.title || "", types_(j), STATUS[j.status] || "", cur(j), num_(j.price), paid_(j), rem_(j),
      j.start || "", j.finish || "", j.due || "", j.delivered || "", j.notes || ""]));

  const pays = [];
  const base = CUR[defCur] ? defCur : "EGP";
  jobs.forEach((j) => (j.payments || []).forEach((p) => {
    const recv = p.received !== false;
    const inBase = (j.currency || base) === base ? num_(p.amount) : (p.rate && p.rateBase === base ? num_(p.amount) * num_(p.rate) : "");
    pays.push([recv ? (p.recvDate || p.date || "") : "", p.date || "", j.client || "", j.title || "", num_(p.amount), cur(j), p.rate || "", inBase === "" ? "" : Math.round(inBase), recv ? "تم الاستلام" : "قيد التحويل", p.note || ""]);
  }));
  pays.sort((a, b) => String(b[1]).localeCompare(String(a[1])));
  fill_(sheet_(ss, "الدفعات"), ["تاريخ الاستلام", "تاريخ التحويل", "العميل", "المشروع", "المبلغ", "العملة", "سعر الصرف", "بالـ" + CUR[base], "الحالة", "الطريقة"], pays);

  const months = {};
  pays.forEach((p) => { const k = String(p[0]).slice(0, 7); if (!k) return; months[k] = months[k] || { total: 0 }; months[k].total += Number(p[7]) || 0; months[k][p[5]] = (months[k][p[5]] || 0) + p[4]; });
  const curs = Object.keys(CUR).map((k) => CUR[k]).filter((c) => Object.keys(months).some((m) => months[m][c]));
  const keys = Object.keys(months).sort().reverse();
  fill_(sheet_(ss, "الدخل"), ["الشهر", "الإجمالي بالـ" + CUR[base]].concat(curs), keys.map((k) => [k, Math.round(months[k].total)].concat(curs.map((c) => months[k][c] || 0))));
}

// ---------- Google Calendar reminders ----------
function syncCalendar_(jobs, days) {
  const cal = CalendarApp.getCalendarsByName(CAL_NAME)[0] || CalendarApp.createCalendar(CAL_NAME, { color: CalendarApp.Color.CYAN });
  const calSh = sheet_(SpreadsheetApp.getActiveSpreadsheet(), "_cal", true);
  const known = {}; // eventKey -> {ev, key}
  if (calSh.getLastRow() > 1) calSh.getRange(2, 1, calSh.getLastRow() - 1, 3).getValues().forEach((r) => { if (r[0]) known[r[0]] = { ev: r[1], key: r[2] }; });
  const tz = Session.getScriptTimeZone();
  const dayMins = [];
  for (let d = 0; d <= Math.min(days, 4); d++) dayMins.push(d * 1440);

  // every reminder we want: deliveries (each unfinished phase + final) at 10:00, meetings at their time
  const wanted = {};
  jobs.forEach((j) => {
    if (j.deleted) return;
    const open = j.due && j.status !== "done" && j.status !== "cancel";
    const who = j.client ? " — " + j.client : "";
    const desc = (j.phone ? "رقم العميل: " + j.phone + "\n" : "") + (rem_(j) ? "المتبقي: " + rem_(j) + " " + (CUR[j.currency] || "") : "مدفوع بالكامل");
    if (open) {
      (j.phases || []).forEach((p) => { if (!p.done && p.due && p.due !== j.due) wanted[j.id + "|p|" + p.id] = { title: "تسليم مرحلة: " + (p.title || "") + " (" + (j.title || "") + ")" + who, date: p.due, time: REMIND_HOUR + ":00", mins: dayMins, desc: desc }; });
      wanted[j.id] = { title: "تسليم: " + (j.title || "") + who, date: j.due, time: REMIND_HOUR + ":00", mins: dayMins, desc: desc };
    }
    (j.meetings || []).forEach((m) => { if (m.date && !m.done) wanted[j.id + "|m|" + m.id] = { title: (m.title || "اجتماع") + who, date: m.date, time: m.time || "10:00", mins: [60, 15], desc: j.phone ? "رقم العميل: " + j.phone : "", dur: 60 }; });
  });

  Object.keys(known).forEach((k) => {
    const w = wanted[k], key = w ? [w.title, w.date, w.time, w.desc, w.mins.join(",")].join("|") : "";
    if (w && known[k].key === key) { delete wanted[k]; return; }
    try { const ev = cal.getEventById(known[k].ev); if (ev) ev.deleteEvent(); } catch (err) {}
    delete known[k];
  });
  Object.keys(wanted).forEach((k) => {
    const w = wanted[k];
    const start = Utilities.parseDate(w.date + " " + w.time, tz, "yyyy-MM-dd H:mm");
    const ev = cal.createEvent(w.title, start, new Date(start.getTime() + (w.dur || 30) * 60000), { description: w.desc });
    ev.removeAllReminders();
    w.mins.forEach((m) => ev.addPopupReminder(m));
    known[k] = { ev: ev.getId(), key: [w.title, w.date, w.time, w.desc, w.mins.join(",")].join("|") };
  });
  const ids = Object.keys(known);
  calSh.clearContents();
  calSh.getRange(1, 1, 1, 3).setValues([["id", "event", "key"]]);
  if (ids.length) calSh.getRange(2, 1, ids.length, 3).setValues(ids.map((id) => [id, known[id].ev, known[id].key]));
}

function writeExpenses_(ss, list, defCur) {
  list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  fill_(sheet_(ss, "المصاريف"), ["التاريخ", "الوصف", "المبلغ", "العملة", "متكرر شهرياً", "توقف من"],
    list.map((e) => [e.date || "", e.note || "", num_(e.amount), CUR[e.currency] || CUR[defCur] || "", e.recurring ? "نعم" : "", e.stopped || ""]));
}
