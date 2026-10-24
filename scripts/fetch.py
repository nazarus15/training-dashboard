"""Щоденне оновлення даних дашборда.

Тягне дані з intervals.icu (офіційний API за особистим ключем) і з Garmin Connect
(офіційний Garmin Personal API). Кожне джерело і кожен запит Garmin
обробляються окремо: якщо щось падає, решта даних все одно оновлюється, а
помилка записується в data/status.json і показується на сайті.

Змінні середовища (GitHub Secrets):
  INTERVALS_API_KEY     обов'язково
  INTERVALS_ATHLETE_ID  необов'язково, за замовчуванням 0 (власник ключа)
  GARMIN_PERSONAL_API_KEY  ключ з connect.garmin.com/app/settings/personalApiToken
"""
from __future__ import annotations

import base64
import json
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

TZ = ZoneInfo("Europe/Kyiv")
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DAYS_BACK = 150
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

now_local = datetime.now(TZ)
today = now_local.date()
oldest = today - timedelta(days=DAYS_BACK)

status: dict = {
    "generatedAt": now_local.isoformat(timespec="minutes"),
    "intervals": {"ok": False, "error": None, "parts": {}},
    "garmin": {"ok": False, "error": None, "parts": {}, "dataDate": None},
}


# Особисті дані шифруються публічним ключем (pubkey.json): AES-256-GCM для вмісту, RSA-OAEP-SHA256 для ключа.
# Розшифрувати може лише сайт після введення пароля (приватний ключ лежить у keyring.json, зашифрований паролем).
ENCRYPT = {"wellness.json", "activities.json", "power.json", "garmin.json"}
_MEM: dict = {}


def _encrypt(raw: bytes) -> dict:
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    pub = serialization.load_der_public_key(base64.b64decode(json.loads((ROOT / "pubkey.json").read_text())["spki"]))
    k, iv = AESGCM.generate_key(bit_length=256), os.urandom(12)
    ek = pub.encrypt(k, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "k": b(ek), "iv": b(iv), "ct": b(AESGCM(k).encrypt(iv, raw, None))}


def write(name: str, obj) -> None:
    _MEM[name] = obj
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    if name in ENCRYPT:
        (DATA / name.replace(".json", ".enc")).write_text(json.dumps(_encrypt(raw.encode())), encoding="utf-8")
        (DATA / name).unlink(missing_ok=True)
    else:
        (DATA / name).write_text(raw, encoding="utf-8")


def read(name: str):
    if name in _MEM:
        return _MEM[name]
    p = DATA / name
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def short_err(e: Exception) -> str:
    msg = f"{type(e).__name__}: {e}"
    return msg[:300]



FTP_FLOOR = 231  # нижня межа для перцентиля eFTP за замовчуванням; змінюється в Налаштуваннях сайту (settings.json у гілці journal)
try:
    _s = requests.get("https://raw.githubusercontent.com/nazarus15/training-dashboard/journal/settings.json", timeout=15)
    if _s.ok and _s.json().get("ftpFloor"):
        FTP_FLOOR = int(_s.json()["ftpFloor"])
except Exception:
    pass


def zone_secs(z):
    """zoneTimes з workout_doc → {"Z1": сек, …, "SS": сек}."""
    out = {}
    for i, it in enumerate(z or []):
        if isinstance(it, dict):
            k = it.get("id") or it.get("name") or f"Z{i + 1}"
            out[str(k)] = it.get("secs") or 0
        elif isinstance(it, (int, float)):
            out["SS" if i == 6 else f"Z{i + 1}"] = it
    return out or None


def pct_at(perc, v):
    """Перцентиль значення v за таблицею значень на 0,5,...,100 перцентилях."""
    if v <= perc[0]:
        return 0.0
    for i in range(1, len(perc)):
        if v <= perc[i]:
            lo, hi = perc[i - 1], perc[i]
            return round(5 * (i - 1) + 5 * ((v - lo) / (hi - lo) if hi > lo else 0), 1)
    return 100.0


