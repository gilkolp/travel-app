/* core.js — שלד האפליקציה: ניווט בין מסכים, רינדור כולל, טעינת נתונים,
   השלמת קואורדינטות אוטומטית לחלקים ומזג האוויר של החלק הפעיל. */

import { $, esc, todayStr, addDays, fmtDate, fmtDateShort } from './utils.js';
import { DB } from './db.js';
import { API } from './api.js';
import { state, currentTrip, tripStops, activeStop } from './state.js';
import { tickClocks } from './clocks.js';
import { renderHome } from './archive.js';
import { renderRoute, openStopEditor } from './trips.js';
import { renderDiscoverHead, switchDiscoverTab } from './discovery.js';
import { renderStay } from './stays.js';
import { renderJournal } from './journal.js';
import { renderDocuments } from './documents.js';
import { renderSettings } from './settings.js';

/* ---------- ניווט ---------- */
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  var el = $('screen-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  if (name === 'home') renderWeather();
  if (name === 'stay') renderStay();
  if (name === 'discover') renderDiscoverHead();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

/* ---------- רינדור: בוררים עליונים ---------- */
function renderTopSelectors() {
  var stopSel = $('active-stop-select');
  var stops = tripStops();
  var trip = currentTrip();
  var html = '';
  if (!trip) {
    html = '<option value="">אין טיול</option>';
  } else if (trip.archived) {
    html = '<option value="">📚 טיול בארכיון — לצפייה בלבד</option>';
  } else {
    html = '<option value="auto">🔄 אוטומטי (לפי התאריך של היום)</option>' +
      stops.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.city || s.country || 'חלק') + '</option>';
      }).join('');
  }
  stopSel.innerHTML = html;
  if (trip && !trip.archived) {
    stopSel.value = trip.activeStopId != null ? String(trip.activeStopId) : 'auto';
  }
}

