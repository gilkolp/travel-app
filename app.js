/* app.js — הלוגיקה של אפליקציית הטיולים.
   המודל: טיול -> חלקי טיול (ערים/מדינה כללית) -> החלק הפעיל מכוון את כל המסכים.
   יומן, מצגת ומסמכים הם לכל הטיול. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    trips: [],
    stops: [],
    members: [],
    journal: [],
    documents: [],
    currentTripId: Number(localStorage.getItem('ta.currentTripId')) || null,
    author: localStorage.getItem('ta.author') || '',
    discoverTab: 'attractions',
    discoverSeq: 0,
    pendingTripGeo: null,
    pendingStopGeo: null,
    objectUrls: []
  };

  /* ---------- עזרים ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function todayStr(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }
  function fmtDate(dateStr) {
    if (!dateStr) return '';
    try {
      return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })
        .format(new Date(dateStr + 'T12:00:00'));
    } catch (e) { return dateStr; }
  }
  function fmtDateShort(dateStr) {
    if (!dateStr) return '';
    try {
      return new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })
        .format(new Date(dateStr + 'T12:00:00'));
    } catch (e) { return dateStr; }
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function trackUrl(url) { state.objectUrls.push(url); return url; }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  /* ---------- טעינת נתונים ---------- */
  function currentTrip() {
    return state.trips.find(function (t) { return t.id === state.currentTripId; }) || null;
  }
  function tripStops() {
    return state.stops.slice().sort(function (a, b) {
      return String(a.arrivalDate || '9999').localeCompare(String(b.arrivalDate || '9999'));
    });
  }
  function autoStopId() {
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
  function activeStop() {
    var trip = currentTrip();
    if (!trip) return null;
    var id = trip.activeStopId;
    if (id === 'auto' || id == null) id = autoStopId();
    return state.stops.find(function (s) { return s.id === id; }) || tripStops()[0] || null;
  }

  function loadAll() {
    return Promise.all([
      DB.getAll('trips'), DB.getAll('stops'), DB.getAll('members'),
      DB.getAll('journal'), DB.getAll('documents')
    ]).then(function (res) {
      state.trips = res[0];
      state.members = res[2];
      if (!state.trips.find(function (t) { return t.id === state.currentTripId; })) {
        state.currentTripId = state.trips.length ? state.trips[0].id : null;
      }
      var trip = currentTrip();
      state.stops = res[1].filter(function (s) { return trip && s.tripId === trip.id; });
      state.journal = res[3].filter(function (j) { return trip && j.tripId === trip.id; })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      state.documents = res[4].filter(function (d) { return trip && d.tripId === trip.id; });
      renderAll();
    });
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
  function tickClocks() {
    tickClock($('clock-il'), $('date-il'), 'Asia/Jerusalem');
    var stop = activeStop();
    var trip = currentTrip();
    var label = $('clock-dest-label');
    if (stop) {
      label.textContent = '📍 ' + (stop.city || stop.country || 'היעד');
      tickClock($('clock-dest'), $('date-dest'), stop.timezone || 'UTC');
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

  /* ---------- ניווט ---------- */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = $('screen-' + name);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.screen === name);
    });
    if (name === 'home') renderWeather();
    if (name === 'stay') renderStay();
    if (name === 'discover') renderDiscoverHead();
    window.scrollTo(0, 0);
  }

  /* ---------- רינדור: בוררים עליונים ---------- */
  function renderTopSelectors() {
    var stopSel = $('active-stop-select');
    var stops = tripStops();
    var trip = currentTrip();
    var html = '';
    if (!trip) {
      html = '<option value="">אין טיול</option>';
    } else {
      html = '<option value="auto">🔄 אוטומטי (לפי התאריך של היום)</option>' +
        stops.map(function (s) {
          return '<option value="' + s.id + '">' + esc(s.city || s.country || 'חלק') + '</option>';
        }).join('');
    }
    stopSel.innerHTML = html;
    stopSel.value = trip && trip.activeStopId != null ? String(trip.activeStopId) : 'auto';

    var authorSel = $('author-select');
    var names = state.members.map(function (m) { return m.name; });
    if (state.author && names.indexOf(state.author) === -1) names.unshift(state.author);
    authorSel.innerHTML = '<option value="">— בחר מעדכן —</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    authorSel.value = state.author || '';
  }

  /* ---------- רינדור: בית ---------- */
  function renderHome() {
    var trip = currentTrip();
    $('no-trip-msg').hidden = !!trip;
    $('trip-box').hidden = !trip;
    if (trip) {
      $('trip-select').innerHTML = state.trips.map(function (t) {
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
  }

  /* ---------- השלמת קואורדינטות אוטומטית ----------
     חלק שנוצר בלי קואורדינטות (למשל החלק הכללי של הטיול) — משלימים לפי שם העיר/המדינה
     ושומרים חזרה ל־DB, כדי שמזג האוויר והגילוי יעבדו גם עליו. */
  var coordsAttempted = {}; // stopId -> true : כבר נעשה ניסיון השלמה (הצליח או נכשל) במפגש הזה
  var coordsInFlight = {};  // stopId -> Promise<boolean>
  function ensureStopCoords(stop) {
    if (!stop || stop.lat != null) return Promise.resolve(false);
    if (coordsAttempted[stop.id]) return Promise.resolve(false);
    if (coordsInFlight[stop.id]) return coordsInFlight[stop.id];
    var name = (stop.city || '').trim() || (stop.country || '').trim();
    if (!name) { coordsAttempted[stop.id] = true; return Promise.resolve(false); }
    var p = API.geocode(name).then(function (res) {
      coordsAttempted[stop.id] = true;
      delete coordsInFlight[stop.id];
      if (res && res.length) {
        stop.lat = res[0].lat;
        stop.lon = res[0].lon;
        if (res[0].timezone) stop.timezone = res[0].timezone;
        return DB.put('stops', stop).then(
          function () { return true; },
          function () { return true; } // גם אם השמירה נכשלה, בזיכרון יש קואורדינטות
        );
      }
      return false;
    }).catch(function () {
      coordsAttempted[stop.id] = true;
      delete coordsInFlight[stop.id];
      return false;
    });
    coordsInFlight[stop.id] = p;
    return p;
  }

  /* ---------- מזג אוויר ---------- */
  function weatherRange() {
    var stop = activeStop();
    var today = todayStr();
    if (stop && stop.arrivalDate && stop.departureDate) {
      if (stop.departureDate < today) {
        // החלק כבר הסתיים — מציגים תחזית לשבוע הקרוב במיקום החלק
        return { stop: stop, start: today, end: addDays(today, 6), finished: true };
      }
      var start = stop.arrivalDate < today ? today : stop.arrivalDate;
      var end = stop.departureDate;
      // ה־API החינמי מוגבל לכ־16 יום קדימה
      var maxEnd = addDays(today, 15);
      if (end > maxEnd) end = maxEnd;
      if (start > end) start = end;
      return { stop: stop, start: start, end: end, finished: false };
    }
    return { stop: stop, start: today, end: addDays(today, 6), finished: false };
  }
  function renderWeather() {
    var box = $('weather-days');
    var placeEl = $('weather-place');
    var stop = activeStop();
    if (!stop) {
      placeEl.textContent = 'בחר טיול וחלק עם מיקום כדי לראות מזג אוויר.';
      box.innerHTML = '';
      return;
    }
    if (stop.lat == null || stop.lon == null) {
      if (coordsAttempted[stop.id]) {
        placeEl.textContent = 'בחר טיול וחלק עם מיקום כדי לראות מזג אוויר.';
        box.innerHTML = '';
      } else {
        placeEl.textContent = 'מאתר את מיקום החלק "' + (stop.city || stop.country || '') + '"…';
        ensureStopCoords(stop).then(function () { renderAll(); });
      }
      return;
    }
    var range = weatherRange();
    if (range.finished) {
      placeEl.textContent = 'החלק "' + (stop.city || stop.country || '') + '" כבר הסתיים — ' +
        'הנה תחזית לשבוע הקרוב ב' + (stop.city || stop.country || '') +
        ' · ' + fmtDate(range.start) + ' ← ' + fmtDate(range.end);
    } else {
      placeEl.textContent = 'מזג אוויר ב' + (stop.city || stop.country || '') +
        ' · ' + fmtDate(range.start) + ' ← ' + fmtDate(range.end);
    }
    box.innerHTML = '<div class="muted">טוען תחזית…</div>';
    API.fetchWeather(stop.lat, stop.lon, range.start, range.end).then(function (days) {
      if (!days.length) { box.innerHTML = '<div class="muted">אין תחזית זמינה לטווח הזה.</div>'; return; }
      box.innerHTML = days.map(function (d) {
        return '<div class="wday">' +
          '<div class="wdate">' + esc(fmtDateShort(d.date)) + '</div>' +
          '<div class="wicon">' + d.icon + '</div>' +
          '<div class="wtemp">' + d.tmax + '° / ' + d.tmin + '°</div>' +
          '<div class="wdesc">' + esc(d.desc) + '</div>' +
          (d.rainProb != null ? '<div class="wrain">💧 ' + d.rainProb + '%</div>' : '') +
          '</div>';
      }).join('');
    }).catch(function () {
      box.innerHTML = '<div class="muted">לא הצלחתי לטעון תחזית (נדרש חיבור לאינטרנט).</div>';
    });
  }

  /* ---------- רינדור: מסלול ושותפים ---------- */
  function renderRoute() {
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
          '<div class="item-actions">' +
          '<button class="btn small" data-act="activate" data-id="' + s.id + '">סמן כחלק פעיל</button>' +
          '<button class="btn small" data-act="edit" data-id="' + s.id + '">ערוך</button>' +
          '<button class="btn small danger" data-act="delete" data-id="' + s.id + '">מחק</button>' +
          '</div></div>';
      }).join('');
    }

    var ml = $('members-list');
    if (!state.members.length) {
      ml.innerHTML = '<div class="empty">אין עדיין שותפים. הוסף את מי שטס איתך.</div>';
    } else {
      ml.innerHTML = state.members.map(function (m) {
        return '<div class="list-item"><div class="item-title">' + esc(m.name) +
          '<span class="badge gray">' + (m.role === 'follower' ? 'עוקב' : 'שותף מעדכן') + '</span></div>' +
          '<div class="item-actions"><button class="btn small danger" data-member-del="' + m.id + '">הסר</button></div></div>';
      }).join('');
    }
  }

  /* ---------- רינדור: גילוי ---------- */
  function renderDiscoverHead() {
    var stop = activeStop();
    $('discover-place').textContent = stop
      ? 'מחפשים סביב החלק הפעיל: ' + (stop.city || stop.country || '') +
        (stop.lat == null ? ' (לחלק הזה אין עדיין קואורדינטות — הן יושלמו אוטומטית לפי שם העיר)' : '')
      : 'אין חלק פעיל. צור טיול וחלק במסלול, או השתמש ב"מסביבי עכשיו".';
    document.querySelectorAll('#discover-tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === state.discoverTab);
    });
  }
  function renderPlaces(places, kindLabel) {
    var box = $('discover-results');
    if (!places.length) {
      box.innerHTML = '<div class="empty">לא נמצאו ' + esc(kindLabel) + ' באזור הזה ב־OpenStreetMap.</div>';
      return;
    }
    box.innerHTML = places.map(function (p) {
      return '<div class="list-item">' +
        '<div class="item-title">' + esc(p.name) + '</div>' +
        '<div class="item-sub">' +
        (p.kind ? esc(p.kind) + ' · ' : '') + API.formatDistance(p.distanceKm) +
        (p.cuisine ? ' · ' + esc(p.cuisine) : '') +
        (p.openingHours ? '<br>🕐 ' + esc(p.openingHours) : '') +
        '</div>' +
        '<div class="item-actions">' +
        '<a class="btn small navlink" target="_blank" rel="noopener" href="' + API.mapsLink(p) + '">🧭 ניווט במפות</a>' +
        (p.website ? '<a class="btn small" target="_blank" rel="noopener" href="' + esc(p.website) + '">אתר</a>' : '') +
        '</div></div>';
    }).join('');
  }
  function runDiscover(lat, lon, sourceLabel) {
    var status = $('discover-status');
    var tab = state.discoverTab;
    // מונה רצף: תגובה של חיפוש ישן (למשל אטרקציות אטי) לא תדרוס תוצאות של חיפוש חדש יותר
    var seq = ++state.discoverSeq;
    var fn = tab === 'kosher' ? API.findKosher : (tab === 'chabad' ? API.findChabad : API.findAttractions);
    var label = tab === 'kosher' ? 'מקומות כשרים' : (tab === 'chabad' ? 'בתי חב״ד' : 'אטרקציות');
    status.textContent = 'מחפש ' + label + ' סביב ' + sourceLabel + '…';
    $('discover-results').innerHTML = '';
    fn(lat, lon).then(function (places) {
      if (seq !== state.discoverSeq) return; // חיפוש חדש יותר כבר רץ — מתעלמים
      status.textContent = 'נמצאו ' + places.length + ' ' + label + ' סביב ' + sourceLabel + ' (מקור: OpenStreetMap).';
      renderPlaces(places, label);
    }).catch(function () {
      if (seq !== state.discoverSeq) return;
      status.textContent = 'החיפוש נכשל — בדוק חיבור לאינטרנט ונסה שוב.';
    });
  }

  /* ---------- רינדור: לינה ---------- */
  function renderStay() {
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
  }

  /* ---------- רינדור: יומן ---------- */
  function renderJournal() {
    var list = $('journal-list');
    if (!currentTrip()) { list.innerHTML = ''; return; }
    if (!state.journal.length) {
      list.innerHTML = '<div class="card"><div class="empty">היומן ריק. הוסף את הרשומה הראשונה.</div></div>';
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
        '<div class="item-actions"><button class="btn small danger" data-journal-del="' + j.id + '">מחק רשומה</button></div>' +
        '</div>';
    }).join('');
  }

  /* ---------- רינדור: מסמכים ---------- */
  var CATEGORIES = { insurance: '🛡️ ביטוח', booking: '🏨 הזמנה', ticket: '🎫 כרטיס', other: '📄 אחר' };
  function renderDocuments() {
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
            '<button class="btn small danger" data-doc-del="' + d.id + '">מחק</button>' +
            '</div></div>';
        }).join('') + '</div>';
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

  /* ---------- פס חלקי הטיול (צ'יפים בראש המסך) ---------- */
  function renderPartsBar() {
    var bar = $('parts-bar');
    if (!bar) return;
    var trip = currentTrip();
    if (!trip) { bar.hidden = true; bar.innerHTML = ''; return; }
    var stops = tripStops();
    var mode = trip.activeStopId == null ? 'auto' : trip.activeStopId;
    var current = activeStop();
    var html = '<button type="button" class="part-chip' + (mode === 'auto' ? ' active' : '') +
      '" data-part="auto">🔄 אוטומטי</button>';
    html += stops.map(function (s) {
      var isSelected = mode !== 'auto' && Number(mode) === s.id;
      var isCurrent = current && current.id === s.id;
      return '<button type="button" class="part-chip' + (isSelected ? ' active' : '') +
        '" data-part="' + s.id + '">' + esc(s.city || s.country || 'חלק') +
        (mode === 'auto' && isCurrent ? ' • עכשיו' : '') + '</button>';
    }).join('');
    bar.innerHTML = html;
    bar.hidden = false;
  }

  /* ---------- רינדור כולל ---------- */
  function renderAll() {
    state.objectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.objectUrls = [];
    renderTopSelectors();
    renderPartsBar();
    tickClocks();
    renderHome();
    renderWeather();
    renderRoute();
    renderDiscoverHead();
    renderJournal();
    renderDocuments();
  }

  /* ---------- אירועים ---------- */
  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { showScreen(b.dataset.screen); });
    });
    document.querySelectorAll('.shortcut').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.tab) { state.discoverTab = b.dataset.tab; state.discoverSeq++; }
        showScreen(b.dataset.goto);
      });
    });
    document.querySelectorAll('#discover-tabs .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        state.discoverTab = t.dataset.tab;
        state.discoverSeq++; // מבטל תוצאות של חיפוש שעדיין רץ מהלשונית הקודמת
        renderDiscoverHead();
        $('discover-results').innerHTML = '';
        $('discover-status').textContent = '';
      });
    });

    $('active-stop-select').addEventListener('change', function () {
      var trip = currentTrip();
      if (!trip) return;
      trip.activeStopId = this.value === 'auto' ? 'auto' : Number(this.value);
      DB.put('trips', trip).then(function () { renderAll(); toast('החלק הפעיל עודכן'); });
    });
    $('parts-bar').addEventListener('click', function (e) {
      var chip = e.target.closest('button[data-part]');
      if (!chip) return;
      var trip = currentTrip();
      if (!trip) return;
      trip.activeStopId = chip.dataset.part === 'auto' ? 'auto' : Number(chip.dataset.part);
      DB.put('trips', trip).then(function () { loadAll(); });
    });
    $('author-select').addEventListener('change', function () {
      state.author = this.value;
      localStorage.setItem('ta.author', state.author);
    });
    $('trip-select').addEventListener('change', function () {
      state.currentTripId = Number(this.value);
      localStorage.setItem('ta.currentTripId', String(state.currentTripId));
      loadAll();
    });

    /* טיול חדש */
    $('btn-new-trip').addEventListener('click', function () {
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

    /* חלקי טיול */
    $('btn-new-stop').addEventListener('click', function () {
      if (!currentTrip()) { toast('צור קודם טיול'); return; }
      $('stop-form').reset();
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
      if (!trip) return;
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
      if (!stop || !trip) return;
      if (btn.dataset.act === 'activate') {
        trip.activeStopId = id;
        DB.put('trips', trip).then(function () { renderAll(); toast('"' + (stop.city || '') + '" הוא החלק הפעיל'); });
      } else if (btn.dataset.act === 'edit') {
        $('stop-id').value = stop.id;
        $('stop-city').value = stop.city || '';
        $('stop-country').value = stop.country || '';
        $('stop-arrival').value = stop.arrivalDate || '';
        $('stop-departure').value = stop.departureDate || '';
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

    /* שותפים */
    $('member-form').addEventListener('submit', function (e) {
      e.preventDefault();
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

    /* מזג אוויר */
    $('btn-refresh-weather').addEventListener('click', renderWeather);

    /* יומן */
    $('journal-date').value = todayStr();
    $('journal-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var trip = currentTrip();
      if (!trip) { toast('צור קודם טיול'); return; }
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

    /* מסמכים */
    $('document-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var trip = currentTrip();
      if (!trip) { toast('צור קודם טיול'); return; }
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

    /* שיתוף */
    $('btn-export-share').addEventListener('click', exportSharePage);
  }

  /* ---------- אתחול ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    loadAll();
    tickClocks();
    setInterval(tickClocks, 1000);
  });
})();
