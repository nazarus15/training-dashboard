"""Формує data/calendar.ics — календар запланованих тренувань для підписки в Google Calendar.

Джерела: data/events.json (вело з intervals.icu) і planned.json з гілки journal (силові, БЖЖ, регулярні).
Google Calendar сам перечитує підписаний календар (зазвичай кілька разів на добу).
Тренування без часу — події на весь день; з часом — події з тривалістю за Києвом.
"""
import json, re, hashlib
from datetime import datetime, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import requests

ROOT = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("Europe/Kyiv")
RAW = "https://raw.githubusercontent.com/nazarus15/training-dashboard/journal/planned.json"
SPORT = {"bike": "Вело", "strength": "Силове", "bjj": "БЖЖ", "run": "Біг", "other": "Тренування"}
today = datetime.now(TZ).date()
START, END = today - timedelta(days=30), today + timedelta(days=90)


def esc(s: str) -> str:
    return (s or "").replace(chr(92), chr(92) * 2).replace(";", chr(92) + ";").replace(",", chr(92) + ",").replace("\r", "").replace("\n", chr(92) + "n")


def fold(line: str) -> str:
    # рядки ICS не довші за 75 байт
    out, cur = [], b""
    for ch in line:
        b = ch.encode()
        if len(cur) + len(b) > 73:
            out.append(cur.decode()); cur = b" " + b
        else:
            cur += b
    out.append(cur.decode())
    return "\r\n".join(out)


def strength_minutes(text: str) -> int:
    """Оцінка тривалості силового з тексту, як на сайті: ~4 с на повтор + відпочинок + 45 с на перехід."""
    m = re.search(r"^(тривалість|час)\s*:\s*(\d+)", text or "", re.I | re.M)
    if m:
        return int(m.group(2))
    secs, sec, sec_rest = 0, "work", None
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if not s.startswith("-"):
            low = s.lower()
            if low.startswith("розминка"):
                sec = "warm"; t = re.search(r"(\d+)(?:\s*[–-]\s*(\d+))?\s*хв", low); secs += int((t.group(2) or t.group(1)) if t else 8) * 60
            elif low.startswith("заминка"):
                sec = "cool"; secs += 300
            elif not low.startswith(("мета", "ціль")):
                sec = "work"; r = re.search(r"відп\s*(\d+)\s*(с|хв)?", low); sec_rest = int(r.group(1)) * (60 if (r.group(2) or "").startswith("хв") else 1) if r else None
                rounds = re.search(r"(\d+)\s*[xх×](?=\s|$)", low); sec_rounds = int(rounds.group(1)) if rounds else None
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
            sets, reps, unit = 2, int(r2.group(1)), (r2.group(2) or "")
        work = reps * 60 if unit in ("хв", "m") else reps if unit else reps * 4
        if "/бік" in s:
            work *= 2
        rm = re.search(r"відп\s*(\d+)\s*(с|хв)?", s, re.I)
        rest = int(rm.group(1)) * (60 if (rm.group(2) or "").startswith("хв") else 1) if rm else (sec_rest or 90)
        secs += sets * (work + rest) + 45
    return max(20, round(secs / 60 / 5) * 5)


def event(uid, d, title, desc, time=None, mins=None):
    lines = ["BEGIN:VEVENT", f"UID:{uid}@forma-nazara", f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"]
    if time:
        h, m = map(int, time.split(":")[:2])
        st = datetime(d.year, d.month, d.day, h, m, tzinfo=TZ)
        en = st + timedelta(minutes=mins or 60)
        f = lambda x: x.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")
        lines += [f"DTSTART:{f(st)}", f"DTEND:{f(en)}"]
    else:
        lines += [f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}", "TRANSP:TRANSPARENT"]
    lines += [f"SUMMARY:{esc(title)}", f"DESCRIPTION:{esc(desc)}", "END:VEVENT"]
    return [fold(x) for x in lines]


def main():
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Forma Nazara//UK", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
           "X-WR-CALNAME:Тренування · Форма", "X-WR-TIMEZONE:Europe/Kyiv", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    site = "https://nazarus15.github.io/training-dashboard/calendar.html"
    # вело та інше з intervals.icu
    try:
        evs = json.loads((ROOT / "data/events.json").read_text(encoding="utf-8")).get("events", [])
    except Exception:
        evs = []
    taken = set()
    for e in evs:
        if e.get("category") != "WORKOUT" or not e.get("date"):
            continue
        d = date.fromisoformat(e["date"])
        sport = "bike" if re.search(r"ride|cycl", e.get("type") or "", re.I) else "other"
        mins = e.get("mins")
        desc = "\n".join(x for x in [f"{mins} хв" if mins else "", f"Навантаження {e['load']}" if e.get("load") else "", "", e.get("desc") or "", "", site] if x is not None)
        out += event(f"icu-{e.get('id') or hashlib.md5((e['date'] + (e.get('name') or '')).encode()).hexdigest()}", d, f"{SPORT[sport]} · {e.get('name') or ''}", desc)
        taken.add((e["date"], sport))
    # Планер
    try:
        P = requests.get(RAW, timeout=20).json()
    except Exception:
        P = {"workouts": [], "recurring": []}
    for w in P.get("workouts", []):
        d = date.fromisoformat(w["date"])
        if not (START <= d <= END):
            continue
        sp = w.get("sport") or "other"
        mins = w.get("mins") or (strength_minutes(w.get("text")) if sp == "strength" else None)
        body = w.get("text") or ""
        desc = "\n".join([f"≈{mins} хв" if mins else "", "", body, "", f"https://nazarus15.github.io/training-dashboard/strength.html?s={w['id']}" if sp == "strength" else site])
        out += event(w["id"], d, f"{SPORT.get(sp, 'Тренування')} · {w.get('title') or SPORT.get(sp, '')}", desc, w.get("time"), mins)
        taken.add((w["date"], sp))
    for r in P.get("recurring", []):
        frm = max(START, date.fromisoformat(r.get("from") or START.isoformat()))
        until = date.fromisoformat(r["until"]) if r.get("until") else END
        d = frm
        while d <= min(until, END):
            if d.isoweekday() in r.get("days", []) and d.isoformat() not in (r.get("skip") or []) and (d.isoformat(), r["sport"]) not in taken:
                out += event(f"rec-{r['sport']}-{d.isoformat()}", d, SPORT.get(r["sport"], r.get("title") or "Тренування"), f"{r.get('mins') or ''} хв\n\n{site}".strip(), r.get("time"), r.get("mins"))
            d += timedelta(days=1)
    out.append("END:VCALENDAR")
    (ROOT / "data/calendar.ics").write_text("\r\n".join(out) + "\r\n", encoding="utf-8")
    print("calendar.ics:", sum(1 for x in out if x == "BEGIN:VEVENT"), "подій")


if __name__ == "__main__":
    main()
