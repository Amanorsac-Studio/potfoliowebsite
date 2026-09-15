/* =====================================================================
   Every download on the site goes through Amanorsac Hub.

   Any element carrying data-hub-get becomes the door: one button that
   downloads the Hub installer for the visitor's own platform, a line
   with the other platforms, and - because most people who arrive here
   twice already have it - a link that opens the Hub straight to the
   app named in data-app (or <body data-app>) via the amanorsac://
   protocol the Hub registers. The list of what exists, and which files
   to hand out, is catalog.json; this file only draws.

   The button is a plain link to /download/hub/<platform>: no sign-in
   is needed for the Hub itself, it is the front door. Signing in
   happens inside the Hub, with the same account as the website, and
   the Hub fetches apps with that account's token - see
   docs/hub-integration.md.

   Exposed on window.AmanorsacHub for other scripts (app-purchase.js):
     platform()          'windows' | 'mac-arm64' | 'mac-x64' | null
     hubUrl(platform)    the installer link for a platform
     openInHub(app)      navigates to amanorsac://install/<app>
   ===================================================================== */
(function () {
  var CATALOG_URL = '/catalog.json';
  var PROTO = 'amanorsac';

  var ICON_HUB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
  var ICON_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

  var LABELS = { 'windows': 'Windows', 'mac': 'Mac', 'mac-arm64': 'Mac · Apple silicon',
                 'mac-x64': 'Mac · Intel', 'ios': 'iPhone & iPad', 'android': 'Android' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Windows or Mac from the user agent; Apple silicon vs Intel only
     where the browser will say (Chromium's high-entropy hints). When it
     won't, Apple silicon is the better guess for any Mac sold since
     2020, and the Intel link sits one line below either way. */
  var detected = null;
  function platform() { return detected; }
  function detect() {
    var ua = navigator.userAgent || '';
    if (/Windows/i.test(ua)) return Promise.resolve('windows');
    if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) {
      var uad = navigator.userAgentData;
      if (uad && uad.getHighEntropyValues) {
        return uad.getHighEntropyValues(['architecture']).then(function (h) {
          return /arm/i.test(h.architecture || '') ? 'mac-arm64' : (h.architecture ? 'mac-x64' : 'mac-arm64');
        }).catch(function () { return 'mac-arm64'; });
      }
      return Promise.resolve('mac-arm64');
    }
    return Promise.resolve(null);
  }

  function hubUrl(p) { return '/download/hub/' + p; }
  function openInHub(app) {
    location.href = PROTO + '://install/' + encodeURIComponent(app || '');
  }

  window.AmanorsacHub = { platform: platform, hubUrl: hubUrl, openInHub: openInHub, protocol: PROTO };

  var els = document.querySelectorAll('[data-hub-get]');
  if (!els.length) return;

  Promise.all([
    fetch(CATALOG_URL, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    detect()
  ]).then(function (res) {
    var cat = res[0] || {}, plat = res[1];
    detected = plat;
    var hub = cat.hub || {}, inst = hub.installers || {};
    var hubName = hub.name || 'Amanorsac Hub';
    var platforms = Object.keys(inst).length ? Object.keys(inst) : ['windows', 'mac-arm64', 'mac-x64'];
    var primary = plat && platforms.indexOf(plat) >= 0 ? plat : null;

    els.forEach(function (el) {
      var app = (el.getAttribute('data-app') || document.body.getAttribute('data-app') || '').toLowerCase();
      var a = app && cat.apps && cat.apps[app];
      var appName = a ? a.name : '';
      var free = a ? !!a.free : false;
      /* Ask store-state.js rather than reading status directly, so this
         button agrees with the tile, the buy button and the sale strip
         about whether an app is on sale HERE - a preview build and the
         live site are allowed to disagree, and they did. */
      var status = a
        ? ((window.StoreState && window.StoreState.stateOf) ? window.StoreState.stateOf(a) : a.status)
        : 'available';

      el.classList.add('hub-get');

      // Coming soon: no installer to get yet, say so instead of a dead button.
      if (a && status === 'coming_soon') {
        /* soon_note is the studio's own wording for why this one is not
           here today - a paused build reads differently from a thing
           that was never finished, and only the catalog knows which. */
        el.innerHTML = '<p class="hub-note">' + (a.soon_note
          ? esc(a.soon_note)
          : esc(appName) + ' is still in development. It will arrive in ' + esc(hubName) + ' the day it ships.') + '</p>';
        return;
      }

      var title = appName ? 'Get ' + esc(appName) + ' in ' + esc(hubName) : 'Download ' + esc(hubName);
      var sub = primary
        ? esc((inst[primary] && inst[primary].label) || LABELS[primary] || primary) + (free ? ' · free' : '') + ((inst[primary] && inst[primary].size) ? ' · ' + esc(inst[primary].size) : '')
        : 'Windows and macOS';

      var html = '';
      if (primary) {
        html += '<a class="hub-btn" href="' + esc(hubUrl(primary)) + '" data-hub-platform="' + esc(primary) + '">' +
          '<span class="hub-ic">' + ICON_HUB + '</span><span class="hub-txt"><span>' + title + '</span><small>' + sub + '</small></span></a>';
      }
      var others = platforms.filter(function (p) { return p !== primary; }).map(function (p) {
        return '<a href="' + esc(hubUrl(p)) + '" data-hub-platform="' + esc(p) + '">' + esc((inst[p] && inst[p].label) || LABELS[p] || p) + '</a>';
      });
      var alt = '';
      if (!primary) alt += '<b>' + title + ':</b> ' + others.join('<span class="sep">·</span>');
      else if (others.length) alt += 'Also for ' + others.join('<span class="sep">·</span>');
      if (app && status === 'available') {
        alt += (alt ? '<br>' : '') + 'Already have the Hub? <a href="' + esc(PROTO + '://install/' + app) + '" data-hub-open>Open ' + esc(appName || 'it') + ' there</a>';
      }
      html += '<p class="hub-alt">' + alt + '</p>';
      el.innerHTML = html;

      el.querySelectorAll('[data-hub-platform]').forEach(function (link) {
        link.addEventListener('click', function () {
          if (window.track) window.track('hub_download', link.getAttribute('data-hub-platform') + (app ? ' / for ' + app : ''));
        });
      });
    });
  });
})();
