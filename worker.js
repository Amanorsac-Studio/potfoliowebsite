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
  async fetch(request, env) {
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

        const m = path.match(/^\/blog\/([^/]+)\/?$/);
        if (m) return await postPage(decodeURIComponent(m[1]), env, request,
                                     new URL(request.url).searchParams.has('diag'));

        // a ticketed installer. A bad or stale ticket falls through to
        // the 404 below, so there is nothing here to probe at.
        if (path === '/download/confirm') {
          const page = await confirmDownload(new URL(request.url), env);
          if (page) return page;
        }

        const d = path.match(/^\/download\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
        if (d) {
          const file = await serveInstaller(d[1], d[2], new URL(request.url), env, request);
          if (file) return file;
        }
      }

      if (request.method === 'POST' && new URL(request.url).pathname === '/api/download') {
        return await handoutDownload(request, env);
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/review') {
        return await submitReview(request, env);
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
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.youtube.com " +
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


/* What may be asked for. A fixed map, so no amount of creativity in the
   request can name a file that is not on this list.

   Two keys each, tried in order: in a pulseroom/ folder, or loose at the
   top of the bucket. Uploading a 179 MB file a second time because the
   Worker wanted a folder in front of the name is not a good reason to
   upload a 179 MB file a second time. */
const INSTALLERS = {
  'pulseroom:windows': { keys: ['pulseroom/PulseRoom-Windows.zip', 'PulseRoom-Windows.zip'],
                         as: 'PulseRoom-Windows.zip', title: 'PulseRoom for Windows' },
  'pulseroom:mac':     { keys: ['pulseroom/PulseRoom-macOS.zip', 'PulseRoom-macOS.zip'],
                         as: 'PulseRoom-macOS.zip',   title: 'PulseRoom for Mac' },
  /* dropbox is a bridge, not a home. As of 1.2.2 neither platform has a
     working R2 copy - the CLI tooling to get a proper upload talking to
     R2 is still not sorted, so both links stand in until it is. The R2
     keys are left in place on purpose: the day a real upload lands at
     one of them, delete that platform's dropbox line and stop deleting
     the stale R2 object before every future release. Until then, the
     R2 object at these keys MUST stay empty/deleted, because the R2
     lookup above always runs first - a stale file sitting there would
     keep being served instead of the current Dropbox link, silently. */
  'nebulatide:windows':{ keys: ['nebulatide/NebulaTide-Windows.zip', 'NebulaTide-Windows.zip'],
                         as: 'NebulaTide-Windows.zip', title: 'Nebula Tide for Windows',
                         dropbox: 'https://www.dropbox.com/scl/fi/mh40nxu467ouw0uka6si9/NebulaTide-Windows.zip?rlkey=ngvoa116wi7xognir4frynqwn&st=k7lhh0at&dl=0' },
  'nebulatide:mac':    { keys: ['nebulatide/NebulaTide-macOS.zip', 'NebulaTide-macOS.zip'],
                         as: 'NebulaTide-macOS.zip',   title: 'Nebula Tide for Mac',
                         dropbox: 'https://www.dropbox.com/scl/fi/ezjr579od0kyskqmgqya9/NebulaTide-macOS.zip?rlkey=gg049q3d0ia809vre9lwz57cn&st=ycv2bnoj&dl=0' }
};

/* Plain names for the review-invite email, decoupled from the
   platform-specific installer titles above ("Nebula Tide for Windows"
   reads wrong in "how's Nebula Tide for Windows working out?"). */
const APP_TITLES = { pulseroom: 'PulseRoom', nebulatide: 'Nebula Tide' };

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
  const item = INSTALLERS[app + ':' + platform];
  if (!item) return say({ error: 'No such download.' }, 404);

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

  const item = INSTALLERS[app + ':' + platform];
  if (!item || !expires) return confirmPage('That link is not one of ours.', null, null);
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
  const item = INSTALLERS[app + ':' + platform];
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
        headers.set('content-type', 'application/zip');
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
  headers.set('content-type', 'application/zip');
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

  if (!APP_TITLES[app])             return say({ error: 'No such app.' }, 404);
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
async function sendReviewInvites(env) {
  if (!env.SUPABASE_SERVICE_KEY || !env.DOWNLOAD_SECRET || !env.RESEND_API_KEY) {
    console.error('review invites: SUPABASE_SERVICE_KEY, DOWNLOAD_SECRET or RESEND_API_KEY not set, skipping');
    return;
  }

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

      const sent = await sendReviewInvite(env, email, APP_TITLES[app], link);
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

const PAGES = [
  ['/',            'weekly',  '1.0'],
  ['/mixing',      'monthly', '0.9'],
  ['/apps',        'monthly', '0.9'],
  ['/blog',        'weekly',  '0.9'],
  ['/about',       'monthly', '0.8'],
  ['/performlive', 'monthly', '0.7'],
  ['/pulseroom',   'monthly', '0.7'],
  ['/harmoniemd',  'monthly', '0.7'],
  ['/nebulatide',  'monthly', '0.7'],
  ['/secondout',   'monthly', '0.7']
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
