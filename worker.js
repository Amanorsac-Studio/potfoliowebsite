/* =====================================================================
   The only code on this site that runs on a server.

   It answers two addresses and nothing else:

     /blog/<post>   a published post, assembled from the database and
                    post-template.html
     /sitemap.xml   the fixed pages plus every published post

   Everything else - every page, image, font and stylesheet - is handed
   straight back to Cloudflare's file server, which is what was serving
   the whole site before this file existed.

   Why assemble a post here rather than in the browser: a page put
   together by JavaScript reaches a search engine, and every link preview
   on every messaging app, as an empty shell. No title, no description,
   no picture. Those readers do not run scripts. Building the page before
   it is sent is what makes the Google result and the WhatsApp card real.

   The rule this file lives by: it must never be able to take the site
   down. Every path through it is wrapped, and anything unexpected ends
   with the request being served exactly as it would have been if this
   file were not here.

   The key below is the publishable one, the same key the public pages
   carry. It can only see published posts, because that is all the
   row-level policy on the table allows. Drafts are not filtered out
   here - they are unreachable with it.
   ===================================================================== */

const SUPABASE_URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';
const SITE = 'https://amanorsac.studio';

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const path = new URL(request.url).pathname;

        if (path === '/sitemap.xml') return await sitemap();

        /* The live page is gone. It was in the sitemap, so search engines
           were told it existed and some of them will keep asking; a
           permanent redirect to the room that covers the same work is a
           better answer than a 404 for anybody holding an old link. */
        if (path === '/live' || path === '/live.html') {
          return Response.redirect(SITE + '/mixing.html', 301);
        }

        /* The privacy policy, at exactly this address and no other.

           It is the URL handed to Apple and to Google Play, and a
           policy link that 404s when a reviewer opens it is a rejected
           app - so this one address is not left to a setting. The asset
           layer already maps /privacy to privacy.html and answers first,
           which means this line normally never runs; it is here so that
           the day html_handling changes, or the file is renamed, the one
           link that must never break still does not. */
        if (path === '/privacy' || path === '/privacy/') {
          const doc = await env.ASSETS.fetch(new Request(new URL('/privacy.html', request.url)));
          if (doc && doc.ok) {
            return new Response(doc.body, {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8',
                         'cache-control': 'public, max-age=600' }
            });
          }
        }

        const m = path.match(/^\/blog\/([^/]+)\/?$/);
        if (m) return await postPage(decodeURIComponent(m[1]), env, request,
                                     new URL(request.url).searchParams.has('diag'));

        // a ticketed installer. A bad or stale ticket falls through to
        // the 404 below, so there is nothing here to probe at.
        if (path === '/download/confirm') {
          const page = await confirmDownload(new URL(request.url), env);
          if (page) return page;
        }

        // The Hub itself: no ticket, no account. It is the front door,
        // and the account is made behind it.
        const h = path.match(/^\/download\/hub\/([a-z0-9-]+)$/);
        if (h) {
          const file = await serveHub(h[1], env, request);
          if (file) return file;
        }

        // What exists, for the Hub to draw its library from.
        if (path === '/api/catalog') return withCors(await catalogApi(env));

        // Which checkout this visitor should be shown, and for how much.
        if (path === '/api/pay-options') return withCors(await payOptions(request, env));

        // The stop link at the bottom of an update notice.
        if (path === '/notices/stop') return await noticeStop(new URL(request.url), env);

        const d = path.match(/^\/download\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
        if (d) {
          const file = await serveInstaller(d[1], d[2], new URL(request.url), env, request);
          if (file) return file;
        }
      }

      // Preflight for the two doors the Hub uses from a desktop app.
      if (request.method === 'OPTIONS') {
        const p = new URL(request.url).pathname;
        if (p === '/api/app-download' || p === '/api/catalog' || p === '/api/hub-ping' ||
            p === '/api/check-code') {
          return withCors(new Response(null, { status: 204 }));
        }
      }

      if (request.method === 'POST' && new URL(request.url).pathname === '/api/download') {
        return await handoutDownload(request, env);
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/review') {
        return await submitReview(request, env);
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/app-download') {
        return withCors(await appDownload(request, env, ctx));
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/hub-ping') {
        return withCors(await hubPing(request, env, ctx));
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/check-code') {
        return withCors(await checkCode(request, env));
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/licenses/activate') {
        return await licenseActivate(request, env);
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/licenses/deactivate') {
        return await licenseDeactivate(request, env);
      }
    } catch (e) {
      // fall through: a broken blog is not a reason for a broken site
    }

    /* Everything else is a file, or is nothing. The asset layer is no
       longer allowed to answer for "nothing" - that setting is what kept
       this Worker from ever running - so the 404 page is served here
       instead, with the status to match. */
    try {
      const res = await env.ASSETS.fetch(request);
      if (res && res.status === 404) return await notFound(env, request);
      return res;
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  },

  /* Once a day. Cloudflare's own clock, not a request - nobody is
     waiting on this, so a slow run costs nothing but does not need to
     be fast either. See sendReviewInvites for what it actually does. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReviewInvites(env));
    ctx.waitUntil(sendUpdateNotices(env));
  }
};


/* ---------------------------------------------------------------------
   handing out an installer

   Two halves, on purpose.

   POST /api/download   an email goes in, the person is recorded, and a
                        ticket comes back: a path with a signature on it,
                        good for fifteen minutes.
   GET  /download/...   checks the signature and streams the file out of
                        R2. Without a valid ticket it is a 404, so there
                        is no address to pass around and no way past the
                        form.

   It is split because these files are 78 MB and 171 MB. Sending one back
   as the answer to a form submission would mean holding it in memory
   before saving it; a normal GET hands it to the browser's own download
   manager, which shows progress and can resume.

   Nothing here holds a key to anything. The bucket arrives as a binding,
   and the mailing list is written through a function that can only
   write. The one secret is the string the ticket is signed with, and the
   worst it could do in the wrong hands is let somebody download a free
   app without leaving an address.
   --------------------------------------------------------------------- */

/* The same policy _headers puts on every file served off disk. Pages this
   Worker builds itself - a post, the confirm page, the 404 - never touch
   that file, so without this they would be the one set of pages on the
   site with no policy at all. Kept identical on purpose: two policies
   that drift apart are worse than one, because the weaker one is the one
   nobody remembers.

   Change one, change the other. */
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
  "script-src 'self' 'unsafe-inline' https://www.youtube.com " +
  "https://s.ytimg.com https://pagead2.googlesyndication.com https://tpc.googlesyndication.com " +
  "https://googleads.g.doubleclick.net https://adservice.google.com https://www.google.com " +
  "https://fundingchoicesmessages.google.com https://ep2.adtrafficquality.google; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; " +
  "media-src 'self' blob:; " +
  "connect-src 'self' https://kdxckigyhpnwhwgjdgqq.supabase.co " +
  "wss://kdxckigyhpnwhwgjdgqq.supabase.co https://formspree.io https://www.youtube.com " +
  "https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net " +
  "https://tpc.googlesyndication.com https://ep1.adtrafficquality.google " +
  "https://ep2.adtrafficquality.google https://csi.gstatic.com; " +
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://open.spotify.com " +
  "https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com " +
  "https://ep2.adtrafficquality.google; worker-src 'self' blob:; " +
  "form-action 'self' https://formspree.io; upgrade-insecure-requests";

/* Everything a page from here should carry. */
function pageHeaders(extra) {
  return Object.assign({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=31536000; includeSubDomains'
  }, extra || {});
}


/* What may be asked for lives in catalog.json - the one list every part
   of the site reads: the store pages, My Apps, Amanorsac Hub through
   /api/catalog, and this Worker. It is read through the ASSETS binding,
   the same file server the pages come from, and kept in memory for five
   minutes so no request waits on it twice in a row. Nothing about an
   installer is invented here: the catalog names the R2 object, the
   filename to hand out, its content type and whether the app is free.
   No amount of creativity in a request can name a file the catalog does
   not list. Adding an app is one entry there and one upload. */
let _catalog = null, _catalogAt = 0;
async function getCatalog(env) {
  if (_catalog && Date.now() - _catalogAt < 5 * 60 * 1000) return _catalog;
  try {
    const res = await env.ASSETS.fetch(new Request(SITE + '/catalog.json'));
    if (res && res.ok) { _catalog = await res.json(); _catalogAt = Date.now(); }
  } catch (e) { console.error('catalog.json could not be read:', e && e.message); }
  return _catalog || { hub: { installers: {} }, apps: {} };
}

const PLATFORM_LABEL = { windows: 'Windows', mac: 'Mac', 'mac-arm64': 'Mac (Apple silicon)',
                         'mac-x64': 'Mac (Intel)', 'mac-legacy': 'Mac (older macOS)',
                         android: 'Android', ios: 'iPhone & iPad' };

/* One app installer, in the shape the download code below has always used. */
function installerFor(catalog, app, platform) {
  const a = catalog.apps && catalog.apps[app];
  const i = a && a.installers && a.installers[platform];
  if (!i || !i.key) return null;
  return {
    keys: [i.key].concat(i.alt_keys || []),
    as: i.as || i.key.split('/').pop(),
    type: i.type || 'application/zip',
    title: a.name + ' for ' + (PLATFORM_LABEL[platform] || platform),
    version: a.version || null,
    paid: !a.free,
    email_gate: !!a.email_gate,   // the old address-for-a-link door; no app asks for it now
    dropbox: i.fallback_url || null
  };
}

