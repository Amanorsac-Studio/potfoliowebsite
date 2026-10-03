/* =====================================================================
   The store. Every page under /store/ loads this file and says which
   page it is with <body data-page="...">.

   Data comes from Supabase, the same project and the same accounts as
   the rest of the site:

     store_shelf           the public view: every approved or coming-
                           soon version with its song and its maker
     store_creators        who is selling
     store_library()       what the signed-in account can open
     creator_applications  the form on /store/creators
     create-store-checkout the Stripe function; rent or buy
     my_creator(), creator_sales()   the dashboard

   Files never pass through here: uploads go browser → Worker → R2
   (see upload.js), and PerformLive fetches stems with the Worker's
   manifest (docs/performlive-store-integration.md).
   ===================================================================== */
(function () {
  'use strict';

  var SLOTS = ['click', 'guide', 'drums', 'bass', 'keys', 'guitars', 'piano', 'aux_keys', 'horns', 'bgv'];
  var SLOT_NAMES = { click: 'Click', guide: 'Guide', drums: 'Drums', bass: 'Bass', keys: 'Keys', guitars: 'Guitars',
                     piano: 'Piano', aux_keys: 'Aux keys', horns: 'Horns', bgv: 'Backing vocals' };
  var LANES = [
    { id: 'songs',     name: 'Songs',         colour: '#00D9FF' },
    { id: 'pads',      name: 'Pads',          colour: '#A855F7' },
    { id: 'loops',     name: 'Loops',         colour: '#FF2D95' },
    { id: 'templates', name: 'Templates',     colour: '#FFA62B' },
    { id: 'clicks',    name: 'Click & guide', colour: '#3DFFC0' },
    { id: 'charts',    name: 'Charts',        colour: '#B6FF2E' }
  ];

  /* ---------------- helpers ---------------- */
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
    var s = (cur === 'ghs' ? 'GH₵' : cur === 'ngn' ? '₦' : cur === 'zar' ? 'R' : '$');
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
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function daysLeft(iso) { return Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 864e5)); }
  var PEOPLE_COLOURS = ['#00D9FF', '#A855F7', '#FF2D95', '#FFA62B', '#3DFFC0', '#4D7CFF', '#B6FF2E', '#FF5C3B'];
  function personColour(slug) { return PEOPLE_COLOURS[hash(slug || '') % PEOPLE_COLOURS.length]; }
  function avatar(c, size) {
    return '<span class="av ' + (size || '') + '" style="background:' + personColour(c.slug) + '" aria-hidden="true">' + esc(initials(c.name)) + '</span>';
  }
  function wrapWords(t, max) {
    var out = [], line = '';
    String(t || '').split(/\s+/).forEach(function (w) {
      if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    });
    if (line) out.push(line);
    if (out.length > 1 && out[out.length - 1].length <= 2) { out[out.length - 2] += ' ' + out.pop(); }
    return out.slice(0, 4);
  }
  /* Cover art. The real picture when one was uploaded; otherwise the
     title on the maker's colour. */
  function cover(it) {
    if (it.art) return '<img src="' + esc(it.art) + '" alt="" loading="lazy">';
    var c = personColour(it.creator);
    var seed = hash(it.id || 'x');
    var id = 'g' + String(it.id || '').replace(/\W/g, '');
    var lines = wrapWords(it.title, 13);
    var size = lines.length > 2 ? 34 : 40;
    var y0 = 300 - (lines.length - 1) * size;
    var text = lines.map(function (l, i) {
      return '<text x="28" y="' + (y0 + i * size) + '" font-family="Sora,system-ui,sans-serif" font-weight="700" font-size="' + size + '" fill="#F2F0FF">' + esc(l) + '</text>';
    }).join('');
    var rings = '';
    for (var i = 0; i < 3; i++) { seed = (seed * 1103515245 + 12345) >>> 0; rings += '<circle cx="' + (240 + (seed >>> 0) % 140) + '" cy="' + (60 + (seed >>> 8) % 120) + '" r="' + (70 + (seed >>> 16) % 90) + '" fill="none" stroke="#F2F0FF" stroke-opacity=".12" stroke-width="1.5"/>'; }
    return '<svg viewBox="0 0 400 400" role="img" aria-label="">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c + '"/><stop offset="1" stop-color="#0F0F1D"/></linearGradient></defs>' +
      '<rect width="400" height="400" fill="url(#' + id + ')"/>' + rings + text +
      '<text x="28" y="356" font-family="Inter,system-ui,sans-serif" font-size="15" fill="#F2F0FF" fill-opacity=".8">' + esc(it.creatorName || '') + '</text>' +
      '</svg>';
  }

  /* ---------------- data ---------------- */
  function sb() { return window.amanorsacClient ? window.amanorsacClient() : null; }
  function need(r) { if (r.error) throw r.error; return r.data; }

  /* a shelf row, as the pages like it */
  function shape(r) {
    return {
      id: r.id, songId: r.song_id, slug: r.song_slug, title: r.title, writers: r.writers,
      creator: r.creator_slug, creatorName: r.creator_name, creatorKind: r.creator_kind, flag: r.flag,
      kind: r.kind, label: r.label, original: !!r.is_original, lane: r.lane,
      key: r.key, bpm: r.bpm, timeSig: r.time_sig, length: r.length_seconds, year: r.year, album: r.album, feat: r.feat,
      youtube: r.youtube, art: r.art_key ? (/^https?:\/\//.test(r.art_key) ? r.art_key : '/store-art/' + r.id) : null,
      link: r.link || null, creatorYoutube: r.creator_youtube || null,
      rent: r.rent_cents, buy: r.buy_cents, currency: r.currency, status: r.status, sales: r.sales || 0,
      released: r.approved_at || r.created_at
    };
  }

  var shelfPending = null;
  function shelf() {
    if (!shelfPending) {
      shelfPending = Promise.all([
        sb().from('store_shelf').select('*').order('approved_at', { ascending: false }).limit(1000).then(need),
        sb().from('store_creators').select('slug,name,kind,country,flag,youtube,apple,bio').not('approved_at', 'is', null).order('name').then(need)
      ]).then(function (r) {
        var items = (r[0] || []).map(shape);
        var creators = {};
        (r[1] || []).forEach(function (c) { creators[c.slug] = c; });
        return { items: items, creators: creators, list: r[1] || [] };
      });
    }
    return shelfPending;
  }

  var libPending = null;
  function library() {
    if (!libPending) {
      libPending = whoAmI().then(function (u) {
        if (!u) return [];
        return sb().rpc('store_library').then(function (r) { return r.error ? [] : (r.data || []); });
      });
    }
    return libPending;
  }
  function whoAmI() {
    var c = sb();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return r && r.data && r.data.session ? r.data.session.user : null; }, function () { return null; });
  }
  function signInHere() {
    location.href = '/client.html?next=' + encodeURIComponent(location.pathname + location.search);
  }

  /* ---------------- shell ---------------- */
  function shell() {
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
  function itemHref(it) { return '/store/item?p=' + encodeURIComponent(it.slug) + (it.original ? '' : '&v=' + it.id); }
  function cardHTML(it, owned) {
    var mine = owned && owned[it.id];
    var sub = it.kind === 'song'
      ? it.creatorName + (it.feat ? ' feat. ' + it.feat : '') + (it.original || it.label === 'Live' ? '' : ' · ' + it.label)
      : it.creatorName + ' · ' + it.label;
    return '<a class="card" href="' + itemHref(it) + '">' +
      '<div class="cover">' + cover(it) + '</div>' +
      '<div class="body"><h3>' + esc(it.title) + '</h3><span class="by">' + esc(sub) + '</span>' +
      (mine ? '<span class="owned">' + (mine.kind === 'rent' ? daysLeft(mine.expires_at) + ' days left' : 'In your library') + '</span>'
        : it.status === 'coming_soon' ? '<span class="price soon">Coming soon</span>'
        : '<span class="price">' + money(it.rent, it.currency) + ' · ' + money(it.buy, it.currency) + '</span>') +
      '</div></a>';
  }
  function mosaic(c, items) {
    var art = (items || []).filter(function (it) { return it.art; }).slice(0, 4);
    if (!art.length) return avatar(c, 'lg');
    return '<span class="mosaic n' + art.length + '">' + art.map(function (it) { return '<img src="' + esc(it.art) + '" alt="" loading="lazy">'; }).join('') + '</span>';
  }
  function personHTML(c, count, items) {
    return '<a class="person" href="/store/creator?c=' + esc(c.slug) + '">' + mosaic(c, items) +
      '<div class="who"><b>' + esc(c.name) + '</b><span>' + esc(c.flag || '') + ' ' + esc(c.country || '') + '</span></div>' +
      (count != null ? '<span class="n">' + count + (count === 1 ? ' title' : ' titles') + '</span>' : '') + '</a>';
  }
  function grid(items, owned) { return '<div class="grid">' + items.map(function (it) { return cardHTML(it, owned); }).join('') + '</div>'; }
  function row(items, owned) { return '<div class="shelf">' + items.map(function (it) { return cardHTML(it, owned); }).join('') + '</div>'; }
  function section(title, blurb, inner, more) {
    return '<section class="sec"><div class="sec-head"><div><h2>' + esc(title) + '</h2>' +
      (blurb ? '<p>' + esc(blurb) + '</p>' : '') + '</div>' +
      (more ? '<a href="' + esc(more.href) + '">' + esc(more.text) + ' →</a>' : '') + '</div>' + inner + '</section>';
  }
  function ownedMap() {
    return library().then(function (l) {
      var m = {};
      l.forEach(function (p) { if (p.kind === 'buy' || new Date(p.expires_at) > Date.now()) m[p.version_id] = p; });
      return m;
    });
  }
  function fail(main) {
    return function (err) {
      main.innerHTML = '<div class="wrap"><div class="empty">The store could not load. ' + esc(err && err.message || err) + '</div></div>';
    };
  }

  /* ---------------- pages ---------------- */
  var pages = {};

  /* Themes are found in the titles; genres are where the artist is
     from. Both are honest about it in the section they open. */
  var THEMES = [
    { id: 'praise',    name: 'Praise',    a: '#7a5a1e', b: '#2b230f', re: /praise|hallelujah|alleluia|glory|worthy|magnif|exalt|celebrat|thank|ayeyi/i },
    { id: 'worship',   name: 'Worship',   a: '#22336d', b: '#0f1530', re: /worship|holy|adore|bow|presence|majesty|reign|throne|altar/i },
    { id: 'communion', name: 'Communion', a: '#1f5d64', b: '#0e2a2e', re: /communion|table|bread|blood|cross|calvary|lamb|remember|sacrifice/i },
    { id: 'healing',   name: 'Healing',   a: '#2a4370', b: '#121d33', re: /heal|restor|miracle|deliver|whole|balm|breakthrough|peace/i },
    { id: 'afro-gospel',      name: 'Afro Gospel',      a: '#1f5a3a', b: '#0f2a1c', countries: ['Nigeria', 'Ghana'] },
    { id: 'highlife-praise',  name: 'Highlife Praise',  a: '#55621f', b: '#262d0f', countries: ['Ghana'] },
    { id: 'amapiano-worship', name: 'Amapiano Worship', a: '#6b5a1e', b: '#2b240e', countries: ['South Africa'] },
    { id: 'christmas',        name: 'Christmas',        a: '#7a2a4a', b: '#2f1020', re: /christmas|noel|emmanuel|immanuel|bethlehem|born|silent night|joy to the world|manger/i }
  ];
  var AFRICA = ['Ghana', 'Nigeria', 'Kenya', 'Rwanda', 'South Africa', 'Tanzania', 'Uganda', 'Zambia', 'Zimbabwe', 'Malawi', 'Ethiopia',
    'Cameroon', 'Togo', 'Benin', 'Senegal', 'Mozambique', 'Botswana', 'Namibia', 'Congo', 'DR Congo', 'Angola', 'Sierra Leone', 'Liberia',
    'Gambia', 'Burundi', 'Sudan', 'Egypt', 'Morocco', 'Eritrea', 'Somalia', 'Madagascar', 'Lesotho', 'Eswatini', 'Mali', 'Burkina Faso', 'Gabon', 'Côte d’Ivoire', 'Ivory Coast'];
  function isAlbum(it) { return it.label === 'Album' || it.label === 'EP'; }
  function byNewest(a, b) { return (b.released || '') < (a.released || '') ? -1 : 1; }
  function bySales(a, b) { return (b.sales - a.sales) || byNewest(a, b); }
  function thumb(it) { return '<span class="thumb">' + cover(it) + '</span>'; }
  function songRow(it, owned) {
    var mine = owned && owned[it.id];
    return '<a class="songrow" href="' + itemHref(it) + '">' + thumb(it) +
      '<span class="t"><b>' + esc(it.title) + '</b><span>' + esc(it.creatorName + (it.feat ? ' ft. ' + it.feat : '')) + '</span></span>' +
      '<span class="plus" aria-hidden="true">' + (mine ? '✓' : it.status === 'coming_soon' ? '·' : '+') + '</span></a>';
  }
  function songList(items, owned) { return '<div class="songlist">' + items.map(function (it) { return songRow(it, owned); }).join('') + '</div>'; }
  function circleHTML(c, items) {
    var latest = (items || []).filter(function (it) { return it.art; }).sort(byNewest)[0];
    return '<a class="circle" href="/store/creator?c=' + esc(c.slug) + '">' +
      '<span class="disc" style="background:' + personColour(c.slug) + '">' + (latest ? '<img src="' + esc(latest.art) + '" alt="" loading="lazy">' : esc(initials(c.name))) + '</span>' +
      '<b>' + esc(c.name) + '</b><span>' + esc(c.country || '') + '</span></a>';
  }
  function makerHTML(c, items) {
    var n = (items || []).length;
    return '<a class="maker" href="/store/creator?c=' + esc(c.slug) + '">' + avatar(c, 'lg') +
      '<b>' + esc(c.name) + '</b><span class="badge">✓ CREATOR</span>' +
      (c.bio ? '<span class="what">' + esc(c.bio.split(/[.\n]/)[0].slice(0, 40)) + '</span>' : '') +
      '<span class="n">' + n + (n === 1 ? ' product' : ' products') + (c.country ? ' · ' + esc(c.country) : '') + '</span>' +
      '<span class="btn ghost sm">See their shelf</span></a>';
  }
  function tilesHTML(list) {
    return '<div class="tiles">' + list.map(function (t) {
      return '<a class="tile" href="/store/?theme=' + t.id + '" style="--a:' + t.a + ';--b:' + t.b + '">' + esc(t.name) + '</a>';
    }).join('') + '</div>';
  }
  function countryOf(d, it) { var c = d.creators[it.creator]; return c && c.country || ''; }
  function themeMatch(d, t, it) {
    if (t.countries) return t.countries.indexOf(countryOf(d, it)) >= 0;
    return t.re.test([it.title, it.album].join(' '));
  }

  /* the one thing on the store that is sold by hand, not by checkout */
  function bundleBanner() {
    return '<a class="bundle" href="/studiobundle.html"><div><p class="eyebrow">The Studio Bundle · for church musicians and singers</p>' +
      '<h2>Mix your own stream. Mix your own songs.</h2>' +
      '<p>A Fender Studio Pro mixing or live-stream template built for your church, AMB Analog, AMB Digital, SecondOut, AFD Gate, and a session to set it all up.</p></div>' +
      '<div class="price"><b>$250</b><span>tell us you are interested →</span></div></a>';
  }

  pages.index = function (main) {
    var q = param('q').trim().toLowerCase(), lane = param('lane'), type = param('type'), theme = param('theme');
    Promise.all([shelf(), ownedMap()]).then(function (r) {
      var d = r[0], owned = r[1];
      var filtered = !!(q || lane || type || theme);
      var chip = function (href, name, on, colour) {
        return '<a class="lane"' + (colour ? ' style="--c:' + colour + '"' : '') + ' href="' + href + '" aria-pressed="' + !!on + '">' + (colour ? '<i></i>' : '') + esc(name) + '</a>';
      };
      var chips = '<div class="lanes">' +
        chip('/store/', 'All', !filtered) +
        chip('/store/?type=songs', 'Songs', type === 'songs') +
        chip('/store/?type=albums', 'Albums', type === 'albums') +
        chip('/store/#artists', 'Artists') +
        chip('/store/creators', 'Creators') +
        chip('/store/#themes', 'Themes', !!theme) +
        chip('/store/#themes', 'Genres') +
        chip('/store/#sync', 'Sync licence') +
        LANES.filter(function (l) { return l.id !== 'songs'; }).map(function (l) { return chip('/store/?lane=' + l.id, l.name, lane === l.id, l.colour); }).join('') + '</div>';
      var head = '<div class="storehead"><div><h1>Store</h1><p>Multitracks, loops and sounds for worship teams — African gospel and the world’s worship.</p></div></div>';

      if (filtered) {
        var t = THEMES.filter(function (x) { return x.id === theme; })[0];
        var list = d.items.filter(function (it) {
          if (lane && it.lane !== lane) return false;
          if (type === 'songs' && (it.kind !== 'song' || isAlbum(it))) return false;
          if (type === 'albums' && !isAlbum(it)) return false;
          if (t && !themeMatch(d, t, it)) return false;
          if (!q) return true;
          return [it.title, it.album, it.feat, it.creatorName, it.label, it.writers].join(' ').toLowerCase().indexOf(q) >= 0;
        }).sort(bySales);
        var l = LANES.filter(function (x) { return x.id === lane; })[0];
        var title = q ? '“' + q + '”' : t ? t.name : type === 'songs' ? 'Songs' : type === 'albums' ? 'Albums' : l ? l.name : 'Everything';
        var blurb = list.length + (list.length === 1 ? ' result' : ' results') + (t ? (t.countries ? ' · by where the artist is from' : ' · by what the title says') : '');
        main.innerHTML = '<div class="wrap">' + head + chips +
          section(title, blurb, list.length ? grid(list, owned) : '<div class="empty">Nothing matched.</div>') + '</div>';
        return;
      }

      var html = '<div class="wrap">' + head + chips + bundleBanner();
      if (!d.items.length) { main.innerHTML = html + '<div class="empty">Nothing on the shelf yet.</div></div>'; return; }
      var songs = d.items.filter(function (it) { return it.kind === 'song' && !isAlbum(it); });
      var albums = d.items.filter(function (it) { return it.kind === 'song' && isAlbum(it); });
      var byCreator = {};
      d.items.forEach(function (it) { (byCreator[it.creator] = byCreator[it.creator] || []).push(it); });
      var african = function (it) { return AFRICA.indexOf(countryOf(d, it)) >= 0; };

      /* top songs: what sells first, then the newest */
      html += section('Top songs', '', songList(songs.slice().sort(bySales).slice(0, 15), owned), { href: '/store/?type=songs', text: 'View all' });

      /* albums from home */
      var afAlbums = albums.filter(african).sort(byNewest);
      if (afAlbums.length) html += section('Top African gospel albums', '', row(afAlbums.slice(0, 12), owned), { href: '/store/?type=albums', text: 'View all' });

      /* the artists with the most on the shelf */
      var artists = d.list.filter(function (c) { return c.kind !== 'creator'; })
        .sort(function (a, b) { return (byCreator[b.slug] || []).length - (byCreator[a.slug] || []).length; });
      if (artists.length) html += section('Top artists', '', '<div class="circles">' + artists.slice(0, 10).map(function (c) { return circleHTML(c, byCreator[c.slug]); }).join('') + '</div>', { href: '/store/#artists', text: 'View all' });

      /* creators: the people selling pads, loops and sets */
      var makers = d.list.filter(function (c) { return c.kind === 'creator'; });
      html += '<section class="sec"><div class="sec-head"><div><h2>Featured creators <span class="lane-pill" style="--c:var(--indigo)"><i></i>Sell on PerformLive</span></h2></div><a href="/store/creators">' + (makers.length ? 'View all' : 'Apply') + ' →</a></div>' +
        (makers.length ? '<div class="makers">' + makers.slice(0, 6).map(function (c) { return makerHTML(c, byCreator[c.slug]); }).join('') + '</div>'
          : '<div class="makers"><a class="maker" href="/store/creators#apply"><span class="av lg" style="background:var(--indigo)">+</span><b>Your name here</b><span class="badge">CREATOR</span><span class="what">Pads, loops, click packs, templates</span><span class="n">Keep most of every sale</span><span class="btn sm">Apply to sell</span></a></div>') + '</section>';

      /* on sale now, when anything is */
      var onSale = d.items.filter(function (it) { return it.status === 'approved'; });
      if (onSale.length) html += section('On sale now', '', row(onSale.slice().sort(bySales).slice(0, 12), owned));

      /* the world's worship */
      var world = d.items.filter(function (it) { return it.kind === 'song' && !african(it); }).sort(byNewest);
      if (world.length) html += section('From around the world', '', row(world.slice(0, 12), owned), { href: '/store/?theme=worship', text: 'View all' });

      /* themes and genres */
      html += '<section class="sec" id="themes"><div class="sec-head"><div><h2>Browse by theme</h2><p>Themes come from the titles; the genres from where the artist is from.</p></div></div>' + tilesHTML(THEMES) + '</section>';

      /* the artists, grouped by country, each with a mosaic of their covers */
      var countries = [];
      d.list.forEach(function (c) { if (c.country && countries.indexOf(c.country) < 0) countries.push(c.country); });
      countries.sort();
      var country = param('country');
      var cchips = '<div class="lanes countries"><a class="lane" href="/store/#artists" aria-pressed="' + !country + '">Everywhere</a>' +
        countries.map(function (k) {
          var flag = (d.list.filter(function (c) { return c.country === k; })[0] || {}).flag || '';
          return '<a class="lane" href="/store/?country=' + encodeURIComponent(k) + '#artists" aria-pressed="' + (country === k) + '">' + esc(flag + ' ' + k) + '</a>';
        }).join('') + '</div>';
      var people = d.list.filter(function (c) { return !country || c.country === country; });
      html += '<section class="sec" id="artists"><div class="sec-head"><div><h2>Artists</h2><p>' + people.length + (people.length === 1 ? ' artist' : ' artists') + (country ? ' from ' + esc(country) : ', ' + countries.length + ' countries') + '</p></div></div>' +
        cchips + '<div class="grid wide">' + people.map(function (c) { return personHTML(c, (byCreator[c.slug] || []).length, byCreator[c.slug]); }).join('') + '</div></section>';

      var packs = d.items.filter(function (it) { return it.kind === 'pack'; });
      if (packs.length) html += section('Pads, loops & templates', '', row(packs.slice(0, 12), owned), { href: '/store/?lane=pads', text: 'See all' });

      html += '<section class="sec" id="sync"><div class="sec-head"><div><h2>Sync licence</h2><p>A recording in a video, a broadcast or a stream.</p></div></div>' +
        '<div class="empty" style="text-align:left">Not on the shelf yet. Write to <a href="mailto:hello@amanorsac.studio?subject=Sync%20licence">hello@amanorsac.studio</a> with the song and where it will play, and the studio will clear it with the artist.</div></section>';
      html += '<p class="preview-note">Every title marked coming soon is on the shelf as a preview. Nothing is for sale or licensed until the artist is in and the stems are up.</p>';
      main.innerHTML = html + '</div>';
      if (location.hash) { var el = $(location.hash); if (el) el.scrollIntoView(); }
    }).catch(fail(main));
  };

  pages.item = function (main) {
    var slug = param('p'), vid = param('v');
    Promise.all([shelf(), ownedMap()]).then(function (r) {
      var d = r[0], owned = r[1];
      var versions = d.items.filter(function (it) { return it.slug === slug; })
        .sort(function (a, b) { return (b.original - a.original) || (b.sales - a.sales); });
      var it = versions.filter(function (v) { return v.id === vid; })[0] || versions[0];
      if (!it) { main.innerHTML = '<div class="wrap"><div class="empty">Not here. <a href="/store/">Back to the store</a></div></div>'; return; }
      var c = d.creators[it.creator] || { slug: it.creator, name: it.creatorName };
      var mine = owned[it.id];
      document.title = it.title + ' · ' + c.name + ' · Amanorsac Store';
      var others = versions.filter(function (v) { return v.id !== it.id; });
      var more = d.items.filter(function (x) { return x.id !== it.id && x.creator === it.creator && x.slug !== it.slug; }).slice(0, 6);
      var facts = [];
      if (it.album) facts.push(it.album);
      if (it.year) facts.push(String(it.year));
      if (it.key) facts.push('Key ' + it.key);
      if (it.bpm) facts.push(Number(it.bpm) + ' BPM');
      if (it.length) facts.push(Math.floor(it.length / 60) + ':' + ('0' + it.length % 60).slice(-2));
      if (it.label && it.label !== 'Original') facts.push(it.label);

      var buy;
      if (it.status === 'coming_soon') {
        buy = '<div class="buy soonbox"><span class="pn">Coming soon</span><span class="pnote">Rent for 14 days or buy, once the stems are in.</span></div>';
      } else if (mine) {
        buy = '<div class="buy"><span class="price" style="color:var(--green);font-size:18px">' +
          (mine.kind === 'rent' ? 'Rented · ' + daysLeft(mine.expires_at) + ' days left' : 'In your library') + '</span>' +
          '<button class="btn" data-open="' + esc(it.id) + '">Open in PerformLive</button>' +
          (mine.kind === 'rent' ? '<button class="btn ghost" data-buy="' + esc(it.id) + '" data-kind="buy">Buy for ' + money(it.buy, it.currency) + '</button>' : '') + '</div>';
      } else {
        buy = '<div class="buy products">' +
          '<label class="prod"><input type="radio" name="prod" value="rent" checked><span class="pn">Rent for 14 days</span><span class="pnote">Full multitracks in PerformLive for two weeks.</span><span class="price">' + money(it.rent, it.currency) + '</span></label>' +
          '<label class="prod"><input type="radio" name="prod" value="buy"><span class="pn">Buy</span><span class="pnote">Yours to keep, on every machine you sign in on.</span><span class="price">' + money(it.buy, it.currency) + '</span></label>' +
          '<div class="prod off"><span></span><span class="pn">Chord chart</span><span class="price soon">Coming soon</span></div>' +
          '<button class="btn" data-buy="' + esc(it.id) + '">Continue</button></div>';
      }

      main.innerHTML = '<div class="wrap"><div class="item">' +
        '<div><div class="cover">' + cover(it) + '</div>' +
        (it.youtube ? '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(it.youtube) + '" title="' + esc(it.title) + ' on YouTube" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
                    : (it.kind === 'song' ? '<div class="links">' +
                        '<a class="btn ghost sm" href="https://www.youtube.com/results?search_query=' + encodeURIComponent(c.name + ' ' + it.title) + '" rel="noopener" target="_blank">▶ Watch on YouTube</a>' +
                        (c.youtube ? '<a class="btn ghost sm" href="' + esc(c.youtube) + '" rel="noopener" target="_blank">' + esc(c.name.split(' ')[0]) + '\u2019s channel</a>' : '') +
                        (it.link ? '<a class="btn ghost sm" href="' + esc(it.link) + '" rel="noopener" target="_blank">Apple Music</a>' : '') + '</div>' : '')) +
        (it.kind === 'song' ? '<p class="tracks"><b>Tracks</b> ' + SLOTS.map(function (s) { return SLOT_NAMES[s]; }).join(' · ') + '</p>' : '') + '</div>' +
        '<div><h1>' + esc(it.title) + '</h1>' +
        '<p class="artist"><a href="/store/creator?c=' + esc(c.slug) + '">' + esc(c.name) + '</a>' + (it.feat ? ' <span class="dim">feat. ' + esc(it.feat) + '</span>' : '') + '</p>' +
        (facts.length ? '<p class="facts-line">' + facts.map(esc).join(' · ') + '</p>' : '') +
        buy +
        (others.length ? '<h2 style="margin-top:24px;font-size:16px">Other versions</h2><div class="rows" style="margin-top:8px">' + others.map(function (v) {
            return '<a class="row" href="' + itemHref(v) + '" style="color:inherit"><div class="cover">' + cover(v) + '</div>' +
              '<div class="t"><b>' + esc(v.label) + '</b><span>' + esc(v.creatorName) + (v.key ? ' · ' + esc(v.key) : '') + (v.bpm ? ' · ' + Number(v.bpm) + ' BPM' : '') + '</span></div>' +
              '<span class="price">' + (v.status === 'coming_soon' ? 'Coming soon' : money(v.rent, v.currency) + ' · ' + money(v.buy, v.currency)) + '</span></a>';
          }).join('') + '</div>' : '') +
        '</div></div>' +
        (more.length ? section('More from ' + c.name, '', row(more, owned), { href: '/store/creator?c=' + c.slug, text: 'See all' }) : '') +
        '</div>';
      wireBuy(main, it);
      wireOpen(main);
    }).catch(fail(main));
  };

  pages.creator = function (main) {
    var slug = param('c');
    Promise.all([shelf(), ownedMap()]).then(function (r) {
      var d = r[0], owned = r[1];
      var c = d.creators[slug];
      if (!c) { main.innerHTML = '<div class="wrap"><div class="empty">No one by that name. <a href="/store/">Back to the store</a></div></div>'; return; }
      var items = d.items.filter(function (it) { return it.creator === slug; });
      document.title = c.name + ' · Amanorsac Store';
      main.innerHTML = '<div class="wrap">' +
        '<div class="profile">' + avatar(c, 'xl') + '<div class="who"><h1>' + esc(c.name) + '</h1>' +
        '<div class="line">' + esc(c.flag || '') + ' ' + esc(c.country || '') + ' · ' + items.length + (items.length === 1 ? ' title' : ' titles') + '</div>' +
        (c.bio ? '<p class="bio">' + esc(c.bio) + '</p>' : '') +
        ((c.youtube || c.apple) ? '<div class="links">' + (c.youtube ? '<a class="btn ghost sm" href="' + esc(c.youtube) + '" rel="noopener" target="_blank">▶ YouTube</a>' : '') +
          (c.apple ? '<a class="btn ghost sm" href="' + esc(c.apple) + '" rel="noopener" target="_blank">Apple Music</a>' : '') + '</div>' : '') +
        '</div></div>' +
        (items.length ? grid(items.slice().sort(function (a, b) { return (b.released || '') < (a.released || '') ? -1 : 1; }), owned) : '<div class="empty">Nothing on the shelf yet.</div>') +
        '</div>';
    }).catch(fail(main));
  };

  pages.creators = function (main) {
    shelf().then(function (d) {
      var list = $('#creator-list');
      var count = {};
      d.items.forEach(function (it) { count[it.creator] = (count[it.creator] || 0) + 1; });
      var byC = {}; d.items.forEach(function (it) { (byC[it.creator] = byC[it.creator] || []).push(it); });
      if (list) list.innerHTML = d.list.map(function (c) { return personHTML(c, count[c.slug] || 0, byC[c.slug]); }).join('');
    }).catch(function () {});

    var form = $('#apply-form'), out = $('#apply-out');
    if (!form) return;
    whoAmI().then(function (u) {
      if (!u) {
        out.hidden = false; out.className = 'msg';
        out.innerHTML = 'Sign in with your amanorsac.studio account to apply, or make one. <a href="#" data-signin>Sign in</a>';
        $('[data-signin]', out).addEventListener('click', function (e) { e.preventDefault(); signInHere(); });
        form.querySelector('button[type=submit]').disabled = true;
        return;
      }
      var em = form.querySelector('input[name=email]'); if (em && !em.value) em.value = u.email || '';
      sb().from('creator_applications').select('status,created_at,note').eq('user_id', u.id).order('created_at', { ascending: false }).limit(1)
        .then(function (r) {
          var a = r.data && r.data[0];
          if (!a) return;
          out.hidden = false;
          out.className = 'msg ' + (a.status === 'approved' ? 'ok' : a.status === 'declined' ? 'bad' : 'warn');
          out.textContent = a.status === 'approved' ? 'You are in. Your dashboard is open.'
            : a.status === 'declined' ? 'Not this time.' + (a.note ? ' ' + a.note : '')
            : 'Your application from ' + dateShort(a.created_at) + ' is being looked at.';
          if (a.status === 'approved') out.innerHTML += ' <a href="/store/dashboard">Open it →</a>';
        });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      whoAmI().then(function (u) {
        if (!u) { signInHere(); return; }
        var fd = new FormData(form);
        var data = {
          user_id: u.id, name: fd.get('name'), brand: fd.get('brand') || null, email: fd.get('email') || u.email,
          country: fd.get('country') || null, links: fd.get('links'), lanes: fd.getAll('lanes'),
          rights: fd.get('rights') || null, message: fd.get('message') || null
        };
        var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
        sb().from('creator_applications').insert(data).then(function (r) {
          out.hidden = false;
          if (r.error) { out.className = 'msg bad'; out.textContent = 'That did not go through: ' + r.error.message; btn.disabled = false; return; }
          form.reset(); out.className = 'msg ok'; out.textContent = 'Received. You will hear back by email.';
        });
      });
    });
  };

  pages.library = function (main) {
    Promise.all([whoAmI(), library()]).then(function (r) {
      var user = r[0], items = r[1];
      if (!user) { main.innerHTML = '<div class="wrap"><h1>Your library</h1><div class="empty" style="margin-top:16px">Sign in to see what you have.<br><button class="btn" data-signin>Sign in</button></div></div>'; $('[data-signin]', main).addEventListener('click', signInHere); return; }
      main.innerHTML = '<div class="wrap"><h1 style="margin-bottom:16px">Your library</h1>' +
        (items.length ? '<div class="rows">' + items.map(function (p) {
          var it = { id: p.version_id, title: p.title, creator: p.creator_slug, creatorName: p.creator_name, art: p.art_key ? '/store-art/' + p.version_id : null };
          var live = p.kind === 'buy' || new Date(p.expires_at) > Date.now();
          return '<div class="row"><div class="cover">' + cover(it) + '</div>' +
            '<div class="t"><b><a href="/store/item?p=' + esc(p.song_slug) + '&v=' + esc(p.version_id) + '" style="color:inherit">' + esc(p.title) + '</a></b>' +
            '<span>' + esc(p.creator_name) + (p.label && p.label !== 'Original' ? ' · ' + esc(p.label) : '') + ' · ' +
            (p.kind === 'buy' ? 'Bought ' + dateShort(p.purchased_at) : live ? 'Rental · ' + daysLeft(p.expires_at) + ' days left' : 'Rental ended ' + dateShort(p.expires_at)) + '</span></div>' +
            '<div class="acts">' + (live ? '<button class="btn sm" data-open="' + esc(p.version_id) + '">Open in PerformLive</button>'
                                         : '<a class="btn sm" href="/store/item?p=' + esc(p.song_slug) + '&v=' + esc(p.version_id) + '">Rent again or buy</a>') + '</div></div>';
        }).join('') + '</div>'
        : '<div class="empty">Nothing here yet.<br><a class="btn" href="/store/">Find something</a></div>') + '</div>';
      wireOpen(main);
    }).catch(fail(main));
  };

  pages.success = function (main) {
    var vid = param('v');
    var box = $('#bought');
    if (!vid || !box) return;
    /* the webhook usually lands before the buyer does; if not, keep
       looking for a little while rather than say nothing */
    var tries = 0;
    (function look() {
      libPending = null;
      library().then(function (l) {
        var p = l.filter(function (x) { return x.version_id === vid; })[0];
        if (p) {
          box.innerHTML = '<div class="row"><div class="cover">' + cover({ id: p.version_id, title: p.title, creator: p.creator_slug, creatorName: p.creator_name, art: p.art_key ? '/store-art/' + p.version_id : null }) + '</div>' +
            '<div class="t"><b>' + esc(p.title) + '</b><span>' + esc(p.creator_name) + ' · ' + (p.kind === 'rent' ? '14-day rental, ends ' + dateShort(p.expires_at) : 'Yours to keep') + '</span></div>' +
            '<div class="acts"><button class="btn sm" data-open="' + esc(p.version_id) + '">Open in PerformLive</button></div></div>';
          wireOpen(main);
        } else if (++tries < 12) {
          box.innerHTML = '<p class="dim">Confirming with the bank…</p>';
          setTimeout(look, 2500);
        } else {
          box.innerHTML = '<p class="msg warn">Paid, but not showing yet. It will appear in your library within a few minutes; if it does not, write to us with reference <span class="mono">' + esc(param('cs')) + '</span>.</p>';
        }
      });
    })();
  };

  pages.cancelled = function () {};

  /* the bundle: a form, not a checkout. Lands in package_requests;
     the studio replies and the sale happens on a call. */
  pages.package = function () {
    var form = $('#pkg-form'), out = $('#pkg-out');
    if (!form) return;
    whoAmI().then(function (u) { var em = form.querySelector('input[name=email]'); if (u && em && !em.value) em.value = u.email || ''; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form), data = { package: 'studio-bundle' };
      ['name', 'email', 'phone', 'church', 'role', 'want', 'daw', 'computer', 'setup', 'message'].forEach(function (k) { data[k] = fd.get(k) || null; });
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      out.hidden = false; out.className = 'msg'; out.textContent = 'Sending…';
      var client = sb();
      var mail = 'mailto:hello@amanorsac.studio?subject=' + encodeURIComponent('Studio Bundle - ' + (data.name || '')) +
        '&body=' + encodeURIComponent(Object.keys(data).map(function (k) { return k + ': ' + (data[k] || ''); }).join('\n'));
      (client ? client.rpc('request_package', { p: data }) : Promise.resolve({ error: new Error('offline') })).then(function (r) {
        if (r.error) throw r.error;
        form.reset(); out.className = 'msg ok';
        out.textContent = 'Got it. We reply by email or WhatsApp within two days.';
        if (window.track) window.track('enquiry', 'studio bundle');
      }).catch(function (err) {
        btn.disabled = false; out.className = 'msg bad';
        out.innerHTML = esc(err.message || 'That did not go through.') + ' You can also <a href="' + esc(mail) + '">send it by email</a>.';
      });
    });
  };

  pages.dashboard = function (main) {
    whoAmI().then(function (u) {
      if (!u) { main.innerHTML = '<div class="wrap"><div class="empty">Sign in to see your dashboard.<br><button class="btn" data-signin>Sign in</button></div></div>'; $('[data-signin]', main).addEventListener('click', signInHere); return; }
      return sb().rpc('my_creator').then(function (r) {
        var me = r.data && (Array.isArray(r.data) ? r.data[0] : r.data);
        if (!me || !me.slug) {
          main.innerHTML = '<div class="wrap"><h1>Dashboard</h1><div class="empty" style="margin-top:16px">This account is not a creator account yet.<br><a class="btn" href="/store/creators#apply">Apply to sell</a></div></div>';
          return;
        }
        return Promise.all([
          sb().from('store_versions').select('id,label,status,review_note,key,bpm,sales,updated_at,art_key,kind,store_songs(title,slug)')
            .eq('creator_slug', me.slug).order('updated_at', { ascending: false }).then(need),
          sb().rpc('creator_sales', { p_days: 30 }).then(function (x) { return x.data || []; })
        ]).then(function (rr) {
          var versions = rr[0] || [], sales = rr[1];
          var gross = sales.reduce(function (n, s) { return n + Number(s.gross_cents || 0); }, 0);
          var count = sales.reduce(function (n, s) { return n + Number(s.sales || 0); }, 0);
          var pill = function (s) {
            return { draft: 'Draft', submitted: 'In review', approved: 'On the shelf', rejected: 'Sent back', coming_soon: 'Coming soon', hidden: 'Hidden' }[s] || s;
          };
          main.innerHTML = '<div class="wrap">' +
            '<div class="sec-head"><div><h1>' + esc(me.name) + '</h1><p>Creator dashboard</p></div>' +
            '<div style="display:flex;gap:8px"><a class="btn ghost" href="/store/creator?c=' + esc(me.slug) + '">My page</a><a class="btn" href="/store/new">New song</a></div></div>' +
            '<div class="kpis"><div class="kpi"><b>' + count + '</b><span>sales, last 30 days</span></div>' +
            '<div class="kpi"><b>' + money(gross) + '</b><span>gross, last 30 days</span></div>' +
            '<div class="kpi"><b>' + versions.filter(function (v) { return v.status === 'approved'; }).length + '</b><span>on the shelf</span></div>' +
            '<div class="kpi"><b>' + versions.filter(function (v) { return v.status === 'submitted'; }).length + '</b><span>in review</span></div></div>' +
            section('Your songs', '', versions.length ? '<div class="rows">' + versions.map(function (v) {
              var song = v.store_songs || {};
              var it = { id: v.id, title: song.title, creator: me.slug, creatorName: me.name, art: v.art_key ? '/store-art/' + v.id : null };
              var editable = v.status === 'draft' || v.status === 'rejected';
              return '<div class="row"><div class="cover">' + cover(it) + '</div>' +
                '<div class="t"><b>' + esc(song.title) + (v.label && v.label !== 'Original' ? ' <span class="dim">· ' + esc(v.label) + '</span>' : '') + '</b>' +
                '<span><span class="' + (v.status === 'approved' ? 'ok' : v.status === 'rejected' ? 'bad' : '') + '">' + pill(v.status) + '</span>' +
                (v.key ? ' · ' + esc(v.key) : '') + (v.bpm ? ' · ' + Number(v.bpm) + ' BPM' : '') + (v.sales ? ' · ' + v.sales + ' sold' : '') +
                (v.review_note ? '<br><em>' + esc(v.review_note) + '</em>' : '') + '</span></div>' +
                '<div class="acts">' + (editable ? '<a class="btn sm" href="/store/new?v=' + esc(v.id) + '">' + (v.status === 'rejected' ? 'Fix and resubmit' : 'Continue') + '</a>'
                  : v.status === 'approved' ? '<a class="btn ghost sm" href="/store/item?p=' + esc(song.slug) + '&v=' + esc(v.id) + '">View</a>' : '') + '</div></div>';
            }).join('') + '</div>' : '<div class="empty">No songs yet. <a href="/store/new">Add the first one</a>.</div>') +
            (sales.length ? section('Sales, last 30 days', '', '<table class="tbl"><thead><tr><th>Song</th><th class="num">Sales</th><th class="num">Gross</th><th>Last</th></tr></thead><tbody>' +
              sales.map(function (s) { return '<tr><td>' + esc(s.title) + (s.label && s.label !== 'Original' ? ' · ' + esc(s.label) : '') + '</td><td class="num">' + s.sales + '</td><td class="num">' + money(Number(s.gross_cents)) + '</td><td>' + (s.last_sale ? dateShort(s.last_sale) : '—') + '</td></tr>'; }).join('') +
              '</tbody></table>') : '') +
            '</div>';
        });
      });
    }).catch(fail(main));
  };

  /* ---------------- behaviours ---------------- */
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

  function wireBuy(root, it) {
    $$('[data-buy]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var chosen = $('input[name=prod]:checked', root);
        var kind = b.getAttribute('data-kind') || (chosen ? chosen.value : 'buy');
        whoAmI().then(function (user) {
          if (!user) { signInHere(); return; }
          var was = b.textContent; b.disabled = true; b.textContent = 'One moment';
          sb().functions.invoke('create-store-checkout', { body: { version: it.id, kind: kind } }).then(function (r) {
            var data = r.data || {};
            if (r.error || data.error) throw new Error(data.error || (r.error && r.error.message) || 'Could not start checkout.');
            if (data.already_owned) { location.reload(); return; }
            location.href = data.url;
          }).catch(function (err) {
            b.disabled = false; b.textContent = was;
            modal('That did not work', '<p>' + esc(err.message) + '</p>', [{ text: 'OK' }]);
          });
        });
      });
    });
  }

  function wireOpen(root) {
    $$('[data-open]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var link = 'performlive://install/' + encodeURIComponent(b.getAttribute('data-open'));
        modal('Opening PerformLive', '<p>If PerformLive is installed it opens now and fetches the song. If nothing happens, get PerformLive from <a href="/performlive">its page</a> and come back.</p>' +
          '<p style="margin-top:10px"><code>' + esc(link) + '</code></p>', [{ text: 'Close', ghost: true }, { text: 'Open', run: function () { location.href = link; } }]);
      });
    });
  }

  window.Store = { esc: esc, money: money, cover: cover, avatar: avatar, sb: sb, whoAmI: whoAmI, signInHere: signInHere,
                   modal: modal, SLOTS: SLOTS, SLOT_NAMES: SLOT_NAMES, LANES: LANES, need: need, dateShort: dateShort };

  document.addEventListener('DOMContentLoaded', function () {
    shell();
    var page = document.body.getAttribute('data-page');
    var main = $('#main');
    if (pages[page] && main) pages[page](main);
  });
})();
