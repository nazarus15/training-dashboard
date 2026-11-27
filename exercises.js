"use strict";
// Словник вправ: одна канонічна назва на рух, синоніми, категорія і м'язи.
// За ним сайт зводить різні написання однієї вправи («Бічна планка» = «Бокова планка»): «минулого разу» в журналі,
// рекорди, прогрес і об'єм на групу м'язів. Нова вправа без запису тут теж працює — лише з категорією за назвою
// і без м'язів; Планер підкаже, що її немає в словнику.
//
// Поля: id — незмінний ключ; name — канонічна назва; rx — синоніми (регулярний вираз за назвою, малими літерами);
// cat — категорія для рекордів; fx — ефект за замовчуванням (core / pow), якщо не задано — за повторами;
// m — м'язи: основні [1 підхід = 1], допоміжні [1 підхід = 0,5]; кількість снарядів (2 гирі) береться з навантаження «@2x24кг».
window.EX = (() => {
  const MUSCLES = {
    quads: "Квадрицепс", glutes: "Сідниці", hams: "Задня поверхня стегна", chest: "Груди", back: "Спина",
    shoulders: "Плечі", triceps: "Трицепс", biceps: "Біцепс", core: "Кор", grip: "Хват і передпліччя",
  };
  const CATS = [
    ["legs", "Ноги"], ["hinge", "Задня ланка"], ["push", "Жими"], ["pull", "Тяги і підтягування"],
    ["arms", "Руки"], ["power", "Вибухові"], ["core", "Кор і стабільність"], ["carry", "Перенесення і хват"], ["other", "Інше"],
  ];
  // Порядок важливий: специфічніші варіанти — вище за загальні.
  const LIST = [
    // ноги
    { id: "squat_bb", name: "Присід зі штангою", rx: /присід.{0,6}(штанг|гриф)|back squat|front squat|фронтальн.{0,4}присід/, cat: "legs", m: [["quads", "glutes"], ["hams", "core"]] },
    { id: "goblet_squat", name: "Гоблет-присід", rx: /гоблет|goblet/, cat: "legs", m: [["quads", "glutes"], ["core"]] },
    { id: "bulgarian", name: "Болгарський присід з гирями", rx: /болгарськ/, cat: "legs", m: [["quads", "glutes"], ["hams"]] },
    { id: "lunge", name: "Випади", rx: /випад|lunge/, cat: "legs", m: [["quads", "glutes"], ["hams"]] },
    { id: "step_up", name: "Зашагування на лавку", rx: /зашагув|степ.?ап|step.?up/, cat: "legs", m: [["quads", "glutes"], []] },
    { id: "pistol", name: "Присід на одній нозі", rx: /пістолет|pistol|присід на одн/, cat: "legs", m: [["quads", "glutes"], ["core"]] },
    // задня ланка
    { id: "rdl", name: "Румунська тяга зі штангою", rx: /румунськ|\brdl\b/, cat: "hinge", m: [["hams", "glutes"], ["back", "grip"]] },
    { id: "deadlift", name: "Станова тяга", rx: /станов|deadlift/, cat: "hinge", m: [["glutes", "hams", "back"], ["quads", "grip"]] },
    { id: "hip_thrust", name: "Ягодичний міст", rx: /ягодичн.{0,4}міст|hip.?thrust|glute bridge|сідничн.{0,4}міст/, cat: "hinge", m: [["glutes"], ["hams"]] },
    { id: "good_morning", name: "Нахили зі штангою (good morning)", rx: /good ?morning|нахил.{0,8}штанг/, cat: "hinge", m: [["hams", "glutes"], ["back"]] },
    { id: "back_ext", name: "Гіперекстензія", rx: /гіперекст|hyperext/, cat: "hinge", m: [["glutes", "hams"], ["back"]] },
    // жими
    { id: "bench", name: "Жим лежачи", rx: /жим.{0,6}лежач|bench/, cat: "push", m: [["chest", "triceps"], ["shoulders"]] },
    { id: "kb_press", name: "Жим гирі стоячи однією рукою", rx: /жим.{0,8}гир/, cat: "push", m: [["shoulders", "triceps"], ["core"]] },
    { id: "ohp", name: "Жим штанги стоячи", rx: /жим.{0,8}штанг.{0,8}стоя|армійськ|overhead press|\bohp\b/, cat: "push", m: [["shoulders", "triceps"], ["core"]] },
    { id: "dips", name: "Віджимання на брусах або від лавки", rx: /брус|dips|віджиман.{0,6}від лавки/, cat: "push", m: [["chest", "triceps"], ["shoulders"]] },
    { id: "pushup_pause", name: "Віджимання з паузою внизу", rx: /віджиман.{0,6}з паузою/, cat: "push", m: [["chest", "triceps"], ["shoulders", "core"]] },
    { id: "pushup", name: "Віджимання", rx: /віджиман|push.?up/, cat: "push", m: [["chest", "triceps"], ["shoulders", "core"]] },
    // тяги
    { id: "scap_pullup", name: "Скапулярні підтягування", rx: /скапул/, cat: "pull", m: [["back"], ["grip"]] },
    { id: "chinup", name: "Підтягування зворотним хватом", rx: /підтягув.{0,12}зворотн|chin.?up/, cat: "pull", m: [["back", "biceps"], ["grip"]] },
    { id: "pullup_wide", name: "Підтягування широким хватом", rx: /підтягув.{0,12}широк/, cat: "pull", m: [["back"], ["biceps", "grip"]] },
    { id: "pullup", name: "Підтягування нейтральним або прямим хватом", rx: /підтягув|pull.?up/, cat: "pull", m: [["back", "biceps"], ["grip"]] },
    { id: "bb_row", name: "Тяга штанги в нахилі", rx: /тяга.{0,8}штанг.{0,8}нахил|barbell row|тяга пендлі/, cat: "pull", m: [["back"], ["biceps", "hams"]] },
    { id: "kb_row", name: "Тяга гирі в нахилі однією рукою", rx: /тяга.{0,8}(гир|гантел).{0,10}нахил/, cat: "pull", m: [["back"], ["biceps"]] },
    { id: "upright_row", name: "Тяга гирі до підборіддя (широко)", rx: /до підборідд|upright row/, cat: "pull", m: [["shoulders"], ["back"]] },
    { id: "face_pull", name: "Тяга до обличчя", rx: /face.?pull|тяга до обличч/, cat: "pull", m: [["shoulders", "back"], []] },
    // руки
    { id: "curl", name: "Згинання з гирею на біцепс", rx: /біцепс|згинан|curl/, cat: "arms", m: [["biceps"], ["grip"]] },
    { id: "triceps_ext", name: "Розгинання на трицепс", rx: /трицепс|розгинан.{0,10}рук/, cat: "arms", m: [["triceps"], []] },
    // вибухові
    { id: "kb_swing", name: "Махи гирею", rx: /мах.{0,4}гир|swing/, cat: "power", fx: "pow", m: [["glutes", "hams"], ["core", "grip"]] },
    { id: "kb_snatch", name: "Ривок гирі", rx: /ривок|snatch/, cat: "power", fx: "pow", m: [["glutes", "hams", "shoulders"], ["core", "grip"]] },
    { id: "kb_clean", name: "Підйом гирі на груди", rx: /поштовх|clean|на груди/, cat: "power", fx: "pow", m: [["glutes", "hams"], ["shoulders", "grip"]] },
    { id: "jump", name: "Стрибки", rx: /стриб|jump|плиометр/, cat: "power", fx: "pow", m: [["quads", "glutes"], []] },
    // кор
    { id: "tgu", name: "Турецький підйом з гирею", rx: /турецьк|get.?up/, cat: "core", fx: "core", m: [["core", "shoulders"], ["glutes"]] },
    { id: "side_plank", name: "Бокова планка", rx: /(бокова|бічна|бокову|бічну) планк|side plank/, cat: "core", fx: "core", m: [["core"], []] },
    { id: "plank", name: "Планка", rx: /планк|plank/, cat: "core", fx: "core", m: [["core"], []] },
    { id: "hollow", name: "Hollow body", rx: /hollow/, cat: "core", fx: "core", m: [["core"], []] },
    { id: "dead_bug", name: "Dead bug", rx: /dead ?bug/, cat: "core", fx: "core", m: [["core"], []] },
    { id: "pallof", name: "Паллоф-прес", rx: /паллоф|pallof/, cat: "core", fx: "core", m: [["core"], []] },
    { id: "leg_raise", name: "Підйом ніг у висі", rx: /підйом.{0,4}ніг|колін.{0,5}до/, cat: "core", fx: "core", m: [["core"], ["grip"]] },
    { id: "copenhagen", name: "Копенгагенська планка", rx: /копенгаген/, cat: "core", fx: "core", m: [["core"], []] },
    // перенесення і хват
    { id: "suitcase", name: "Перенесення гирі в одній руці (suitcase carry)", rx: /suitcase|в одній руці/, cat: "carry", fx: "core", m: [["core", "grip"], []] },
    { id: "farmer", name: "Фермерська хода", rx: /фермер|farmer|перенесення гир/, cat: "carry", fx: "core", m: [["grip", "core"], ["back"]] },
    { id: "hang", name: "Вис на турніку", rx: /вис на|dead ?hang/, cat: "carry", m: [["grip"], ["back"]] },
  ];
  const BY = Object.fromEntries(LIST.map(e => [e.id, e]));
  const norm = s => String(s || "").toLowerCase().replace(/[ʼ’']/g, "'").replace(/\s+/g, " ").trim();
  // запасна категорія для вправ поза словником (як було раніше в Рекордах)
  const CAT_RX = [["core", /планк|турецьк|прес|підйом.{0,4}ніг|паллоф|dead ?bug|hollow|скручув/], ["carry", /фермер|carry|перенес|вис /], ["power", /мах|ривок|поштовх|стриб|swing|jump|кидок/],
    ["legs", /присід|випад|болгар|степ|squat|lunge|ног/], ["hinge", /румунськ|станов|deadlift|гіперекст|міст|good ?morning/], ["push", /жим|віджим|бруси|press|push|dips/], ["pull", /підтяг|тяга|row|pull/]];
  const slug = s => norm(s).replace(/\(.*?\)/g, "").replace(/[^a-zа-яіїєґ0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ex";
  const cache = new Map();
  // назва з тексту тренування → запис словника (або «невідома» з категорією за назвою)
  function canon(name) {
    const n = norm(name);
    if (cache.has(n)) return cache.get(n);
    let e = LIST.find(x => x.rx.test(n));
    if (e) e = { ...e, known: true };
    else e = { id: "x:" + slug(n), name: String(name || "").trim(), cat: (CAT_RX.find(([, rx]) => rx.test(n)) || ["other"])[0], m: [[], []], known: false };
    cache.set(n, e);
    return e;
  }
  // кількість снарядів з навантаження: «2x24кг», «2×16 кг» → 2
  const implCount = load => { const m = String(load || "").match(/^\s*(\d)\s*[xх×]\s*\d/i); return m ? +m[1] : 1; };
  // підходи на групи м'язів: основні — 1, допоміжні — 0,5
  function muscleSets(cid, sets) {
    const e = BY[cid]; if (!e) return {};
    const out = {}; (e.m[0] || []).forEach(k => out[k] = (out[k] || 0) + sets); (e.m[1] || []).forEach(k => out[k] = (out[k] || 0) + sets * .5);
    return out;
  }
  // орієнтовний одноповторний максимум (формула Еплі); лише для 1–12 повторів, далі оцінка ненадійна
  const e1rm = (kg, reps) => !kg || !reps || reps > 12 ? null : reps === 1 ? kg : kg * (1 + reps / 30);
  return { LIST, BY, MUSCLES, CATS, canon, implements: implCount, muscleSets, e1rm, catName: id => (CATS.find(c => c[0] === id) || CATS.at(-1))[1] };
})();
