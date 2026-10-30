/* api.js — שירותים חיצוניים חינמיים בלי מפתח:
   Open-Meteo (חיפוש יעד + מזג אוויר), Overpass של OpenStreetMap (מקומות סביב נקודה). */
(function () {
  'use strict';

  var OVERPASS_URLS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];
  var GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

  /* ---------- חיפוש יעד: שם -> קואורדינטות + אזור זמן ---------- */
  function geocode(query) {
    var url = GEOCODING_URL + '?name=' + encodeURIComponent(query) +
      '&count=6&language=he&format=json';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('geocoding failed: ' + r.status);
      return r.json();
    }).then(function (data) {
      return (data.results || []).map(function (g) {
        return {
          name: g.name,
          country: g.country || '',
          admin1: g.admin1 || '',
          lat: g.latitude,
          lon: g.longitude,
          timezone: g.timezone || 'UTC'
        };
      });
    });
  }

  /* ---------- מזג אוויר ---------- */
  var WMO = {
    0: ['☀️', 'בהיר'], 1: ['🌤️', 'בהיר ברובו'], 2: ['⛅', 'מעונן חלקית'], 3: ['☁️', 'מעונן'],
    45: ['🌫️', 'ערפל'], 48: ['🌫️', 'ערפל'],
    51: ['🌦️', 'טפטוף קל'], 53: ['🌦️', 'טפטוף'], 55: ['🌦️', 'טפטוף'],
    56: ['🌧️', 'טפטוף קופא'], 57: ['🌧️', 'טפטוף קופא'],
    61: ['🌧️', 'גשם קל'], 63: ['🌧️', 'גשם'], 65: ['🌧️', 'גשם חזק'],
    66: ['🌧️', 'גשם קופא'], 67: ['🌧️', 'גשם קופא'],
    71: ['🌨️', 'שלג קל'], 73: ['🌨️', 'שלג'], 75: ['🌨️', 'שלג כבד'], 77: ['🌨️', 'גרגרי שלג'],
    80: ['🌦️', 'ממטרים קלים'], 81: ['🌦️', 'ממטרים'], 82: ['🌦️', 'ממטרים עזים'],
    85: ['🌨️', 'ממטרי שלג'], 86: ['🌨️', 'ממטרי שלג'],
    95: ['⛈️', 'סופת רעמים'], 96: ['⛈️', 'סופת רעמים וברד'], 99: ['⛈️', 'סופת רעמים וברד']
  };
  function wmo(code) { return WMO[code] || ['🌡️', '—']; }

  function fetchWeather(lat, lon, startDate, endDate) {
    var url = FORECAST_URL + '?latitude=' + lat + '&longitude=' + lon +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&start_date=' + startDate + '&end_date=' + endDate;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('forecast failed: ' + r.status);
      return r.json();
    }).then(function (data) {
      var d = data.daily || {};
      var days = [];
      (d.time || []).forEach(function (date, i) {
        var w = wmo(d.weather_code[i]);
        days.push({
          date: date,
          code: d.weather_code[i],
          icon: w[0],
          desc: w[1],
          tmax: Math.round(d.temperature_2m_max[i]),
          tmin: Math.round(d.temperature_2m_min[i]),
          rainProb: (d.precipitation_probability_max && d.precipitation_probability_max[i] != null)
            ? d.precipitation_probability_max[i] : null
        });
      });
      return days;
    });
  }

  /* ---------- מרחקים ---------- */
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function formatDistance(km) {
    if (km == null || isNaN(km)) return '';
    if (km < 1) return Math.round(km * 1000) + ' מ׳';
    return km.toFixed(1).replace(/\.0$/, '') + ' ק״מ';
  }

  /* ---------- Overpass: מקומות סביב נקודה ---------- */
  function overpassOnce(url, query) {
    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, 45000)
      : null;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json'
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('overpass failed: ' + r.status);
      return r.json();
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }
  // ניסיון מול כל שרת ברשימה לפי הסדר — אם אחד נכשל או נתקע, עוברים לבא.
  function overpass(query) {
    var chain = Promise.reject(new Error('no endpoint tried yet'));
    OVERPASS_URLS.forEach(function (url) {
      chain = chain.catch(function () { return overpassOnce(url, query); });
    });
    return chain.then(function (data) { return data.elements || []; });
  }

  function elementToPlace(el, centerLat, centerLon) {
    var lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    var lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lon == null) return null;
    var tags = el.tags || {};
    var nm = tags['name:he'] || tags['name:en'] || tags.name || '';
    if (!nm) return null;
    return {
      name: nm,
      localName: (tags.name && tags.name !== nm) ? tags.name : '',
      searchText: (tags.name || '') + ' ' + (tags['name:he'] || '') + ' ' + (tags['name:en'] || ''),
      lat: lat,
      lon: lon,
      kind: tags.tourism || tags.amenity || tags.historic || tags.leisure || '',
      cuisine: tags.cuisine || '',
      openingHours: tags.opening_hours || '',
      website: tags.website || tags['contact:website'] || '',
      distanceKm: haversineKm(centerLat, centerLon, lat, lon)
    };
  }

  function collect(elements, centerLat, centerLon, limit) {
    var seen = {}, out = [];
    elements.forEach(function (el) {
      var p = elementToPlace(el, centerLat, centerLon);
      if (!p) return;
      var key = p.name + '@' + p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
      if (seen[key]) return;
      seen[key] = true;
      out.push(p);
    });
    out.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
    return out.slice(0, limit || 40);
  }

  function findAttractions(lat, lon) {
    var q = '[out:json][timeout:20];(' +
      'nwr["tourism"~"attraction|museum|zoo|theme_park|aquarium|gallery|viewpoint|castle"]["name"](around:5000,' + lat + ',' + lon + ');' +
      'nwr["historic"~"castle|monument|memorial|ruins"]["name"](around:5000,' + lat + ',' + lon + ');' +
      'nwr["leisure"="park"]["name"](around:5000,' + lat + ',' + lon + ');' +
      ');out center 60;';
    return overpass(q).then(function (els) { return collect(els, lat, lon, 40); });
  }

  function findKosher(lat, lon) {
    var q = '[out:json][timeout:25];(' +
      'nwr["diet:kosher"="yes"](around:9000,' + lat + ',' + lon + ');' +
      'nwr["kosher"="yes"](around:9000,' + lat + ',' + lon + ');' +
      'nwr["amenity"~"restaurant|cafe|fast_food|bakery"]["name"~"kosher|כשר",i](around:9000,' + lat + ',' + lon + ');' +
      ');out center 60;';
    return overpass(q).then(function (els) { return collect(els, lat, lon, 40); });
  }

  function findChabad(lat, lon) {
    // חיפוש ממוקד לפי סוג מקום + שם — סריקת שם בלבד על רדיוס גדול כבדה מדי לשרת ופגה בזמן.
    var rx = 'Chabad|Lubavitch|Habad|בית חב|חב״ד|חב"ד';
    var q = '[out:json][timeout:25];(' +
      'nwr["amenity"="place_of_worship"]["name"~"' + rx + '",i](around:15000,' + lat + ',' + lon + ');' +
      'nwr["building"="synagogue"]["name"~"' + rx + '",i](around:15000,' + lat + ',' + lon + ');' +
      'nwr["amenity"="community_centre"]["name"~"' + rx + '",i](around:15000,' + lat + ',' + lon + ');' +
      'nwr["name:he"~"בית חב|חבד|חב״ד"](around:15000,' + lat + ',' + lon + ');' +
      'nwr["operator"~"Chabad|Lubavitch",i](around:15000,' + lat + ',' + lon + ');' +
      ');out center 60;';
    return overpass(q).then(function (els) {
      return collect(els, lat, lon, 30).filter(function (p) {
        return /chabad|lubavitch|habad|חב/i.test(p.searchText || p.name);
      });
    });
  }

  function mapsLink(p) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent(p.lat + ',' + p.lon) + '&destination_place_id=' + encodeURIComponent(p.name);
  }
  function mapsSearchLink(lat, lon) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lon);
  }

  window.API = {
    geocode: geocode,
    fetchWeather: fetchWeather,
    findAttractions: findAttractions,
    findKosher: findKosher,
    findChabad: findChabad,
    haversineKm: haversineKm,
    formatDistance: formatDistance,
    mapsLink: mapsLink,
    mapsSearchLink: mapsSearchLink
  };
})();
