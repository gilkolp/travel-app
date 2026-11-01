/* state.js — מצב האפליקציה המשותף (טיולים, חלקים, יומן, מסמכים, בחירות נוכחיות)
   ופונקציות הגזירה ממנו: הטיול הנוכחי, חלקיו והחלק הפעיל. */

import { todayStr } from './utils.js';

export const state = {
  trips: [],
  stops: [],
  stopCounts: {},
  members: [],
  journal: [],
  documents: [],
  currentTripId: Number(localStorage.getItem('ta.currentTripId')) || null,
  // שם החתימה האוטומטי: שם המכשיר שהוגדר בכרטיס הענן (ta_display_name)
  author: (localStorage.getItem('ta_display_name') || '').trim(),
  discoverTab: 'attractions',
  discoverSeq: 0,
  pendingTripGeo: null,
  pendingStopGeo: null,
  objectUrls: []
};

export function trackUrl(url) { state.objectUrls.push(url); return url; }

/* ---------- גזירה מהמצב: טיול נוכחי, חלקים, חלק פעיל ---------- */
export function currentTrip() {
  return state.trips.find(function (t) { return t.id === state.currentTripId; }) || null;
}
/* ---------- היסטוריית טיולים (ארכיון) ----------
   טיול מאורכב (archived=true) יוצא מהרשימה הפעילה ונשמר בהיסטוריה עם
   היומן והתמונות. פתיחתו מההיסטוריה היא לצפייה בלבד (viewingArchived). */
export function isArchivedTrip(trip) { return !!(trip && trip.archived); }
export function activeTrips() { return state.trips.filter(function (t) { return !t.archived; }); }
export function archivedTrips() { return state.trips.filter(function (t) { return !!t.archived; }); }
export function viewingArchived() { return isArchivedTrip(currentTrip()); }
export function tripStops() {
  return state.stops.slice().sort(function (a, b) {
    return String(a.arrivalDate || '9999').localeCompare(String(b.arrivalDate || '9999'));
  });
}
export function autoStopId() {
  var today = todayStr();
  var stops = tripStops();
  for (var i = 0; i < stops.length; i++) {
    var s = stops[i];
    if (s.arrivalDate && s.departureDate && s.arrivalDate <= today && today <= s.departureDate) return s.id;
    if (s.arrivalDate && !s.departureDate && s.arrivalDate <= today) return s.id;
  }
  // לפני תחילת הטיול: החלק הראשון. אחרי הסוף: האחרון שכבר התחיל.
  var started = stops.filter(function (s) { return s.arrivalDate && s.arrivalDate <= today; });
  if (started.length) return started[started.length - 1].id;
  return stops.length ? stops[0].id : null;
}
export function activeStop() {
  var trip = currentTrip();
  if (!trip || trip.archived) return null; // טיול בארכיון לעולם לא מספק חלק פעיל
  var id = trip.activeStopId;
  if (id === 'auto' || id == null) id = autoStopId();
  return state.stops.find(function (s) { return s.id === id; }) || tripStops()[0] || null;
}
