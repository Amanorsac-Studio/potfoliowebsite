/* =====================================================================
   Buying an app - and, once bought, downloading it.

   Any button carrying data-buy opens the purchase flow for the app
   named in data-app on <body> - same convention as app-reviews.js and
   hub-download.js. Three things can be true when a button is clicked,
   checked fresh each time because a signed-in state can change in
   another tab since the page loaded:

     not signed in                -> off to sign in or create an
                                      account, coming straight back here
     signed in, does not own it   -> create-app-checkout hands back a
                                      Stripe Checkout URL to go to
     signed in, already owns it   -> the same button opens the app in
                                      Amanorsac Hub (amanorsac://), which
                                      installs it; the note underneath
                                      offers the Hub itself to anyone who
                                      hasn't got it yet

   This script never decides who owns what - has_app_access() on the
   database does, checked on load and again after returning from Stripe;
   the Hub's own download goes through /api/app-download, which checks
   once more with the account's token. A button's on-screen text is not
   proof of anything.
   ===================================================================== */
(function () {
  var SUPABASE_URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();
  var buttons = document.querySelectorAll('[data-buy]');
  if (!app || !buttons.length) return;

  var sb = window.amanorsacClient ? window.amanorsacClient()
                                  : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  var statusEl = document.querySelector('[data-buy-status]');

  var APP_NAMES = { secondout: 'SecondOut', stemsorter: 'Stem Sorter', nebulatide2: 'Nebula Tide 2',
                    ambanalog: 'AMB Analog', aether: 'AETHER', afdgate: 'AFD Gate',
                    alignpro: 'Align Pro', chordlight88: 'Chordlight 88' };
  var PRICES = { secondout: 'Buy — $19', stemsorter: 'Buy — $19', nebulatide2: 'Name your price',
                 ambanalog: 'Buy — $39', aether: 'Buy — $12', afdgate: 'Buy — $12',
                 alignpro: 'Buy — $39', chordlight88: 'Buy — $14' };
  var HUB_PROTOCOL = 'amanorsac';
  var OWNED_LABEL = 'Install in Amanorsac Hub';
  function labelFor(a) { return APP_NAMES[a] || (a.charAt(0).toUpperCase() + a.slice(1)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function say(html, bad) {
    if (!statusEl) return;
    statusEl.innerHTML = html;
    statusEl.className = 'buy-status' + (bad ? ' bad' : '');
    statusEl.hidden = !html;
  }
  function setButtons(text, disabled, mode) {
    buttons.forEach(function (b) {
      b.textContent = text; b.disabled = !!disabled;
      b.setAttribute('data-mode', mode || 'buy');
    });
  }

  function checkAccess() {
    return sb.rpc('has_app_access', { p_app: app })
      .then(function (r) { return !!(r && r.data); })
      .catch(function () { return false; });
  }

  function hubDownloadUrl() {
    var p = (window.AmanorsacHub && window.AmanorsacHub.platform()) || 'windows';
    return '/download/hub/' + p;
  }
  var OWNED_NOTE = 'You own ' + esc(labelFor(app)) + '. Install it through Amanorsac Hub — ' +
    'don’t have the Hub yet? <a href="' + esc(hubDownloadUrl()) + '">Download it</a>. ' +
    'Your license key is in <a href="/my-apps.html">My Apps</a>.';

  function showOwned(thanks) {
    setButtons(OWNED_LABEL, false, 'hub');
    say((thanks ? 'Thank you — you’re in. ' : '') + OWNED_NOTE);
  }

  /* An app can be on sale on a preview build and not yet in public -
     see assets/store-state.js. A page that is not on sale here keeps
     its price on the button but cannot start a checkout. */
  var onSale = true;
  function checkOnSale() {
    if (!window.StoreState) return Promise.resolve(true);
    return window.StoreState.state(app).then(function (st) {
      onSale = (st === null || st === 'available');
      return onSale;
    }).catch(function () { return true; });
  }

  function showComingSoon() {
    setButtons('Coming soon', true, 'soon');
    say('Not on sale yet. Make an account and ' + esc(labelFor(app)) +
        ' lands in <a href="/my-apps.html">My Apps</a> the day it does.');
  }

  function render() {
    return checkOnSale().then(function (sale) {
      return sb.auth.getSession().then(function (s) {
        var signedIn = !!(s && s.data && s.data.session);
        if (signedIn) {
          return checkAccess().then(function (owns) {
            if (owns) return showOwned(false);          // owners always get their door
            if (!sale) return showComingSoon();
            setButtons(PRICES[app] || 'Buy', false);
          });
        }
        if (!sale) return showComingSoon();
        setButtons(PRICES[app] || 'Buy', false);
      });
    });
  }

  var params = new URLSearchParams(location.search);

  if (params.get('purchased') === '1') {
    say('Confirming your purchase…');
    history.replaceState(null, '', location.pathname);
    // The webhook usually lands well before this redirect completes;
    // a few retries covers the rare case it has not yet.
    var tries = 0;
    (function poll() {
      checkAccess().then(function (owns) {
        if (owns) {
          showOwned(true);
        } else if (tries++ < 5) {
          setTimeout(poll, 1500);
        } else {
          say('Payment received — still confirming on our end. Refresh in a minute, or contact the studio if this sticks around.', true);
        }
      });
    })();
  } else if (params.get('checkout') === 'cancelled') {
    history.replaceState(null, '', location.pathname);
    say('Checkout cancelled — nothing was charged.', true);
    render();
  } else {
    render();
  }

  function startCheckout(session) {
    setButtons('Redirecting to checkout…', true);
    say('');
    return fetch(SUPABASE_URL + '/functions/v1/create-app-checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({ app: app })
    })
      .then(function (r) { return r.json().then(function (j) { return r.ok ? j : Promise.reject(j); }); })
      .then(function (j) {
        if (j.already_owned) { render(); return; }
        if (j.url) { location.href = j.url; return; }
        return Promise.reject(j);
      })
      .catch(function (j) {
        setButtons(PRICES[app] || 'Buy', false);
        say(esc((j && j.error) || 'Could not start checkout. Try again in a moment.'), true);
      });
  }

  /* The protocol link opens the Hub when it is installed and does
     nothing visible when it isn't, so the note says which just happened
     and where the Hub is. */
  function openInHub() {
    if (window.track) window.track('hub_open', app);
    say('Opening ' + esc(labelFor(app)) + ' in Amanorsac Hub… Nothing happened? You don’t have the Hub yet — ' +
        '<a href="' + esc(hubDownloadUrl()) + '">download it</a>, sign in with this account, and ' +
        esc(labelFor(app)) + ' is waiting inside.');
    if (window.AmanorsacHub) window.AmanorsacHub.openInHub(app);
    else location.href = HUB_PROTOCOL + '://install/' + encodeURIComponent(app);
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      sb.auth.getSession().then(function (s) {
        var session = s && s.data && s.data.session;
        if (!session) {
          location.href = '/client.html?next=' + encodeURIComponent(location.pathname);
          return;
        }
        if (b.getAttribute('data-mode') === 'hub') return openInHub();
        if (b.getAttribute('data-mode') === 'soon') return;
        return startCheckout(session);
      });
    });
  });
})();