def value_at(perc, p):
    i = min(int(p // 5), len(perc) - 2)
    return perc[i] + (perc[i + 1] - perc[i]) * (p - 5 * i) / 5

# ---------------------------------------------------------------- intervals.icu
def intervals() -> None:
    key = os.environ.get("INTERVALS_API_KEY")
    if not key:
        status["intervals"]["error"] = "Не задано секрет INTERVALS_API_KEY"
        return
    aid = os.environ.get("INTERVALS_ATHLETE_ID") or "0"
    s = requests.Session()
    s.auth = ("API_KEY", key)
    s.headers["User-Agent"] = UA
    base = f"https://intervals.icu/api/v1/athlete/{aid}"

    def get(path, **params):
        r = s.get(base + path, params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    parts = status["intervals"]["parts"]
    ok_all = True

    # профіль і зони
    athlete = None
    try:
        athlete = get("")
        parts["athlete"] = "ok"
    except Exception as e:
        parts["athlete"] = short_err(e); ok_all = False

    # wellness
    try:
        w = get("/wellness", oldest=oldest.isoformat(), newest=today.isoformat())
        cols = ["date", "ctl", "atl", "ramp", "load", "hrv", "rhr", "sleepSecs", "sleepScore", "sleepQuality", "steps", "weight"]
        rows = []
        for r in sorted(w, key=lambda x: x["id"]):
            rnd = lambda v, n=1: None if v is None else round(v, n)
            rows.append([r["id"], rnd(r.get("ctl")), rnd(r.get("atl")), rnd(r.get("rampRate"), 2), r.get("ctlLoad"),
                         r.get("hrv"), r.get("restingHR"), r.get("sleepSecs"), r.get("sleepScore"), r.get("sleepQuality"),
                         r.get("steps"), r.get("weight")])
        write("wellness.json", {"cols": cols, "rows": rows})
        parts["wellness"] = f"ok ({len(rows)} днів)"
    except Exception as e:
        parts["wellness"] = short_err(e); ok_all = False

    # активності
    try:
        acts = get("/activities", oldest=oldest.isoformat(), newest=today.isoformat())
        cols = ["date", "type", "name", "moving", "distKm", "load", "avgHr", "maxHr", "trimp", "intensity", "hrZones", "avgW", "np", "pZones", "ef", "decoupling", "pmFtp", "cadence", "elev", "kcal", "hrr", "polarization", "trainer", "ftp", "vi", "kj", "strain", "powerHr", "wbalDep", "device"]
        r1 = lambda v: None if v is None else round(v, 1)
        rows = []
        for a in sorted(acts, key=lambda x: x.get("start_date_local") or ""):
            hrr = a.get("icu_hrr")
            rows.append([
                (a.get("start_date_local") or "")[:16], a.get("type"), a.get("name"), a.get("moving_time"),
                round(a["distance"] / 1000, 1) if a.get("distance") else None, a.get("icu_training_load"),
                a.get("average_heartrate"), a.get("max_heartrate"), round(a["trimp"]) if a.get("trimp") else None,
                round(a["icu_intensity"]) if a.get("icu_intensity") else None, a.get("icu_hr_zone_times"),
                a.get("icu_average_watts"), a.get("icu_weighted_avg_watts"),
                [z.get("secs") for z in a["icu_zone_times"]] if a.get("icu_zone_times") else None,
                r1(a.get("icu_efficiency_factor")), r1(a.get("decoupling")), a.get("icu_pm_ftp_watts"),
                round(a["average_cadence"]) if a.get("average_cadence") else None,
                round(a["total_elevation_gain"]) if a.get("total_elevation_gain") else None, a.get("calories"),
                hrr.get("hrr") if isinstance(hrr, dict) else None, r1(a.get("polarization_index")), a.get("trainer"),
                a.get("icu_ftp"), r1(a.get("icu_variability_index")),
                round(a["icu_joules"] / 1000) if a.get("icu_joules") else None, r1(a.get("strain_score")),
                round(a["icu_power_hr"], 2) if a.get("icu_power_hr") else None, a.get("icu_max_wbal_depletion"),
                a.get("device_name"),
            ])
        write("activities.json", {"cols": cols, "rows": rows})
        parts["activities"] = f"ok ({len(rows)} записів)"
    except Exception as e:
        parts["activities"] = short_err(e); ok_all = False

    # крива потужності + зони
    try:
        prev = read("power.json") or {}
        power = dict(prev)
        if athlete:
            ride = next((x for x in athlete.get("sportSettings", []) if "Ride" in (x.get("types") or [])), {})
            power["weight"] = athlete.get("icu_weight") or athlete.get("weight") or prev.get("weight")
            power["zones"] = {
                "ftp": ride.get("ftp"), "power": ride.get("power_zones"), "lthr": ride.get("lthr"),
                "maxHr": ride.get("max_hr"), "hr": ride.get("hr_zones"), "rhr": athlete.get("icu_resting_hr"),
            }
            dob = athlete.get("icu_date_of_birth")
            if dob:
                b = date.fromisoformat(dob)
                power["age"] = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
        pc = get("/power-curves", type="Ride", curves="42d", includeRanks="true", newest=today.isoformat() + "T23:59:59")
        c = (pc.get("list") or [None])[0]
        if c and c.get("secs"):
            want = [1, 5, 10, 15, 30, 60, 120, 180, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400]
            m = dict(zip(c["secs"], c["watts"]))
            power["curve"] = [[s_, m[s_]] for s_ in want if m.get(s_) is not None]
            power["range"] = f"{(c.get('start_date_local') or '')[:10]} — {(c.get('end_date_local') or '')[:10]} (42 дні)"
            power["models"] = [[p.get("type"), p.get("ftp"), p.get("wPrime"), p.get("pMax")] for p in (c.get("powerModels") or [])]
            ranks = c.get("ranks") or {}
            age = power.get("age")
            group = None
            if age is not None:
                for g, lo, hi in [("M Under 23", 0, 22), ("M 23-29", 23, 29), ("M 30-34", 30, 34), ("M 35-39", 35, 39), ("M 40-44", 40, 44), ("M 45-49", 45, 49)]:
                    if lo <= age <= hi:
                        group = g
            pick = ranks.get(group) or ranks.get("Male") or {}
            power["rankGroup"] = group if ranks.get(group) else "Male"
            power["rank"] = pick.get("position") or {}
        # eFTP: перцентиль від max(eFTP, FTP_FLOOR) за збереженою таблицею розподілу intervals.icu
        table = read("rankings_ride.json") or {}
        dist = (table.get("groups") or {}).get(power.get("rankGroup")) or (table.get("groups") or {}).get("Male")
        rk = power.get("rank") or {}
        if dist and rk.get("eFTP") is not None and power.get("weight"):
            w = power["weight"]
            raw_w = value_at(dist["eFTP_wkg"], rk["eFTP"]) * w
            used_w = max(raw_w, FTP_FLOOR)
            power["eftp"] = {"raw": round(raw_w), "used": round(used_w), "floored": raw_w < FTP_FLOOR, "rawPct": rk["eFTP"]}
            if raw_w < FTP_FLOOR:
                rk["eFTP"] = pct_at(dist["eFTP_wkg"], used_w / w)
            power["eftp"]["pct"] = rk["eFTP"]
            power["rank"] = rk
        write("power.json", power)
        parts["power"] = "ok"
    except Exception as e:
        parts["power"] = short_err(e); ok_all = False

    # заплановані тренування (календар intervals.icu): тиждень назад і 3 тижні вперед
    try:
        evs = get("/events", oldest=(today - timedelta(days=7)).isoformat(), newest=(today + timedelta(days=21)).isoformat())
        out = [{"date": (e.get("start_date_local") or "")[:10], "name": e.get("name"), "category": e.get("category"),
                "type": e.get("type"), "mins": round((e.get("moving_time") or 0) / 60) or None,
                "load": e.get("icu_training_load"), "if": round(e["icu_intensity"]) if e.get("icu_intensity") else None,
                "zones": zone_secs((e.get("workout_doc") or {}).get("zoneTimes"))} for e in evs if e.get("category") in ("WORKOUT", "NOTE", "RACE_A", "RACE_B", "RACE_C")]
        write("events.json", {"events": sorted(out, key=lambda x: x["date"])})
        parts["events"] = f"ok ({len(out)} подій)"
    except Exception as e:
        parts["events"] = short_err(e); ok_all = False

    status["intervals"]["ok"] = ok_all
    if not ok_all:
        status["intervals"]["error"] = "Частина запитів не вдалася, деталі нижче"


# ---------------------------------------------------------------- Garmin (офіційний Personal API)
GARMIN_BASE = "https://personal.connectapi.garmin.com"
GARMIN_TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token"
LOW_LABELS = {"RECOVERY", "AEROBIC_BASE", "BASE"}
HIGH_LABELS = {"TEMPO", "LACTATE_THRESHOLD", "THRESHOLD", "VO2MAX", "VO2_MAX"}
ANA_LABELS = {"ANAEROBIC_CAPACITY", "ANAEROBIC", "SPEED", "SPRINT"}


def to_local_hm(v) -> str | None:
    """Мітка часу (мс, або рядок GMT) → HH:MM за Києвом."""
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            dt = datetime.fromtimestamp(v / 1000, tz=timezone.utc)
        else:
            s = str(v).replace("Z", "").replace(" ", "T")[:19]
            dt = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        return dt.astimezone(TZ).strftime("%H:%M")
    except Exception:
        return None


def shape(o, depth=0):
    # depth до 3 рівнів
    """Лише назви полів і типи — для журналу запуску (публічного), без значень."""
    if depth > 3:
        return "…"
    if isinstance(o, list):
        return [f"list[{len(o)}]", shape(o[0], depth + 1) if o else None]
    if isinstance(o, dict):
        return {k: (shape(v, depth + 1) if isinstance(v, (dict, list)) else type(v).__name__) for k, v in list(o.items())[:60]}
    return type(o).__name__


def g(d, *keys, default=None):
    """Перше непорожнє поле з кількох можливих назв."""
    if not isinstance(d, dict):
        return default
    for k in keys:
        cur = d
        for part in k.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        if cur not in (None, ""):
            return cur
    return default


def garmin() -> None:
    gs = status["garmin"]
    parts = gs["parts"]
    gs["dataDate"] = ((read("status.json") or {}).get("garmin") or {}).get("dataDate")
    key = (os.environ.get("GARMIN_PERSONAL_API_KEY") or "").strip()
    if not key:
        gs["error"] = "Garmin не підключено: немає секрету GARMIN_PERSONAL_API_KEY"
        return
    s = requests.Session()
    s.headers["User-Agent"] = UA
    try:
        r = s.post(GARMIN_BASE + GARMIN_TOKEN_PATH, headers={"Accept": "*/*", "Authorization": f"ApiKey {key}"}, timeout=30)
        if r.status_code in (401, 403):
            gs["error"] = ("Ключ Garmin недійсний або протермінований. Створи новий на connect.garmin.com/app/settings/personalApiToken "
                           "і онови секрет GARMIN_PERSONAL_API_KEY")
            return
        r.raise_for_status()
        token = r.text.strip().strip('"')
    except Exception as e:
        gs["error"] = "Не вдалося отримати доступ до Garmin: " + short_err(e)
        return
    s.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
    gs["auth"] = "Personal API"
    discover = {}
    ok_count, fail = 0, 0

    def call(name, path, **params):
        nonlocal ok_count, fail
        try:
            resp = s.get(GARMIN_BASE + path, params=params or None, timeout=60)
            if not resp.ok:
                raise RuntimeError(f"HTTP {resp.status_code}")
            data = resp.json() if resp.content else None
            if name not in discover:
                discover[name] = shape(data)
            parts[name] = "ok"
            ok_count += 1
            return data
        except Exception as e:
            parts[name] = short_err(e)
            fail += 1
            return None

    def safe(name, fn):
        nonlocal fail
        try:
            fn()
        except Exception as e:
            parts[name] = "обробка: " + short_err(e)
            fail += 1
            traceback.print_exc()

    G: dict = {}
    d = today.isoformat()

    # --- Training Readiness Garmin: у Personal API офіційно не задокументовано, тому пробуємо відомі шляхи
    # веб-версії. Не рахується як помилка: якщо жоден не відповів — просто немає на цьому пристрої/API.
    def _probe_tr():
        tried = []
        for path in (f"/metrics-service/metrics/trainingreadiness/{d}", f"/metrics-service/metrics/trainingreadiness/{(today - timedelta(days=13)).isoformat()}/{d}",
                     f"/trainingreadiness-service/trainingreadiness/{d}", f"/wellness-service/wellness/trainingReadiness/{d}"):
            try:
                r = s.get(GARMIN_BASE + path, timeout=30)
                tried.append(f"{path.split('/')[1]}: {r.status_code}")
                if r.ok and r.content:
                    data = r.json()
                    rows = data if isinstance(data, list) else [data]
                    rows = [x for x in rows if isinstance(x, dict) and x.get("score") is not None]
                    if rows:
                        G["trainingReadiness"] = [{k: x.get(k) for k in ("calendarDate", "timestamp", "score", "level", "feedbackLong", "feedbackShort",
                            "sleepScore", "sleepScoreFactorPercent", "recoveryTime", "recoveryTimeFactorPercent", "acwrFactorPercent",
                            "acuteLoad", "stressHistoryFactorPercent", "hrvFactorPercent", "hrvWeeklyAverage", "sleepHistoryFactorPercent", "inputContext")} for x in rows]
                        parts["trainingReadiness"] = "ok"
                        return
            except Exception as e:
                tried.append(f"{path.split('/')[1]}: {type(e).__name__}")
        parts["trainingReadiness"] = "недоступно через Personal API (" + ", ".join(tried) + ")"
    try:
        _probe_tr()
    except Exception as e:
        parts["trainingReadiness"] = "проба: " + short_err(e)

    # --- HRV: тиждень + нічна крива
    hrv7 = call("hrv", f"/hrv-service/hrv/daily/{(today - timedelta(days=6)).isoformat()}/{d}")
    def _hrv7():
        hs = hrv7.get("hrvSummaries") if isinstance(hrv7, dict) else hrv7
        G["hrvWeek"] = [[h.get("calendarDate"), h.get("weeklyAvg"), h.get("lastNightAvg"), h.get("lastNight5MinHigh"),
                         "Balanced" if h.get("status") == "BALANCED" else (h.get("status") or "").capitalize()] for h in (hs or [])]
        last = (hs or [{}])[-1]
        b = last.get("baseline") or {}
        if b:
            G["hrvBaseline"] = {"low": b.get("lowUpper"), "balLow": b.get("balancedLow"), "balUp": b.get("balancedUpper")}
    if hrv7:
        safe("hrv", _hrv7)
    hrvn = call("hrvNight", f"/hrv-service/hrv/{d}")
    def _hrvn():
        G["hrvNight"] = [[to_local_hm(x.get("readingTimeGMT")), x.get("hrvValue")] for x in (hrvn.get("hrvReadings") or []) if x.get("hrvValue")]
    if hrvn:
        safe("hrvNight", _hrvn)

    # --- Сон: 7 ночей + детально остання
    G["sleepCols"] = ["date", "score", "total", "deep", "light", "rem", "awake", "resp", "spo2", "skinTempC", "bbGain", "needMin", "restless", "stress"]
    week = []
    for i in range(6, -1, -1):
        day = (today - timedelta(days=i)).isoformat()
        sl = call("sleep" if i == 0 else f"sleep-{i}", "/sleep-service/sleep/dailySleep", date=day)
        if not sl:
            continue
        def _sl(sl=sl, day=day, last=(i == 0)):
            dto = sl.get("dailySleepDTO") or sl
            if not dto.get("sleepTimeSeconds"):
                return
            need = dto.get("sleepNeed") or sl.get("sleepNeed") or {}
            score = g(dto, "sleepScores.overall.value")
            week.append([day, score, dto.get("sleepTimeSeconds"), dto.get("deepSleepSeconds"), dto.get("lightSleepSeconds"),
                         dto.get("remSleepSeconds"), dto.get("awakeSleepSeconds"), dto.get("averageRespirationValue"),
                         dto.get("averageSpO2Value"), g(sl, "avgSkinTempDeviationC"), g(sl, "bodyBatteryChange"),
                         need.get("actual") if isinstance(need, dict) else None, g(sl, "restlessMomentsCount"), dto.get("avgSleepStress")])
            if last:
                G["sleepWindow"] = [to_local_hm(dto.get("sleepStartTimestampGMT")), to_local_hm(dto.get("sleepEndTimestampGMT"))]
                nb = need if isinstance(need, dict) else {}
                al = sl.get("sleepAlignment") or {}
                nn = sl.get("nextSleepNeed") or {}
                G["sleepNight"] = {
                    "score": score, "feedback": dto.get("sleepScoreFeedback"), "insight": dto.get("sleepScoreInsight"),
                    "avgStress": dto.get("avgSleepStress"), "avgHr": dto.get("avgHeartRate"), "awakeCount": dto.get("awakeCount"),
                    "spo2": [dto.get("averageSpO2Value"), dto.get("lowestSpO2Value"), dto.get("highestSpO2Value")],
                    "resp": [dto.get("averageRespirationValue"), dto.get("lowestRespirationValue"), dto.get("highestRespirationValue")],
                    "needBaseline": nb.get("baseline"), "needActual": nb.get("actual"), "needFeedback": nb.get("feedback"),
                    "needTraining": nb.get("trainingFeedback"), "needHrv": nb.get("hrvAdjustment"), "needHistory": nb.get("sleepHistoryAdjustment"),
                    "nextNeed": nn.get("actual") if isinstance(nn, dict) else None,
                    "bedStartMin": nb.get("recommendedBedtimeStartMins"), "bedEndMin": nb.get("recommendedBedtimeEndMins"),
                    "align": {"status": al.get("status"), "winStart": al.get("optimalSleepWindowStartMins"), "winEnd": al.get("optimalSleepWindowEndMins"),
                              "optMid": al.get("optimalSleepWindowMidpointMins"), "lastMid": al.get("lastSleepMidpointMins")} if al else None,
                    "phases": {k: g(dto, f"sleepScores.{k}.value") for k in ("deepPercentage", "lightPercentage", "remPercentage")},
                    "ideal": {k: [g(dto, f"sleepScores.{k}.optimalStart"), g(dto, f"sleepScores.{k}.optimalEnd")] for k in ("deepPercentage", "lightPercentage", "remPercentage")},
                    "qual": {k: g(dto, f"sleepScores.{k}.qualifierKey") for k in ("totalDuration", "stress", "awakeCount", "restlessness", "deepPercentage", "lightPercentage", "remPercentage")},
                }
        safe("sleep" if i == 0 else f"sleep-{i}", _sl)
    G["sleepWeek"] = week

    # --- Денні підсумки 28 днів: пульс спокою, стрес, Body Battery, кроки, інтенсивні хвилини
    ds = call("daily", "/usersummary-service/v2/dailysummaries", startDate=(today - timedelta(days=27)).isoformat(), endDate=d)
    def _ds():
        items = ds.get("data") if isinstance(ds, dict) else ds
        def num(v):
            if isinstance(v, dict):
                v = g(v, "value", "total", "count", "steps")
            return v
        rows = []
        for it in items or []:
            rows.append([it.get("calendarDate"), g(it, "heartRate.restingValue"), g(it, "stress.avgLevel"),
                         g(it, "bodyBattery.maxValue"), g(it, "bodyBattery.minValue"), g(it, "bodyBattery.chargedValue"),
                         g(it, "bodyBattery.drainedValue"), num(g(it, "movement.steps")), g(it, "intensityMinutes.moderate"),
                         g(it, "intensityMinutes.vigorous"), g(it, "calories.burnedTotal"), g(it, "pulseOx.avgValue"),
                         g(it, "respiration.avgValue"), g(it, "stress.maxLevel"), g(it, "stress.restProportion"),
                         g(it, "stress.lowStressProportion"), g(it, "stress.mediumStressProportion"), g(it, "stress.highStressProportion"),
                         g(it, "bodyBattery.latestValue"), g(it, "heartRate.minValue"), g(it, "heartRate.maxValue")])
        G["dailyCols"] = ["date", "rhr", "stress", "bbHigh", "bbLow", "bbCharged", "bbDrained", "steps", "modMin", "vigMin", "kcal", "spo2", "resp",
                          "stressMax", "restPct", "lowPct", "medPct", "highPct", "bbNow", "hrMin", "hrMax"]
        G["daily"] = sorted([r for r in rows if r[0]], key=lambda r: r[0])
        if G["daily"]:
            G["today"] = dict(zip(G["dailyCols"], G["daily"][-1]))
    if ds:
        safe("daily", _ds)

    # --- Фітнес-вік
    fa = call("fitnessAge", f"/fitnessage-service/fitnessage/v2/{d}")
    def _fa():
        G["fitnessAge"] = {"chrono": g(fa, "chronologicalAge"), "fitness": round(g(fa, "fitnessAge", "achievableFitnessAge", default=0) or 0),
                           "rhr": g(fa, "components.rhr.value"), "bmi": g(fa, "components.bmi.value"),
                           "vigorousMinAvg": g(fa, "components.vigorousMinutesAvg.value")}
    if fa:
        safe("fitnessAge", _fa)

    # --- Активності 70 днів: навантаження Garmin, Training Effect, вартість Body Battery
    acts, start = [], 0
    while start < 300:
        page = call("activities", "/activitylist-service/activities/search/activities",
                    startDate=(today - timedelta(days=69)).isoformat(), endDate=d, start=start, limit=50)
        if not page:
            break
        acts.extend(page)
        if len(page) < 50:
            break
        start += 50
    def _acts():
        out = []
        for a in acts:
            out.append({"start": (a.get("startTimeLocal") or "")[:16].replace(" ", "T"), "type": g(a, "activityType.typeKey"),
                        "name": a.get("activityName"), "durS": round(a.get("duration") or 0), "avgHr": a.get("averageHR"), "maxHr": a.get("maxHR"),
                        "kcal": a.get("calories"), "load": round(a["activityTrainingLoad"], 1) if a.get("activityTrainingLoad") else None,
                        "aTE": a.get("aerobicTrainingEffect"), "anTE": a.get("anaerobicTrainingEffect"), "label": a.get("trainingEffectLabel"),
                        "bb": a.get("differenceBodyBattery"), "water": a.get("waterEstimated"),
                        "modMin": a.get("moderateIntensityMinutes"), "vigMin": a.get("vigorousIntensityMinutes"),
                        "z": [round(a.get(f"hrTimeInZone_{i}") or 0) for i in range(1, 6)]})
        out.sort(key=lambda x: x["start"])
        G["activities"] = out
        # Власний аналог «гострого/хронічного навантаження» Garmin
        byday = {}
        for a in out:
            if a["load"]:
                byday[a["start"][:10]] = byday.get(a["start"][:10], 0) + a["load"]
        hist = []
        for i in range(41, -1, -1):
            day = today - timedelta(days=i)
            acute = sum(byday.get((day - timedelta(days=k)).isoformat(), 0) for k in range(7))
            chronic = sum(byday.get((day - timedelta(days=k)).isoformat(), 0) for k in range(28)) / 4
            hist.append([day.isoformat(), round(acute), round(chronic), round(acute / chronic, 2) if chronic else None])
        G["loadHistory"] = hist
        # Баланс навантаження за 28 днів за типом ефекту тренування
        bal = {"low": 0.0, "high": 0.0, "anaerobic": 0.0}
        since = (today - timedelta(days=27)).isoformat()
        for a in out:
            if not a["load"] or a["start"][:10] < since:
                continue
            lab = (a["label"] or "").upper()
            if lab in ANA_LABELS or ((a["anTE"] or 0) >= 2 and (a["anTE"] or 0) > (a["aTE"] or 0)):
                bal["anaerobic"] += a["load"]
            elif lab in HIGH_LABELS or (lab not in LOW_LABELS and (a["aTE"] or 0) >= 3):
                bal["high"] += a["load"]
            else:
                bal["low"] += a["load"]
        G["loadBalance28"] = {k: round(v) for k, v in bal.items()}
    if acts:
        safe("activities", _acts)

    if ok_count == 0:
        gs["error"] = "Жоден запит до Garmin не пройшов: " + "; ".join(f"{k}: {v}" for k, v in list(parts.items())[:3])
        print("GARMIN DISCOVERY", json.dumps(discover, ensure_ascii=False)[:4000])
        return
    G["date"] = d
    G["source"] = "Garmin Personal API"
    write("garmin.json", G)
    print("GARMIN DISCOVERY", json.dumps(discover, ensure_ascii=False)[:20000])
    if os.environ.get("GARMIN_DISCOVER"):
        write("_garmin_shapes.json", discover)  # лише назви полів і типи, без значень
    gs["ok"] = fail == 0
    gs["dataDate"] = d
    # усі допоміжні запити сну зводимо в один рядок статусу
    sleep_fail = [k for k in list(parts) if k.startswith("sleep-") and parts[k] != "ok"]
    for k in [k for k in list(parts) if k.startswith("sleep-")]:
        parts.pop(k)
    if sleep_fail:
        parts["sleepWeek"] = f"{len(sleep_fail)} з 6 попередніх ночей не завантажились"
    if fail:
        gs["error"] = f"{fail} із {ok_count + fail} запитів не вдалися, решта даних оновлена"


def main() -> int:
    DATA.mkdir(exist_ok=True)
    for name, fn in [("intervals", intervals), ("garmin", garmin)]:
        try:
            fn()
        except Exception as e:
            status[name]["error"] = "Неочікувана помилка: " + short_err(e)
            traceback.print_exc()
    prev = read("status.json") or {}
    hist = (prev.get("history") or [])[-29:]
    sleep_today = False
    try:
        G = read("garmin.json") or {}
        sleep_today = bool(G.get("sleepWeek")) and G["sleepWeek"][-1][0] == today.isoformat() and G.get("date") == today.isoformat()
    except Exception:
        pass
    status["sleepToday"] = sleep_today
    status["slot"] = os.environ.get("SLOT") or "manual"
    hist.append({"at": status["generatedAt"], "intervals": status["intervals"]["ok"], "garmin": status["garmin"]["ok"],
                 "sleepToday": sleep_today, "slot": status["slot"]})
    status["history"] = hist
    write("status.json", status)
    print(json.dumps(status, ensure_ascii=False, indent=2))
    # падаємо тільки якщо intervals.icu повністю недоступний
    return 0 if status["intervals"]["parts"].get("wellness", "").startswith("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
