/* clocks.js — עיר הבית (השעון הימני בכותרת) ושעוני הכותרת:
   שעון הבית לפי עיר הבית המוגדרת, ושעון היעד לפי החלק הפעיל. */

import { $ } from './utils.js';
import { currentTrip, activeStop } from './state.js';

/* ---------- עיר הבית (השעון הימני) ----------
   נשמרת ב־localStorage 'ta_home_base' כ־{name, country, lat, lon, timezone}.
   אזור הזמן מגיע מחיפוש העיר (Open-Meteo) — בדיוק כמו לחלקי הטיול.
   כשלא הוגדרה: ירושלים, Asia/Jerusalem (כמו שהיה עד עכשיו). */
export const HOME_BASE_KEY = 'ta_home_base';
var HOME_BASE_DEFAULT = { name: 'ירושלים', country: 'ישראל', lat: 31.7683, lon: 35.2137, timezone: 'Asia/Jerusalem' };
export function getHomeBase() {
  try {
    var raw = localStorage.getItem(HOME_BASE_KEY);
    if (raw) {
      var hb = JSON.parse(raw);
      if (hb && hb.timezone) {
        return {
          name: hb.name || HOME_BASE_DEFAULT.name,
          country: hb.country || '',
          lat: hb.lat != null ? hb.lat : HOME_BASE_DEFAULT.lat,
          lon: hb.lon != null ? hb.lon : HOME_BASE_DEFAULT.lon,
          timezone: hb.timezone
        };
      }
    }
  } catch (e) {}
  return HOME_BASE_DEFAULT;
}
export function isHomeBaseCustom() {
  try { return !!localStorage.getItem(HOME_BASE_KEY); } catch (e) { return false; }
}

/* ---------- שעונים ---------- */
function tickClock(el, dateEl, tz) {
  try {
    var now = new Date();
    el.textContent = new Intl.DateTimeFormat('he-IL', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(now);
    dateEl.textContent = new Intl.DateTimeFormat('he-IL', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long'
    }).format(now);
  } catch (e) {
    el.textContent = '--:--:--'; dateEl.textContent = '';
  }
}
export function tickClocks() {
  var hb = getHomeBase();
  var homeLabel = $('clock-home-label');
  if (homeLabel) homeLabel.textContent = '🏠 ' + hb.name;
  tickClock($('clock-il'), $('date-il'), hb.timezone);
  var stop = activeStop();
  var trip = currentTrip();
  var label = $('clock-dest-label');
  if (stop) {
    label.textContent = '📍 ' + (stop.city || stop.country || 'היעד');
    tickClock($('clock-dest'), $('date-dest'), stop.timezone || 'UTC');
  } else if (trip && trip.archived) {
    label.textContent = '📚 ' + (trip.name || 'טיול בארכיון');
    $('clock-dest').textContent = '--:--:--';
    $('date-dest').textContent = 'טיול בארכיון';
  } else if (trip) {
    label.textContent = '🌍 ' + (trip.country || 'היעד');
    $('clock-dest').textContent = '--:--:--';
    $('date-dest').textContent = 'הוסף חלק במסלול';
  } else {
    label.textContent = '🌍 היעד';
    $('clock-dest').textContent = '--:--:--';
    $('date-dest').textContent = '';
  }
}
