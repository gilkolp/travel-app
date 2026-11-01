/* stays.js — לינה: קישורי חיפוש חיצוניים, רשימת מקומות לינה מהמפה,
   ומחירי מלונות חיים דרך LiteAPI (המפתח עצמו מנוהל במסך ההגדרות). */

import { $, esc, fmtDate, toast } from './utils.js';
import { API } from './api.js';
import { currentTrip, activeStop } from './state.js';
import { ensureStopCoords, renderAll, showScreen } from './core.js';
import { detailsClickHandler } from './discovery.js';

/* ---------- רינדור: לינה ---------- */
export function renderStay() {
  var stop = activeStop();
  var trip = currentTrip();
  var city = stop ? (stop.city || stop.country || '') : (trip ? trip.country : '');
  var checkin = (stop && stop.arrivalDate) || (trip && trip.startDate) || '';
  var checkout = (stop && stop.departureDate) || (trip && trip.endDate) || '';
  $('stay-place').textContent = city
    ? 'יעד: ' + city + (checkin ? ' · ' + fmtDate(checkin) : '') + (checkout ? ' ← ' + fmtDate(checkout) : '')
    : 'בחר טיול וחלק פעיל כדי לבנות קישורי חיפוש.';
  var q = encodeURIComponent(city || '');
  $('stay-booking').href = 'https://www.booking.com/searchresults.he.html?ss=' + q +
    (checkin ? '&checkin=' + checkin : '') + (checkout ? '&checkout=' + checkout : '');
  $('stay-airbnb').href = 'https://www.airbnb.com/s/' + q + '/homes' +
    (checkin ? '?checkin=' + checkin : '') + (checkout ? (checkin ? '&' : '?') + 'checkout=' + checkout : '');
  $('stay-google').href = 'https://www.google.com/travel/hotels?q=' + q +
    (checkin ? '&checkin=' + checkin : '') + (checkout ? '&checkout=' + checkout : '');
  renderLiteApiBox();
}

/* ---------- לינה: חיפוש מקומות לינה סביב החלק הפעיל ---------- */
var lastStayPlaces = [];
function renderStayPlaces(places) {
  lastStayPlaces = places;
  var box = $('stay-results');
  if (!places.length) {
    box.innerHTML = '<div class="empty">לא נמצאו מקומות לינה באזור הזה ב־OpenStreetMap.</div>';
    return;
  }
  box.innerHTML = places.map(function (p, i) {
    return '<div class="list-item">' +
      '<div class="item-title">' + esc(p.name) + '</div>' +
      (p.localName ? '<div class="item-sub">בשפת המקום: ' + esc(p.localName) + '</div>' : '') +
      '<div class="item-sub">' +
      (p.kind ? esc(p.kind) + ' · ' : '') + API.formatDistance(p.distanceKm) +
      '</div>' +
      '<div class="item-actions">' +
      '<button type="button" class="btn small" data-place-details="' + i + '">📖 הסבר ופרטים</button>' +
      '<a class="btn small navlink" target="_blank" rel="noopener" href="' + API.mapsLink(p) + '">🧭 ניווט במפות</a>' +
      '</div></div>';
  }).join('');
}
function withStopCoords(stop, statusEl, onReady) {
  if (stop.lat != null) { onReady(); return; }
  statusEl.textContent = 'מאתר את מיקום החלק…';
  ensureStopCoords(stop).then(function () {
    renderAll();
    if (stop.lat != null) onReady();
    else {
      statusEl.textContent = '';
      toast('לחלק הפעיל אין קואורדינטות — ערוך אותו במסלול');
    }
  });
}
function runStaySearch() {
  var stop = activeStop();
  var status = $('stay-status');
  if (!stop) { toast('אין חלק פעיל'); return; }
  withStopCoords(stop, status, function () {
    status.textContent = 'מחפש מקומות לינה סביב ' + (stop.city || stop.country || 'החלק הפעיל') + '…';
    API.findStays(stop.lat, stop.lon).then(function (places) {
      status.textContent = 'נמצאו ' + places.length + ' מקומות לינה סביב ' +
        (stop.city || stop.country || 'החלק הפעיל') + ' (מקור: OpenStreetMap).';
      renderStayPlaces(places);
    }).catch(function () {
      status.textContent = 'החיפוש נכשל — בדוק חיבור לאינטרנט ונסה שוב.';
    });
  });
}