/* The Hub's own installer. `mac` alone means Apple silicon: the better
   guess for any Mac sold since 2020, and the Intel link is always one
   line below on the page. */
function hubInstallerFor(catalog, platform) {
  const inst = (catalog.hub && catalog.hub.installers) || {};
  const p = platform === 'mac' ? 'mac-arm64' : platform;
  const i = inst[p];
  if (!i || !i.key) return null;
  return { keys: [i.key].concat(i.alt_keys || []), as: i.as || i.key.split('/').pop(),
           type: i.type || 'application/octet-stream',
           title: (catalog.hub.name || 'Amanorsac Hub') + ' for ' + (i.label || PLATFORM_LABEL[p] || p) };
}

/* Plain names for the review-invite email and error messages ("Nebula
   Tide", not "Nebula Tide for Windows"). */
function appTitle(catalog, app) {
  return (catalog.apps && catalog.apps[app] && catalog.apps[app].name) || app;
}

/* The Hub is a desktop app, not a page on this origin, so the two doors
   it uses answer cross-origin. Authentication is the bearer token, not
   the origin, so this widens nothing. */
function withCors(res) {
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-headers', 'authorization, content-type');
  h.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}

/* The only apps whose review form requires the signed link from the
   invite email. Add an app here once it has a real download history to
   ask about; nothing else changes - submitReview and sendReviewInvites
   both read this same list. */
const REVIEW_INVITE_APPS = ['nebulatide'];

/* Turn an ordinary Dropbox share link into one that hands over bytes
   instead of Dropbox's own preview page. dl=1 is the documented way to
   ask for that; anything already asking for it is left alone. */
function dropboxDirect(link) {
  const u = new URL(link);
  u.searchParams.set('dl', '1');
  return u.toString();
}

const TICKET_MINUTES = 15;

/* Deliberately loose. The job is to catch a typo and an empty box, not
   to adjudicate what a valid address is - every strict pattern ever
   written rejects somebody's real email. */
function looksLikeEmail(v) {
  return typeof v === 'string' && v.length <= 254 &&
         /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v.trim());
}

function b64url(bytes) {
  let s = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret, message) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

/* Compared a character at a time with no early exit, so how long the
   comparison takes says nothing about how much of the guess was right. */
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handoutDownload(request, env) {
  const say = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });

  /* A reader gets the same sentence either way. The studio, opening this
     with ?setup, is told which piece is missing - because "not set up
     yet" is true of all of them and useful for none. */
  const setup = new URL(request.url).searchParams.has('setup');
  const missing = [];
  if (!env.DOWNLOADS)       missing.push('the R2 bucket is not bound (wrangler.jsonc names it amanorsac-downloads)');
  if (!env.DOWNLOAD_SECRET) missing.push('DOWNLOAD_SECRET is not set as a secret on the Worker');
  if (!env.RESEND_API_KEY)  missing.push('RESEND_API_KEY is not set as a secret on the Worker');
  if (missing.length) {
    return say({ error: setup ? ('Missing: ' + missing.join('; ') + '.')
                              : 'Downloads are not set up yet.' }, 503);
  }

  let body = {};
  try { body = await request.json(); } catch (e) {}

  const email    = String(body.email || '').trim().toLowerCase();
  const app      = String(body.app || '').toLowerCase().slice(0, 40);
  const platform = String(body.platform || '').toLowerCase().slice(0, 20);
  const source   = String(body.source || '').slice(0, 200);

  if (!looksLikeEmail(email)) return say({ error: 'That does not look like an email address.' }, 400);
  if (!body.consent)          return say({ error: 'Please tick the box to continue.' }, 400);
  const catalog = await getCatalog(env);
  const item = installerFor(catalog, app, platform);
  if (!item) return say({ error: 'No such download.' }, 404);
  // Every download goes through Amanorsac Hub now. This door stays only
  // for an app whose catalog entry explicitly asks for the old
  // address-for-a-link gate (none does), and a bought app never had it.
  if (!item.email_gate || item.paid) {
    return say({ error: 'Downloads now go through Amanorsac Hub - get it free at ' + SITE + '/apps.html#access' }, 410);
  }

  /* Recorded now, but not yet confirmed. An address that never gets
     clicked stays in the list marked unconfirmed and is never written
     to - which is the point of doing it this way. */
  /* The download must never be blocked by bookkeeping, but bookkeeping
     that fails must at least say so: fetch only throws on network
     failure, and a missing database function answers 404, politely and
     invisibly. For a while that is exactly what happened - people were
     handed files with nothing written down. These land in the Worker's
     live logs. */
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/record_subscriber', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      body: JSON.stringify({ p_email: email, p_app: app, p_source: source, p_consent: true })
    });
    if (!r.ok) console.error('record_subscriber refused:', r.status, await r.text());
  } catch (e) { console.error('record_subscriber unreachable:', e && e.message); }

  /* The letter carries a signed link. Signed over the address as well as
     the file, so it opens the download for that person and nobody else,
     and cannot be edited into a link for the other app. A day to use it:
     long enough for someone who reads their email in the evening. */
  const expires = Date.now() + 24 * 60 * 60 * 1000;
  const claim = ['confirm', email, app, platform, expires].join(':');
  const sig = await sign(env.DOWNLOAD_SECRET, claim);
  const link = SITE + '/download/confirm?a=' + encodeURIComponent(app) +
               '&p=' + encodeURIComponent(platform) +
               '&m=' + encodeURIComponent(email) +
               '&x=' + expires + '&s=' + sig;

  const sent = await sendConfirmation(env, email, item, link);
  if (!sent) return say({ error: 'The confirmation email would not send. Try again shortly.' }, 502);

  return say({ sent: true, email: email });
}

/* The letter. Plain, short, and it says what it is for in the first line,
   because a message that buries its purpose reads like a trap. */
async function sendConfirmation(env, email, item, link) {
  const text =
    'Confirm your email to download ' + item.title + '.\n\n' +
    link + '\n\n' +
    'The link works for 24 hours. If you did not ask for this, ignore it - ' +
    'nothing is sent to an address that is never confirmed.\n\n' +
    'Amanorsac Studio\n' + SITE + '\n';

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;' +
    'line-height:1.6;color:#1C1916;max-width:520px">' +
    '<p style="margin:0 0 18px">Confirm your email and your download of <b>' +
      esc(item.title) + '</b> starts.</p>' +
    '<p style="margin:0 0 22px"><a href="' + esc(link) + '" ' +
      'style="display:inline-block;background:#1C1916;color:#fff;text-decoration:none;' +
      'padding:13px 22px;border-radius:9px;font-weight:600">Confirm and download</a></p>' +
    '<p style="margin:0 0 18px;color:#6B655C;font-size:14px">' +
      'The link works for 24 hours. If you did not ask for this, ignore it &mdash; ' +
      'nothing is ever sent to an address that is not confirmed.</p>' +
    '<p style="margin:0;color:#6B655C;font-size:13px">Amanorsac Studio &middot; ' +
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a></p></div>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 Authorization: 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || 'Amanorsac Studio <hello@amanorsac.studio>',
        to: [email],
        subject: 'Confirm your email to download ' + item.title,
        text: text, html: html
      })
    });
    return r.ok;
  } catch (e) { return false; }
}

/* The link in the letter. Checks the signature, marks the address
   confirmed, and hands over a short ticket for the file itself - so the
   long-lived link in an inbox is only ever an introduction, never the
   file. */
async function confirmDownload(url, env) {
  if (!env.DOWNLOAD_SECRET) return null;

  const app = (url.searchParams.get('a') || '').toLowerCase();
  const platform = (url.searchParams.get('p') || '').toLowerCase();
  const email = (url.searchParams.get('m') || '').toLowerCase();
  const expires = parseInt(url.searchParams.get('x') || '0', 10);
  const sig = url.searchParams.get('s') || '';

  const catalog = await getCatalog(env);
  const item = installerFor(catalog, app, platform);
  if (!item || !expires) return confirmPage('That link is not one of ours.', null, null);
  if (!item.email_gate) {
    return confirmPage('Downloads have moved to Amanorsac Hub.',
      'Every app now installs through the free Amanorsac Hub. Get it from the App Store page, ' +
      'sign in with the same email, and your download is waiting inside.', null, 410);
  }
  if (Date.now() > expires) {
    return confirmPage('That link has expired.',
      'Links last a day. Ask for the download again and a fresh one is on its way.', null);
  }
  const want = await sign(env.DOWNLOAD_SECRET, ['confirm', email, app, platform, expires].join(':'));
  if (!sameString(sig, want)) return confirmPage('That link is not one of ours.', null, null);

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/confirm_subscriber', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      body: JSON.stringify({ p_email: email, p_app: app, p_platform: platform })
    });
    // the download proceeds either way; the loss is only the record of it
    if (!r.ok) console.error('confirm_subscriber refused:', r.status, await r.text());
  } catch (e) { console.error('confirm_subscriber unreachable:', e && e.message); }

  const t = Date.now() + TICKET_MINUTES * 60 * 1000;
  const path = '/download/' + app + '/' + platform;
  const ticket = path + '?e=' + t + '&s=' + (await sign(env.DOWNLOAD_SECRET, path + ':' + t));
  return confirmPage('Thank you — that’s confirmed.',
    item.title + ' is downloading now. If nothing happens, use the button.', ticket);
}

