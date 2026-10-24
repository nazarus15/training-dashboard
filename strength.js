"use strict";
// Силовий журнал. План — planned.json у гілці `journal` (Планер, текстовий формат, див. workout.js). Записи — logs.json у гілці `journal`
// цього репозиторію: пишуться через GitHub API особистим токеном, читаються з raw.githubusercontent.com.
// Спершу все лягає в localStorage, тому без інтернету чи токена нічого не губиться.

const REPO = "nazarus15/training-dashboard", BRANCH = "journal", FILE = "logs.json";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
const LS = { token: "td_gh_token", pending: "td_pending_logs", cache: "td_logs_cache", last: "td_last_sync" };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MON = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
const todayISO = (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); })();
const dObj = s => new Date(s + "T12:00:00");
const fmtDay = s => { const d = dObj(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const nowHM = () => new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
const GROUP_COLOR = { W: "--plate-w", A: "--plate-a", B: "--plate-b", C: "--plate-c" };
const KIND = { strength: ["Сила", "--accent"], bike: ["Вело", "--plate-b"], bjj: ["БЖЖ", "--plate-a"], run: ["Біг", "--plate-w"], other: ["Інше", "--grey"], rest: ["Відпочинок", "--grey"] };
const UNIT = { weight: "кг", kb: "кг", bw: "+кг", time: "" };
const REPS_UNIT = { time: "с" };

let plan = null, planned = null, events = null, sessions = {}, logs = {}, selected = null;
let token = lsGet(LS.token, null);
let pending = lsGet(LS.pending, {});
let syncState = { kind: token ? "ok" : "local", msg: "" };

// ---------- base64 utf-8 ----------
function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function b64dec(b64) { const bin = atob(b64.replace(/\s/g, "")); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }

// ---------- remote store ----------
async function apiGet() {
  const r = await fetch(`${API}?ref=${BRANCH}&t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (r.status === 404) return { sha: null, data: { logs: {} } };
  if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  return { sha: j.sha, data: (await AUTH.decrypt(JSON.parse(b64dec(j.content || "") || "{}"))) || { logs: {} } };
}
async function loadRemote() {
  if (token) { try { return (await apiGet()).data; } catch (e) { if (e.status === 401 || e.status === 403) setSync("error", "Токен не підходить або протермінований. Підключи новий."); } }
  try { const r = await fetch(`${RAW}?t=${Date.now()}`, { cache: "no-store" }); if (r.ok) return await AUTH.decrypt(await r.json()); } catch { }
  return null;
}

let pushTimer = null, pushing = false;
function queuePush(delay = 2500) { clearTimeout(pushTimer); pushTimer = setTimeout(push, delay); }
async function push() {
  if (!Object.keys(pending).length) return;
  if (!token) { setSync("local"); return; }
  if (pushing) { queuePush(1500); return; }
  pushing = true;
  const snapshot = JSON.parse(JSON.stringify(pending));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await apiGet();
      const merged = { ...(cur.data.logs || {}), ...snapshot };
      const body = { logs: merged, updatedAt: new Date().toISOString() };
      const dates = Object.keys(snapshot).map(s => sessions[s]?.date || s).join(", ");
      const r = await fetch(API, { method: "PUT", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Журнал: ${dates}`, content: b64enc(JSON.stringify(await AUTH.encrypt(body))), branch: BRANCH, ...(cur.sha ? { sha: cur.sha } : {}) }) });
      if (r.ok) {
        for (const sid of Object.keys(snapshot)) if (JSON.stringify(pending[sid]) === JSON.stringify(snapshot[sid])) delete pending[sid];
        lsSet(LS.pending, pending); lsSet(LS.cache, body); lsSet(LS.last, nowHM());
        setSync("ok"); break;
      }
      if (r.status === 401) { setSync("error", "Токен протермінований або невірний. Підключи новий."); break; }
      if (r.status === 403) { setSync("error", "Токен лише читає. На GitHub відредагуй його: Repository permissions → Contents: Read and write."); break; }
      if (r.status !== 409 && r.status !== 422) throw new Error("http " + r.status);
    }
  } catch (e) {
    setSync("offline", "Немає зв'язку з GitHub. Записи збережені на телефоні, відправлю пізніше.");
    setTimeout(() => queuePush(0), 60000);
  } finally { pushing = false; if (Object.keys(pending).length && syncState.kind === "ok") queuePush(1500); }
}
window.addEventListener("online", () => queuePush(0));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && Object.keys(pending).length) push(); });

