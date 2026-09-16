/* =====================================================================
   Buying an app - and, once bought, downloading it.

   Any button carrying data-buy opens the purchase flow for the app
   named in data-app on <body> - same convention as app-reviews.js and
   hub-download.js. Three things can be true when a button is clicked,
   checked fresh each time because a signed-in state can change in
   another tab since the page loaded:

     not signed in                -> off to sign in or create an
                                      account, coming straight back here
     signed in, does not own it   -> a checkout. Two are wired up:
                                      Stripe, and Paystack for mobile
                                      money and local cards. Which one
                                      leads is /api/pay-options' answer,
                                      from the country Cloudflare put on
                                      the request. Where Paystack's
                                      rails reach it leads and the card
                                      is the second door; everywhere
                                      else there is only the card
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

  /* What the main button says. When Paystack leads, it says the local
     figure - a Ghanaian buyer should see cedis on the button, not a
     dollar price that turns into cedis on the next screen. */
  function buyLabel(discount) {
    var usePaystack = pay && pay.first === 'paystack' && pay.paystack;
    if (discount) {
      var d = usePaystack && discount.paystack ? discount.paystack : discount.usd;
      if (d) return 'Buy \u2014 ' + d.display;
    }
    if (usePaystack) {
      return pay.paystack.choose ? 'Name your price \u00b7 ' + pay.paystack.display
                                 : 'Buy \u2014 ' + pay.paystack.display;
    }
    return PRICES[app] || 'Buy';
  }
  function showBuy() { setButtons(buyLabel(), false); renderAlt(); renderCode(); }

  function render() {
    return Promise.all([checkOnSale(), loadPayOptions()]).then(function (both) {
      var sale = both[0];
      return sb.auth.getSession().then(function (s) {
        var signedIn = !!(s && s.data && s.data.session);
        if (signedIn) {
          return checkAccess().then(function (owns) {
            if (owns) return showOwned(false);          // owners always get their door
            if (!sale) return showComingSoon();
            showBuy();
          });
        }
        if (!sale) return showComingSoon();
        showBuy();
      });
    });
  }

  /* Where this connection is, and therefore which checkout to put
     first and what Paystack would charge. Answered at the edge from
     the country Cloudflare already knows - no lookup service, no
     permission prompt, nothing a blocker can break. If it does not
     answer, Stripe leads and nothing is lost. */
  var pay = null;
  function loadPayOptions() {
    return fetch('/api/pay-options?app=' + encodeURIComponent(app), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { pay = j; return j; })
      .catch(function () { return null; });
  }

  /* The second door, under the button. Drawn only when there is one:
     an app that is free, or a site with Paystack switched off, gets
     nothing here and the markup is untouched. */
  function renderAlt() {
    var slot = document.querySelector('[data-pay-alt]');
    if (!slot) return;

    /* Mobile money over WhatsApp. A LINK, never a button: every other
       control in this row starts a checkout, and this one leaves the
       site for a conversation. Making it look like the others would be
       the lie - somebody would press it expecting a card form and get a
       chat window.

       It says what actually happens, because it is a slower road than
       it looks and a buyer who thinks a message is a purchase is a
       buyer who waits all evening for an app that is not coming. */
    var waHtml = '';
    if (pay && pay.whatsapp && pay.whatsapp.url) {
      var w = pay.whatsapp;
      waHtml =
        '<a class="pay-wa" href="' + esc(w.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">' +
          '<path d="M8 1.5a6.4 6.4 0 0 0-5.5 9.7L1.6 14.5l3.4-.9A6.4 6.4 0 1 0 8 1.5Zm0 1.3a5.1 5.1 0 1 1-2.7 9.4l-.2-.1-2 .5.5-2-.1-.2A5.1 5.1 0 0 1 8 2.8Zm-2.2 2.6c-.1 0-.3 0-.4.2-.2.2-.6.6-.6 1.4 0 .8.6 1.6.7 1.7.1.1 1.2 1.9 3 2.6 1.5.6 1.8.5 2.1.4.3 0 1-.4 1.1-.8.1-.4.1-.7.1-.8l-.4-.2-1-.5c-.1 0-.2-.1-.3.1l-.5.5c-.1.1-.2.1-.3.1-.2-.1-.8-.3-1.4-.9-.5-.5-.9-1-1-1.2 0-.2 0-.3.1-.3l.3-.3.1-.3v-.3l-.4-1c-.1-.3-.2-.3-.3-.3h-.9Z"/></svg>' +
          esc(w.label) +
        '</a>' +
        (w.note ? '<span class="pay-alt-note">' + esc(w.note) + '</span>' : '') +
        '<span class="pay-alt-note">Not an instant checkout: you message the studio, send the money, ' +
        'and a code comes back that unlocks it in My&nbsp;Apps.</span>';
    }

    if (!pay || !pay.paystack || (pay.offer || []).indexOf('paystack') < 0) {
      /* No Paystack here, but WhatsApp may still be on - which is the
         whole situation while Paystack is switched off. */
      slot.innerHTML = waHtml;
      slot.hidden = !waHtml;
      return;
    }
    var ps = pay.paystack;
    /* Every one of these pages writes its price into the prose in
       dollars. When the button is in cedis, say which is which rather
       than leaving the buyer to work out why two figures disagree. */
    var fx = '<span class="pay-alt-fx">' + esc(ps.display) + ' is ' + esc(ps.usd_display) +
             ' at today\u2019s rate.</span>';
    slot.innerHTML = pay.first === 'paystack'
      ? fx +
        '<button type="button" class="pay-alt" data-pay="stripe">Pay by card instead</button>' +
        '<span class="pay-alt-note">Visa, Mastercard, Apple&nbsp;Pay \u00b7 charged in US dollars</span>'
      : '<button type="button" class="pay-alt" data-pay="paystack">Pay with mobile money \u2014 ' +
        esc(ps.display) + '</button>' +
        '<span class="pay-alt-note">' + esc(ps.note) + '</span>';
    slot.innerHTML += waHtml;
    slot.hidden = false;
  }

  /* ---------- a discount code ----------

     The box is drawn only for an app that has a price. What a code is
     worth is answered by /api/check-code, which works it out from the
     catalog and the code's own row - this file never does the
     arithmetic, and the checkout works it out again before charging, so
     a figure edited in a console changes what is shown and nothing
     else. Checking does not spend it; the webhook does that when the
     money lands. */
  var code = null;                 // the code, once it has been accepted

  function renderCode() {
    var slot = document.querySelector('[data-code-box]');
    if (!slot) return;
    /* Drawn once. Every redraw of the buy button used to come through
       here and wipe the box - which took the message with it, so a
       refused code said nothing at all, and closed the form somebody
       was still typing in. */
    if (slot.firstChild) return;
    slot.innerHTML =
      '<button type="button" class="code-open" data-code-open>Have a code?</button>' +
      '<span class="code-form" hidden>' +
        '<input type="text" class="code-in" data-code-input placeholder="AMAN-XXXX-XXXX-XXXX" ' +
               'autocomplete="off" spellcheck="false" aria-label="Discount code">' +
        '<button type="button" class="code-go" data-code-go>Apply</button>' +
      '</span>' +
      '<span class="code-say" data-code-say></span>';
    slot.hidden = false;
  }

  function codeSay(text, bad) {
    var el = document.querySelector('[data-code-say]');
    if (!el) return;
    el.innerHTML = text || '';
    el.className = 'code-say' + (bad ? ' bad' : '') + (text ? ' on' : '');
  }

  function applyCode(typed) {
    var clean = String(typed || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (clean.length < 6) { codeSay('That does not look like a code.', true); return; }
    codeSay('Checking\u2026');
    sb.auth.getSession().then(function (s) {
      var session = s && s.data && s.data.session;
      if (!session) { codeSay('Sign in first, then the code can be checked against your account.', true); return; }
      return fetch('/api/check-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({ app: app, code: clean })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok) {
            /* Put the button back to full price first, then say why -
               the other way round and the message is written and then
               painted over. */
            code = null;
            setButtons(buyLabel(), false);
            renderAlt();
            codeSay(CODE_WORDS[j && j.error] || 'That code could not be used.', true);
            return;
          }
          code = j.code;
          /* The button itself changes, because the price on it is the
             thing somebody is about to agree to. */
          /* The whole sentence, because the sale line above is still
             saying the pre-code price and is still right - the sale
             takes it to $12, the code takes $12 to $9.60. Saying only
             "20% off" leaves the reader to reconcile two figures. */
          var usePaystack = pay && pay.first === 'paystack' && pay.paystack;
          var m = (usePaystack && j.paystack) ? j.paystack : j.usd;
          codeSay('<b>' + esc(j.code) + '</b> applied \u2014 ' +
            (j.percent_off ? j.percent_off + '% off ' : '') + esc(m.was) +
            '. You pay <b>' + esc(m.display) + '</b>.');
          setButtons(buyLabel(j), false);
          renderAlt();
        })
        .catch(function () { codeSay('Could not check that just now. Try again in a moment.', true); });
    });
  }

  var CODE_WORDS = {
    sign_in:             'Sign in first, then the code can be checked against your account.',
    not_a_code:          'That does not look like a code.',
    no_such_code:        'No code like that. Codes never contain the letter O or the digit 0.',
    expired:             'That code has passed its date.',
    all_used:            'That code has been used as many times as it was meant to be.',
    already_used_by_you: 'You have already used that one.',
    wrong_app:           'That code is not for this app.',
    unavailable:         'Could not check that just now. Try again in a moment.'
  };

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-code-open]')) {
      var f = document.querySelector('.code-form');
      var o = document.querySelector('[data-code-open]');
      if (f) { f.hidden = false; o.hidden = true; f.querySelector('input').focus(); }
      return;
    }
    if (e.target.closest('[data-code-go]')) {
      var i = document.querySelector('[data-code-input]');
      if (i) applyCode(i.value);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-code-input]')) {
      e.preventDefault();
      applyCode(e.target.value);
    }
  });

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

  /* Two checkouts, one shape. Each function answers { url } and the
     browser goes there; neither is told what to charge - the price is
     read from the catalog on the server both times, so a button that
     has been edited in a console still produces a correct bill. */
  var FUNCTIONS = { stripe: 'create-app-checkout', paystack: 'create-app-paystack' };

  function startCheckout(session, how, amount) {
    var fn = FUNCTIONS[how] || FUNCTIONS.stripe;
    setButtons(how === 'paystack' ? 'Opening Paystack…' : 'Redirecting to checkout…', true);
    say('');
    return fetch(SUPABASE_URL + '/functions/v1/' + fn, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify(Object.assign({ app: app },
        amount ? { amount: amount } : null,
        code ? { code: code } : null))
    })
      .then(function (r) { return r.json().then(function (j) { return r.ok ? j : Promise.reject(j); }); })
      .then(function (j) {
        if (j.already_owned) { render(); return; }
        if (j.url) { location.href = j.url; return; }
        return Promise.reject(j);
      })
      .catch(function (j) {
        /* A code the checkout refused is the code box's news, not the
           buy button's - and the code is dropped so the next press is
           not the same refusal again. */
        if (j && j.code_error) {
          code = null;
          showBuy();
          codeSay(CODE_WORDS[j.code_error] || esc(j.error || ''), true);
          return;
        }
        showBuy();
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

  /* Naming your price, on Paystack.

     Stripe does this for us - its Checkout page has the box, and the
     bounds live on the Price - but Paystack is told a figure up front,
     so the box has to be here. It is asked for before the redirect
     rather than after, and the edge function clamps whatever arrives to
     the same minimum and ceiling anyway: this is a courtesy, not the
     rule. A button that says "name your price" and then charges a
     figure nobody named would be a small lie. */
  function askAmount() {
    var ps = pay && pay.paystack;
    if (!ps) return Promise.resolve(null);
    var min = ps.minimum || 0;
    return new Promise(function (done) {
      say('<span class="pwyw">' +
          '<label for="pwyw-amt">What would you like to pay?</label>' +
          '<span class="pwyw-in"><i>' + esc(ps.currency) + '</i>' +
          '<input id="pwyw-amt" type="number" inputmode="decimal" step="1" ' +
          'min="' + (min / 100) + '" value="' + (ps.amount / 100) + '"></span>' +
          '<button type="button" class="pay-alt" id="pwyw-go">Continue</button>' +
          '<small>Minimum ' + esc(ps.currency) + ' ' + (min / 100) + '.</small></span>');
      var input = document.getElementById('pwyw-amt');
      var goBtn = document.getElementById('pwyw-go');
      if (!input || !goBtn) return done(ps.amount);
      input.focus(); input.select();
      function submit() {
        var v = Math.round(parseFloat(input.value) * 100);
        if (!isFinite(v) || v < min) { input.value = (min / 100); input.focus(); return; }
        done(v);
      }
      goBtn.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    });
  }

  function go(how) {
    return sb.auth.getSession().then(function (s) {
      var session = s && s.data && s.data.session;
      if (!session) {
        location.href = '/client.html?next=' + encodeURIComponent(location.pathname);
        return;
      }
      var wantsAmount = how === 'paystack' && pay && pay.paystack && pay.paystack.choose;
      return (wantsAmount ? askAmount() : Promise.resolve(null))
        .then(function (amount) { return startCheckout(session, how, amount); });
    });
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.getAttribute('data-mode') === 'hub') return openInHub();
      if (b.getAttribute('data-mode') === 'soon') return;
      go((pay && pay.first) || 'stripe');
    });
  });

  /* The other door. Delegated, because it is drawn and redrawn as the
     answer arrives rather than being in the markup. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pay]');
    if (!b) return;
    e.preventDefault();
    go(b.getAttribute('data-pay'));
  });
})();
