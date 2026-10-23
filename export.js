"use strict";
// Експорт стану й аналітики в текст для ШІ, правила формату силових для промпту і імпорт відповіді ШІ.
window.WKX = (() => {
  const DEFAULT_CONTEXT = `Атлет: Назар, 23 роки, чоловік, Львів.
Спорт: БЖЖ (фіолетовий пояс) — основний; велосипед на станку Wahoo KICKR CORE (Scott Foil); силові вдома.
Мета: форма як під велогонку, сила й витривалість для БЖЖ.
Інвентар удома: турнік, одна штанга з млинцями (міняти вагу незручно — групуй вправи з однією вагою), жимова лавка, гирі. Пояса для обтяження немає.
Ритм: тижні чергуються — тиждень зі станком (вело 2–3 рази, силове 1 раз) і тиждень залу (силове 2 рази). БЖЖ — пн, ср, пт увечері.
Без тренувань на вулиці.`;

  const RULES = ctx => `Ти — тренер, який складає силові тренування для сайту «Форма Назара». Сайт сам будує інтерфейс і журнал із тексту, тому відповідай СТРОГО у форматі нижче, без пояснень усередині блоків.

ФОРМАТ ВІДПОВІДІ
Кожне тренування — окремий блок:
=== 2026-11-10 | Сила А ===
<текст тренування>
=== кінець ===
Дата у форматі РРРР-ММ-ДД, після «|» — коротка назва. Пояснення (якщо потрібні) пиши ПІСЛЯ всіх блоків.

ТЕКСТ ТРЕНУВАННЯ
1. Перший рядок: «Мета: …» — одне речення.
2. Рядок без «-» — заголовок блоку: «Розминка 8–10 хв», «A», «B», «Суперсет», «Коло 3x відп 1хв», «Заминка».
3. Рядок з «- » — вправа: «- Назва NxR @вага відп час RIR n // підказка».
   - NxR: підходи × повтори: 4x6, 3x8-12, 3xmax; на час 3x40с або 2x1хв; на кожен бік — /бік одразу після повторів: 3x8/бік.
   - @: @штанга, @60кг, @гиря, @24кг, @вага тіла, @+10кг.
   - відп: відп 90с, відп 2хв, відп 2:30 — вказуй завжди.
   - RIR 1-3 — запас повторів для основних вправ.
   - // підказка техніки — коротко, одне речення. «// Перший раз: …» — порада, як підібрати вагу.
   - #сила #гіпертрофія #витривалість #потужність #кор — лише якщо автоматика (нижче) помилиться.
4. У розминці й заминці пункти можна писати вільно: «- Гоблет-присід — 2x8».
5. Вправи одного блоку виконуються по черзі (суперсет). У блоці «Коло Nx» пиши лише повтори: «- Віджимання 15».

ПРАВИЛА
- Без markdown, нумерації, жирного, таблиць і емодзі всередині блоків.
- Назви вправ українською і однаково між тренуваннями: за назвою сайт показує «минулого разу» і прогрес. Бери назви з силового журналу в експорті, якщо вправа там є.
- Ефект сайт рахує сам: до 6 повторів — Сила, 7–12 — Гіпертрофія, 13+ або на час — Силова витривалість; махи, стрибки, поштовхи — Потужність; планки, турецький підйом, прес, перенесення — Кор і стабільність. 100 = 10 підходів сили / 12 гіпертрофії / 10 витривалості / 8 потужності / 8 кору.
- Тривалість сайт рахує сам: ~4 с на повтор + відпочинок + 45 с на перехід. Тримай силове в межах 45–60 хв, якщо не сказано інше.
- Враховуй стан відновлення, навантаження і розклад з експорту: не став важке силове перед ключовим вело-тренуванням або в день після нього.

КОНТЕКСТ АТЛЕТА
${ctx || DEFAULT_CONTEXT}

ПРИКЛАД
=== 2026-11-10 | Сила А ===
Мета: Присід і тяга, плечі й кор для БЖЖ.

Розминка 8–10 хв
- Гоблет-присід з паузою — 2x8
- Скапулярні підтягування — 2x8

A
- Присід зі штангою 4x5 @штанга відп 2хв RIR 2 // Коліна за носками
- Підтягування 4x5-8 @вага тіла відп 2хв RIR 1-2

B
- Жим лежачи 3x8 @штанга відп 90с RIR 2
- Болгарські випади 3x8/бік @гиря відп 90с

Коло 2x відп 1хв
- Махи гирею 15 @24кг
- Бічна планка 30с/бік
=== кінець ===`;

  // відповідь ШІ → [{date, title, text}]
  function parseAnswer(txt) {
    const out = [];
    const rx = /===\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*===\s*\n([\s\S]*?)\n\s*===\s*кінець\s*===/gi;
    let m; while ((m = rx.exec(txt))) out.push({ date: m[1], title: m[2].trim(), text: m[3].replace(/^```\w*\n?|```$/g, "").trim() });
    return out;
  }

  // ---------- експорт ----------
  const f = (v, n = 0) => v == null || isNaN(v) ? "—" : (+v).toFixed(n).replace(".", ",");
  const hm = s => { if (!s) return "—"; const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
  const rows = o => o ? o.rows.map(r => Object.fromEntries(o.cols.map((c, i) => [c, r[i]]))) : [];
  const isBjj = a => a.type === "BJJ" || /mixed martial|бжж|bjj|jiu/i.test(a.name || "") && a.moving >= 1800 && ((+a.date.slice(11, 13) >= 17 && +a.date.slice(11, 13) <= 21) || (a.avgHr ?? 100) >= 100);
  const sportOf = a => /Ride$|Cyclocross/.test(a.type || "") ? "Вело" : isBjj(a) ? "БЖЖ" : /mixed martial/i.test(a.name || "") ? "Інше (ходьба/легка активність)" : a.type === "Strength" || a.type === "WeightTraining" || /strength|силов/i.test(a.name || "") ? "Силове" : a.type || "Інше";

  function build({ W, A, P, G, JL, PD, EV, days, ctx, withRules }) {
    const t = WK.today(), from = WK.addDays(t, -days + 1);
    const L = [];
    L.push(`ЕКСПОРТ ТРЕНУВАЛЬНОГО СТАНУ — ${t}, період ${days} днів (${from} … ${t})`);
    L.push("Джерела: intervals.icu (навантаження, потужність, wellness), Garmin (HRV, сон, стрес, Body Battery), силовий журнал сайту.");
    L.push("", "== КОНТЕКСТ АТЛЕТА ==", ctx || DEFAULT_CONTEXT);

    const z = P?.zones || {};
    L.push("", "== ПРОФІЛЬ ==");
    L.push(`FTP ${z.ftp ?? "—"} Вт${P?.eftp ? ` (eFTP ${P.eftp.raw} Вт, перцентиль у групі ${P.rankGroup} ${f(P.eftp.pct, 1)}%)` : ""}; вага ${f(P?.weight, 1)} кг; ${z.ftp && P?.weight ? f(z.ftp / P.weight, 2) + " Вт/кг" : ""}`);
    L.push(`LTHR ${z.lthr ?? "—"}, макс. пульс ${z.maxHr ?? "—"}, пульс спокою ${z.rhr ?? "—"}. Зони потужності (верхні межі, % FTP): ${(z.power || []).slice(0, 6).join(" / ")}. Пульсові зони (верхні межі): ${(z.hr || []).join(" / ")}.`);
    if (P?.curve) L.push("Криві потужності за 42 дні (Вт): " + P.curve.filter(c => [5, 60, 300, 1200, 3600].includes(c[0])).map(c => `${c[0] >= 60 ? c[0] / 60 + " хв" : c[0] + " с"} ${c[1]}`).join(", "));
    if (G?.fitnessAge) L.push(`Фітнес-вік Garmin ${G.fitnessAge.fitness} (паспортний ${G.fitnessAge.chrono}).`);

    const wl = rows(W).filter(r => r.date >= WK.addDays(t, -60));
    const last = wl.filter(r => r.ctl != null).at(-1) || {};
    const gd = rows({ cols: G?.dailyCols || [], rows: G?.daily || [] });
    const gToday = G?.today || {};
    const hw = G?.hrvWeek?.at(-1);
    L.push("", "== СТАН СЬОГОДНІ ==");
    L.push(`Фітнес CTL ${f(last.ctl, 1)}, втома ATL ${f(last.atl, 1)}, форма TSB ${f(last.ctl - last.atl, 1)}, ramp ${f(last.ramp, 1)}/тиждень.`);
    if (hw) L.push(`HRV минулої ночі ${hw[2]} мс, середнє 7 днів ${hw[1] ?? "—"} мс, статус ${hw[4]}; норма Garmin ${G.hrvBaseline?.balLow}–${G.hrvBaseline?.balUp} мс.`);
    const sn = G?.sleepNight;
    if (sn) L.push(`Сон минулої ночі: оцінка ${sn.score ?? "—"}${sn.feedback ? ` (${sn.feedback})` : ""}.`);
    L.push(`Пульс спокою ${gToday.rhr ?? last.rhr ?? "—"}, Body Battery зараз ${gToday.bbNow ?? "—"} (макс. ${gToday.bbHigh ?? "—"}), стрес ${gToday.stress ?? "—"}.`);
    if (G?.loadBalance28) { const b = G.loadBalance28, s = (b.low || 0) + (b.high || 0) + (b.anaerobic || 0); if (s) L.push(`Баланс навантаження Garmin за 28 днів: легке аеробне ${Math.round(b.low / s * 100)}%, інтенсивне аеробне ${Math.round(b.high / s * 100)}%, анаеробне ${Math.round(b.anaerobic / s * 100)}% (орієнтир 25–55 / 30–60 / 5–25).`); }

    L.push("", "== ДЕНЬ ЗА ДНЕМ ==", "дата | CTL | ATL | TSB | навант. | HRV | пульс спок. | сон год | оцінка сну | стрес | BB макс");
    const gBy = Object.fromEntries(gd.map(r => [r.date, r]));
    for (const r of wl.filter(r => r.date >= from)) {
      const g = gBy[r.date] || {};
      L.push([r.date, f(r.ctl, 1), f(r.atl, 1), f(r.ctl - r.atl, 1), f(r.load), r.hrv ?? "—", r.rhr ?? g.rhr ?? "—", r.sleepSecs ? f(r.sleepSecs / 3600, 1) : "—", r.sleepScore ?? "—", g.stress ?? "—", g.bbHigh ?? "—"].join(" | "));
    }

    const acts = rows(A).filter(a => a.date.slice(0, 10) >= from && (a.moving || 0) >= 300).sort((a, b) => a.date < b.date ? -1 : 1);
    L.push("", "== ТИЖНІ ==");
    for (let w = WK.monday(from); w <= t; w = WK.addDays(w, 7)) {
      const we = WK.addDays(w, 6), wa = acts.filter(a => a.date.slice(0, 10) >= w && a.date.slice(0, 10) <= we);
      const by = {}; wa.forEach(a => { const s = sportOf(a); by[s] = by[s] || [0, 0]; by[s][0]++; by[s][1] += a.moving; });
      L.push(`${w} … ${we}: ${wa.length} тренувань, ${hm(wa.reduce((s, a) => s + a.moving, 0))} год, навантаження ${Math.round(wa.reduce((s, a) => s + (a.load || 0), 0))}. ${Object.entries(by).map(([k, v]) => `${k} ${v[0]}× ${hm(v[1])}`).join(", ")}`);
    }

    L.push("", "== ТРЕНУВАННЯ ==", "дата час | вид | назва | тривалість | навант. | пульс сер/макс | потужн. сер/NP | IF | decoupling");
    for (const a of acts) L.push([a.date.replace("T", " "), sportOf(a), a.name || "", hm(a.moving), a.load ?? "—", `${a.avgHr ?? "—"}/${a.maxHr ?? "—"}`, a.avgW ? `${a.avgW}/${a.np ?? "—"} Вт` : "—", a.intensity ? f(a.intensity) + "%" : "—", a.decoupling != null ? f(a.decoupling, 1) + "%" : "—"].join(" | "));

    const sess = Object.fromEntries((PD?.workouts || []).filter(w => w.sport === "strength").map(w => [w.id, WK.session(w)]));
    const logs = JL?.logs || {};
    const done = Object.entries(logs).filter(([id]) => sess[id] && sess[id].date >= WK.addDays(t, -Math.max(days, 42))).sort((a, b) => sess[a[0]].date < sess[b[0]].date ? -1 : 1);
    L.push("", "== СИЛОВИЙ ЖУРНАЛ ==");
    if (!done.length) L.push("Записів немає.");
    for (const [id, lg] of done) {
      const s = sess[id];
      L.push(`${s.date} ${s.title} — ${lg.status === "done" ? "виконано" : lg.status === "skipped" ? "пропущено" : "не завершено"}${lg.rpe ? `, RPE ${lg.rpe}` : ""}${lg.note ? `. Нотатка: ${lg.note}` : ""}`);
      for (const ex of s.exercises) {
        const st = (lg.sets?.[ex.key] || []).filter(x => x.done);
        if (st.length) L.push(`  ${ex.name} (план ${ex.sets}×${ex.reps}${ex.type === "time" ? " с" : ""}${ex.perSide ? "/бік" : ""}): ${st.map(x => (x.w && +x.w ? x.w + "кг×" : "") + x.r).join(", ")}`);
      }
    }

    L.push("", "== ЗАПЛАНОВАНО (14 днів) ==");
    const its = WK.items(PD, EV, t, WK.addDays(t, 13));
    if (!its.length) L.push("Нічого.");
    for (const it of its) L.push(`${it.date}${it.time ? " " + it.time : ""} | ${(WK.SPORT[it.sport] || WK.SPORT.other)[0]} | ${it.title} | ${WK.fmtMin(it.mins) || "—"}${it.fx?.main ? " | ефект: " + Object.entries(it.fx.scores).map(([k, v]) => `${WK.FX[k].name} ${v}`).join(", ") : ""}`);

    if (withRules) L.push("", "== ПРАВИЛА ФОРМАТУ СИЛОВИХ ДЛЯ ВІДПОВІДІ ==", RULES(ctx));
    return L.join("\n");
  }

  return { RULES, DEFAULT_CONTEXT, parseAnswer, build };
})();
