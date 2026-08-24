/* =====================================================================
   How many people have this, and what they think of it.

   Reads the app's name off data-app on <body>, same convention
   download-gate.js already uses. Wherever the markup for these pieces
   is on the page, this script finds it by class and fills it in:

     .dl-count      the download count badge
     .rv-stats      "4.8 · 6 reviews" summary
     .rv-list       the approved reviews themselves
     .rv-form       the leave-a-review form

   Reading is direct - the publishable key already public on every page
   can list approved reviews and download counts, both harmless to hand
   to anyone. Posting one is not: that goes through POST /api/review on
   the Worker, not straight to Supabase, because some apps (see
   REVIEW_GATED below) only accept a review from someone who arrived
   through the signed link a review-invite email sends about a week
   after a confirmed download - a check only the Worker can make.

   Text from a stranger goes in through textContent, never innerHTML.
   A review can contain anything somebody typed, including a stray
   <script> tag - stored as text in the database, and it must stay text
   on the way back out.
   ===================================================================== */
(function () {
  var SUPABASE_URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();

  /* Apps whose review form only opens with the signed link from the
     review-invite email (see worker.js's REVIEW_INVITE_APPS - keep the
     two lists the same). Everything else posts a review straight away. */
  var REVIEW_GATED = { nebulatide: true };

  function esc(s) { return String(s == null ? '' : s); }

  function rpc(name, args) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      body: JSON.stringify(args || {})
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); });
  }

  function stars(n, cls) {
    var wrap = document.createElement('span');
    wrap.className = 'stars' + (cls ? ' ' + cls : '');
    wrap.setAttribute('aria-label', n + ' out of 5 stars');
    for (var i = 1; i <= 5; i++) {
      var s = document.createElement('span');
      s.className = 'star' + (i <= Math.round(n) ? ' on' : '');
      s.textContent = '★';
      s.setAttribute('aria-hidden', 'true');
      wrap.appendChild(s);
    }
    return wrap;
  }

  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    var d = Math.floor(ms / 86400000);
    if (d < 1) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 30) return d + ' days ago';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago');
    var y = Math.floor(mo / 12);
    return y + (y === 1 ? ' year ago' : ' years ago');
  }

  /* ---- the small badges on the App Store overview ----------------------
     One card per app, each carrying data-badge-app - independent of the
     single-app page below, and runs whether or not this page has an
     app of its own (apps.html's body carries data-room, not data-app,
     so the guard below never returns early because of this block). */
  var badges = document.querySelectorAll('[data-badge-app]');
  if (badges.length) {
    rpc('app_download_counts').then(function (rows) {
      rows = rows || [];
      badges.forEach(function (el) {
        var a = (el.getAttribute('data-badge-app') || '').toLowerCase();
        var row = rows.find(function (r) { return r.app === a; });
        var n = row ? row.downloads : 0;
        if (!n) return;
        var span = document.createElement('span');
        span.className = 'app-dl';
        span.textContent = (n < 1000 ? n : (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k') +
          (n === 1 ? ' download' : ' downloads');
        el.appendChild(span);
      });
    }).catch(function () {});
    badges.forEach(function (el) {
      var a = (el.getAttribute('data-badge-app') || '').toLowerCase();
      rpc('app_review_stats', { p_app: a }).then(function (rows) {
        var stat = (rows && rows[0]) || {};
        if (!stat.count) return;
        if (el.textContent) {
          var dot = document.createElement('span');
          dot.className = 'app-dot'; dot.textContent = '·'; dot.setAttribute('aria-hidden', 'true');
          el.appendChild(dot);
        }
        var s = document.createElement('span');
        s.className = 'app-rt';
        s.textContent = Number(stat.average).toFixed(1) + ' ★ (' + stat.count + ')';
        el.appendChild(s);
      }).catch(function () {});
    });
  }

  if (!app) return;

  // ---- the download count -------------------------------------------
  var countEls = document.querySelectorAll('.dl-count');
  if (countEls.length) {
    rpc('app_download_counts').then(function (rows) {
      var row = (rows || []).find(function (r) { return r.app === app; });
      var n = row ? row.downloads : 0;
      if (!n) return;   // nothing worth a badge for zero, yet
      var text = n === 1 ? '1 download' : n.toLocaleString() + ' downloads';
      countEls.forEach(function (el) { el.textContent = text; el.hidden = false; });
    }).catch(function () {});
  }

  // ---- the reviews ----------------------------------------------------
  var listEl = document.querySelector('.rv-list');
  var statsEl = document.querySelector('.rv-stats');
  var emptyEl = document.querySelector('.rv-empty');

  function paintReview(r) {
    var li = document.createElement('li');
    li.className = 'rv';
    var head = document.createElement('div');
    head.className = 'rv-head';
    head.appendChild(stars(r.rating));
    var who = document.createElement('span');
    who.className = 'rv-who';
    who.textContent = (r.name || 'Someone who tried it') + ' · ' + ago(r.created_at);
    head.appendChild(who);
    li.appendChild(head);
    var body = document.createElement('p');
    body.className = 'rv-body';
    body.textContent = r.body;                 // textContent: never rendered as markup
    li.appendChild(body);
    return li;
  }

  if (listEl) {
    Promise.all([
      rpc('app_reviews_public', { p_app: app, p_limit: 30 }),
      rpc('app_review_stats', { p_app: app })
    ]).then(function (res) {
      var reviews = res[0] || [];
      var stat = (res[1] && res[1][0]) || { count: 0, average: null };
      if (statsEl) {
        if (stat.count > 0) {
          statsEl.innerHTML = '';
          statsEl.appendChild(stars(stat.average));
          var n = document.createElement('span');
          n.className = 'rv-n';
          n.textContent = Number(stat.average).toFixed(1) + ' · ' +
            stat.count + (stat.count === 1 ? ' review' : ' reviews');
          statsEl.appendChild(n);
          statsEl.hidden = false;
        }
      }
      if (reviews.length) {
        var frag = document.createDocumentFragment();
        reviews.forEach(function (r) { frag.appendChild(paintReview(r)); });
        listEl.appendChild(frag);
        if (emptyEl) emptyEl.hidden = true;
      } else if (emptyEl) {
        emptyEl.hidden = false;
      }
    }).catch(function () { if (emptyEl) emptyEl.hidden = false; });
  }

  // ---- leaving one ------------------------------------------------------
  var form = document.querySelector('.rv-form');
  if (!form) return;

  /* A gated app's form only opens for someone who arrived through the
     signed link the review-invite email sends about a week after a
     confirmed download. The token rides in on ?rv= once, then lives in
     localStorage so the same browser can still leave a review after
     closing that email and coming back later - reloading or bookmarking
     the page does not lose it, and it does not sit in the visible URL
     any longer than the one page load that reads it. */
  var tokenKey = 'as-rv-' + app;
  var params = new URLSearchParams(location.search);
  var urlToken = params.get('rv');
  if (urlToken) {
    try { localStorage.setItem(tokenKey, urlToken); } catch (e) {}
    params.delete('rv');
    var clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
    history.replaceState(null, '', clean);
  }
  var token = urlToken || (function () { try { return localStorage.getItem(tokenKey) || ''; } catch (e) { return ''; } })();

  var locked = !!REVIEW_GATED[app] && !token;
  var lockedEl = document.querySelector('.rv-locked');
  if (locked) {
    form.hidden = true;
    if (lockedEl) lockedEl.hidden = false;
    return;               // nothing below here applies until a token shows up
  }
  if (lockedEl) lockedEl.hidden = true;

  var picked = 0;
  var pickerEls = form.querySelectorAll('.rv-pick .star');
  pickerEls.forEach(function (el, i) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', (i + 1) + ' star' + (i ? 's' : ''));
    function set(n) {
      picked = n;
      pickerEls.forEach(function (s, j) { s.classList.toggle('on', j < n); });
    }
    el.addEventListener('click', function () { set(i + 1); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(i + 1); }
    });
    el.addEventListener('mouseenter', function () {
      pickerEls.forEach(function (s, j) { s.classList.toggle('hover', j <= i); });
    });
  });
  form.querySelector('.rv-pick').addEventListener('mouseleave', function () {
    pickerEls.forEach(function (s) { s.classList.remove('hover'); });
  });

  var msg = form.querySelector('.rv-msg');
  function say(t, bad) {
    if (!msg) return;
    msg.textContent = t;
    msg.className = 'rv-msg' + (bad ? ' bad' : '');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = form.querySelector('.rv-body-in').value.trim();
    var name = form.querySelector('.rv-name-in').value.trim();
    if (!picked) { say('Tap a star to rate it first.', true); return; }
    if (body.length < 3) { say('A word or two on why helps more than the stars alone.', true); return; }

    var go = form.querySelector('.rv-go');
    go.disabled = true; go.textContent = 'Sending';
    say('');

    // Reviews are written through the Worker, not Supabase directly - see
    // /api/review in worker.js. The token, when this app needs one, rides
    // along here rather than being trusted from anything client-side.
    fetch('/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: app, rating: picked, name: name || null, body: body, rv: token })
    })
      .then(function (r) { return r.json().then(function (j) { return r.ok ? j : Promise.reject(j); }); })
      .then(function () {
        form.hidden = true;
        var done = form.parentElement.querySelector('.rv-done');
        if (done) done.hidden = false;
      })
      .catch(function (j) {
        say((j && j.error) || 'Could not send that. Try again in a moment.', true);
        go.disabled = false; go.textContent = 'Post review';
      });
  });
})();
