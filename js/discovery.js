/* discovery.js — גילוי: אטרקציות, אוכל כשר ובתי חב״ד סביב החלק הפעיל או סביבי,
   פאנל פירוט מקום (הסבר מוויקיפדיה), וקישורי חיפוש ב־Google Maps כרשת ביטחון. */

import { $, esc, toast } from './utils.js';
import { API } from './api.js';
import { state, activeStop } from './state.js';
import { ensureStopCoords, renderAll } from './core.js';

/* ---------- רינדור: גילוי ---------- */
export function renderDiscoverHead() {
  var stop = activeStop();
  $('discover-place').textContent = stop
    ? 'מחפשים סביב החלק הפעיל: ' + (stop.city || stop.country || '') +
      (stop.lat == null ? ' (לחלק הזה אין עדיין קואורדינטות — הן יושלמו אוטומטית לפי שם העיר)' : '')
    : 'אין חלק פעיל. צור טיול וחלק במסלול, או השתמש ב"מסביבי עכשיו".';
  document.querySelectorAll('#discover-tabs .tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.tab === state.discoverTab);
  });
}
var lastRenderedPlaces = [];
function renderPlaces(places, kindLabel) {
  lastRenderedPlaces = places;
  var box = $('discover-results');
  if (!places.length) {
    box.innerHTML = '<div class="empty">לא נמצאו ' + esc(kindLabel) + ' באזור הזה ב־OpenStreetMap.</div>';
    return;
  }
  box.innerHTML = places.map(function (p, i) {
    return '<div class="list-item">' +
      '<div class="item-title">' + esc(p.name) + '</div>' +
      (p.localName ? '<div class="item-sub">בשפת המקום: ' + esc(p.localName) + '</div>' : '') +
      '<div class="item-sub">' +
      (p.kind ? esc(p.kind) + ' · ' : '') + API.formatDistance(p.distanceKm) +
      (p.cuisine ? ' · ' + esc(p.cuisine) : '') +
      (p.openingHours ? '<br>🕐 ' + esc(p.openingHours) : '') +
      '</div>' +
      '<div class="item-actions">' +
      '<button type="button" class="btn small" data-place-details="' + i + '">📖 הסבר ופרטים</button>' +
      '<a class="btn small navlink" target="_blank" rel="noopener" href="' + API.mapsLink(p) + '">🧭 ניווט במפות</a>' +
      (p.website ? '<a class="btn small" target="_blank" rel="noopener" href="' + esc(p.website) + '">אתר</a>' : '') +
      '</div></div>';
  }).join('');
}

