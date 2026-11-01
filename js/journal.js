/* journal.js — יומן הטיול (רשומות, תמונות, חתימת כותב), מצגת הסיום,
   וייצוא עמוד השיתוף העצמאי למשפחה ולחברים. */

import { $, esc, fmtDate, fmtDateShort, todayStr, toast, blobToDataUrl } from './utils.js';
import { DB } from './db.js';
import { state, currentTrip, tripStops, activeStop, viewingArchived, trackUrl } from './state.js';
import { loadAll } from './core.js';

/* ---------- רינדור: יומן ---------- */
export function renderJournal() {
  var readOnly = viewingArchived();
  var form = $('journal-form');
  if (form) form.hidden = readOnly;
  var list = $('journal-list');
  if (!currentTrip()) { list.innerHTML = ''; return; }
  if (!state.journal.length) {
    list.innerHTML = '<div class="card"><div class="empty">היומן ריק.' +
      (readOnly ? '' : ' הוסף את הרשומה הראשונה.') + '</div></div>';
    return;
  }
  list.innerHTML = state.journal.map(function (j) {
    var img = '';
    if (j.photo) {
      img = '<img class="journal-photo" alt="" src="' + trackUrl(URL.createObjectURL(j.photo)) + '">';
    }
    return '<div class="card">' +
      '<div class="item-sub">' + esc(fmtDateShort(j.date)) +
      (j.authorName ? ' · נכתב על ידי ' + esc(j.authorName) : '') + '</div>' +
      (j.text ? '<div>' + esc(j.text) + '</div>' : '') + img +
      (readOnly ? '' :
      '<div class="item-actions"><button class="btn small danger" data-journal-del="' + j.id + '">מחק רשומה</button></div>') +
      '</div>';
  }).join('');
}

/* ---------- מצגת סיום ---------- */
var slideshow = { entries: [], idx: 0, timer: null };
function openSlideshow() {
  if (!state.journal.length) { toast('היומן ריק — אין מה להציג עדיין'); return; }
  slideshow.entries = state.journal.slice()
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  slideshow.idx = 0;
  $('slideshow').hidden = false;
  showSlide(0);
  slideshow.timer = setInterval(function () { showSlide(slideshow.idx + 1); }, 4500);
}
function closeSlideshow() {
  $('slideshow').hidden = true;
  if (slideshow.timer) clearInterval(slideshow.timer);
  slideshow.timer = null;
}
function showSlide(i) {
  var n = slideshow.entries.length;
  if (!n) return;
  slideshow.idx = ((i % n) + n) % n;
  var entry = slideshow.entries[slideshow.idx];
  var img = $('slideshow-img');
  if (entry.photo) {
    img.src = trackUrl(URL.createObjectURL(entry.photo));
    img.style.display = '';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
  }
  $('slideshow-caption').innerHTML =
    '<span class="cap-date">' + esc(fmtDateShort(entry.date)) +
    (entry.authorName ? ' · ' + esc(entry.authorName) : '') + '</span>' + esc(entry.text || '');
  $('slideshow-counter').textContent = (slideshow.idx + 1) + ' / ' + n;
}

