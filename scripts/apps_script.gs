/**
 * Форма Назара → Google Calendar (приватна синхронізація).
 * Працює як веб-застосунок Apps Script у Google-акаунті Назара: дані йдуть напряму в його календар,
 * нічого не публікується. Два джерела:
 *   source "plan"    — автооновлення сайту (GitHub Actions): план і виконані тренування з intervals.icu/Garmin;
 *   source "journal" — сайт (силовий журнал): фактичний старт/фініш силових, ручні тренування, видалення.
 * Записи журналу накладаються поверх плану (override) з тим самим uid.
 * Перший запуск: функція setup() — створює календар «Тренування · Форма» і секрет (видно в журналі виконання).
 */
const CAL_NAME = 'Тренування · Форма';
const TZ = 'Europe/Kyiv';
const P = () => PropertiesService.getScriptProperties();

function setup() {
  const p = P();
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  cal_();
  Logger.log('Календар: ' + CAL_NAME);
  Logger.log('SECRET: ' + p.getProperty('SECRET'));
}

function cal_() {
  const p = P();
  const id = p.getProperty('CAL_ID');
  let c = id ? CalendarApp.getCalendarById(id) : null;
  if (!c) {
    c = CalendarApp.createCalendar(CAL_NAME, { timeZone: TZ, color: CalendarApp.Color.BLUE, summary: 'Тренування з сайту «Форма Назара»' });
    p.setProperty('CAL_ID', c.getId());
  }
  return c;
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function get_(k) { const v = P().getProperty(k); return v ? JSON.parse(v) : null; }
function put_(k, v) { v == null ? P().deleteProperty(k) : P().setProperty(k, JSON.stringify(v)); }

function doGet() { return out_({ ok: true, service: 'forma-calendar' }); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'json' }); }
  if (!body || body.secret !== P().getProperty('SECRET')) return out_({ ok: false, error: 'auth' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const touched = new Set();
    if (body.source === 'plan') {
      // повний зріз плану в діапазоні [from, to]: усе, чого немає в новому зрізі, видаляється
      const keep = new Set((body.events || []).map(x => x.uid));
      const all = P().getProperties();
      Object.keys(all).filter(k => k.indexOf('b:') === 0).forEach(k => {
        const b = JSON.parse(all[k]);
        if (b.date >= body.from && b.date <= body.to && !keep.has(b.uid)) { P().deleteProperty(k); touched.add(b.uid); }
      });
      (body.events || []).forEach(x => { put_('b:' + x.uid, trim_(x)); touched.add(x.uid); });
    }
    if (body.source === 'journal') {
      (body.overrides || []).forEach(o => {
        if (o.clear) put_('o:' + o.uid, null); else put_('o:' + o.uid, trim_(o));
        touched.add(o.uid);
      });
    }
    let n = 0;
    touched.forEach(uid => { if (render_(uid)) n++; });
    return out_({ ok: true, changed: n });
  } finally {
    lock.releaseLock();
  }
}

function trim_(x) { if (x.desc && x.desc.length > 4000) x.desc = x.desc.slice(0, 4000) + '…'; return x; }

// Підсумкова подія = план (b:) + запис журналу (o:) поверх. Оновлює календар, лише якщо щось змінилось.
function render_(uid) {
  const b = get_('b:' + uid), o = get_('o:' + uid);
  const f = o && o.deleted ? null : (b || o) ? Object.assign({}, b || {}, o || {}) : null;
  const hash = f ? Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(f), Utilities.Charset.UTF_8)) : '';
  if ((P().getProperty('h:' + uid) || '') === hash) return false;
  const c = cal_();
  const evId = P().getProperty('e:' + uid);
  if (evId) { try { const ev = c.getEventById(evId); if (ev) ev.deleteEvent(); } catch (err) { } P().deleteProperty('e:' + uid); }
  if (f) {
    let ev;
    if (f.start) ev = c.createEvent(f.title, new Date(f.start), new Date(f.end || new Date(new Date(f.start).getTime() + 3600e3)), { description: f.desc || '' });
    else { const d = f.date.split('-').map(Number); ev = c.createAllDayEvent(f.title, new Date(d[0], d[1] - 1, d[2]), { description: f.desc || '' }); }
    ev.setTag('uid', uid);
    if (f.color) ev.setColor(f.color);
    P().setProperty('e:' + uid, ev.getId());
  }
  f ? P().setProperty('h:' + uid, hash) : P().deleteProperty('h:' + uid);
  return true;
}
