"use strict";
// Спільний модуль для всіх сторінок: каталог ефектів, текстовий формат силових тренувань,
// сховище запланованих тренувань (planned.json у гілці `journal`) і злиття з календарем intervals.icu.
window.WK = (() => {
  const REPO = "nazarus15/training-dashboard", BRANCH = "journal", FILE = "planned.json";
  const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;
  const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  const LS_TOKEN = "td_gh_token", LS_CACHE = "td_planned_cache";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const monday = s => { const d = new Date(s + "T12:00:00"); return addDays(s, -((d.getDay() + 6) % 7)); };
  const fmtMin = m => { if (!m) return ""; m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, "0")}` : `${m} хв`; };

  // ---------- ефекти: незмінні назви ----------
  // Порядок у списку — порядок смужок на сайті. Опис — одна фраза для легенди.
  const EFFECTS = [
    { id: "recovery", name: "Відновлення", sport: "bike", color: "#8a96a3", d: "Дуже легко, Z1. Розганяє кров після важкого дня, втоми майже не додає." },
    { id: "base", name: "Аеробна база", sport: "bike", color: "#3c8dd0", d: "Z2. Мітохондрії й капіляри: довше їдеш на жирах, пульс менше «відпливає». Фундамент." },
    { id: "tempo", name: "Темп", sport: "bike", color: "#2ea36b", d: "Z3, 76–87% FTP. Витривалість на швидкому рівному темпі." },
    { id: "ss", name: "Sweet spot", sport: "bike", color: "#c9a10b", d: "88–93% FTP. Піднімає FTP майже як поріг, а втомлює помітно менше." },
    { id: "thr", name: "Поріг", sport: "bike", color: "#e0761b", d: "Z4, 95–105% FTP. Зсуває FTP, вчить тримати гоночний темп 20–60 хв." },
    { id: "vo2", name: "VO2max", sport: "bike", color: "#c4372f", d: "Z5, 106–120% FTP. Стеля аеробної потужності: підйоми й атаки на 3–8 хв." },
    { id: "ana", name: "Анаеробна", sport: "bike", color: "#7a4cc2", d: "Z6+, понад 120% FTP. Ривки і спринти до хвилини." },
    { id: "str", name: "Сила", sport: "strength", color: "#c4372f", d: "До 6 повторів із запасом 1–3. Максимальна сила, нервово-м'язова координація." },
    { id: "hyp", name: "Гіпертрофія", sport: "strength", color: "#1f5fd1", d: "7–12 повторів. Об'єм м'язів, міцність сухожиль." },
    { id: "send", name: "Силова витривалість", sport: "strength", color: "#2ea36b", d: "13+ повторів або робота на час. Тримати зусилля довго, як у партері БЖЖ." },
    { id: "pow", name: "Потужність", sport: "strength", color: "#e0761b", d: "Вибухові рухи: махи, стрибки, поштовхи. Швидкість прикладання сили." },
    { id: "core", name: "Кор і стабільність", sport: "strength", color: "#7a4cc2", d: "Планки, турецький підйом, перенесення ваги. Жорсткий корпус, здорова спина й плечі." },
  ];
  const FX = Object.fromEntries(EFFECTS.map(e => [e.id, e]));

  // Шкала 0–100: 100 = повна доза стимулу за одну сесію.
  function rideEffects(ev) {
    const z = ev?.zones; if (!z) return null;
    const m = k => (z[k] || 0) / 60;
    const s = {
      base: (m("Z1") * .5 + m("Z2")) / 90, tempo: Math.max(0, m("Z3") - m("SS")) / 40, ss: m("SS") / 40,
      thr: m("Z4") / 30, vo2: m("Z5") / 20, ana: (m("Z6") + m("Z7")) / 5,
    };
    const sc = norm(s);
    const hard = m("Z3") + m("Z4") + m("Z5") + m("Z6") + m("Z7") + m("SS");
    let main = top(sc);
    if (hard < 3 && (ev.if || 0) < 62 && (ev.mins || 0) <= 60) main = "recovery";
    return { scores: sc, main };
  }

  const TAGS = [[/^сил/i, "str"], [/^гіпер/i, "hyp"], [/^витрив/i, "send"], [/^(потуж|вибух)/i, "pow"], [/^(кор|стабіл)/i, "core"]];
  const RX_CORE = /планк|турецьк|прес|dead ?bug|паллоф|pallof|фермер|carry|скручув|hollow|підйом.{0,4}ніг|колін.{0,5}до/i;
  const RX_POW = /стриб|мах|swing|ривок|поштовх|вибух|jump|плиометр|кидок/i;
  function exEffect(ex) {
    for (const t of ex.tags || []) for (const [rx, id] of TAGS) if (rx.test(t)) return id;
    if (RX_CORE.test(ex.name)) return "core";
    if (RX_POW.test(ex.name)) return "pow";
    if (ex.type === "time" || /max|макс/i.test(ex.reps)) return "send";
    const r = topReps(ex.reps);
    return r <= 6 ? "str" : r <= 12 ? "hyp" : "send";
  }
  const STR_DOSE = { str: 10, hyp: 12, send: 10, pow: 8, core: 8 };
  function strengthEffects(sess) {
    if (!sess?.exercises?.length) return null;
    const s = {};
    for (const ex of sess.exercises) { const id = exEffect(ex); s[id] = (s[id] || 0) + (+ex.sets || 1) / STR_DOSE[id]; }
    const sc = norm(s);
    return { scores: sc, main: top(sc) };
  }
  function norm(s) { const o = {}; for (const [k, v] of Object.entries(s)) { const n = Math.min(100, Math.round(v * 100)); if (n >= 5) o[k] = n; } return o; }
  function top(sc) { let best = null; for (const e of EFFECTS) if (sc[e.id] != null && (best == null || sc[e.id] > sc[best])) best = e.id; return best; }

  function barsHtml(fx) {
    if (!fx || !Object.keys(fx.scores).length) return "";
    return `<div class="fxbars">${EFFECTS.filter(e => fx.scores[e.id] != null).map(e => `<div class="fxrow"><span>${e.name}</span><span class="fxbar"><i style="width:${fx.scores[e.id]}%;background:${e.color}"></i></span><b>${fx.scores[e.id]}</b></div>`).join("")}</div>`;
  }
  function legendHtml() {
    const grp = (sp, t) => `<div class="fxleg-g"><div class="eyebrow">${t}</div><dl>${EFFECTS.filter(e => e.sport === sp).map(e => `<div><dt><i style="background:${e.color}"></i>${e.name}</dt><dd>${e.d}</dd></div>`).join("")}</dl></div>`;
    return `<details class="fxleg"><summary>Що означають ефекти</summary>${grp("bike", "Вело")}${grp("strength", "Силові")}<p class="fxleg-n">Шкала 0–100: скільки від повного стимулу цього типу дає тренування. Сайт рахує сам: вело — за хвилинами в зонах потужності з плану intervals.icu, силові — за кількістю робочих підходів і діапазоном повторів. Ефекти нижче 5 не показуються.</p></details>`;
  }

  // ---------- текстовий формат силового ----------
  function topReps(r) { const m = String(r).match(/(\d+)\s*[–-]\s*(\d+)/); return m ? +m[2] : parseInt(r, 10) || 0; }
  const slug = s => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-zа-яіїєґ0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ex";
  const RX_SR = /(?:^|\s)(\d+)\s*[xх×]\s*(\d+(?:\s*[-–]\s*\d+)?|max|макс)\s*(с|сек|s|хв|m|min)?\s*(\/\s*(?:бік|сторону|side|ногу|руку))?(?=\s|$|,)/i;
  const RX_REST = /(?:відп(?:очинок)?|rest)\s*:?\s*(\d+(?:[:.]\d{2})?)\s*(с|сек|s|хв|m|min)?/i;
  const RX_RIR = /(?:RIR|запас)\s*:?\s*(\d+(?:\s*[-–]\s*\d+)?)/i;
  const RX_LOAD = /@\s*(.+?)(?=\s+(?:відп|rest|RIR|запас)|\s+#|$)/i;
  const RX_TIME = /(\d+(?:\s*[-–]\s*\d+)?)\s*(хв|min|m|с|сек|s)(?![a-zа-яіїєґ])/i;
  const secs = (n, u) => { if (/:|\./.test(n)) { const [a, b] = n.split(/[:.]/); return +a * 60 + +b; } const v = +n; if (!u) return v <= 5 ? v * 60 : v; return /^(хв|m|min)/i.test(u) ? v * 60 : v; };
  const prettyNum = s => s.replace(/(\d)\s*[xх×]\s*(\d)/gi, "$1×$2").replace(/(\d)\s*-\s*(\d)/g, "$1–$2");

  function parseItem(line) {
    let [main, ...com] = line.split("//");
    main = main.trim();
    const m = main.match(RX_SR);
    if (!m) return null;
    const name = main.slice(0, m.index).replace(/[,—–-]\s*$/, "").trim();
    const after = main.slice(m.index + m[0].length);
    const unit = m[3] || "";
    const isTime = !!unit;
    let reps = m[2].replace(/\s+/g, "").replace("-", "–");
    if (isTime && /^(хв|m|min)/i.test(unit)) reps = String(Math.round(+reps.split("–")[0] * 60));
    const ex = { name, sets: +m[1], reps: /max|макс/i.test(reps) ? "макс" : reps, perSide: !!m[4] };
    const rest = after.match(RX_REST); if (rest) ex.rest = secs(rest[1], rest[2]);
    const rir = after.match(RX_RIR); if (rir) ex.rir = rir[1].replace(/\s+/g, "").replace("-", "–");
    const load = after.match(RX_LOAD); if (load) ex.load = load[1].trim();
    ex.tags = [...after.matchAll(/#([^\s#]+)/g)].map(x => x[1]);
    const L = (ex.load || "").toLowerCase();
    ex.type = isTime ? "time" : /гир|kb/.test(L) || /гир/i.test(name) ? "kb" : /тіл|bw|власн|^\+/.test(L) ? "bw" : /кг|kg|штанг|гантел|\d/.test(L) ? "weight"
      : /підтяг|віджим|бруси|dips|pull.?up|push.?up/i.test(name) ? "bw" : /гир/i.test(name) ? "kb" : "weight";
    if (ex.load && /^(штанга|гиря|гирі|вага тіла|тіло|bw|гантелі)$/i.test(ex.load)) delete ex.load;
    for (const c of com.map(x => x.trim()).filter(Boolean)) { if (/^перший раз/i.test(c)) ex.firstTime = c; else ex.cue = ex.cue ? ex.cue + " " + c : c; }
    return ex;
  }

  function parse(text) {
    const out = { title: "", goal: "", warmup: [], warmupTime: "", cooldown: [], exercises: [], notes: [], warnings: [] };
    let sec = null, groupN = 0, wMins = 0;
    const used = {};
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      if (/^#\s/.test(line)) { out.title = line.replace(/^#\s+/, ""); continue; }
      const goal = line.match(/^(мета|ціль|goal)\s*:\s*(.+)/i); if (goal) { out.goal = goal[2]; continue; }
      const dur = line.match(/^(тривалість|час)\s*:\s*(.+)/i); if (dur) { const t = dur[2].match(/(\d+)\s*(хв|год|h|m)?/i); if (t) out.minsSet = /год|h/i.test(t[2] || "") ? +t[1] * 60 : +t[1]; continue; }
      if (/^[-•*]\s*/.test(line)) {
        const body = line.replace(/^[-•*]\s*/, "");
        if (!sec) sec = { kind: "work", title: "", group: String.fromCharCode(65 + groupN++) };
        if (sec.kind !== "work") {
          sec.items.push(prettyNum(body.replace(/\s*\/\/\s*/g, " — ")));
          const t = body.match(RX_TIME); if (t && !sec.timeFromHeader) wMins += secs(t[1].split(/[-–]/).pop(), t[2]) / 60;
          continue;
        }
        let ex = parseItem(body);
        if (!ex && sec.rounds) { const r = body.match(/^(.*?)\s+(\d+(?:\s*[-–]\s*\d+)?|max|макс)\s*(с|сек|s|хв|m)?(\/\s*бік)?(?=\s|$)(.*)$/i); if (r) ex = parseItem(`${r[1]} ${sec.rounds}x${r[2]}${r[3] || ""}${r[4] || ""}${r[5] || ""}`); }
        if (!ex) { out.notes.push(body); out.warnings.push(`Не схоже на вправу (немає «підходи×повтори»): ${body}`); continue; }
        if (sec.rounds && !RX_SR.test(body)) ex.sets = sec.rounds;
        if (sec.rest && ex.rest == null) ex.rest = sec.rest;
        ex.group = sec.group; ex.block = sec.title;
        let key = slug(ex.name); if (used[key]) key += "-" + (++used[key]); else used[key] = 1; ex.key = key;
        out.exercises.push(ex);
        continue;
      }
      // заголовок секції
      const rest = line.match(RX_REST);
      if (rest && sec && /^(відп|rest)/i.test(line)) { sec.rest = secs(rest[1], rest[2]); out.exercises.filter(e => e.group === sec.group && e.rest == null).forEach(e => e.rest = sec.rest); continue; }
      const rounds = line.match(/(?:^|\s)(\d+)\s*[xх×](?=\s|$)/);
      let title = line.replace(/(?:^|\s)(\d+)\s*[xх×](?=\s|$)/, "").replace(/:$/, "").trim();
      if (/^(розминка|warm\s*-?up)/i.test(title)) {
        sec = { kind: "warm", items: out.warmup };
        const t = title.replace(/^(розминка|warm\s*-?up)\s*[·:—-]?\s*/i, "");
        if (t) { out.warmupTime = prettyNum(t); sec.timeFromHeader = true; }
        continue;
      }
      if (/^(заминка|cool\s*-?down)/i.test(title)) { sec = { kind: "cool", items: out.cooldown, timeFromHeader: true }; continue; }
      const letter = String.fromCharCode(65 + groupN);
      groupN++;
      sec = { kind: "work", title: /^[A-ZА-Я]\d?$/i.test(title) ? "" : title, group: letter, rounds: rounds ? +rounds[1] : 0, rest: rest ? secs(rest[1], rest[2]) : null };
      if (rest) sec.title = sec.title.replace(RX_REST, "").replace(/[·,—-]\s*$/, "").trim();
    }
    // мітки A1, A2 …
    const cnt = {};
    for (const ex of out.exercises) { cnt[ex.group] = (cnt[ex.group] || 0) + 1; ex.label = ex.group + cnt[ex.group]; if (ex.rest == null) ex.rest = ex.type === "time" ? 60 : 90; }
    // тривалість
    let s = 0;
    const wt = out.warmupTime.match(/(\d+)(?:\s*[–-]\s*(\d+))?/);
    s += (wt ? +(wt[2] || wt[1]) : out.warmup.length ? Math.max(wMins, 8) : 0) * 60;
    for (const ex of out.exercises) {
      const work = (ex.type === "time" ? +String(ex.reps).split("–").pop() || 30 : (topReps(ex.reps) || 10) * 4) * (ex.perSide ? 2 : 1);
      s += ex.sets * (work + ex.rest) + 45;
    }
    if (out.cooldown.length) s += 5 * 60;
    out.mins = out.minsSet || Math.max(5, Math.round(s / 60 / 5) * 5);
    return out;
  }

  // ---------- сховище planned.json ----------
  const token = () => lsGet(LS_TOKEN, null);
  const b64enc = str => { const b = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));
  async function apiGet() {
    const r = await fetch(`${API}?ref=${BRANCH}&t=${Date.now()}`, { headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (r.status === 404) return { sha: null, data: { workouts: [], recurring: [] } };
    if (!r.ok) throw await httpErr(r);
    const j = await r.json();
    return { sha: j.sha, data: JSON.parse(b64dec(j.content || "") || "{}") };
  }
  async function loadPlanned() {
    let d = null;
    if (token()) { try { d = (await apiGet()).data; } catch { } }
    if (!d) { try { const r = await fetch(`${RAW}?t=${Date.now()}`, { cache: "no-store" }); if (r.ok) d = await r.json(); } catch { } }
    if (d) lsSet(LS_CACHE, d); else d = lsGet(LS_CACHE, { workouts: [], recurring: [] });
    d.workouts ||= []; d.recurring ||= [];
    return d;
  }
  async function savePlanned(mutate, message) {
    if (!token()) { const e = new Error("no token"); e.status = 0; throw e; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await apiGet();
      const data = { workouts: [], recurring: [], ...cur.data };
      mutate(data);
      data.workouts.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      data.updatedAt = new Date().toISOString();
      const r = await fetch(API, { method: "PUT", headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: b64enc(JSON.stringify(data, null, 1)), branch: BRANCH, ...(cur.sha ? { sha: cur.sha } : {}) }) });
      if (r.ok) { lsSet(LS_CACHE, data); return data; }
      if (r.status !== 409 && r.status !== 422) throw await httpErr(r);
    }
    throw new Error("conflict");
  }

  async function httpErr(r) { let m = ""; try { m = (await r.json()).message || ""; } catch { } const e = new Error(m || "http " + r.status); e.status = r.status; e.gh = m; return e; }
  // Пояснення помилки GitHub людською мовою
  function ghErrText(e) {
    if (e.status === 0) return "Немає токена GitHub — підключи його в Налаштуваннях.";
    if (e.status === 401) return "GitHub не приймає токен: він невірний або протермінований. Створи новий у Налаштуваннях.";
    if (e.status === 403 || e.status === 404) return "Токен лише читає репозиторій. На GitHub: Settings → Developer settings → Fine-grained tokens → твій токен → Edit → Repository permissions → Contents: Read and write → Update." + (e.gh ? ` (GitHub: ${e.gh})` : "");
    return "Не вдалося зберегти: немає зв'язку з GitHub" + (e.status ? ` (код ${e.status})` : "") + ".";
  }
  // Перевірка права запису без змін у репозиторії: видалення неіснуючого файлу.
  // З правом запису GitHub відповідає 404/409/422 (файлу нема), без нього — 403.
  async function checkWrite(tok = token()) {
    if (!tok) return "none";
    const h = { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
    try {
      const g = await fetch(`https://api.github.com/repos/${REPO}`, { headers: h });
      if (g.status === 401) return "invalid";
      if (!g.ok) return "noaccess";
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/.write-check`, { method: "DELETE", headers: h, body: JSON.stringify({ message: "check", sha: "0000000000000000000000000000000000000000", branch: BRANCH }) });
      return r.status === 403 ? "readonly" : r.status === 401 ? "invalid" : "ok";
    } catch { return "offline"; }
  }

  // ---------- довільний файл у репозиторії (налаштування, keyring) ----------
  async function ghGet(path, branch) {
    if (token()) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${branch}&t=${Date.now()}`, { headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (r.status === 404) return { sha: null, data: null };
      if (!r.ok) throw await httpErr(r);
      const j = await r.json(); return { sha: j.sha, data: JSON.parse(b64dec(j.content || "") || "null") };
    }
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${branch}/${path}?t=${Date.now()}`, { cache: "no-store" });
    return { sha: null, data: r.ok ? await r.json() : null };
  }
  async function ghPut(path, branch, mutate, message) {
    if (!token()) { const e = new Error("no token"); e.status = 0; throw e; }
    for (let i = 0; i < 3; i++) {
      const cur = await ghGet(path, branch);
      const data = await mutate(cur.data);
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { method: "PUT", headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: b64enc(JSON.stringify(data, null, 1)), branch, ...(cur.sha ? { sha: cur.sha } : {}) }) });
      if (r.ok) return data;
      if (r.status !== 409 && r.status !== 422) throw await httpErr(r);
    }
    throw new Error("conflict");
  }
  async function loadSettings() {
    let s = null;
    try { s = (await ghGet("settings.json", BRANCH)).data; } catch { }
    if (s) lsSet("td_settings_cache", s); else s = lsGet("td_settings_cache", {}) || {};
    let priv = {};
    try { priv = (s.private && window.AUTH ? await AUTH.decrypt(s.private) : {}) || {}; } catch { }
    return { ftpFloor: s.ftpFloor || 231, ...priv };
  }

  // ---------- календар: план + intervals ----------
  const SPORT = { bike: ["Вело", "#3c8dd0"], strength: ["Силове", "#e0761b"], bjj: ["БЖЖ", "#7a4cc2"], run: ["Біг", "#2ea36b"], other: ["Інше", "#8a96a3"] };
  const evSport = t => /ride|cycl/i.test(t || "") ? "bike" : /run/i.test(t || "") ? "run" : "other";
  function session(w) { const p = parse(w.text); return { ...p, id: w.id, date: w.date, title: w.title || p.title || "Силове", mins: w.mins || p.mins }; }
  function items(planned, events, from, to) {
    const out = [];
    for (const e of events?.events || []) {
      if (e.category !== "WORKOUT" || e.date < from || e.date > to) continue;
      const sport = evSport(e.type);
      out.push({ date: e.date, sport, title: e.name, mins: e.mins, load: e.load, fx: sport === "bike" ? rideEffects(e) : null, src: "intervals", ev: e });
    }
    for (const w of planned?.workouts || []) {
      if (w.date < from || w.date > to) continue;
      if (w.sport === "strength") { const s = session(w); out.push({ date: w.date, sport: "strength", title: s.title, mins: s.mins, fx: strengthEffects(s), src: "planner", id: w.id, sess: s, time: w.time }); }
      else out.push({ date: w.date, sport: w.sport || "other", title: w.title || SPORT[w.sport]?.[0] || "Тренування", mins: w.mins, note: w.text, src: "planner", id: w.id, time: w.time });
    }
    for (const r of planned?.recurring || []) {
      for (let d = r.from > from ? r.from : from; d <= to && (!r.until || d <= r.until); d = addDays(d, 1)) {
        const dow = (new Date(d + "T12:00:00").getDay() + 6) % 7 + 1; // 1 = пн
        if (!r.days.includes(dow) || (r.skip || []).includes(d) || out.some(x => x.date === d && x.sport === r.sport)) continue;
        out.push({ date: d, sport: r.sport, title: r.title || SPORT[r.sport]?.[0], mins: r.mins, time: r.time, src: "recurring" });
      }
    }
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "") < (b.time || "") ? -1 : 1);
  }
  const subtype = it => it.fx?.main ? FX[it.fx.main].name : "";

  // перегляд силового тільки для читання (планер, огляд)
  function previewHtml(s) {
    const fx = strengthEffects(s);
    const groups = {}; for (const ex of s.exercises) (groups[ex.group] ??= []).push(ex);
    const exLine = ex => `<li><span class="wk-l">${esc(ex.label)}</span><span class="wk-n">${esc(ex.name)}${ex.cue ? `<small>${esc(ex.cue)}</small>` : ""}</span><span class="wk-t">${ex.sets}×${esc(ex.reps)}${ex.type === "time" ? " с" : ""}${ex.perSide ? "/бік" : ""}${ex.load ? `<small>${esc(ex.load)}</small>` : ""}${ex.rir ? `<small>запас ${esc(ex.rir)}</small>` : ""}<small>відп ${ex.rest >= 60 && ex.rest % 30 === 0 ? (ex.rest / 60).toString().replace(".", ",") + " хв" : ex.rest + " с"}</small></span></li>`;
    return `<div class="wk">
      <div class="wk-head"><span class="pillx">${fmtMin(s.mins)}</span>${fx?.main ? `<span class="pillx" style="--c:${FX[fx.main].color}">${FX[fx.main].name}</span>` : ""}<span class="pillx">${s.exercises.length} вправ · ${s.exercises.reduce((a, e) => a + e.sets, 0)} підходів</span></div>
      ${s.goal ? `<p class="wk-goal">${esc(s.goal)}</p>` : ""}
      ${barsHtml(fx)}
      ${s.warmup.length ? `<div class="wk-b wk-warm"><div class="eyebrow">Розминка${s.warmupTime ? " · " + esc(s.warmupTime) : ""}</div><ul>${s.warmup.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
      ${Object.entries(groups).map(([g, exs]) => `<div class="wk-b" style="--g:var(--g${"ABCD".includes(g) ? g : "A"})"><div class="eyebrow">${esc(exs[0].block || (exs.length > 1 ? "Суперсет " + g : "Блок " + g))}</div><ol>${exs.map(exLine).join("")}</ol></div>`).join("")}
      ${s.notes.length ? `<div class="wk-b"><div class="eyebrow">Нотатки</div><ul>${s.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
      ${s.cooldown.length ? `<div class="wk-b wk-warm"><div class="eyebrow">Заминка</div><ul>${s.cooldown.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    </div>`;
  }

  return { ghErrText, checkWrite, ghGet, ghPut, loadSettings, EFFECTS, FX, SPORT, rideEffects, strengthEffects, barsHtml, legendHtml, parse, session, previewHtml, loadPlanned, savePlanned, items, subtype, fmtMin, today, addDays, monday, esc, token, topReps };
})();
