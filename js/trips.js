/* trips.js — טיולים וחלקי טיול: רינדור מסך המסלול והשותפים,
   טפסי יצירה/עריכה, בחירת החלק הפעיל ומחיקת טיול. */

import { $, esc, fmtDate, toast, linkDateRange, dateRangeValid } from './utils.js';
import { DB } from './db.js';
import { API } from './api.js';
import { state, currentTrip, tripStops, activeStop, viewingArchived } from './state.js';
import { showScreen, loadAll, renderAll } from './core.js';

var syncTripDates = null;
var syncStopDates = null;

/* ---------- רינדור: מסלול ושותפים ---------- */
export function renderRoute() {
  var readOnly = viewingArchived();
  var newStopBtn = $('btn-new-stop');
  if (newStopBtn) newStopBtn.hidden = readOnly;
  if (readOnly) $('stop-form').hidden = true;
  var memberForm = $('member-form');
  if (memberForm) memberForm.hidden = readOnly;
  var list = $('stops-list');
  var stops = tripStops();
  var trip = currentTrip();
  if (!trip) { list.innerHTML = '<div class="empty">צור קודם טיול במסך הבית.</div>'; }
  else if (!stops.length) { list.innerHTML = '<div class="empty">אין עדיין חלקים לטיול. הוסף את החלק הראשון.</div>'; }
  else {
    var active = activeStop();
    list.innerHTML = stops.map(function (s) {
      var isActive = active && active.id === s.id;
      return '<div class="list-item">' +
        '<div class="item-title">' + esc(s.city || s.country || 'חלק') +
        (isActive ? '<span class="badge">החלק הפעיל</span>' : '') + '</div>' +
        '<div class="item-sub">' + esc(s.country || '') +
        (s.arrivalDate ? ' · הגעה ' + fmtDate(s.arrivalDate) : '') +
        (s.departureDate ? ' · עזיבה ' + fmtDate(s.departureDate) : '') + '</div>' +
        (s.authorName ? '<div class="author-tag">עודכן על ידי ' + esc(s.authorName) + '</div>' : '') +
        (readOnly ? '' :
        '<div class="item-actions">' +
        '<button class="btn small" data-act="activate" data-id="' + s.id + '">סמן כחלק פעיל</button>' +
        '<button class="btn small" data-act="edit" data-id="' + s.id + '">ערוך</button>' +
        '<button class="btn small danger" data-act="delete" data-id="' + s.id + '">מחק</button>' +
        '</div>') + '</div>';
    }).join('');
  }

  var ml = $('members-list');
  if (!state.members.length) {
    ml.innerHTML = '<div class="empty">אין עדיין שותפים. הוסף את מי שטס איתך.</div>';
  } else {
    ml.innerHTML = state.members.map(function (m) {
      return '<div class="list-item"><div class="item-title">' + esc(m.name) +
        '<span class="badge gray">' + (m.role === 'follower' ? 'עוקב' : 'שותף מעדכן') + '</span></div>' +
        (readOnly ? '' :
        '<div class="item-actions"><button class="btn small danger" data-member-del="' + m.id + '">הסר</button></div>') + '</div>';
    }).join('');
  }
}

export function openStopEditor(stopId) {
  showScreen('route');
  var btn = document.querySelector('#stops-list button[data-act="edit"][data-id="' + stopId + '"]');
  if (btn) btn.click();
}