/* ---------- פאנל פירוט מקום (הסבר מוויקיפדיה) ---------- */
var placeInfoCache = {}; // name@lat,lon -> info | null
var currentSheetKey = null;
export function closePlaceSheet() {
  $('place-sheet').hidden = true;
  $('place-sheet-backdrop').hidden = true;
  currentSheetKey = null;
}
export function showPlaceDetails(place) {
  var sheet = $('place-sheet');
  var content = $('place-sheet-content');
  var key = place.name + '@' + Number(place.lat).toFixed(4) + ',' + Number(place.lon).toFixed(4);
  currentSheetKey = key;
  sheet.hidden = false;
  $('place-sheet-backdrop').hidden = false;
  var navBtn = '<a class="btn small navlink" target="_blank" rel="noopener" href="' + API.mapsLink(place) + '">🧭 ניווט במפות</a>';
  content.innerHTML =
    '<h3 class="sheet-title">' + esc(place.name) + '</h3>' +
    (place.localName ? '<div class="item-sub">בשפת המקום: ' + esc(place.localName) + '</div>' : '') +
    '<div class="item-sub">' +
    (place.kind ? esc(place.kind) + ' · ' : '') + API.formatDistance(place.distanceKm) +
    (place.cuisine ? ' · ' + esc(place.cuisine) : '') +
    (place.openingHours ? '<br>🕐 ' + esc(place.openingHours) : '') +
    '</div>' +
    (place.priceText ? '<div class="sheet-price">' + esc(place.priceText) + '</div>' : '') +
    '<div id="sheet-info"><div class="muted">טוען הסבר…</div></div>';
  sheet.scrollTop = 0;
  function fillInfo(info) {
    var infoBox = $('sheet-info');
    if (!infoBox) return;
    var infoUrl = (info && info.url) ? info.url
      : 'https://www.google.com/search?q=' + encodeURIComponent(place.name);
    var html = '';
    if (info && info.image) html += '<img class="sheet-img" alt="" src="' + esc(info.image) + '">';
    if (info && info.extract) html += '<p class="sheet-extract">' + esc(info.extract) + '</p>';
    else html += '<p class="muted">אין הסבר זמין למקום הזה.</p>';
    html += '<div class="item-actions">' + navBtn +
      '<a class="btn small" target="_blank" rel="noopener" href="' + esc(infoUrl) + '">ℹ️ מידע נוסף וכרטיסים</a></div>';
    infoBox.innerHTML = html;
  }
  if (key in placeInfoCache) { fillInfo(placeInfoCache[key]); return; }
  API.fetchPlaceInfo(place.lat, place.lon, place.name).then(function (info) {
    placeInfoCache[key] = info;
    if (currentSheetKey === key && !sheet.hidden) fillInfo(info);
  }).catch(function () {
    placeInfoCache[key] = null;
    if (currentSheetKey === key && !sheet.hidden) fillInfo(null);
  });
}
export function detailsClickHandler(getList) {
  return function (e) {
    var btn = e.target.closest('button[data-place-details]');
    if (!btn) return;
    var p = getList()[Number(btn.dataset.placeDetails)];
    if (p) showPlaceDetails(p);
  };
}
/* ---------- רשת ביטחון: חיפוש ב־Google Maps (כשנתוני המפה חסרים) ---------- */
function mapsSearchUrl(query, lat, lon) {
  return 'https://www.google.com/maps/search/' + encodeURIComponent(query) +
    '/@' + lat + ',' + lon + ',13z';
}
// בלשונית חב״ד: כפתור קבוע מעל התוצאות לחיפוש ב־Google Maps סביב אותה נקודה.
function updateDiscoverExtraActions(lat, lon) {
  var box = $('discover-extra-actions');
  if (!box) return;
  if (state.discoverTab !== 'chabad' || lat == null || lon == null) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '<a class="btn" target="_blank" rel="noopener" href="' +
    mapsSearchUrl('Chabad', lat, lon) + '">🔯 חיפוש בתי חב״ד ב־Google Maps</a>';
  box.hidden = false;
}
/* מצב ריק בלשונית חב״ד: לא כל בתי חב״ד רשומים במאגר המפה — מפנים ל־Google Maps */
function renderChabadEmpty(lat, lon) {
  var box = $('discover-results');
  box.innerHTML =
    '<div class="empty">בית חב״ד לא נמצא במאגר המפה באזור הזה — לא תמיד כולם רשומים שם. ' +
    'נסו את החיפוש ב־Google Maps:' +
    '<div class="item-actions">' +
    '<a class="btn" target="_blank" rel="noopener" href="' + mapsSearchUrl('Chabad', lat, lon) + '">🔯 חיפוש בתי חב״ד ב־Google Maps</a>' +
    '</div></div>';
}

/* ---------- מעבר בין לשוניות הגילוי ---------- */
export function switchDiscoverTab(tab) {
  state.discoverTab = tab;
  state.discoverSeq++; // מבטל תוצאות של חיפוש שעדיין רץ מהלשונית הקודמת
  renderDiscoverHead();
  $('discover-results').innerHTML = '';
  $('discover-status').textContent = '';
  var st = activeStop();
  updateDiscoverExtraActions(st ? st.lat : null, st ? st.lon : null);
}
/* מצב ריק בלשונית הכשרות: אין מקומות כשרים מתויגים — מפנים לבית חב״ד הקרוב */
function renderKosherEmpty(lat, lon, sourceLabel) {
  var box = $('discover-results');
  box.innerHTML =
    '<div class="empty">לא נמצאו מקומות כשרים מתויגים באזור הזה. ' +
    'בחו״ל, הכתובת המעשית לאוכל כשר היא בדרך כלל בית חב״ד הקרוב.' +
    '<div class="item-actions">' +
    '<button type="button" class="btn" id="btn-kosher-to-chabad">🔯 מצא בית חב״ד באזור</button>' +
    '<a class="btn" target="_blank" rel="noopener" href="' + mapsSearchUrl('Kosher', lat, lon) + '">🗺️ חיפוש כשר ב־Google Maps</a>' +
    '</div></div>';
  $('btn-kosher-to-chabad').addEventListener('click', function () {
    switchDiscoverTab('chabad');
    runDiscover(lat, lon, sourceLabel);
  });
}

