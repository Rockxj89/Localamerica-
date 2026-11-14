// Runs on the Google place pages (/places/cave-4): visit counting for the Traffic page,
// the Meta pixel sales steps, error logging, and the Unlock GPS button.
// Uses the same browser codes as the app (la_vid, la_sid, la_access_token), so a visitor who
// lands here from Google and then opens the app is one visitor, and an unlock bought here
// shows up in the app. This file never handles coordinates.
(function () {
  var CFG = {
    SUPABASE_URL: 'https://ycdlxdijrlfsxvxksyrq.supabase.co',
    SUPABASE_KEY: 'sb_publishable_2ExdXbNtW9HpuOGAq1Oa7g_gPdONH_s',
    CHECKOUT_URL: 'https://ycdlxdijrlfsxvxksyrq.supabase.co/functions/v1/checkout',
    UNLOCK_PRICE: '$4.99'
  };
  var placeId = Number(document.body.getAttribute('data-place-id'));
  if (!Number.isInteger(placeId) || placeId <= 0) placeId = null;

  function randomId() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); }

  var sessionId = (function () {
    try {
      var s = sessionStorage.getItem('la_sid');
      if (!s) { s = randomId(); sessionStorage.setItem('la_sid', s); }
      return s;
    } catch (e) { return null; }
  })();

  var visitorId = (function () {
    try {
      var v = localStorage.getItem('la_vid');
      if (!/^[a-z0-9-]{16,40}$/.test(v || '')) { v = randomId(); localStorage.setItem('la_vid', v); }
      return v;
    } catch (e) { return null; }
  })();

  // Private token that ties GPS purchases to this browser (same one the app uses)
  var accessToken = (function () {
    try {
      var t = localStorage.getItem('la_access_token');
      if (!/^[a-f0-9]{64}$/.test(t || '')) {
        var b = new Uint8Array(32); crypto.getRandomValues(b);
        t = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
        localStorage.setItem('la_access_token', t);
      }
      return t;
    } catch (e) { return null; }
  })();

  var ua = navigator.userAgent || '';
  var landingReferrer = (function () {
    try {
      var stored = sessionStorage.getItem('la_ref');
      if (stored !== null) return stored || null;
      var host = '';
      try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { host = ''; }
      if (host === location.hostname) host = '';
      if (!host && /FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) host = 'facebook.com';
      if (!host && /Instagram/i.test(ua)) host = 'instagram.com';
      sessionStorage.setItem('la_ref', host);
      return host || null;
    } catch (e) { return null; }
  })();

  var isBot = !!navigator.webdriver || /bot|crawl|spider|slurp|facebookexternalhit|facebot|preview|headless|lighthouse|vercel|pingdom|uptime|python-requests|curl|wget/i.test(ua);
  var inAppBrowser = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\//i.test(ua);
  var browserLabel = (function () {
    if (isBot) return 'Bot or automation';
    var os = /iPhone|iPad|iPod/i.test(ua) ? 'iPhone or iPad' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'other device';
    var b = 'Other browser';
    if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) b = 'Facebook app';
    else if (/Instagram/i.test(ua)) b = 'Instagram app';
    else if (/SamsungBrowser/i.test(ua)) b = 'Samsung Internet';
    else if (/Edg\//i.test(ua)) b = 'Edge';
    else if (/Firefox|FxiOS/i.test(ua)) b = 'Firefox';
    else if (/CriOS|Chrome\//i.test(ua)) b = 'Chrome';
    else if (/Safari/i.test(ua)) b = 'Safari';
    return b + ' on ' + os;
  })();

  // Only count real visits, not previews shown inside another page
  var inFrame = false;
  try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }

  // Same rules as the app's logEvent. The owner's own browser is dropped by the database.
  function logEvent(type, locationId, meta) {
    if (inFrame) return;
    meta = meta || {};
    try { if (window.laPixel && !isBot) window.laPixel.event(type, locationId); } catch (e) { /* never break the page */ }
    var dbLocation = ['place_view', 'open_in_maps', 'unlock_gps_click', 'checkout_start'].indexOf(type) >= 0 ? locationId : null;
    if (dbLocation == null && locationId != null) meta.location_id = locationId;
    if (visitorId) meta.vid = visitorId;
    meta.page = 'place_page';
    var row = {
      event_type: type, location_id: dbLocation, visitor_session_hash: sessionId,
      browser_type: browserLabel, referrer_host: landingReferrer,
      automation_signal: isBot, event_metadata: meta
    };
    try {
      fetch(CFG.SUPABASE_URL + '/rest/v1/poi_traffic_events', {
        method: 'POST', keepalive: true,
        headers: { apikey: CFG.SUPABASE_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row)
      }).catch(function () {});
    } catch (e) { /* analytics must never break the page */ }
  }

  // One "interaction" per visit after the first real touch, tap, key press or scroll (people vs bots)
  (function watchForPerson() {
    try { if (sessionStorage.getItem('la_touched')) return; } catch (e) { return; }
    var names = ['pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel'];
    var started = Date.now();
    function done(ev) {
      if (!ev.isTrusted || Date.now() - started < 300) return;
      names.forEach(function (n) { window.removeEventListener(n, done); });
      try { sessionStorage.setItem('la_touched', '1'); } catch (e) { /* fine */ }
      logEvent('interaction');
    }
    names.forEach(function (n) { window.addEventListener(n, done, { passive: true }); });
  })();

  // JavaScript errors, same as the app: at most 10 per visit, each once, addresses and coordinate-like numbers removed
  (function watchForErrors() {
    var seen = {}, sent = 0;
    function clean(s, max) { return String(s || '').replace(/\?[^\s'")]*/g, '').replace(/-?\d{1,3}\.\d{3,}/g, '#').replace(/\s+/g, ' ').trim().slice(0, max); }
    function report(message, file, line) {
      try {
        var msg = clean(message, 200) || 'Unknown error';
        if (sent >= 10 || seen[msg]) return;
        seen[msg] = 1; sent++;
        var meta = { message: msg };
        if (file) meta.file = clean(String(file).split('/').pop(), 60);
        if (Number(line)) meta.line = Number(line);
        logEvent('js_error', null, meta);
      } catch (e) { /* never break the page */ }
    }
    window.addEventListener('error', function (e) { if (e && e.message) report(e.message, e.filename, e.lineno); });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e.reason;
      report('Unhandled promise: ' + (r && r.message ? r.message : String(r)), null, null);
    });
  })();

  // If a smaller photo copy can't load, show the full-size photo instead
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && img.getAttribute('data-full') && img.getAttribute('src') !== img.getAttribute('data-full')) img.src = img.getAttribute('data-full');
  }, true);

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.firstElementChild.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 3000);
  }

  function checkoutApi(action, extra) {
    if (!accessToken) return Promise.resolve({ ok: false, error: 'This browser cannot save purchases. Turn on site storage and try again.' });
    var body = { action: action, token: accessToken };
    for (var k in extra) body[k] = extra[k];
    return fetch(CFG.CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'No connection. Check your signal and try again.' }; });
  }

  // Same steps as the app. Stripe sends the buyer back to the app (localamerica.us/#/p/ID),
  // which confirms the payment and shows the GPS there.
  var busy = false;
  function startUnlock(btn) {
    if (busy || placeId == null) return;
    busy = true;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Opening secure checkout…';
    logEvent('unlock_gps_click', placeId);
    checkoutApi('start', { locationId: placeId, returnUrl: location.origin + '/' }).then(function (r) {
      if (r && r.ok && r.url) {
        logEvent('checkout_start', placeId);
        setTimeout(function () { location.href = r.url; }, 400); // give the pixel a moment to send
        return;
      }
      busy = false; btn.disabled = false; btn.textContent = label;
      // Already bought in this browser: the app shows the GPS
      if (r && r.ok && r.alreadyActive) { location.href = '/#/p/' + placeId; return; }
      toast((r && r.error) || 'Checkout had a problem. Please try again.');
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'unlock') startUnlock(el);
    else if (act === 'maps') logEvent('open_in_maps', placeId);
  });

  // If someone backs out of Stripe, don't leave the button stuck on "Opening…"
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    busy = false;
    var btn = document.querySelector('[data-act="unlock"]');
    if (btn) { btn.disabled = false; btn.textContent = 'Unlock GPS for ' + CFG.UNLOCK_PRICE; }
  });

  // A visit (counted on the Traffic page once per visit), then the place view
  try {
    if (!sessionStorage.getItem('la_pp_open')) {
      sessionStorage.setItem('la_pp_open', '1');
      logEvent('app_open', null, { standalone: false, inAppBrowser: inAppBrowser });
    }
  } catch (e) { logEvent('app_open', null, { standalone: false, inAppBrowser: inAppBrowser }); }
  if (placeId != null) logEvent('place_view', placeId, { source: 'place_page' });
})();
