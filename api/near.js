// Town pages for Google: localamerica.us/near/ava
// The 3 closest places of each type within 35 estimated driving miles of the town (see ROAD_FACTOR in _site.js), closest types first.
// Built fresh from the database (cached), so new places show up by themselves.
// SAFETY: no coordinates on these pages at all; distances are rounded to the nearest 5 miles
// (see roundMiles in _site.js). Photos and names only, same as the free part of a place page.
const S = require('./_site');
const P = require('./place')._shared;
const { esc, icon } = P;

function tile(p, miles, town, photo) {
  const road = P.roadInfo(p);
  const access = `<span class="inline-flex items-center gap-1 whitespace-nowrap t-xs font-semibold ${p.free ? 'text-freeblue' : 'text-paidgreen'}">${icon(p.free ? 'unlock' : 'lock', 'ico-xs')}<span>${p.free ? 'Free access' : 'Paid access'}</span></span>`;
  const roadLabel = `<span class="inline-flex items-center gap-1 whitespace-nowrap t-xs font-semibold ${road.tone}">${icon(road.icon, 'ico-sm')}<span>${road.label}</span></span>`;
  return `
  <article class="lift flex min-w-0 flex-col overflow-hidden rounded-tile bg-white shadow-card">
    <a href="/places/${esc(p.slug)}" aria-label="Open ${esc(p.name)}" class="relative block aspect-[4/5] min-w-0 overflow-hidden bg-inset md:aspect-[3/2]">
      ${photo
        ? `<img loading="lazy" src="${esc(S.sizedUrl(photo, 640))}" alt="${esc(S.photoLabel(p, town))}" class="img-zoom absolute inset-0 h-full w-full object-cover">`
        : `<div class="absolute inset-0 flex items-center justify-center text-tertiary">${icon('pin')}</div>`}
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
      <h3 class="absolute inset-x-0 bottom-0 line-clamp-2 p-3 font-display text-lg font-semibold leading-tight tracking-[-0.01em] text-white md:p-4 md:text-xl">${esc(p.name)}</h3>
    </a>
    <div class="flex min-w-0 flex-1 flex-col gap-2 p-3 md:p-4">
      <div class="flex flex-col items-start gap-1.5">${access}${roadLabel}</div>
      <p class="t-sm text-secondary">About ${miles} miles from ${esc(town)}</p>
    </div>
  </article>`;
}

// Groups: [{ category, items: [{ place, miles }] }], closest group first
function buildGroups(places, miles) {
  const byCat = {};
  places.forEach((p) => {
    const m = miles[p.id];
    if (m == null || m > S.NEAR_MILES) return;
    (byCat[p.category] = byCat[p.category] || []).push({ place: p, raw: m });
  });
  return Object.entries(byCat).map(([category, list]) => {
    list.sort((a, b) => a.raw - b.raw || a.place.name.localeCompare(b.place.name));
    const items = list.slice(0, S.PER_TYPE).map((x) => ({ place: x.place, miles: S.roundMiles(x.raw) }));
    return { category, items, closest: list[0].raw };
  }).sort((a, b) => a.closest - b.closest || a.category.localeCompare(b.category));
}

function townBody(town, groups, photos) {
  return `
  <article class="space-y-8">
    <div class="space-y-4">
      <nav class="flex flex-wrap items-center gap-2 t-sm text-secondary" aria-label="Breadcrumb">
        <a href="/" class="hover:text-primary">Home</a><span aria-hidden="true">/</span>
        <span class="truncate" aria-current="page">Places near ${esc(town.name)}</span>
      </nav>
      <header class="space-y-4">
        <h1 class="font-display text-[length:var(--fs-h1)] font-semibold leading-[1.1] tracking-[-0.02em] text-primary">Places near ${esc(town.name)}, Missouri</h1>
        <p class="t-base leading-7 text-secondary">${esc(town.intro)}</p>
      </header>
    </div>
    ${groups.map((g) => `
    <section class="space-y-4">
      <h2 class="font-display text-[length:var(--fs-h2)] font-semibold leading-[1.2] tracking-[-0.015em] text-primary"><a href="${esc(S.catUrl(g.category))}" class="hover:underline">${esc(S.catLabel(g.category))}</a></h2>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        ${g.items.map((x) => tile(x.place, x.miles, town.name, (photos[x.place.id] || [])[0])).join('')}
      </div>
    </section>`).join('')}
  </article>`;
}

function send(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(html);
}

const errorBody = `
  <div class="py-10 text-center">
    <p class="t-sm text-errink">We couldn’t load the field records.</p>
    <a href="/#/places" class="mt-3 inline-block t-sm font-medium text-errink underline">Browse all places</a>
  </div>`;

module.exports = async (req, res) => {
  const want = String((req.query && req.query.t) || '');
  const town = S.TOWNS.find((t) => t.slug === S.toSlug(want));
  const plain = (status) => send(res, status, P.frame({ title: 'Local America', description: 'Local America', canonical: '', image: S.SITE + P.LOGO, body: errorBody, robots: 'noindex' }), status === 404 ? 'public, max-age=0, s-maxage=300' : 'no-store');
  if (!town) return plain(404);
  if (want !== town.slug) { res.statusCode = 301; res.setHeader('Location', '/near/' + town.slug); return res.end(); }

  let places, dist, photos;
  try {
    [places, dist] = await Promise.all([S.loadPlaces(), S.loadTownDistances()]);
  } catch (e) { console.error(e); return plain(503); }
  // Photos are a nice-to-have: if they fail, the page still shows (with plain tiles)
  try { photos = await S.loadAllPhotos(); } catch (e) { console.error(e); photos = {}; }

  const groups = buildGroups(places, dist[town.slug] || {});
  const canonical = `${S.SITE}/near/${town.slug}`;
  const firstPhoto = groups.map((g) => (photos[g.items[0].place.id] || [])[0]).find(Boolean);
  const title = `Places near ${town.name}, Missouri | Local America`;

  // Hidden labels for Google and AI answers: a list of public-land places near this town. No coordinates.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: S.SITE + '/' },
        { '@type': 'ListItem', position: 2, name: `Places near ${town.name}`, item: canonical }
      ] },
      { '@type': 'CollectionPage', name: `Places near ${town.name}, Missouri`, url: canonical, description: town.intro,
        about: { '@type': 'City', name: town.name, containedInPlace: { '@type': 'State', name: 'Missouri' } },
        mainEntity: { '@type': 'ItemList', itemListElement: groups.flatMap((g) => g.items).map((x, i) => ({
          '@type': 'ListItem', position: i + 1, url: `${S.SITE}/places/${x.place.slug}`, name: x.place.name,
          item: { '@type': 'Place', name: x.place.name, url: `${S.SITE}/places/${x.place.slug}`,
            description: `${S.catSingular(x.place.category)} on public land about ${x.miles} miles from ${town.name}, Missouri`,
            containedInPlace: { '@type': 'Place', name: 'Mark Twain National Forest' } }
        })) } }
    ]
  };

  const html = P.frame({
    title, description: town.intro, canonical,
    image: firstPhoto ? S.SITE + S.sizedUrl(firstPhoto, 1080) : S.SITE + P.LOGO,
    ...(groups.length ? {} : { robots: 'noindex, follow' }),
    jsonLd, body: townBody(town, groups, photos)
  });
  send(res, 200, html, 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
};

module.exports._test = { buildGroups, townBody };
