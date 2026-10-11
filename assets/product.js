/* =====================================================================
   Product pages: the small things the layout needs, and nothing that
   buys. assets/app-purchase.js still owns every [data-buy] button.

     - pictures and blocks rise into place as they are reached
     - the tab in the product bar for the section you are reading lights
     - every [data-price] reads the price from the catalog, so the bar,
       the hero and the buy panel can never disagree with checkout

   Gives up quietly: with no IntersectionObserver everything is simply
   shown, and with no catalog the price written in the page stands.
   ===================================================================== */
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var risers = document.querySelectorAll('.rise, .hero-img');

  if ('IntersectionObserver' in window && !reduce) {
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    risers.forEach(function (el) { ro.observe(el); });
  } else {
    risers.forEach(function (el) { el.classList.add('in'); });
  }

  /* The tab for whatever section holds the middle of the screen. */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.pbar .tabs a[href^="#"]'));
  var targets = tabs.map(function (a) { return document.querySelector(a.getAttribute('href')); });
  if (tabs.length && 'IntersectionObserver' in window) {
    var seen = new Map();
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { seen.set(e.target, e.isIntersecting); });
      var on = -1;
      targets.forEach(function (t, i) { if (t && seen.get(t)) on = i; });
      tabs.forEach(function (a, i) { a.classList.toggle('on', i === on); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach(function (t) { if (t) so.observe(t); });
  }

  /* Prices from the catalog. */
  var slots = document.querySelectorAll('[data-price]');
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();
  if (!slots.length || !app || !window.StoreState || !window.StoreState.catalog) return;
  function money(c) { return '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)); }
  window.StoreState.catalog().then(function (c) {
    var a = c && c.apps && c.apps[app];
    if (!a) return;
    var html;
    var st = window.StoreState.stateOf ? window.StoreState.stateOf(a) : 'available';
    if (st !== 'available') html = 'Coming soon';
    else if (a.free) html = 'Free';
    else if (a.pay_what_you_want) html = 'Name your price';
    else if (typeof a.price_cents === 'number' && a.price_cents > 0) {
      var promo = a.promo || c.promo;
      var live = promo && !(promo.ends && Date.parse(promo.ends) <= Date.now());
      var was = live && a.list_price_cents > a.price_cents;
      var cents = window.StoreState.priceOf ? window.StoreState.priceOf(a, c) : a.price_cents;
      html = money(cents) + (was ? ' <s>' + money(a.list_price_cents) + '</s>' : '');
    }
    if (!html) return;
    addEventListener('sale:over', function () { slots.forEach(function (s) { s.innerHTML = money(a.list_price_cents > a.price_cents ? a.list_price_cents : a.price_cents); }); });
    slots.forEach(function (s) {
      var flip = s.hasAttribute('data-price-flip');
      s.innerHTML = flip && html.indexOf('<s>') > 0
        ? html.replace(/^(\S+) (<s>.*<\/s>)$/, '$2 $1') : html;
    });
  }).catch(function () {});
})();