/* ---------- שיתוף: ייצוא עמוד HTML עצמאי ---------- */
function exportSharePage() {
  var trip = currentTrip();
  if (!trip) { toast('אין טיול לשתף עדיין'); return; }
  var stop = activeStop();
  var entries = state.journal.slice()
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  var photoPromises = entries.map(function (j) {
    return j.photo ? blobToDataUrl(j.photo).catch(function () { return ''; }) : Promise.resolve('');
  });
  Promise.all(photoPromises).then(function (photoUrls) {
    var stopsHtml = tripStops().map(function (s) {
      var isActive = stop && s.id === stop.id;
      return '<li>' + esc(s.city || s.country || 'חלק') +
        (s.country && s.city ? ' · ' + esc(s.country) : '') +
        (s.arrivalDate ? ' · ' + fmtDate(s.arrivalDate) : '') +
        (s.departureDate ? ' ← ' + fmtDate(s.departureDate) : '') +
        (isActive ? ' <strong>(אנחנו כאן עכשיו)</strong>' : '') + '</li>';
    }).join('');
    var journalHtml = entries.map(function (j, i) {
      return '<article>' +
        '<div class="date">' + esc(fmtDateShort(j.date)) +
        (j.authorName ? ' · ' + esc(j.authorName) : '') + '</div>' +
        (j.text ? '<p>' + esc(j.text) + '</p>' : '') +
        (photoUrls[i] ? '<img src="' + photoUrls[i] + '" alt="">' : '') +
        '</article>';
    }).join('');
    var html = '<!DOCTYPE html>\n<html lang="he" dir="rtl"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(trip.name) + ' — שיתוף טיול</title>' +
      '<style>body{font-family:system-ui,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;background:#f4f6f5;color:#1c2420}' +
      'h1{color:#0e7c66}article{background:#fff;border:1px solid #dde5e1;border-radius:12px;padding:14px;margin:12px 0}' +
      'article img{width:100%;border-radius:8px}.date{color:#6b7a73;font-size:.9rem}li{margin:6px 0}</style></head><body>' +
      '<h1>' + esc(trip.name) + '</h1>' +
      '<p>' + esc(trip.country || '') +
      (trip.startDate ? ' · ' + fmtDate(trip.startDate) : '') +
      (trip.endDate ? ' ← ' + fmtDate(trip.endDate) : '') + '</p>' +
      '<h2>המסלול</h2><ul>' + (stopsHtml || '<li>טרם הוגדר מסלול</li>') + '</ul>' +
      (stop ? '<p><strong>החלק הפעיל עכשיו:</strong> ' + esc(stop.city || stop.country || '') + '</p>' : '') +
      '<h2>היומן</h2>' + (journalHtml || '<p>היומן עדיין ריק.</p>') +
      '<p style="color:#6b7a73;font-size:.85rem">עמוד צפייה בלבד · נוצר מאפליקציית הטיולים</p>' +
      '</body></html>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trip-share.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('עמוד השיתוף הורד — אפשר לשלוח אותו למשפחה');
  });
}

export function bindJournalEvents() {
  /* יומן */
  $('journal-date').value = todayStr();
  $('journal-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var trip = currentTrip();
    if (!trip) { toast('צור קודם טיול'); return; }
    if (trip.archived) { toast('הטיול בארכיון — לצפייה בלבד'); return; }
    var entry = {
      tripId: trip.id,
      date: $('journal-date').value || todayStr(),
      text: $('journal-text').value.trim(),
      photo: null,
      authorName: state.author || ''
    };
    var file = $('journal-photo').files[0];
    function save() {
      DB.add('journal', entry).then(function () {
        $('journal-form').reset();
        $('journal-date').value = todayStr();
        loadAll().then(function () { toast('נוסף ליומן'); });
      });
    }
    if (file) {
      // דחיסת תמונה לפני שמירה, כדי לא לנפח את האחסון המקומי
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 1280;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) { entry.photo = blob; save(); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); entry.photo = file; save(); };
      img.src = url;
    } else {
      save();
    }
  });
  $('journal-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-journal-del]');
    if (!btn) return;
    if (!confirm('למחוק את הרשומה?')) return;
    DB.remove('journal', Number(btn.dataset.journalDel)).then(function () { loadAll(); });
  });
  /* מצגת */
  $('btn-slideshow').addEventListener('click', openSlideshow);
  $('slideshow-close').addEventListener('click', closeSlideshow);
  $('slideshow-next').addEventListener('click', function () { showSlide(slideshow.idx + 1); });
  $('slideshow-prev').addEventListener('click', function () { showSlide(slideshow.idx - 1); });
  /* שיתוף */
  $('btn-export-share').addEventListener('click', exportSharePage);
}
