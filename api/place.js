// One page per place for Google: localamerica.us/places/campsite-8
// Built fresh from the database (cached 5 minutes), so new places and edits show up by themselves.
// Same look as the app's place page. Paid places never include GPS: see the SAFETY note in _site.js.
const S = require('./_site');
const fs = require('fs');
const path = require('path');

// Videos that belong to a place (videos.json, "place": <place id>). Read once per server start.
const VIDEO_BASE = 'https://ycdlxdijrlfsxvxksyrq.supabase.co/storage/v1/object/public/tiktok-videos/';
let videoByPlace = null;
function placeVideo(id) {
  if (!videoByPlace) {
    videoByPlace = {};
    try {
      const list = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'videos.json'), 'utf8'));
      (Array.isArray(list) ? list : []).forEach((v) => {
        if (v && Number.isInteger(v.place) && /^[A-Za-z0-9_-]{5,80}\.mp4$/.test(v.file || '') && !videoByPlace[v.place]) videoByPlace[v.place] = v.file;
      });
    } catch (e) { console.error(e); }
  }
  return videoByPlace[id] || null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PRICE = '$4.99';
const LOGO = '/Notes_261110_202947_da0.jpg';

// Icons (same drawings as the app)
const ICON_PATHS = {
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<circle cx="12" cy="16" r="1"/><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  feet: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.030-3.12 1-5.620-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'
};
const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" class="ico ${cls}" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

// Road labels: same rules and wording as the app
const ROAD = {
  easy:  { label: 'Easy access', detail: 'Reachable by any vehicle.', tone: 'text-okink', icon: 'car' },
  walk:  { label: 'Walk-in only', detail: 'No vehicle access. Plan to hike in.', tone: 'text-warnink', icon: 'feet' },
  rough: { label: 'Rough roads likely', detail: 'Road not verified. Plan for unpaved, rough roads. High clearance or 4WD recommended.', tone: 'text-roadred', icon: 'truck' }
};
const ROAD_BY_CATEGORY = {
  'Buildings and stores': 'easy', 'Open Stores': 'easy', 'Popular locations': 'easy',
  'Legends/lore': 'easy', 'Hiking Trails': 'walk', 'Non-vehicle trails': 'walk'
};
const roadInfo = (p) => ROAD[ROAD_BY_CATEGORY[p.category] || 'rough'];

const btnBase = 'press cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-full text-base font-semibold shrink-0 transition disabled:opacity-50 disabled:pointer-events-none';
const btnPrimaryLg = `${btnBase} h-12 gap-2 px-6 bg-accent text-accentfg shadow-btn hover:bg-accenthover`;
const btnSecondary = `${btnBase} h-11 gap-2 px-5 bg-white text-primary shadow-card hover:shadow-lift`;

const coordText = (p) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
const hasGps = (p) => p.free && p.latitude != null && p.longitude != null;

function shortText(text, len) {
  const v = String(text || '').replace(/\s+/g, ' ').trim();
  if (v.length <= len) return v;
  const cut = v.slice(0, len);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), len - 20)).trim() + '…';
}

