/* =====================================================================
   Regenerate hub/app/catalog.js from catalog.json.

     node tools/hub-catalog.mjs

   The Hub reads GET /api/catalog whenever the site answers, and that
   wins - a new app, a new price or a new build reaches every Hub with
   no release. hub/app/catalog.js is the last resort behind it: what a
   Hub shows on a plane, on a dead WiFi, or in the second before the
   first request comes back.

   Because it is a fallback nobody looks at, it rots silently. It sat at
   Nebula Tide 2.0 with two platforms for a week after 2.1 shipped on
   three, and said PerformLive was available while the site said the
   download was paused. Nothing broke loudly; it just quietly told
   offline people the wrong thing. So it is generated now, and the two
   files cannot drift without somebody skipping this script.

   Two things here are not in catalog.json and are kept here on purpose:

     ICONS   the bundled icon each app draws with when there is no
             network at all. They are real files in hub/app/assets, and
             this script checks every one of them exists rather than
             writing a path that 404s inside the app. An app with no
             bundled icon falls back to the site's own URL, which is
             honest: offline it will not load and the Hub draws the
             app's initials instead.

     BLURBS  the longer line under an app in the Hub's library. The
             website has a tagline, which is a headline; this is the
             sentence that follows it, and it is written for the Hub.
             An app with no blurb here falls back to its tagline.
   ===================================================================== */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://amanorsac.studio';

const ICONS = {
  performlive:  'assets/performlive.webp',
  chordlight88: 'assets/icons/chordlight88.svg',
  secondout:    'assets/secondout-icon.png',
  stemsorter:   'assets/icons/stemsorter.svg',
  ambanalog:    'assets/icons/ambanalog.svg',
  alignpro:     'assets/icons/alignpro.svg',
  afdgate:      'assets/icons/afdgate.svg',
  aether:       'assets/icons/aether.svg',
  pulseroom:    'assets/pulseroom-logo.svg',
  nebulatide2:  'assets/nt-logo.webp',
  nebulatide:   'assets/nt-logo.webp',
  harmoniemd:   'assets/harmoniemd.png',
};

const BLURBS = {
  performlive:  'Stem decks, scenes and warm pads laid out for a service. Free for thirty days.',
  chordlight88: 'Eighty-eight keys that name what you played, in notes, numbers or solfa.',
  secondout:    'Send your master to a second output device, drift-corrected, without touching the mix.',
  stemsorter:   'Point it at a folder of stems and it files them the way you would have.',
  ambanalog:    'Tape, tubes and transformers on one strip, for glue that sounds played rather than processed.',
  alignpro:     'Phase and time alignment across every microphone on the kit, found automatically.',
  afdgate:      'A gate that listens to the drum rather than the level, so it never clips a tail.',
  aether:       'Air you can aim: a dynamic exciter for vocals, choir and the mix bus.',
  pulseroom:    'Your reference desk: delay and reverb times, EQ cheat sheet, compression, mix chains.',
  nebulatide2:  'The second tide: new beds, a wider stage, and a price you set yourself.',
  nebulatide:   'Endless, seamless drone pads recorded in all twelve keys. Deep Current included.',
  harmoniemd:   'The choir rehearsal studio: parts, setlists and a multi-track editor.',
};

const abs = (p) => !p ? null : /^https?:/.test(p) ? p : SITE + '/' + String(p).replace(/^\//, '');

const c = JSON.parse(readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
const warnings = [];

const apps = Object.keys(c.apps).map((id) => {
  const a = c.apps[id];

  /* A bundled icon that is not there is worse than no bundled icon: the
     app draws a broken image where a fallback would have drawn initials. */
  let icon = ICONS[id] || null;
  if (icon && !existsSync(path.join(ROOT, 'hub/app', icon))) {
    warnings.push(`${id}: bundled icon ${icon} does not exist - falling back to the site URL`);
    icon = null;
  }
  if (!icon) {
    if (!ICONS[id]) warnings.push(`${id}: no bundled icon - offline it will draw initials`);
    icon = abs(a.icon);
  }

  /* The Hub wants sizes per platform; the live API does not carry them,
     which is exactly why they are worth bundling. */
  const platforms = {};
  for (const [name, inst] of Object.entries(a.installers || {})) {
    platforms[name] = { size: inst.size || null, version: a.version || null };
  }

  return {
    id,
    name: a.name || id,
    tagline: a.tagline || '',
    blurb: BLURBS[id] || a.tagline || '',
    kind: a.kind || 'app',
    status: a.status || 'available',
    soon_note: a.soon_note || null,
    free: !!a.free,
    licensed: !!a.licensed,
    color: a.color || '#eeae61',
    icon,
    art: abs(a.art),
    page: abs(a.page),
    platforms,
  };
});

for (const id of Object.keys(ICONS)) {
  if (!c.apps[id]) warnings.push(`${id}: in ICONS but no longer in catalog.json - drop it from this script`);
}

const out =
`// The Amanorsac collection as the Hub knows it when it cannot reach the
// website. GET ${SITE}/api/catalog is the live copy,
// built by worker.js from catalog.json, and it wins whenever it answers
// - so a new app, a new price or a new build reaches the Hub without a
// Hub release. This file is the last resort behind that, and the only
// thing it really has to get right is the names, the icons and which
// app is which: everything else is refreshed the moment the site is
// reachable again.
//
// The icons here are bundled files, so they draw with no network at
// all. The screenshots are addresses on the site, which is honest about
// what they are: offline they will not load, and the Hub falls back to
// the icon, then to the app's initials.
//
// GENERATED - do not edit. Run:  node tools/hub-catalog.mjs
// Editing this by hand is how it ends up describing a version that no
// longer exists, which is the one thing a fallback must not do.
window.HUB_CATALOG = {
  generatedAt: '${new Date().toISOString().slice(0, 10)}',
  apps: [
${apps.map((a) => '    ' + JSON.stringify(a) + ',').join('\n')}
  ],
};
`;

writeFileSync(path.join(ROOT, 'hub/app/catalog.js'), out);
console.log(`hub/app/catalog.js: ${apps.length} apps`);
for (const a of apps) {
  console.log(`  ${a.id.padEnd(13)} ${a.status.padEnd(12)} v${(a.platforms[Object.keys(a.platforms)[0]] || {}).version || '-'}  ${Object.keys(a.platforms).join('/') || '(no builds)'}`);
}
if (warnings.length) {
  console.log('\nWorth a look:');
  for (const w of warnings) console.log('  ! ' + w);
}
