/* WhatsApp → notebook parser. Works offline, no AI.
   Reads pasted messages or an exported chat (.txt) in Egyptian Arabic / English
   and returns suggested actions: new job, payment, or update to an existing job. */
(function (root) {
  "use strict";

  const AR_DIGITS = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
                      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };
  const latin = (s) => String(s || "").replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d]).replace(/٫/g, ".").replace(/[‎‏‪-‮⁦-⁩]/g, "");
  const norm = (s) => latin(s).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ًٌٍَُِّْـ]/g, "").replace(/\s+/g, " ").trim();

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (s, k) => { const d = parseIso(s); d.setDate(d.getDate() + k); return iso(d); };

  // ---------- split into messages ----------
  // Android:  27/11/2026, 3:15 PM - Ahmed: text      |  27/11/2026، 3:15 م - أحمد: نص
  // iOS:      [27/11/2026, 3:15:10 PM] Ahmed: text   |  copied: [3:15 PM, 27/11/2026] Ahmed: text
  const HEAD_A = /^\[?(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?[,،]?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:[ap]\.?\s?m\.?|ص|م)?\]?\s*(?:[-–]\s*)?([^:]{1,60}?):\s?([\s\S]*)$/i;
  const HEAD_B = /^\[(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:[ap]\.?\s?m\.?|ص|م)?[,،]\s*(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\]\s*([^:]{1,60}?):\s?([\s\S]*)$/i;

  function mkDate(a, b, y, today) {
    // WhatsApp uses day/month in Egypt; accept month/day when day>12 is impossible otherwise
    let d = +a, m = +b;
    if (m > 12 && d <= 12) { const t = d; d = m; m = t; }
    let yr = y ? +y : today.getFullYear();
    if (yr < 100) yr += 2000;
    const dt = new Date(yr, m - 1, d);
    return isNaN(dt) || dt.getMonth() !== m - 1 ? "" : iso(dt);
  }

  function splitMessages(text, today) {
    const lines = latin(text).replace(/\r/g, "").split("\n");
    const out = [];
    let matched = 0;
    for (const line of lines) {
      let m = HEAD_A.exec(line.trim()), msg = null;
      if (m) msg = { date: mkDate(m[1], m[2], m[3], today), sender: m[6].trim(), body: m[7] };
      else if ((m = HEAD_B.exec(line.trim()))) msg = { date: mkDate(m[3], m[4], m[5], today), sender: m[6].trim(), body: m[7] };
      if (msg) { matched++; out.push(msg); }
      else if (out.length) out[out.length - 1].body += "\n" + line;
      else if (line.trim()) out.push({ date: "", sender: "", body: line });
    }
    if (!matched) return [{ date: "", sender: "", body: lines.join("\n") }];
    return out.filter((x) => x.body.trim() && !/^<?(media omitted|تم استبعاد الوسائط|الوسائط غير مضمنة|image omitted|sticker omitted)>?$/i.test(x.body.trim()));
  }

  // ---------- amounts ----------
  const WORD_NUM = [
    [/(?:الفين|ألفين)/g, 2000], [/(?:الف|ألف)\s*و\s*نص/g, 1500], [/(?:الف|ألف)\s*و\s*خمسمي[هةا]/g, 1500],
    [/خمسمي[هةا]/g, 500], [/(?:تلتمي[هةا]|ثلاثمائ[هة])/g, 300], [/(?:ربعمي[هةا]|اربعمي[هةا])/g, 400],
    [/(?:ستمي[هةا])/g, 600], [/(?:سبعمي[هةا])/g, 700], [/(?:تمنمي[هةا]|ثمانمائ[هة])/g, 800], [/(?:تسعمي[هةا])/g, 900],
    [/ميتين/g, 200], [/(?:^|[\sب])(?:الف|ألف)(?=$|[\s.,!؟?])/g, 1000],
  ];
  const COUNT_AFTER = /^\s*(?:يوم|ايام|أيام|اسبوع|أسبوع|اسابيع|ساعه|ساعة|ساعات|دقيق|بوست|بوستات|تصميم|تصاميم|ستوري|استوري|صفح|تعديل|تعديلات|نسخ|فيديو|ريل|شهر|شهور|لوجو|كارت|صوره|صورة|صور|%|x|×|سم|cm|px|بيكسل)/i;
  const CUR_AFTER = /^\s*(?:جنيه|جنية|ج\.?م|ج\b|جم|egp|le|l\.e|ريال|درهم|دولار|\$|usd|يورو|€)/i;
  const CUR_BEFORE = /(?:egp|le|\$|usd|€)\s*$/i;

  function extractAmounts(body) {
    let s = latin(body);
    const found = [];
    for (const [re, v] of WORD_NUM) s = s.replace(re, (m0) => { found.push({ v, cur: false, idx: -1 }); return " ".repeat(m0.length); });
    s = s.replace(/(\d),(\d{3})\b/g, "$1$2");
    // drop phones, times and dates
    s = s.replace(/(?:\+?20|0)1[0125]\d{8}/g, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ").replace(/\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/g, " ");
    const re = /(\d+(?:\.\d+)?)\s*(k|ك|الف|ألف|آلاف|الاف)?/gi;
    let m;
    while ((m = re.exec(s))) {
      let v = parseFloat(m[1]);
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 14);
      const before = s.slice(Math.max(0, m.index - 6), m.index);
      if (m[2]) v *= 1000;
      else if (COUNT_AFTER.test(after)) continue;
      if (v < 20 || v > 5e6) continue;
      found.push({ v, cur: CUR_AFTER.test(after) || CUR_BEFORE.test(before) || !!m[2], idx: m.index });
    }
    return found;
  }
  const bestAmount = (list) => { if (!list.length) return null; const c = list.filter((x) => x.cur); return (c.length ? c : list)[0].v; };

  // ---------- dates ----------
  const DAYS = [["الحد", 0], ["الاحد", 0], ["الاتنين", 1], ["الاثنين", 1], ["التلات", 2], ["الثلاثاء", 2], ["الثلاث", 2], ["الاربع", 3], ["الاربعاء", 3], ["الخميس", 4], ["الجمعه", 5], ["السبت", 6]];
  const MONTHS = ["يناير", "فبراير", "مارس", "ابريل", "مايو", "يونيو", "يوليو", "اغسطس", "سبتمبر", "اكتوبر", "نوفمبر", "ديسمبر"];
  const DUE_CTX = /(تسليم|اسلم|هسلم|تسلم|يتسلم|جاهز|تخلص|هتخلص|يخلص|اخلص|محتاج|محتاجه|عايز|عايزه|عاوز|عاوزه|قبل|اقصاه|أقصاه|deadline|deliver|معاد|ميعاد|موعد|بحلول|لحد)/;

  function extractDate(body, ref) {
    const t = norm(body);
    let m;
    if (/بعد\s*بكر[هة]/.test(t)) return addDays(ref, 2);
    if (/\bبكر[هة]\b|^بكر[هة]|\sبكر[هة]/.test(t)) return addDays(ref, 1);
    if (/النهارده|انهارده|النهاردة|today/.test(t) && DUE_CTX.test(t)) return ref;
    if ((m = /(?:بعد|خلال|في|ف)\s*(\d+)\s*(يوم|ايام|اسبوع|اسابيع|شهر)/.exec(t))) {
      const k = +m[1] * (/اسبوع|اسابيع/.test(m[2]) ? 7 : /شهر/.test(m[2]) ? 30 : 1);
      return addDays(ref, k);
    }
    if ((m = /(?:بعد|خلال|في|ف)\s*(يومين|اسبوعين|اسبوع|شهر|شهرين)/.exec(t))) {
      return addDays(ref, { "يومين": 2, "اسبوع": 7, "اسبوعين": 14, "شهر": 30, "شهرين": 60 }[m[1]]);
    }
    for (const [name, wd] of DAYS) {
      const re = new RegExp("(?:^|\\s|يوم\\s*)" + name + "(?:\\s|$|[.,!؟?])");
      if (re.test(t)) {
        const r = parseIso(ref); let diff = (wd - r.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        return addDays(ref, diff);
      }
    }
    if ((m = /(\d{1,2})\s*(يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر)/.exec(t))) {
      const r = parseIso(ref); let d = new Date(r.getFullYear(), MONTHS.indexOf(m[2]), +m[1]);
      if (d < r) d = new Date(r.getFullYear() + 1, MONTHS.indexOf(m[2]), +m[1]);
      return iso(d);
    }
    if ((m = /(?:^|\s|يوم\s*)(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?(?:\s|$)/.exec(t)) && DUE_CTX.test(t)) {
      const r = parseIso(ref); const s = mkDate(m[1], m[2], m[3], r);
      if (s) return s < ref && !m[3] ? s.replace(/^\d{4}/, String(r.getFullYear() + 1)) : s;
    }
    return "";
  }

  // ---------- intent ----------
  const TYPES = [
    ["لوجو", /(لوجو|لوغو|شعار|logo)/],
    ["هوية بصرية", /(هويه|براند|branding|brand identity|ايدنتتي|identity)/],
    ["سوشيال ميديا", /(سوشيال|بوست|بوستات|ستوري|استوري|social|post|كفر|كوفر|cover|انستجرام|انستاجرام|instagram|فيسبوك|فيس بوك|تيك توك)/],
    ["مطبوعات", /(منيو|فلاير|فلاير|بروشور|كارت|كروت|بانر|يافط|رول اب|رولاب|مطبوع|بيزنس كارد|flyer|menu|brochure|card|banner)/],
    ["تغليف", /(تغليف|باكدج|باكيدج|علبه|ليبل|استيكر|packaging|label)/],
    ["UI / UX", /(ui|ux|موقع|ويب|تطبيق|ابلكيشن|اب\b|app|landing|لاندينج)/],
    ["موشن", /(موشن|انيميشن|motion|animation|فيديو|ريلز|ريل)/],
    ["إليستريشن", /(اليستريشن|illustration|رسم|رسمه|كاريكاتير)/],
  ];
  const PAY_RE = /(حولت|حولتلك|حولتلكم|حولتهم|اتحول|تحويل|بعتلك|بعتتلك|بعت|دفعت|دافع|اتدفع|ادفع|انستا|instapay|انستاباي|فودافون|كاش|vodafone|cash|اورنج|اتصالات|محفظه|استلمت|وصلني|وصلك|وصل|اتبعت|ايصال|transfer|paid|عربون|مقدم|دفعه|الباقي)/;
  const NOT_PAY = /(هحول|هبعت|هدفع|حادفع|هبعتلك|هحولك|هحولك|ممكن احول|احولك امتي|ابعتلك امتي|هحولها|سوف)/;
  const DEP_RE = /(عربون|مقدم|نص المبلغ|نص الفلوس|جزء من|اول دفعه|اول قسط|deposit)/;
  const PRICE_RE = /(سعر|السعر|بكام|هيكلف|التكلفه|تكلفه|حساب|الحساب|اجمالي|الاجمالي|متفقين|اتفقنا|متفق|اوكي ب|تمام ب|هيبقي ب|يبقي ب|الكل ب|total|price|cost|مقابل|\bب\s*\d)/;
  const AGREE_RE = /(نبغي|ابغي|بغيت|اتفقنا|متفقين|تمام|اوكي|اوك|ok|ماشي|موافق|نبدا|هنبدا|ابدا|ابتدي|يلا|عايز|عاوز|محتاج|ممكن تعمل|ممكن تصمم|تصميم|اعمل|نعمل|هتعمل)/;
  const DONE_RE = /(استلمت الملفات|وصلتني الملفات|الملفات وصلت|كده تمام جدا|تمام كده|اعتمدت|معتمد|approved|فاينال|final|ميرسي جدا|تسلم ايدك|تسلم ايديك|حلو جدا كده)/;
  const REV_RE = /(تعديل|عدل|عدلي|غير|غيري|غيرلي|change|كبر|صغر|بدل|شيل|زود)/;
  const METHOD = [[/(انستا|instapay)/, "انستاباي"], [/(فودافون|vodafone)/, "فودافون كاش"], [/(اورنج|orange)/, "أورنج كاش"], [/(اتصالات|etisalat)/, "اتصالات كاش"], [/(بنك|bank|تحويل بنكي)/, "تحويل بنكي"], [/(كاش|cash|ايدي|ايد)/, "كاش"]];
  const methodOf = (t) => { for (const [re, n] of METHOD) if (re.test(t)) return n; return ""; };

  const CURS = [[/(دولار|\$|usd|dollar)/, "USD"], [/(ريال|sar|سعودي)/, "SAR"], [/(درهم|aed)/, "AED"], [/(يورو|€|eur)/, "EUR"], [/(دينار|kwd)/, "KWD"], [/(جنيه|جنية|ج\.?م|egp|\ble\b)/, "EGP"]];
  const currencyOf = (t) => { for (const [re, c] of CURS) if (re.test(t)) return c; return ""; };

  function findPhone(text) {
    const m = /(?:\+?\s?20\s?|0)(1[0125])[\s-]?(\d{4})[\s-]?(\d{4})/.exec(latin(text).replace(/ /g, " "));
    return m ? "0" + m[1] + m[2] + m[3] : "";
  }

  /**
   * @param {string} raw            pasted text or exported chat
   * @param {object} ctx            {today:"YYYY-MM-DD", myName, clients:[{name,phone}], jobs:[{id,client,phone,title,type,price,remaining,status,due,open}]}
   * @returns {{summary:string, actions:object[], client:string}}
   */
  function parse(raw, ctx) {
    const today = ctx.today;
    const todayD = parseIso(today);
    const msgs = splitMessages(raw, todayD);
    const me = norm(ctx.myName || "");
    const isMe = (s) => { const n = norm(s); return !n ? false : (me && (n === me || n.includes(me) || me.includes(n))) || /^(you|انت|انتي|me|انا)$/.test(n); };

    // client = the non-me sender with most messages
    const counts = {};
    for (const m of msgs) if (m.sender && !isMe(m.sender)) counts[m.sender] = (counts[m.sender] || 0) + 1;
    let client = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
    if (/^[+\d\s\-()]{8,}$/.test(client)) client = "";   // unsaved contact shows a phone number
    const allText = msgs.map((m) => m.body).join("\n");
    let phone = findPhone(allText) || findPhone(Object.keys(counts).join(" "));
    if (!client) {
      const m = /(?:اسمي|معاك|انا)\s+([^\s,.!؟?\d]{2,20}(?:\s[^\s,.!؟?\d]{2,20})?)/.exec(allText);
      if (m && !/(عايز|عاوز|محتاج|كنت|هبعت|حولت)/.test(m[1])) client = m[1].trim();
    }

    // match a known client
    const known = (ctx.clients || []).find((c) =>
      (phone && c.phone && c.phone.replace(/\D/g, "").slice(-10) === phone.slice(-10)) ||
      (client && norm(c.name) && (norm(c.name) === norm(client) || norm(c.name).includes(norm(client)) || norm(client).includes(norm(c.name)))));
    if (known) { client = known.name; if (!phone) phone = known.phone || ""; }

    // facts per message
    const types = []; let type = "", price = null, due = "", revisions = null, done = false, revNote = "";
    const payments = [];
    const brief = [];
    let agree = false;
    const currency = currencyOf(norm(allText)) || ctx.currency || "EGP";
    let strongDue = false;
    for (const m of msgs) {
      const t = norm(m.body);
      const ref = m.date || today;
      const fromMe = isMe(m.sender);
      for (const [name, re] of TYPES) if (re.test(t) && !types.includes(name)) types.push(name);
      type = types.join(" + ");
      if (AGREE_RE.test(t)) agree = true;
      let msgPay = false;
      const clauses = latin(m.body).replace(/(\d),(\d{3})\b/g, "$1$2").split(/[،,.؛;\n!]+|\s+و(?=(?:حولت|دفعت|بعت|هحول|هبعت|التسليم|محتاج|عايز|عاوز|ممكن))/);
      for (const cl of clauses) {
        const ct = norm(cl);
        if (!ct) continue;
        const amts = extractAmounts(cl);
        const isPay = PAY_RE.test(ct) && !NOT_PAY.test(ct) && amts.length && !(/\?|؟/.test(cl) && !/(حولت|دفعت|بعتلك)/.test(ct));
        if (isPay && !(fromMe && !/(استلمت|وصلني|وصل)/.test(ct))) {
          msgPay = true;
          payments.push({ amount: bestAmount(amts), date: ref, method: methodOf(t), deposit: DEP_RE.test(ct), text: cl.trim() });
        } else if (amts.length && !NOT_PAY.test(ct) && (PRICE_RE.test(ct) || (price === null && (type || AGREE_RE.test(ct))))) {
          price = Math.max(...amts.map((a) => a.v));
        }
        if (NOT_PAY.test(ct) || (PAY_RE.test(ct) && !DUE_CTX.test(ct))) continue;
        const d = extractDate(cl, ref);
        if (!d) continue;
        if (DUE_CTX.test(ct)) { due = d; strongDue = true; }
        else if (!strongDue && /(بكر|بعد|الجاي|يوم|خلال)/.test(ct)) due = d;
      }
      const isPay = msgPay;
      const r = /(\d+)\s*(?:تعديل|تعديلات|revision)/.exec(latin(t)); if (r) revisions = +r[1];
      if (!fromMe && DONE_RE.test(t)) done = true;
      if (!fromMe && REV_RE.test(t) && !DONE_RE.test(t) && /(تعديل|عدل|غير|change)/.test(t) && !msgPay && !extractAmounts(m.body).length) revNote = m.body.trim().slice(0, 300);
      if (!fromMe && m.body.trim().length > 12 && brief.length < 4 && !isPay) brief.push(m.body.trim().replace(/\s+/g, " ").slice(0, 160));
    }

    // existing job for this client
    const open = (ctx.jobs || []).filter((j) => j.open && client && norm(j.client) === norm(client));
    const sameType = open.filter((j) => !types.length || types.some((t) => (j.types || [j.type]).includes(t)));
    const existing = sameType.length === 1 ? sameType[0] : open.length === 1 && !type ? open[0] : null;
    const actions = [];

    if (!existing && (type || price !== null)) {
      let deposit = null;
      const pays = payments.slice();
      const depIdx = pays.findIndex((p) => p.deposit);
      const take = depIdx >= 0 ? depIdx : pays.length && (price === null || pays[0].amount < price) ? 0 : -1;
      if (take >= 0) { deposit = pays[take].amount; pays.splice(take, 1); }
      actions.push({
        kind: "new_job", client: client || "", phone, title: type ? (type + (client ? " - " + client : "")) : "مشروع جديد",
        type: type || "أخرى", types: types.length ? types : ["أخرى"], price, currency, deposit, start: msgs.find((m) => m.date)?.date || today, due, finish: due ? addDays(due, -1) : "",
        duration: "", revisions, notes: brief.join("\n"), reason: price === null ? "السعر غير محدد في الرسائل" : "",
      });
      for (const p of pays) actions.push({ kind: "payment", jobId: "", client, amount: p.amount, date: p.date, note: p.method, reason: p.text.slice(0, 120) });
    } else {
      const target = existing || (open.find((j) => j.remaining > 0) && open.filter((j) => j.remaining > 0).length === 1 ? open.find((j) => j.remaining > 0) : null);
      for (const p of payments) actions.push({ kind: "payment", jobId: target ? target.id : "", client, amount: p.amount, date: p.date, note: p.method, reason: p.text.slice(0, 120) });
      if (target) {
        const ch = {};
        if (due && due !== target.due) ch.due = due;
        if (price !== null && price !== target.price && !payments.length) ch.price = price;
        if (done) ch.status = "done";
        else if (revNote) { ch.status = "review"; ch.notesAppend = "طلب تعديل: " + revNote; }
        if (phone && !target.phone) ch.phone = phone;
        if (Object.keys(ch).length) actions.push({ kind: "update_job", jobId: target.id, changes: ch, reason: "" });
      }
    }

    // summary
    const parts = [];
    const nj = actions.find((a) => a.kind === "new_job");
    if (nj) parts.push("مشروع جديد" + (nj.client ? " لـ " + nj.client : "") + (nj.price !== null ? " بـ " + nj.price.toLocaleString("en-US") + " " + currency : ""));
    const np = actions.filter((a) => a.kind === "payment").length + (nj && nj.deposit ? 1 : 0);
    if (np) parts.push(np === 1 ? "دفعة واحدة" : np + " دفعات");
    if (actions.some((a) => a.kind === "update_job")) parts.push("تحديث على مشروع قائم");
    const summary = parts.length ? "تم العثور على: " + parts.join("، ") + "." : "لم يتم العثور على اتفاق أو مدفوعات أو مواعيد في هذه الرسائل.";
    return { summary, actions, client, currency };
  }

  const api = { parse, splitMessages, extractAmounts, extractDate, findPhone, latin, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WAParser = api;
})(typeof self !== "undefined" ? self : this);
