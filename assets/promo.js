/* =====================================================================
   The sale line.

   catalog.json carries one optional top-level block:

     "promo": { "percent": 50, "note": "Half price for a limited time" }

   and each paid app carries `list_price_cents` - what it costs when
   there is no sale on - next to `price_cents`, what it costs today.
   Every price on the site is already the price people pay; this file
   only adds the sentence that says why it is lower than usual.

   Ending the sale is deleting the promo block. Nothing else needs
   touching: with no block, every slot here stays hidden and the pages
   read exactly as they did before it existed.

   A page opts in by putting an empty, hidden element where the line
   should appear:

     <p class="promo-line" data-promo hidden></p>          the page's own app
     <p class="promo-line" data-promo="aether" hidden></p> a named app
     <p class="promo-line" data-promo="store" hidden></p>  the shop-wide line

   Needs assets/store-state.js loaded first - the catalog is fetched
   once and shared.
   ===================================================================== */
(function () {
  var slots = document.querySelectorAll('[data-promo]');
  if (!slots.length || !window.StoreState) return;

  function money(cents) {
    if (typeof cents !== 'number' || !isFinite(cents) || cents <= 0) return null;
    var d = cents / 100;
    return '$' + (cents % 100 === 0 ? String(d) : d.toFixed(2));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var CSS =
    '.promo-line{margin:10px 0 0;font-size:14px;line-height:1.6}' +
    '.promo-line[hidden]{display:none}' +
    '.promo-tag{display:inline-block;margin-right:9px;padding:2px 9px;border:1px solid currentColor;' +
    'border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;' +
    'vertical-align:1px;opacity:.9}' +
    '.promo-line s{opacity:.7;text-decoration-thickness:1px}';

  function style() {
    if (document.getElementById('promo-css')) return;
    var s = document.createElement('style');
    s.id = 'promo-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function tag(promo) {
    var pct = Number(promo.percent);
    return (pct > 0 && pct < 100) ? '<span class="promo-tag">' + pct + '% off</span>' : '';
  }

  window.StoreState.catalog().then(function (c) {
    var promo = c && c.promo;
    if (!promo) return;                       // no sale on: every slot stays hidden
    var apps = c.apps || {};
    var note = esc(promo.note || ((promo.percent || '') + '% off for a limited time'));

    slots.forEach(function (el) {
      var which = (el.getAttribute('data-promo') || '').toLowerCase() ||
                  (document.body.getAttribute('data-app') || '').toLowerCase();

      if (which === 'store') {
        el.innerHTML = tag(promo) + '<b>' + note + '.</b> Prices below already have it taken off.';
        el.hidden = false;
        style();
        return;
      }

      var app = apps[which];
      if (!app || app.free) return;
      var was = money(app.list_price_cents);
      var now = money(app.price_cents);
      if (!was || !now || app.list_price_cents <= app.price_cents) return;

      el.innerHTML = tag(promo) + '<b>' + note + '</b> — normally <s>' + was + '</s>, ' +
                     'yours for ' + now + ' today.';
      el.hidden = false;
      style();
    });
  });
})();
