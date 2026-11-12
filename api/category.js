// Plain category links (localamerica.vercel.app/camp, /swimming, ...).
// Serves the normal guide page, but with this category's own title, description
// and link address, so Facebook's link preview is about the category, not the homepage.
// The browser is then switched to the guide's existing category view (#/c/camp).
const fs = require('fs');
const path = require('path');

const SITE = 'https://localamerica.vercel.app';

const CATS = {
  camp:        ['Campsites', 'Known places to set up camp on public land in the Ozarks and Mark Twain National Forest.'],
  swimming:    ['Swimming holes', 'Creeks, pools and swimming holes on public land in the Ozarks.'],
  caves:       ['Caves', 'Caverns, overhangs and tucked-away openings on public land in the Ozarks.'],
  views:       ['Scenic views', 'Lookouts and wide-open views on public land in the Ozarks.'],
  bluffs:      ['Rappelling bluffs', 'Cliffs and rock faces for rappelling on public land in the Ozarks.'],
  forgotten:   ['Forgotten grounds', 'Old homesteads and quiet, overgrown places on public land in the Ozarks.'],
  frogs:       ['Frog ponds', 'Small ponds and wetland spots on public land in the Ozarks.'],
  legends:     ['Legends and lore', 'Places tied to local stories and legends in the Ozarks.'],
  buildings:   ['Buildings and stores', 'Old buildings, shops and structures across the Ozarks.'],
  'dead-ends': ['Dead-end trails', 'Trails that end away from a through route on public land in the Ozarks.'],
  mud:         ['Mud holes and trails', 'Rough tracks and muddy routes for off-roading on public land in the Ozarks.'],
  hiking:      ['Hiking trails', 'Walking-only routes on public land in the Ozarks.'],
  popular:     ['Popular locations', 'Well-known Ozarks places on public land, a good place to start.'],
  rocks:       ['Rocks and flex', 'Rock formations and flex spots for off-roading on public land in the Ozarks.'],
  unmarked:    ['Unmarked trails', 'Routes without a formal trail marker on public land in the Ozarks.'],
  yardage:     ['Yardage fields', 'Open areas measured for yardage on public land in the Ozarks.']
};

let shell = null;
function page() {
  if (!shell) shell = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  return shell;
}

function setMeta(html, attr, name, value) {
  const re = new RegExp('(<meta ' + attr + '="' + name + '" content=")[^"]*(")');
  return html.replace(re, (m, a, b) => a + value + b);
}

module.exports = (req, res) => {
  const slug = String((req.query && req.query.c) || '');
  const cat = CATS[slug];
  if (!cat) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  }
  const title = cat[0] + ' | Local America';
  const desc = cat[1];
  const url = SITE + '/' + slug;

  let html = page().replace(/<title>[^<]*<\/title>/, () => '<title>' + title + '</title>');
  html = setMeta(html, 'name', 'description', desc);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', desc);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'name', 'twitter:title', title);

  // Open the guide's own category view. Done before the app starts, so it loads straight there.
  const jump = '<script>try{history.replaceState(null,"","/#/c/' + slug + '"+location.search)}catch(e){location.replace("/#/c/' + slug + '")}</script>';
  html = html.replace('<head>', () => '<head>\n' + jump);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  res.end(html);
};