function setSync(kind, msg = "") { syncState = { kind, msg }; lsSet("td_sync_state", syncState); if (window.AUTH) AUTH.health().then(h => AUTH.markNav(h.issues)).catch(() => { }); renderSync(); }
function renderSync() {
  if (!$("sync")) return;
  const n = Object.keys(pending).length;
  const last = lsGet(LS.last, null);
  const color = { ok: "--good", local: "--warn", offline: "--warn", error: "--bad" }[syncState.kind];
  let head;
  if (syncState.kind === "ok") head = `<span class="pill done">GitHub підключено</span><span class="muted">${n ? `Відправляю ${n} ${n === 1 ? "запис" : "записи"}…` : last ? `Збережено ${last}` : "Усе збережено"}</span>`;
  else if (syncState.kind === "local") head = `<span class="pill today">Лише на цьому пристрої</span><span class="muted">Записи не потраплять на сайт, поки не підключиш GitHub.${n ? ` Чекають відправки: ${n}.` : ""}</span>`;
  else if (syncState.kind === "offline") head = `<span class="pill today">Не синхронізовано</span><span class="muted">${esc(syncState.msg)}</span>`;
  else head = `<span class="pill off">Помилка</span><span class="muted">${esc(syncState.msg)}</span>`;
  const howto = `<ol>
    <li>Відкрий <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token</a>.</li>
    <li>Назва «Силовий журнал», термін — 1 рік.</li>
    <li>Repository access → Only select repositories → <b>training-dashboard</b>.</li>
    <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
    <li>Generate token, скопіюй і встав сюди. Токен зберігається лише в цьому браузері; на кожному новому пристрої вставляєш його один раз.</li></ol>
    <form id="tokForm"><label class="eyebrow" for="tokIn" hidden>Токен GitHub</label><input id="tokIn" type="password" autocomplete="off" placeholder="github_pat_…" aria-label="Токен GitHub"><button class="btn" type="submit">Підключити</button></form>`;
  $("sync").style.setProperty("--c", `var(${color})`);
  $("sync").innerHTML = `<div class="row">${head}${syncState.kind === "ok" ? `<button type="button" class="btn ghost" id="syncNow">Синхронізувати</button>` : ""}</div>
    ${token && syncState.kind !== "error" ? `<details><summary>Налаштування збереження</summary><div class="row" style="margin-top:8px"><span class="muted">Записи йдуть у гілку <span class="num">journal</span> репозиторію; сторінку «Огляд» це не перезбирає.</span><button type="button" class="btn ghost" id="tokOff">Відключити на цьому пристрої</button></div></details>`
      : `<details ${syncState.kind === "error" || !lsGet(LS.token) ? "open" : ""}><summary>Як підключити GitHub (2 хв)</summary>${howto}</details>`}`;
}
document.addEventListener("submit", async e => {
  if (e.target.id !== "tokForm") return;
  e.preventDefault();
  const v = $("tokIn").value.trim(); if (!v) return;
  token = v;
  try {
    await apiGet();
    const w = await WK.checkWrite(v);
    if (w === "readonly") { token = null; setSync("error", "Токен лише читає. На GitHub відредагуй його: Repository permissions → Contents: Read and write, потім встав ще раз."); return; }
    lsSet(LS.token, v); setSync("ok"); queuePush(0); const remote = await loadRemote(); if (remote) mergeRemote(remote); render(); }
  catch (err) { token = null; setSync("error", err.status === 401 ? "Токен невірний." : err.status === 403 || err.status === 404 ? "Токен не має доступу до training-dashboard. Перевір Repository access і Contents: Read and write." : "Не вдалося перевірити токен: немає зв'язку."); }
});
document.addEventListener("click", e => {
  if (e.target.id === "syncNow") push();
  if (e.target.id === "tokOff") { token = null; lsSet(LS.token, null); setSync("local"); }
});

