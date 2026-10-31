/* cloud.js — סנכרון ענן (Supabase) של אפליקציית הטיולים.
   הנתונים נשמרים גם מקומית (IndexedDB) וגם — כשיש חיבור — בענן,
   כדי שיעברו בין המכשירים של אותו משתמש.
   גישה לענן מוגנת בקוד סנכרון סודי אישי לכל מכשיר (x-owner-token):
   שורת הנתונים של מכשיר נגישה רק למי שמחזיק את הקוד שלו.
   שום שגיאת ענן לא נשברת החוצה — האפליקציה תמיד עובדת מקומית. */
(function () {
  'use strict';

  var SB_URL = 'https://bmrmjyutxtastpdxilpk.supabase.co';
  var SB_KEY = 'sb_publishable_d-PFOCu5MB1CE8kCPrcObA_-Yel2dcA';
  var REST = SB_URL + '/rest/v1/app_state';
  var LS_TOKEN = 'ta_owner_token';

  /* ---------- קוד סנכרון (טוקן בעלים) ---------- */
  function newToken() {
    var bytes = new Uint8Array(32);
    (window.crypto || {}).getRandomValues
      ? crypto.getRandomValues(bytes)
      : bytes.forEach(function (_, i) { bytes[i] = Math.floor(Math.random() * 256); });
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return hex;
  }
  function getToken() {
    var t = null;
    try { t = localStorage.getItem(LS_TOKEN); } catch (e) {}
    if (!t) {
      t = newToken();
      try { localStorage.setItem(LS_TOKEN, t); } catch (e) {}
    }
    return t;
  }
  function setToken(t) {
    t = String(t || '').trim();
    if (!t) return false;
    try { localStorage.setItem(LS_TOKEN, t); } catch (e) { return false; }
    return true;
  }

  /* ---------- קריאות REST מול Supabase ---------- */
  function sbHeaders(token) {
    return {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'x-owner-token': token,
      'Content-Type': 'application/json'
    };
  }
  /* מחזיר {data, updated_at} אם יש שורה, null אם אין שורה, false בשגיאה. */
  function cloudPull(tokenOverride) {
    var token = tokenOverride || getToken();
    var url = REST + '?select=data,updated_at&owner_token=eq.' + encodeURIComponent(token);
    return fetch(url, { method: 'GET', headers: sbHeaders(token) })
      .then(function (r) {
        if (!r.ok) throw new Error('pull failed: ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        if (rows && rows.length) return { data: rows[0].data, updated_at: rows[0].updated_at };
        return null;
      })
      .catch(function () { return false; });
  }
  /* דוחף צילום מצב. מחזיר את חותמת הזמן שנשלחה (מחרוזת) בהצלחה, false בשגיאה. */
  function cloudPush(snapshot, tokenOverride) {
    var token = tokenOverride || getToken();
    var stamp = new Date().toISOString();
    var body = { owner_token: token, data: snapshot, updated_at: stamp };
    var headers = sbHeaders(token);
    headers['Prefer'] = 'resolution=merge-duplicates';
    return fetch(REST, { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) throw new Error('push failed: ' + r.status);
        return stamp;
      })
      .catch(function () { return false; });
  }

  /* ---------- המרת Blob <-> dataURL (לתמונות יומן בצילום) ---------- */
  function blobToDataUrl(blob) {
    if (typeof FileReader !== 'undefined') {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
        r.readAsDataURL(blob);
      });
    }
    // נתיב חלופי (סביבות בלי FileReader): arrayBuffer + base64
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var bin = '';
      var CH = 0x8000;
      for (var i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      return 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(bin);
    });
  }
  function dataUrlToBlob(dataUrl) {
    try {
      var parts = String(dataUrl).split(',');
      var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
      var bin = atob(parts[1] || '');
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch (e) { return null; }
  }
  function isBlob(v) {
    return typeof Blob !== 'undefined' && v instanceof Blob;
  }

  /* ---------- בניית צילום מצב מה־DB המקומי ----------
     מסמכים: הרשומה עוברת לענן בלי תוכן הקובץ עצמו (רק מטא־דאטה) —
     הקבצים נשארים במכשיר בגרסה זו. תמונות יומן עוברות כ־dataURL. */
  var HEAVY_DOC_FIELDS = ['file', 'dataUrl', 'dataURL', 'blob', 'base64'];
  function stripDocument(doc) {
    var copy = {};
    Object.keys(doc).forEach(function (k) {
      if (HEAVY_DOC_FIELDS.indexOf(k) === -1) copy[k] = doc[k];
    });
    var f = doc.file;
    if (f) {
      if (copy.fileType == null && f.type) copy.fileType = f.type;
      if (copy.fileSize == null && typeof f.size === 'number') copy.fileSize = f.size;
    }
    copy.hasFile = !!f;
    return copy;
  }
  function collectSnapshot() {
    if (!window.DB) return Promise.resolve(null);
    return Promise.all([
      DB.getAll('trips'), DB.getAll('stops'), DB.getAll('members'),
      DB.getAll('journal'), DB.getAll('documents')
    ]).then(function (res) {
      var journalJobs = (res[3] || []).map(function (j) {
        var copy = {};
        Object.keys(j).forEach(function (k) { copy[k] = j[k]; });
        if (isBlob(j.photo)) {
          return blobToDataUrl(j.photo).then(function (url) { copy.photo = url; return copy; })
            .catch(function () { copy.photo = null; return copy; });
        }
        if (typeof j.photo !== 'string') copy.photo = null;
        return copy;
      });
      return Promise.all(journalJobs).then(function (journal) {
        return {
          v: 1,
          savedAt: new Date().toISOString(),
          trips: res[0] || [],
          stops: res[1] || [],
          members: res[2] || [],
          journal: journal,
          documents: (res[4] || []).map(stripDocument)
        };
      });
    }).catch(function () { return null; });
  }

  /* ---------- יישום צילום מצב על ה־DB המקומי ----------
     מחליף את כל התוכן המקומי. מחזיר true בהצלחה, false בשגיאה.
     כתיבות ה־DB מושתקות בזמן ההחלפה כדי לא לסמן "מלוכלך" וליצור לולאה. */
  function applySnapshot(snap) {
    if (!window.DB || !snap) return Promise.resolve(false);
    var stores = ['trips', 'stops', 'members', 'journal', 'documents'];
    var prepared = {};
    stores.forEach(function (name) {
      var rows = Array.isArray(snap[name]) ? snap[name] : [];
      prepared[name] = rows.map(function (row) {
        var copy = {};
        Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
        if (name === 'journal' && typeof copy.photo === 'string' && copy.photo.indexOf('data:') === 0) {
          copy.photo = dataUrlToBlob(copy.photo);
        }
        return copy;
      });
    });
    DB.setSuppressNotify(true);
    var chain = Promise.resolve();
    stores.forEach(function (name) {
      chain = chain.then(function () {
        return DB.clear(name).then(function () { return DB.bulkPut(name, prepared[name]); });
      });
    });
    return chain.then(function () {
      DB.setSuppressNotify(false);
      return true;
    }).catch(function () {
      DB.setSuppressNotify(false);
      return false;
    });
  }

  window.Cloud = {
    url: SB_URL,
    getToken: getToken,
    setToken: setToken,
    pull: cloudPull,
    push: cloudPush,
    collectSnapshot: collectSnapshot,
    applySnapshot: applySnapshot
  };
})();