/* A bought app is handed over on proof of ownership, not on an email
   address. My Apps, or the app's own page, sends the signed-in visitor's
   Supabase token; the database answers has_app_access() AS THAT USER -
   Row Level Security decides, the Worker only relays - and a fifteen-
   minute ticket for the file comes back. It is the same ticket the email
   gate mints, so serveInstaller neither knows nor cares which door
   somebody came through. Free apps can take this door too once claimed
   in My Apps; the email gate stays open for visitors who never sign in. */
/* ---------------------------------------------------------------------
   POST /api/hub-ping   -   a Hub saying hello when it starts.

   One row per installation: an id the Hub makes for itself on first run
   and keeps, its version, its platform. It identifies a copy of the
   software, not a person - two people sharing a computer are one row,
   and the same person on two machines is two. Signing in attaches the
   account, which is the only reason an account is mentioned at all.

   What it deliberately does not carry: no machine fingerprint, no list
   of what is installed, no record of which app was opened or when, no
   IP address. Country is Cloudflare's two-letter code, taken from the
   connection the request arrived on and never from anything the Hub
   sends. This has to stay true of it - the privacy policy says the
   studio collects what it needs to run the shop, and a heartbeat that
   grew into a usage log would make that sentence false.

   Unauthenticated on purpose: a Hub that nobody has signed into yet is
   exactly the installation worth knowing about. That means the install
   id is self-asserted and somebody could invent installations with a
   curl loop. The answer to that is that this number is a count of
   copies for the studio's own planning, not something anyone is paid
   on, and the cost of getting it wrong is a wrong graph. Nothing is
   granted, unlocked or sold by it.
   --------------------------------------------------------------------- */
async function hubPing(request, env, ctx) {
  const ok = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (!env.SUPABASE_SERVICE_KEY) return ok;

  let body = {};
  try { body = await request.json(); } catch (e) { return ok; }

  const clean = (v, n) => {
    const t = String(v == null ? '' : v).slice(0, n);
    return /^[\w .+-]*$/.test(t) ? t : '';
  };
  const install = clean(body.install_id, 64);
  if (install.length < 8) return ok;

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  const write = fetch(SUPABASE_URL + '/rest/v1/rpc/record_hub_install', {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
    body: JSON.stringify({
      p_install_id: install,
      p_version:  clean(body.version, 20),
      p_platform: clean(body.platform, 20),
      p_os:       clean(body.os, 40),
      p_arch:     clean(body.arch, 20),
      p_country:  request.headers.get('cf-ipcountry') || null,
      p_user_id:  jwt ? await userIdFrom(jwt) : null
    })
  }).then(r => { if (!r.ok) return r.text().then(t => console.error('record_hub_install refused:', r.status, t)); })
    .catch(e => console.error('record_hub_install failed:', e && e.message));

  waitOn(ctx, write);
  return ok;
}

/* ---------------------------------------------------------------------
   POST /api/check-code   -   what a discount code is worth, before
   anybody pays.

   The page needs to show the price a code produces, and the price
   depends on things only this side knows: the catalog, the Paystack
   rate, and whether this account has already used the code. So the
   figure is worked out here and the page only ever displays it.

   This does NOT spend the code. A code marked spent for a checkout
   somebody abandoned is a code the next person cannot use, so it is
   spent by the webhook when the money actually arrives - and the edge
   function works the price out AGAIN from the same catalog before
   charging, so a page that lies about a discount changes nothing.
   --------------------------------------------------------------------- */
function applyDiscount(cents, d) {
  if (!cents || !d) return cents;
  const off = d.percent_off ? Math.round(cents * d.percent_off / 100)
            : Math.min(d.amount_off_cents || 0, cents);
  /* Never below fifty cents: both processors refuse a smaller charge,
     and "100% off" is an access code's job, not a discount's. */
  return Math.max(50, cents - off);
}

async function checkCode(request, env) {
  const say = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
  if (!env.SUPABASE_SERVICE_KEY) return say({ ok: false, error: 'unavailable' }, 503);

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return say({ ok: false, error: 'sign_in' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const app  = String(body.app || '').toLowerCase().slice(0, 40);
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
  if (!app || code.length < 6) return say({ ok: false, error: 'not_a_code' });

  const c = await getCatalog(env);
  const entry = (c.apps || {})[app];
  if (!entry || entry.free) return say({ ok: false, error: 'wrong_app' });

  let d;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/code_value', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ p_code: code, p_app: app, p_user: await userIdFrom(jwt) })
    });
    if (!r.ok) { console.error('code_value refused:', r.status, await r.text()); return say({ ok: false, error: 'unavailable' }, 502); }
    d = await r.json();
  } catch (e) { return say({ ok: false, error: 'unavailable' }, 502); }

  if (!d || !d.ok) return say({ ok: false, error: (d && d.error) || 'no_such_code' });

  const usdBefore = entry.price_cents || 0;
  const usdAfter  = applyDiscount(usdBefore, d);

  /* And the same discount in the local currency, when Paystack is the
     one that would be charging. Worked out from the discounted dollar
     price rather than by discounting the local one twice. */
  const pay = c.paystack;
  const country = (request.headers.get('cf-ipcountry') || '').toUpperCase();
  let local = null;
  if (pay && pay.live && (pay.countries || []).includes(country)) {
    const before = paystackAmount(pay, entry);
    const after  = paystackAmount(pay, { price_cents: usdAfter });
    if (before && after) {
      local = { currency: pay.currency, before: before, after: after,
                display: money(pay.currency, after), was: money(pay.currency, before) };
    }
  }

  return say({
    ok: true, code: code,
    percent_off: d.percent_off || null, amount_off_cents: d.amount_off_cents || null,
    usd: { before: usdBefore, after: usdAfter,
           display: money('USD', usdAfter), was: money('USD', usdBefore) },
    paystack: local
  });
}

async function appDownload(request, env, ctx) {
  const say = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
  if (!env.DOWNLOADS || !env.DOWNLOAD_SECRET) {
    return say({ error: 'unavailable', message: 'Downloads are not set up yet.' }, 503);
  }

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return say({ error: 'sign_in', message: 'Sign in to download this.' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const app      = String(body.app || '').toLowerCase().slice(0, 40);
  const platform = String(body.platform || '').toLowerCase().slice(0, 20);
  const catalog = await getCatalog(env);
  const item = installerFor(catalog, app, platform);
  if (!item) return say({ error: 'no_such_download', message: 'No such download.' }, 404);

  /* An app the studio has taken off the shelf hands out nothing, to
     anybody, however they got here. The buttons on the site already
     know - but the buttons are not the lock, this is: a paused app
     still has its files in the bucket and its address is still a
     sentence anybody can type. Refused before the beta licence below,
     so a paused beta does not quietly start somebody's thirty days on a
     build they cannot have. */
  const state = (catalog.apps || {})[app];
  if (state && state.status && state.status !== 'available') {
    return say({ error: 'not_available',
                 message: state.soon_note ||
                   appTitle(catalog, app) + ' is not available to download right now.' }, 403);
  }

  /* An open beta has no purchase to grant access, so the licence is
     minted here - at the moment somebody actually downloads it, which is
     when the clock should start. claim_beta_license is idempotent and
     never extends, so a second download returns the same key with the
     same end date. If it fails the ownership check below simply says no,
     which is the right answer rather than a broken download. */
  const entry = (catalog.apps || {})[app];
  if (entry && entry.free && entry.licensed && entry.beta_days) {
    try {
      const c = await fetch(SUPABASE_URL + '/rest/v1/rpc/claim_beta_license', {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + jwt },
        body: JSON.stringify({ p_app: app })
      });
      if (!c.ok) console.error('claim_beta_license refused:', c.status, await c.text());
    } catch (e) {
      console.error('claim_beta_license failed:', e && e.message);
    }
  }

  let owned = false;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/has_app_access', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + jwt },
      body: JSON.stringify({ p_app: app })
    });
    if (r.status === 401) return say({ error: 'sign_in', message: 'Your session has expired - sign in again.' }, 401);
    if (!r.ok) {
      console.error('has_app_access refused:', r.status, await r.text());
      return say({ error: 'upstream_error', message: 'Could not check your account. Try again shortly.' }, 502);
    }
    owned = (await r.json()) === true;
  } catch (e) {
    return say({ error: 'upstream_error', message: 'Could not check your account. Try again shortly.' }, 502);
  }
  if (!owned) {
    return say({ error: 'not_owned', message: 'This account does not own ' + appTitle(catalog, app) + ' yet.' }, 403);
  }

  const t = Date.now() + TICKET_MINUTES * 60 * 1000;
  const path = '/download/' + app + '/' + platform;
  const ticket = path + '?e=' + t + '&s=' + (await sign(env.DOWNLOAD_SECRET, path + ':' + t));

  /* Count it. This is the only place every download of every app
     passes through - the Hub asks here, and so does the button on an
     app page - which is why the count belongs here and not in either
     of them. Recorded when the ticket is issued rather than when the
     bytes move: a ticket is one deliberate act by one person, while a
     transfer can be resumed, ranged and retried, and counting those
     would make a flaky connection look like enthusiasm.

     Told apart by the user agent, which the Hub sets to its own name -
     the one thing it has always sent, so this works on every Hub that
     is already installed rather than only on the next one.

     Deliberately not awaited into the answer: a download must not wait
     on, or fail because of, a statistic. */
  const ua = request.headers.get('user-agent') || '';
  const hub = /AmanorsacHub\/([0-9][0-9A-Za-z.\-]*)/.exec(ua);
  const count = fetch(SUPABASE_URL + '/rest/v1/rpc/record_app_download', {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
    body: JSON.stringify({
      p_app: app, p_platform: platform, p_version: item.version || null,
      p_source: hub ? 'hub' : 'site', p_hub_version: hub ? hub[1] : null,
      p_country: request.headers.get('cf-ipcountry') || null,
      p_user_id: await userIdFrom(jwt)
    })
  }).then(r => { if (!r.ok) return r.text().then(t => console.error('record_app_download refused:', r.status, t)); })
    .catch(e => console.error('record_app_download failed:', e && e.message));
  if (env.SUPABASE_SERVICE_KEY) waitOn(ctx, count); else count.catch(() => {});

  return say({ url: ticket, file: item.as, title: item.title, version: item.version || null });
}

