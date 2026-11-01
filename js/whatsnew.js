/* whatsnew.js — חלון "מה חדש בגרסה": מוצג פעם אחת אחרי עדכון גרסה
   למשתמש קיים, ואפשר לפתוח אותו שוב מהאודות בהגדרות עם כל הגרסאות.
   אחרי סגירת החלון נקרא ה־hook שנרשם ב־main.js (בקשת השם, אם צריך). */

import { $, esc } from './utils.js';
import { APP_VERSION, CHANGELOG } from './version.js';
import { state } from './state.js';

var afterWhatsNewClose = null;
export function setWhatsNewAfterClose(fn) { afterWhatsNewClose = (typeof fn === 'function') ? fn : null; }

/* ---------- חלון "מה חדש בגרסה" ---------- */
export function hasAnySavedData() {
  return state.trips.length > 0 || state.stops.length > 0 || state.members.length > 0 ||
    state.journal.length > 0 || state.documents.length > 0;
}
function rememberSeenVersion() {
  try { localStorage.setItem('ta_seen_version', APP_VERSION); } catch (e) {}
}
function closeWhatsNew() {
  $('whatsnew').hidden = true;
  $('whatsnew-backdrop').hidden = true;
  rememberSeenVersion();
  if (afterWhatsNewClose) afterWhatsNewClose(); // אם צריך שם — הבקשה מופיעה מיד אחרי סגירת "מה חדש"
}
function showWhatsNew() {
  var items = CHANGELOG[APP_VERSION] || [];
  $('whatsnew-title').textContent = '🎉 מה חדש בגרסה ' + APP_VERSION;
  $('whatsnew-list').innerHTML = items.map(function (t) {
    return '<li>' + esc(t) + '</li>';
  }).join('');
  $('whatsnew').hidden = false;
  $('whatsnew-backdrop').hidden = false;
}
// פתיחה חוזרת של הגיליון מכרטיס "אודות" בהגדרות — כל הגרסאות, מהחדשה לישנה
export function showChangelogFull() {
  var html = '';
  Object.keys(CHANGELOG).forEach(function (v) {
    html += '<li class="whatsnew-ver">גרסה ' + esc(v) + '</li>';
    CHANGELOG[v].forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
  });
  $('whatsnew-title').textContent = '🎉 מה חדש — כל הגרסאות';
  $('whatsnew-list').innerHTML = html;
  $('whatsnew').hidden = false;
  $('whatsnew-backdrop').hidden = false;
}
// נקרא אחרי הטעינה הראשונית: מציג את החלון רק למי שכבר השתמש בגרסה קודמת.
// משתמש חדש לגמרי (אין גרסה שמורה ואין שום נתונים) — הגרסה נשמרת בשקט, בלי חלון.
// מחזיר true אם החלון הוצג (כדי שבקשת השם תחכה לסגירתו).
export function maybeShowWhatsNew() {
  var seen = null;
  try { seen = localStorage.getItem('ta_seen_version'); } catch (e) {}
  if (seen === APP_VERSION) return false;
  if (seen == null && !hasAnySavedData()) { rememberSeenVersion(); return false; }
  showWhatsNew();
  return true;
}

export function bindWhatsNewEvents() {
  /* חלון "מה חדש בגרסה" */
  $('whatsnew-close').addEventListener('click', closeWhatsNew);
  $('whatsnew-backdrop').addEventListener('click', closeWhatsNew);
}
