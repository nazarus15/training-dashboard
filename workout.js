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
    // головний ефект: інтенсивна зона з найбільшою кількістю хвилин, якщо інтенсивної роботи суттєво багато
    // (≥ 25% часу або її шкала ≥ 40); інакше — аеробна база. Так 20-хв тест FTP — «Поріг», а не «Анаеробна».
    const hm = { tempo: Math.max(0, m("Z3") - m("SS")), ss: m("SS"), thr: m("Z4"), vo2: m("Z5"), ana: m("Z6") + m("Z7") };
    const hard = Object.values(hm).reduce((a, b) => a + b, 0), total = Object.keys(z).filter(k => k !== "SS").reduce((a, k) => a + m(k), 0);
    const hTop = Object.entries(hm).filter(([k]) => sc[k] != null).sort((a, b) => b[1] - a[1])[0]?.[0];
    let main = hTop && (hard >= .25 * total || sc[hTop] >= 40) ? hTop : sc.base != null ? "base" : top(sc);
    if (hard < 3 && (ev.if || 0) < 62 && (ev.mins || 0) <= 60) main = "recovery";
    return { scores: sc, main };
  }

  // Ефект виконаного заїзду: за часом у зонах потужності (Z1–Z6 + SS з intervals.icu),
  // а якщо потужності нема — за пульсовими зонами (Z1–Z5, без sweet spot).
  function actEffects(a) {
    const P = a?.pZones, H = a?.hrZones;
    let zones = null, by = null;
    if (Array.isArray(P) && P.some(x => x > 0)) { zones = {}; P.forEach((s, i) => zones[i < 6 ? "Z" + (i + 1) : "SS"] = s || 0); by = "power"; }
    else if (Array.isArray(H) && H.some(x => x > 0)) { zones = {}; H.forEach((s, i) => zones["Z" + Math.min(i + 1, 6)] = (zones["Z" + Math.min(i + 1, 6)] || 0) + (s || 0)); by = "hr"; }
    if (!zones) return null;
    const fx = rideEffects({ zones, mins: (a.moving || 0) / 60, if: a.intensity });
    return fx && Object.keys(fx.scores).length ? { ...fx, by } : null;
  }

  const TAGS = [[/^сил/i, "str"], [/^гіпер/i, "hyp"], [/^витрив/i, "send"], [/^(потуж|вибух)/i, "pow"], [/^(кор|стабіл)/i, "core"]];
  const RX_CORE = /планк|турецьк|прес|dead ?bug|паллоф|pallof|фермер|carry|скручув|hollow|підйом.{0,4}ніг|колін.{0,5}до/i;
  const RX_POW = /стриб|мах|swing|ривок|поштовх|вибух|jump|плиометр|кидок/i;
  function exEffect(ex) {
    for (const t of ex.tags || []) for (const [rx, id] of TAGS) if (rx.test(t)) return id;
    const d = window.EX && ex.cid ? EX.BY[ex.cid] : null;
    if (d?.fx) return d.fx;
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
    // словник вправ (exercises.js): канонічний рух — для «минулого разу», рекордів і м'язів; кількість снарядів з «@2x24кг»
    if (window.EX) { const c = EX.canon(name); ex.cid = c.id; ex.canonName = c.name; ex.known = c.known; ex.impl = EX.implements(ex.load); }
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
  // ---------- без зв'язку: черга змін плану ----------
  // Якщо GitHub недоступний, зміна плану (Планер, «+ Додати силове вручну», програма) застосовується до локальної копії,
  // а різниця (додані / змінені / видалені тренування) стає в чергу td_planned_queue. Коли зв'язок з'явиться, черга
  // накладається на свіжу версію з GitHub — так чужі зміни з інших пристроїв не затираються.
  const LS_PQ = "td_planned_queue";
  const isNetErr = e => !e?.status && (e instanceof TypeError || e?.name === "AbortError" || !navigator.onLine);
  const wKey = w => w.id || `${w.date}|${w.sport}|${w.title || ""}`;
  function planDiff(before, after) {
    const ops = [], bw = new Map((before.workouts || []).map(w => [wKey(w), w])), aw = new Map((after.workouts || []).map(w => [wKey(w), w]));
    for (const [k, w] of aw) if (!bw.has(k) || JSON.stringify(bw.get(k)) !== JSON.stringify(w)) ops.push({ op: "put", k, w });
    for (const k of bw.keys()) if (!aw.has(k)) ops.push({ op: "del", k });
    if (JSON.stringify(before.recurring || []) !== JSON.stringify(after.recurring || [])) ops.push({ op: "rec", v: after.recurring || [] });
    for (const k of Object.keys(after)) if (!["workouts", "recurring", "updatedAt"].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k])) ops.push({ op: "key", k, v: after[k] });
    return ops;
  }
  function applyOps(data, ops) {
    data.workouts ||= []; data.recurring ||= [];
    for (const o of ops) {
      if (o.op === "put") { const i = data.workouts.findIndex(w => wKey(w) === o.k); if (i >= 0) data.workouts[i] = o.w; else data.workouts.push(o.w); }
      else if (o.op === "del") data.workouts = data.workouts.filter(w => wKey(w) !== o.k);
      else if (o.op === "rec") data.recurring = o.v;
      else if (o.op === "key") data[o.k] = o.v;
    }
    data.workouts.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return data;
  }
  const plannedQueue = () => lsGet(LS_PQ, []) || [];
  async function loadPlanned() {
    let d = null;
    if (token()) { try { d = (await apiGet()).data; } catch { } }
    if (!d) { try { const r = await fetch(`${RAW}?t=${Date.now()}`, { cache: "no-store" }); if (r.ok) d = await r.json(); } catch { } }
    const q = plannedQueue();
    if (d && q.length) d = applyOps(d, q.flatMap(x => x.ops)); // ще не відправлені зміни видно одразу
    if (d) lsSet(LS_CACHE, d); else d = lsGet(LS_CACHE, { workouts: [], recurring: [] });
    d.workouts ||= []; d.recurring ||= [];
    if (q.length && navigator.onLine) flushPlannedQueue();
    return d;
  }
  async function savePlannedOnline(mutate, message) {
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
  let pqBusy = null;
  function flushPlannedQueue() {
    const q = plannedQueue();
    if (!q.length || !token() || !navigator.onLine) return Promise.resolve(false);
    return pqBusy ??= (async () => {
      try {
        await savePlannedOnline(d => applyOps(d, q.flatMap(x => x.ops)), q.length === 1 ? q[0].message + " (без зв'язку)" : `Планер: ${q.length} змін без зв'язку`);
        // за час відправки могли додатися нові зміни — прибираємо лише відправлені
        lsSet(LS_PQ, plannedQueue().slice(q.length));
        window.AUTH?.note?.("Зміни плану, зроблені без зв'язку, відправлено на GitHub.");
        return true;
      } catch { return false; } finally { pqBusy = null; }
    })();
  }
  async function savePlanned(mutate, message) {
    if (!token()) { const e = new Error("no token"); e.status = 0; throw e; }
    if (plannedQueue().length) await flushPlannedQueue();
    try {
      if (plannedQueue().length) throw new TypeError("queue"); // черга ще не пішла — нову зміну ставимо за нею, щоб зберегти порядок
      return await savePlannedOnline(mutate, message);
    } catch (e) {
      if (!isNetErr(e)) throw e;
      const before = lsGet(LS_CACHE, { workouts: [], recurring: [] });
      const data = JSON.parse(JSON.stringify(before)); data.workouts ||= []; data.recurring ||= [];
      mutate(data);
      data.workouts.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      data.updatedAt = new Date().toISOString();
      const ops = planDiff(before, data);
      if (ops.length) lsSet(LS_PQ, [...plannedQueue(), { at: data.updatedAt, message, ops }]);
      lsSet(LS_CACHE, data);
      window.AUTH?.note?.("Немає зв'язку з GitHub: зміну плану збережено на пристрої, відправлю автоматично.");
      Object.defineProperty(data, "queued", { value: true, enumerable: false }); // для повідомлень сторінок; у файл не потрапляє
      return data;
    }
  }

  // ---------- записи силових: відправка з будь-якої сторінки ----------
  // Підходи пишуться в td_pending_logs (strength.js) одразу, навіть без інтернету. Відправка — тут, щоб черга
  // пішла, щойно з'явиться зв'язок на будь-якій сторінці. Для кожного тренування перемагає новіша версія
  // (updatedAt): запис, змінений на іншому пристрої пізніше, не затирається.
  const LOGS_API = `https://api.github.com/repos/${REPO}/contents/logs.json`;
  let logsBusy = null;
  function flushLogs(message) {
    const snap = lsGet("td_pending_logs", {}) || {};
    if (!Object.keys(snap).length) return Promise.resolve({ ok: true, sent: 0 });
    if (!token()) return Promise.resolve({ ok: false, kind: "local" });
    if (!navigator.onLine) return Promise.resolve({ ok: false, kind: "offline" });
    return logsBusy ??= (async () => {
      const H = { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json" };
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const g = await fetch(`${LOGS_API}?ref=${BRANCH}&t=${Date.now()}`, { headers: H, cache: "no-store" });
          if (g.headers.get("X-TD-Offline")) return { ok: false, kind: "offline" };
          if (g.status === 401) return { ok: false, kind: "error", msg: "Токен протермінований або невірний. Підключи новий." };
          let sha = null, remote = { logs: {} };
          if (g.ok) { const j = await g.json(); sha = j.sha; remote = (await AUTH.decrypt(JSON.parse(b64dec(j.content || "") || "{}"))) || { logs: {} }; }
          else if (g.status !== 404) throw await httpErr(g);
          const merged = { ...(remote.logs || {}) };
          for (const [sid, L] of Object.entries(snap)) { const r = merged[sid]; if (!(r?.updatedAt && L?.updatedAt && r.updatedAt > L.updatedAt)) merged[sid] = L; }
          const body = { logs: merged, updatedAt: new Date().toISOString() };
          const r = await fetch(LOGS_API, { method: "PUT", headers: { ...H, "Content-Type": "application/json" },
            body: JSON.stringify({ message: message || `Журнал: ${Object.keys(snap).length} ${Object.keys(snap).length === 1 ? "запис" : "записи"}`, content: b64enc(JSON.stringify(await AUTH.encrypt(body))), branch: BRANCH, ...(sha ? { sha } : {}) }) });
          if (r.ok) {
            const now = lsGet("td_pending_logs", {}) || {};
            for (const sid of Object.keys(snap)) if (JSON.stringify(now[sid]) === JSON.stringify(snap[sid])) delete now[sid];
            lsSet("td_pending_logs", now); lsSet("td_logs_cache", body);
            const d = new Date(); lsSet("td_last_sync", `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
            lsSet("td_sync_state", { kind: "ok", msg: "" });
            return { ok: true, sent: Object.keys(snap).length, body };
          }
          if (r.status === 401) return { ok: false, kind: "error", msg: "Токен протермінований або невірний. Підключи новий." };
          if (r.status === 403) return { ok: false, kind: "error", msg: "Токен лише читає. На GitHub відредагуй його: Repository permissions → Contents: Read and write." };
          if (r.status !== 409 && r.status !== 422) throw await httpErr(r);
        }
        return { ok: false, kind: "offline" };
      } catch (e) { return { ok: false, kind: isNetErr(e) ? "offline" : "error", msg: isNetErr(e) ? "" : ghErrText(e) }; }
      finally { logsBusy = null; }
    })();
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
    const c = lsGet("td_settings_cache", null);
    try { s = (await ghGet("settings.json", BRANCH)).data; } catch { }
    // свіжіший локальний кеш (щойно збережене, а raw GitHub ще віддає стару версію) має перевагу
    if (s && !(c?.updatedAt && (!s.updatedAt || c.updatedAt > s.updatedAt))) lsSet("td_settings_cache", s); else s = c || s || {};
    let priv = {};
    try { priv = (s.private && window.AUTH ? await AUTH.decrypt(s.private) : {}) || {}; } catch { }
    if (priv.gcalUrl && priv.gcalSecret) lsSet("td_gcal", { url: priv.gcalUrl, secret: priv.gcalSecret });
    return { ftpFloor: s.ftpFloor || 231, overview: s.overview, records: s.records, updatedAt: s.updatedAt, ...priv };
  }


  // ---------- приватна синхронізація з Google Calendar (Apps Script) ----------
  let GC = lsGet("td_gcal", null);
  const gcalCache = s => { GC = s && s.gcalUrl && s.gcalSecret ? { url: s.gcalUrl, secret: s.gcalSecret } : null; lsSet("td_gcal", GC); };
  async function gcalCfg() { if (GC) return GC; try { gcalCache(await loadSettings()); } catch { } return GC; }
  async function gcalPush(overrides) {
    const c = await gcalCfg(); if (!c || !overrides.length) return false;
    try { await fetch(c.url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ secret: c.secret, source: "journal", overrides }) }); return true; }
    catch { const q = lsGet("td_gcal_queue", []); lsSet("td_gcal_queue", [...q, ...overrides].slice(-200)); return false; }
  }
  async function gcalFlush() { const q = lsGet("td_gcal_queue", []); if (q.length) { lsSet("td_gcal_queue", []); await gcalPush(q); } }
  // подія для силового з журналу: старт/фініш, підсумок підходів
  function strengthOverride(s, L) {
    const hm = iso => new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" });
    if (!L || L.deleted) return { uid: s.id, deleted: true };
    const base = { uid: s.id, date: s.date, color: "6" };
    const title = `Силове · ${s.title}`;
    const sets = (s.exercises || []).map(ex => { const d = (L.sets?.[ex.key] || []).filter(x => x.done); return d.length ? `• ${ex.name}: ${d.map(x => (x.w && +x.w ? x.w + "кг×" : "") + x.r + (ex.type === "time" ? "с" : "")).join(", ")}` : ""; }).filter(Boolean);
    const link = `https://nazarus15.github.io/training-dashboard/strength.html?s=${encodeURIComponent(s.id)}`;
    if (L.status === "skipped") return { ...base, title: `✕ ${title} (пропущено)`, desc: link };
    const anyDone = Object.values(L.sets || {}).some(a => a.some(x => x.done));
    const age = L.startedAt ? Date.now() - new Date(L.startedAt) : 0;
    // почато «порожньо» (жодного підходу) понад 3 год тому — це не тренування, повертаємо план
    if (L.startedAt && !L.finishedAt && L.status !== "done" && !anyDone && age > 3 * 3600e3) return { uid: s.id, clear: true };
    if (L.startedAt) {
      // не натиснули «Завершити», а минуло понад 12 год — не показуємо «триває» вічно
      const stale = !L.finishedAt && age > 12 * 3600e3;
      const st = new Date(L.startedAt), en = L.finishedAt ? new Date(L.finishedAt) : new Date(st.getTime() + (s.mins || 60) * 6e4);
      const head = L.finishedAt ? `Виконано: ${hm(L.startedAt)}–${hm(L.finishedAt)} (${Math.round((en - st) / 6e4)} хв, оцінка ${s.mins || "—"} хв)` : `Почато о ${hm(L.startedAt)}, орієнтовно до ${hm(en.toISOString())} (оцінка ${s.mins || "—"} хв)`;
      const desc = [head, L.rpe ? `RPE ${L.rpe}` : "", L.note ? `Нотатки: ${L.note}` : "", sets.length ? "\n" + sets.join("\n") : "", "", link].filter(x => x !== "").join("\n");
      return { ...base, title: L.finishedAt ? `✓ ${title}` : stale ? `✓ ${title} (без позначки завершення)` : `▶ ${title} (триває)`, desc, start: st.toISOString(), end: en.toISOString() };
    }
    if (L.status === "done") return { ...base, title: `✓ ${title}`, desc: [sets.join("\n"), link].filter(Boolean).join("\n\n") };
    return { uid: s.id, clear: true };
  }
  async function gcalSyncJournal() {
    if (!(await gcalCfg())) return false;
    const [P, J] = await Promise.all([loadPlanned(), ghGet("logs.json", BRANCH).then(x => window.AUTH ? AUTH.decrypt(x.data) : x.data).catch(() => null)]);
    const logs = J?.logs || {};
    const ov = P.workouts.filter(w => w.sport === "strength" && logs[w.id]).map(w => strengthOverride(session(w), logs[w.id]));
    await gcalPush(ov); return ov.length;
  }


  // ---------- вело: кроки тренування intervals.icu → список з ватами (як «вправи» силового) ----------
  const SEC_UA = { "tempo": "Темп", "warmup": "Розминка", "warm up": "Розминка", "main set": "Основна частина", "cooldown": "Заминка", "cool down": "Заминка" };
  function bikeSteps(desc, ftp) {
    const out = []; let sec = null, started = false;
    const dur = s => { let x = 0; for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)) x += +m[1] * { h: 3600, m: 60, s: 1 }[m[2]]; return x; };
    const fd = x => { const m = Math.floor(x / 60), s = x % 60; return m ? `${m} хв${s ? " " + s + " с" : ""}` : `${s} с`; };
    const w = p => ftp ? Math.round(ftp * p / 100) : null;
    for (const raw of String(desc || "").split(/\r?\n/)) {
      const ln = raw.trim(); if (!ln) continue;
      const st = ln.match(/^-\s*(\S+)\s+(?:@\s*)?(ramp\s+)?(\d+)(?:\s*-\s*(\d+))?%/i);
      if (st) {
        started = true; if (!sec) out.push(sec = { name: "", reps: 0, steps: [] });
        const a = +st[3], b = st[4] ? +st[4] : null, ramp = !!st[2];
        const txt = ramp && b ? (ftp ? `плавно ${w(a)}→${w(b)} Вт` : `плавно ${a}→${b}%`) : b ? (ftp ? `${w(a)}–${w(b)} Вт` : `${a}–${b}%`) : (ftp ? `${w(a)} Вт` : `${a}%`);
        sec.steps.push({ dur: fd(dur(st[1])), secs: dur(st[1]), txt, pct: ramp && b ? `${a}→${b}%` : b ? `${a}–${b}%` : `${a}%` });
        continue;
      }
      const h = ln.match(/^(.*?)(?:\s+(\d+)\s*[xх×])?\s*$/), name = h[1].trim(), known = SEC_UA[name.toLowerCase()];
      if (known || h[2] || (started && ln.length < 32)) { started = true; out.push(sec = { name: known || name, reps: h[2] ? +h[2] : 0, steps: [] }); }
    }
    return out.filter(s => s.steps.length);
  }
  function bikeStepsHtml(desc, ftp) {
    const ss = bikeSteps(desc, ftp); if (!ss.length) return "";
    const n = ss.reduce((a, s) => a + s.steps.length * (s.reps || 1), 0);
    return `<details><summary>Інтервали (${n})</summary><ol class="bsteps">${ss.map(s => `${s.name ? `<li class="bsec">${esc(s.name)}${s.reps ? ` ×${s.reps}` : ""}</li>` : ""}${s.steps.map(x => `<li><b>${x.dur}</b><span class="num">${esc(x.txt)}${ftp ? ` <small>${x.pct}</small>` : ""}</span></li>`).join("")}`).join("")}</ol></details>`;
  }

  // ---------- календар: план + intervals ----------
  const SPORT = { bike: ["Вело", "#3c8dd0"], strength: ["Силове", "#e0761b"], bjj: ["БЖЖ", "#7a4cc2"], run: ["Біг", "#2ea36b"], other: ["Інше", "#8a96a3"] };
  const evSport = t => /ride|cycl/i.test(t || "") ? "bike" : /run/i.test(t || "") ? "run" : "other";
  // фактично виконане силове: лише відмічені підходи. Невідмічені вправи не зараховуються (ефекти, список вправ, рекорди).
  // null — у журналі ще жодної відмітки, тоді показуємо план.
  function doneSession(s, L) {
    if (!s?.exercises?.length || !L || L.deleted) return null;
    const ex = s.exercises.map(e => ({ ...e, sets: (L.sets?.[e.key] || []).filter(x => x.done).length })).filter(e => e.sets > 0);
    if (!ex.length && !L.startedAt && L.status !== "done") return null;
    return { ...s, exercises: ex, planned: s.exercises.length };
  }
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

  // ---------- однакові назви активностей і пристроїв на всіх сторінках ----------
  // Garmin і Wahoo дають англійські службові назви («Mixed Martial Arts», «Evening Weight Training», «Cycling»,
  // «Verkhovynskyi raion Hiking»). Свої назви (план з intervals.icu, «Z2 — 60 хв») не змінюються.
  const ACT_UA = [[/^mixed martial arts$/i, "БЖЖ"], [/^((morning|afternoon|evening|night)\s+)?(weight|strength)\s*training$|^strength$/i, "Силове"],
    [/^((morning|afternoon|evening|night)\s+)?(cycling|ride|virtual ride|indoor cycling)$/i, "Заїзд"], [/^((morning|afternoon|evening|night)\s+)?(hiking|hike)$/i, "Похід"],
    [/^stand up paddleboarding$/i, "SUP"], [/^((morning|afternoon|evening|night)\s+)?(walking|walk)$/i, "Ходьба"], [/^((morning|afternoon|evening|night)\s+)?(running|run)$/i, "Біг"],
    [/^timed activity$/i, "Активність"], [/^other$/i, ""], [/^workout$/i, ""]];
  // відкат нормалізації назв: показуємо назви як є (функції лишаються, бо ними користуються журнал і календар)
  function actName(a, sportName) { return String(a?.name || "").trim() || sportName || "Тренування"; }
  const DEV = [[/cirqa/i, "Garmin CIRQA"], [/^connect$/i, "Вручну, Garmin Connect"], [/elemnt\s*roam/i, "Wahoo ELEMNT ROAM"], [/elemnt\s*bolt/i, "Wahoo ELEMNT BOLT"],
    [/kickr/i, "Wahoo KICKR"], [/^edge[ _]?(\d+)/i, m => "Garmin Edge " + m[1]], [/^garmin$/i, "Garmin"]];
  function devName(d) { return String(d || "").replace(/WAHOO_FITNESS |Garmin |GARMIN /g, ""); }


  const TILES = [["ready", "Готовність"], ["tsb", "Форма (TSB)"], ["ctl", "Фітнес (CTL)"], ["hrv", "HRV минулої ночі"], ["rhr", "Пульс спокою"], ["sleep", "Сон"], ["bb", "Body Battery"], ["ftp", "FTP"]];
  // каталог рекордів: [id, вид, назва] — для сторінки «Рекорди» і перемикачів у Налаштуваннях
  const RECORDS = [
    ["bjj_longest", "bjj", "Найдовше тренування"], ["bjj_load", "bjj", "Найбільше навантаження за тренування"], ["bjj_hard", "bjj", "Найбільше часу в зонах 4–5"],
    ["bjj_maxhr", "bjj", "Найвищий пульс"], ["bjj_kcal", "bjj", "Найбільше калорій"], ["bjj_week", "bjj", "Найбільше тренувань за тиждень"],
    ["bjj_month", "bjj", "Найбільше годин на килимі за місяць"], ["bjj_streak", "bjj", "Найдовша серія тижнів (2+ тренування)"], ["bjj_total", "bjj", "Усього тренувань"],
    ["bike_p5", "bike", "Потужність 5 с"], ["bike_p60", "bike", "Потужність 1 хв"], ["bike_p300", "bike", "Потужність 5 хв"], ["bike_p1200", "bike", "Потужність 20 хв"], ["bike_p3600", "bike", "Потужність 60 хв"],
    ["bike_np", "bike", "Найвища нормалізована потужність (20+ хв)"], ["bike_ef", "bike", "Найкраща аеробна ефективність"], ["bike_longest", "bike", "Найдовший заїзд"],
    ["bike_dist", "bike", "Найбільша відстань"], ["bike_load", "bike", "Найбільше навантаження за заїзд"], ["bike_kj", "bike", "Найбільше роботи, кДж"],
    ["bike_elev", "bike", "Найбільший набір висоти"], ["bike_week", "bike", "Найбільше годин за тиждень"], ["bike_month", "bike", "Найбільше кілометрів за місяць"],
    ["str_table", "strength", "Прогрес у вправах за категоріями (вага за раз, найкращий підхід)"], ["str_ton", "strength", "Найбільший тоннаж за тренування"], ["str_sets", "strength", "Найбільше робочих підходів за тренування"],
    ["str_streak", "strength", "Найдовша серія тижнів із силовим"], ["str_total", "strength", "Усього силових"],
  ];
  // запуск оновлення даних (і календаря) через GitHub Actions; потрібне право Actions у токені, без нього — тихо нічого
  // auto=true — «перевір слот»: scripts/gate.py збирає дані, лише якщо в поточному слоті (23:00 / 10:00 / 12:00) збору ще не було
  async function triggerUpdate(auto = false) {
    if (!token()) return false;
    try { const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update.yml/dispatches`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main", ...(auto ? { inputs: { auto: "true" } } : {}) }) }); return r.ok; } catch { return false; }
  }
  return { flushLogs, flushPlannedQueue, plannedQueue, actName, devName, bikeSteps, bikeStepsHtml, gcalCache, gcalCfg, gcalPush, gcalFlush, gcalSyncJournal, strengthOverride, triggerUpdate, RECORDS, actEffects, TILES, ghErrText, checkWrite, ghGet, ghPut, loadSettings, EFFECTS, FX, SPORT, rideEffects, strengthEffects, doneSession, barsHtml, legendHtml, parse, session, previewHtml, loadPlanned, savePlanned, items, subtype, fmtMin, today, addDays, monday, esc, token, topReps };
})();
