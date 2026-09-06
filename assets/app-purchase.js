/* =====================================================================
   Buying an app.

   Any button carrying data-buy opens the purchase flow for the app
   named in data-app on <body> — same convention as app-reviews.js and
   download-gate.js. Three things can be true when a button is clicked,
   checked fresh each time because a signed-in state can change in
   another tab since the page loaded:

     not signed in                -> off to sign in or create an
                                      account, coming straight back here
     signed in, already owns it   -> nothing to sell; the button
                                      already reflects that on load
     signed in, does not own it   -> create-app-checkout hands back a
                                      Stripe Checkout URL to go to

   This script never decides who owns what — has_app_access() on the
   database does, checked on load and again after returning from
   Stripe. A button's on-screen text is not proof of anything.
   ===================================================================== */
(function () {
  var SUPABASE_URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();
  var buttons = document.querySelectorAll('[data-buy]');
  if (!app || !buttons.length) return;

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  var statusEl = document.querySelector('[data-buy-status]');

  function say(text, bad) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'buy-status' + (bad ? ' bad' : '');
    statusEl.hidden = !text;
  }

  function setButtons(text, disabled) {
    buttons.forEach(function (b) { b.textContent = text; b.disabled = !!disabled; });
  }

  function hideButtons() {
    buttons.forEach(function (b) { b.hidden = true; });
  }

  function checkAccess() {
    return sb.rpc('has_app_access', { p_app: app })
      .then(function (r) { return !!(r && r.data); })
      .catch(function () { return false; });
  }

  function render() {
    return sb.auth.getSession().then(function (s) {
      var signedIn = !!(s && s.data && s.data.session);
      if (!signedIn) { setButtons('Buy — $19', false); return; }
      return checkAccess().then(function (owns) {
        if (owns) {
          hideButtons();
          say("You're in — " + labelFor(app) + " is still being built. I'll email you the moment it's ready to download.");
        } else {
          setButtons('Buy — $19', false);
        }
      });
    });
  }

  var APP_NAMES = { secondout: 'SecondOut' };
  function labelFor(a) {
    return APP_NAMES[a] || (a.charAt(0).toUpperCase() + a.slice(1));
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
          hideButtons();
          say("You're in! Thank you — " + labelFor(app) + " is still being built, and I'll email you the moment it's ready to download.");
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

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      sb.auth.getSession().then(function (s) {
        var session = s && s.data && s.data.session;
        if (!session) {
          location.href = '/client.html?next=' + encodeURIComponent(location.pathname);
          return;
        }
        setButtons('Redirecting to checkout…', true);
        say('');
        fetch(SUPABASE_URL + '/functions/v1/create-app-checkout', {
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
            setButtons('Buy — $19', false);
            say((j && j.error) || 'Could not start checkout. Try again in a moment.', true);
          });
      });
    });
  });
})();
