/* =====================================================================
   Who is signed in, on the public pages.

   The App Store and each app's page carry an element with
   data-auth-slot. Signed out, it holds a plain "Sign in" link that
   brings the visitor straight back to this page afterwards. Signed in,
   it becomes the account chip: initials, first name, and a menu with
   My Apps, Account and Sign out - the same three doors the portal has,
   reachable without leaving the page.

   Nothing here decides who owns what; it only shows who is here. The
   session is read from the same publishable key every other script on
   these pages uses, and Row Level Security decides everything else.
   ===================================================================== */
(function () {
  var SUPABASE_URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';
  var slots = document.querySelectorAll('[data-auth-slot]');
  if (!slots.length || !window.supabase) return;

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  var here = location.pathname + location.search;
  var SIGN_IN = '/client.html?next=' + encodeURIComponent(here);

  var I = {
    key:    '<svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L19 4m-4 1l2 2"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>',
    disc:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
    out:    '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    chev:   '<svg class="sa-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    arrow:  '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function firstName(name, email) {
    var n = String(name || '').trim();
    if (n) return n.split(/\s+/)[0];
    return String(email || '').split('@')[0];
  }

  function renderOut(slot) {
    slot.classList.add('sa');
    slot.innerHTML = '<a class="sa-in" href="' + esc(SIGN_IN) + '">' + I.person + '<span>Sign in</span></a>';
    slot.removeAttribute('data-open');
  }

  function renderIn(slot, user, profile) {
    var name = (profile && profile.full_name) || (user.user_metadata || {}).full_name || '';
    var email = user.email || '';
    var isAdmin = !!(profile && profile.is_admin);
    slot.classList.add('sa');
    slot.innerHTML =
      '<button class="sa-chip" type="button" aria-haspopup="menu" aria-expanded="false">' +
        '<span class="sa-av" aria-hidden="true">' + esc(initials(name || email)) + '</span>' +
        '<span class="sa-dot" aria-hidden="true"></span>' +
        '<span class="sa-name">' + esc(firstName(name, email)) + '</span>' + I.chev +
      '</button>' +
      '<div class="sa-menu" role="menu" hidden>' +
        '<div class="sa-who"><small>Signed in as</small><b>' + esc(name || email) + '</b></div>' +
        '<a class="sa-item" role="menuitem" href="/portal/my-apps.html">' + I.key + 'My Apps <span class="sa-k">keys</span></a>' +
        (isAdmin
          ? '<a class="sa-item" role="menuitem" href="/portal/admin.html">' + I.disc + 'Studio dashboard</a>'
          : '<a class="sa-item" role="menuitem" href="/portal/dashboard.html">' + I.disc + 'My projects</a>') +
        '<a class="sa-item" role="menuitem" href="/portal/account.html">' + I.person + 'Account</a>' +
        '<div class="sa-sep"></div>' +
        '<button class="sa-item quiet" role="menuitem" type="button" data-signout>' + I.out + 'Sign out</button>' +
      '</div>';

    var btn = slot.querySelector('.sa-chip'), menu = slot.querySelector('.sa-menu');
    function open(o) {
      menu.hidden = !o;
      btn.setAttribute('aria-expanded', String(o));
      if (o) slot.setAttribute('data-open', ''); else slot.removeAttribute('data-open');
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(menu.hidden); });
    document.addEventListener('click', function (e) { if (!slot.contains(e.target)) open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') open(false); });
    slot.querySelector('[data-signout]').addEventListener('click', function () {
      open(false);
      sb.auth.signOut().then(function () { render(null); });
    });
  }

  function render(session) {
    var user = session && session.user;
    document.documentElement.toggleAttribute('data-signed-in', !!user);
    var banners = document.querySelectorAll('[data-auth-banner]');
    if (!user) {
      slots.forEach(renderOut);
      banners.forEach(function (b) { b.classList.remove('sa-on'); });
      return;
    }
    // The profile carries the name the studio knows them by; a fresh
    // self-signup has it in user_metadata until the profile row exists.
    sb.from('profiles').select('full_name,is_admin').eq('id', user.id).maybeSingle()
      .then(function (r) { return (r && r.data) || null; }, function () { return null; })
      .then(function (profile) {
        slots.forEach(function (s) { renderIn(s, user, profile); });
        var name = firstName((profile && profile.full_name) || (user.user_metadata || {}).full_name, user.email);
        banners.forEach(function (b) {
          b.querySelectorAll('[data-auth-name]').forEach(function (n) { n.textContent = name; });
          b.classList.add('sa-on');
        });
      });
  }

  sb.auth.getSession().then(function (r) { render(r && r.data && r.data.session); });
  sb.auth.onAuthStateChange(function (_e, session) { render(session); });
})();
