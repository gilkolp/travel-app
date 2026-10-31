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

  /* ---------- מטמון בזיכרון לחיפושי מקומות (10 דקות) ---------- */
  var searchCache = {}; // key -> { at: timestamp, places: [...] }
  var SEARCH_CACHE_TTL = 10 * 60 * 1000;
  function cacheKey(fnName, lat, lon) {
    return fnName + '@' + Number(lat).toFixed(3) + ',' + Number(lon).toFixed(3);
  }
  function cacheGet(key) {
    var e = searchCache[key];
    if (e && (Date.now() - e.at) < SEARCH_CACHE_TTL) return e.places;
    return null;
  }
  function cacheSet(key, places) { searchCache[key] = { at: Date.now(), places: places }; }

  function findAttractions(lat, lon) {
    var key = cacheKey('attractions', lat, lon);
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
    var queries = ['tourist attraction', 'museum', 'viewpoint', 'park', 'castle', 'art gallery', 'temple', 'zoo', 'aquarium', 'garden'];
    return photonPlaces(queries, lat, lon, 6, function (p) {
      if (p.osmKey === 'tourism') return p.kind !== 'hotel' && p.kind !== 'hostel' && p.kind !== 'apartment' && p.kind !== 'guest_house';
      if (p.osmKey === 'leisure') return p.kind === 'park' || p.kind === 'garden' || p.kind === 'nature_reserve';
      if (p.osmKey === 'historic') return true;
      if (p.osmKey === 'amenity') return p.kind === 'arts_centre' || p.kind === 'theatre' || p.kind === 'place_of_worship' || p.kind === 'marketplace';
      return false;
    }).then(function (places) {
      var out = places.slice(0, 40);
      cacheSet(key, out);
      return out;
    });
  }

  /* ---------- השלמת כשרות מ־Overpass: כמה שרתים בזה אחר זה + סבב חוזר אחד ---------- */
  var KOSHER_OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.nchc.org.tw/api/interpreter'
  ];
  function kosherOverpassRound(q) {
    var chain = Promise.reject(new Error('no endpoint tried yet'));
    KOSHER_OVERPASS_URLS.forEach(function (url) {
      chain = chain.catch(function () { return overpassOnce(url, q, 20000); });
    });
    return chain;
  }
  function kosherOverpass(q) {
    return kosherOverpassRound(q).catch(function () {
      // כל השרתים נכשלו — ממתינים 3 שניות ומנסים סבב אחד נוסף
      return new Promise(function (resolve) { setTimeout(resolve, 3000); })
        .then(function () { return kosherOverpassRound(q); });
    }).catch(function () { return null; });
  }

  function findKosher(lat, lon, onPartial) {
    var key = cacheKey('kosher', lat, lon);
    var hit = cacheGet(key);
    if (hit) {
      if (onPartial && hit.length) onPartial(hit);
      return Promise.resolve(hit);
    }
    var photonPart = photonPlaces(['kosher restaurant', 'kosher', 'kosher food', 'כשר'], lat, lon, 9, function (p) {
      return /kosher|כשר/i.test(p.name);
    });
    // השלמה מתגית diet:kosher ב־Overpass — שאילתה זולה אחת, מול כמה שרתים עד שאחד עונה.
    var q = '[out:json][timeout:25];(' +
      'nwr["diet:kosher"="yes"](around:9000,' + lat + ',' + lon + ');' +
      'nwr["kosher"="yes"](around:9000,' + lat + ',' + lon + ');' +
      ');out center 60;';
    var overpassPart = kosherOverpass(q)
      .then(function (data) { return data ? collect(data.elements || [], lat, lon, 40) : []; })
      .catch(function () { return []; });
    if (onPartial) {
      photonPart.then(function (places) { if (places.length) onPartial(places); }).catch(function () {});
    }
    return Promise.all([photonPart.catch(function () { return []; }), overpassPart]).then(function (parts) {
      var seen = {}, out = [];
      parts[0].concat(parts[1]).forEach(function (p) {
        var k = p.name + '@' + p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
        if (seen[k]) return;
        seen[k] = true;
        out.push(p);
      });
      out.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
      var final = out.slice(0, 40);
      cacheSet(key, final);
      return final;
    });
  }

  function findChabad(lat, lon) {
    var key = cacheKey('chabad', lat, lon);
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
    return photonPlaces(['Chabad', 'Chabad House', 'Lubavitch', 'בית חב״ד', 'בית חבד'], lat, lon, 25, function (p) {
      return p.osmKey !== 'highway' && /chabad|lubavitch|habad|חב/i.test(p.name);
    }).then(function (places) {
      var out = places.slice(0, 30);
      cacheSet(key, out);
      return out;
    });
  }

  function findStays(lat, lon) {
    var key = cacheKey('stays', lat, lon);
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
    return photonPlaces(['hotel', 'hostel', 'apartment', 'guest house', 'bed and breakfast'], lat, lon, 10, function (p) {
      return p.osmKey === 'tourism' &&
        ['hotel', 'hostel', 'apartment', 'guest_house', 'chalet', 'motel'].indexOf(p.kind) !== -1;
    }).then(function (places) {
      var out = places.slice(0, 40);
      cacheSet(key, out);
      return out;
    });
  }

  /* ---------- פרטי מקום מוויקיפדיה: הסבר + תמונה + קישור ---------- */
  function wikiQuery(base, params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(base + '/w/api.php?' + qs).then(function (r) {
      if (!r.ok) throw new Error('wikipedia failed: ' + r.status);
      return r.json();
    });
  }
  function wikiPages(data) {
    var pages = (data && data.query && data.query.pages) || {};
    return Object.keys(pages).map(function (k) { return pages[k]; });
  }
  function wikiResult(p, lang) {
    return {
      title: p.title || '',
      extract: p.extract || '',
      image: (p.thumbnail && p.thumbnail.source) || '',
      url: p.fullurl || '',
      lang: lang
    };
  }
  function wikiProps() {
    return {
      prop: 'extracts|pageimages|info|coordinates', inprop: 'url',
      explaintext: 1, exintro: 1, exsentences: 6,
      piprop: 'thumbnail', pithumbsize: 500,
      format: 'json', origin: '*'
    };
  }
  function fetchPlaceInfo(lat, lon, name) {
    function geo(base, lang) {
      var params = wikiProps();
      params.action = 'query';
      params.generator = 'geosearch';
      params.ggscoord = lat + '|' + lon;
      params.ggsradius = 400;
      params.ggslimit = 5;
      return wikiQuery(base, params).then(function (data) {
        var best = null, bestD = Infinity;
        wikiPages(data).forEach(function (p) {
          if (!p.extract) return;
          var d = (p.coordinates && p.coordinates.length)
            ? haversineKm(lat, lon, p.coordinates[0].lat, p.coordinates[0].lon) : 0.5;
          if (d < bestD) { bestD = d; best = p; }
        });
        return best ? wikiResult(best, lang) : null;
      }).catch(function () { return null; });
    }
    function byName(base, lang) {
      if (!name) return Promise.resolve(null);
      var params = wikiProps();
      params.action = 'query';
      params.generator = 'search';
      params.gsrsearch = name;
      params.gsrlimit = 3;
      return wikiQuery(base, params).then(function (data) {
        var pages = wikiPages(data).filter(function (p) { return p.extract; });
        pages.sort(function (a, b) { return (a.index || 99) - (b.index || 99); });
        return pages.length ? wikiResult(pages[0], lang) : null;
      }).catch(function () { return null; });
    }
    var HE = 'https://he.wikipedia.org', EN = 'https://en.wikipedia.org';
    return geo(HE, 'he').then(function (r) {
      return r || geo(EN, 'en');
    }).then(function (r) {
      return r || byName(HE, 'he');
    }).then(function (r) {
      return r || byName(EN, 'en');
    }).catch(function () { return null; });
  }

  /* ---------- LiteAPI: מחירי מלונות (מפתח Sandbox חינמי בהרשמה עצמית, נשמר במכשיר) ----------
     מבנה לפי API reference v3.0 (docs.liteapi.travel):
     - כותרת X-API-Key בכל קריאה, בסיס https://api.liteapi.travel/v3.0
     - GET /data/hotels?latitude&longitude&radius(מטרים)&limit — רשימת מלונות סביב נקודה
     - POST /hotels/rates עם hotelIds, checkin, checkout, currency, guestNationality,
       occupancies — מחיר סופי ב־roomTypes[].rates[].retailRate.total[] ({amount, currency})
     הערה: לפי תיעוד LiteAPI הקריאות מיועדות לצד שרת (מגבלות CORS מהדפדפן אפשריות). */
  var LITEAPI_BASE = 'https://api.liteapi.travel/v3.0';
  function isoDate(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function liteapiKey(keyOverride) {
    if (keyOverride) return String(keyOverride).trim();
    try { return (localStorage.getItem('liteapi_key') || '').trim(); } catch (e) { return ''; }
  }
  function liteapiFetch(path, options, key) {
    options = options || {};
    var headers = { 'X-API-Key': key, 'Accept': 'application/json' };
    Object.keys(options.headers || {}).forEach(function (k) { headers[k] = options.headers[k]; });
    options.headers = headers;
    return fetch(LITEAPI_BASE + path, options).then(function (r) {
      if (!r.ok) throw new Error('liteapi failed: ' + r.status);
      return r.json();
    });
  }
  function findHotelPrices(lat, lon, checkIn, checkOut, keyOverride) {
    var key = liteapiKey(keyOverride);
    if (!key) return Promise.reject(new Error('missing liteapi key'));
    if (!checkIn || !checkOut) {
      var inD = new Date(); inD.setDate(inD.getDate() + 7);
      var outD = new Date(); outD.setDate(outD.getDate() + 9);
      checkIn = isoDate(inD);
      checkOut = isoDate(outD);
    }
    var hotelsPath = '/data/hotels?latitude=' + lat + '&longitude=' + lon + '&radius=20000&limit=30';
    return liteapiFetch(hotelsPath, null, key).then(function (hdata) {
      var meta = {}, ids = [];
      (hdata.data || []).forEach(function (h) {
        var id = h.id || h.hotelId;
        if (!id) return;
        var hLat = h.latitude != null ? h.latitude : (h.location && h.location.latitude);
        var hLon = h.longitude != null ? h.longitude : (h.location && h.location.longitude);
        meta[id] = {
          name: h.name || '',
          lat: hLat != null ? hLat : lat,
          lon: hLon != null ? hLon : lon,
          rating: h.stars != null ? h.stars
            : (h.starRating != null ? h.starRating : (h.rating != null ? h.rating : null))
        };
        ids.push(id);
      });
      if (!ids.length) return [];
      var body = {
        hotelIds: ids,
        checkin: checkIn,
        checkout: checkOut,
        currency: 'USD',
        guestNationality: 'US',
        occupancies: [{ adults: 2 }],
        timeout: 10,
        maxRatesPerHotel: 1
      };
      return liteapiFetch('/hotels/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, key).then(function (rdata) {
        var out = [];
        (rdata.data || []).forEach(function (item) {
          var m = meta[item.hotelId];
          if (!m || !m.name) return;
          var best = null;
          (item.roomTypes || []).forEach(function (rt) {
            (rt.rates || []).forEach(function (rate) {
              var totals = (rate.retailRate && rate.retailRate.total) || [];
              var sum = 0, cur = '';
              totals.forEach(function (t) {
                if (t && t.amount != null) { sum += Number(t.amount); cur = cur || t.currency || ''; }
              });
              if (sum > 0 && (!best || sum < best.amount)) best = { amount: sum, currency: cur };
            });
          });
          if (!best) return;
          out.push({
            name: m.name,
            localName: '', searchText: m.name,
            lat: m.lat, lon: m.lon,
            kind: 'hotel', cuisine: '', openingHours: '', website: '',
            distanceKm: haversineKm(lat, lon, m.lat, m.lon),
            rating: m.rating,
            priceText: (String(Math.round(best.amount * 100) / 100) + ' ' + best.currency).trim()
          });
        });
        out.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
        return out;
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
    findStays: findStays,
    findHotelPrices: findHotelPrices,
    fetchPlaceInfo: fetchPlaceInfo,
    haversineKm: haversineKm,
    formatDistance: formatDistance,
    mapsLink: mapsLink,
    mapsSearchLink: mapsSearchLink
  };
})();