/* The account id out of a Supabase access token, without a round trip.
   Only the subject is wanted and only for a statistic: the token was
   already proven real by has_app_access above, which is the check that
   decides anything. A malformed one gives null and the row is simply
   anonymous. */
async function userIdFrom(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    if (!part) return null;
    const pad = part.replace(/-/g, '+').replace(/_/g, '/');
    const body = JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)));
    return /^[0-9a-f-]{36}$/i.test(body.sub || '') ? body.sub : null;
  } catch (e) { return null; }
}

/* Let a background write finish after the answer has already gone out.
   Cloudflare can cancel work still running when a response returns, so
   without this the count would be recorded most of the time and not all
   of the time, which is worse than not recording it. ctx is the third
   argument to fetch(); a test harness calling the worker directly does
   not pass one, and a statistic is not worth a crash either way. */
function waitOn(ctx, promise) {
  try {
    if (ctx && typeof ctx.waitUntil === 'function') return ctx.waitUntil(promise);
  } catch (e) {}
  promise.catch(() => {});
}

/* The Hub's own installer: public, no ticket, no account - it is the
   front door, and the account is created behind it. Served from R2 under
   stable names so the link on every page survives a release. */
async function serveHub(platform, env, request) {
  const catalog = await getCatalog(env);
  const item = hubInstallerFor(catalog, platform);
  if (!item || !env.DOWNLOADS) return null;

  let object = null;
  for (const key of item.keys) {
    object = await env.DOWNLOADS.get(key, { range: request.headers, onlyIf: request.headers });
    if (object) break;
  }
  if (!object) {
    return confirmPage('Amanorsac Hub isn’t here yet.',
      'The installer for ' + (PLATFORM_LABEL[platform === 'mac' ? 'mac-arm64' : platform] || platform) +
      ' has not been uploaded. It should be at ' + item.keys[0] + ' in the amanorsac-downloads bucket. Try again shortly.',
      null, 503);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('content-type', item.type);
  headers.set('content-disposition', 'attachment; filename="' + item.as + '"');
  headers.set('cache-control', 'public, max-age=300');
  headers.set('accept-ranges', 'bytes');
  const partial = object.range && ('body' in object);
  return new Response(object.body, { status: partial && request.headers.has('range') ? 206 : 200, headers });
}

/* What exists, for the Hub to draw its library from: the catalog with
   paths made absolute and the R2 keys left out - which object a file
   lives in is the Worker's business, not the Hub's. Public and
   cacheable; nothing here is about any one account. */
/* The sale, if one is actually on. `ends` is honoured here rather than
   trusted to whoever is reading: a promo whose deadline has passed is
   no promo at all, and is never handed out. */
function salePromo(c) {
  const p = c && c.promo;
  if (!p) return null;
  if (p.ends) {
    const t = Date.parse(p.ends);
    if (!isFinite(t) || t <= Date.now()) return null;
  }
  return { percent: p.percent || null, note: p.note || '', ends: p.ends || null };
}

/* The notice across the top of the Hub's library, if one is running.
   Same discipline as the sale: `live`, `starts` and `ends` are decided
   here rather than in the Hub, so a notice that is switched off or out
   of its dates is not sent at all and cannot be shown by a copy of the
   Hub that reads the field wrongly. Absent means the Hub falls back to
   choosing its own panel. */
function announcement(c, abs) {
  const a = c && c.announcement;
  if (!a || a.live === false) return null;
  const now = Date.now();
  if (a.starts) { const t = Date.parse(a.starts); if (isFinite(t) && t > now) return null; }
  if (a.ends)   { const t = Date.parse(a.ends);   if (!isFinite(t) || t <= now) return null; }
  if (!a.headline) return null;
  const button = b => (b && b.label && (b.app || b.url))
    ? { label: String(b.label), app: b.app || null, url: b.url ? abs(b.url) : null } : null;
  return {
    id: a.id || String(Date.parse(a.starts || '') || 0) || 'notice',
    eyebrow: a.eyebrow || '', headline: a.headline, body: a.body || '',
    art: abs(a.art), accent: a.accent || null,
    action: button(a.action), link: button(a.link),
    dismissible: a.dismissible !== false, ends: a.ends || null
  };
}

/* ---------------------------------------------------------------------
   Which checkout to offer, and what it will cost in what.

   Cloudflare puts the visitor's country on every request it forwards,
   worked out from the connection itself. That is the whole geography
   here: no third-party lookup, no browser permission prompt, nothing
   that can be blocked by a privacy extension, and nothing leaves the
   edge. A VPN gets whatever country it exits in, which is the honest
   answer to "where is this connection from" and is why both checkouts
   are always offered rather than one being chosen for anybody.

   The price is computed here rather than sent by the page. The page
   uses this to LABEL a button; the edge function works the figure out
   again from the same catalog before it charges anyone, so a request
   that lies about its country or its total gets a correct bill either
   way. Nothing below is a secret: it is the shop window.
   --------------------------------------------------------------------- */
const CURRENCY_SYMBOL = { GHS: '\u20b5', NGN: '\u20a6', ZAR: 'R', KES: 'KSh', USD: '$', XOF: 'CFA', EGP: 'E\u00a3' };

/* What Paystack should charge for one app, in the smallest unit of the
   account's currency - pesewas, kobo, cents. Either the app names its
   own local figure, or the dollar price is converted at the one rate in
   the catalog and rounded up to something that reads like a price. */
function paystackAmount(pay, app) {
  if (!pay || !app) return null;
  if (typeof app.paystack_price === 'number') return app.paystack_price;
  const usd = app.free ? 0 : (app.price_cents || 0);
  if (!usd) return null;
  const rate = Number(pay.rate_per_usd);
  if (!isFinite(rate) || rate <= 0) return null;
  const step = Number(pay.round_to) > 0 ? Number(pay.round_to) : 1;
  return Math.ceil((usd / 100) * rate * 100 / step) * step;
}

function money(currency, minor) {
  const sym = CURRENCY_SYMBOL[currency] || (currency + ' ');
  const whole = minor / 100;
  return sym + (whole % 1 === 0 ? String(whole) : whole.toFixed(2));
}

/* GET /api/pay-options?app=<id>
   Answers: where this connection is, which checkouts to show and in
   what order, and - for Paystack - the exact figure and currency the
   button should say. Never cached: two visitors on the same page get
   different answers, and a cached one would be somebody else's. */
async function payOptions(request, env) {
  const c = await getCatalog(env);
  const url = new URL(request.url);
  const id = String(url.searchParams.get('app') || '').toLowerCase().slice(0, 40);
  const app = (c.apps || {})[id] || null;
  const pay = c.paystack || null;
  const country = (request.headers.get('cf-ipcountry') || '').toUpperCase();

  const local = (pay && pay.live) ? paystackAmount(pay, app) : null;
  const known = !!country && country !== 'XX' && country !== 'T1';
  const here = !!(pay && pay.live && known && (pay.countries || []).includes(country));
  /* Paystack is offered where Paystack's rails actually reach. Outside
     those countries it is not a second option, it is a dead end: a
     card in London cannot pay a Ghanaian mobile money charge, and
     showing the button would only be a way to fail slowly. Inside
     them, both are there - somebody in Accra with an international
     card should not have to hunt for the card. */
  const offer = [];
  if (here && local) offer.push('paystack');
  if (app && !app.free) offer.push('stripe');

  /* Mobile money by hand, over WhatsApp. Not a processor and not
     pretending to be one: it is a conversation that ends with an access
     code typed at /redeem. It is offered on the same reasoning as
     Paystack and in the same places - a momo wallet is a real way to
     pay where momo exists and a dead end where it does not - and it is
     independent of whether Paystack is live, because for now it is the
     only mobile money there is.

     An empty countries list means everywhere, which is the setting for
     turning it on globally without editing this file. */
  const wa = c.whatsapp || null;
  const waCountries = (wa && wa.countries) || [];
  const waHere = !!(wa && wa.live && wa.url && app && !app.free &&
                    (!waCountries.length || (known && waCountries.includes(country))));

  return new Response(JSON.stringify({
    country: known ? country : null,
    /* Which one leads. Where Paystack works it leads and the card is
       the quiet second door; everywhere else there is only the card. */
    first: (here && local) ? 'paystack' : 'stripe',
    offer,
    /* Null unless it is on offer here, so the page has nothing to
       decide - the same shape as everything else this endpoint hands
       back. The URL is the studio's own, from the catalog, and never
       built from anything a request said. */
    whatsapp: waHere ? {
      url: wa.url,
      label: wa.label || 'Pay with mobile money',
      note: wa.note || ''
    } : null,
    paystack: local ? {
      currency: pay.currency, amount: local, display: money(pay.currency, local),
      /* A name-your-price app keeps naming its price here. The figure
         above is the suggested one; minimum is the floor, and the edge
         function clamps whatever is actually sent to the same pair, so
         the box on the page is a convenience rather than the rule. */
      choose: !!app.pay_what_you_want,
      minimum: app.pay_what_you_want ? paystackAmount(pay, { price_cents: app.price_min_cents || 0 }) : null,
      /* The dollar figure this was converted from. The page needs it:
         every one of these pages has its price written into the prose
         in dollars, and a button reading in cedis beside fine print
         reading in dollars is a contradiction the buyer has to resolve
         themselves. Better to say outright which is which. */
      usd_display: money('USD', app.price_cents || 0),
      note: pay.wallet_note || 'Mobile money, bank transfer or a local card.'
    } : null
  }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

async function catalogApi(env) {
  const c = await getCatalog(env);
  const abs = p => p ? (/^https?:/.test(p) ? p : SITE + '/' + String(p).replace(/^\//, '')) : null;
  const sale = !!salePromo(c);
  const apps = {};
  for (const id of Object.keys(c.apps || {})) {
    const a = c.apps[id];
    apps[id] = {
      name: a.name, vendor: a.vendor || 'Amanorsac Studio', kind: a.kind || 'app', status: a.status || 'available',
      tagline: a.tagline || '', icon: abs(a.icon), art: abs(a.art), page: abs(a.page), color: a.color || null,
      soon_note: a.soon_note || null,
      free: !!a.free, price_cents: a.free ? 0 : (a.price_cents || null),
      list_price_cents: (sale && !a.free && a.list_price_cents > (a.price_cents || 0)) ? a.list_price_cents : null,
      licensed: !!a.licensed,
      version: a.version || null, platforms: Object.keys(a.installers || {})
    };
  }
  /* What's new. The Hub keeps its own record of which ids a person has
     read, so entries are handed over whole and in the order the catalog
     lists them - newest first, oldest last. Only the last 30 travel: a
     desktop panel is not an archive.

     `app` is dropped unless it names a real app, because the Hub turns
     it into a button; `url` goes through abs() like every other link
     here, so a relative path in the catalog arrives usable. */
  const news = (Array.isArray(c.news) ? c.news : []).slice(0, 30).map((n) => ({
    id: String(n.id), date: n.date || null, tag: n.tag || null,
    title: n.title || '', body: n.body || '',
    app: n.app && (c.apps || {})[n.app] ? n.app : null, url: abs(n.url),
  })).filter((n) => n.id && n.title);

  const hub = c.hub || {};
  return new Response(JSON.stringify({
    news,
    hub: { name: hub.name || 'Amanorsac Hub', version: hub.version || null, protocol: hub.protocol || 'amanorsac',
           tagline: hub.tagline || '', platforms: Object.keys(hub.installers || {}),
           download: SITE + '/download/hub/{platform}' },
    /* Present only while a sale is on, so the Hub can say "was X" the
       same way the site does. Absent means full price, everywhere -
       including the moment `ends` passes, which is a real deadline and
       is allowed to make the offer disappear without anyone editing
       anything. */
    promo: salePromo(c),
    /* Null unless a notice is running. The Hub redraws its own panel
       when this changes, which is how a message reaches every open
       window without anybody shipping a Hub. */
    announcement: announcement(c, abs),
    apps
  }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
}

function confirmPage(heading, note, ticket, status) {
  const page =
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width, initial-scale=1">' +
'<meta name="robots" content="noindex">' +
'<title>' + esc(heading) + ' &middot; Amanorsac Studio</title>' +
'<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;' +
'background:#0C0E12;color:#e9ebf1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;' +
'text-align:center}main{max-width:430px}h1{font-size:27px;line-height:1.2;margin:0 0 12px}' +
'p{color:#a2a9b8;line-height:1.65;margin:0 0 24px}' +
'a.b{display:inline-block;background:#3fd3e4;color:#06131a;text-decoration:none;' +
'padding:13px 26px;border-radius:999px;font-weight:700}' +
'a.s{display:block;margin-top:22px;color:#6d7488;font-size:13px}</style></head><body><main>' +
'<h1>' + esc(heading) + '</h1>' +
(note ? '<p>' + esc(note) + '</p>' : '') +
(ticket ? '<a class="b" href="' + esc(ticket) + '" download>Download now</a>' +
          '<script>setTimeout(function(){location.href=' + JSON.stringify(ticket) + ';},700);<\/script>'
        : '<a class="b" href="' + SITE + '/apps.html">Back to the App Store</a>') +
'<a class="s" href="' + SITE + '">amanorsac.studio</a>' +
'</main></body></html>';
  return new Response(page, {
    status: status || (ticket ? 200 : 410),
    headers: pageHeaders({ 'cache-control': 'no-store' })
  });
}

async function serveInstaller(app, platform, url, env, request) {
  const catalog = await getCatalog(env);
  const item = installerFor(catalog, app, platform);
  if (!item || !env.DOWNLOADS || !env.DOWNLOAD_SECRET) return null;

  const expires = parseInt(url.searchParams.get('e') || '0', 10);
  const sig = url.searchParams.get('s') || '';
  if (!expires || Date.now() > expires) return null;

  const want = await sign(env.DOWNLOAD_SECRET, url.pathname + ':' + expires);
  if (!sameString(sig, want)) return null;

  let object = null;
  for (const key of item.keys) {
    object = await env.DOWNLOADS.get(key, { range: request.headers, onlyIf: request.headers });
    if (object) break;
  }

  if (!object) {
    /* R2 does not have it. Dropbox, if one is configured, is a bridge
       until it does - fetched here, on the Worker's side, so the
       visitor's browser only ever talks to amanorsac.studio. Nothing
       about the gate changes: the ticket above already proved the
       address was confirmed and fifteen minutes have not passed:
       this only decides where the bytes come from once that is true. */
    if (item.dropbox) {
      let upstream;
      try {
        // Dropbox's dl=1 trick does not reliably hand over raw bytes to a
        // request with no browser session behind it - without something
        // that looks like a browser, a large file can come back as a
        // small HTML interstitial ("too many people are downloading
        // this file", a confirmation page) instead, still with a 200.
        upstream = await fetch(dropboxDirect(item.dropbox), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
        });
      } catch (e) { upstream = null; }
      const upstreamType = upstream && (upstream.headers.get('content-type') || '');
      const upstreamLen = upstream && parseInt(upstream.headers.get('content-length') || '0', 10);
      // Below this, it is never a real installer - every current build is
      // well over 50 MB - so anything smaller is Dropbox's interstitial,
      // not the file, and must not be handed to a visitor as one.
      const looksReal = upstream && upstream.ok && upstream.body &&
        !/html|text/i.test(upstreamType) &&
        (!upstreamLen || upstreamLen > 50 * 1024 * 1024);
      if (looksReal) {
        const headers = new Headers();
        headers.set('content-type', item.type || 'application/zip');
        headers.set('content-disposition', 'attachment; filename="' + item.as + '"');
        headers.set('cache-control', 'private, no-store');
        if (upstreamLen) headers.set('content-length', String(upstreamLen));
        return new Response(upstream.body, { status: 200, headers });
      }
      console.error('dropbox bridge did not return the installer:', app, platform,
        upstream ? upstream.status + ' ' + upstreamType + ' ' + upstreamLen + 'b' : 'fetch failed');
    }
    /* Neither R2 nor a working bridge had it. That is the studio's
       mistake, not the visitor's, and answering it with the same blank
       404 a forged ticket gets means nobody ever finds out which of the
       two happened. */
    return confirmPage('That file is not where it should be.',
      'The link was good, but the installer could not be handed over right now. ' +
      'It should be at ' + item.keys[0] + ' in the amanorsac-downloads bucket' +
      (item.dropbox ? ', or the Dropbox bridge standing in for it just failed' : '') +
      '. Try again shortly.', null, 503);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('content-type', item.type || 'application/zip');
  headers.set('content-disposition', 'attachment; filename="' + item.as + '"');
  // a ticket is personal and short-lived; nothing in between should keep this
  headers.set('cache-control', 'private, no-store');
  headers.set('accept-ranges', 'bytes');

  // a range request - a resumed download - comes back as a partial
  const partial = object.range && ('body' in object);
  return new Response(object.body,
    { status: partial && request.headers.has('range') ? 206 : 200, headers: headers });
}


/* ---------------------------------------------------------------------
   reviews

   The publishable key that every page already carries can read the
   approved ones and count downloads - both harmless to hand to anyone,
   which is why app-reviews.js still talks to Supabase directly for
   those. Writing one is different: submit_app_review now only answers
   to the Worker's own service key, so POST /api/review is the one door
   a review goes through, for every app.

   For an app in REVIEW_INVITE_APPS that door only opens with the
   signed link this file emails out on its own schedule - see
   sendReviewInvites below. Any other app's form has no such link to
   check, so it posts through here exactly as if the token check were
   not there at all.
   --------------------------------------------------------------------- */

async function submitReview(request, env) {
  const say = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });

  if (!env.SUPABASE_SERVICE_KEY || !env.DOWNLOAD_SECRET) {
    return say({ error: 'Reviews are not set up yet.' }, 503);
  }

  let body = {};
  try { body = await request.json(); } catch (e) {}

  const app    = String(body.app || '').toLowerCase().slice(0, 40);
  const rating = parseInt(body.rating, 10);
  const name   = body.name ? String(body.name).slice(0, 60) : null;
  const text   = String(body.body || '').slice(0, 2000);
  const rv     = String(body.rv || '');

  const catalog = await getCatalog(env);
  if (!catalog.apps[app])           return say({ error: 'No such app.' }, 404);
  if (!(rating >= 1 && rating <= 5)) return say({ error: 'Pick a rating first.' }, 400);
  if (!text.trim())                 return say({ error: 'Say a little about it.' }, 400);

  if (REVIEW_INVITE_APPS.includes(app)) {
    const dot = rv.indexOf('.');
    const expires = dot > 0 ? parseInt(rv.slice(0, dot), 10) : 0;
    const sig = dot > 0 ? rv.slice(dot + 1) : '';
    const want = expires ? await sign(env.DOWNLOAD_SECRET, ['review', app, expires].join(':')) : '';
    if (!expires || Date.now() > expires || !sig || !sameString(sig, want)) {
      return say({ error: 'Reviews for this app come from the link in the follow-up ' +
        'email sent about a week after downloading it.' }, 403);
    }
  }

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/submit_app_review', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ p_app: app, p_rating: rating, p_name: name, p_body: text })
    });
    if (!r.ok) {
      console.error('submit_app_review refused:', r.status, await r.text());
      return say({ error: 'Could not save that. Try again shortly.' }, 502);
    }
  } catch (e) {
    return say({ error: 'Could not reach the studio.' }, 502);
  }

  return say({ ok: true });
}

/* Once a day: for every app in REVIEW_INVITE_APPS, ask the database who
   downloaded it a week or more ago and has not already been asked, mail
   each of them a signed link, and only mark an address asked once the
   email provider has confirmed the letter actually went. A failed send
   is retried tomorrow rather than silently recorded as done. */
/* ---------------------------------------------------------------------
   Telling owners about an update.

   Driven from catalog.json, where an app can carry a `notice` block:

     "notice": {
       "id": "2026-09-phones",
       "subject": "Nebula Tide 2 is on your phone now",
       "line": "One sentence saying what changed.",
       "body": "A paragraph, optional.",
       "cta": "Open it in Amanorsac Hub"
     }

   Written where every other decision about an app is written, and
   nothing here is a deploy: add the block, and the next daily run sends
   it to the people who own that app. Delete it and nothing more goes
   out. `id` is what a send is remembered by, so changing the wording
   without changing the id does nothing, and changing the id sends a
   second letter to everybody - which is the behaviour you want from
   something that must not surprise anyone.

   Who gets it: owners of that app. Not the mailing list, not everyone
   with an account, not owners of a different app. A product update is a
   service message to a customer about the thing they paid for.

   The send is marked before the letter leaves, and the candidate list
   is "owns it and has no mark". A run that dies halfway, a cron that
   fires twice, a retry after a timeout - none can produce a second
   letter, because the mark is a unique row and not a flag.

   Rate: a slice each day rather than the lot at once. A few hundred
   letters from a new domain in one burst is how a domain gets a
   reputation nobody wants, and there is no hurry.
   --------------------------------------------------------------------- */
const NOTICE_BATCH = 120;

async function sendUpdateNotices(env) {
  if (!env.SUPABASE_SERVICE_KEY || !env.RESEND_API_KEY || !env.DOWNLOAD_SECRET) {
    console.error('update notices: SUPABASE_SERVICE_KEY, RESEND_API_KEY or DOWNLOAD_SECRET not set, skipping');
    return;
  }

  const catalog = await getCatalog(env);
  const apps = catalog.apps || {};
  const db = (fn, body) => fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
    body: JSON.stringify(body)
  });

  let budget = NOTICE_BATCH;

  for (const app of Object.keys(apps)) {
    if (budget <= 0) break;
    const n = apps[app].notice;
    if (!n || !n.id || !n.subject || !n.line) continue;

    let people = [];
    try {
      const r = await db('update_notice_candidates', { p_app: app, p_notice_id: String(n.id), p_limit: budget });
      if (r.ok) people = await r.json();
      else console.error('update_notice_candidates refused:', app, r.status, await r.text());
    } catch (e) { console.error('update_notice_candidates unreachable:', app, e && e.message); continue; }

    for (const row of people) {
      if (budget <= 0) break;
      const email = String(row.email || '').toLowerCase();
      if (!looksLikeEmail(email)) continue;

      /* Marked first. If this returns false somebody else already took
         this person - two runs overlapping, most likely - and the right
         answer is to leave them alone rather than send a second copy. */
      let mine = false;
      try {
        const r = await db('mark_update_notice_sent',
          { p_app: app, p_notice_id: String(n.id), p_email: email, p_user_id: row.user_id || null });
        if (r.ok) mine = (await r.json()) === true;
        else console.error('mark_update_notice_sent refused:', email, app, r.status, await r.text());
      } catch (e) { console.error('mark_update_notice_sent unreachable:', email, app, e && e.message); }
      if (!mine) continue;

      budget--;
      const ok = await sendUpdateNotice(env, email, appTitle(catalog, app), app, n);
      if (!ok) console.error('update notice failed to send:', email, app, n.id);
    }
  }
}

async function sendUpdateNotice(env, email, title, app, n) {
  /* The stop link is signed, so an address cannot be opted out by
     somebody who merely knows it. No expiry on this one: a link that
     says "stop emailing me" should work whenever it is finally
     clicked, including two years later out of an archived inbox. */
  const sig = await sign(env.DOWNLOAD_SECRET, 'optout:' + email);
  const stop = SITE + '/notices/stop?e=' + encodeURIComponent(email) + '&s=' + sig;
  const link = SITE + '/' + app;

  const text =
    n.line + '\n\n' +
    (n.body ? n.body + '\n\n' : '') +
    link + '\n\n' +
    'You are getting this because you own ' + title + '. It is not a ' +
    'newsletter and there is nothing else coming.\n' +
    'Rather not hear about updates at all? ' + stop + '\n\n' +
    'Amanorsac Studio\n' + SITE + '\n';

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;' +
      'margin:0 auto;padding:32px 24px;color:#1C1916;line-height:1.6">' +
    '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;' +
      'color:#6B655C">' + esc(title) + '</p>' +
    '<p style="margin:0 0 18px;font-size:21px;font-weight:600;line-height:1.35">' + esc(n.line) + '</p>' +
    (n.body ? '<p style="margin:0 0 22px">' + esc(n.body) + '</p>' : '') +
    '<p style="margin:0 0 22px"><a href="' + esc(link) + '" ' +
      'style="display:inline-block;background:#1C1916;color:#fff;text-decoration:none;' +
      'padding:13px 22px;border-radius:9px;font-weight:600">' +
      esc(n.cta || ('Open ' + title)) + '</a></p>' +
    '<p style="margin:0 0 8px;color:#6B655C;font-size:13.5px">' +
      'You are getting this because you own ' + esc(title) + '. It is not a newsletter ' +
      'and there is nothing else coming.</p>' +
    '<p style="margin:0 0 18px;color:#6B655C;font-size:13.5px">' +
      '<a href="' + esc(stop) + '" style="color:#6B655C">Rather not hear about updates at all?</a></p>' +
    '<p style="margin:0;color:#6B655C;font-size:13px">Amanorsac Studio &middot; ' +
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a></p></div>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || 'Amanorsac Studio <hello@amanorsac.studio>',
        to: [email], subject: n.subject, text: text, html: html
      })
    });
    return r.ok;
  } catch (e) { return false; }
}

