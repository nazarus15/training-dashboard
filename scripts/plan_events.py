"""Події календаря тренувань: план (intervals.icu + Планер) і, якщо передано активності, фактичне виконання.

build_events(acts=None, ftp=None) → список подій {uid, date, title, desc, start?, end?, color}.
  • acts — розшифровані активності {"cols","rows"}; передає лише fetch.py для приватної синхронізації
    з Google Calendar (Apps Script). Публічний data/calendar.ics будується без них — там тільки план.
  • ftp — для розгортання вело-тренувань у вати (лише приватно).
"""
import json, re, hashlib
from datetime import datetime, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import requests

ROOT = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("Europe/Kyiv")
RAW = "https://raw.githubusercontent.com/nazarus15/training-dashboard/journal/planned.json"
SITE = "https://nazarus15.github.io/training-dashboard/"
SPORT = {"bike": "Вело", "strength": "Силове", "bjj": "БЖЖ", "run": "Біг", "other": "Тренування"}
COLOR = {"bike": "9", "strength": "6", "bjj": "3", "run": "10", "other": "8"}  # кольори подій Google Calendar
today = datetime.now(TZ).date()
START, END = today - timedelta(days=30), today + timedelta(days=90)


# ---------- вело: розгортання кроків intervals.icu у зрозумілий план ----------
SEC_NAMES = {"warmup": "Розминка", "warm up": "Розминка", "main set": "Основна частина", "cooldown": "Заминка", "cool down": "Заминка"}


def _dur(tok: str) -> int:
    s = 0
    for n, u in re.findall(r"(\d+(?:\.\d+)?)\s*(h|m|s)", tok):
        s += float(n) * {"h": 3600, "m": 60, "s": 1}[u]
    return int(s)


def _fmt_dur(s: int) -> str:
    m, sec = divmod(s, 60)
    return f"{m} хв" + (f" {sec} с" if sec else "") if m else f"{sec} с"


def expand_bike(desc: str, ftp=None) -> str:
    """Перетворює текст тренування intervals.icu на план з ватами: «- 15m 88-91%» → «15 хв · 202–209 Вт (88–91%)»."""
    if not desc:
        return ""
    w = lambda p: f"{round(ftp * p / 100)}" if ftp else None
    out, intro, started = [], [], False
    for raw in desc.splitlines():
        ln = raw.strip()
        if not ln:
            continue
        step = re.match(r"^-\s*(\S+)\s+(ramp\s+)?(\d+)(?:\s*-\s*(\d+))?%", ln, re.I)
        if step:
            started = True
            dur, ramp, a, b = _dur(step.group(1)), step.group(2), int(step.group(3)), step.group(4) and int(step.group(4))
            if ramp and b:
                watts = f"плавно {w(a)}→{w(b)} Вт ({a}→{b}%)" if ftp else f"плавно {a}→{b}% FTP"
            elif b:
                watts = f"{w(a)}–{w(b)} Вт ({a}–{b}%)" if ftp else f"{a}–{b}% FTP"
            else:
                watts = f"{w(a)} Вт ({a}%)" if ftp else f"{a}% FTP"
            out.append(f"  • {_fmt_dur(dur)} · {watts}")
            continue
        head = re.match(r"^(.*?)(?:\s+(\d+)\s*[xх×])?\s*$", ln)
        name = head.group(1).strip()
        known = SEC_NAMES.get(name.lower())
        if known or head.group(2) or (started and len(ln) < 32):
            started = True
            out.append(f"{known or name}{' ×' + head.group(2) if head.group(2) else ''}")
        else:
            intro.append(ln)
    return "\n".join(intro + ([""] if intro and out else []) + out)