export function runDiscover(lat, lon, sourceLabel) {
  var status = $('discover-status');
  var tab = state.discoverTab;
  // מונה רצף: תגובה של חיפוש ישן (למשל אטרקציות אטי) לא תדרוס תוצאות של חיפוש חדש יותר
  var seq = ++state.discoverSeq;
  var fn = tab === 'kosher' ? API.findKosher : (tab === 'chabad' ? API.findChabad : API.findAttractions);
  var label = tab === 'kosher' ? 'מקומות כשרים' : (tab === 'chabad' ? 'בתי חב״ד' : 'אטרקציות');
  status.textContent = 'מחפש ' + label + ' סביב ' + sourceLabel + '…';
  $('discover-results').innerHTML = '';
  updateDiscoverExtraActions(lat, lon);
  fn(lat, lon, function (partial) {
    if (seq !== state.discoverSeq) return;
    if (partial && partial.length) {
      status.textContent = 'נמצאו בינתיים ' + partial.length + ' ' + label + ' סביב ' + sourceLabel + ' — ממשיך לחפש עוד…';
      renderPlaces(partial, label);
    }
  }).then(function (places) {
    if (seq !== state.discoverSeq) return; // חיפוש חדש יותר כבר רץ — מתעלמים
    status.textContent = 'נמצאו ' + places.length + ' ' + label + ' סביב ' + sourceLabel + ' (מקור: OpenStreetMap).';
    if (tab === 'kosher' && !places.length) { renderKosherEmpty(lat, lon, sourceLabel); return; }
    if (tab === 'chabad' && !places.length) { renderChabadEmpty(lat, lon); return; }
    renderPlaces(places, label);
  }).catch(function () {
    if (seq !== state.discoverSeq) return;
    status.textContent = 'החיפוש נכשל — בדוק חיבור לאינטרנט ונסה שוב.';
  });
}

export function bindDiscoverEvents() {
  /* גילוי */
  $('btn-search-stop').addEventListener('click', function () {
    var stop = activeStop();
    if (!stop) { toast('אין חלק פעיל'); return; }
    if (stop.lat == null) {
      // מנסים להשלים קואורדינטות אוטומטית לפי שם העיר, ואז מחפשים
      $('discover-status').textContent = 'מאתר את מיקום החלק…';
      ensureStopCoords(stop).then(function () {
        renderAll();
        if (stop.lat != null) {
          runDiscover(stop.lat, stop.lon, stop.city || stop.country || 'החלק הפעיל');
        } else {
          $('discover-status').textContent = '';
          toast('לחלק הפעיל אין קואורדינטות — ערוך אותו במסלול');
        }
      });
      return;
    }
    runDiscover(stop.lat, stop.lon, stop.city || stop.country || 'החלק הפעיל');
  });
  $('btn-search-around').addEventListener('click', function () {
    if (!navigator.geolocation) { toast('המכשיר לא תומך במיקום'); return; }
    $('discover-status').textContent = 'מאתר את המיקום שלך…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      runDiscover(pos.coords.latitude, pos.coords.longitude, 'המיקום שלך עכשיו');
    }, function () {
      $('discover-status').textContent = 'לא הצלחתי לקבל מיקום מהמכשיר.';
    }, { timeout: 12000 });
  });
  $('discover-results').addEventListener('click', detailsClickHandler(function () { return lastRenderedPlaces; }));
  $('place-sheet-close').addEventListener('click', closePlaceSheet);
  $('place-sheet-backdrop').addEventListener('click', closePlaceSheet);
  document.querySelectorAll('#discover-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () { switchDiscoverTab(t.dataset.tab); });
  });
}
