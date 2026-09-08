/* =====================================================================
   Getting an app.

   There is one way in now, and it is the same way twice: an account,
   then the Hub. Nothing on this site hands over an installer any more.

     not signed in   ->  create an account (or sign in), come back here
     signed in       ->  the app is added to the library, and the Hub
                         installs it - along with every other app the
                         account owns, and every update after this one

   What this replaces is the email gate: an address in, a verification
   letter out, a five-minute link back. That traded a download for an
   address, which was worth doing when a download was all there was.
   It is not any more. An account is the same ask made once, and it
   carries the license, the devices and the receipts with it - so the
   second app costs nobody a second letter.

   Any link carrying data-dl or data-get opens this. data-dl is the old
   attribute, kept so a page that has not been rewritten still lands
   here rather than falling through to a dead href.
   ===================================================================== */
(function () {
  var SUPABASE_URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';

  var links = document.querySelectorAll('[data-dl], [data-get]');
  if (!links.length) return;

  var FREE = ['pulseroom', 'nebulatide'];
  var NAMES = { pulseroom: 'PulseRoom', nebulatide: 'Nebula Tide', secondout: 'SecondOut' };
  var app = (document.body.getAttribute('data-app') || '').toLowerCase();
  var here = location.pathname + location.search;
  var name = NAMES[app] || 'this app';

  /* supabase-js is loaded by a deferred tag that may come after this
     one; the client is made on the first click, by which time every
     deferred script on the page has run. */
  var sb = null;
  function client() {
    if (!sb && window.supabase) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return sb;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- the panel -----------------------------------------------------
  var el = document.createElement('div');
  el.className = 'dlg';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'dlg-h');
  el.hidden = true;
  el.innerHTML =
    '<div class="dlg-back" data-close></div>' +
    '<div class="dlg-box">' +
      '<button class="dlg-x" type="button" data-close aria-label="Close">&times;</button>' +
      '<p class="dlg-eyebrow" id="dlg-app"></p>' +
      '<h2 id="dlg-h">Getting ' + esc(name) + '</h2>' +
      '<p class="dlg-sub" id="dlg-sub">One moment&hellip;</p>' +
      '<div id="dlg-actions"></div>' +
      '<p class="dlg-msg" role="status"></p>' +
    '</div>';
  document.body.appendChild(el);

  var box = el.querySelector('.dlg-box');
  var head = el.querySelector('#dlg-h');
  var sub = el.querySelector('#dlg-sub');
  var actions = el.querySelector('#dlg-actions');
  var appEl = el.querySelector('#dlg-app');
  var msg = el.querySelector('.dlg-msg');
  var lastFocus = null;

  function say(text, bad) {
    msg.textContent = text || '';
    msg.className = 'dlg-msg' + (bad ? ' bad' : '');
  }
  function open() {
    lastFocus = document.activeElement;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var f = box.querySelector('.dlg-go, .dlg-link, .dlg-x');
      if (f) f.focus();
    }, 30);
  }
  function close() {
    el.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  el.addEventListener('click', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-close')) close();
  });
  document.addEventListener('keydown', function (e) {
    if (el.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      var f = box.querySelectorAll('button, input, [href]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---- the two states ------------------------------------------------
  function signedOut() {
    appEl.textContent = 'FREE ACCOUNT';
    head.textContent = 'Create your account';
    sub.innerHTML = esc(name) + ' lives in your account, not in a link that expires. ' +
      'Create one &mdash; it takes a moment, and it is free &mdash; and ' + esc(name) +
      ' is yours to install, on this computer and the next one.';
    var next = encodeURIComponent(here);
    actions.innerHTML =
      '<a class="cta dlg-go" href="/client.html?mode=signup&next=' + next + '">Create my free account</a>' +
      '<p class="dlg-again"><span>Already have one?</span> ' +
      '<a class="dlg-link" href="/client.html?next=' + next + '">Sign in</a></p>';
  }

  /* supabase-js did not load - an ad blocker, a dropped CDN, a train
     tunnel. Rather than guess wrong at somebody who is already signed
     in, offer both doors and say why. */
  function unknown() {
    appEl.textContent = 'FREE ACCOUNT';
    head.textContent = 'Two steps, once';
    sub.innerHTML = esc(name) + ' installs from the <b>Amanorsac Hub</b>, and the Hub ' +
      'signs in with your amanorsac.studio account. If you already have one, go straight to the Hub.';
    var next = encodeURIComponent(here);
    actions.innerHTML =
      '<a class="cta dlg-go" href="/hub.html">Get the Hub &mdash; free</a>' +
      '<p class="dlg-again"><span>No account yet?</span> ' +
      '<a class="dlg-link" href="/client.html?mode=signup&next=' + next + '">Create one free</a></p>';
  }

  function signedIn(claimed) {
    appEl.textContent = claimed ? 'IN YOUR LIBRARY' : 'YOUR LIBRARY';
    head.textContent = claimed ? esc(name) + ' is yours.' : 'Install it from the Hub';
    sub.innerHTML = 'Install it from the <b>Amanorsac Hub</b> &mdash; the free desktop app that ' +
      'keeps everything you own in one window, installs it, and tells you when there is an update. ' +
      'Windows and macOS.';
    actions.innerHTML =
      '<a class="cta dlg-go" href="/hub.html">Get the Hub &mdash; free</a>' +
      '<p class="dlg-again"><span>Already have the Hub?</span> ' +
      '<a class="dlg-link" href="/my-apps.html">Open it and sync your library</a></p>';
  }

  // ---- what a click does ---------------------------------------------
  function start() {
    appEl.textContent = '';
    head.textContent = 'Getting ' + name;
    sub.textContent = 'One moment…';
    actions.innerHTML = '';
    say('');
    open();

    var c = client();
    if (!c) { unknown(); return; }

    c.auth.getSession().then(function (s) {
      var session = s && s.data && s.data.session;
      if (!session) { signedOut(); return; }

      // A free app joins the library on the spot; the Hub finds it there.
      if (FREE.indexOf(app) === -1) { signedIn(false); return; }
      c.rpc('claim_license', { p_app: app }).then(function (r) {
        signedIn(true);
        if (r && r.error) say('Your library could not be updated just now: ' + r.error.message +
          ' The Hub will pick it up on its next sync.', true);
        if (window.track) window.track('library_claim', app);
      }, function () { signedIn(true); });
    }).catch(function () { unknown(); });
  }

  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (e) {
      e.preventDefault();
      start();
      if (window.track) window.track('get_app', app);
    });
  }
})();
