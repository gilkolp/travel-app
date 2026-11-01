/* settings.js — מסך ההגדרות ומנוע הסנכרון: השם שלי (חתימה אוטומטית + בקשת שם
   כחובה), ענן ומכשירים (קוד מוסווה, חיבור מכשיר, דחיפה/משיכה מול Supabase),
   עיר הבית, מפתח LiteAPI ואודות. */

import { $, esc, lsGet, lsSet, lsDel, toast } from './utils.js';
import { API } from './api.js';
import { Cloud } from './cloud.js';
import { state } from './state.js';
import { APP_VERSION } from './version.js';
import { getHomeBase, isHomeBaseCustom, HOME_BASE_KEY, tickClocks } from './clocks.js';
import { showScreen, loadAll } from './core.js';
import { hasAnySavedData, showChangelogFull } from './whatsnew.js';
import { liteapiKeySaved } from './stays.js';

/* ---------- בקשת שם (שדה חובה קבוע) ----------
   אם לא הוגדר שם למכשיר — מבקשים אותו (אחרי "מה חדש" אם הופיע).
   ההחלטה מבוססת על השם בלבד: שם ריק בפתיחה → החלון מופיע, גם אם
   הוגדר שם בעבר ונמחק. אין דילוג ואין סגירה מהרקע: החלון יורד רק
   בשמירת שם לא ריק. */
function namePromptNeeded() {
  var name = '';
  try { name = (localStorage.getItem('ta_display_name') || '').trim(); } catch (e) {}
  return !name;
}
function showNamePrompt() {
  $('nameprompt').hidden = false;
  $('nameprompt-backdrop').hidden = false;
  var inp = $('nameprompt-input');
  if (inp) { try { inp.focus(); } catch (e) {} }
}
export function maybeShowNamePrompt() {
  if (!namePromptNeeded()) return false;
  showNamePrompt();
  return true;
}
// נתיב הסגירה היחיד של החלון: שם לא ריק נשמר, ורק אז החלון יורד.
function saveNamePrompt() {
  var inp = $('nameprompt-input');
  var name = ((inp && inp.value) || '').trim();
  if (!name) {
    var hint = $('nameprompt-hint');
    if (hint) hint.hidden = false; // שדה חובה — נשארים בחלון עם רמז
    if (inp) { try { inp.focus(); } catch (e) {} }
    return;
  }
  lsSet('ta_display_name', name);
  lsSet('ta_name_prompted', '1');
  state.author = name; // כמו כפתור שמירת השם בכרטיס הענן
  var cardInput = $('cloud-display-name');
  if (cardInput) cardInput.value = name;
  $('nameprompt').hidden = true;
  $('nameprompt-backdrop').hidden = true;
}

/* ---------- ענן וסנכרון (Supabase) ----------
   כל כתיבה ל־DB מסומנת "מלוכלך" דרך DB.setWriteListener ומדביקה דחיפה
   מושהית לענן. כשל ענן לעולם לא מפריע לעבודה המקומית. */
var cloudOnline = null; // null = טרם נבדק, true/false אחרי ניסיון ראשון
var cloudPushTimer = null;

/* שם התצוגה של המכשיר — נחתם אוטומטית על כל עדכון (יומן, חלק, מסמך) */
function getDisplayName() { return (lsGet('ta_display_name') || '').trim(); }

/* קוד הסנכרון מוצג מוסווה (רק 4 תווים אחרונים); ההעתקה תמיד של הקוד המלא */
var cloudTokenRevealed = false;
function maskToken(t) {
  t = String(t || '');
  return t.length > 4 ? '••••••••••••' + t.slice(-4) : '••••';
}
function renderCloudToken() {
  var inp = $('cloud-token');
  if (!inp || !Cloud) return;
  var t = Cloud.getToken();
  inp.value = cloudTokenRevealed ? t : maskToken(t);
  var tg = $('cloud-token-toggle');
  if (tg) tg.textContent = cloudTokenRevealed ? '🙈 הסתר קוד' : '👁️ הצג קוד';
}

export function renderCloudStatus() {
  var el = $('cloud-status');
  if (!el) return;
  var stamp = lsGet('ta_cloud_updated_at') || '';
  var when = '';
  if (stamp) {
    try {
      when = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
        .format(new Date(stamp));
    } catch (e) {}
  }
  var suffix = when ? ' · סנכרון אחרון: ' + when : '';
  if (cloudOnline === false) el.textContent = 'ענן: לא זמין כרגע — הנתונים נשמרים במכשיר בלבד.' + suffix;
  else if (cloudOnline === true) el.textContent = 'ענן: מחובר ✓' + suffix;
  else el.textContent = 'ענן: בודק חיבור…' + suffix;
}

function pushToCloudNow() {
  if (!Cloud) return Promise.resolve(false);
  return Cloud.collectSnapshot().then(function (snap) {
    if (!snap) { cloudOnline = false; renderCloudStatus(); return false; }
    return Cloud.push(snap).then(function (stamp) {
      if (stamp) {
        cloudOnline = true;
        lsSet('ta_cloud_updated_at', stamp);
        lsDel('ta_cloud_dirty');
      } else {
        cloudOnline = false;
      }
      renderCloudStatus();
      return !!stamp;
    });
  }).catch(function () {
    cloudOnline = false;
    renderCloudStatus();
    return false;
  });
}

