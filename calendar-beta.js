"use strict";
// Календар → вигляд «Місяць» (бета): сітка пн–нд на весь місяць, у кожному тижні підсумок план/факт,
// виконання і навантаження; клік по дню — деталі під сіткою. Увімкнення — перемикач «Тижні / Місяць β»,
// вибір зберігається на пристрої. Усе в цьому файлі: щоб прибрати бету, досить видалити файл і рядок <script>.
// Використовує глобальні PD, EV, JL, ACTS, FTP, SP, SP_BACK, actLine, fmtDur, dd з calendar.html.
window.CALB = (() => {
  const KEY = "td_cal_view";
  const on = () => { try { return localStorage.getItem(KEY) === "month"; } catch { return false; } };
  const set = v => { try { localStorage.setItem(KEY, v); } catch { } };
  const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  let openDay = null;

  const css = `
.cb-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr)) minmax(120px,.9fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden}
.cb-h{background:var(--panel);font-family:var(--f-data);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:6px 8px}
.cb-d{background:var(--panel);min-height:92px;padding:6px;display:flex;flex-direction:column;gap:3px;cursor:pointer;text-align:left;border:0;font:inherit;color:inherit;min-width:0}
.cb-d:hover{background:color-mix(in srgb,var(--accent) 5%,var(--panel))}
.cb-d:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.cb-d.out{background:color-mix(in srgb,var(--panel) 55%,var(--bg))}
.cb-d.out .cb-n{opacity:.45}
.cb-d.today{box-shadow:inset 0 0 0 2px var(--warn)}
.cb-d.sel{box-shadow:inset 0 0 0 2px var(--accent)}
.cb-n{font-family:var(--f-data);font-size:12px;font-weight:600}
.cb-i{display:flex;align-items:center;gap:4px;font-size:12px;line-height:1.25;min-width:0}
.cb-i i{flex:none;width:8px;height:8px;border-radius:2px;background:var(--kc)}
.cb-i span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cb-i.miss span{text-decoration:line-through;color:var(--muted)}
.cb-i.plan span{color:var(--muted)}
.cb-i b{flex:none;font-size:11px;margin-left:auto}
.cb-i.done b{color:var(--good)} .cb-i.miss b{color:var(--bad)}
.cb-w{background:var(--panel);padding:6px 8px;display:flex;flex-direction:column;gap:4px;font-size:12px}
.cb-w .bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.cb-w .bar i{display:block;height:100%;background:var(--good)}
.cb-w .muted{font-size:11px}
.cb-det{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px;display:flex;flex-direction:column;gap:10px}
.cb-det h3{font-size:18px;margin:0}
.cb-det .it.pday{display:block;padding:10px 0 0;border-top:1px solid var(--line);border-bottom:0}
.cb-det .it.pday:first-of-type{border-top:0;padding-top:0}
.cb-note{font-size:12px;color:var(--muted);margin:0}
.cb-view{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.cb-view button{border:0!important;border-radius:0!important;min-width:0!important}
.cb-view button[aria-pressed="true"]{background:var(--ink)!important;color:var(--panel)!important}
.cb-view sup{font-size:9px;margin-left:2px}
@media (max-width:820px){
  .cb-grid{grid-template-columns:repeat(7,minmax(0,1fr))}
  .cb-d{min-height:58px;padding:4px 3px;align-items:center}
  .cb-i span,.cb-i b{display:none}
  .cb-is{display:flex;flex-wrap:wrap;gap:3px;justify-content:center}
  .cb-i i{width:9px;height:9px;border-radius:50%}
  .cb-i.miss i{background:transparent;box-shadow:inset 0 0 0 1.5px var(--kc)}
  .cb-i.plan i{opacity:.45}
  .cb-w{grid-column:1/-1;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:5px 8px;background:color-mix(in srgb,var(--panel) 70%,var(--bg))}
  .cb-w .bar{flex:1 1 60px}
  .cb-hw{display:none}
}
@media (min-width:821px){.cb-is{display:flex;flex-direction:column;gap:3px;min-width:0}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  // перемикач вигляду поруч із навігацією місяця
  function mountToggle(rerender) {
    if (document.getElementById("cbView")) return;
    const nav = document.querySelector(".mbar .nav"); if (!nav) return;
    const box = document.createElement("div"); box.className = "cb-view"; box.id = "cbView"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Вигляд календаря");
    box.innerHTML = `<button type="button" data-v="weeks">Тижні</button><button type="button" data-v="month" title="Новий вигляд у тестовому режимі">Місяць<sup>β</sup></button>`;
    nav.after(box);
    const sync = () => box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.v === "month") === on()));
    box.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; set(b.dataset.v); sync(); rerender(); });
    sync();
  }

  // модель днів: заплановане (з відміткою виконано / пропущено / план) і виконане поза планом
  function model(from, to, t) {
    const its = WK.items(PD, EV, from, to), used = new Set(), days = {};
    for (let d = from; d <= to; d = WK.addDays(d, 1)) days[d] = [];
    for (const it of its) {
      const d = it.date; if (!days[d]) continue;
      const actual = ACTS.find(a => a.day === d && a.sport === (SP[it.sport] || "other") && !used.has(a));
      if (actual) used.add(actual);
      const jl = it.id ? JL?.logs?.[it.id] : null;
      const status = jl?.status === "skipped" ? "miss" : actual || jl?.status === "done" ? "done" : d < t ? "miss" : "plan";
      days[d].push({ kind: "plan", it, actual, jl, status, sport: it.sport, title: it.title, mins: it.mins, load: actual?.load ?? it.load });
    }
    for (const a of ACTS) {
      if (!days[a.day] || used.has(a) || a.moving < 600) continue;
      used.add(a);
      days[a.day].push({ kind: "extra", actual: a, status: "done", sport: SP_BACK[a.sport] || "other", title: WK.actName(a, (WK.SPORT[SP_BACK[a.sport]] || WK.SPORT.other)[0]), load: a.load });
    }
    return days;
  }

  function detailHtml(d, list, t) {
    const dt = dd(d), DOWL = ["неділя", "понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота"];
    const head = `<h3>${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, "0")}, ${DOWL[dt.getDay()]}</h3>`;
    if (!list.length) return head + `<p class="cb-note">${d < t ? "Відпочинок." : "Нічого не заплановано."} <a href="planner.html">+ Запланувати</a></p>`;
    return head + list.map(x => {
      const [sn, sc] = WK.SPORT[x.sport] || WK.SPORT.other, it = x.it;
      const pill = x.status === "done" ? `<span class="pill done">Виконано</span>` : x.status === "miss" ? `<span class="pill ${x.jl?.status === "skipped" ? "skip" : "off"}">Пропущено</span>` : d === t ? `<span class="pill today">Сьогодні</span>` : `<span class="pill plan">План</span>`;
      const afx = x.sport === "bike" && x.actual ? WK.actEffects(x.actual) : null;
      const ds = x.sport === "strength" && it?.sess ? WK.doneSession(it.sess, x.jl) : null;
      const fx = afx || (ds ? WK.strengthEffects(ds) : it?.fx);
      const main = fx?.main ? WK.FX[fx.main] : null;
      const link = x.sport === "strength" && it?.id ? `strength.html?s=${encodeURIComponent(it.id)}` : it?.src === "planner" ? `planner.html?edit=${encodeURIComponent(it.id)}` : "";
      const name = (x.sport === "bjj" && x.kind === "plan") || x.title === sn ? "" : `<strong>${link ? `<a href="${link}">${WK.esc(x.title)}</a>` : WK.esc(x.title)}</strong>`;
      const planLine = it ? [WK.fmtMin(it.mins), it.time, it.load ? `навант. intervals ${it.load}` : ""].filter(Boolean).join(" · ") : "";
      const steps = x.sport === "bike" && it?.ev?.desc ? WK.bikeStepsHtml(it.ev.desc, FTP) : "";
      return `<div class="it pday"><span class="t"><span class="kline"><span class="kk"><span class="k" style="--kc:${sc}">${sn}</span>${main ? `<span class="fxtag" style="--c:${main.color}">${main.name}</span>` : ""}${x.kind === "extra" ? `<span class="unpl">поза планом</span>` : ""}</span>${pill}</span>${name}${planLine ? `<small>${WK.esc(planLine)}</small>` : ""}${x.actual ? `<small class="act">${actLine(x.actual)}</small>` : ""}${WK.barsHtml(fx)}${steps}</span></div>`;
    }).join("");
  }

  function render(ctx) {
    const { first, last, t } = ctx;
    const from = WK.monday(first), to = WK.addDays(WK.monday(last), 6);
    const days = model(from, to, t);
    if (!openDay || openDay < from || openDay > to) openDay = t >= first && t <= last ? t : null;
    let planned = 0, done = 0, missed = 0, factS = 0;
    let html = `<div class="cb-grid" role="grid" aria-label="Місяць">${DOW.map(d => `<div class="cb-h">${d}</div>`).join("")}<div class="cb-h cb-hw">Тиждень</div>`;
    for (let w = from; w <= to; w = WK.addDays(w, 7)) {
      let wPlan = 0, wDone = 0, wPlanMin = 0, wFact = 0, wLoad = 0;
      for (let i = 0; i < 7; i++) {
        const d = WK.addDays(w, i), list = days[d], inM = d >= first && d <= last, dt = dd(d);
        for (const x of list) {
          if (x.kind === "plan") { wPlanMin += x.mins || 0; if (d <= t) { wPlan++; if (x.status === "done") wDone++; } if (inM && d <= t) { planned++; if (x.status === "done") done++; else missed++; } }
          if (x.actual) { wFact += x.actual.moving || 0; wLoad += x.actual.load || 0; if (inM) factS += x.actual.moving || 0; }
        }
        const lab = `${dt.getDate()} ${list.length ? list.map(x => `${(WK.SPORT[x.sport] || WK.SPORT.other)[0]} ${x.status === "done" ? "виконано" : x.status === "miss" ? "пропущено" : "план"}`).join(", ") : "без тренувань"}`;
        html += `<button type="button" class="cb-d${inM ? "" : " out"}${d === t ? " today" : ""}${d === openDay ? " sel" : ""}" data-day="${d}" aria-label="${WK.esc(lab)}"><span class="cb-n">${dt.getDate()}</span><span class="cb-is">${list.map(x => `<span class="cb-i ${x.status}" style="--kc:${(WK.SPORT[x.sport] || WK.SPORT.other)[1]}"><i></i><span>${WK.esc(x.sport === "bjj" ? "БЖЖ" : x.title)}</span><b>${x.status === "done" ? "✓" : x.status === "miss" ? "✕" : ""}</b></span>`).join("")}</span></button>`;
      }
      const pct = wPlan ? Math.round(wDone / wPlan * 100) : null;
      html += `<div class="cb-w"><span>факт <b>${wFact ? fmtDur(wFact) : "0"}</b>${wPlanMin ? ` · план ${WK.fmtMin(wPlanMin)}` : ""} год</span>${pct != null ? `<div class="bar" title="Виконано ${wDone} з ${wPlan}"><i style="width:${pct}%"></i></div><span class="muted">${wDone} з ${wPlan} виконано</span>` : ""}${wLoad ? `<span class="muted">навант. intervals ${Math.round(wLoad)}</span>` : ""}</div>`;
    }
    html += `</div><div class="cb-det" id="cbDet" aria-live="polite">${openDay ? detailHtml(openDay, days[openDay], t) : `<p class="cb-note">Натисни на день, щоб побачити деталі.</p>`}</div>
      <p class="cb-note">Вигляд «Місяць» у тестовому режимі. Повернути звичний — «Тижні» вгорі.</p>`;
    const cal = document.getElementById("cal");
    cal.classList.add("cb-on");
    cal.innerHTML = html;
    cal.onclick = e => {
      const b = e.target.closest(".cb-d"); if (!b) return;
      openDay = b.dataset.day;
      cal.querySelectorAll(".cb-d.sel").forEach(x => x.classList.remove("sel")); b.classList.add("sel");
      document.getElementById("cbDet").innerHTML = detailHtml(openDay, days[openDay], t);
      if (!matchMedia("(min-width:821px)").matches) document.getElementById("cbDet").scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    document.getElementById("mSum").textContent = `${planned ? `Виконано ${done} із ${planned} запланованих${missed ? `, пропущено ${missed}` : ""}. ` : ""}Тренувань за місяць: ${fmtDur(factS) || "0"} год.`;
  }
  return { on, render, mountToggle };
})();
