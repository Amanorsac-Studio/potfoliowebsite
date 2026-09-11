/* =====================================================================
   The sale.

   catalog.json carries one optional top-level block:

     "promo": {
       "percent": 50,
       "note":    "Half price for a limited time",
       "ends":    "2026-09-30T23:59:59Z"     (optional)
     }

   and each paid app carries `list_price_cents` - what it costs when no
   sale is on - next to `price_cents`, what it costs today. Every price
   on the site is already the price people pay; this file only adds the
   red furniture that says why it is lower than usual:

     [data-sale-banner]   the banner that opens the App Store
     [data-promo]         the line under a buy button, or "store" for
                          the shop-wide one
     a strip across the top of each product page

   THE COUNTDOWN IS REAL OR IT IS NOT THERE. `ends` is a deadline, not a
   decoration: the moment it passes, every piece of this disappears by
   itself - here, on a page that is already open, and in /api/catalog.
   It must never be a timer that resets, and `list_price_cents` must be
   a price the app was really sold at. The US FTC calls the other kind a
   "baseless countdown timer" and treats it as a deceptive practice, and
   it is a bad way to treat people besides.

   Ending the sale early is deleting the promo block. Nothing else needs
   touching: with no block, none of this is drawn and the pages read
   exactly as they did before it existed.

   Needs assets/store-state.js loaded first, and assets/sale.css for the
   look. Draws nothing on a page that has no slot for it.
   ===================================================================== */
(function () {
  if (!window.StoreState) return;
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();

  function money(cents) {
    if (typeof cents !== 'number' || !isFinite(cents) || cents <= 0) return null;
    var d = cents / 100;
    return '$' + (cents % 100 === 0 ? String(d) : d.toFixed(2));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---- what one app saves, or nothing ---- */
  function deal(a) {
    if (!a || a.free) return null;
    var was = a.list_price_cents, now = a.price_cents;
    if (!(was > 0) || !(now > 0) || was <= now) return null;
    return { was: money(was), now: money(now),
             pct: Math.round((1 - now / was) * 100) };
  }

  /* ---- the clock ---- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function remaining(ends) {
    var ms = ends - Date.now();
    if (ms <= 0) return null;
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
        m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (d > 0) return d + 'd ' + pad(h) + 'h ' + pad(m) + 'm';
    if (h > 0) return pad(h) + 'h ' + pad(m) + 'm ' + pad(sec) + 's';
    return pad(m) + 'm ' + pad(sec) + 's';
  }

  window.StoreState.catalog().then(function (c) {
    var promo = c && c.promo;
    if (!promo) return;                        // no sale on: nothing is drawn

    var ends = promo.ends ? Date.parse(promo.ends) : NaN;
    ends = isFinite(ends) ? ends : null;
    if (ends && ends <= Date.now()) return;    // the deadline passed: claim nothing

    var apps = c.apps || {};
    var note = esc(promo.note || ((promo.percent || '') + '% off for a limited time'));
    var pct = Number(promo.percent) > 0 ? Math.round(promo.percent) : null;
    /* An app that is not on sale here - coming_soon in public while a
       preview build has it - gets no red at all. A price struck out
       next to a button that says "Coming soon" is a price nobody can
       pay. See assets/store-state.js for which answer applies where. */
    var onSaleHere = apps[app] && window.StoreState.stateOf(apps[app]) === 'available';
    var mine = onSaleHere ? deal(apps[app]) : null;
    var when = ends ? new Date(ends) : null;
    var byline = when ? 'Sale ends ' + when.toLocaleString(undefined,
      { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    var clocks = [];          // every element showing the countdown
    var furniture = [];       // everything to take away when it runs out

    function clock(prefix) {
      var n = el('span', 'clock');
      n.setAttribute('data-prefix', prefix == null ? 'Ends in ' : prefix);
      if (byline) n.title = byline;
      clocks.push(n);
      return n;
    }
    function beat() {
      var left = ends ? remaining(ends) : null;
      if (ends && !left) return over();
      clocks.forEach(function (n) {
        n.textContent = left ? (n.getAttribute('data-prefix') + left) : '';
        n.hidden = !left;
      });
    }
    /* The deadline passing while someone is reading is the one case
       that has to be right: the offer goes, not just the clock. Every
       red thing on the page, wherever it was drawn from, goes with it -
       the tile flags and struck-out prices the store draws for itself,
       and the sticky bar's badge. */
    function over() {
      clearInterval(timer);
      furniture.forEach(function (n) {
        if (n.hasAttribute('data-promo')) { n.innerHTML = ''; n.hidden = true; }
        else if (n.parentNode) n.parentNode.removeChild(n);
      });
      document.querySelectorAll('.sale-flag, .app-price s, .sale-dock .flag, .sale-dock .cost s')
        .forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      dispatchEvent(new Event('sale:over'));
    }

    /* ---- the banner that opens the store ---- */
    var host = document.querySelector('[data-sale-banner]');
    if (host) {
      var banner = el('div', 'sale-banner');
      var say = el('div');
      say.appendChild(el('p', 'big', pct ? pct + '% off' : note));
      say.appendChild(el('p', 'sub', esc(note) +
        '. Every price below already has it taken off — one purchase, no ' +
        'subscription, and the licence stays yours afterwards.'));
      banner.appendChild(say);

      if (ends) {
        var right = el('div', 'ends');
        right.appendChild(el('p', 'lab', 'Sale ends in'));
        var big = clock('');
        big.className = 'clock';
        right.appendChild(big);
        right.appendChild(el('p', 'when', esc(byline.replace(/^Sale ends /, ''))));
        banner.appendChild(right);
      }
      host.appendChild(banner);
      furniture.push(banner);
    }

    /* ---- the strip across the top of a product page ---- */
    if (mine && !host) {
      var strip = el('div', 'sale-strip');
      strip.appendChild(el('span', 'pc', mine.pct + '% off'));
      strip.appendChild(el('span', null,
        esc(apps[app].name || app) + ' is <b>' + mine.now + '</b> instead of <s>' + mine.was + '</s>'));
      if (ends) strip.appendChild(clock());
      document.body.insertBefore(strip, document.body.firstChild);
      furniture.push(strip);
    }

    /* ---- the line under a buy button ---- */
    document.querySelectorAll('[data-promo]').forEach(function (slot) {
      var which = (slot.getAttribute('data-promo') || '').toLowerCase() || app;

      if (which === 'store') {
        slot.innerHTML = (pct ? '<span class="promo-tag">' + pct + '% off</span>' : '') +
          '<b>' + note + '.</b> Prices below already have it taken off.';
        if (ends) slot.appendChild(clock('sale-when'));
        slot.hidden = false;
        furniture.push(slot);
        return;
      }

      if (which === app && !onSaleHere) return;
      var d = deal(apps[which]);
      if (!d) return;
      slot.innerHTML = '<span class="promo-tag">' + d.pct + '% off</span>' +
        '<b>' + note + '</b> — normally <s>' + d.was + '</s>, yours for <b>' + d.now + '</b> today. ';
      if (ends) slot.appendChild(clock());
      slot.hidden = false;
      furniture.push(slot);
    });

    beat();
    var timer = setInterval(beat, 1000);
  });
})();