// ---------- logs model ----------
function topReps(r) { const m = String(r).match(/(\d+)\s*[–-]\s*(\d+)/); return m ? +m[2] : parseInt(r, 10) || 0; }
function lowReps(r) { return parseInt(String(r), 10) || ""; }
function lastResult(key, beforeDate) {
  const past = Object.values(sessions).filter(s => s.date < beforeDate && logs[s.id]?.sets?.[key]?.some(x => x.done)).sort((a, b) => a.date < b.date ? 1 : -1);
  if (!past.length) return null;
  const s = past[0]; const ex = (s.exercises || []).find(e => e.key === key);
  return { date: s.date, sets: logs[s.id].sets[key].filter(x => x.done), target: ex?.reps, type: ex?.type };
}
function describe(prev, type) {
  const unit = type === "time" ? " с" : "";
  const ws = [...new Set(prev.sets.map(x => x.w).filter(w => w !== "" && w != null && +w !== 0))];
  return (ws.length ? ws.join("/") + " кг × " : "") + prev.sets.map(x => x.r).join(", ") + unit;
}
function progressHint(ex, prev) {
  if (!prev) return "";
  const allHit = prev.sets.length >= ex.sets && prev.sets.every(x => +x.r >= topReps(prev.target || ex.reps));
  if (!allHit) return "";
  return { weight: "Усі повтори виконані — додай 2,5 кг.", kb: "Усі повтори виконані — бери важчу гирю.", bw: "Усі повтори виконані — повільніше опускання 4 с або гиря між ступнями.", time: "Додай 10 с." }[ex.type] || "";
}
function emptyLog(s) {
  const sets = {};
  for (const ex of s.exercises || []) {
    const prev = lastResult(ex.key, s.date);
    sets[ex.key] = Array.from({ length: ex.sets }, (_, i) => ({ w: prev?.sets?.[i]?.w ?? prev?.sets?.at(-1)?.w ?? "", r: lowReps(ex.reps), done: false }));
  }
  return { sets, rpe: null, note: "", status: null };
}
function logFor(s) {
  if (!logs[s.id]) logs[s.id] = emptyLog(s);
  const L = logs[s.id];
  for (const ex of s.exercises || []) if (!L.sets[ex.key]) L.sets[ex.key] = emptyLog(s).sets[ex.key];
  return L;
}
function changed(sid) { logs[sid].updatedAt = new Date().toISOString(); pending[sid] = JSON.parse(JSON.stringify(logs[sid])); lsSet(LS.pending, pending); renderSync(); queuePush(); }
function mergeRemote(remote) { logs = { ...(remote.logs || {}), ...pending }; }

