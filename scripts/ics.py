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


def event(e):
    lines = ["BEGIN:VEVENT", f"UID:{e['uid']}@forma-nazara", f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"]
    if e.get("start"):
        f = lambda x: datetime.fromisoformat(x).astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")
        lines += [f"DTSTART:{f(e['start'])}", f"DTEND:{f(e['end'])}"]
    else:
        d = date.fromisoformat(e["date"])
        lines += [f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}", "TRANSP:TRANSPARENT"]
    lines += [f"SUMMARY:{esc(e['title'])}", f"DESCRIPTION:{esc(e['desc'])}", "END:VEVENT"]
    return [fold(x) for x in lines]


def main():
    """Публічний календар — лише план, без виконаних тренувань і ватів (вони йдуть тільки в приватний Google Calendar)."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from plan_events import build_events
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Forma Nazara//UK", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
           "X-WR-CALNAME:Тренування · Форма (план)", "X-WR-TIMEZONE:Europe/Kyiv", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    evs = build_events(acts=None, ftp=None)
    for e in evs:
        out += event(e)
    out.append("END:VCALENDAR")
    (ROOT / "data/calendar.ics").write_text("\r\n".join(out) + "\r\n", encoding="utf-8")
    print("calendar.ics:", len(evs), "подій")


if __name__ == "__main__":
    main()
