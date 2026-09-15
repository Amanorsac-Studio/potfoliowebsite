/* =====================================================================
   Amanorsac Hub - the page.

   Same Supabase project and publishable key as the website. Row Level
   Security decides what this account may see: its own purchases (which
   are its licenses), its own device activations, its own profile.
   Ownership of a download is re-checked by the Worker with the session
   token before a file is handed over - the Hub asks, it never decides.
   ===================================================================== */
(() => {
  const SUPABASE_URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';
  const SITE = 'https://amanorsac.studio';
  const FREE_APPS = ['pulseroom', 'nebulatide'];

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [].slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const when = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const ago = (d) => {
    if (!d) return '';
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400 * 2) return Math.round(s / 3600) + ' h ago';
    return when(d);
  };
  const money = (cents, cur) => cents ? new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(cents / 100) : 'Free';
  const mb = (n) => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB';

  const S = {
    session: null, profile: null, device: { platform: window.hub.platform, arch: window.hub.arch, os: '', hostname: '' },
    catalog: [], hubVersion: null, announce: null, noticeShown: null,
    owned: [], devices: [], installed: {}, jobs: {}, history: [],
    news: [], newApps: [], readNews: [], seenApps: null, usage: null,
    page: 'library', filter: 'all', online: true,
  };
  try { S.history = JSON.parse(localStorage.getItem('hub-history') || '[]'); } catch (e) {}
  try { S.readNews = JSON.parse(localStorage.getItem('hub-news-read') || '[]'); } catch (e) {}
  try { var seen = localStorage.getItem('hub-seen-apps'); S.seenApps = seen ? JSON.parse(seen) : null; } catch (e) {}

  /* ---------- small UI ---------- */
  let toastTimer;
  function toast(t, bad) {
    const el = $('#toast'); el.textContent = t; el.className = 'toast' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), bad ? 6000 : 3500);
  }
  function modal(title, html) { $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; $('#dialog').showModal(); }
  const open = (url) => window.hub.external(url);

  /* ---------- the collection ---------- */
  function byId(id) { return S.catalog.find((a) => a.id === id); }
  function ownedRow(id) { return S.owned.find((o) => o.app === id); }
  function build(a) { return a.platforms && a.platforms[S.device.platform]; }
  function otherPlatformNote(a) {
    const has = Object.keys(a.platforms || {});
    if (!has.length) return 'Coming soon';
    /* The Hub is a desktop app, so a phone build is not "no build for
       you" - it is a build for something else entirely, and saying
       "Android only" to somebody at a computer is worse than useless.
       Desktop builds are named; phones are mentioned separately.

       Not hypothetical: Nebula Tide 2.1 ships Windows, Mac and Android,
       and the line this replaced mapped everything that was not Windows
       to "Mac" - so an Android-only app would have told a Mac owner it
       was Mac only. */
    const DESK = { windows: 'Windows', mac: 'Mac' };
    const desktop = has.filter((p) => DESK[p]).map((p) => DESK[p]);
    const phone = has.filter((p) => p === 'ios' || p === 'android')
                     .map((p) => p === 'ios' ? 'iPhone' : 'Android');
    if (desktop.length) return desktop.join(' and ') + ' only';
    if (phone.length) return 'On ' + phone.join(' and ') + ', not on the desktop';
    return 'Coming soon';
  }
  /* What one card should offer. */
  function status(a) {
    const job = S.jobs[a.id], inst = S.installed[a.id], own = ownedRow(a.id), b = build(a);
    if (job) return { action: 'busy', badge: job.state === 'installing' ? 'Installing' : job.state === 'preparing' ? 'Preparing' : 'Downloading', job };
    if (a.status === 'withdrawn') return { action: 'pulled', badge: 'Temporarily unavailable', dim: true };
    if (a.status !== 'available') return { action: 'soon', badge: a.soon_note || 'Coming soon' };
    if (!own && !a.free) return { action: 'buy', badge: 'Not in your library', dim: true };
    if (!b) return { action: 'none', badge: otherPlatformNote(a), dim: true };
    if (inst) {
      const newer = b.version && inst.version && b.version !== inst.version;
      if (newer) return { action: 'update', badge: 'Update available', inst, to: b.version };
      return { action: 'open', badge: inst.pending ? 'Installer ran' : 'Installed', ready: true, inst };
    }
    return { action: 'install', badge: 'In your library', ready: true };
  }

  /* ---------- data ---------- */
  /* GET /api/catalog is the site's own list - the same catalog.json the
     store pages and the Worker read (docs/hub-integration.md §2). Its
     shape is not this app's: apps are an object keyed by id, and
     `platforms` is an array of names rather than a map with sizes. The
     bundled copy fills in what the endpoint does not carry (artwork,
     the longer blurb) and stands in entirely when the site cannot be
     reached. */
  function fromApi(json) {
    var bundled = window.HUB_CATALOG.apps;
    return Object.keys(json.apps || {}).map(function (id) {
      var a = json.apps[id];
      var local = bundled.find(function (b) { return b.id === id; }) || {};
      var platforms = {};
      (a.platforms || []).forEach(function (name) {
        platforms[name] = { size: (local.platforms && local.platforms[name] || {}).size || null,
                            version: a.version || null };
      });
      return {
        id: id, name: a.name || local.name || id,
        tagline: a.tagline || local.tagline || '',
        blurb: local.blurb || a.tagline || '',
        kind: a.kind || local.kind || 'app',
        status: a.status || 'available',
        free: !!a.free, licensed: !!a.licensed,
        color: a.color || local.color || '#eeae61',
        /* The website's own artwork, absolute and already public. It is
           what the store shows, so the Hub and the site cannot drift:
           adding an app to catalog.json gives it a picture here too,
           with no Hub release and nothing bundled. The local map below
           is only the fallback for the five apps that shipped with
           this build, and initials are the fallback to that. */
        icon: a.icon || null, art: a.art || a.screenshot || null,
        /* The studio's own sentence about why this one is not
           downloadable yet - "Downloads paused while the next beta
           build goes up", say. Written once in catalog.json and
           shown by the store; without this line the Hub would be
           the only place that says the generic thing instead. */
        soon_note: a.soon_note || null,
        page: a.page || local.page, platforms: platforms,
      };
    });
  }

  /* An app the studio is holding back - finished, but not to be named
     in public yet. The store drops those tiles and so does this: a
     "coming soon" card for something with no name is not a tease, it
     is a question nobody can answer. */
  const shown = (list) => list.filter((a) => a.status !== 'hidden');

  async function loadCatalog() {
    try {
      const r = await window.hub.site('/api/catalog');
      if (r && r.ok && r.json && r.json.apps) {
        S.catalog = shown(fromApi(r.json));
        S.hubVersion = (r.json.hub && r.json.hub.version) || null;
        S.news = Array.isArray(r.json.news) ? r.json.news : [];
        /* Whatever the studio is announcing, if anything. The site has
           already decided: it sends nothing at all unless the notice is
           switched on and inside its dates, so there is no date
           arithmetic on this side to get wrong. */
        S.announce = r.json.announcement || null;
        S.online = true;
        noticeNewApps();
        return;
      }
    } catch (e) {}
    S.catalog = shown(window.HUB_CATALOG.apps.slice());
    S.announce = null;          // an unreachable site announces nothing
    S.online = false;
  }

  /* Anything in the collection this installation has not seen before
     announces itself. The very first run has nothing to compare against,
     so it only writes down what is there - otherwise a new customer
     would be told that all five apps are new, which is true and useless. */
  function noticeNewApps() {
    const ids = S.catalog.map((a) => a.id);
    if (!Array.isArray(S.seenApps)) { S.seenApps = ids; saveSeen(); return; }
    const fresh = ids.filter((id) => S.seenApps.indexOf(id) === -1);
    if (!fresh.length) return;
    S.newApps = fresh;
    S.seenApps = S.seenApps.concat(fresh);
    saveSeen();
    const names = fresh.map((id) => (byId(id) || {}).name).filter(Boolean);
    if (names.length) {
      toast(names.length === 1
        ? names[0] + ' has joined the collection.'
        : names.length + ' new apps have joined the collection.');
    }
  }
  function saveSeen() { try { localStorage.setItem('hub-seen-apps', JSON.stringify(S.seenApps)); } catch (e) {} }

  /* What's new, as one list: an app arriving is news whether or not a
     post was written for it, and it belongs at the top of the same
     panel rather than in a channel of its own. */
  function feed() {
    const written = S.news.map((n) => Object.assign({}, n, { kind: 'post' }));
    const arrivals = S.newApps.map((id) => {
      const a = byId(id) || { id: id, name: id };
      const soon = a.status && a.status !== 'available';
      return {
        kind: 'app', id: 'app:' + id, app: id, date: new Date().toISOString().slice(0, 10),
        tag: soon ? 'Coming soon' : 'New app',
        title: a.name + (soon ? ' is on the way' : ' is here'),
        body: soon
          ? (a.tagline || '') + ' It is not ready to download yet - this is the first you will hear of it, and the Hub will say when that changes.'
          : (a.tagline || '') + ' It is in the collection now, ready to install from your library.',
        url: a.page || null,
      };
    });
    // An arrival outranks a post, then newest first within each.
    return arrivals.concat(written).sort((x, y) =>
      (y.kind === 'app' ? 1 : 0) - (x.kind === 'app' ? 1 : 0) ||
      String(y.date || '').localeCompare(String(x.date || '')));
  }
  function unreadNews() { return feed().filter((n) => S.readNews.indexOf(n.id) === -1); }
  function markNewsRead() {
    const all = feed().map((n) => n.id);
    S.readNews = all.concat(S.readNews.filter((id) => all.indexOf(id) === -1)).slice(0, 200);
    try { localStorage.setItem('hub-news-read', JSON.stringify(S.readNews)); } catch (e) {}
  }

  let claiming = false;
  async function loadAccount() {
    const uid = S.session.user.id;
    const [prof, owned] = await Promise.all([
      sb.from('profiles').select('full_name,is_admin,is_client').eq('id', uid).maybeSingle(),
      sb.from('purchases').select('id, app, license_key, max_devices, amount_cents, currency, stripe_session_id, purchased_at, update_eligible_until').order('purchased_at', { ascending: true }),
    ]);
    S.profile = prof.data || {};
    if (owned.error) { toast('Could not load your apps: ' + owned.error.message, true); S.owned = S.owned || []; }
    else S.owned = owned.data || [];

    // The free apps join the library the first time it is opened - the
    // same claim_license the website's My Apps page makes, once per
    // session, so a failure is reported rather than retried forever.
    const have = new Set(S.owned.map((r) => r.app));
    const toClaim = FREE_APPS.filter((a) => !have.has(a) && byId(a));
    if (toClaim.length && !claiming) {
      claiming = true;
      const errs = await Promise.all(toClaim.map((a) => sb.rpc('claim_license', { p_app: a }).then((r) => r.error ? r.error.message : '', (e) => e.message || 'failed')));
      const err = errs.filter(Boolean)[0];
      if (err) toast('The free apps could not be added to this account: ' + err, true);
      const again = await sb.from('purchases').select('id, app, license_key, max_devices, amount_cents, currency, stripe_session_id, purchased_at, update_eligible_until').order('purchased_at', { ascending: true });
      if (!again.error) S.owned = again.data || [];
    }

    const devs = await sb.from('device_activations').select('id, license_id, device_name, device_id, first_seen, last_seen, revoked_at').is('revoked_at', null).order('last_seen', { ascending: false });
    S.devices = devs.data || [];
    S.installed = await window.hub.installed();
  }

  async function refresh(quiet) {
    $('#sync-text').textContent = 'Syncing…';
    try { await loadCatalog(); await loadAccount(); if (!quiet) toast('Library synced. ' + S.owned.length + (S.owned.length === 1 ? ' app' : ' apps') + ' in your account.'); }
    catch (e) { toast('Could not sync: ' + (e.message || e), true); }
    $('#sync-text').textContent = S.online ? 'Library synced' : 'Offline copy';
    $('#online').classList.toggle('off', !S.online);
    $('#foot-online').classList.toggle('off', !S.online);
    $('#foot-conn').textContent = S.online ? 'Connected to amanorsac.studio' : 'amanorsac.studio unreachable · showing the last known collection';
    render();
    flushUsage();
  }


  /* ---------- the heartbeat ----------
     One line a launch: a Hub exists, it is this version, on this kind
     of machine. It is what answers "how many people are running the
     Hub, and how many are still on an old one" - a question the shop
     needs answered and that the usage notes below cannot answer,
     because those only speak for the people who opted in and would
     undercount everybody else.

     The id is a random number kept in this window's own storage. Two
     accounts on a computer are one id, and the same person on a laptop
     and a studio machine is two. Nothing about it is derived from the
     machine, so it is not a fingerprint and cannot be recognised
     anywhere else. It is deliberately NOT the usage notes' install id:
     those are two systems with two different consent postures, and an
     id shared between them would tie an opted-out heartbeat to an
     opted-in note.

     What goes with it: the version, the platform, the architecture. The
     country is not sent - the server takes that from the connection.
     What does not go with it, and must not be added later: which apps
     are installed, which app was opened, when anything was used, any
     path through this interface. That is the usage notes' job, and the
     usage notes ask first. A heartbeat that grew into a usage log would
     be collecting without asking, which is the one thing the switch
     below exists to prevent.

     Failure is silence. If the site is unreachable this is simply not
     sent - it is a statistic, and nothing in the Hub waits on it. */
  function installId() {
    var k = 'hub-install-id', v = null;
    try { v = localStorage.getItem(k); } catch (e) {}
    if (!v || v.length < 8) {
      var b = new Uint8Array(16);
      (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(b)
        : b.forEach(function (_, i) { b[i] = Math.floor(Math.random() * 256); });
      v = Array.prototype.map.call(b, function (n) { return n.toString(16).padStart(2, '0'); }).join('');
      try { localStorage.setItem(k, v); } catch (e) { return null; }
    }
    return v;
  }

  async function sayHello() {
    var id = installId();
    if (!id) return;                    // no storage, no id, no ping
    var token = null;
    try { var s = await sb.auth.getSession(); token = s && s.data && s.data.session && s.data.session.access_token; }
    catch (e) {}
    try {
      await window.hub.site('/api/hub-ping', {
        method: 'POST', token: token || undefined,
        body: { install_id: id, version: window.hub.version || '',
                platform: window.hub.platform || '', os: S.device.os || '', arch: window.hub.arch || '' }
      });
    } catch (e) {}
  }

  /* ---------- usage notes ----------
     The Hub keeps a short note when an app is opened, installed or
     updated, and sends the batch the next time the site answers. It
     records nothing at all until the person has said yes; state.consent
     stays null until they choose, and null means off.

     Sending is the page's job because the page is the side holding the
     account. Main hands over a copy of the queue and only forgets those
     notes once this has confirmed they arrived, so a flush that fails
     halfway costs nothing. */
  async function loadUsage() {
    try { S.usage = await window.hub.usage.state(); } catch (e) { S.usage = null; }
  }

  async function setUsageConsent(yes) {
    try { S.usage = Object.assign(S.usage || {}, await window.hub.usage.consent(yes)); } catch (e) { return; }
    if (yes) {
      window.hub.usage.record('hub_open');
      toast('Thank you. The Hub will send a short note when you open an app.');
      flushUsage();
    } else {
      toast('Usage notes are off. Nothing waiting on this computer was sent.');
    }
    await loadUsage();
    render();
  }

  async function forgetUsage() {
    const ok = await window.hub.confirm({
      title: 'Delete usage notes', ok: 'Delete',
      message: 'This erases every usage note this account has already sent, on every computer. It cannot be undone.',
    });
    if (!ok) return;
    const { data, error } = await sb.rpc('revoke_hub_usage');
    if (error) { toast('Could not delete them: ' + error.message, true); return; }
    toast((data || 0) + ' note' + (data === 1 ? '' : 's') + ' deleted.');
  }

  async function flushUsage() {
    if (!S.online || !S.usage || S.usage.consent !== true) return;
    try {
      const batch = await window.hub.usage.take(100);
      if (!batch || !batch.events || !batch.events.length) return;
      const { error } = await sb.rpc('record_hub_usage', {
        p_install_id: batch.installId, p_events: batch.events,
      });
      if (error) return; // keep them; the next sync tries again
      await window.hub.usage.ack(batch.events.length);
      await loadUsage();
    } catch (e) { /* a note that cannot be sent waits, it never interrupts */ }
  }

  /* Listening for the studio.

     The library is not a page somebody reloads, so on its own it would
     show whatever was true when the window opened - possibly days ago,
     on a machine that never sleeps. This keeps it current without
     anyone pressing Sync: the catalog is re-read every few minutes, and
     again the moment the window comes back to the front or the machine
     finds the network, which is when somebody is actually looking.

     Only the collection is re-read, never the account: purchases and
     devices change because of something this person did, and they are
     already reloaded when that happens. A notice or a new build is the
     other way round - it changes because the studio did something, and
     nothing here would otherwise ever hear about it.

     A download in progress is left alone. Re-rendering a card mid-
     install would throw away its progress bar, and the panel is not
     worth that. */
  const WATCH_EVERY = 4 * 60 * 1000;
  let lastListen = Date.now();

  function noticeKey(n) {
    return n ? [n.id, n.headline, n.body, n.art, n.accent,
                n.action && n.action.label, n.link && n.link.label].join('\u0000') : '';
  }

  async function listen() {
    if (!S.session || Object.keys(S.jobs).length) return;
    const before = noticeKey(S.announce) + '|' + S.catalog.map((a) => a.id + a.status + (a.platforms[S.device.platform] || {}).version).join(',');
    await loadCatalog();
    const after = noticeKey(S.announce) + '|' + S.catalog.map((a) => a.id + a.status + (a.platforms[S.device.platform] || {}).version).join(',');
    $('#online').classList.toggle('off', !S.online);
    $('#foot-online').classList.toggle('off', !S.online);
    if (before !== after) render();
  }

  setInterval(() => { lastListen = Date.now(); listen(); }, WATCH_EVERY);
  /* Coming back to the window is throttled: alt-tabbing between the Hub
     and a DAW should not be a request each time. */
  window.addEventListener('focus', () => { if (Date.now() - lastListen > 30000) { lastListen = Date.now(); listen(); } });
  window.addEventListener('online', () => { lastListen = Date.now(); listen(); });

  /* ---------- downloading and installing ---------- */
  async function freshToken() {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) throw new Error('Your session has expired. Sign in again.');
    S.session = data.session;
    return data.session.access_token;
  }

  async function install(a, mode) {
    if (S.jobs[a.id]) return;
    const b = build(a);
    if (!b) { toast(a.name + ' has no ' + S.device.os + ' build.', true); return; }
    S.jobs[a.id] = { app: a.id, state: 'preparing', percent: 0, received: 0, total: 0, mode: mode || 'install', started: Date.now() };
    render();
    let token;
    try { token = await freshToken(); } catch (e) { delete S.jobs[a.id]; toast(e.message, true); render(); return; }
    const r = await window.hub.download({ app: a.id, platform: S.device.platform, token, title: a.name });
    if (r.error) {
      delete S.jobs[a.id]; render();
      if (r.error !== 'cancelled') {
        if (r.error === 'sign_in') { await signOut('Your session expired. Sign in again to continue.'); return; }
        toast(r.message || 'The download failed.', true);
      } else toast('Download cancelled.');
      return;
    }
    S.jobs[a.id].state = 'installing'; S.jobs[a.id].percent = 100; render();
    const i = await window.hub.install({ app: a.id, name: a.name, path: r.path, version: r.version || b.version || null, kind: a.kind, mode: mode || 'install' });
    delete S.jobs[a.id];
    S.installed = await window.hub.installed();
    if (i.error) { toast(i.message || 'Could not install ' + a.name + '.', true); }
    else {
      S.history.unshift({ app: a.id, name: a.name, version: i.record.version, file: r.file, bytes: r.bytes, at: new Date().toISOString(), kind: i.record.kind, mode: mode || 'install' });
      S.history = S.history.slice(0, 40);
      try { localStorage.setItem('hub-history', JSON.stringify(S.history)); } catch (e) {}
      toast(a.name + (mode === 'update' ? ' is up to date.' : i.record.kind === 'plugin' ? ' is installed. Open it inside your DAW.' : i.record.kind === 'installer' ? ' installer finished.' : ' is ready.'));
    }
    render();
  }

  async function launch(a) {
    const r = await window.hub.launch(a.id);
    if (r.error) toast(r.message || 'Could not open ' + a.name + '.', r.error !== 'plugin');
  }

  async function uninstall(a) {
    const inst = S.installed[a.id];
    const ok = await window.hub.confirm({ title: 'Remove ' + a.name, ok: 'Remove',
      message: inst && inst.kind === 'portable' ? 'This deletes ' + a.name + ' from this computer. Your license stays in your account; you can install it again any time.'
        : a.name + ' was set up by its own installer. The Hub will forget it and open your system\'s uninstall settings.' });
    if (!ok) return;
    await window.hub.uninstall(a.id);
    S.installed = await window.hub.installed();
    toast(a.name + ' removed from this computer.');
    render();
  }

  /* amanorsac://install/<app> from the website: show the library with
     that app found, and start it installing if this account owns it and
     there is a build for this machine. Anything else - not owned, no
     build, still to come - just puts it on screen and lets the card say
     why, which is the same answer the person would get by looking. */
  window.hub.onDeepLink((link) => {
    if (!link) return;
    navigate('library');
    // The Hub's own page sends install/hub; there is nothing to install,
    // the person is already looking at it. Coming to the front is the
    // whole of what they asked for.
    if (link.action !== 'install' || !link.app || link.app === 'hub') return;
    const a = byId(link.app);
    if (!a) { toast('That app is not in the catalogue yet.', true); return; }
    $('#search').value = a.name;
    render();
    const st = status(a);
    if (st.action === 'install' || st.action === 'update') install(a, st.action);
    else if (st.action === 'open') launch(a);
    else if (st.action === 'buy') toast(a.name + ' is not in your library yet - it is bought on the website.');
    else toast(a.name + ' is not available for this computer yet.');
  });

  window.hub.onProgress((p) => {
    const job = S.jobs[p.app]; if (!job) return;
    if (p.state === 'downloading' || p.state === 'preparing' || p.state === 'downloaded') Object.assign(job, p);
    const bar = $$('[data-bar="' + p.app + '"]'); const txt = $$('[data-pct="' + p.app + '"]');
    bar.forEach((b) => { b.style.width = (job.percent || 0) + '%'; b.parentElement.classList.toggle('indet', !job.total); });
    txt.forEach((t) => { t.textContent = progressText(job); });
  });
  function progressText(job) {
    if (job.state === 'installing') return 'Installing…';
    if (job.state === 'preparing') return 'Preparing…';
    return job.total ? job.percent + '% · ' + mb(job.received) + ' of ' + mb(job.total) : mb(job.received || 0);
  }

  /* ---------- rendering ---------- */
  const TITLES = {
    library: ['Your creative home.', 'All your tools. Ready when inspiration is.'],
    downloads: ['Downloads', 'Your installs and updates, all in one place.'],
    updates: ['Keep your studio current.', 'The latest improvements for the tools you use.'],
    news: ['What\u2019s new.', 'Releases, new apps and notes from the studio.'],
    licenses: ['Your license keys.', 'Your software belongs with you.'],
    devices: ['Your connected devices.', 'Manage where your apps are activated.'],
    purchases: ['Your purchases.', 'Every app in your collection, accounted for.'],
  };

  /* Artwork, in the order it should be trusted: what the site sent for
     this app, then what this build happens to have bundled, then the
     app's initials. A picture that fails to load - offline, or a file
     renamed on the site - steps aside for the next thing down the list,
     because an empty grey rectangle is worse than two letters. That is
     handled by one listener rather than an onerror attribute on each
     image: this window runs under script-src 'self', which blocks
     inline handlers, and an onerror that never fires is the same as no
     fallback at all. */
  const LOCAL_ICON = { nebulatide: 'assets/nt-logo.webp', pulseroom: 'assets/pulseroom-logo.svg', secondout: 'assets/secondout-icon.png', performlive: 'assets/performlive.webp', harmoniemd: 'assets/harmoniemd.png' };
  const LOCAL_SHOT = { nebulatide: 'assets/nebulatide-shot.webp', pulseroom: 'assets/pulseroom-shot.webp', secondout: 'assets/secondout-screenshot.png' };

  function initialsFor(a) { return esc(String(a.name || a.id).slice(0, 2).toUpperCase()); }
  function iconFor(a) {
    const src = a.icon || LOCAL_ICON[a.id];
    if (!src) return initialsFor(a);
    return '<img src="' + esc(src) + '" alt="" loading="lazy" data-initials="' + initialsFor(a) + '">';
  }
  function shotFor(a) { return a.art || LOCAL_SHOT[a.id] || null; }

  /* One listener for every broken picture in the window. The error
     event does not bubble, so this is registered in the capture phase,
     where it is seen on the way down and works for markup written long
     after this line runs. */
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.gone) return;
    img.dataset.gone = '1';
    const box = img.parentNode;
    if (!box) return;
    if (img.dataset.artFor) {
      /* A screenshot that will not load. The app still has an icon, and
         if that icon will not load either this same listener catches it
         and leaves the initials - one step down the list at a time. */
      const a = byId(img.dataset.artFor);
      box.classList.add('icon');
      box.style.background = '#1d2124';
      box.innerHTML = a ? iconFor(a) : '';
    } else if (img.dataset.initials) {
      box.textContent = img.dataset.initials;
    } else {
      img.remove();
    }
  }, true);


    function card(a) {
    const st = status(a), b = build(a), inst = S.installed[a.id], shot = shotFor(a);
    const meta = [];
    if (inst) meta.push('On this computer' + (inst.version ? ' · v' + inst.version : ''));
    else meta.push(a.free ? 'Free license' : ownedRow(a.id) ? 'In your library' : 'Paid app');
    if (b) meta.push((b.version ? 'Version ' + b.version : 'Latest build') + (b.size ? ' &nbsp; · &nbsp; ' + b.size : ''));
    else meta.push(otherPlatformNote(a));

    let btn = '';
    if (st.action === 'busy') btn = '<button disabled>' + esc(st.job.state === 'installing' ? 'Installing' : (st.job.percent || 0) + '%') + '</button><button class="icon" data-cancel="' + a.id + '" title="Cancel">✕</button>';
    else if (st.action === 'install') btn = '<button class="primary" data-install="' + a.id + '">↓ &nbsp; Install</button>';
    else if (st.action === 'update') btn = '<button class="primary" data-update="' + a.id + '">↻ &nbsp; Update</button><button class="icon" data-open="' + a.id + '" title="Open">↗</button>';
    else if (st.action === 'open') btn = (a.kind === 'plugin' ? '<button data-info="' + a.id + '">In your DAW</button>' : '<button data-open="' + a.id + '">Open app ↗</button>') + '<button class="icon" data-remove="' + a.id + '" title="Remove from this computer">🗑</button>';
    else if (st.action === 'buy') btn = '<button class="primary" data-page-url="' + esc(a.page) + '">Buy on the site ↗</button>';
    else if (st.action === 'pulled') btn = '<button disabled title="This build has been withdrawn while a problem is fixed">Unavailable</button>';
    else if (st.action === 'soon') btn = '<button data-page-url="' + esc(a.page) + '">Learn more ↗</button>';
    else btn = '<button data-page-url="' + esc(a.page) + '">Details ↗</button>';

    const bar = st.action === 'busy' ? '<div class="progress' + (st.job.total ? '' : ' indet') + '" role="progressbar" aria-label="Installing ' + esc(a.name) + '"><i data-bar="' + a.id + '" style="width:' + (st.job.percent || 0) + '%"></i></div><p class="meta" style="margin:8px 0 0" data-pct="' + a.id + '">' + esc(progressText(st.job)) + '</p>' : '';

    return '<article class="card" data-app="' + a.id + '">' +
      '<div class="art' + (shot ? '' : ' icon') + '" style="background:' + (shot ? '#23202e' : '#1d2124') + '">' +
        (shot ? '<img src="' + esc(shot) + '" alt="' + esc(a.name) + ' interface" loading="lazy" data-art-for="' + esc(a.id) + '">'
              : iconFor(a)) + '</div>' +
      '<div class="card-content"><div class="cardtitle"><h3>' + esc(a.name) + '</h3><span class="badge' + (st.ready ? ' ready' : st.dim ? ' dim' : '') + '">' + esc(st.badge) + '</span></div>' +
      '<p>' + esc(a.tagline) + '</p>' +
      '<div class="cardfoot"><div class="meta">' + meta.join('<br>') + '</div><div class="btns">' + btn + '</div></div>' + bar + '</div></article>';
  }

  function renderLibrary() {
    $('#consent-slot').innerHTML = consentCard();
    const q = ($('#search').value || '').toLowerCase();
    // A build that is not downloadable stays on the shelf, greyed,
    // rather than vanishing: someone who owns it and has it installed
    // should not have to wonder whether it was deleted out from under
    // them. That is true whichever word the catalog uses - "withdrawn"
    // while a build is down for repair, "coming_soon" while the next
    // beta goes up. PerformLive is the live case: it is paused, it is
    // free, and people have it installed right now.
    const onShelf = (a) => a.status === 'available' || a.status === 'withdrawn' || !!ownedRow(a.id);
    const avail = S.catalog.filter(onShelf);
    const list = avail.filter((a) => a.name.toLowerCase().includes(q) && (S.filter === 'all' || (S.filter === 'installed' ? !!S.installed[a.id] : !S.installed[a.id])));
    $('#cards').innerHTML = list.length ? list.map(card).join('') : '<div class="empty" style="grid-column:1/-1"><h3>No matching apps</h3><p>Try another search or choose All apps.</p></div>';
    $('#all-count').textContent = avail.length;
    $('#installed-count').textContent = avail.filter((a) => S.installed[a.id]).length;
    $('#available-count').textContent = avail.filter((a) => !S.installed[a.id]).length;

    /* The panel across the top. A notice from the studio takes it
       whenever one is running and this person has not closed it;
       otherwise it goes back to being useful about the library. */
    if (renderNotice()) return renderSoon();

    // The feature: an update if one is waiting, else something not yet installed, else the newest thing
    const upd = avail.find((a) => status(a).action === 'update');
    const next = avail.find((a) => status(a).action === 'install');
    const f = upd || next || avail.find((a) => a.status === 'available');
    if (f) {
      const st = status(f);
      $('#feature').innerHTML = '<div class="feature-copy"><div class="eyebrow">' + (upd ? 'UPDATE READY' : next ? 'IN YOUR LIBRARY' : 'IN YOUR COLLECTION') + '</div><h2>' + esc(f.id === 'nebulatide' ? 'A little space. Infinite atmosphere.' : f.tagline) + '</h2><p>' + esc(f.blurb || f.tagline) + '</p>' +
        '<div class="actions">' + (st.action === 'update' ? '<button data-update="' + f.id + '">Update ' + esc(f.name) + '</button>' : st.action === 'install' ? '<button data-install="' + f.id + '">Install ' + esc(f.name) + '</button>' : st.action === 'open' && f.kind !== 'plugin' ? '<button data-open="' + f.id + '">Open ' + esc(f.name) + '</button>' : '') +
        '<button class="ghost" data-page-url="' + esc(f.page) + '">Explore ' + esc(f.name) + ' &nbsp; ↗</button></div></div>' +
        '<div class="feature-art">' + (shotFor(f) ? '<img src="' + shotFor(f) + '" alt="">' : '') + '</div>';
    }
    renderSoon();
  }

  function renderSoon() {
    // Whatever is on the shelf above is not also "next in your studio" -
    // an app you already own is not something to look forward to. Same
    // test as renderLibrary, inverted, so the two can never both claim
    // an app or both drop it.
    const soon = S.catalog.filter((a) =>
      a.status !== 'available' && a.status !== 'withdrawn' && !ownedRow(a.id));
    $('#soon').innerHTML = soon.map((a) => '<a class="soon" data-page-url="' + esc(a.page) + '"><span class="appicon">' + iconFor(a) + '</span><div><strong>' + esc(a.name) + '</strong><p>' + esc(a.soon_note || a.tagline) + '</p></div><small>COMING SOON</small></a>').join('') || '<p class="note">Everything in the collection is available.</p>';
  }

  /* ---------- the studio's notice ----------------------------------
     Written in catalog.json on the website and handed over by
     /api/catalog, which has already decided whether it is running: the
     Hub draws what it is given and nothing else. Everything is text
     from a file the studio controls, and it still goes through esc() -
     a notice is copy, not markup, and one stray angle bracket should
     never be able to rearrange this window.

     A closed notice is remembered by its id, so a new notice is seen by
     everyone even if they closed the last one. */
  function noticeClosed(id) {
    try { return (JSON.parse(localStorage.getItem('hub-notice-closed') || '[]')).indexOf(id) >= 0; }
    catch (e) { return false; }
  }
  function closeNotice(id) {
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem('hub-notice-closed') || '[]'); } catch (e) {}
    if (seen.indexOf(id) < 0) seen.push(id);
    try { localStorage.setItem('hub-notice-closed', JSON.stringify(seen.slice(-20))); } catch (e) {}
    S.noticeShown = null;
    renderLibrary();
  }

  function renderNotice() {
    const n = S.announce;
    if (!n || !n.headline || (n.dismissible && noticeClosed(n.id))) {
      S.noticeShown = null;
      $('#feature').className = 'feature';      // undo a notice drawn a moment ago
      return false;
    }

    /* A button that names an app does whatever that app needs on this
       computer - install it, update it, open it - and says so. If the
       app is not in the library, or has no build for this platform,
       the button becomes the link to its page rather than a dead end. */
    let act = '';
    if (n.action) {
      const a = n.action.app && byId(n.action.app);
      const st = a && status(a);
      if (st && (st.action === 'install' || st.action === 'update'))
        act = '<button data-' + st.action + '="' + esc(a.id) + '">' + esc(n.action.label) + '</button>';
      else if (st && st.action === 'open' && a.kind !== 'plugin')
        act = '<button data-open="' + esc(a.id) + '">Open ' + esc(a.name) + '</button>';
      else if (n.action.url)
        act = '<button data-page-url="' + esc(n.action.url) + '">' + esc(n.action.label) + '</button>';
      else if (a)
        act = '<button data-page-url="' + esc(a.page) + '">' + esc(n.action.label) + '</button>';
    }
    const link = n.link && n.link.url
      ? '<button class="ghost" data-page-url="' + esc(n.link.url) + '">' + esc(n.link.label) + ' &nbsp; ↗</button>' : '';

    const el = $('#feature');
    el.className = 'feature notice';
    el.style.setProperty('--accent', n.accent || '#A99CFF');
    el.innerHTML =
      '<div class="feature-copy">' +
        '<div class="eyebrow">' + esc(n.eyebrow || 'FROM THE STUDIO') + '</div>' +
        '<h2>' + esc(n.headline) + '</h2>' +
        (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
        (act || link ? '<div class="actions">' + act + link + '</div>' : '') +
      '</div>' +
      '<div class="feature-art">' + (n.art ? '<img src="' + esc(n.art) + '" alt="">' : '') + '</div>' +
      (n.dismissible ? '<button class="notice-x" data-close-notice="' + esc(n.id) + '" title="Dismiss" aria-label="Dismiss this notice">✕</button>' : '');
    S.noticeShown = n.id;
    return true;
  }

  function row(a, body, action, cls) {
    return '<div class="row ' + (cls || '') + '"><span class="appicon">' + iconFor(a) + '</span><div>' + body + '</div><div class="right">' + (action || '') + '</div></div>';
  }

  function renderSecondary() {
    let html = '';
    const p = S.page;
    if (p === 'updates') {
      const list = S.catalog.filter((a) => status(a).action === 'update' || (S.jobs[a.id] && S.jobs[a.id].mode === 'update'));
      html = list.length ? list.map((a) => { const st = status(a); return row(a, '<h3>' + esc(a.name) + '</h3><p>' + (st.action === 'busy' ? '<span data-pct="' + a.id + '">' + esc(progressText(st.job)) + '</span>' : 'Version ' + esc(st.inst && st.inst.version || '?') + ' installed · version ' + esc(st.to) + ' available') + '</p>' + (st.action === 'busy' ? '<div class="progress"><i data-bar="' + a.id + '" style="width:' + (st.job.percent || 0) + '%"></i></div>' : ''),
        st.action === 'busy' ? '<button disabled>Updating</button>' : '<button class="primary" data-update="' + a.id + '">Update app</button>'); }).join('')
        : '<div class="empty"><h3>You’re up to date.</h3><p>Everything installed here matches the latest build on amanorsac.studio.</p></div>';
    }
    if (p === 'downloads') {
      const jobs = Object.values(S.jobs).map((j) => { const a = byId(j.app); return row(a, '<h3>' + esc(a.name) + '</h3><p data-pct="' + a.id + '">' + esc(progressText(j)) + '</p><div class="progress' + (j.total ? '' : ' indet') + '"><i data-bar="' + a.id + '" style="width:' + (j.percent || 0) + '%"></i></div>', '<span class="badge">' + (j.state === 'installing' ? 'Installing' : 'Downloading') + '</span> <button data-cancel="' + a.id + '">Cancel</button>'); });
      const hist = S.history.map((h) => { const a = byId(h.app) || { id: h.app, name: h.name }; return row(a, '<h3>' + esc(h.name) + '</h3><p>' + esc(h.mode === 'update' ? 'Updated' : 'Installed') + ' ' + esc(ago(h.at)) + (h.version ? ' · version ' + esc(h.version) : '') + (h.bytes ? ' · ' + mb(h.bytes) : '') + '</p>', '<span class="badge ready">Complete</span>'); });
      html = jobs.join('') + hist.join('');
      if (!html) html = '<div class="empty"><h3>No downloads yet.</h3><p>Install or update an app from your library and it will show up here.</p><button data-go="library">Go to my library</button></div>';
      html += '<p class="note">Installers are kept in the Hub’s downloads folder; apps unpacked by the Hub live in its apps folder. <button class="quiet" data-reveal="downloads" style="padding:4px 8px;font-size:11px">Open downloads folder</button> <button class="quiet" data-reveal="apps" style="padding:4px 8px;font-size:11px">Open apps folder</button></p>';
    }
    if (p === 'licenses') {
      const licensed = S.owned.filter((o) => byId(o.app) && byId(o.app).licensed);
      const free = S.owned.filter((o) => byId(o.app) && !byId(o.app).licensed);
      html = (licensed.length ? '<p class="section">Keys the app asks for</p>' + licensed.map((o) => { const a = byId(o.app); const devs = S.devices.filter((d) => d.license_id === o.id);
        return row(a, '<h3>' + esc(a.name) + '</h3><p>' + esc(o.amount_cents ? 'Purchased ' + when(o.purchased_at) : 'Free license') + ' · ' + devs.length + ' of ' + esc(o.max_devices) + ' devices in use</p><p class="key" data-key-for="' + esc(o.id) + '">••••-••••-••••-••••</p>',
          '<button data-reveal-key="' + esc(o.id) + '">Reveal</button> <button data-copy-key="' + esc(o.id) + '">Copy</button>'); }).join('') : '') +
        (free.length ? '<p class="section">No key needed</p>' + free.map((o) => { const a = byId(o.app); return row(a, '<h3>' + esc(a.name) + '</h3><p>Free — install it and go. Your key is kept in your account for the day a build asks for one.</p>', '<span class="badge ready">Free license</span>'); }).join('') : '') +
        (!S.owned.length ? '<div class="empty"><h3>No licenses yet.</h3><p>Apps you buy or claim on amanorsac.studio appear here with their keys.</p></div>' : '') +
        '<p class="note">Keys are read from your account each time. A key is pasted into the app when it asks; the same key works on ' + (licensed[0] ? esc(licensed[0].max_devices) : 'two') + ' devices.</p>';
    }
    if (p === 'devices') {
      const here = S.device;
      const mine = Object.values(S.installed);
      html = '<p class="section">This computer</p><div class="row devrow"><span class="ico" style="font-size:22px">▱</span><div><h3>' + esc(here.hostname || 'This computer') + '</h3><p>' + esc(here.os + (here.release ? ' ' + here.release : '')) + ' · ' + esc(here.arch) + ' · ' + (mine.length ? mine.map((m) => esc(m.name)).join(', ') + ' installed here' : 'nothing installed by the Hub yet') + '</p></div><span class="badge ready right">This device</span></div>';
      const withApp = S.devices.map((d) => ({ d, o: S.owned.find((o) => o.id === d.license_id) })).filter((x) => x.o);
      html += '<p class="section">Activated devices</p>' + (withApp.length ? withApp.map(({ d, o }) => { const a = byId(o.app) || { id: o.app, name: o.app };
        const isHere = here.hostname && d.device_name && d.device_name.toLowerCase().includes(here.hostname.toLowerCase());
        return row(a, '<h3>' + esc(d.device_name || d.device_id) + (isHere ? ' <span class="badge ready">This device</span>' : '') + '</h3><p>' + esc(a.name) + ' · activated ' + esc(when(d.first_seen)) + ' · last seen ' + esc(ago(d.last_seen)) + '</p>', '<button class="danger" data-revoke="' + esc(d.id) + '">Remove</button>', 'devrow'); }).join('')
        : '<div class="empty"><h3>No device has activated a key yet.</h3><p>When an app that asks for a license key is activated on a computer, it appears here. Removing one frees its slot.</p></div>');
      html += '<p class="note">Two devices per license. Removing a device here is the only way to free a slot for a computer you no longer have.</p>';
      html += usagePanel();
    }
    if (p === 'news') {
      const items = feed();
      const read = S.readNews;
      html = items.length ? items.map((n) => {
        const a = n.app ? byId(n.app) : null;
        const fresh = read.indexOf(n.id) === -1;
        return '<article class="post' + (fresh ? ' fresh' : '') + '"' + (a && a.color ? ' style="--accent:' + esc(a.color) + '"' : '') + '>' +
          '<div class="post-side">' + (a ? '<span class="appicon">' + iconFor(a) + '</span>' : '<span class="appicon dot"></span>') + '</div>' +
          '<div class="post-body"><div class="post-meta">' +
            (n.tag ? '<span class="tag">' + esc(n.tag) + '</span>' : '') +
            '<span>' + esc(when(n.date)) + '</span>' +
            (fresh ? '<span class="tag new">Unread</span>' : '') +
          '</div>' +
          '<h3>' + esc(n.title) + '</h3><p>' + esc(n.body) + '</p>' +
          (n.url ? '<button class="quiet" data-page-url="' + esc(n.url) + '">Read more &nbsp;\u2197</button>' : '') +
          (n.kind === 'app' && a && a.status === 'available' ? ' <button class="primary" data-go-app="' + esc(a.id) + '">See it in my library</button>' : '') +
          '</div></article>';
      }).join('')
        : '<div class="empty"><h3>Nothing new just yet.</h3><p>Releases, new apps and notes from the studio land here. You will see a mark on the sidebar when one does.</p></div>';
      html += '<p class="note">New apps announce themselves as soon as they reach amanorsac.studio \u2014 nothing to check, nothing to subscribe to.</p>';
    }
    if (p === 'purchases') {
      const list = S.owned.slice().sort((a, b) => new Date(b.purchased_at) - new Date(a.purchased_at));
      html = list.length ? list.map((o) => { const a = byId(o.app) || { id: o.app, name: o.app }; const forever = !o.update_eligible_until || o.update_eligible_until.slice(0, 4) > '9000';
        return row(a, '<h3>' + esc(a.name) + '</h3><p>' + (o.amount_cents ? 'Purchased ' : 'Added ') + esc(when(o.purchased_at)) + ' · ' + esc(money(o.amount_cents, o.currency)) + (forever ? '' : ' · updates until ' + esc(when(o.update_eligible_until))) + '</p>', '<button data-receipt="' + esc(o.id) + '">View receipt</button>'); }).join('')
        : '<div class="empty"><h3>Nothing here yet.</h3><p>Everything you buy or claim on amanorsac.studio is listed here.</p><button data-page-url="' + SITE + '/apps">Browse the App Store ↗</button></div>';
    }
    $('#secondary').innerHTML = '<div class="rows">' + html + '</div>';
  }

  /* The switch, and the plain truth beside it. It lives with the
     devices because that is where someone goes to see what this
     account is doing on which machine. */
  /* The switch, and the reason to leave it on. It lives with the
     devices because that is where someone goes to see what this account
     is doing on which machine.

     The copy leads with what it buys them and states the limit once. An
     earlier draft listed four things the Hub does not collect, which
     read as a denial and planted the doubt it was trying to answer. */
  function usagePanel() {
    const u = S.usage;
    if (!u) return '';
    const on = u.consent === true;
    const body = on
      ? 'You are helping decide what gets built next. The Hub notes which app you open and whether this is a Windows or a Mac \u2014 never your files, your projects or your name.'
        + (u.pending ? ' ' + u.pending + ' note' + (u.pending === 1 ? '' : 's') + ' waiting for the next connection.' : '')
      : 'Turn this on and the next release goes where the work actually is, instead of where I guessed it was. The Hub notes which app you open and whether this is a Windows or a Mac \u2014 never your files, your projects or your name.';
    return '<p class="section">Usage notes</p>' +
      '<div class="row privacy"><span class="ico" style="font-size:22px">\u25CE</span><div>' +
      '<h3>' + (on ? 'You\u2019re helping shape the next release' : 'Help shape the next release') + '</h3>' +
      '<p>' + body + '</p></div>' +
      '<div class="right"><button class="' + (on ? '' : 'primary') + '" data-usage="' + (on ? 'off' : 'on') + '">' +
      (on ? 'Turn off' : 'Turn on') + '</button>' +
      (on || u.consent === false ? ' <button class="danger" data-usage="forget">Delete what I\u2019ve sent</button>' : '') +
      '</div></div>';
  }

  /* Asked once, on the library page, in the same voice as everything
     else. Ignoring it is a valid answer: consent stays null and nothing
     is recorded. */
  function consentCard() {
    if (!S.usage || S.usage.consent !== null) return '';
    return '<div class="consent" id="consent"><div>' +
      '<h3>Help decide what gets built next.</h3>' +
      '<p>Right now I am guessing which of these apps people actually live in. ' +
      'Let the Hub tell me which one you open and how often, and the next release goes ' +
      'where the work really is \u2014 the features you use get deeper, and the ones nobody ' +
      'touches stop taking up my evenings. Which app, and whether this is a Windows or a Mac. ' +
      'Never your files, your projects or your name. Off again in one click, under My devices.</p>' +
      '</div><div class="consent-do"><button class="primary" data-usage="on">Count me in</button><button data-usage="off">Not now</button></div></div>';
  }

  function render() {
    if (!S.session) return;
    $('#download-count').textContent = Object.keys(S.jobs).length || '';
    $('#update-count').textContent = S.catalog.filter((a) => status(a).action === 'update').length || '';
    $('#news-count').textContent = unreadNews().length || '';
    if (S.page === 'library') renderLibrary(); else renderSecondary();
  }

  function navigate(p) {
    S.page = p;
    $('#library').classList.toggle('hidden', p !== 'library');
    $('#secondary').classList.toggle('hidden', p === 'library');
    $('#title').textContent = TITLES[p][0]; $('#subtitle').textContent = TITLES[p][1];
    $$('[data-page]').forEach((b) => { const on = b.dataset.page === p; b.classList.toggle('active', on); if (on) { b.setAttribute('aria-current', 'page'); $('#crumb').textContent = b.querySelector('.label').textContent; } else b.removeAttribute('aria-current'); });
    $('#main').scrollTop = 0;
    render();
    if (p === 'news') { markNewsRead(); $('#news-count').textContent = ''; }
  }

  /* ---------- signed in / out ---------- */
  function initials(name) { const p = String(name || '').trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?'; }
  function showApp(on) {
    $('#loading').classList.add('hidden');
    $('#auth').classList.toggle('hidden', on);
    ['#side', '#main', '#foot'].forEach((s) => $(s).classList.toggle('hidden', !on));
  }
  async function enter() {
    const user = S.session.user;
    const name = (S.profile && S.profile.full_name) || (user.user_metadata || {}).full_name || user.email;
    $('#avatar').textContent = initials(name); $('#who-name').textContent = name; $('#who-email').textContent = user.email || '';
    await loadUsage();
    // One note per session, made here rather than at startup so it
    // belongs to a signed-in account. Dropped if consent is not yes.
    window.hub.usage.record('hub_open');
    showApp(true);
    navigate('library');
    flushUsage();
  }
  async function signOut(msg) {
    await sb.auth.signOut().catch(() => {});
    S.session = null; S.owned = []; S.devices = []; S.profile = null;
    showApp(false);
    say(msg || '', !!msg);
  }

  function say(t, bad, good) { const m = $('#auth-msg'); m.textContent = t; m.className = 'auth-msg' + (bad ? ' bad' : good ? ' good' : ''); }
  function busy(form, on, label) { const b = $('.go', form); b.disabled = on; b.innerHTML = on ? '<span class="spin"></span>' + esc(label) : esc(label); }

  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => {
    const up = b.dataset.authTab === 'up';
    $$('[data-auth-tab]').forEach((x) => x.classList.toggle('on', x === b));
    $('#signin').classList.toggle('hidden', up); $('#signup').classList.toggle('hidden', !up);
    $('#auth-title').textContent = up ? 'Create your account.' : 'Welcome back.';
    $('#auth-sub').textContent = up ? 'One account for the website and the Hub. Free apps join your library the moment you sign in.' : 'Sign in with the account you use on amanorsac.studio. Your apps, keys and devices come with it.';
    say('');
  }));
  $('#signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#in-email').value.trim(), password = $('#in-pass').value;
    if (!email || !password) { say('Enter your email and password.', true); return; }
    busy($('#signin'), true, 'Signing in'); say('');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    busy($('#signin'), false, 'Sign in');
    if (error) say(/confirm/i.test(error.message) ? 'Confirm your email first - the link is in your inbox.' : error.message === 'Invalid login credentials' ? 'That email and password do not match.' : error.message, true);
  });
  $('#signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#up-email').value.trim(), password = $('#up-pass').value, full_name = $('#up-name').value.trim();
    if (!email || password.length < 8) { say('An email and a password of at least 8 characters, please.', true); return; }
    busy($('#signup'), true, 'Creating'); say('');
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: SITE + '/client.html' } });
    busy($('#signup'), false, 'Create account');
    if (error) { say(error.message, true); return; }
    if (data && data.session) return; // confirmations off: signed straight in
    $$('[data-auth-tab]')[0].click(); $('#in-email').value = email; say('Almost there - open the confirmation link sent to ' + email + ', then sign in here.', false, true);
  });
  $('#forgot').addEventListener('click', async () => {
    const email = $('#in-email').value.trim();
    if (!email) { say('Type your email above first, then click Forgot password.', true); $('#in-email').focus(); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE + '/portal/reset.html' });
    say(error ? error.message : 'If an account exists for ' + email + ', a reset link is on its way.', !!error, !error);
  });
  $('#open-site').addEventListener('click', () => open(SITE + '/client.html'));
  $('#signout').addEventListener('click', () => signOut());

  /* ---------- clicks ---------- */
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="http"], [data-page-url]');
    if (a) { e.preventDefault(); open(a.dataset.pageUrl || a.href); return; }
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.page) navigate(d.page);
    if (d.go) navigate(d.go);
    if (d.filter) { S.filter = d.filter; $$('[data-filter]').forEach((x) => { x.classList.toggle('selected', x === b); x.setAttribute('aria-pressed', String(x === b)); }); render(); }
    if (d.install) install(byId(d.install), 'install');
    if (d.update) install(byId(d.update), 'update');
    if (d.open) launch(byId(d.open));
    if (d.remove) uninstall(byId(d.remove));
    if (d.cancel) { window.hub.cancel(d.cancel); }
    if (d.closeNotice) closeNotice(d.closeNotice);
    if (d.info) { const app = byId(d.info); modal(app.name, '<p>' + esc(app.name) + ' is a plug-in. It is installed on this computer; open it inside your DAW like any other plug-in.' + (app.licensed ? ' When it asks for a license key, it is under License keys here.' : '') + '</p>'); }
    if (d.reveal) window.hub.reveal(d.reveal);
    if (d.goApp) { navigate('library'); S.filter = 'all'; $('#search').value = (byId(d.goApp) || {}).name || ''; render(); }
    if (d.usage === 'on') setUsageConsent(true);
    if (d.usage === 'off') setUsageConsent(false);
    if (d.usage === 'forget') forgetUsage();
    if (d.revealKey) { const o = S.owned.find((x) => String(x.id) === d.revealKey); const k = $('[data-key-for="' + d.revealKey + '"]'); const hidden = k.textContent.includes('•'); k.textContent = hidden ? (o.license_key || '—') : '••••-••••-••••-••••'; b.textContent = hidden ? 'Hide' : 'Reveal'; }
    if (d.copyKey) { const o = S.owned.find((x) => String(x.id) === d.copyKey); try { await navigator.clipboard.writeText(o.license_key || ''); toast('License key copied.'); } catch (err) { modal('License key', '<p class="key">' + esc(o.license_key) + '</p>'); } }
    if (d.revoke) {
      const dev = S.devices.find((x) => String(x.id) === d.revoke);
      const ok = await window.hub.confirm({ title: 'Remove device', ok: 'Remove', message: 'Remove "' + (dev && (dev.device_name || dev.device_id)) + '"? The app on that computer will stop validating and its slot is freed.' });
      if (!ok) return;
      b.disabled = true; b.textContent = 'Removing';
      const { error } = await sb.rpc('revoke_device', { p_device_activation_id: Number(d.revoke) });
      if (error) { b.disabled = false; b.textContent = 'Remove'; toast('Could not remove it: ' + error.message, true); return; }
      const again = await sb.from('device_activations').select('id, license_id, device_name, device_id, first_seen, last_seen, revoked_at').is('revoked_at', null).order('last_seen', { ascending: false });
      S.devices = again.data || []; toast('Device removed.'); render();
    }
    if (d.receipt) {
      const o = S.owned.find((x) => String(x.id) === d.receipt); const app = byId(o.app) || { name: o.app };
      modal(app.name + ' · Receipt',
        '<dl class="dl"><dt>Item</dt><dd>' + esc(app.name) + (app.kind === 'plugin' ? ' (plug-in)' : '') + '</dd>' +
        '<dt>Date</dt><dd>' + esc(when(o.purchased_at)) + '</dd>' +
        '<dt>Amount</dt><dd>' + esc(money(o.amount_cents, o.currency)) + '</dd>' +
        '<dt>Account</dt><dd>' + esc(S.session.user.email) + '</dd>' +
        (o.stripe_session_id ? '<dt>Order</dt><dd style="font-family:ui-monospace,monospace;font-size:12px;word-break:break-all">' + esc(o.stripe_session_id) + '</dd>' : '') +
        '<dt>License</dt><dd>' + esc(o.max_devices) + ' devices' + (o.update_eligible_until && o.update_eligible_until.slice(0, 4) > '9000' ? ', updates included' : o.update_eligible_until ? ', updates until ' + esc(when(o.update_eligible_until)) : '') + '</dd></dl>' +
        (o.amount_cents ? '<p style="margin-top:16px">The card receipt itself was emailed by Stripe at the time of purchase. For an invoice, contact the studio.</p>' : '<p style="margin-top:16px">Free apps carry a real license in your account, so they can be reinstalled anywhere you sign in.</p>'));
    }
  });
  $('#search').addEventListener('input', render);
  $('#sync').addEventListener('click', () => refresh(false));
  $('#dialog').addEventListener('click', (e) => { if (e.target === $('#dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });

  /* ---------- boot ---------- */
  async function boot() {
    $('#version').textContent = window.hub.version ? 'v' + window.hub.version : '';
    $('#foot-right').textContent = 'Hub ' + (window.hub.version || '') + ' · ' + (window.hub.platform === 'windows' ? 'Windows' : window.hub.platform === 'mac' ? 'macOS' : 'Linux');
    try { S.device = await window.hub.device(); } catch (e) {}
    $('#device-chip').textContent = 'This device: ' + S.device.os + ' · ' + (S.device.arch === 'arm64' ? 'Apple Silicon' : S.device.arch === 'x64' ? '64-bit' : S.device.arch);

    /* Once per launch, after the device is known and before anything
       else needs the network. Not awaited: the window opens whether or
       not this gets through, and it does not wait on a sign-in either -
       a Hub that is running is a Hub that is running. */
    sayHello();

    let entering = false;
    async function signedIn(session) {
      if (entering) return; entering = true;
      S.session = session;
      $('#loading').classList.remove('hidden'); $('#auth').classList.add('hidden');
      try { await refresh(true); enter(); } finally { entering = false; }
    }
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') { if (session) signedIn(session); else showApp(false); }
      else if (event === 'SIGNED_IN') { if (!S.session) signedIn(session); else S.session = session; }
      else if (event === 'SIGNED_OUT') { S.session = null; showApp(false); }
      else if (session) S.session = session;
    });
  }
  boot();
})();
