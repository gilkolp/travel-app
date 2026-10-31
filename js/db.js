/* db.js — שכבת נתונים מקומית (IndexedDB) של אפליקציית הטיולים.
   כל הנתונים נשמרים על המכשיר של המשתמש בלבד. */
(function () {
  'use strict';

  var DB_NAME = 'travel-app-db';
  var DB_VERSION = 1;
  var STORES = ['trips', 'stops', 'members', 'journal', 'documents'];
  var _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('trips')) {
          db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('stops')) {
          var stops = db.createObjectStore('stops', { keyPath: 'id', autoIncrement: true });
          stops.createIndex('tripId', 'tripId', { unique: false });
        }
        if (!db.objectStoreNames.contains('members')) {
          db.createObjectStore('members', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('journal')) {
          var journal = db.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
          journal.createIndex('tripId', 'tripId', { unique: false });
        }
        if (!db.objectStoreNames.contains('documents')) {
          var docs = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
          docs.createIndex('tripId', 'tripId', { unique: false });
        }
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /* ---------- וו התראה על כתיבה (לסנכרון ענן) ----------
     כל כתיבה מוצלחת (add/put/remove/clear/bulkPut) מדווחת למאזין אחד.
     בזמן החלפת נתונים מרוכזת (למשל יישום צילום מהענן) אפשר להשתיק את
     ההתראות עם setSuppressNotify כדי לא ליצור לולאת סנכרון. */
  var writeListener = null;
  var suppressNotify = false;
  function setWriteListener(fn) { writeListener = (typeof fn === 'function') ? fn : null; }
  function setSuppressNotify(v) { suppressNotify = !!v; }
  function notifyWrite() {
    if (suppressNotify || !writeListener) return;
    try { writeListener(); } catch (e) { /* התראה לא שוברת כתיבה */ }
  }

  function run(storeName, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, mode);
        var store = tx.objectStore(storeName);
        var request = fn(store);
        tx.oncomplete = function () {
          if (mode === 'readwrite') notifyWrite();
          resolve(request ? request.result : undefined);
        };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function add(store, value) {
    return run(store, 'readwrite', function (s) { return s.add(value); });
  }
  function put(store, value) {
    return run(store, 'readwrite', function (s) { return s.put(value); });
  }
  function get(store, id) {
    return run(store, 'readonly', function (s) { return s.get(id); });
  }
  function getAll(store) {
    return run(store, 'readonly', function (s) { return s.getAll(); });
  }
  function remove(store, id) {
    return run(store, 'readwrite', function (s) { return s.delete(id); });
  }
  function clear(store) {
    return run(store, 'readwrite', function (s) { return s.clear(); });
  }
  /* כתיבת מערך רשומות בעסקה אחת (עם המזהים הקיימים שלהן, אם יש). */
  function bulkPut(store, rows) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        var s = tx.objectStore(store);
        (rows || []).forEach(function (row) { s.put(row); });
        tx.oncomplete = function () { notifyWrite(); resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function byIndex(store, indexName, key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readonly');
        var idx = tx.objectStore(store).index(indexName);
        var req = idx.getAll(key);
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  window.DB = {
    stores: STORES,
    add: add,
    put: put,
    get: get,
    getAll: getAll,
    remove: remove,
    clear: clear,
    bulkPut: bulkPut,
    byIndex: byIndex,
    setWriteListener: setWriteListener,
    setSuppressNotify: setSuppressNotify
  };
})();
