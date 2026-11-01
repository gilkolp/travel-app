/* archive.js — היסטוריית טיולים: רינדור הבית וההיסטוריה, ארכוב טיול,
   שחזור, ומחיקה לצמיתות של טיול עם כל הרשומות התלויות בו. */

import { $, esc, fmtDate, toast } from './utils.js';
import { DB } from './db.js';
import { state, currentTrip, activeStop, isArchivedTrip, activeTrips, archivedTrips } from './state.js';
import { showScreen, loadAll } from './core.js';

/* ---------- רינדור: בית ---------- */
export function renderHome() {
  var trip = currentTrip();
  var archived = isArchivedTrip(trip);
  $('no-trip-msg').hidden = !!trip;
  $('trip-box').hidden = !trip || archived;
  var archBox = $('trip-archived-box');
  if (archBox) archBox.hidden = !archived;
  if (trip && !archived) {
    $('trip-select').innerHTML = activeTrips().map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === trip.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    var stop = activeStop();
    $('trip-summary').innerHTML =
      '<div><strong>' + esc(trip.name) + '</strong> · ' + esc(trip.country || '') + '</div>' +
      '<div class="item-sub">' +
      (trip.startDate ? fmtDate(trip.startDate) : '') +
      (trip.endDate ? ' ← ' + fmtDate(trip.endDate) : '') + '</div>' +
      (stop ? '<div class="item-sub">החלק הפעיל: <strong>' + esc(stop.city || stop.country || '') +
        '</strong>' + (stop.arrivalDate ? ' · ' + fmtDate(stop.arrivalDate) : '') +
        (stop.departureDate ? ' ← ' + fmtDate(stop.departureDate) : '') + '</div>' : '');
  }
  if (archived) {
    $('trip-archived-summary').innerHTML =
      '<div><strong>' + esc(trip.name) + '</strong> · ' + esc(trip.country || '') +
      ' <span class="badge archive">📚 בארכיון</span></div>' +
      '<div class="item-sub">' +
      (trip.startDate ? fmtDate(trip.startDate) : '') +
      (trip.endDate ? ' ← ' + fmtDate(trip.endDate) : '') + '</div>' +
      (trip.archivedAt ? '<div class="item-sub">נשמר להיסטוריה ב־' +
        fmtDate(String(trip.archivedAt).slice(0, 10)) + '</div>' : '');
  }
  renderHistory();
}

/* ---------- רינדור: היסטוריית טיולים ---------- */
export function renderHistory() {
  var card = $('history-card');
  var listEl = $('history-list');
  if (!card || !listEl) return;
  var arch = archivedTrips().slice().sort(function (a, b) {
    return String(b.archivedAt || '').localeCompare(String(a.archivedAt || ''));
  });
  card.hidden = !arch.length;
  if (!arch.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = arch.map(function (t) {
    var n = state.stopCounts[t.id] || 0;
    return '<div class="list-item">' +
      '<div class="item-title">' + esc(t.name) + '</div>' +
      '<div class="item-sub">' + esc(t.country || '') +
      (t.startDate ? ' · ' + fmtDate(t.startDate) : '') +
      (t.endDate ? ' ← ' + fmtDate(t.endDate) : '') +
      ' · ' + n + ' חלקים</div>' +
      '<div class="item-actions">' +
      '<button class="btn small" data-hist-open="' + t.id + '">👁 פתח לצפייה</button>' +
      '</div></div>';
  }).join('');
}

/* ---------- פעולות ארכיון: סיום ושמירה, שחזור, מחיקה לצמיתות ---------- */
function archiveCurrentTrip() {
  var trip = currentTrip();
  if (!trip || trip.archived) return;
  if (!confirm('לסיים את הטיול "' + trip.name + '" ולשמור אותו בהיסטוריית הטיולים?\nהיומן, התמונות והמסמכים יישמרו שם — ואפשר יהיה לשחזר אותו בכל עת.')) return;
  trip.archived = true;
  trip.archivedAt = new Date().toISOString();
  DB.put('trips', trip).then(function () {
    // יוצאים מהטיול המאורכב נקי: עוברים לטיול פעיל אחר, אם יש
    var next = state.trips.find(function (t) { return !t.archived && t.id !== trip.id; });
    state.currentTripId = next ? next.id : null;
    if (state.currentTripId) localStorage.setItem('ta.currentTripId', String(state.currentTripId));
    else localStorage.removeItem('ta.currentTripId');
    showScreen('home');
    loadAll().then(function () { toast('הטיול נשמר בהיסטוריית הטיולים 📚'); });
  });
}
function restoreTrip(trip) {
  if (!trip || !trip.archived) return;
  trip.archived = false;
  trip.archivedAt = null;
  DB.put('trips', trip).then(function () {
    state.currentTripId = trip.id;
    localStorage.setItem('ta.currentTripId', String(trip.id));
    showScreen('home');
    loadAll().then(function () { toast('הטיול שוחזר לטיולים הפעילים ↩️'); });
  });
}
/* מחיקת טיול עם כל הרשומות התלויות בו — לפי tripId, לא לפי מה שנטען למסך */
function purgeTripRecords(tripId) {
  return Promise.all([
    DB.byIndex('stops', 'tripId', tripId),
    DB.byIndex('journal', 'tripId', tripId),
    DB.byIndex('documents', 'tripId', tripId)
  ]).then(function (res) {
    var jobs = [];
    res[0].forEach(function (s) { jobs.push(DB.remove('stops', s.id)); });
    res[1].forEach(function (j) { jobs.push(DB.remove('journal', j.id)); });
    res[2].forEach(function (d) { jobs.push(DB.remove('documents', d.id)); });
    jobs.push(DB.remove('trips', tripId));
    return Promise.all(jobs);
  });
}
function deleteTripPermanently(trip) {
  if (!trip) return;
  if (!confirm('למחוק לצמיתות את הטיול "' + trip.name + '"?\nכל החלקים, היומן, התמונות והמסמכים שלו יימחקו — גם מהענן. אי אפשר לשחזר.')) return;
  var wasCurrent = state.currentTripId === trip.id;
  purgeTripRecords(trip.id).then(function () {
    if (wasCurrent) {
      state.currentTripId = null;
      localStorage.removeItem('ta.currentTripId');
    }
    showScreen('home');
    loadAll().then(function () { toast('הטיול נמחק לצמיתות'); });
  });
}

export function bindArchiveEvents() {
  /* היסטוריית טיולים: פתיחת טיול מאורכב לצפייה */
  $('history-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-hist-open]');
    if (!btn) return;
    var id = Number(btn.dataset.histOpen);
    if (!state.trips.find(function (t) { return t.id === id; })) return;
    state.currentTripId = id;
    localStorage.setItem('ta.currentTripId', String(id));
    showScreen('home');
    loadAll();
  });
  $('btn-archive-trip').addEventListener('click', archiveCurrentTrip);
  $('btn-restore-trip').addEventListener('click', function () { restoreTrip(currentTrip()); });
  $('btn-delete-trip-permanent').addEventListener('click', function () { deleteTripPermanently(currentTrip()); });
}