// ---------- render ----------
function render() {
  if (!plan) return;
  $("status").hidden = true;
  renderSchedule(); renderSession(); renderHistory();
}
function statusPill(s, L) {
  if (L?.status === "done") return `<span class="pill done">Виконано</span>`;
  if (L?.status === "skipped") return `<span class="pill skip">Пропущено</span>`;
  if (s.date === todayISO) return `<span class="pill today">Сьогодні</span>`;
  return `<span class="pill plan">${s.date < todayISO ? "Не відмічено" : "План"}</span>`;
}
function renderSchedule() {
  $("scheduleWrap").hidden = false;
  const from = WK.monday(todayISO), to = WK.addDays(from, 13);
  const its = WK.items(planned, events, from, to);
  const weeks = [0, 7].map(o => ({ title: (o ? "Наступний тиждень" : "Цей тиждень"), days: its.filter(x => x.date >= WK.addDays(from, o) && x.date <= WK.addDays(from, o + 6)).map(x => ({ date: x.date, kind: x.sport, title: x.title, session: x.sport === "strength" ? x.id : null, detail: [WK.fmtMin(x.mins), WK.subtype(x)].filter(Boolean).join(" · ") })) }));
  $("schedule").innerHTML = weeks.map(w => `<div class="week"><h3>${esc(w.title)}</h3><div class="days">${w.days.length ? "" : `<div class="day"><span class="t"><small>Нічого не заплановано</small></span></div>`}${w.days.map(d => {
    const s = d.session ? sessions[d.session] : null;
    const [kName, kCol] = KIND[d.kind] || KIND.other;
    const pill = s ? statusPill(s, logs[s.id]) : d.date === todayISO ? `<span class="pill today">Сьогодні</span>` : "";
    const dd = dObj(d.date);
    const inner = `<span class="d">${DOW[dd.getDay()]}<b>${dd.getDate()}.${String(dd.getMonth() + 1).padStart(2, "0")}</b></span><span class="t"><span class="kind" style="--k:var(${kCol})">${kName}</span><strong>${esc(d.title)}</strong>${d.detail ? `<small>${esc(d.detail.replace(/ · в intervals\.icu$/, ""))}</small>` : ""}</span>${pill}`;
    const cls = `day${d.date === todayISO ? " is-today" : ""}${s && selected === s.id ? " sel" : ""}`;
    return s ? `<button type="button" class="${cls}" data-s="${esc(s.id)}">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
  }).join("")}</div></div>`).join("");
}
function renderSession() {
  const s = sessions[selected];
  if (!s) { $("sessionWrap").hidden = true; return; }
  $("sessionWrap").hidden = false;
  const L = logFor(s);
  const groups = {};
  for (const ex of s.exercises || []) (groups[ex.group || "A"] ??= []).push(ex);
  let html = `<div class="s-head"><div class="eyebrow">${DOW[dObj(s.date).getDay()]}, ${fmtDay(s.date)} · ${WK.fmtMin(s.mins)}</div>
    <div class="row"><h3 style="font-size:28px">${esc(s.title)}</h3>${statusPill(s, L)}</div>${s.goal ? `<p>${esc(s.goal)}</p>` : ""}${WK.barsHtml(WK.strengthEffects(s))}<a class="muted" style="font-size:13px" href="planner.html?edit=${encodeURIComponent(s.id)}">Змінити в Планері</a></div>`;
  if (s.warmup?.length) html += `<div class="block warm"><div class="eyebrow">Розминка · ${esc(s.warmupTime || "8–10 хв")}</div><ul>${s.warmup.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>`;
  for (const g of Object.keys(groups)) {
    const exs = groups[g];
    html += `<div class="block"><div class="eyebrow">${exs[0].block ? esc(exs[0].block) : exs.length > 1 ? "Суперсет" : "Блок"}${exs[0].rest ? ` · відпочинок ${exs[0].rest} с${exs.length > 1 ? " після пари" : ""}` : ""}</div>`;
    if (exs.length > 1) { html += supersetHtml(s, L, g, exs) + `</div>`; continue; }
    for (const ex of exs) {
      const prev = lastResult(ex.key, s.date), hint = progressHint(ex, prev);
      const unit = UNIT[ex.type] ?? "кг", ru = REPS_UNIT[ex.type] || "повт";
      const id = `${s.id}-${ex.key}`;
      html += `<div class="ex" style="--c:var(${GROUP_COLOR[g] || "--line"})">
        <div class="ex-top"><span class="ex-name"><span class="tag">${esc(ex.label || "")}</span>${esc(ex.name)}</span><span class="ex-target">${ex.sets}×${esc(ex.reps)}${ex.type === "time" ? " с" : ""}${ex.perSide ? "/бік" : ""}${ex.load ? " · " + esc(ex.load) : ""}${ex.rir ? " · запас " + esc(ex.rir) : ""}</span></div>
        <div class="ex-meta">${ex.cue ? `<span>${esc(ex.cue)}</span>` : ""}${prev ? `<span>Минулого разу (${fmtDay(prev.date)}): <span class="num">${esc(describe(prev, ex.type))}</span></span>` : `<span>${esc(ex.firstTime || { bw: "Перший раз: стільки повторів, скільки чисто, із запасом 1–2.", time: "Перший раз: тримай стільки, скільки виходить рівно, без провисання.", kb: "Перший раз: гиря, з якою лишається запас 2 повтори." }[ex.type] || "Перший раз: підбери вагу, з якою лишається запас повторів.")}</span>`}${hint ? `<span class="prog">${esc(hint)}</span>` : ""}</div>
        <div class="sets">${L.sets[ex.key].map((st, i) => `<div class="set${st.done ? " is-done" : ""}">
          <span class="n">${i + 1}</span>
          ${ex.type === "time" ? `<span class="muted" style="font-size:13px">${ex.perSide ? "кожен бік" : ""}</span>` : `<label class="field"><input id="w-${esc(id)}-${i}" inputmode="decimal" data-s="${esc(s.id)}" data-k="${esc(ex.key)}" data-i="${i}" data-f="w" value="${esc(st.w)}" placeholder="${ex.type === "bw" ? "0" : "—"}" aria-label="${esc(ex.name)}, підхід ${i + 1}, вага"><span>${unit}</span></label>`}
          <span class="x">${ex.type === "time" ? "" : "×"}</span>
          <label class="field"><input id="r-${esc(id)}-${i}" inputmode="numeric" data-s="${esc(s.id)}" data-k="${esc(ex.key)}" data-i="${i}" data-f="r" value="${esc(st.r)}" aria-label="${esc(ex.name)}, підхід ${i + 1}, ${ex.type === "time" ? "секунди" : "повтори"}"><span>${ru}</span></label>
          <button type="button" class="check" aria-pressed="${st.done}" data-s="${esc(s.id)}" data-k="${esc(ex.key)}" data-i="${i}" data-rest="${ex.rest || 0}" aria-label="Підхід ${i + 1} виконано">✓</button></div>`).join("")}</div></div>`;
    }
    html += `</div>`;
  }
  html += `<div class="block foot">
    <div><div class="eyebrow" style="margin-bottom:6px">Як пішло (RPE сесії, 1–10)</div><div class="rpe">${[5, 6, 7, 8, 9, 10].map(v => `<button type="button" data-rpe="${v}" aria-pressed="${L.rpe === v}">${v}</button>`).join("")}</div></div>
    <div><label for="note-${esc(s.id)}">Нотатки: самопочуття, техніка, що змінити</label><textarea id="note-${esc(s.id)}" data-note="${esc(s.id)}">${esc(L.note)}</textarea></div>
    <div class="actions"><button type="button" class="btn" data-finish="done">${L.status === "done" ? "Виконано ✓" : "Завершити тренування"}</button><button type="button" class="btn ghost" data-finish="skipped">${L.status === "skipped" ? "Пропущено" : "Пропустити"}</button>${L.status ? `<button type="button" class="btn ghost" data-finish="">Скинути статус</button>` : ""}</div></div>`;
  const focus = document.activeElement?.id;
  $("session").innerHTML = html;
  if (focus && $(focus)) $(focus).focus();
}
function renderHistory() {
  const rows = [];
  const byDate = Object.values(sessions).sort((a, b) => a.date < b.date ? -1 : 1);
  const names = {};
  for (const s of byDate) for (const ex of s.exercises || []) {
    names[ex.key] = ex.name;
    const done = logs[s.id]?.sets?.[ex.key]?.filter(x => x.done) || [];
    if (!done.length) continue;
    const ton = ["weight", "kb"].includes(ex.type) ? done.reduce((t, x) => t + (+x.w || 0) * (+x.r || 0), 0) : null;
    rows.push({ key: ex.key, name: ex.name, date: s.date, res: describe({ sets: done }, ex.type), ton });
  }
  $("histWrap").hidden = !rows.length;
  if (!rows.length) return;
  rows.sort((a, b) => a.name.localeCompare(b.name, "uk") || (a.date < b.date ? -1 : 1));
  $("hist").innerHTML = `<thead><tr><th>Вправа</th><th>Дата</th><th>Результат</th><th style="text-align:right">Тоннаж, кг</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${fmtDay(r.date)}</td><td class="num">${esc(r.res)}</td><td class="num">${r.ton ? Math.round(r.ton) : "—"}</td></tr>`).join("")}</tbody>`;
}