// ---------- the page frame (head, flag background, logo, footer) ----------
function frame({ title, description, canonical, image, jsonLd, body, bodyAttrs = '', robots = 'index, follow' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f7f9fa">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Local America">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" type="image/jpeg" href="${LOGO}">
<link rel="manifest" href="/manifest.json">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com/3.4.17"></script>
<script src="/pixel.js"></script>
<script>
  tailwind.config = { theme: { extend: {
    fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'] },
    borderRadius: { card: '20px', tile: '16px' },
    boxShadow: {
      ring: '0 0 0 1px rgb(27 35 30 / .08)',
      card: '0 0 0 1px rgb(27 35 30 / .06), 0 1px 2px rgb(27 35 30 / .05), 0 4px 12px rgb(27 35 30 / .05)',
      lift: '0 0 0 1px rgb(27 35 30 / .06), 0 2px 4px rgb(27 35 30 / .06), 0 12px 28px rgb(27 35 30 / .10)',
      float: '0 0 0 1px rgb(27 35 30 / .06), 0 8px 24px rgb(27 35 30 / .12), 0 24px 56px rgb(27 35 30 / .14)',
      btn: 'inset 0 1px 0 rgb(255 255 255 / .15), 0 1px 2px rgb(0 0 0 / .18)'
    },
    colors: {
      accent: '#15803D', accentfg: '#FFFFFF', accenthover: '#166534', warn: '#F5A524',
      primary: '#1B231E', secondary: '#3F4A43', tertiary: '#5C675F',
      page: '#f7f9fa', raised: '#FFFFFF', inset: '#EDF1EA',
      line: '#D3DBD0', lineweak: '#E3E9E0', linestrong: '#AFBBAD',
      okweak: '#E3F0E4', okink: '#1D5B2E', infoweak: '#E2EDF3', infoink: '#1F4B66',
      warnweak: '#F5EDD7', warnink: '#6A4A0E', errweak: '#F6E2DF', errink: '#8A2A20',
      freeblue: '#1D5FA8', paidgreen: '#15803D', roadred: '#C0271C'
    }
  } } };
</script>
<style>
  :root {
    --ease-out: cubic-bezier(.2, .8, .2, 1); --dur-fast: 150ms; --dur-base: 220ms; --dur-slow: 400ms;
    --shadow-lift: 0 0 0 1px rgb(27 35 30 / .06), 0 2px 4px rgb(27 35 30 / .06), 0 12px 28px rgb(27 35 30 / .10);
    --fs-h1: clamp(1.875rem, 1.5rem + 1.8vw, 2.75rem);
    --fs-h2: clamp(1.5rem, 1.25rem + .8vw, 1.875rem);
    --flag-clear: 47vw;
  }
  html, body { background: #f7f9fa; }
  body { -webkit-tap-highlight-color: transparent; color: #1B231E; }
  .flag-bg { position: relative; isolation: isolate; min-height: 100dvh; background: #f7f9fa; }
  .flag-bg::before {
    content: ""; position: absolute; top: 0; left: 0; right: 0; aspect-ratio: 19 / 10;
    pointer-events: none; z-index: 0; background-repeat: no-repeat;
    background-size: 40% 53.85%, 40% 53.85%, 100% 100%;
    background-position: top left, top left, top left;
    background-image:
      var(--stars),
      linear-gradient(#5e7399, #5e7399),
      linear-gradient(to bottom,
        rgba(214,90,90,.72) 0%, rgba(214,90,90,.72) 7.69%,
        rgba(247,249,250,.20) 7.69%, rgba(247,249,250,.20) 15.38%,
        rgba(214,90,90,.72) 15.38%, rgba(214,90,90,.72) 23.07%,
        rgba(247,249,250,.20) 23.07%, rgba(247,249,250,.20) 30.76%,
        rgba(214,90,90,.72) 30.76%, rgba(214,90,90,.72) 38.46%,
        rgba(247,249,250,.20) 38.46%, rgba(247,249,250,.20) 46.15%,
        rgba(214,90,90,.72) 46.15%, rgba(214,90,90,.72) 53.84%,
        rgba(247,249,250,.20) 53.84%, rgba(247,249,250,.20) 61.53%,
        rgba(214,90,90,.72) 61.53%, rgba(214,90,90,.72) 69.23%,
        rgba(247,249,250,.20) 69.23%, rgba(247,249,250,.20) 76.92%,
        rgba(214,90,90,.72) 76.92%, rgba(214,90,90,.72) 84.61%,
        rgba(247,249,250,.20) 84.61%, rgba(247,249,250,.20) 92.30%,
        rgba(214,90,90,.72) 92.30%, rgba(214,90,90,.72) 100%);
    -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent 100%);
    mask-image: linear-gradient(to bottom, #000 70%, transparent 100%);
  }
  .big-text .t-sm { font-size: 1.125rem; line-height: 1.75rem; }
  .big-text .t-xs { font-size: 1rem; line-height: 1.5rem; }
  :where(.big-text) .t-base { font-size: 1.125rem; line-height: 1.75rem; }
  .ico { width: 1.5rem; height: 1.5rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .ico-md { width: 1.25rem; height: 1.25rem; } .ico-sm { width: 1rem; height: 1rem; } .ico-xs { width: .875rem; height: .875rem; }
  .lift { transition: transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out); }
  .img-zoom { transition: transform var(--dur-slow) var(--ease-out); }
  @media (hover: hover) { .lift:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); } .lift:hover .img-zoom { transform: scale(1.04); } }
  .press { transition: transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast), box-shadow var(--dur-base); }
  .press:active { transform: scale(.98); }
  a:focus-visible, button:focus-visible { outline: 2px solid #15803D; outline-offset: 2px; }
  /* The title starts just below the faded flag, like the app's place page */
  #view { padding-top: var(--flag-clear); }
  /* Small logo on the flag, the same one the app shows. Tapping it goes Home. */
  .mini-logo { position: absolute; z-index: 20; top: .75rem; left: 48%; transform: translateX(-50%); width: 150px; height: 150px; border-radius: 9999px; }
  .mini-logo.press:active { transform: translateX(-50%) scale(.96); }
  .mini-logo svg { width: 100%; height: 100%; }
  @media (min-width: 768px) { .mini-logo { left: calc(50% - 12px); width: 160px; height: 160px; } }
  h1, h2, h3 { text-wrap: balance; } p { text-wrap: pretty; }
  @media (min-width: 768px) {
    :root { --flag-clear: 230px; }
    .flag-bg::before { left: 50%; right: auto; width: min(100%, 620px); transform: translateX(-50%); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    .lift:hover, .press:active { transform: none; }
  }
</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="font-sans"${bodyAttrs}>
<div id="app" class="flag-bg big-text">
  <a href="/" class="mini-logo press" aria-label="Local America home">
    <svg viewBox="100 100 800 800" class="contrast-150 brightness-90" aria-hidden="true">
      <defs>
        <filter id="mini-logo-bg-off" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0.106 0 0 0 0 0.137 0 0 0 0 0.118 6 6 6 0 -4.2"/>
          <feMorphology operator="dilate" radius="3"/>
        </filter>
      </defs>
      <image href="${LOGO}" x="0" y="0" width="1000" height="1000" preserveAspectRatio="xMidYMid meet" filter="url(#mini-logo-bg-off)"/>
    </svg>
  </a>

  <main id="view" class="relative z-10 mx-auto max-w-3xl px-5 pb-16">
  ${body}
  <footer class="mt-10 space-y-3 border-t border-black/5 pt-6 t-sm text-secondary">
    <p>Coordinates get you close, not always exact. Finding the spot is part of the fun.</p>
    <p>Use this app as a starting point, never as your only navigation source.</p>
    <div class="flex flex-wrap gap-x-6 gap-y-2">
      <a href="/#/about/contact" class="font-medium text-primary underline decoration-black/20 underline-offset-4 hover:decoration-current">Contact</a>
      <a href="/#/privacy" class="font-medium text-primary underline decoration-black/20 underline-offset-4 hover:decoration-current">Privacy</a>
      <a href="/#/safety" class="inline-flex items-center gap-2 font-medium text-primary underline decoration-black/20 underline-offset-4 hover:decoration-current">Read Safety &amp; Terms ${icon('arrow', 'ico-sm')}</a>
    </div>
  </footer>
  </main>
</div>

<div id="toast" class="hidden fixed bottom-8 inset-x-0 z-[60] flex justify-center pointer-events-none">
  <div class="bg-primary text-white text-base rounded-full px-5 py-2.5 shadow-float"></div>
</div>

<script>
(function(){var R=40,r=R*0.382;function star(cx,cy){var p=[];for(var i=0;i<10;i++){var d=i%2===0?R:r,a=(-90+i*36)*Math.PI/180;p.push((cx+d*Math.cos(a)).toFixed(1)+','+(cy+d*Math.sin(a)).toFixed(1));}return '<polygon points="'+p.join(' ')+'"/>';}
var s='';for(var row=0;row<9;row++){var y=70.2*(row+1),l=row%2===0;for(var k=0;k<(l?6:5);k++)s+=star((l?81.9:163.8)+k*163.8,y);}
var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 988 700"><g fill="#ffffff" fill-opacity="0.85">'+s+'</g></svg>';
document.getElementById('app').style.setProperty('--stars','url("data:image/svg+xml,'+encodeURIComponent(svg)+'")');})();
</script>
<script src="/place-page.js" defer></script>
</body>
</html>`;
}

// ---------- one place ----------
function placeBody(p, photos, sample, near) {
  const road = roadInfo(p);
  const label = S.catLabel(p.category);
  const gps = hasGps(p);
  const maps = gps ? `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}` : '';

  const access = `<span class="inline-flex items-center gap-1 whitespace-nowrap t-xs font-semibold ${p.free ? 'text-freeblue' : 'text-paidgreen'}">${icon(p.free ? 'unlock' : 'lock', 'ico-xs')}<span>${p.free ? 'Free access' : 'Paid access'}</span></span>`;
  const roadLabel = `<span class="inline-flex items-center gap-1 whitespace-nowrap t-xs font-semibold ${road.tone}">${icon(road.icon, 'ico-sm')}<span>${road.label}</span></span>`;

  const photoGrid = photos.length ? `
    <section>
      <div class="grid grid-cols-2 gap-3">
        ${photos.map((k, i) => `<a href="${esc(S.photoUrl(k))}" target="_blank" rel="noopener" aria-label="Open photo ${i + 1} full size" class="lift press block overflow-hidden rounded-tile bg-inset shadow-card ${i === 0 ? 'col-span-2' : ''}"><div class="${i === 0 ? 'aspect-[16/10]' : 'aspect-[4/3]'} w-full"><img ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} src="${esc(S.sizedUrl(k, i === 0 ? 1080 : 640))}" data-full="${esc(S.photoUrl(k))}" alt="${esc(near ? S.photoLabel(p, near.town) : p.name + ' field photo')}${photos.length > 1 ? ' (' + (i + 1) + ')' : ''}" class="img-zoom h-full w-full object-cover"></div></a>`).join('')}
      </div>
    </section>` : '';

  const vfile = placeVideo(p.id);
  const videoBox = vfile ? `
    <section>
      <div class="aspect-[16/10] w-full overflow-hidden rounded-tile bg-black shadow-card">
        <video class="h-full w-full object-contain" src="${esc(VIDEO_BASE + vfile)}#t=0.1" controls playsinline preload="metadata" aria-label="${esc(p.name)} video"></video>
      </div>
    </section>` : '';

  const notes = p.description.trim();

  const unlockBox = gps ? `
    <section class="rounded-card bg-white p-5 shadow-card sm:p-6">
      <p class="t-xs text-secondary">Coordinates</p>
      <p class="mt-2 font-mono t-sm text-primary select-text">${p.latitude}, ${p.longitude}</p>
      <a data-act="maps" href="${esc(maps)}" target="_blank" rel="noopener" class="mt-4 ${btnSecondary}">Open in Maps ${icon('external', 'ico-sm')}</a>
    </section>` : `
    <section class="rounded-card bg-white p-5 shadow-card sm:p-6">
      <div class="flex items-center gap-3">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/10 text-accenthover">${icon('lock', 'ico-md')}</span>
        <h2 class="font-display text-xl font-semibold tracking-[-0.01em] text-primary">Unlock this location’s GPS</h2>
      </div>
      <p class="mt-2 t-sm text-secondary"><span class="font-medium text-primary">${road.label}.</span> ${road.detail}</p>
      <p class="mt-2 t-sm text-secondary">The photos and field notes above are free. For ${PRICE} you get this spot’s exact GPS coordinates and a button that opens it in Google Maps, so you can navigate straight to it.</p>
      <p class="mt-2 t-sm text-secondary">One-time payment. No subscription, and it never expires.</p>
      ${sample ? `<p class="mt-2 t-sm text-secondary">Here’s what you get: <a href="/places/${esc(sample.slug)}" class="font-medium text-primary underline underline-offset-2 hover:no-underline">${esc(sample.name)}</a> is a free place, and its coordinates are shown openly: <span class="font-mono text-primary">${coordText(sample)}</span></p>` : ''}
      <p class="mt-2 t-sm text-secondary">All sales are final. No refunds once GPS is unlocked. See <a href="/#/safety" class="font-medium text-primary underline underline-offset-2 hover:no-underline">Safety &amp; Terms</a>.</p>
      <div class="mt-5">
        <button type="button" data-act="unlock" class="${btnPrimaryLg} w-full sm:w-auto">Unlock GPS for ${PRICE}</button>
      </div>
      <p class="mt-3 t-xs text-secondary">Your purchase is saved in the browser you pay in. If you opened this app from Facebook, open it in your regular browser first so your unlock is there next time. Payments are processed by Stripe.</p>
    </section>`;

  return `
  <article class="space-y-8">
    <div class="space-y-4">
      <nav class="flex flex-wrap items-center gap-2 t-sm text-secondary" aria-label="Breadcrumb">
        <a href="/" class="hover:text-primary">Home</a><span aria-hidden="true">/</span>
        <a href="${esc(S.catUrl(p.category))}" class="hover:text-primary">${esc(label)}</a><span aria-hidden="true">/</span>
        <span class="truncate" aria-current="page">${esc(p.name)}</span>
      </nav>
      <header class="space-y-4">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">${access}${roadLabel}</div>
        <h1 class="font-display text-[length:var(--fs-h1)] font-semibold leading-[1.1] tracking-[-0.02em] text-primary">${esc(p.name)}</h1>
        ${gps ? `<div class="flex flex-wrap items-center gap-x-5 gap-y-2 t-sm text-secondary"><span class="inline-flex items-center gap-2"><span class="text-primary">${icon('pin', 'ico-sm')}</span><span class="select-text">${coordText(p)}</span></span></div>` : ''}
      </header>
    </div>
    ${photoGrid}
    ${videoBox}
    <section>
      <h2 class="font-display text-[length:var(--fs-h2)] font-semibold leading-[1.2] tracking-[-0.015em] text-primary">Field notes</h2>
      <p class="mt-4 whitespace-pre-line t-base leading-7 text-secondary">${notes ? esc(notes) : 'No field notes have been added for this location yet.'}</p>
    </section>
    ${unlockBox}
    <a href="${esc(S.catUrl(p.category))}" class="${btnSecondary}">See all ${esc(label.toLowerCase())} ${icon('arrow', 'ico-sm')}</a>
  </article>`;
}

function notFoundBody() {
  return `
  <div class="py-10 text-center">
    <p class="t-sm text-errink">We couldn’t load the field records.</p>
    <a href="/#/places" class="mt-3 inline-block t-sm font-medium text-errink underline">Browse all places</a>
  </div>`;
}

function send(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(html);
}

module.exports = async (req, res) => {
  const slug = S.toSlug((req.query && req.query.s) || '');
  let places;
  try {
    places = await S.loadPlaces();
  } catch (e) {
    console.error(e);
    // Short cache so a database hiccup doesn't stick
    return send(res, 503, frame({ title: 'Local America', description: 'Local America', canonical: '', image: S.SITE + LOGO, body: notFoundBody(), robots: 'noindex' }), 'no-store');
  }

  const p = places.find((x) => x.slug === slug);
  // Renamed places (Yardage #3 is now Long Shot #3, Non Vehicle #1 is now Hike #1, Flex #3 is now Wheeling #3): old links forward to the new page
  const OLD_PREFIX = { 'yardage-': 'long-shot-', 'non-vehicle-': 'hike-', 'flex-': 'wheeling-' };
  const oldMatch = !p && slug.match(/^(yardage-|non-vehicle-|flex-)(\d+)$/);
  const renamed = oldMatch && places.find((x) => x.slug === OLD_PREFIX[oldMatch[1]] + oldMatch[2]);
  if (renamed) {
    res.statusCode = 301;
    res.setHeader('Location', '/places/' + renamed.slug);
    return res.end();
  }
  if (!p) {
    return send(res, 404, frame({ title: 'Local America', description: 'Local America', canonical: '', image: S.SITE + LOGO, body: notFoundBody(), robots: 'noindex' }),
      'public, max-age=0, s-maxage=300');
  }
  // Someone typed /places/Campsite-8 or /places/campsite--8: send them to the one true address
  if ((req.query && req.query.s) !== p.slug) {
    res.statusCode = 301;
    res.setHeader('Location', '/places/' + p.slug);
    return res.end();
  }

  let photos = [];
  try { photos = await S.loadPhotos(p.id); } catch (e) { console.error(e); }
  // Closest town, for photo labels and Google's hidden labels (rounded miles, no coordinates)
  let near = null;
  try { near = (await S.loadNearestTowns())[p.id] || null; } catch (e) { console.error(e); }

  const label = S.catLabel(p.category);
  const title = `${p.name} – ${label} in Mark Twain National Forest | Local America`;
  const description = shortText(p.description, 155) || S.CATEGORY_DESCRIPTIONS[p.category] || `${p.name} on Local America`;
  const canonical = `${S.SITE}/places/${p.slug}`;
  const image = photos.length ? S.photoUrl(photos[0]) : S.SITE + LOGO;
  const sample = p.free ? null : places.find((x) => x.name === 'Popular Location #2' && hasGps(x));
  const catAbs = S.catUrl(p.category).startsWith('/#') ? S.SITE + '/' + S.catUrl(p.category).slice(1) : S.SITE + S.catUrl(p.category);

  // Lets Google show "Home › Campsites › Campsite #8" in search results. No coordinates in here.
  // Also a hidden label for Google and AI answers: what kind of public-land place this is and which town
  // it's near. Never coordinates (not even for free places), so paid GPS can't leak through here.
  const placeLd = {
    '@type': 'Place', name: p.name, url: canonical, description,
    isAccessibleForFree: p.free,
    containedInPlace: { '@type': 'Place', name: 'Mark Twain National Forest' },
    ...(photos.length ? { image: photos.slice(0, 3).map((k) => S.SITE + S.sizedUrl(k, 1080)) } : {}),
    ...(near ? { additionalProperty: { '@type': 'PropertyValue', name: 'Near', value: `About ${near.miles} miles from ${near.town}, Missouri` } } : {})
  };
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: S.SITE + '/' },
        { '@type': 'ListItem', position: 2, name: label, item: catAbs },
        { '@type': 'ListItem', position: 3, name: p.name, item: canonical }
      ]
    }, placeLd]
  };

  const html = frame({
    title, description, canonical, image, jsonLd,
    body: placeBody(p, photos, sample, near),
    bodyAttrs: ` data-place-id="${Number(p.id)}"`
  });
  send(res, 200, html, 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
};

// For the checks run before merging
module.exports._test = { frame, placeBody, hasGps };
// Shared with the town pages (/near/ava)
module.exports._shared = { frame, esc, icon, roadInfo, LOGO };
