/* api.js — שירותים חיצוניים חינמיים בלי מפתח:
   Open-Meteo (חיפוש יעד + מזג אוויר), Overpass של OpenStreetMap (מקומות סביב נקודה). */
(function () {
  'use strict';

  var OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
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
  function overpassOnce(url, query, timeoutMs) {
    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, timeoutMs || 75000)
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

  /* ---------- Photon: חיפוש טקסט מהיר סביב נקודה (שרתי Overpass עמוסים מדי) ---------- */
  var PHOTON_URL = 'https://photon.komoot.io/api/';
  function photonQuery(q, lat, lon) {
    var url = PHOTON_URL + '?q=' + encodeURIComponent(q) + '&lat=' + lat + '&lon=' + lon + '&limit=40&lang=en';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('photon failed: ' + r.status);
      return r.json();
    }).then(function (data) { return data.features || []; }).catch(function () { return []; });
  }
  function photonPlaces(queries, lat, lon, maxKm, keep) {
    return Promise.all(queries.map(function (q) { return photonQuery(q, lat, lon); })).then(function (lists) {
      var seen = {}, out = [];
      lists.forEach(function (feats) {
        feats.forEach(function (f) {
          var p = f.properties || {};
          var c = (f.geometry && f.geometry.coordinates) || [];
          if (!p.name || c[0] == null) return;
          var key = p.osm_type + '/' + p.osm_id;
          if (seen[key]) return;
          var d = haversineKm(lat, lon, c[1], c[0]);
          if (d > maxKm) return;
          var place = {
            name: p.name, localName: '', searchText: p.name,
            lat: c[1], lon: c[0],
            kind: p.osm_value || '',
            cuisine: '', openingHours: '', website: '',
            distanceKm: d, osmKey: p.osm_key || ''
          };
          if (keep && !keep(place)) return;
          seen[key] = true;
          out.push(place);
        });
      });
      out.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
      return out;
    });
  }

  function findAttractions(lat, lon) {
    var queries = ['tourist attraction', 'museum', 'viewpoint', 'park', 'castle', 'art gallery', 'temple', 'zoo', 'aquarium', 'garden'];
    return photonPlaces(queries, lat, lon, 6, function (p) {
      if (p.osmKey === 'tourism') return p.kind !== 'hotel' && p.kind !== 'hostel' && p.kind !== 'apartment' && p.kind !== 'guest_house';
      if (p.osmKey === 'leisure') return p.kind === 'park' || p.kind === 'garden' || p.kind === 'nature_reserve';
      if (p.osmKey === 'historic') return true;
      if (p.osmKey === 'amenity') return p.kind === 'arts_centre' || p.kind === 'theatre' || p.kind === 'place_of_worship' || p.kind === 'marketplace';
      return false;
    }).then(function (places) { return places.slice(0, 40); });
  }

  function findKosher(lat, lon, onPartial) {
    var photonPart = photonPlaces(['kosher restaurant', 'kosher', 'kosher food', 'כשר'], lat, lon, 9, function (p) {
      return /kosher|כשר/i.test(p.name);
    });
    // השלמה מתגית diet:kosher ב־Overpass — שאילתה זולה אחת, שרת אחד, זמן מוגבל.
    var q = '[out:json][timeout:25];(' +
      'nwr["diet:kosher"="yes"](around:9000,' + lat + ',' + lon + ');' +
      'nwr["kosher"="yes"](around:9000,' + lat + ',' + lon + ');' +
      ');out center 60;';
    var overpassPart = overpassOnce(OVERPASS_URLS[0], q, 40000)
      .then(function (data) { return collect(data.elements || [], lat, lon, 40); })
      .catch(function () { return []; });
    if (onPartial) {
      photonPart.then(function (places) { if (places.length) onPartial(places); }).catch(function () {});
    }
    return Promise.all([photonPart.catch(function () { return []; }), overpassPart]).then(function (parts) {
      var seen = {}, out = [];
      parts[0].concat(parts[1]).forEach(function (p) {
        var key = p.name + '@' + p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
        if (seen[key]) return;
        seen[key] = true;
        out.push(p);
      });
      out.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
      return out.slice(0, 40);
    });
  }

  function findChabad(lat, lon) {
    return photonPlaces(['Chabad', 'Chabad House', 'Lubavitch', 'בית חב״ד', 'בית חבד'], lat, lon, 25, function (p) {
      return p.osmKey !== 'highway' && /chabad|lubavitch|habad|חב/i.test(p.name);
    }).then(function (places) { return places.slice(0, 30); });
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