// ---------- суперсет: одна галочка на раунд (пару вправ) ----------
const FIRST = { bw: "Перший раз: стільки повторів, скільки чисто, із запасом 1–2.", time: "Перший раз: тримай стільки, скільки виходить рівно, без провисання.", kb: "Перший раз: гиря, з якою лишається запас 2 повтори." };
function supersetHtml(s, L, g, exs) {
  const col = `var(${GROUP_COLOR[g] || "--line"})`;
  let h = `<div class="ss" style="--c:${col}">`;
  for (const ex of exs) {
    const prev = lastResult(ex.key, s.date), hint = progressHint(ex, prev);
    h += `<div class="ex ss-ex"><div class="ex-top"><span class="ex-name"><span class="tag">${esc(ex.label || "")}</span>${esc(ex.name)}</span><span class="ex-target">${ex.sets}×${esc(ex.reps)}${ex.type === "time" ? " с" : ""}${ex.perSide ? "/бік" : ""}${ex.load ? " · " + esc(ex.load) : ""}${ex.rir ? " · запас " + esc(ex.rir) : ""}</span></div>
      <div class="ex-meta">${ex.cue ? `<span>${esc(ex.cue)}</span>` : ""}${prev ? `<span>Минулого разу (${fmtDay(prev.date)}): <span class="num">${esc(describe(prev, ex.type))}</span></span>` : `<span>${esc(ex.firstTime || FIRST[ex.type] || "Перший раз: підбери вагу, з якою лишається запас повторів.")}</span>`}${hint ? `<span class="prog">${esc(hint)}</span>` : ""}</div></div>`;
  }
  const rounds = Math.max(...exs.map(e => e.sets)), rest = Math.max(...exs.map(e => e.rest || 0));
  h += `<div class="rounds">`;
  for (let i = 0; i < rounds; i++) {
    const inRound = exs.filter(e => i < e.sets), done = inRound.every(e => L.sets[e.key][i]?.done);
    h += `<div class="round${done ? " is-done" : ""}"><span class="n">${i + 1}</span><div class="rrows">${inRound.map(ex => {
      const st = L.sets[ex.key][i], id = `${s.id}-${ex.key}`, unit = UNIT[ex.type] ?? "кг", ru = REPS_UNIT[ex.type] || "повт";
      return `<div class="rset"><span class="tag">${esc(ex.label)}</span>${ex.type === "time" ? `<span class="muted" style="font-size:13px">${ex.perSide ? "кожен бік" : ""}</span>` : `<label class="field"><input id="w-${esc(id)}-${i}" inputmode="decimal" data-s="${esc(s.id)}" data-k="${esc(ex.key)}" data-i="${i}" data-f="w" value="${esc(st.w)}" placeholder="${ex.type === "bw" ? "0" : "—"}" aria-label="${esc(ex.name)}, раунд ${i + 1}, вага"><span>${unit}</span></label>`}<span class="x">${ex.type === "time" ? "" : "×"}</span><label class="field"><input id="r-${esc(id)}-${i}" inputmode="numeric" data-s="${esc(s.id)}" data-k="${esc(ex.key)}" data-i="${i}" data-f="r" value="${esc(st.r)}" aria-label="${esc(ex.name)}, раунд ${i + 1}, ${ex.type === "time" ? "секунди" : "повтори"}"><span>${ru}</span></label></div>`;
    }).join("")}</div><button type="button" class="check round-check" aria-pressed="${done}" data-s="${esc(s.id)}" data-keys="${esc(inRound.map(e => e.key).join(","))}" data-i="${i}" data-rest="${rest}" aria-label="Раунд ${i + 1} суперсету виконано">✓</button></div>`;
  }
  return h + `</div></div>`;
}
// ---------- interactions ----------
let inputTimer = null;
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.f) { logs[t.dataset.s].sets[t.dataset.k][+t.dataset.i][t.dataset.f] = t.value.replace(",", "."); clearTimeout(inputTimer); inputTimer = setTimeout(() => changed(t.dataset.s), 500); }
  else if (t.dataset.note) { logs[t.dataset.note].note = t.value; clearTimeout(inputTimer); inputTimer = setTimeout(() => changed(t.dataset.note), 800); }
});
document.addEventListener("click", e => {
  const day = e.target.closest("button.day");
  if (day) { selected = day.dataset.s; render(); $("sessionWrap").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); return; }
  const rc = e.target.closest(".round-check");
  if (rc) { const sets = rc.dataset.keys.split(",").map(k => logs[rc.dataset.s].sets[k][+rc.dataset.i]); const v = !sets.every(x => x.done); sets.forEach(x => x.done = v); changed(rc.dataset.s); renderSession(); renderSchedule(); renderHistory(); if (v && +rc.dataset.rest) startTimer(+rc.dataset.rest); return; }
  const chk = e.target.closest(".check");
  if (chk) { const st = logs[chk.dataset.s].sets[chk.dataset.k][+chk.dataset.i]; st.done = !st.done; changed(chk.dataset.s); renderSession(); renderSchedule(); renderHistory(); if (st.done && +chk.dataset.rest) startTimer(+chk.dataset.rest); return; }
  const rpe = e.target.closest("[data-rpe]");
  if (rpe) { const L = logs[selected]; const v = +rpe.dataset.rpe; L.rpe = L.rpe === v ? null : v; changed(selected); renderSession(); return; }
  const fin = e.target.closest("[data-finish]");
  if (fin) { const L = logs[selected]; L.status = fin.dataset.finish || null; if (L.status === "done") L.finishedAt = new Date().toISOString(); changed(selected); queuePush(0); render(); }
});

