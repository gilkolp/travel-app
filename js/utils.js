/* utils.js — עזרים טהורים: DOM, בריחה מ־HTML, תאריכים, קישור טווחי תאריכים,
   טוסטים ואחסון מקומי (localStorage). בלי תלות במודולים אחרים. */

export const $ = function (id) { return document.getElementById(id); };

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function todayStr(d) {
  d = d || new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}
export function addDays(dateStr, n) {
  var d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
export function fmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })
      .format(new Date(dateStr + 'T12:00:00'));
  } catch (e) { return dateStr; }
}
export function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })
      .format(new Date(dateStr + 'T12:00:00'));
  } catch (e) { return dateStr; }
}
/* ---------- קישור תאריכי טווח (התחלה ↔ סיום) ----------
   בכל זוג שדות תאריך של טווח: הסיום לא יכול להיות לפני ההתחלה.
   בחירת התחלה מעדכנת את min של הסיום (ומתקנת ערך סיום סותר להתחלה),
   ובחירת סיום מעדכנת את max של ההתחלה (ומתקנת ערך התחלה סותר לסיום). */
export function linkDateRange(startEl, endEl) {
  function syncFromStart() {
    var s = startEl.value;
    if (s) {
      endEl.min = s;
      if (endEl.value && endEl.value < s) endEl.value = s;
    } else {
      endEl.removeAttribute('min');
    }
    if (endEl.value) startEl.max = endEl.value;
    else startEl.removeAttribute('max');
  }
  function syncFromEnd() {
    var e = endEl.value;
    if (e) {
      startEl.max = e;
      if (startEl.value && startEl.value > e) startEl.value = e;
    } else {
      startEl.removeAttribute('max');
    }
    if (startEl.value) endEl.min = startEl.value;
    else endEl.removeAttribute('min');
  }
  function syncAll() { syncFromStart(); syncFromEnd(); }
  ['change', 'input'].forEach(function (ev) {
    startEl.addEventListener(ev, syncFromStart);
    endEl.addEventListener(ev, syncFromEnd);
  });
  syncAll(); // יישום מיידי על ערכים קיימים (למשל בפתיחת טופס עריכה)
  return syncAll;
}
// רשת ביטחון לפני שמירה: הטווח תקין אם אחד הצדדים ריק או שהסיום לא לפני ההתחלה
export function dateRangeValid(start, end) {
  return !start || !end || end >= start;
}

export function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function () { t.hidden = true; }, 2600);
}
export function blobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* ---------- אחסון מקומי (localStorage) ---------- */
export function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
export function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
export function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }
