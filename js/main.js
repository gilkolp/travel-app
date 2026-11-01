/* main.js — נקודת הכניסה היחידה של האפליקציה (ES module).
   כאן רק חיווט: רישום מאזינים מכל המודולים ואתחול. כל הלוגיקה במודולים. */

import { $ } from './utils.js';
import { DB } from './db.js';
import { APP_VERSION } from './version.js';
import { tickClocks } from './clocks.js';
import { loadAll, bindNavigationEvents } from './core.js';
import { bindTopEvents, bindTripEvents, bindStopEvents, bindMemberEvents } from './trips.js';
import { bindArchiveEvents } from './archive.js';
import { bindDiscoverEvents } from './discovery.js';
import { bindStayEvents } from './stays.js';
import { bindJournalEvents } from './journal.js';
import { bindDocumentEvents } from './documents.js';
import { maybeShowWhatsNew, setWhatsNewAfterClose, bindWhatsNewEvents } from './whatsnew.js';
import { renderCloudStatus, markCloudDirty, initCloudSync, maybeShowNamePrompt, bindSettingsEvents } from './settings.js';

/* ---------- אתחול ---------- */
// אחרי סגירת "מה חדש" — בקשת השם, אם עדיין לא הוגדר שם למכשיר
setWhatsNewAfterClose(maybeShowNamePrompt);
document.addEventListener('DOMContentLoaded', function () {
  bindNavigationEvents();
  bindTopEvents();
  bindArchiveEvents();
  bindTripEvents();
  bindStopEvents();
  bindMemberEvents();
  bindDiscoverEvents();
  bindStayEvents();
  bindJournalEvents();
  bindDocumentEvents();
  bindWhatsNewEvents();
  bindSettingsEvents();
  var versionLabel = $('app-version-label');
  if (versionLabel) versionLabel.textContent = 'גרסה ' + APP_VERSION;
  // כל כתיבה ל־DB מסמנת "מלוכלך" ומתזמנת דחיפת סנכרון לענן
  DB.setWriteListener(markCloudDirty);
  renderCloudStatus();
  loadAll().then(function () {
    var whatsNewShown = maybeShowWhatsNew();
    if (!whatsNewShown) maybeShowNamePrompt(); // אם "מה חדש" הוצג — הבקשה תחכה לסגירתו
    initCloudSync();
  });
  tickClocks();
  setInterval(tickClocks, 1000);
});