export function markCloudDirty() {
  lsSet('ta_cloud_dirty', '1');
  if (cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(function () {
    cloudPushTimer = null;
    pushToCloudNow();
  }, 2500);
}

/* סנכרון פתיחה: נקרא פעם אחת אחרי הטעינה המקומית הראשונה. */
export function initCloudSync() {
  renderCloudStatus();
  if (!Cloud) { cloudOnline = false; renderCloudStatus(); return; }
  renderCloudToken();
  Cloud.pull().then(function (res) {
    if (res === false) { // אין חיבור/הענן לא זמין — ממשיכים מקומית בשקט
      cloudOnline = false;
      renderCloudStatus();
      return;
    }
    cloudOnline = true;
    var dirty = lsGet('ta_cloud_dirty') === '1';
    var stamp = lsGet('ta_cloud_updated_at') || '';
    if (res && !hasAnySavedData()) {
      // אין שום נתונים מקומיים אבל יש בענן — טוענים אותם (למשל מכשיר חדש)
      Cloud.applySnapshot(res.data).then(function (ok) {
        if (ok) {
          lsSet('ta_cloud_updated_at', res.updated_at);
          renderCloudStatus();
          loadAll().then(function () { toast('הנתונים נטענו מהענן ☁️'); });
        } else {
          renderCloudStatus();
        }
      });
      return;
    }
    var remoteMs = res ? Date.parse(res.updated_at) : 0;
    var localMs = stamp ? Date.parse(stamp) : 0;
    if (res && !dirty && remoteMs > localMs + 1000) {
      // הענן חדש מהעותק המקומי ואין שינויים מקומיים תלויים — מחילים בשקט
      Cloud.applySnapshot(res.data).then(function (ok) {
        if (ok) {
          lsSet('ta_cloud_updated_at', res.updated_at);
          renderCloudStatus();
          loadAll();
        } else {
          renderCloudStatus();
        }
      });
      return;
    }
    // אחרת: המקומי הוא המקור — דוחפים אותו לענן (מושהה מעט)
    renderCloudStatus();
    setTimeout(function () { pushToCloudNow(); }, 1500);
  }).catch(function () {
    cloudOnline = false;
    renderCloudStatus();
  });
}

/* חיבור המכשיר לקוד סנכרון של מכשיר אחר */
function joinCloudDevice(code, joinBtn) {
  joinBtn.disabled = true;
  Cloud.pull(code).then(function (res) {
    joinBtn.disabled = false;
    if (res === false) { toast('לא ניתן להתחבר לענן כרגע — נסה שוב מאוחר יותר'); return; }
    if (res) {
      if (!confirm('נמצאו נתונים תחת הקוד שהוזן.\nהנתונים המקומיים במכשיר הזה יוחלפו בנתונים של הקוד. להמשיך?')) return;
      Cloud.applySnapshot(res.data).then(function (ok) {
        if (!ok) { toast('החיבור נכשל — הנתונים המקומיים לא שונו'); return; }
        Cloud.setToken(code);
        lsSet('ta_cloud_updated_at', res.updated_at);
        lsDel('ta_cloud_dirty');
        cloudOnline = true;
        renderCloudToken();
        $('cloud-join-code').value = '';
        renderCloudStatus();
        loadAll().then(function () { toast('המכשיר חובר — הנתונים נטענו מהענן ☁️'); });
      });
    } else {
      if (!confirm('לא נמצאו נתונים תחת הקוד הזה.\nלדחוף את הנתונים הנוכחיים של המכשיר הזה אל הקוד החדש?')) return;
      Cloud.setToken(code);
      lsDel('ta_cloud_updated_at');
      renderCloudToken();
      pushToCloudNow().then(function (ok) {
        toast(ok ? 'המכשיר חובר — הנתונים הועלו לענן ☁️' : 'ההעלאה לענן נכשלה — נסה שוב');
      });
    }
  }).catch(function () {
    joinBtn.disabled = false;
    toast('לא ניתן להתחבר לענן כרגע — נסה שוב מאוחר יותר');
  });
}

/* ---------- רינדור: הגדרות ---------- */
export function renderSettings() {
  var nameInput = $('cloud-display-name');
  if (nameInput) nameInput.value = getDisplayName();
  renderCloudStatus();
  renderCloudToken();
  renderHomeBase();
  renderSettingsLiteApi();
  var v = $('settings-version');
  if (v) v.textContent = 'גרסה ' + APP_VERSION;
}
function renderHomeBase() {
  var hb = getHomeBase();
  var el = $('home-base-current');
  if (el) {
    // שורה בולטת בגודל מלא — שהמשתמש יראה מיד שהעיר נקלטה
    el.innerHTML =
      '<div class="home-base-value">✓ עיר הבית: ' + esc(hb.name) +
      (hb.country ? ' · ' + esc(hb.country) : '') + '</div>' +
      '<div class="muted">אזור זמן: ' + esc(hb.timezone) + '</div>';
  }
  var resetBtn = $('home-base-reset');
  if (resetBtn) resetBtn.hidden = !isHomeBaseCustom();
}
/* מפתח LiteAPI — אותו אחסון ('liteapi_key') כמו שהיה בלינה; רק ה־UI עבר לכאן */
function renderSettingsLiteApi() {
  var box = $('settings-liteapi-box');
  if (!box) return;
  if (liteapiKeySaved()) {
    box.innerHTML =
      '<p class="hint">מפתח שמור במכשיר הזה ✓ — מחירי המלונות פעילים במסך הלינה.</p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn danger" id="btn-settings-liteapi-disconnect">נתק והסר מפתח</button>' +
      '</div>';
    $('btn-settings-liteapi-disconnect').addEventListener('click', function () {
      lsDel('liteapi_key');
      renderSettingsLiteApi();
      toast('המפתח הוסר מהמכשיר');
    });
  } else {
    box.innerHTML =
      '<p class="hint">אפשר לחבר מפתח Sandbox חינמי של LiteAPI (נרשמים ב־liteapi.travel) כדי לראות מחירי מלונות אמיתיים במסך הלינה לפי החלק הפעיל והתאריכים שלו. המפתח נשמר רק במכשיר שלך.</p>' +
      '<label class="field"><span>API Key</span>' +
      '<input type="text" id="settings-liteapi-key" autocomplete="off" placeholder="LiteAPI API Key"></label>' +
      '<div class="form-actions"><button type="button" class="btn primary" id="btn-settings-liteapi-save">שמור מפתח</button></div>';
    $('btn-settings-liteapi-save').addEventListener('click', function () {
      var key = ($('settings-liteapi-key').value || '').trim();
      if (!key) { toast('מלא את שדה המפתח'); return; }
      lsSet('liteapi_key', key);
      renderSettingsLiteApi();
      toast('המפתח נשמר במכשיר');
    });
  }
}

export function bindSettingsEvents() {
  /* ענן וסנכרון */
  var cloudCopyBtn = $('cloud-copy-btn');
  if (cloudCopyBtn) cloudCopyBtn.addEventListener('click', function () {
    if (!Cloud) { toast('הענן לא זמין כרגע'); return; }
    var token = Cloud.getToken(); // תמיד הקוד המלא — גם כשהוא מוסווה על המסך
    function done() { toast('קוד הסנכרון הועתק'); }
    function fallback() {
      // לא בוחרים את שדה הקוד עצמו (הוא מוסווה) — מעתיקים דרך שדה זמני נסתר
      try {
        var ta = document.createElement('textarea');
        ta.value = token;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) {}
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(token).then(done, fallback);
    } else fallback();
  });
  var cloudTokenToggle = $('cloud-token-toggle');
  if (cloudTokenToggle) cloudTokenToggle.addEventListener('click', function () {
    cloudTokenRevealed = !cloudTokenRevealed;
    renderCloudToken();
  });
  var cloudNameInput = $('cloud-display-name');
  if (cloudNameInput) cloudNameInput.value = getDisplayName();
  var cloudNameSave = $('cloud-name-save');
  if (cloudNameSave) cloudNameSave.addEventListener('click', function () {
    var name = ($('cloud-display-name').value || '').trim();
    if (!name) {
      // שם הוא חובה קבועה: דוחים מחיקה — השם הקודם נשאר והשדה מוחזר אליו
      $('cloud-display-name').value = getDisplayName();
      toast('חייב להיות שם — אפשר לשנות אותו, אבל לא למחוק');
      return;
    }
    lsSet('ta_display_name', name);
    state.author = name; // החתימה האוטומטית על עדכונים מעכשיו
    toast('השם נשמר — יופיע אוטומטית ליד העדכונים שלך');
  });
  var cloudJoinBtn = $('cloud-join-btn');
  if (cloudJoinBtn) cloudJoinBtn.addEventListener('click', function () {
    if (!Cloud) { toast('הענן לא זמין כרגע'); return; }
    var code = $('cloud-join-code').value.trim();
    if (!code || code === Cloud.getToken()) { toast('הזן קוד סנכרון של מכשיר אחר'); return; }
    joinCloudDevice(code, cloudJoinBtn);
  });
  // בקשת שם: בכוונה אין מאזין לרקע ואין כפתור סגירה — רק "שמור" עם שם תקין סוגר.
  $('nameprompt-save').addEventListener('click', saveNamePrompt);
  $('nameprompt-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveNamePrompt(); }
  });
  $('nameprompt-input').addEventListener('input', function () {
    var hint = $('nameprompt-hint');
    if (hint && ($('nameprompt-input').value || '').trim()) hint.hidden = true;
  });
  /* הגדרות */
  var settingsBtn = $('btn-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', function () { showScreen('settings'); });
  var settingsBack = $('btn-settings-back');
  if (settingsBack) settingsBack.addEventListener('click', function () { showScreen('home'); });
  var whatsAgain = $('btn-whatsnew-again');
  if (whatsAgain) whatsAgain.addEventListener('click', showChangelogFull);
  var homeSearch = $('home-base-search');
  if (homeSearch) homeSearch.addEventListener('input', function () {
    var q = this.value.trim();
    if (q.length < 2) { $('home-base-results').innerHTML = ''; return; }
    API.geocode(q).then(function (results) {
      var resultsBox = $('home-base-results');
      resultsBox.innerHTML = results.map(function (g, i) {
        return '<button type="button" data-geo="' + i + '">' + esc(g.name) + ' · ' + esc(g.country) +
          (g.admin1 ? ' · ' + esc(g.admin1) : '') + '</button>';
      }).join('');
      resultsBox.querySelectorAll('button').forEach(function (btn, i) {
        btn.addEventListener('click', function () {
          var g = results[i];
          lsSet(HOME_BASE_KEY, JSON.stringify({
            name: g.name, country: g.country, lat: g.lat, lon: g.lon, timezone: g.timezone
          }));
          $('home-base-results').innerHTML = '';
          $('home-base-search').value = '';
          renderHomeBase();
          tickClocks();
          toast('עיר הבית: ' + g.name);
        });
      });
    }).catch(function () { /* שקט: אפשר לנסות שוב */ });
  });
  var homeReset = $('home-base-reset');
  if (homeReset) homeReset.addEventListener('click', function () {
    lsDel(HOME_BASE_KEY);
    renderHomeBase();
    tickClocks();
    toast('עיר הבית אופסה לירושלים');
  });
}