/* GET /notices/stop?e=...&s=...  -  the link at the bottom of a notice.
   A plain page, no account needed: somebody who wants out should not
   have to sign in to say so. */
async function noticeStop(url, env) {
  const email = String(url.searchParams.get('e') || '').toLowerCase().slice(0, 200);
  const sig = String(url.searchParams.get('s') || '');
  if (!env.SUPABASE_SERVICE_KEY || !env.DOWNLOAD_SECRET || !looksLikeEmail(email) || !sig) {
    return confirmPage('That link is not right',
      'Reply to any email from the studio and it will be sorted by hand.', null, 400);
  }
  const want = await sign(env.DOWNLOAD_SECRET, 'optout:' + email);
  if (!sameString(sig, want)) {
    return confirmPage('That link is not right',
      'Reply to any email from the studio and it will be sorted by hand.', null, 400);
  }

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/notice_optout', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ p_email: email })
    });
    if (!r.ok) console.error('notice_optout refused:', r.status, await r.text());
  } catch (e) { console.error('notice_optout unreachable:', e && e.message); }

  return confirmPage('That is done',
    'No more emails about app updates will go to ' + email + '. Anything about a ' +
    'purchase you make, or a password you reset, still will - those are not ' +
    'something to be opted out of.', null, 200);
}

