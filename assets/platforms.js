/* =====================================================================
   What this app runs on, said next to the price.

   The first question anybody asks about a piece of software is whether
   it runs on their machine, and until now every page answered it in a
   sentence somebody typed by hand - "Windows & macOS" - which is fine
   until an app gains a platform and the sentence does not. Nebula Tide 2
   went to Android and three separate lines on its page still said
   otherwise.

   So this reads the app's own installers out of catalog.json. Add a
   build to the catalog and the badge appears on the page by itself;
   there is no second place to remember.

   A page opts in with one empty element, next to the buy button:

     <p class="plat-row" data-platforms hidden></p>

   Needs assets/store-state.js loaded first; assets/sale.css styles it.

   No brand logos. An Apple mark or a Windows flag on a shop page is
   somebody else's trademark being used to sell something, and the
   names do the job perfectly well - a screen for the desktop, a phone
   for the phone, and the platform written out.
   ===================================================================== */
(function () {
  var slots = document.querySelectorAll('[data-platforms]');
  if (!slots.length || !window.StoreState) return;

  /* width and height are ATTRIBUTES, not a CSS rule.

     An inline SVG with only a viewBox has no intrinsic size, so it
     fills whatever box it is in the moment the stylesheet is missing -
     a cached old copy, a stylesheet that 404s, a reader mode. This
     exact shape has bitten this site once already: a 16px tick on the
     PerformLive page rendered about 900px tall because that page was
     not loading sale.css. Sized here it cannot happen again, and the
     CSS below only ever refines it. */
  var SCREEN = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<rect x="1.4" y="2.2" width="13.2" height="9" rx="1.4" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M5.6 13.8h4.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var PHONE = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<rect x="4.2" y="1.4" width="7.6" height="13.2" rx="1.6" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M7 12.6h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  /* The order is the order they are shown in, so it does not follow
     whatever order the catalog happens to list installers in. */
  var KNOWN = [
    { id: 'windows',   name: 'Windows',        icon: SCREEN },
    { id: 'mac',       name: 'macOS',          icon: SCREEN },
    { id: 'mac-arm64', name: 'macOS',          icon: SCREEN },
    { id: 'mac-x64',   name: 'macOS',          icon: SCREEN },
    { id: 'mac-legacy',name: 'macOS',          icon: SCREEN },
    { id: 'ios',       name: 'iPhone & iPad',  icon: PHONE },
    { id: 'android',   name: 'Android',        icon: PHONE },
    { id: 'linux',     name: 'Linux',          icon: SCREEN }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  slots.forEach(function (slot) {
    var app = (slot.getAttribute('data-app') ||
               document.body.getAttribute('data-app') || '').toLowerCase();
    if (!app) return;

    window.StoreState.catalog().then(function (c) {
      var a = (c.apps || {})[app];
      if (!a) return;

      var have = a.platforms || Object.keys(a.installers || {});
      if (!have.length) return;              // nothing built yet: say nothing

      /* Two Mac builds are one Mac to a reader. Collapsed by name so a
         page never reads "macOS · macOS". */
      var seen = {}, pills = [];
      KNOWN.forEach(function (p) {
        if (have.indexOf(p.id) < 0 || seen[p.name]) return;
        seen[p.name] = true;
        var size = (a.installers && a.installers[p.id] && a.installers[p.id].size) || '';
        pills.push('<span class="plat"' + (size ? ' title="' + esc(size) + '"' : '') + '>' +
                   p.icon + '<span>' + esc(p.name) + '</span></span>');
      });
      if (!pills.length) return;

      slot.innerHTML = '<span class="plat-lead">Runs on</span>' + pills.join('');
      slot.hidden = false;
    });
  });
})();
