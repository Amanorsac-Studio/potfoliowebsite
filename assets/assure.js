/* =====================================================================
   The four things worth knowing before you pay, under the buy button.

   Not part of the sale - these are true whether or not anything is
   reduced, so they live in their own file and outlive it. Every line
   is drawn from the app's own catalog entry, or from the refund clause
   in legal.html, so nothing here can drift away from what is actually
   promised. A page opts in with one empty element:

     <ul class="assure" data-assure></ul>

   Needs assets/store-state.js loaded first; assets/sale.css styles it.
   ===================================================================== */
(function () {
  var slots = document.querySelectorAll('[data-assure]');
  if (!slots.length || !window.StoreState) return;
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();

  var TICK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.3" opacity=".45"/>' +
    '<path d="M4.8 8.2 6.9 10.3 11.2 6" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  window.StoreState.catalog().then(function (c) {
    var a = (c.apps || {})[app];
    if (!a) return;

    var lines = [];

    /* A beta is free but not forever, and saying only "free" would be
       the kind of half-truth the privacy policy exists to stop. */
    var beta = a.free && a.licensed && a.beta_days;

    lines.push(beta
      ? ('Free for ' + a.beta_days + ' days. The clock starts the day you download it, not today.')
      : a.free
      ? 'Free. Sign in and it is yours.'
      : 'Secure checkout. Your card details go to Stripe, never to us.');

    /* Two shapes reach this file. store-state.js reads catalog.json
       itself, where the platforms are the keys of `installers`; the
       Worker's /api/catalog flattens them into a `platforms` array for
       the Hub. Accept either rather than depending on which one got
       here. */
    var plats = a.platforms || Object.keys(a.installers || {});
    var phone = plats.indexOf('android') >= 0 || plats.indexOf('ios') >= 0;
    var desktop = plats.indexOf('windows') >= 0 || plats.indexOf('mac') >= 0;

    lines.push(beta
      ? 'Your key is made when you download, and it is waiting in My Apps.'
      : (a.licensed && phone && desktop)
      ? 'One key, two computers and your phone. Yours to keep, with no subscription.'
      : a.licensed
      ? 'One key, two computers. Yours to keep, with no subscription.'
      : 'No activation, ever. It runs offline and never asks who you are.');

    /* "Instant download" has to stop being said the moment it stops
       being true. A paused app says why instead - and an app that also
       runs on a phone does not install through a desktop launcher, so
       it does not claim to. */
    var here = window.StoreState.stateOf(a);
    lines.push(here !== 'available'
      ? (a.soon_note || 'Not available to download yet. It arrives in Amanorsac Hub the day it ships.')
      : (phone && desktop)
      ? 'Instant download. The desktop build installs and updates through Amanorsac Hub; the phone build is a direct download.'
      : phone
      ? 'Instant download, straight to your phone.'
      : 'Instant download. It installs and updates through Amanorsac Hub.');

    if (beta) {
      lines.push('Tell us what breaks. That is what a beta is for — ' +
                 '<a href="mailto:hello@amanorsac.studio">hello@amanorsac.studio</a>.');
    } else if (!a.free) {
      lines.push('Will not run on a system we list? Tell us within thirty days and ' +
                 'we refund it — <a href="/legal.html#terms">the terms say so</a>.');
    }

    slots.forEach(function (slot) {
      slot.innerHTML = lines.map(function (t) {
        return '<li>' + TICK + '<span>' + t + '</span></li>';
      }).join('');
      slot.hidden = false;
    });
  });
})();