export function bindTripEvents() {
  /* קישור תאריכי טווח (התחלה ↔ סיום) בכל טפסי הטווח */
  syncTripDates = linkDateRange($('trip-start'), $('trip-end'));
  syncStopDates = linkDateRange($('stop-arrival'), $('stop-departure'));
  /* טיול חדש */
  $('btn-new-trip').addEventListener('click', function () {
    syncTripDates(); // מרענן min/max לפי הערכים הנוכחיים (ומנקה שאריות מניסיון קודם)
    $('trip-form').hidden = false;
  });
  $('trip-form-cancel').addEventListener('click', function () { $('trip-form').hidden = true; });
  $('trip-country').addEventListener('input', function () {
    var q = this.value.trim();
    state.pendingTripGeo = null;
    if (q.length < 2) { $('trip-country-results').innerHTML = ''; return; }
    API.geocode(q).then(function (results) {
      $('trip-country-results').innerHTML = results.map(function (g, i) {
        return '<button type="button" data-geo="' + i + '">' + esc(g.name) + ' · ' + esc(g.country) +
          (g.admin1 ? ' · ' + esc(g.admin1) : '') + '</button>';
      }).join('');
      $('trip-country-results').querySelectorAll('button').forEach(function (btn, i) {
        btn.addEventListener('click', function () {
          state.pendingTripGeo = results[i];
          $('trip-country').value = results[i].country || results[i].name;
          $('trip-country-results').innerHTML = '';
          toast('נבחר: ' + results[i].name + ', ' + results[i].country);
        });
      });
    }).catch(function () { /* שקט: אפשר גם בלי בחירה */ });
  });
  $('trip-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!dateRangeValid($('trip-start').value, $('trip-end').value)) {
      toast('תאריך הסיום חייב להיות ביום ההתחלה או אחריו');
      return;
    }
    var country = $('trip-country').value.trim();
    var trip = {
      name: $('trip-name').value.trim(),
      country: country,
      startDate: $('trip-start').value || '',
      endDate: $('trip-end').value || '',
      activeStopId: 'auto'
    };
    DB.add('trips', trip).then(function (id) {
      trip.id = id;
      // חלק כללי על שם המדינה
      var stop = {
        tripId: id, city: country, country: country,
        lat: null, lon: null, timezone: '',
        arrivalDate: trip.startDate, departureDate: trip.endDate,
        authorName: state.author || ''
      };
      function afterStop() {
        state.currentTripId = id;
        localStorage.setItem('ta.currentTripId', String(id));
        $('trip-form').hidden = true;
        $('trip-form').reset();
        loadAll().then(function () { toast('הטיול נוצר'); });
      }
      var geo = state.pendingTripGeo;
      if (geo) {
        stop.lat = geo.lat; stop.lon = geo.lon; stop.timezone = geo.timezone;
        DB.add('stops', stop).then(afterStop);
      } else if (country) {
        API.geocode(country).then(function (res) {
          if (res.length) { stop.lat = res[0].lat; stop.lon = res[0].lon; stop.timezone = res[0].timezone; }
        }).catch(function () {}).then(function () { return DB.add('stops', stop); }).then(afterStop);
      } else {
        DB.add('stops', stop).then(afterStop);
      }
    });
  });
  $('btn-delete-trip').addEventListener('click', function () {
    var trip = currentTrip();
    if (!trip) return;
    if (!confirm('למחוק את הטיול "' + trip.name + '" עם כל החלקים, היומן והמסמכים שלו?')) return;
    var jobs = [];
    tripStops().forEach(function (s) { jobs.push(DB.remove('stops', s.id)); });
    state.journal.forEach(function (j) { jobs.push(DB.remove('journal', j.id)); });
    state.documents.forEach(function (d) { jobs.push(DB.remove('documents', d.id)); });
    jobs.push(DB.remove('trips', trip.id));
    Promise.all(jobs).then(function () {
      state.currentTripId = null;
      localStorage.removeItem('ta.currentTripId');
      loadAll().then(function () { toast('הטיול נמחק'); });
    });
  });
}