# ---------- силові: оцінка тривалості з тексту (як на сайті) ----------
def strength_minutes(text: str) -> int:
    m = re.search(r"^(тривалість|час)\s*:\s*(\d+)", text or "", re.I | re.M)
    if m:
        return int(m.group(2))
    secs, sec, sec_rest, rounds = 0, "work", None, None
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        low = s.lower()
        if not s.startswith("-"):
            if low.startswith("розминка"):
                sec = "warm"
                t = re.search(r"(\d+)(?:\s*[–-]\s*(\d+))?\s*хв", low)
                secs += int((t.group(2) or t.group(1)) if t else 8) * 60
            elif low.startswith("заминка"):
                sec = "cool"; secs += 300
            elif not low.startswith(("мета", "ціль")):
                sec = "work"
                r = re.search(r"відп\s*(\d+)\s*(с|хв)?", low)
                sec_rest = int(r.group(1)) * (60 if (r.group(2) or "").startswith("хв") else 1) if r else None
                rr = re.search(r"(\d+)\s*[xх×](?=\s|$)", low)
                rounds = int(rr.group(1)) if rr else None
            continue
        if sec != "work":
            continue
        sm = re.search(r"(\d+)\s*[xх×]\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(с|сек|s|хв|m)?", s, re.I)
        if sm:
            sets, reps, unit = int(sm.group(1)), int(sm.group(3) or sm.group(2)), (sm.group(4) or "").lower()
        else:
            r2 = re.search(r"\s(\d+)\s*(с|сек|хв)?(?:/бік)?(?:\s|$)", s)
            if not r2:
                continue
            sets, reps, unit = rounds or 2, int(r2.group(1)), (r2.group(2) or "")
        work = reps * 60 if unit in ("хв", "m") else reps if unit else reps * 4
        if "/бік" in s:
            work *= 2
        rm = re.search(r"відп\s*(\d+)\s*(с|хв)?", s, re.I)
        rest = int(rm.group(1)) * (60 if (rm.group(2) or "").startswith("хв") else 1) if rm else (sec_rest or 90)
        secs += sets * (work + rest) + 45
    return max(20, round(secs / 60 / 5) * 5)


def sport_of(a) -> str:
    typ, name = a.get("type") or "", a.get("name") or ""
    if re.search(r"Ride$|Cyclocross", typ): return "bike"
    if typ == "BJJ" or re.search(r"mixed martial|бжж|bjj|jiu", name, re.I): return "bjj"
    if typ in ("Strength", "WeightTraining") or re.search(r"strength|силов", name, re.I): return "strength"
    if re.search(r"Run", typ): return "run"
    return "other"


def _at(d: date, hm: str):
    h, m = map(int, hm.split(":")[:2])
    return datetime(d.year, d.month, d.day, h, m, tzinfo=TZ)