async function sendReviewInvites(env) {
  if (!env.SUPABASE_SERVICE_KEY || !env.DOWNLOAD_SECRET || !env.RESEND_API_KEY) {
    console.error('review invites: SUPABASE_SERVICE_KEY, DOWNLOAD_SECRET or RESEND_API_KEY not set, skipping');
    return;
  }

  const catalog = await getCatalog(env);
  for (const app of REVIEW_INVITE_APPS) {
    let candidates = [];
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/review_invite_candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json',
                   apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
        body: JSON.stringify({ p_app: app })
      });
      if (r.ok) candidates = await r.json();
      else console.error('review_invite_candidates refused:', app, r.status, await r.text());
    } catch (e) { console.error('review_invite_candidates unreachable:', app, e && e.message); }

    for (const row of candidates) {
      const email = String(row.email || '').toLowerCase();
      if (!looksLikeEmail(email)) continue;

      // A month to open the letter and click through - long enough for
      // someone who reads email in batches, not so long the link is
      // still sitting in an inbox at the start of next quarter.
      const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sig = await sign(env.DOWNLOAD_SECRET, ['review', app, expires].join(':'));
      const link = SITE + '/' + app + '?rv=' + expires + '.' + sig;

      const sent = await sendReviewInvite(env, email, appTitle(catalog, app), link);
      if (!sent) { console.error('review invite email failed to send:', email, app); continue; }

      try {
        const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/mark_review_invite_sent', {
          method: 'POST',
          headers: { 'content-type': 'application/json',
                     apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
          body: JSON.stringify({ p_email: email, p_app: app })
        });
        if (!r.ok) console.error('mark_review_invite_sent refused:', email, app, r.status, await r.text());
      } catch (e) { console.error('mark_review_invite_sent unreachable:', email, app, e && e.message); }
    }
  }
}

