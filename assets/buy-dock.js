/* =====================================================================
   The buy button that follows you down the page.

   A long product page puts its price at the top and again at the
   bottom, and hides it for everything in between - which is most of
   the reading. This bar appears once every real buy button has
   scrolled out of sight and goes away again when one comes back.

   It decides nothing. It is a mirror: it copies the primary
   [data-buy] button's label and disabled state as app-purchase.js
   changes them (Buy, Coming soon, Install in Amanorsac Hub), and a
   click on it clicks that button. So there is one purchase flow, one
   set of rules about who owns what, and no second place for them to
   disagree.

   Needs assets/store-state.js for the price; assets/sale.css for the
   look. Silent on any page with no buy button.
   ===================================================================== */
(function () {
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-buy]'));
  if (!buttons.length || !window.StoreState) return;
  if (!('IntersectionObserver' in window)) return;
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();
  var primary = buttons[0];

  function money(cents) {
    if (typeof cents !== 'number' || !isFinite(cents) || cents <= 0) return null;
    var d = cents / 100;
    return '$' + (cents % 100 === 0 ? String(d) : d.toFixed(2));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.StoreState.catalog().then(function (c) {
    var a = (c.apps || {})[app];
    if (!a) return;

    /* Pay what you want has no price to put here, and a floor figure
       reads like one. It says what the button says instead. */
    var pwyw = !!a.pay_what_you_want;
    var now = a.free ? 'Free' : pwyw ? 'Name your price' : money(a.price_cents);
    var sale = c.promo && !a.free && !pwyw &&
               a.list_price_cents > a.price_cents &&
               window.StoreState.stateOf(a) === 'available';
    if (sale && c.promo.ends) {
      var t = Date.parse(c.promo.ends);
      if (isFinite(t) && t <= Date.now()) sale = false;
    }
    var pct = sale ? Math.round((1 - a.price_cents / a.list_price_cents) * 100) : 0;

    var dock = document.createElement('div');
    dock.className = 'sale-dock';
    dock.innerHTML =
      '<span class="who">' + esc(a.name || app) + '</span>' +
      '<span class="cost">' +
        (sale ? '<span class="flag">' + pct + '% OFF</span>' : '') +
        (now ? (pwyw ? '<span class="pwyw">' + now + '</span>'
                     : '<b>' + now + '</b>') : '') +
        (sale ? '<s>' + money(a.list_price_cents) + '</s>' : '') +
      '</span>';

    var btn = document.createElement('button');
    btn.type = 'button';
    dock.appendChild(btn);
    document.body.appendChild(dock);

    /* the mirror */
    function copy() {
      btn.textContent = primary.textContent;
      btn.disabled = !!primary.disabled;
    }
    copy();
    new MutationObserver(copy).observe(primary,
      { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    btn.addEventListener('click', function () { primary.click(); });

    /* up only once every real button is out of sight */
    var visible = 0;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible += e.isIntersecting ? 1 : -1; });
      visible = Math.max(0, visible);
      var past = primary.getBoundingClientRect().bottom < 0;
      dock.classList.toggle('up', visible === 0 && past);
    }, { rootMargin: '0px 0px -10% 0px' });
    buttons.forEach(function (b) { io.observe(b); });

    addEventListener('scroll', function () {
      if (visible === 0) dock.classList.toggle('up', primary.getBoundingClientRect().bottom < 0);
    }, { passive: true });
  });
})();