export function bindStopEvents() {
  /* חלקי טיול */
  $('btn-new-stop').addEventListener('click', function () {
    if (!currentTrip() || viewingArchived()) { toast('צור קודם טיול'); return; }
    $('stop-form').reset();
    syncStopDates(); // מנקה min/max שאולי נשארו מעריכה קודמת
    $('stop-id').value = '';
    state.pendingStopGeo = null;
    $('stop-geo-info').textContent = '';
    $('stop-form-title').textContent = 'חלק חדש';
    $('stop-form').hidden = false;
  });
  $('stop-form-cancel').addEventListener('click', function () { $('stop-form').hidden = true; });
  $('stop-search').addEventListener('input', function () {
    var q = this.value.trim();
    if (q.length < 2) { $('stop-search-results').innerHTML = ''; return; }
    API.geocode(q).then(function (results) {
      $('stop-search-results').innerHTML = results.map(function (g, i) {
        return '<button type="button" data-geo="' + i + '">' + esc(g.name) + ' · ' + esc(g.country) +
          (g.admin1 ? ' · ' + esc(g.admin1) : '') + '</button>';
      }).join('');
      $('stop-search-results').querySelectorAll('button').forEach(function (btn, i) {
        btn.addEventListener('click', function () {
          var g = results[i];
          state.pendingStopGeo = g;
          $('stop-city').value = g.name;
          $('stop-country').value = g.country;
          $('stop-lat').value = g.lat;
          $('stop-lon').value = g.lon;
          $('stop-tz').value = g.timezone;
          $('stop-geo-info').textContent = '📍 ' + g.lat.toFixed(3) + ', ' + g.lon.toFixed(3) + ' · ' + g.timezone;
          $('stop-search-results').innerHTML = '';
        });
      });
    }).catch(function () {});
  });
  $('stop-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var trip = currentTrip();
    if (!trip || trip.archived) return;
    if (!dateRangeValid($('stop-arrival').value, $('stop-departure').value)) {
      toast('תאריך הסיום חייב להיות ביום ההתחלה או אחריו');
      return;
    }
    var idVal = $('stop-id').value;
    var stop = {
      tripId: trip.id,
      city: $('stop-city').value.trim(),
      country: $('stop-country').value.trim(),
      lat: $('stop-lat').value === '' ? null : Number($('stop-lat').value),
      lon: $('stop-lon').value === '' ? null : Number($('stop-lon').value),
      timezone: $('stop-tz').value || '',
      arrivalDate: $('stop-arrival').value || '',
      departureDate: $('stop-departure').value || '',
      authorName: state.author || ''
    };
    var done = function () {
      $('stop-form').hidden = true;
      loadAll().then(function () { toast('החלק נשמר'); });
    };
    if (idVal) { stop.id = Number(idVal); DB.put('stops', stop).then(done); }
    else DB.add('stops', stop).then(done);
  });
  $('stops-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = Number(btn.dataset.id);
    var stop = state.stops.find(function (s) { return s.id === id; });
    var trip = currentTrip();
    if (!stop || !trip || trip.archived) return;
    if (btn.dataset.act === 'activate') {
      trip.activeStopId = id;
      DB.put('trips', trip).then(function () { renderAll(); toast('"' + (stop.city || '') + '" הוא החלק הפעיל'); });
    } else if (btn.dataset.act === 'edit') {
      $('stop-id').value = stop.id;
      $('stop-city').value = stop.city || '';
      $('stop-country').value = stop.country || '';
      $('stop-arrival').value = stop.arrivalDate || '';
      $('stop-departure').value = stop.departureDate || '';
      syncStopDates(); // מחיל min/max נכונים מיד לפי הערכים הקיימים של החלק
      $('stop-lat').value = stop.lat == null ? '' : stop.lat;
      $('stop-lon').value = stop.lon == null ? '' : stop.lon;
      $('stop-tz').value = stop.timezone || '';
      $('stop-geo-info').textContent = stop.lat != null
        ? '📍 ' + Number(stop.lat).toFixed(3) + ', ' + Number(stop.lon).toFixed(3) + ' · ' + (stop.timezone || '')
        : 'אין קואורדינטות — חפש את העיר כדי למלא.';
      $('stop-form-title').textContent = 'עריכת חלק';
      $('stop-form').hidden = false;
      $('stop-form').scrollIntoView({ behavior: 'smooth' });
    } else if (btn.dataset.act === 'delete') {
      if (!confirm('למחוק את החלק "' + (stop.city || '') + '"?')) return;
      if (trip.activeStopId === id) trip.activeStopId = 'auto';
      DB.put('trips', trip).then(function () { return DB.remove('stops', id); })
        .then(function () { loadAll(); });
    }
  });
}

export function bindMemberEvents() {
  /* שותפים */
  $('member-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (viewingArchived()) { toast('הטיול בארכיון — לצפייה בלבד'); return; }
    var name = $('member-name').value.trim();
    if (!name) return;
    DB.add('members', { name: name, role: $('member-role').value }).then(function () {
      $('member-form').reset();
      loadAll().then(function () { toast('השותף נוסף'); });
    });
  });
  $('members-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-member-del]');
    if (!btn) return;
    DB.remove('members', Number(btn.dataset.memberDel)).then(function () { loadAll(); });
  });
}

export function bindTopEvents() {
  $('active-stop-select').addEventListener('change', function () {
    var trip = currentTrip();
    if (!trip || trip.archived) return;
    trip.activeStopId = this.value === 'auto' ? 'auto' : Number(this.value);
    DB.put('trips', trip).then(function () { renderAll(); toast('החלק הפעיל עודכן'); });
  });
  $('parts-bar').addEventListener('click', function (e) {
    var chip = e.target.closest('button[data-part]');
    if (!chip) return;
    var trip = currentTrip();
    if (!trip || trip.archived) return;
    trip.activeStopId = chip.dataset.part === 'auto' ? 'auto' : Number(chip.dataset.part);
    DB.put('trips', trip).then(function () { loadAll(); });
  });
  $('trip-select').addEventListener('change', function () {
    state.currentTripId = Number(this.value);
    localStorage.setItem('ta.currentTripId', String(state.currentTripId));
    loadAll();
  });
}
