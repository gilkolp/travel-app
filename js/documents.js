/* documents.js — כספת מסמכי הטיול: העלאה, צפייה, הורדה ומחיקה,
   מקובצים לפי קטגוריות (ביטוח, הזמנה, כרטיס, אחר). */

import { $, esc, toast } from './utils.js';
import { DB } from './db.js';
import { state, currentTrip, viewingArchived, trackUrl } from './state.js';
import { loadAll } from './core.js';

/* ---------- רינדור: מסמכים ---------- */
var CATEGORIES = { insurance: '🛡️ ביטוח', booking: '🏨 הזמנה', ticket: '🎫 כרטיס', other: '📄 אחר' };
export function renderDocuments() {
  var readOnly = viewingArchived();
  var form = $('document-form');
  if (form) form.hidden = readOnly;
  var list = $('documents-list');
  if (!currentTrip()) { list.innerHTML = ''; return; }
  if (!state.documents.length) {
    list.innerHTML = '<div class="card"><div class="empty">אין עדיין מסמכים. העלה ביטוח, אישורי הזמנות וכרטיסים — הכל במקום אחד.</div></div>';
    return;
  }
  var groups = {};
  state.documents.forEach(function (d) {
    var key = CATEGORIES[d.category] ? d.category : 'other';
    (groups[key] = groups[key] || []).push(d);
  });
  list.innerHTML = Object.keys(CATEGORIES).filter(function (k) { return groups[k]; }).map(function (k) {
    return '<div class="card"><h3>' + CATEGORIES[k] + '</h3>' +
      groups[k].map(function (d) {
        var url = d.file ? trackUrl(URL.createObjectURL(d.file)) : '';
        return '<div class="list-item">' +
          '<div class="item-title">' + esc(d.title) + '</div>' +
          '<div class="item-sub">' + esc(d.fileName || '') +
          (d.uploaderName ? ' · הועלה על ידי ' + esc(d.uploaderName) : '') + '</div>' +
          '<div class="item-actions">' +
          (url ? '<a class="btn small" target="_blank" rel="noopener" href="' + url + '">צפה</a>' +
            '<a class="btn small" download="' + esc(d.fileName || d.title) + '" href="' + url + '">הורד</a>' : '') +
          (readOnly ? '' : '<button class="btn small danger" data-doc-del="' + d.id + '">מחק</button>') +
          '</div></div>';
      }).join('') + '</div>';
  }).join('');
}

export function bindDocumentEvents() {
  /* מסמכים */
  $('document-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var trip = currentTrip();
    if (!trip) { toast('צור קודם טיול'); return; }
    if (trip.archived) { toast('הטיול בארכיון — לצפייה בלבד'); return; }
    var file = $('document-file').files[0];
    if (!file) return;
    DB.add('documents', {
      tripId: trip.id,
      title: $('document-title').value.trim(),
      category: $('document-category').value,
      file: file,
      fileName: file.name,
      uploaderName: state.author || ''
    }).then(function () {
      $('document-form').reset();
      loadAll().then(function () { toast('המסמך הועלה'); });
    });
  });
  $('documents-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-doc-del]');
    if (!btn) return;
    if (!confirm('למחוק את המסמך?')) return;
    DB.remove('documents', Number(btn.dataset.docDel)).then(function () { loadAll(); });
  });
}
