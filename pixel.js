// Meta (Facebook) Pixel for Local America. Same pixel and same events as the
// Glide guide. The app swaps screens without a full reload, so every screen
// change sends its own PageView (the first one included).
(function () {
  var PIXEL_ID = '29572336925696802';
  var UNLOCK_PRICE_USD = 4.99; // one GPS unlock is a flat $4.99

  // Only count real visits, not previews shown inside another page.
  var inFrame = false;
  try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }

  function start() {
    if (window.fbq) return;
    /* Standard Meta base code */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
  }

  function track(name, params) {
    try {
      if (inFrame) return;
      start();
      if (params) window.fbq('track', name, params);
      else window.fbq('track', name);
    } catch (e) { /* tracking must never break the app */ }
  }

  // The three purchase steps also go to Meta, so ads can be measured on real sales.
  var SALES_EVENTS = {
    unlock_gps_click: 'AddToCart',
    checkout_start: 'InitiateCheckout',
    checkout_complete: 'Purchase'
  };

  window.laPixel = {
    pageView: function () { track('PageView'); },
    // Called from the app's logEvent(type, locationId)
    event: function (type, locationId) {
      var name = SALES_EVENTS[type];
      if (!name) return;
      var params = { content_type: 'product', value: UNLOCK_PRICE_USD, currency: 'USD' };
      if (locationId != null) params.content_ids = [String(locationId)];
      track(name, params);
    }
  };

  window.laPixel.pageView();
  window.addEventListener('hashchange', function () { window.laPixel.pageView(); });
})();