/* ---------- לינה: מחירי מלונות דרך LiteAPI ---------- */
export function liteapiKeySaved() {
  try { return !!(localStorage.getItem('liteapi_key') || '').trim(); } catch (e) { return false; }
}
function renderLiteApiBox() {
  var box = $('liteapi-box');
  if (!box) return;
  if (liteapiKeySaved()) {
    box.innerHTML =
      '<h3>🏨 מחירי מלונות (LiteAPI)</h3>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn primary" id="btn-liteapi-search">🏨 חפש מלונות עם מחירים (LiteAPI)</button>' +
      '<button type="button" class="btn danger" id="btn-liteapi-disconnect">נתק</button>' +
      '</div>';
    $('btn-liteapi-search').addEventListener('click', runLiteApiSearch);
    $('btn-liteapi-disconnect').addEventListener('click', function () {
      try { localStorage.removeItem('liteapi_key'); } catch (e) {}
      $('liteapi-results').innerHTML = '';
      $('liteapi-status').textContent = '';
      renderLiteApiBox();
      toast('החיבור ל־LiteAPI נותק והמפתח נמחק');
    });
  } else {
    box.innerHTML =
      '<h3>🏨 מחירי מלונות (LiteAPI)</h3>' +
      '<p class="hint">כדי לראות כאן מחירי מלונות אמיתיים צריך לחבר מפתח LiteAPI — המפתח מוגדר בהגדרות.</p>' +
      '<div class="form-actions"><button type="button" class="btn" id="btn-liteapi-goto-settings">⚙️ פתח הגדרות</button></div>';
    $('btn-liteapi-goto-settings').addEventListener('click', function () { showScreen('settings'); });
  }
}
function renderLiteApiResults(offers) {
  var box = $('liteapi-results');
  if (!offers.length) { box.innerHTML = ''; return; }
  box.innerHTML = offers.map(function (p) {
    var searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(p.name + ' hotel booking');
    return '<div class="list-item">' +
      '<div class="item-title">' + esc(p.name) + '</div>' +
      '<div class="item-sub">' + API.formatDistance(p.distanceKm) +
      (p.rating ? ' · ⭐ ' + esc(p.rating) : '') + '</div>' +
      (p.priceText ? '<div class="price-tag">' + esc(p.priceText) + '</div>' : '') +
      '<div class="item-actions">' +
      '<a class="btn small navlink" target="_blank" rel="noopener" href="' + searchUrl + '">לפרטים והזמנה</a>' +
      '</div></div>';
  }).join('');
}
function runLiteApiSearch() {
  var stop = activeStop();
  var trip = currentTrip();
  var status = $('liteapi-status');
  if (!stop) { toast('אין חלק פעיל'); return; }
  withStopCoords(stop, status, function () {
    var checkin = stop.arrivalDate || (trip && trip.startDate) || '';
    var checkout = stop.departureDate || (trip && trip.endDate) || '';
    status.textContent = 'מחפש מלונות עם מחירים…';
    API.findHotelPrices(stop.lat, stop.lon, checkin, checkout).then(function (offers) {
      status.textContent = offers.length
        ? 'נמצאו ' + offers.length + ' מלונות עם מחירים (מקור: LiteAPI).'
        : 'לא נמצאו הצעות מחיר לתאריכים האלה.';
      renderLiteApiResults(offers);
    }).catch(function () {
      status.textContent = 'לא ניתן לטעון מחירים כרגע — ייתכן שהמפתח שגוי או שהשירות חסום מהדפדפן';
      $('liteapi-results').innerHTML = '';
    });
  });
}

export function bindStayEvents() {
  /* לינה */
  $('btn-search-stays').addEventListener('click', runStaySearch);
  $('stay-results').addEventListener('click', detailsClickHandler(function () { return lastStayPlaces; }));
}