def build_events(acts=None, ftp=None, planned=None):
    ev = []
    A = []
    if acts:
        for r in acts.get("rows", []):
            a = dict(zip(acts["cols"], r))
            try:
                st = datetime.fromisoformat(a["date"]).replace(tzinfo=TZ)
            except Exception:
                continue
            if not (START <= st.date() <= END) or (a.get("moving") or 0) < 600:
                continue
            if any(x["_st"] == st and x.get("moving") == a.get("moving") for x in A):
                continue
            a["_st"], a["_sp"] = st, sport_of(a)
            A.append(a)
    used = set()

    def match(d, sport):
        for i, a in enumerate(A):
            if i not in used and a["_st"].date() == d and a["_sp"] == sport:
                used.add(i)
                return a
        return None

    def add(uid, d, sport, title, desc, start=None, end=None, done=None):
        e = {"uid": uid, "date": d.isoformat(), "title": title, "desc": desc, "color": COLOR.get(sport, "8")}
        if done:
            st, en = done["_st"], done["_st"] + timedelta(seconds=done.get("moving") or 3600)
            info = [f"Виконано: {st:%H:%M}–{en:%H:%M} ({round((done.get('moving') or 0) / 60)} хв)"]
            if done.get("load"): info.append(f"Навантаження {done['load']}")
            if done.get("avgHr"): info.append(f"Пульс середній {done['avgHr']}, макс. {done.get('maxHr') or '—'}")
            if done.get("np"): info.append(f"NP {done['np']} Вт")
            e.update(title="✓ " + title, desc="\n".join(info) + "\n\n" + desc, start=st.isoformat(), end=en.isoformat())
        elif start:
            e.update(start=start.isoformat(), end=(end or start + timedelta(hours=1)).isoformat())
        ev.append(e)

    taken = set()
    try:
        evs = json.loads((ROOT / "data/events.json").read_text(encoding="utf-8")).get("events", [])
    except Exception:
        evs = []
    for e in evs:
        if e.get("category") != "WORKOUT" or not e.get("date"):
            continue
        d = date.fromisoformat(e["date"])
        sport = "bike" if re.search(r"ride|cycl", e.get("type") or "", re.I) else "other"
        mins = e.get("mins")
        plan = expand_bike(e.get("desc"), ftp) if sport == "bike" else (e.get("desc") or "")
        desc = "\n".join(x for x in [f"План: {mins} хв" + (f" · навантаження {e['load']}" if e.get("load") else "") if mins else "", "", plan, "", SITE + "calendar.html"])
        uid = f"icu-{e.get('id') or hashlib.md5((e['date'] + (e.get('name') or '')).encode()).hexdigest()}"
        add(uid, d, sport, f"{SPORT[sport]} · {e.get('name') or ''}", desc, done=match(d, sport))
        taken.add((e["date"], sport))
    if planned is None:
        try:
            planned = requests.get(RAW, timeout=20).json()
        except Exception:
            planned = {"workouts": [], "recurring": []}
    for w in planned.get("workouts", []):
        d = date.fromisoformat(w["date"])
        if not (START <= d <= END):
            continue
        sp = w.get("sport") or "other"
        mins = w.get("mins") or (strength_minutes(w.get("text")) if sp == "strength" and w.get("text") else None)
        link = SITE + (f"strength.html?s={w['id']}" if sp == "strength" else "calendar.html")
        body = w.get("text") or ("Програми ще немає — додати: " + link if sp == "strength" else "")
        desc = "\n".join([f"Оціночний час: {mins} хв" if mins else "", "", body, "", link]).strip()
        title = f"{SPORT.get(sp, 'Тренування')} · {w.get('title') or SPORT.get(sp, '')}"
        start = _at(d, w["time"]) if w.get("time") else None
        add(w["id"], d, sp, title, desc, start, start + timedelta(minutes=mins or 60) if start else None, done=match(d, sp))
        taken.add((w["date"], sp))
    for r in planned.get("recurring", []):
        frm = max(START, date.fromisoformat(r.get("from") or START.isoformat()))
        until = date.fromisoformat(r["until"]) if r.get("until") else END
        d = frm
        while d <= min(until, END):
            if d.isoweekday() in r.get("days", []) and d.isoformat() not in (r.get("skip") or []) and (d.isoformat(), r["sport"]) not in taken:
                start = _at(d, r["time"]) if r.get("time") else None
                add(f"rec-{r['sport']}-{d.isoformat()}", d, r["sport"], SPORT.get(r["sport"], r.get("title") or "Тренування"),
                    f"План: {r.get('mins') or ''} хв\n\n{SITE}calendar.html", start, start + timedelta(minutes=r.get("mins") or 60) if start else None,
                    done=match(d, r["sport"]))
            d += timedelta(days=1)
    for i, a in enumerate(A):  # виконане поза планом
        if i in used or a["_sp"] not in ("bike", "bjj", "strength", "run"):
            continue
        add(f"act-{a.get('id') or a['date']}", a["_st"].date(), a["_sp"], f"{SPORT[a['_sp']]}" + (f" · {a['name']}" if a.get("name") and a["_sp"] != "bjj" else ""),
            "Поза планом\n\n" + (f"Додати програму тренування: {SITE}strength.html?add={a['_st']:%Y-%m-%d}&st={a['_st']:%H:%M}&en={(a['_st'] + timedelta(seconds=a.get('moving') or 0)):%H:%M}" if a["_sp"] == "strength" else SITE + "calendar.html"), done=a)
    return ev