/* ---------- טעינת נתונים ---------- */
export function loadAll() {
  return Promise.all([
    DB.getAll('trips'), DB.getAll('stops'), DB.getAll('members'),
    DB.getAll('journal'), DB.getAll('documents')
  ]).then(function (res) {
    state.trips = res[0];
    state.members = res[2];
    if (!state.trips.find(function (t) { return t.id === state.currentTripId; })) {
      // ברירת מחדל: הטיול הפעיל הראשון — לא טיול מהארכיון
      var firstActive = state.trips.find(function (t) { return !t.archived; });
      state.currentTripId = firstActive ? firstActive.id : null;
    }
    var trip = currentTrip();
    state.stopCounts = {};
    res[1].forEach(function (s) {
      state.stopCounts[s.tripId] = (state.stopCounts[s.tripId] || 0) + 1;
    });
    state.stops = res[1].filter(function (s) { return trip && s.tripId === trip.id; });
    state.journal = res[3].filter(function (j) { return trip && j.tripId === trip.id; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    state.documents = res[4].filter(function (d) { return trip && d.tripId === trip.id; });
    renderAll();
  });
}

/* ---------- השלמת קואורדינטות אוטומטית ----------
   חלק שנוצר בלי קואורדינטות (למשל החלק הכללי של הטיול) — משלימים לפי שם העיר/המדינה
   ושומרים חזרה ל־DB, כדי שמזג האוויר והגילוי יעבדו גם עליו. */
var coordsAttempted = {}; // stopId -> true : כבר נעשה ניסיון השלמה (הצליח או נכשל) במפגש הזה
var coordsInFlight = {};  // stopId -> Promise<boolean>
export function ensureStopCoords(stop) {
  if (!stop || stop.lat != null) return Promise.resolve(false);
  if (coordsAttempted[stop.id]) return Promise.resolve(false);
  if (coordsInFlight[stop.id]) return coordsInFlight[stop.id];
  var name = (stop.city || '').trim() || (stop.country || '').trim();
  if (!name) { coordsAttempted[stop.id] = true; return Promise.resolve(false); }
  var p = API.geocode(name).then(function (res) {
    coordsAttempted[stop.id] = true;
    delete coordsInFlight[stop.id];
    if (res && res.length) {
      stop.lat = res[0].lat;
      stop.lon = res[0].lon;
      if (res[0].timezone) stop.timezone = res[0].timezone;
      return DB.put('stops', stop).then(
        function () { return true; },
        function () { return true; } // גם אם השמירה נכשלה, בזיכרון יש קואורדינטות
      );
    }
    return false;
  }).catch(function () {
    coordsAttempted[stop.id] = true;
    delete coordsInFlight[stop.id];
    return false;
  });
  coordsInFlight[stop.id] = p;
  return p;
}

/* ---------- מזג אוויר ---------- */
function weatherRange() {
  var stop = activeStop();
  var today = todayStr();
  if (stop && !stop.arrivalDate && !stop.departureDate) {
    // לחלק אין תאריכים בכלל — אין תקופה להציג לה תחזית
    return { stop: stop, nodates: true };
  }
  if (stop && stop.arrivalDate && stop.departureDate) {
    if (stop.departureDate < today) {
      // החלק כבר הסתיים — מציגים תחזית לשבוע הקרוב במיקום החלק
      return { stop: stop, start: today, end: addDays(today, 6), finished: true };
    }
    var start = stop.arrivalDate < today ? today : stop.arrivalDate;
    var end = stop.departureDate;
    // ה־API החינמי מוגבל לכ־16 יום קדימה
    var maxEnd = addDays(today, 15);
    if (end > maxEnd) end = maxEnd;
    if (start > end) start = end;
    return { stop: stop, start: start, end: end, finished: false };
  }
  return { stop: stop, start: today, end: addDays(today, 6), finished: false };
}

export function renderWeather() {
  var box = $('weather-days');
  var placeEl = $('weather-place');
  var tripNow = currentTrip();
  if (tripNow && tripNow.archived) {
    placeEl.textContent = '📚 הטיול בארכיון — התחזית תוצג שוב אחרי שחזור הטיול.';
    box.innerHTML = '';
    return;
  }
  var stop = activeStop();
  if (!stop) {
    placeEl.textContent = 'בחר טיול וחלק עם מיקום כדי לראות מזג אוויר.';
    box.innerHTML = '';
    return;
  }
  var range = weatherRange();
  if (range.nodates) {
    placeEl.textContent = 'לחלק "' + (stop.city || stop.country || '') +
      '" אין תאריכים — הגדר תאריכים לחלק כדי לראות תחזית מדויקת לתקופתו.';
    box.innerHTML = '<button type="button" class="btn small" id="btn-weather-edit-stop">✏️ הגדר תאריכים לחלק</button>';
    var editBtn = $('btn-weather-edit-stop');
    if (editBtn) editBtn.addEventListener('click', function () { openStopEditor(stop.id); });
    return;
  }
  if (stop.lat == null || stop.lon == null) {
    if (coordsAttempted[stop.id]) {
      placeEl.textContent = 'בחר טיול וחלק עם מיקום כדי לראות מזג אוויר.';
      box.innerHTML = '';
    } else {
      placeEl.textContent = 'מאתר את מיקום החלק "' + (stop.city || stop.country || '') + '"…';
      ensureStopCoords(stop).then(function () { renderAll(); });
    }
    return;
  }
  if (range.finished) {
    placeEl.textContent = 'החלק "' + (stop.city || stop.country || '') + '" כבר הסתיים — ' +
      'הנה תחזית לשבוע הקרוב ב' + (stop.city || stop.country || '') +
      ' · ' + fmtDate(range.start) + ' ← ' + fmtDate(range.end);
  } else {
    placeEl.textContent = 'מזג אוויר ב' + (stop.city || stop.country || '') +
      ' · ' + fmtDate(range.start) + ' ← ' + fmtDate(range.end);
  }
  box.innerHTML = '<div class="muted">טוען תחזית…</div>';
  API.fetchWeather(stop.lat, stop.lon, range.start, range.end).then(function (days) {
    if (!days.length) { box.innerHTML = '<div class="muted">אין תחזית זמינה לטווח הזה.</div>'; return; }
    box.innerHTML = days.map(function (d) {
      return '<div class="wday">' +
        '<div class="wdate">' + esc(fmtDateShort(d.date)) + '</div>' +
        '<div class="wicon">' + d.icon + '</div>' +
        '<div class="wtemp">' + d.tmax + '° / ' + d.tmin + '°</div>' +
        '<div class="wdesc">' + esc(d.desc) + '</div>' +
        (d.rainProb != null ? '<div class="wrain">💧 ' + d.rainProb + '%</div>' : '') +
        '</div>';
    }).join('');
  }).catch(function () {
    box.innerHTML = '<div class="muted">לא הצלחתי לטעון תחזית (נדרש חיבור לאינטרנט).</div>';
  });
}

/* ---------- רינדור כולל ---------- */
export function renderAll() {
  state.objectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
  state.objectUrls = [];
  renderTopSelectors();
  renderPartsBar();
  tickClocks();
  renderHome();
  renderWeather();
  renderRoute();
  renderDiscoverHead();
  renderJournal();
  renderDocuments();
}

/* ---------- פס חלקי הטיול (צ'יפים בראש המסך) ---------- */
function renderPartsBar() {
  var bar = $('parts-bar');
  if (!bar) return;
  var trip = currentTrip();
  if (!trip || trip.archived) { bar.hidden = true; bar.innerHTML = ''; return; }
  var stops = tripStops();
  var mode = trip.activeStopId == null ? 'auto' : trip.activeStopId;
  var current = activeStop();
  var html = '<button type="button" class="part-chip' + (mode === 'auto' ? ' active' : '') +
    '" data-part="auto">🔄 אוטומטי</button>';
  html += stops.map(function (s) {
    var isSelected = mode !== 'auto' && Number(mode) === s.id;
    var isCurrent = current && current.id === s.id;
    return '<button type="button" class="part-chip' + (isSelected ? ' active' : '') +
      '" data-part="' + s.id + '">' + esc(s.city || s.country || 'חלק') +
      (mode === 'auto' && isCurrent ? ' • עכשיו' : '') + '</button>';
  }).join('');
  bar.innerHTML = html;
  bar.hidden = false;
}

export function bindNavigationEvents() {
  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () { showScreen(b.dataset.screen); });
  });
  document.querySelectorAll('.shortcut').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.tab) switchDiscoverTab(b.dataset.tab);
      showScreen(b.dataset.goto);
    });
  });

  /* מזג אוויר */
  $('btn-refresh-weather').addEventListener('click', renderWeather);
}