// ---------- rest timer ----------
let tEnd = 0, tInt = null;
function startTimer(sec) { tEnd = Date.now() + sec * 1000; $("timer").hidden = false; tick(); clearInterval(tInt); tInt = setInterval(tick, 250); }
function tick() {
  const left = Math.round((tEnd - Date.now()) / 1000), go = left <= 0;
  if (go) { if (!$("timer").classList.contains("over")) { $("tLeft").innerHTML = `<span class="go"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>Працюєм!!!</span>`; try { navigator.vibrate?.([200, 100, 200]); } catch { } } }
  else $("tLeft").textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
  $("timer").classList.toggle("over", go);
}
$("tPlus").onclick = () => { tEnd += 30000; tick(); };
$("tStop").onclick = () => { clearInterval(tInt); $("timer").hidden = true; };

// ---------- boot ----------
function pickDefault() {
  const list = Object.values(sessions).sort((a, b) => a.date < b.date ? -1 : 1);
  return (list.find(s => s.date >= todayISO && !logs[s.id]?.status) || list.find(s => !logs[s.id]?.status) || list.at(-1))?.id || null;
}
(async () => {
  await AUTH.ready;
  renderSync();
  [planned, events] = await Promise.all([WK.loadPlanned(), fetch(`data/events.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null).catch(() => null)]);
  plan = true;
  for (const w of planned.workouts) if (w.sport === "strength") sessions[w.id] = WK.session(w);
  if (!Object.keys(sessions).length) { $("status").innerHTML = `Силових у плані немає. <a href="planner.html">Запланувати в Планері</a>.`; }
  const cached = lsGet(LS.cache, null);
  mergeRemote(cached || { logs: {} });
  const want = new URLSearchParams(location.search).get("s");
  selected = want && sessions[want] ? want : pickDefault(); render();
  const remote = await loadRemote();
  if (remote) { lsSet(LS.cache, remote); mergeRemote(remote); }
  if (!selected || !sessions[selected]) selected = want && sessions[want] ? want : pickDefault();
  const a = document.activeElement;
  if (!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"))) render();
  if (Object.keys(pending).length) queuePush(0);
})();