async function sendReviewInvite(env, email, appTitle, link) {
  const text =
    'You downloaded ' + appTitle + ' a little over a week ago.\n\n' +
    'Got a minute to say what you think? It helps other people decide, ' +
    'and helps me know what to fix next.\n\n' +
    link + '\n\n' +
    'That link is yours alone and works for 30 days. If you would rather ' +
    'not, ignore this - you will not be asked again about this download.\n\n' +
    'Amanorsac Studio\n' + SITE + '\n';

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;' +
    'line-height:1.6;color:#1C1916;max-width:520px">' +
    '<p style="margin:0 0 18px">You downloaded <b>' + esc(appTitle) + '</b> a little over a week ago.</p>' +
    '<p style="margin:0 0 22px">Got a minute to say what you think? It helps other ' +
      'people decide, and helps me know what to fix next.</p>' +
    '<p style="margin:0 0 22px"><a href="' + esc(link) + '" ' +
      'style="display:inline-block;background:#1C1916;color:#fff;text-decoration:none;' +
      'padding:13px 22px;border-radius:9px;font-weight:600">Leave a rating</a></p>' +
    '<p style="margin:0 0 18px;color:#6B655C;font-size:14px">' +
      'That link is yours alone and works for 30 days. If you would rather not, ' +
      'ignore this &mdash; you will not be asked again about this download.</p>' +
    '<p style="margin:0;color:#6B655C;font-size:13px">Amanorsac Studio &middot; ' +
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a></p></div>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 Authorization: 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || 'Amanorsac Studio <hello@amanorsac.studio>',
        to: [email],
        subject: 'How’s ' + appTitle + ' working out?',
        text: text, html: html
      })
    });
    return r.ok;
  } catch (e) { return false; }
}


/* ---------------------------------------------------------------------
   licenses

   The one door a native app talks to, at exactly the paths, field names
   and response shape its own compiled client already expects
   (LicenseClient.h / LicenseCrypto.h in the SecondOut source) - that
   contract is fixed by the shipping binary, not by this file, so
   nothing here invents its own. It never sees Supabase, never holds a
   Supabase key of any kind - only the license key its owner typed in or
   the site emailed them, and a device id it generates once and keeps
   for itself.

   A successful activation is signed, not handed back as bare JSON: the
   app verifies a P-256 signature (LicenseCrypto.h) against a public key
   compiled into the binary before it will trust the response at all, so
   a patched binary or a spoofed local server cannot forge a license
   without this Worker's private key. LICENSE_SIGNING_KEY (a P-256
   private key, JWK) is a Worker secret set with `wrangler secret put`,
   never committed here.

   No CORS header is set on purpose: nothing here is meant to be called
   from a browser page on another origin, only from the app itself
   making a plain HTTPS request.
   --------------------------------------------------------------------- */

// The app re-activates on its own every hour, so this is not "how long
// until it's locked out" - it's the offline cliff before the extended
// grace period below kicks in.
const LICENSE_PROOF_VALID_MS = 48 * 60 * 60 * 1000;
const LICENSE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

function licenseB64Url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Raw IEEE P1363 (r||s, 64 bytes) is what crypto.subtle.sign already
// returns for ECDSA - the same format LicenseCrypto.h verifies via
// BCryptVerifySignature, so no DER conversion belongs on this path.
async function signLicenseProof(env, deviceKey, licenseKey) {
  const key = await crypto.subtle.importKey(
    'jwk', JSON.parse(env.LICENSE_SIGNING_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const now = Date.now();
  const bodyBytes = new TextEncoder().encode(JSON.stringify({
    deviceKey, licenseKey,
    issuedAt: now,
    expiresAt: now + LICENSE_PROOF_VALID_MS,
    graceUntil: now + LICENSE_GRACE_MS
  }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bodyBytes));
  return licenseB64Url(bodyBytes) + '.' + licenseB64Url(sig);
}

async function licenseActivate(request, env) {
  const say = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
  if (!env.SUPABASE_SERVICE_KEY || !env.LICENSE_SIGNING_KEY) {
    return say({ error: 'licensing_unavailable', message: 'Licensing is not set up yet.' }, 503);
  }

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const licenseKey = String(body.licenseKey || '').trim().toUpperCase();
  const deviceKey = String(body.deviceKey || '').trim();
  const deviceLabel = body.deviceLabel ? String(body.deviceLabel).slice(0, 120) : null;

  if (!licenseKey || !deviceKey) {
    return say({ error: 'invalid_request', message: 'licenseKey and deviceKey are required.' }, 400);
  }

  let result;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/activate_device', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ p_license_key: licenseKey, p_device_id: deviceKey, p_device_name: deviceLabel })
    });
    if (!r.ok) {
      console.error('activate_device refused:', r.status, await r.text());
      return say({ error: 'upstream_error', message: 'Could not reach the license server. Try again shortly.' }, 502);
    }
    result = await r.json();
  } catch (e) {
    return say({ error: 'upstream_error', message: 'Could not reach the license server.' }, 502);
  }

  if (!result || !result.ok) {
    // These are the exact codes LicenseClient.h switches on
    // (friendlyMessageFor) - pass them through untouched, don't reword.
    const code = (result && result.error) || 'no_such_license';
    if (code === 'device_limit_reached') {
      return say({ error: code, max_devices: result.max_devices, devices: result.devices }, 409);
    }
    /* A beta that has run out. 403 rather than 404: the key is real and
       was ours, it simply no longer entitles anyone to a proof. The date
       goes with it so the app can say when it ended instead of guessing. */
    if (code === 'license_expired') {
      return say({ error: code, expires_at: result.expires_at || null }, 403);
    }
    return say({ error: code }, 404);
  }

  try {
    const proof = await signLicenseProof(env, deviceKey, licenseKey);
    return say({ proof: proof }, 200);
  } catch (e) {
    return say({ error: 'licensing_unavailable', message: 'Licensing is not set up yet.' }, 503);
  }
}

async function licenseDeactivate(request, env) {
  const say = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
  if (!env.SUPABASE_SERVICE_KEY) return say({ error: 'licensing_unavailable', message: 'Licensing is not set up yet.' }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const licenseKey = String(body.licenseKey || '').trim().toUpperCase();
  const deviceKey = String(body.deviceKey || '').trim();

  if (!licenseKey || !deviceKey) {
    return say({ error: 'invalid_request', message: 'licenseKey and deviceKey are required.' }, 400);
  }

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/deactivate_device', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ p_license_key: licenseKey, p_device_id: deviceKey })
    });
    if (!r.ok) {
      console.error('deactivate_device refused:', r.status, await r.text());
      return say({ error: 'upstream_error', message: 'Could not reach the license server.' }, 502);
    }
    const result = await r.json();
    if (!result || !result.ok) {
      return say({ error: (result && result.error) || 'no_such_license' }, 404);
    }
    return say({ ok: true }, 200);
  } catch (e) {
    return say({ error: 'upstream_error', message: 'Could not reach the license server.' }, 502);
  }
}


