/**
 * Форма Назара → Google Calendar (приватна синхронізація).
 * Працює як веб-застосунок Apps Script у Google-акаунті Назара: дані йдуть напряму в його календар,
 * нічого не публікується. Два джерела:
 *   source "plan"    — автооновлення сайту (GitHub Actions): план і виконані тренування з intervals.icu/Garmin;
 *   source "journal" — сайт (силовий журнал): фактичний старт/фініш силових, ручні тренування, видалення.
 *   source "export"  — сайт: експорт усіх даних (JSON + CSV) у приватну папку Google Drive «Форма Назара · експорт»,
 *                      щоб Claude міг узяти свіжі дані для аналізу здоров'я з чату. Файли перезаписуються.
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

let CAL_ = null;
function cal_() {
  if (CAL_) return CAL_;
  const p = P();
  const id = p.getProperty('CAL_ID');
  let c = id ? CalendarApp.getCalendarById(id) : null;
  if (!c) {
    // календар видалили або його ще немає: створюємо заново і скидаємо збережені стани, щоб усі події намалювались знову
    c = CalendarApp.createCalendar(CAL_NAME, { timeZone: TZ, color: CalendarApp.Color.BLUE, summary: 'Тренування з сайту «Форма Назара»' });
    p.setProperty('CAL_ID', c.getId());
    const all = p.getProperties();
    Object.keys(all).filter(k => k.indexOf('h:') === 0 || k.indexOf('e:') === 0).forEach(k => p.deleteProperty(k));
    CAL_RESET_ = true;
  }
  return CAL_ = c;
}
let CAL_RESET_ = false;
// повністю перемалювати всі події (на випадок ручних змін у календарі)
function resync() {
  const p = P(), all = p.getProperties();
  Object.keys(all).filter(k => k.indexOf('h:') === 0).forEach(k => p.deleteProperty(k));
  const uids = new Set(Object.keys(all).filter(k => /^[bo]:/.test(k)).map(k => k.slice(2)));
  uids.forEach(u => render_(u));
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function get_(k) { const v = P().getProperty(k); return v ? JSON.parse(v) : null; }
function put_(k, v) { v == null ? P().deleteProperty(k) : P().setProperty(k, JSON.stringify(v)); }

function doGet() {
  const id = P().getProperty('CAL_ID'), c = id ? CalendarApp.getCalendarById(id) : null;
  return out_({ ok: true, service: 'forma-calendar', calendar: c ? c.getName() : null, hidden: c ? c.isHidden() : null, selected: c ? c.isSelected() : null, exportAt: P().getProperty('EXPORT_AT') });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'json' }); }
  if (!body || body.secret !== P().getProperty('SECRET')) return out_({ ok: false, error: 'auth' });
  if (body.source === 'export') return out_(saveExport_(body.files || []));
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
    cal_();
    if (CAL_RESET_) { const all = P().getProperties(); Object.keys(all).filter(k => /^[bo]:/.test(k)).forEach(k => touched.add(k.slice(2))); }
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
// показати календар у списку Google Calendar (якщо його прибрали зі списку)
function show() {
  const c = cal_();
  c.setHidden(false);
  c.setSelected(true);
  Logger.log(c.getName() + ' · ' + c.getId());
}

// ---------- експорт у Google Drive ----------
const EXPORT_FOLDER = 'Форма Назара · експорт';
function exportFolder_() {
  const p = P(), id = p.getProperty('EXPORT_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { } }
  const it = DriveApp.getFoldersByName(EXPORT_FOLDER);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(EXPORT_FOLDER);
  p.setProperty('EXPORT_FOLDER_ID', f.getId());
  return f;
}
function saveExport_(files) {
  const folder = exportFolder_(), saved = [];
  files.filter(f => f && /^[\w.-]+$/.test(f.name || '') && typeof f.text === 'string').slice(0, 10).forEach(f => {
    const it = folder.getFilesByName(f.name);
    if (it.hasNext()) { const file = it.next(); file.setContent(f.text); while (it.hasNext()) it.next().setTrashed(true); }
    else folder.createFile(f.name, f.text, f.mime || 'text/plain');
    saved.push(f.name);
  });
  P().setProperty('EXPORT_AT', new Date().toISOString());
  return { ok: true, saved: saved, folder: folder.getUrl() };
}
// запусти один раз у редакторі, щоб Google попросив дозвіл на Drive
function authorizeDrive() { Logger.log(exportFolder_().getUrl()); }
