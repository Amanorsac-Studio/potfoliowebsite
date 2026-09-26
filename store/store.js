/* =====================================================================
   The store. Every page under /store/ loads this one file and says
   which page it is with <body data-page="...">.

   Two halves:

     StoreAPI  - where the data comes from. Today that is fixture.json,
                 a file of test artists and packs. The day the tables
                 exist in Supabase, the functions in `live` below take
                 over and the pages do not change - they only ever call
                 StoreAPI.catalog(), StoreAPI.item() and so on.

     pages     - one function per page, drawing into <main>.

   One backend. Accounts are the same accounts people already have on
   amanorsac.studio (assets/site-auth.js draws the chip in the header),
   and purchases will land in the same `purchases` table the apps use.
   Creators are ordinary accounts that applied and were let in - the
   application form is on creators.html, and what it asks for is the
   part still waiting on Stephen's requirements.

   TEST is the one switch. While it is true:
     - the amber ribbon says so on every page
     - "Buy" opens a box instead of Stripe, and "pretend I paid" drops
       the pack into a library kept in this browser only
     - the creator application is kept in this browser and not sent
   ===================================================================== */
(function () {
  'use strict';

  var TEST = true;
  var TEST_LIB_KEY = 'store-test-library';
  var TEST_APPLY_KEY = 'store-test-application';

  /* ---------------- little helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents, cur) {
    if (!cents) return 'Free';
    var v = cents / 100;
    var s = (cur === 'GHS' ? 'GH₵' : cur === 'NGN' ? '₦' : cur === 'ZAR' ? 'R' : '$');
    return s + (v % 1 ? v.toFixed(2) : v);
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    if (!p.length || !p[0]) return '?';
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }
  function param(k) { return new URL(location.href).searchParams.get(k) || ''; }
  function dateShort(iso) {
    if (!iso) return '';
    var d = new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : ''));
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function mb(n) { return n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB'; }

  /* the palette a person gets: one of the lane colours, chosen by name,
     so the same creator is the same colour on every page */
  var PEOPLE_COLOURS = ['#00D9FF', '#A855F7', '#FF2D95', '#FFA62B', '#3DFFC0', '#4D7CFF', '#B6FF2E', '#FF5C3B'];
  function personColour(slug) { return PEOPLE_COLOURS[hash(slug || '') % PEOPLE_COLOURS.length]; }

  function avatar(c, size) {
    return '<span class="av ' + (size || '') + '" style="background:' + personColour(c.slug) + '" aria-hidden="true">' + esc(initials(c.name)) + '</span>';
  }

  /* A cover for a pack that has no artwork yet: the lane's colour, the
     creator's initials, and a waveform drawn from the pack's id so it is
     always the same one. Inline SVG, so no image files and no CSP work. */
  function cover(item, creator, lane) {
    var c = (lane && lane.colour) || '#7C5CFF';
    var seed = hash(item.id || item.slug || 'x');
    var bars = '';
    for (var i = 0; i < 40; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      var h = 12 + (seed % 100) * 1.4;
      bars += '<rect x="' + (28 + i * 8.6) + '" y="' + (250 - h / 2) + '" width="5" height="' + h + '" rx="2"/>';
    }
    var id = 'g' + (item.id || '').replace(/\W/g, '');
    return '<svg viewBox="0 0 400 400" role="img" aria-label="">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c + '" stop-opacity=".95"/><stop offset="1" stop-color="' + c + '" stop-opacity=".35"/></linearGradient></defs>' +
      '<rect width="400" height="400" fill="#0F0F1D"/>' +
      '<rect width="400" height="400" fill="url(#' + id + ')"/>' +
      '<circle cx="330" cy="70" r="120" fill="#07070F" fill-opacity=".18"/>' +
      '<g fill="#07070F" fill-opacity=".55">' + bars + '</g>' +
      '<text x="28" y="76" font-family="Sora,system-ui,sans-serif" font-weight="700" font-size="44" fill="#07070F" fill-opacity=".85">' + esc(initials(creator ? creator.name : '')) + '</text>' +
      '<text x="28" y="356" font-family="JetBrains Mono,monospace" font-size="14" fill="#07070F" fill-opacity=".8" letter-spacing="1">' + esc((lane ? lane.name : '').toUpperCase()) + '</text>' +
      '</svg>';
  }

  /* ---------------- data ---------------- */
  var fixturePending = null;
  function fixture() {
    if (!fixturePending) {
      fixturePending = fetch('/store/fixture.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('fixture ' + r.status);
        return r.json();
      }).then(function (d) {
        d.byId = {}; d.bySlug = {}; d.creatorBy = {}; d.laneBy = {};
        d.items.forEach(function (it) { d.byId[it.id] = it; d.bySlug[it.slug] = it; });
        d.creators.forEach(function (c) { d.creatorBy[c.slug] = c; });
        d.lanes.forEach(function (l) { d.laneBy[l.id] = l; });
        return d;
      });
    }
    return fixturePending;
  }

  function testLib() {
    try { return JSON.parse(localStorage.getItem(TEST_LIB_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveTestLib(ids) { try { localStorage.setItem(TEST_LIB_KEY, JSON.stringify(ids)); } catch (e) {} }

  /* The fixture adapter. Each function has the same name and shape it
     will have when the data is in Supabase (the `live` object below). */
  var fromFixture = {
    lanes: function () { return fixture().then(function (d) { return d.lanes; }); },
    catalog: function (o) {
      o = o || {};
      return fixture().then(function (d) {
        var q = (o.q || '').trim().toLowerCase();
        var list = d.items.filter(function (it) {
          if (o.lane && it.lane !== o.lane) return false;
          if (o.creator && it.creator !== o.creator) return false;
          if (!q) return true;
          var c = d.creatorBy[it.creator] || {};
          var hay = [it.title, it.summary, it.tags.join(' '), c.name, (d.laneBy[it.lane] || {}).name].join(' ').toLowerCase();
          return hay.indexOf(q) >= 0;
        });
        if (o.sort === 'released_at') list = list.slice().sort(function (a, b) { return a.released_at < b.released_at ? 1 : -1; });
        else if (o.sort === 'sales') list = list.slice().sort(function (a, b) { return b.sales - a.sales; });
        var off = o.offset || 0, lim = o.limit || 60;
        return { items: list.slice(off, off + lim), total: list.length };
      });
    },
    item: function (idOrSlug) {
      return fixture().then(function (d) { return d.byId[idOrSlug] || d.bySlug[idOrSlug] || null; });
    },
    creator: function (slug) {
      return fixture().then(function (d) {
        var c = d.creatorBy[slug];
        if (!c) return null;
        return { creator: c, items: d.items.filter(function (it) { return it.creator === slug; }) };
      });
    },
    creators: function () { return fixture().then(function (d) { return d.creators; }); },
    sections: function () { return fixture().then(function (d) { return d.sections; }); },
    /* the library: what this account owns. In test, a list in this browser */
    library: function () {
      return fixture().then(function (d) {
        var ids = testLib(); if (!ids) { ids = d.test_library.slice(); saveTestLib(ids); }
        return ids.map(function (id) { return d.byId[id]; }).filter(Boolean);
      });
    },
    own: function (id) { return fromFixture.library().then(function (l) { return l.some(function (it) { return it.id === id; }); }); },
    /* checkout: returns {url}. In test, the url is our own success page */
    checkout: function (itemIds) {
      return Promise.resolve({ url: '/store/success?items=' + encodeURIComponent(itemIds.join(',')) + '&test=1' });
    },
    grant: function (itemIds) {
      var ids = testLib() || [];
      itemIds.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
      saveTestLib(ids);
      return Promise.resolve(ids);
    },
    download: function (id) { return Promise.resolve({ test: true, id: id }); },
    apply: function (form) {
      try { localStorage.setItem(TEST_APPLY_KEY, JSON.stringify({ at: new Date().toISOString(), form: form })); } catch (e) {}
      return Promise.resolve({ ok: true, test: true });
    },
    dashboard: function () { return fixture().then(function (d) { return d.dashboard; }); }
  };

  /* The real adapter, for when the tables exist. Same names, same
     shapes. Written now so the contract is on paper; nothing calls it
     while TEST is true.

       store_creators  (slug, user_id, name, kind, country, bio, links, approved_at)
       store_items     (id, slug, creator_slug, title, lane, price_cents, currency,
                        tags[], summary, description, contents jsonb, preview_key,
                        r2_key, size_mb, released_at, status)
       creator_applications (user_id, ... whatever the requirements say ..., status)
       purchases       the existing table; store rows carry app_id = store item id

     Checkout goes through a Supabase function the way the apps do
     (create-app-checkout is the pattern): the browser never sees a
     secret key. Downloads are signed by the Worker from R2, the same
     way app installers are. */
  var live = {
    _sb: function () { return window.amanorsacClient ? window.amanorsacClient() : null; },
    lanes: fromFixture.lanes,
    catalog: function (o) {
      var sb = live._sb(); o = o || {};
      var q = sb.from('store_items').select('*').eq('status', 'published');
      if (o.lane) q = q.eq('lane', o.lane);
      if (o.creator) q = q.eq('creator_slug', o.creator);
      if (o.q) q = q.textSearch('search', o.q, { type: 'websearch' });
      q = q.order(o.sort === 'released_at' ? 'released_at' : 'sales', { ascending: false })
           .range(o.offset || 0, (o.offset || 0) + (o.limit || 60) - 1);
      return q.then(function (r) { return { items: r.data || [], total: (r.data || []).length }; });
    },
    item: function (idOrSlug) {
      return live._sb().from('store_items').select('*').or('id.eq.' + idOrSlug + ',slug.eq.' + idOrSlug).maybeSingle()
        .then(function (r) { return r.data; });
    },
    creator: function (slug) {
      var sb = live._sb();
      return Promise.all([
        sb.from('store_creators').select('*').eq('slug', slug).maybeSingle(),
        sb.from('store_items').select('*').eq('creator_slug', slug).eq('status', 'published')
      ]).then(function (r) { return r[0].data ? { creator: r[0].data, items: r[1].data || [] } : null; });
    },
    creators: function () { return live._sb().from('store_creators').select('*').not('approved_at', 'is', null).then(function (r) { return r.data || []; }); },
    sections: fromFixture.sections,
    library: function () {
      return live._sb().from('purchases').select('app_id').then(function (r) {
        var ids = (r.data || []).map(function (p) { return p.app_id; }).filter(function (id) { return /^it_/.test(id); });
        if (!ids.length) return [];
        return live._sb().from('store_items').select('*').in('id', ids).then(function (r2) { return r2.data || []; });
      });
    },
    own: function (id) { return live.library().then(function (l) { return l.some(function (it) { return it.id === id; }); }); },
    checkout: function (itemIds) {
      var key = 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      return live._sb().functions.invoke('create-store-checkout', { body: { items: itemIds, idempotencyKey: key } })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    grant: function () { return Promise.resolve([]); },
    download: function (id) {
      return live._sb().functions.invoke('store-download', { body: { item: id } }).then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    apply: function (form) {
      return live._sb().from('creator_applications').insert(form).then(function (r) { if (r.error) throw r.error; return { ok: true }; });
    },
    dashboard: fromFixture.dashboard
  };

  var API = TEST ? fromFixture : live;
  window.StoreAPI = API;
  window.StoreTest = TEST;

  /* ---------------- shell ---------------- */
  function shell() {
    if (TEST) {
      document.body.setAttribute('data-test', '');
      var bar = document.createElement('div');
      bar.className = 'testbar';
      bar.innerHTML = '<b>TEST BUILD</b> Nothing here is for sale. The names are placeholders for testing, and no payment is taken.';
      document.body.appendChild(bar);
    }
    var here = document.body.getAttribute('data-page');
    $$('.topnav a').forEach(function (a) {
      if (a.getAttribute('data-nav') === here) a.setAttribute('aria-current', 'page');
    });
    var search = $('.topsearch input');
    if (search) {
      search.value = param('q');
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') location.href = '/store/?q=' + encodeURIComponent(search.value.trim());
      });
    }
  }

  /* ---------------- pieces ---------------- */
  function cardHTML(it, d, ownedIds) {
    var c = d.creatorBy[it.creator] || { name: '?', slug: '' };
    var l = d.laneBy[it.lane] || {};
    var owned = ownedIds && ownedIds.indexOf(it.id) >= 0;
    return '<a class="card" href="/store/item?p=' + esc(it.slug) + '">' +
      '<div class="cover">' + cover(it, c, l) + '</div>' +
      '<div class="body"><h3>' + esc(it.title) + '</h3>' +
      '<div class="by">' + avatar(c) + '<span>' + esc(c.name) + ' ' + esc(c.flag || '') + '</span></div>' +
      '<div class="foot"><span class="lane-pill" style="--c:' + esc(l.colour || '') + '"><i></i>' + esc(l.name || '') + '</span>' +
      (owned ? '<span class="owned">In your library</span>' : '<span class="price' + (it.price_cents ? '' : ' free') + '">' + money(it.price_cents, it.currency) + '</span>') +
      '</div></div></a>';
  }
  function personHTML(c, count) {
    return '<a class="person" href="/store/creator?c=' + esc(c.slug) + '">' + avatar(c, 'lg') +
      '<div class="who"><b>' + esc(c.name) + '</b><span>' + esc(c.flag || '') + ' ' + esc(c.country || '') +
      (c.kind === 'artist' ? ' · Artist' : ' · Creator') + '</span></div>' +
      (count != null ? '<span class="n">' + count + ' pack' + (count === 1 ? '' : 's') + '</span>' : '') + '</a>';
  }
  function grid(items, d, owned, cls) {
    return '<div class="grid ' + (cls || '') + '">' + items.map(function (it) { return cardHTML(it, d, owned); }).join('') + '</div>';
  }
  function section(title, blurb, inner, more) {
    return '<section class="sec"><div class="sec-head"><div><h2>' + esc(title) + '</h2>' +
      (blurb ? '<p>' + esc(blurb) + '</p>' : '') + '</div>' +
      (more ? '<a href="' + esc(more.href) + '">' + esc(more.text) + ' →</a>' : '') + '</div>' + inner + '</section>';
  }

  var ownedCache = null;
  function ownedIds() {
    if (ownedCache) return ownedCache;
    ownedCache = API.library().then(function (l) { return l.map(function (it) { return it.id; }); }, function () { return []; });
    return ownedCache;
  }

  /* ---------------- pages ---------------- */
  var pages = {};

  pages.index = function (main) {
    var q = param('q'), lane = param('lane');
    Promise.all([fixture(), ownedIds()]).then(function (r) {
      var d = r[0], owned = r[1];
      var lanesHTML = '<div class="lanes" role="group" aria-label="Lanes">' +
        '<a class="lane" href="/store/" aria-pressed="' + (!lane && !q) + '"><i style="background:var(--text)"></i>Everything</a>' +
        d.lanes.map(function (l) {
          return '<a class="lane" style="--c:' + l.colour + '" href="/store/?lane=' + l.id + '" aria-pressed="' + (lane === l.id) + '"><i></i>' + esc(l.name) + '</a>';
        }).join('') + '</div>';

      if (q || lane) {
        API.catalog({ q: q, lane: lane, sort: 'sales' }).then(function (res) {
          var l = d.laneBy[lane];
          var title = q ? 'Results for “' + q + '”' : (l ? l.name : 'Everything');
          var blurb = q ? res.total + ' pack' + (res.total === 1 ? '' : 's') : (l ? l.blurb : '');
          main.innerHTML = '<div class="wrap">' + lanesHTML +
            section(title, blurb, res.items.length ? grid(res.items, d, owned)
              : '<div class="empty">Nothing matched. Try a shorter word, or a lane above.</div>') + '</div>';
        });
        return;
      }

      var byCreator = {};
      d.items.forEach(function (it) { byCreator[it.creator] = (byCreator[it.creator] || 0) + 1; });
      var html = '<div class="wrap">' +
        '<div class="hero"><div><h1>Multitracks, pads and sets<br>from people who play on Sunday.</h1>' +
        '<p class="lead">Buy it once, open it in PerformLive, run the service. Made by artists and creators across Ghana, Nigeria and South Africa, and paid straight to them.</p>' +
        '<div class="cta"><a class="btn" href="/store/?lane=multitracks">Browse multitracks</a><a class="btn ghost" href="/store/creators">Sell on the store</a></div></div>' +
        '<div class="strip">' +
        '<div class="stat"><b class="num">' + d.items.length + '</b><span>packs on the shelf</span></div>' +
        '<div class="stat"><b class="num">' + d.creators.length + '</b><span>artists and creators</span></div>' +
        '<div class="stat"><b class="num">70%</b><span>of every sale goes to the maker</span></div>' +
        '<div class="stat"><b class="num">1 click</b><span>from the store into PerformLive</span></div>' +
        '</div></div>' + lanesHTML;

      d.sections.forEach(function (s) {
        if (s.items) {
          var items = s.items.map(function (id) { return d.byId[id]; }).filter(Boolean);
          html += section(s.title, s.blurb, grid(items, d, owned));
        } else if (s.creators) {
          var people = s.creators.map(function (sl) { return d.creatorBy[sl]; }).filter(Boolean);
          html += section(s.title, s.blurb, '<div class="grid wide">' + people.map(function (c) { return personHTML(c, byCreator[c.slug] || 0); }).join('') + '</div>');
        } else if (s.sort) {
          var list = d.items.slice().sort(function (a, b) { return a.released_at < b.released_at ? 1 : -1; }).slice(0, 8);
          html += section(s.title, s.blurb, grid(list, d, owned), { href: '/store/?lane=', text: 'See everything' });
        }
      });
      main.innerHTML = html + '</div>';
    }).catch(fail(main));
  };

  pages.item = function (main) {
    var slug = param('p');
    Promise.all([fixture(), API.item(slug), ownedIds()]).then(function (r) {
      var d = r[0], it = r[1], owned = r[2];
      if (!it) { main.innerHTML = '<div class="wrap"><div class="empty">That pack is not here. <a href="/store/">Back to the store</a></div></div>'; return; }
      var c = d.creatorBy[it.creator] || { name: '?', slug: '' };
      var l = d.laneBy[it.lane] || {};
      var mine = owned.indexOf(it.id) >= 0;
      document.title = it.title + ' · ' + c.name + ' · Amanorsac Store';
      var related = d.items.filter(function (x) { return x.id !== it.id && (x.creator === it.creator || x.lane === it.lane); }).slice(0, 4);

      main.innerHTML = '<div class="wrap"><div class="item">' +
        '<div><div class="cover">' + cover(it, c, l) + '</div>' +
        (it.preview ? player(it) : '<p class="faint" style="margin-top:12px;font-size:13px">No audio preview for this one.</p>') +
        '<div class="facts">' +
        '<div class="fact"><b>' + (it.songs || '—') + '</b><span>' + (it.lane === 'loops' ? 'loops' : it.lane === 'pads' ? 'pads' : it.lane === 'charts' ? 'charts' : 'songs') + '</span></div>' +
        '<div class="fact"><b>' + mb(it.size_mb) + '</b><span>download</span></div>' +
        '<div class="fact"><b>' + it.rating.toFixed(1) + '</b><span>' + it.sales + ' sold</span></div>' +
        '</div></div>' +
        '<div><div class="head"><span class="lane-pill" style="--c:' + esc(l.colour || '') + '"><i></i>' + esc(l.name) + '</span>' +
        '<h1>' + esc(it.title) + '</h1>' +
        '<div class="meta"><a class="by" href="/store/creator?c=' + esc(c.slug) + '">' + avatar(c) + '<span>' + esc(c.name) + ' ' + esc(c.flag || '') + '</span></a>' +
        '<span>Released ' + dateShort(it.released_at) + '</span></div></div>' +
        '<div class="buy">' + (mine
          ? '<span class="price" style="color:var(--green);font-size:18px">In your library</span>' +
            '<button class="btn" data-open="' + esc(it.id) + '">Open in PerformLive</button><a class="btn ghost" href="/store/library">Library</a>'
          : '<span class="price">' + money(it.price_cents, it.currency) + '</span>' +
            '<button class="btn" data-buy="' + esc(it.id) + '">Buy this pack</button>' +
            '<span class="note">One payment. Yours on every machine you sign in on.</span>') + '</div>' +
        '<p class="desc">' + esc(it.description) + '</p>' +
        '<div class="tags">' + (it.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<h2>What is inside</h2><ul class="contents">' + (it.contents || []).map(function (x) {
          return '<li><span class="k">' + esc(x.kind) + '</span><span>' + esc(x.name) + '</span>' + (x.length ? '<span class="l">' + esc(x.length) + '</span>' : '') + '</li>';
        }).join('') + '</ul>' +
        '<h2>About ' + esc(c.name.split(' ')[0]) + '</h2><p class="desc">' + esc(c.bio) + '</p>' +
        (c.youtube ? '<p style="margin-top:10px"><a href="' + esc(c.youtube) + '" rel="noopener" target="_blank">Watch on YouTube →</a></p>' : '') +
        '</div></div>' +
        (related.length ? section('More like this', '', grid(related, d, owned)) : '') +
        '</div>';
      wirePlayer(main);
      wireBuy(main, d);
    }).catch(fail(main));
  };

  pages.creator = function (main) {
    var slug = param('c');
    Promise.all([fixture(), API.creator(slug), ownedIds()]).then(function (r) {
      var d = r[0], res = r[1], owned = r[2];
      if (!res) { main.innerHTML = '<div class="wrap"><div class="empty">No one by that name here. <a href="/store/creators">See the creators</a></div></div>'; return; }
      var c = res.creator, items = res.items;
      document.title = c.name + ' · Amanorsac Store';
      var sold = items.reduce(function (n, it) { return n + (it.sales || 0); }, 0);
      main.innerHTML = '<div class="wrap">' +
        '<div class="profile">' + avatar(c, 'xl') + '<div class="who"><h1>' + esc(c.name) + ' ' +
        (c.verified ? '<span class="badge">✓ Verified</span> ' : '') + '<span class="badge kind">' + (c.kind === 'artist' ? 'Artist' : 'Creator') + '</span></h1>' +
        '<div class="line">' + esc(c.flag || '') + ' ' + esc(c.city ? c.city + ', ' : '') + esc(c.country) + ' · On the store since ' + dateShort(c.joined) + '</div>' +
        '<p class="bio">' + esc(c.bio) + '</p>' +
        '<div class="links">' + (c.youtube ? '<a class="btn ghost sm" href="' + esc(c.youtube) + '" rel="noopener" target="_blank">YouTube</a>' : '') + '</div></div>' +
        '<div class="stats"><div><b>' + items.length + '</b><span>packs</span></div><div><b>' + sold + '</b><span>sold</span></div></div></div>' +
        section('Packs by ' + c.name.split(' ')[0], '', items.length ? grid(items, d, owned) : '<div class="empty">Nothing on the shelf yet.</div>') +
        '</div>';
    }).catch(fail(main));
  };

  pages.creators = function (main) {
    Promise.all([fixture(), API.creators()]).then(function (r) {
      var d = r[0], people = r[1];
      var byCreator = {};
      d.items.forEach(function (it) { byCreator[it.creator] = (byCreator[it.creator] || 0) + 1; });
      var list = $('#creator-list');
      if (list) list.innerHTML = people.map(function (c) { return personHTML(c, byCreator[c.slug] || 0); }).join('');
    }).catch(function () {});

    var form = $('#apply-form');
    if (!form) return;
    var out = $('#apply-out');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) {
        if (data[k] !== undefined) data[k] = [].concat(data[k], v); else data[k] = v;
      });
      var btn = $('button[type=submit]', form);
      btn.disabled = true;
      API.apply(data).then(function (res) {
        form.reset();
        out.hidden = false; out.className = 'msg ok';
        out.textContent = res.test
          ? 'Received - in the test build it stays in this browser and is not sent anywhere. The real form will need a signed-in account.'
          : 'Received. Stephen reads every one; you will hear back by email.';
      }, function (err) {
        out.hidden = false; out.className = 'msg bad';
        out.textContent = 'That did not go through: ' + (err && err.message || err);
      }).then(function () { btn.disabled = false; });
    });
  };

  pages.library = function (main) {
    Promise.all([fixture(), API.library(), whoAmI()]).then(function (r) {
      var d = r[0], items = r[1], user = r[2];
      var note = TEST ? '<p class="msg warn" style="margin-bottom:16px">Test build: this library lives in this browser. Signed in' + (user ? ' as ' + esc(user.email) : ': no') + '.</p>'
                      : (user ? '' : '<div class="empty">Sign in to see what you own. <a class="btn" href="/client">Sign in</a></div>');
      if (!TEST && !user) { main.innerHTML = '<div class="wrap"><h1>Your library</h1>' + note + '</div>'; return; }
      main.innerHTML = '<div class="wrap"><h1 style="margin-bottom:16px">Your library</h1>' + note +
        (items.length ? '<div class="rows">' + items.map(function (it) {
          var c = d.creatorBy[it.creator] || {}; var l = d.laneBy[it.lane] || {};
          return '<div class="row"><div class="cover">' + cover(it, c, l) + '</div>' +
            '<div class="t"><b><a href="/store/item?p=' + esc(it.slug) + '" style="color:inherit">' + esc(it.title) + '</a></b><span>' + esc(c.name) + ' · ' + esc(l.name) + ' · ' + mb(it.size_mb) + '</span></div>' +
            '<div class="acts"><button class="btn sm" data-open="' + esc(it.id) + '">Open in PerformLive</button>' +
            '<button class="btn ghost sm" data-dl="' + esc(it.id) + '">Download</button></div></div>';
        }).join('') + '</div>'
        : '<div class="empty">Nothing here yet.<br><a class="btn" href="/store/">Find something</a></div>') + '</div>';
      wireLibrary(main);
    }).catch(fail(main));
  };

  pages.success = function (main) {
    var ids = param('items').split(',').filter(Boolean);
    var box = $('#bought');
    Promise.all([fixture(), ids.length ? API.grant(ids) : Promise.resolve([])]).then(function (r) {
      var d = r[0];
      var items = ids.map(function (id) { return d.byId[id]; }).filter(Boolean);
      if (box && items.length) {
        box.innerHTML = items.map(function (it) {
          var c = d.creatorBy[it.creator] || {}; var l = d.laneBy[it.lane] || {};
          return '<div class="row"><div class="cover">' + cover(it, c, l) + '</div>' +
            '<div class="t"><b>' + esc(it.title) + '</b><span>' + esc(c.name) + ' · ' + money(it.price_cents, it.currency) + '</span></div>' +
            '<div class="acts"><button class="btn sm" data-open="' + esc(it.id) + '">Open in PerformLive</button></div></div>';
        }).join('');
        wireLibrary(main);
      }
    }).catch(function () {});
  };

  pages.cancelled = function () {};

  pages.dashboard = function (main) {
    Promise.all([fixture(), API.dashboard()]).then(function (r) {
      var d = r[0], db = r[1];
      var c = d.creatorBy[db.creator] || {};
      var items = d.items.filter(function (it) { return it.creator === db.creator; });
      var mine = Math.round(db.gross_cents * db.split);
      main.innerHTML = '<div class="wrap">' +
        '<div class="sec-head"><div><h1>' + esc(c.name) + '</h1><p>Creator dashboard · ' + esc(db.month) + '</p></div>' +
        '<a class="btn ghost" href="/store/creator?c=' + esc(c.slug) + '">See my page</a></div>' +
        (TEST ? '<p class="msg warn">Test build: these numbers are made up, and this page shows for anyone. Live, it opens only for an approved creator on their own account.</p>' : '') +
        '<div class="kpis">' +
        '<div class="kpi"><b>' + db.sales_this_month + '</b><span>sales this month</span></div>' +
        '<div class="kpi"><b>' + money(db.gross_cents) + '</b><span>gross</span></div>' +
        '<div class="kpi"><b>' + money(mine) + '</b><span>yours, at ' + Math.round(db.split * 100) + '%</span><small>next payout ' + dateShort(db.next_payout) + '</small></div>' +
        '<div class="kpi"><b>' + items.length + '</b><span>packs on the shelf</span></div></div>' +
        section('Recent sales', '', '<table class="tbl"><thead><tr><th>Date</th><th>Pack</th><th>Country</th><th class="num">Amount</th></tr></thead><tbody>' +
          db.recent.map(function (s) { var it = d.byId[s.item] || {}; return '<tr><td class="num">' + esc(s.date) + '</td><td>' + esc(it.title) + '</td><td>' + esc(s.country) + '</td><td class="num">' + money(s.amount_cents) + '</td></tr>'; }).join('') +
          '</tbody></table>') +
        section('Your packs', '', '<div class="rows">' + items.map(function (it) {
          var l = d.laneBy[it.lane] || {};
          return '<div class="row"><div class="cover">' + cover(it, c, l) + '</div><div class="t"><b>' + esc(it.title) + '</b><span>' + esc(l.name) + ' · ' + money(it.price_cents) + ' · ' + it.sales + ' sold · ' + it.rating.toFixed(1) + '</span></div>' +
            '<div class="acts"><a class="btn ghost sm" href="/store/item?p=' + esc(it.slug) + '">View</a><button class="btn quiet sm" disabled title="Editing comes with the live build">Edit</button></div></div>';
        }).join('') + '</div>') +
        section('Payouts', '', '<table class="tbl"><thead><tr><th>Date</th><th>Method</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>' +
          db.payouts.map(function (p) { return '<tr><td class="num">' + esc(p.date) + '</td><td>' + esc(p.method) + '</td><td class="ok">' + esc(p.status) + '</td><td class="num">' + money(p.amount_cents) + '</td></tr>'; }).join('') +
          '</tbody></table>') +
        '</div>';
    }).catch(fail(main));
  };

  /* ---------------- behaviours ---------------- */
  function whoAmI() {
    var sb = window.amanorsacClient ? window.amanorsacClient() : null;
    if (!sb) return Promise.resolve(null);
    return sb.auth.getSession().then(function (r) { return r && r.data && r.data.session ? r.data.session.user : null; }, function () { return null; });
  }

  function player(it) {
    var bars = ''; for (var i = 0; i < 48; i++) bars += '<i style="height:' + (20 + (hash(it.id + i) % 80)) + '%"></i>';
    return '<div class="player" data-src="' + esc(it.preview) + '">' +
      '<button type="button" aria-label="Play preview"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></button>' +
      '<div class="bars">' + bars + '</div><span class="t">preview</span>' +
      (TEST ? '<small>sample audio</small>' : '') + '</div>';
  }
  function wirePlayer(root) {
    var p = $('.player', root); if (!p) return;
    var a = new Audio(p.getAttribute('data-src'));
    var btn = $('button', p), bars = $$('.bars i', p), t = $('.t', p);
    var PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>', PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
    function fmt(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
    btn.addEventListener('click', function () { if (a.paused) a.play().catch(function () {}); else a.pause(); });
    a.addEventListener('play', function () { btn.innerHTML = PAUSE; });
    a.addEventListener('pause', function () { btn.innerHTML = PLAY; });
    a.addEventListener('timeupdate', function () {
      var f = a.duration ? a.currentTime / a.duration : 0;
      bars.forEach(function (b, i) { b.classList.toggle('on', i / bars.length < f); });
      t.textContent = fmt(a.currentTime) + ' / ' + fmt(a.duration);
    });
    a.addEventListener('error', function () { t.textContent = 'no preview'; btn.disabled = true; });
    $('.bars', p).addEventListener('click', function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      if (a.duration) a.currentTime = a.duration * ((e.clientX - r.left) / r.width);
    });
  }

  function modal(title, body, acts) {
    var m = $('#store-modal');
    if (!m) { m = document.createElement('div'); m.id = 'store-modal'; m.className = 'modal'; document.body.appendChild(m); }
    m.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="sm-t"><h2 id="sm-t">' + esc(title) + '</h2>' + body +
      '<div class="acts">' + acts.map(function (a, i) { return '<button class="btn ' + (a.ghost ? 'ghost' : '') + '" data-act="' + i + '">' + esc(a.text) + '</button>'; }).join('') + '</div></div>';
    m.setAttribute('open', '');
    $$('[data-act]', m).forEach(function (b) {
      b.addEventListener('click', function () { m.removeAttribute('open'); var a = acts[+b.getAttribute('data-act')]; if (a.run) a.run(); });
    });
    m.addEventListener('click', function (e) { if (e.target === m) m.removeAttribute('open'); });
  }

  function wireBuy(root, d) {
    $$('[data-buy]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-buy');
        var it = d.byId[id];
        if (TEST) {
          modal('Test build', '<p>Checkout is switched off. Live, this button sends <code>' + esc(id) + '</code> to <code>create-store-checkout</code> and comes back to /store/success with the pack in your library.</p>' +
            '<p style="margin-top:10px">You can pretend, to test the rest of the flow.</p>',
            [{ text: 'Not now', ghost: true }, { text: 'Pretend I paid ' + money(it.price_cents), run: function () {
              API.checkout([id]).then(function (r) { location.href = r.url; });
            } }]);
          return;
        }
        whoAmI().then(function (user) {
          if (!user) { location.href = '/client?next=' + encodeURIComponent(location.pathname + location.search); return; }
          b.disabled = true; b.textContent = 'One moment';
          API.checkout([id]).then(function (r) { location.href = r.url; }, function (err) {
            b.disabled = false; b.textContent = 'Buy this pack';
            modal('That did not work', '<p>' + esc(err && err.message || err) + '</p>', [{ text: 'OK' }]);
          });
        });
      });
    });
    wireLibrary(root);
  }

  function wireLibrary(root) {
    $$('[data-open]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-open');
        /* the deep link PerformLive registers; the brief's section 5 */
        var link = 'performlive://install/' + encodeURIComponent(id);
        modal('Opening PerformLive', '<p>If PerformLive is installed it opens now and fetches the pack. If nothing happens, get PerformLive from <a href="/performlive">its page</a>, then come back here.</p>' +
          '<p style="margin-top:10px"><code>' + esc(link) + '</code></p>', [{ text: 'Close', ghost: true }, { text: 'Open', run: function () { location.href = link; } }]);
      });
    });
    $$('[data-dl]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-dl');
        API.download(id).then(function (r) {
          if (r && r.url) { location.href = r.url; return; }
          modal('Test build', '<p>Live, this asks the Worker for a signed link to the pack in R2 - the same way the app installers are served - and it starts at once.</p>', [{ text: 'OK' }]);
        }, function (err) { modal('That did not work', '<p>' + esc(err && err.message || err) + '</p>', [{ text: 'OK' }]); });
      });
    });
  }

  function fail(main) {
    return function (err) {
      main.innerHTML = '<div class="wrap"><div class="empty">The store could not load. ' + esc(err && err.message || err) + '</div></div>';
    };
  }

  /* ---------------- go ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    shell();
    var page = document.body.getAttribute('data-page');
    var main = $('#main');
    if (pages[page] && main) pages[page](main);
  });
})();