/* ---------------------------------------------------------------------
   one post
   --------------------------------------------------------------------- */

/* Every column, rather than a list of names. Naming a column the table
   does not have is a 400 from PostgREST, and a 400 here is dangerously
   indistinguishable from "no such post" - the reader sees the same 404
   either way. A post row is small; asking for all of it costs nothing. */
const FIELDS = '*';

async function postPage(slug, env, request, diag) {
  slug = String(slug || '').toLowerCase();
  /* Adding ?diag to a post address reports which step failed instead of
     rendering. Nothing secret passes through it - the key it uses is the
     publishable one and can only read published posts - and when a post
     will not appear it turns an afternoon of guessing into one line. */
  const note = [];

  // not a plausible address: not worth a database round trip
  note.push('slug: ' + JSON.stringify(slug) + ' (' + slug.length + ' chars)');
  if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(slug)) {
    note.push('REJECTED: not a plausible slug');
    return diag ? report(note) : notFound(env, request);
  }

  let post = null;
  try {
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/posts?slug=eq.' + encodeURIComponent(slug) +
      '&select=' + FIELDS + '&limit=1',
      { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
    );
    const body = await r.text();
    note.push('database: HTTP ' + r.status);
    note.push('database said: ' + body.slice(0, 400));
    if (r.ok) {
      try { post = JSON.parse(body)[0] || null; }
      catch (e) { note.push('could not read that as JSON: ' + e.message); }
    }
  } catch (e) {
    note.push('database call threw: ' + e.message);
  }
  note.push('post found: ' + (post ? 'yes' : 'NO'));

  if (!post) return diag ? report(note) : notFound(env, request);

  const tplRes = await env.ASSETS.fetch(new URL('/post-template.html', request.url));
  note.push('template: HTTP ' + (tplRes ? tplRes.status : 'no response'));
  if (!tplRes || !tplRes.ok) return diag ? report(note) : notFound(env, request);
  const tpl = await tplRes.text();
  note.push('template: ' + tpl.length + ' bytes, ' +
            (tpl.match(/<!--post:[a-z]+-->/g) || []).length + ' markers');
  if (diag) return report(note);

  const url    = SITE + '/blog/' + post.slug;
  const cover  = absolute(post.cover);
  const image  = absolute(post.og_image || post.cover) || SITE + '/images/hero-piano.jpg';
  const author = post.author_name || 'Stephen Amanor Sackey';
  const desc   = post.blurb || '';
  const when   = longDate(post.published_at);
  const mins   = post.read_minutes ? post.read_minutes + ' min read' : '';

  /* Structured data, so a search engine is told what this is rather than
     left to work it out: an article, its headline, when, and by whom. */
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: desc,
    image: image,
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    author: { '@type': 'Person', name: author, url: SITE + '/about' },
    publisher: { '@type': 'Organization', name: 'Amanorsac Studio', url: SITE },
    mainEntityOfPage: url,
    inLanguage: 'en'
  };

  const head =
    // AdSense checks for this on the pages adverts run on, and a post page
    // builds its whole head here, so it goes in here too
    '<meta name="google-adsense-account" content="ca-pub-6190327414594776">\n' +
    '<title>' + esc(post.title) + ' | The Modern Musician</title>\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<link rel="canonical" href="' + esc(url) + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:title" content="' + esc(post.title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:image" content="' + esc(image) + '">\n' +
    '<meta property="og:url" content="' + esc(url) + '">\n' +
    '<meta property="og:site_name" content="Amanorsac Studio">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + esc(post.title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<meta name="twitter:image" content="' + esc(image) + '">\n' +
    '<meta property="article:published_time" content="' + esc(post.published_at) + '">\n' +
    '<script type="application/ld+json">' +
      JSON.stringify(jsonld).replace(/</g, '\\u003c') + '</script>';

  const byline = '<b>' + esc(author) + '</b>' +
    (when ? ' &middot; ' + esc(when) : '') +
    (mins ? ' &middot; ' + esc(mins) : '');

  const coverBlock = cover
    ? '<div class="wrap"><div class="cover"><img src="' + esc(cover) + '" alt="' +
      esc(post.cover_alt || '') + '" fetchpriority="high"></div></div>'
    : '';

  let html = tpl;
  html = fill(html, 'head', head);
  html = fill(html, 'tag', esc(post.tag || ''));
  html = fill(html, 'title', esc(post.title));
  html = fill(html, 'byline', byline);
  html = fill(html, 'cover', coverBlock);
  // body_html was rendered and read in the editor before it was saved
  html = fill(html, 'body', post.body_html || '');

  /* The template sits at the site root and reaches its assets from
     there; this page is served a directory deeper. One base element
     keeps every relative path in it - the stylesheet's fonts included -
     pointing at the same files. */
  html = html.replace('<head>', '<head>\n<base href="' + SITE + '/">');

  return new Response(html, {
    // long enough to be worth having, short enough that a correction
    // published now is live in a minute rather than tomorrow
    headers: pageHeaders({
      'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
    })
  });
}


/* ---------------------------------------------------------------------
   the sitemap
   Built on request, because a file edited by hand is a file that gets
   forgotten, and a post missing from the sitemap is a post found late.
   If the database cannot be reached the fixed pages still go out: a
   sitemap that is briefly short is a small problem, one that fails to
   load is an error in Search Console.
   --------------------------------------------------------------------- */

/* Only pages that are actually served. /performlive and /harmoniemd were
   in here after their files were taken out of the upload, so the sitemap
   was sending search engines at two 404s. */
const PAGES = [
  ['/',            'weekly',  '1.0'],
  ['/mixing',      'monthly', '0.9'],
  ['/apps',        'monthly', '0.9'],
  ['/blog',        'weekly',  '0.9'],
  ['/about',       'monthly', '0.8'],
  ['/nebulatide2', 'monthly', '0.7'],
  ['/secondout',   'monthly', '0.7'],
  ['/ambanalog',   'monthly', '0.7'],
  ['/alignpro',    'monthly', '0.7'],
  ['/afdgate',     'monthly', '0.7'],
  ['/aether',      'monthly', '0.7'],
  ['/pulseroom',   'monthly', '0.7'],
  ['/nebulatide',  'monthly', '0.7'],
  ['/legal',       'yearly',  '0.3'],
  ['/privacy',     'yearly',  '0.3']
];

async function sitemap() {
  const today = day();
  const urls = PAGES.map(([path, freq, pri]) =>
    '  <url>\n' +
    '    <loc>' + SITE + path + '</loc>\n' +
    '    <lastmod>' + today + '</lastmod>\n' +
    '    <changefreq>' + freq + '</changefreq>\n' +
    '    <priority>' + pri + '</priority>\n' +
    '  </url>');

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/posts_public', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      body: JSON.stringify({ p_limit: 200 })
    });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows)) {
        for (const p of rows) {
          if (!p || !p.slug) continue;
          urls.push(
            '  <url>\n' +
            '    <loc>' + SITE + '/blog/' + xml(p.slug) + '</loc>\n' +
            '    <lastmod>' + day(p.updated_at || p.published_at) + '</lastmod>\n' +
            '    <changefreq>yearly</changefreq>\n' +
            '    <priority>0.8</priority>\n' +
            '  </url>');
        }
      }
    }
  } catch (e) { /* the fixed pages are enough to answer with */ }

  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') + '\n</urlset>\n',
    { headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=600, s-maxage=3600'
    } });
}


/* ---------------------------------------------------------------------
   odds and ends
   --------------------------------------------------------------------- */

/* Everything that lands in an attribute or between tags is escaped, even
   though the studio wrote it. A post is data, and data is escaped on the
   way out - which is why a quotation mark in a title can never break the
   markup around it. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function xml(s) {
  return esc(s).replace(/'/g, '&apos;');
}

/* Replace whatever sits between a pair of markers in the template. */
function fill(html, key, value) {
  return html.replace(
    new RegExp('<!--post:' + key + '-->[\\s\\S]*?<!--\\/post:' + key + '-->', 'g'),
    value);
}

function absolute(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return SITE + '/' + String(u).replace(/^\/+/, '');
}

function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function day(iso) {
  const d = iso ? new Date(iso) : new Date();
  return (isNaN(d) ? new Date() : d).toISOString().slice(0, 10);
}

function report(lines) {
  return new Response(lines.join('\n') + '\n',
    { headers: { 'content-type': 'text/plain; charset=utf-8',
                 'cache-control': 'no-store' } });
}

/* An address that is not a post gets the site's own 404 page, with the
   status to match - not a blank page, and not a 200 that would let a
   search engine index the mistake. */
async function notFound(env, request) {
  try {
    const r = await env.ASSETS.fetch(new URL('/404.html', request.url));
    return new Response(await r.text(), { status: 404, headers: pageHeaders() });
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
}
