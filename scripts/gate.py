"""Чи потрібен збір даних зараз. Пише run=true|false і slot=… у $GITHUB_OUTPUT.

Слоти за Києвом:
  evening (23:00–09:59) — один успішний збір після кожних 23:00;
  morning (10:00–11:59) — одна спроба після 10:00;
  retry   (12:00–22:59) — одна повторна спроба, лише якщо ранкова не принесла дані
                           (не вдалась або браслет ще не синхронізував сон за сьогодні).
GitHub часто запускає розклад із затримкою, тому тригерів більше, ніж слотів:
зайві запуски цей скрипт пропускає.
"""
import json
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

tz = ZoneInfo("Europe/Kyiv")
now = datetime.now(tz)
today = now.replace(hour=0, minute=0, second=0, microsecond=0)
t10, t12, t23 = today.replace(hour=10), today.replace(hour=12), today.replace(hour=23)
if now < t23:
    last23 = t23 - timedelta(days=1)
else:
    last23 = t23

try:
    hist = json.load(open("data/status.json", encoding="utf-8")).get("history", [])
except Exception:
    hist = []
H = []
for h in hist:
    try:
        H.append({**h, "_at": datetime.fromisoformat(h["at"])})
    except Exception:
        pass

if os.environ.get("EVENT") == "workflow_dispatch":
    slot, run = "manual", True
elif now >= t23 or now < t10:
    slot = "evening"
    run = not any(h["_at"] >= last23 and h.get("intervals") for h in H)
elif now < t12:
    slot = "morning"
    run = not any(h["_at"] >= t10 for h in H)
else:
    slot = "retry"
    morning_ok = any(h["_at"] >= t10 and h.get("intervals") and h.get("sleepToday") for h in H)
    retried = any(h["_at"] >= t12 for h in H)
    run = not morning_ok and not retried

print(f"run={'true' if run else 'false'}")
print(f"slot={slot}")
print(f"Зараз {now:%d.%m %H:%M}, слот {slot}, запуск: {run}", file=sys.stderr)
