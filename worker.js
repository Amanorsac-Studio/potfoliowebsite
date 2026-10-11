/* =====================================================================
   The affiliate programme  (supabase-affiliates.sql, affiliates.html,
   affiliate.html, portal/admin-affiliates.html)

   Everything that decides anything lives in the database functions;
   this is the part that needs the Worker's hands: it sends the email
   that each step deserves. Every call is made AS THE PERSON (their
   token, their RLS, the function's own admin check), so a route here
   cannot do anything the person could not do from the browser - it
   only adds the letter.

     POST /api/affiliate/apply    { name, links, audience, message,
                                    payout_method, payout_to }
                                  -> apply_affiliate; tells the studio
     POST /api/affiliate/decide   { id, decision: approve|decline,
                                    code, percent_off, commission_pct, note }
                                  -> approve_affiliate / decline_affiliate;
                                     tells the applicant       (admin)
     POST /api/affiliate/payout   { id, currency, method, reference, note }
                                  -> record_affiliate_payout; tells the
                                     affiliate                 (admin)
   ===================================================================== */
async function affiliateRoutes(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/affiliate/')) return null;
  if (request.method === 'OPTIONS') return storeSay({}, 204);
  if (request.method !== 'POST') return storeSay({ error: 'method' }, 405);

  const user = await storeUser(request);
  if (!user) return storeSay({ error: 'sign_in', message: 'Sign in first.' }, 401);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);

  // ---- apply ----
  if (path === '/api/affiliate/apply') {
    const r = await asUser(user, 'rpc/apply_affiliate', { method: 'POST', body: JSON.stringify({
      p_name: str(body.name, 80), p_links: str(body.links, 600), p_audience: str(body.audience, 400),
      p_message: str(body.message, 1200), p_payout_method: str(body.payout_method, 10), p_payout_to: str(body.payout_to, 120),
      p_video_url: str(body.video_url, 400), p_video_app: str(body.video_app, 40)
    }) });
    if (!r.ok) return storeSay({ error: 'refused', message: applyWords(r.body) }, 400);
    if (r.body && r.body.ok) {
      waitOn(ctx, mail(env, env.NOTIFY_TO || 'hello@amanorsac.studio',
        'Affiliate application: ' + str(body.name, 80),
        str(body.name, 80) + ' (' + user.email + ') applied to the affiliate programme.\n\n' +
        'Their video of ' + str(body.video_app, 40) + ': ' + str(body.video_url, 400) + '\n' +
        'Where they post: ' + str(body.links, 600) + '\n' +
        'Audience: ' + str(body.audience, 400) + '\n' +
        'Paid by: ' + str(body.payout_method, 10) + ' ' + str(body.payout_to, 120) + '\n\n' +
        (str(body.message, 1200) ? str(body.message, 1200) + '\n\n' : '') +
        'Decide at ' + SITE + '/portal/admin-affiliates.html\n'));
    }
    return storeSay(r.body || { ok: false });
  }

  // ---- the studio decides ----
  if (path === '/api/affiliate/decide') {
    const id = Number(body.id);
    if (!id) return storeSay({ error: 'bad_request', message: 'Which application?' }, 400);
    if (body.decision === 'approve') {
      const r = await asUser(user, 'rpc/approve_affiliate', { method: 'POST', body: JSON.stringify({
        p_id: id, p_code: str(body.code, 16),
        p_percent_off: Number.isFinite(Number(body.percent_off)) ? Number(body.percent_off) : 10,
        p_commission_pct: Number.isFinite(Number(body.commission_pct)) ? Number(body.commission_pct) : 20
      }) });
      if (!r.ok) return storeSay({ error: 'refused', message: dbWords(r.body) }, r.status === 401 ? 401 : 400);
      const a = r.body || {};
      const to = await emailOf(env, a.user_id);
      if (to) waitOn(ctx, sendAffiliateWelcome(env, to, a, Number(body.percent_off) || 10));
      return storeSay({ ok: true, affiliate: a, emailed: !!to });
    }
    if (body.decision === 'decline') {
      const r = await asUser(user, 'rpc/decline_affiliate', { method: 'POST', body: JSON.stringify({ p_id: id, p_note: str(body.note, 400) || null }) });
      if (!r.ok) return storeSay({ error: 'refused', message: dbWords(r.body) }, 400);
      return storeSay({ ok: true });
    }
    return storeSay({ error: 'bad_request', message: 'approve or decline.' }, 400);
  }

  // ---- money went out ----
  if (path === '/api/affiliate/payout') {
    const id = Number(body.id);
    if (!id) return storeSay({ error: 'bad_request', message: 'Which affiliate?' }, 400);
    const r = await asUser(user, 'rpc/record_affiliate_payout', { method: 'POST', body: JSON.stringify({
      p_id: id, p_currency: str(body.currency, 3).toLowerCase() || 'usd', p_method: str(body.method, 10),
      p_reference: str(body.reference, 120) || null, p_note: str(body.note, 400) || null
    }) });
    if (!r.ok) return storeSay({ error: 'refused', message: dbWords(r.body) }, 400);
    const pay = r.body || {};
    const who = await asService(env, 'affiliates?id=eq.' + id + '&select=user_id,name');
    const a = who.ok && who.body && who.body[0];
    const to = a ? await emailOf(env, a.user_id) : null;
    if (to) waitOn(ctx, sendAffiliatePayout(env, to, a.name, pay));
    return storeSay({ ok: true, payout: pay, emailed: !!to });
  }

  return storeSay({ error: 'not_found' }, 404);
}

function applyWords(body) {
  const m = String((body && body.message) || '');
  if (/name/.test(m)) return 'Tell us what to call you.';
  if (/payout_method/.test(m)) return 'Pick PayPal or MoMo.';
  if (/payout_to/.test(m)) return 'Where should the money go? A PayPal email or a MoMo number.';
  if (/video_url/.test(m)) return 'A link to your video, starting with https://.';
  if (/video_app/.test(m)) return 'Which product is the video about?';
  if (/sign in/.test(m)) return 'Sign in first.';
  return m || 'That did not go through.';
}
function dbWords(body) {
  const m = String((body && (body.message || body.error)) || '');
  return m.replace(/^.*?: /, '') || 'The database refused it.';
}

/* The email on an account, looked up as the Worker because an admin's
   token cannot read another person's auth row. */
async function emailOf(env, userId) {
  if (!isUuid(userId)) return null;
  const r = await asService(env, 'profiles?id=eq.' + userId + '&select=email');
  const e = r.ok && r.body && r.body[0] && r.body[0].email;
  return (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) ? e : null;
}

/* One plain letter, text and the same text in a quiet HTML wrapper.
   Every transactional letter the programme sends goes through here so
   the footer, the postal line and the from-address are in one place. */
async function mail(env, to, subject, text, cta) {
  if (!env.RESEND_API_KEY || !to) return false;
  const paras = text.trim().split(/\n\n+/).map(p =>
    '<p style="margin:0 0 16px;white-space:pre-line">' + esc(p) + '</p>').join('');
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;' +
      'margin:0 auto;padding:32px 24px;color:#1C1916;line-height:1.6;font-size:16px">' +
    paras +
    (cta ? '<p style="margin:4px 0 24px"><a href="' + esc(cta.href) + '" ' +
      'style="display:inline-block;background:#1C1916;color:#fff;text-decoration:none;' +
      'padding:13px 22px;border-radius:9px;font-weight:600">' + esc(cta.label) + '</a></p>' : '') +
    '<p style="margin:0;color:#6B655C;font-size:13px">Amanorsac Studio &middot; ' +
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a><br>' + POSTAL + '</p></div>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || 'Amanorsac Studio <hello@amanorsac.studio>',
        to: [to], subject: subject,
        text: text.trim() + '\n\n' + (cta ? cta.href + '\n\n' : '') + POSTAL + '\n' + SITE + '\n',
        html: html
      })
    });
    return r.ok;
  } catch (e) { return false; }
}

async function sendAffiliateWelcome(env, to, a, percentOff) {
  const code = a.code, pct = a.commission_pct || 20;
  const text =
    'Hi ' + (a.name || '') + ',\n\n' +
    'You are in. Your code is ' + code + '.\n\n' +
    'Anyone who types it at checkout gets ' + percentOff + '% off, and you earn ' + pct + '% of what they pay. ' +
    'The same code works as a link: add ?ref=' + code + ' to any app page, for example ' +
    SITE + '/chordlight88?ref=' + code + ' - the code is remembered for thirty days and applied for them.\n\n' +
    'Your dashboard shows clicks, sales and what you are owed. Earnings clear fourteen days after the sale ' +
    '(the refund window) and are paid once a month by ' + (a.payout_method === 'momo' ? 'MoMo' : 'PayPal') +
    ' once they reach $25.\n\n' +
    'Two rules that matter: say that it is an affiliate link wherever you share it (a line like ' +
    '"affiliate link, I earn a commission" is enough - the FTC and the platforms require it), and never ' +
    'post the code on coupon sites or bid on the studio’s name in ads. The full terms are at ' +
    SITE + '/legal.html#affiliates.\n\n' +
    'Thank you for sending people our way.\n\nStephen';
  return mail(env, to, 'Welcome to the Amanorsac affiliate programme - your code is ' + code, text,
    { href: SITE + '/affiliate.html', label: 'Open your dashboard' });
}

async function sendAffiliatePayout(env, to, name, pay) {
  const amt = (pay.currency || 'usd').toUpperCase() + ' ' + (Number(pay.amount_cents || 0) / 100).toFixed(2);
  const text =
    'Hi ' + (name || '') + ',\n\n' +
    'Your affiliate payout of ' + amt + ' went out today by ' + (pay.method === 'momo' ? 'MoMo' : 'PayPal') +
    (pay.reference ? ' (reference ' + pay.reference + ')' : '') + '.\n\n' +
    'The sales it covers are marked paid on your dashboard. If it has not arrived in a few days, reply to this email.\n\n' +
    'Stephen';
  return mail(env, to, 'Your Amanorsac affiliate payout: ' + amt, text,
    { href: SITE + '/affiliate.html', label: 'See your dashboard' });
}

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
/* The studio's postal address. Every email the Worker sends carries it,
   because a commercial email without a physical address is unlawful in
   the US (CAN-SPAM) and looks like spam everywhere else. */
const POSTAL = 'Amanorsac Studio, 212 Copeley Road, Charlottesville, VA 22903, United States';

export default {
  async fetch(request, env, ctx) {
    try {
      /* The store: uploads from creators, manifests and stems for
         PerformLive, cover art. All under three prefixes, answered
         before anything else so a PUT of a fifty-megabyte part never
         wanders into the asset layer. */
      const store = await storeRoutes(request, env, ctx);
      if (store) return store;

      /* The affiliate programme: an application, the studio's decision,
         a payout. Three doors, each a database call made as the person
         plus the email the call deserves. */
      const aff = await affiliateRoutes(request, env, ctx);
      if (aff) return aff;

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

        /* The Studio Bundle moved out of the store and onto its own page
           next to the apps it is made of. Old links and the tiles people
           already shared still land on it. */
        if (path === '/store/package' || path === '/store/package/' || path === '/store/package.html') {
          return Response.redirect(SITE + '/studiobundle', 301);
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
          const file = await serveHub(h[1], env, request, ctx);
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
    /* Two triggers in wrangler.jsonc. The daily jobs keep their old
       slot (15:00 UTC); the studio news letter is checked on both, and
       sends nothing until the time written in the catalog has passed. */
    if (!event || !event.cron || event.cron === '0 15 * * *') {
      ctx.waitUntil(sendReviewInvites(env));
      ctx.waitUntil(sendUpdateNotices(env));
    }
    ctx.waitUntil(sendAnnouncement(env));
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
                         'mac-x64': 'Mac (Intel)',
                         'windows-portable': 'Windows (portable)',
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
    POSTAL + '\n' + SITE + '\n';

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
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a><br>' + POSTAL + '</p></div>';

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
  if (!app || code.length < 4) return say({ ok: false, error: 'not_a_code' });

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

  const usdBefore = effectiveCents(entry, c);
  const usdAfter  = applyDiscount(usdBefore, d);

  /* And the same discount in the local currency, when Paystack is the
     one that would be charging. Worked out from the discounted dollar
     price rather than by discounting the local one twice. */
  const pay = c.paystack;
  const country = (request.headers.get('cf-ipcountry') || '').toUpperCase();
  let local = null;
  if (pay && pay.live && (pay.countries || []).includes(country)) {
    const before = paystackAmount(pay, { price_cents: usdBefore });
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
  let platform = String(body.platform || '').toLowerCase().slice(0, 20);
  const catalog = await getCatalog(env);
  /* An app with separate Apple silicon and Intel builds has no plain
     "mac" installer, but the Hub asks for "mac". It may say which chip
     (arch, from the next Hub build on); without that, Apple silicon is
     the better guess for any Mac sold since 2020 - the same call the
     Hub's own installer makes - and My Apps on the site offers the
     Intel build by name. */
  if (platform === 'mac') {
    const inst = (catalog.apps && catalog.apps[app] && catalog.apps[app].installers) || {};
    if (!inst.mac) {
      const arch = String(body.arch || '').toLowerCase();
      platform = (arch === 'x64' && inst['mac-x64']) ? 'mac-x64' : (inst['mac-arm64'] ? 'mac-arm64' : 'mac');
    }
  }
  const item = installerFor(catalog, app, platform);
  if (!item) return say({ error: 'no_such_download', message: 'No such download.' }, 404);

  /* An app the studio has taken off the shelf sells nothing and hands
     nothing to a stranger - the buttons on the site already know, but
     the buttons are not the lock: a paused app still has its files in
     the bucket and its address is still a sentence anybody can type.

     But it hands it to somebody who already BOUGHT it, and the check
     therefore moves below the ownership test rather than above it.
     legal.html says, in as many words: "If a product you have bought is
     withdrawn, your licence still works and you can still download it
     from My Apps." Refusing an owner here would have made that sentence
     false the first time an app was pulled - and a paid app is exactly
     when somebody needs their copy back, because it is the moment they
     can no longer buy another.

     The beta licence below is still reached only by people this lets
     through, so a paused beta cannot quietly start somebody's thirty
     days on a build they cannot have: a non-owner is turned away by the
     block further down before any of it means anything. */
  const state = (catalog.apps || {})[app];
  const pulled = !!(state && state.status && state.status !== 'available');

  /* An open beta has no purchase to grant access, so the licence is
     minted here - at the moment somebody actually downloads it, which is
     when the clock should start. claim_beta_license is idempotent and
     never extends, so a second download returns the same key with the
     same end date. If it fails the ownership check below simply says no,
     which is the right answer rather than a broken download. */
  const entry = (catalog.apps || {})[app];
  if (!pulled && entry && entry.free && entry.licensed && entry.beta_days) {
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
  /* Withdrawn, and not theirs. This is the wall for everybody else, and
     it is deliberately the same answer a stranger gets for any app they
     do not own - a pulled app should not be advertised by the shape of
     its refusal. */
  if (pulled && !owned) {
    return say({ error: 'not_available',
                 message: state.soon_note ||
                   appTitle(catalog, app) + ' is not available to download right now.' }, 403);
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
async function serveHub(platform, env, request, ctx) {
  const catalog = await getCatalog(env);
  const item = hubInstallerFor(catalog, platform);
  if (!item || !env.DOWNLOADS) return null;

  let object = null;
  for (const key of item.keys) {
    object = await env.DOWNLOADS.get(key, { range: request.headers, onlyIf: request.headers });
    if (object) break;
  }
  if (!object) {
    /* Said as a page, not as an error: a link that starts a download
       and then answers 5xx is shown by the browser as "file wasn't
       available on site", and the explanation underneath is never
       read. As a 200 the person sees it, and the fix is on it. */
    console.error('hub installer missing in R2 for', platform, '- looked for', item.keys.join(', '));
    return confirmPage('Amanorsac Hub isn’t here yet.',
      'The installer for ' + (PLATFORM_LABEL[platform === 'mac' ? 'mac-arm64' : platform] || platform) +
      ' has not been uploaded. It should be at ' + item.keys[0] + ' in the amanorsac-downloads bucket. Try again shortly.',
      null, 200);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('content-type', item.type);
  headers.set('content-disposition', 'attachment; filename="' + item.as + '"');
  headers.set('cache-control', 'public, max-age=300');
  headers.set('accept-ranges', 'bytes');
  const partial = object.range && ('body' in object);

  /* Count it, as app 'hub' with source 'site': the one download that
     never passes through a ticket, so it was the one nobody counted.
     Whole transfers only - a range request is a resume of one already
     counted. Never awaited into the answer. */
  if (!request.headers.has('range') && env.SUPABASE_SERVICE_KEY) {
    const count = fetch(SUPABASE_URL + '/rest/v1/rpc/record_app_download', {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ p_app: 'hub', p_platform: platform, p_version: item.version || null,
                             p_source: 'site', p_country: request.headers.get('cf-ipcountry') || null })
    }).then(r => { if (!r.ok) return r.text().then(t => console.error('record_app_download (hub) refused:', r.status, t)); })
      .catch(e => console.error('record_app_download (hub) failed:', e && e.message));
    if (ctx) waitOn(ctx, count); else count.catch(() => {});
  }
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
/* The price right now. price_cents is the price while the app's promo
   (or the site's) is live; after its deadline list_price_cents is the
   price again, with no edit at the stroke of the hour. The same rule
   lives in assets/store-state.js (priceOf) and the checkout functions. */
function effectiveCents(entry, catalog) {
  if (!entry || entry.free) return 0;
  const promo = entry.promo || (catalog && catalog.promo);
  const over = !!(promo && promo.ends && Date.parse(promo.ends) <= Date.now());
  if (over && entry.list_price_cents > entry.price_cents) return entry.list_price_cents;
  return entry.price_cents || 0;
}

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

  const local = (pay && pay.live) ? paystackAmount(pay, app && !app.pay_what_you_want ? Object.assign({}, app, { price_cents: effectiveCents(app, c) }) : app) : null;
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

  /* MTN MoMo at the studio's own request link (catalog momo.countries;
     empty means every paid app page, everywhere): the buyer
     pays, sends the screenshot, and a code comes back. Same manual
     road as WhatsApp, with the wallet in front of the conversation. */
  const mm = c.momo || null;
  const mmCountries = (mm && mm.countries) || [];
  const mmHere = !!(mm && mm.live && mm.url && app && !app.free &&
                    (!mmCountries.length || (known && mmCountries.includes(country))));

  return new Response(JSON.stringify({
    country: known ? country : null,
    /* Which one leads. Where Paystack works it leads and the card is
       the quiet second door; everywhere else there is only the card. */
    first: (here && local) ? 'paystack' : 'stripe',
    offer,
    momo: mmHere ? {
      url: mm.url, number: mm.number || '', name: mm.name || '', qr: mm.qr || null,
      whatsapp: mm.whatsapp || (wa && wa.url) || null
    } : null,
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
    /* an app's own sale (an early bird on a release) counts the same
       as the site-wide one, deadline and all */
    const own = a.promo ? !!salePromo({ promo: a.promo }) : false;
    apps[id] = {
      name: a.name, vendor: a.vendor || 'Amanorsac Studio', kind: a.kind || 'app', status: a.status || 'available',
      tagline: a.tagline || '', icon: abs(a.icon), art: abs(a.art), page: abs(a.page), color: a.color || null,
      soon_note: a.soon_note || null,
      free: !!a.free, price_cents: a.free ? 0 : (a.price_cents || null),
      list_price_cents: ((sale || own) && !a.free && a.list_price_cents > (a.price_cents || 0)) ? a.list_price_cents : null,
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
    POSTAL + '\n' + SITE + '\n';

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
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a><br>' + POSTAL + '</p></div>';

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

/* ---------------------------------------------------------------------
   studio news, to everyone with an account

   catalog.json carries at most one "studio_news" block (not the
   "announcement" block - that one is the Hub's in-app banner):

     "studio_news": {
       "id": "2026-10-studio-news",
       "send_after": "2026-10-07T09:59:00Z",
       "per_run": 100,
       "subject": "...", "intro": "...",
       "items": [ { "title": "...", "text": "...", "link": "/apps" } ],
       "signoff": "Stephen"
     }

   Nothing goes before send_after. After it, each cron run sends up to
   per_run letters to confirmed accounts that have not had this id and
   have not said stop (supabase-announcements.sql), until everyone has
   one. Delete the block, or set "paused": true, and nothing more goes.
   A new id is a new letter to everybody, so the id only changes when
   there is genuinely something new to say.

   Each person is marked before their letter leaves, exactly like the
   update notices: a run that dies or fires twice cannot send twice.
   --------------------------------------------------------------------- */
async function sendAnnouncement(env) {
  const catalog = await getCatalog(env);
  const a = catalog.studio_news;
  if (!a || a.paused || !a.id || !a.subject || !a.send_after) return;
  const when = Date.parse(a.send_after);
  if (!when || Date.now() < when) return;
  if (!env.SUPABASE_SERVICE_KEY || !env.RESEND_API_KEY || !env.DOWNLOAD_SECRET) {
    console.error('announcement: SUPABASE_SERVICE_KEY, RESEND_API_KEY or DOWNLOAD_SECRET not set, skipping');
    return;
  }
  const db = (fn, body) => fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
    body: JSON.stringify(body)
  });

  const limit = Math.max(1, Math.min(Number(a.per_run) || 100, 400));
  let people = [];
  try {
    const r = await db('announcement_candidates', { p_id: String(a.id), p_limit: limit });
    if (r.ok) people = await r.json();
    else { console.error('announcement_candidates refused:', r.status, await r.text()); return; }
  } catch (e) { console.error('announcement_candidates unreachable:', e && e.message); return; }

  let sent = 0;
  for (const row of people) {
    const email = String(row.email || '').toLowerCase();
    if (!looksLikeEmail(email)) continue;
    let mine = false;
    try {
      const r = await db('mark_announcement_sent', { p_id: String(a.id), p_email: email });
      if (r.ok) mine = (await r.json()) === true;
      else console.error('mark_announcement_sent refused:', email, r.status, await r.text());
    } catch (e) { console.error('mark_announcement_sent unreachable:', email, e && e.message); }
    if (!mine) continue;

    const sig = await sign(env.DOWNLOAD_SECRET, 'optout:' + email);
    const stop = SITE + '/notices/stop?e=' + encodeURIComponent(email) + '&s=' + sig;
    const mail = announcementEmail(a, stop);
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + env.RESEND_API_KEY },
        body: JSON.stringify({
          from: env.NOTIFY_FROM || 'Amanorsac Studio <hello@amanorsac.studio>',
          to: [email], subject: a.subject, text: mail.text, html: mail.html,
          headers: { 'List-Unsubscribe': '<' + stop + '>' }
        })
      });
      if (r.ok) sent++;
      else console.error('announcement failed to send:', email, r.status, await r.text());
    } catch (e) { console.error('announcement failed to send:', email, e && e.message); }
  }
  if (people.length) console.log('announcement', a.id, 'sent', sent, 'of', people.length);
}

/* The letter itself. Kept apart from the sending so it can be rendered
   on its own for a preview. Links in the catalog are site paths; they
   are made absolute here and nowhere else. */
function announcementEmail(a, stop) {
  const abs = l => !l ? '' : /^https:\/\//.test(l) ? l : SITE + (l.charAt(0) === '/' ? l : '/' + l);
  const items = Array.isArray(a.items) ? a.items : [];

  const text =
    (a.intro ? a.intro + '\n\n' : '') +
    items.map(it => (it.title || '') + '\n' + (it.text || '') + (it.link ? '\n' + abs(it.link) : '')).join('\n\n') +
    '\n\n' + (a.signoff ? a.signoff + '\n\n' : '') +
    'You are getting this because you ticked the box to hear from the studio when you ' +
    'signed up at amanorsac.studio. The studio writes only when there is something to say.\n' +
    'Rather not hear from the studio about news and updates? ' + stop + '\n\n' +
    POSTAL + '\n' + SITE + '\n';

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;' +
      'margin:0 auto;padding:32px 24px;color:#1C1916;line-height:1.6">' +
    '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6B655C">' +
      'Amanorsac Studio</p>' +
    '<p style="margin:0 0 14px;font-size:23px;font-weight:600;line-height:1.3">' + esc(a.heading || a.subject) + '</p>' +
    (a.intro ? '<p style="margin:0 0 26px">' + esc(a.intro) + '</p>' : '') +
    items.map(it =>
      '<div style="margin:0 0 22px;padding:0 0 22px;border-bottom:1px solid #E7E2DA">' +
        '<p style="margin:0 0 4px;font-size:17px;font-weight:600">' + esc(it.title || '') + '</p>' +
        '<p style="margin:0 0 8px;color:#3B362F">' + esc(it.text || '') + '</p>' +
        (it.link ? '<p style="margin:0"><a href="' + esc(abs(it.link)) + '" style="color:#1C1916;font-weight:600">' +
          esc(it.link_label || 'Have a look') + ' &rsaquo;</a></p>' : '') +
      '</div>').join('') +
    (a.signoff ? '<p style="margin:4px 0 26px">' + esc(a.signoff) + '</p>' : '') +
    '<p style="margin:0 0 8px;color:#6B655C;font-size:13.5px">You are getting this because you ticked the box to hear ' +
      'from the studio when you signed up at amanorsac.studio. The studio writes only when there is something to say.</p>' +
    '<p style="margin:0 0 18px;color:#6B655C;font-size:13.5px">' +
      '<a href="' + esc(stop) + '" style="color:#6B655C">Rather not hear from the studio about news and updates?</a></p>' +
    '<p style="margin:0;color:#6B655C;font-size:13px">Amanorsac Studio &middot; ' +
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a><br>' + POSTAL + '</p></div>';

  return { text, html };
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
    'No more emails about app updates or studio news will go to ' + email + '. Anything about a ' +
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
    POSTAL + '\n' + SITE + '\n';

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
      '<a href="' + SITE + '" style="color:#6B655C">amanorsac.studio</a><br>' + POSTAL + '</p></div>';

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
  ['/studiobundle','monthly', '0.7'],
  ['/easystems',  'monthly', '0.7'],
  ['/secondout',   'monthly', '0.7'],
  ['/ambanalog',   'monthly', '0.7'],
  ['/alignpro',    'monthly', '0.7'],
  ['/afdgate',     'monthly', '0.7'],
  ['/aether',      'monthly', '0.7'],
  ['/pulseroom',   'monthly', '0.7'],
  ['/nebulatide',  'monthly', '0.7'],
  ['/affiliates',  'monthly', '0.6'],
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


/* ---------------------------------------------------------------------
   the store

   Three jobs, all on this Worker because R2 is bound here and nowhere
   else:

     uploads    a creator's browser sends each stem in parts, straight
                into R2 under store/<version>/<slot>.wav. The browser
                never holds a bucket credential; it holds a Supabase
                session, and every call below checks that the session
                belongs to the creator who owns the version.

     manifests  GET /api/store/manifest/<version> is what PerformLive
                asks for after a purchase: the song, the sections, and
                a signed link for each of the ten tracks. The links are
                tickets, same as app installers - an hour, then gone.
                Access is decided by has_version_access in the database,
                which knows about rentals and their dates.

     files      GET /download/store/<version>/<slot> checks the ticket
                and streams the WAV out of R2, with Range support so a
                dropped download resumes.

   Nothing here trusts a request's word for who it is: the session is
   asked about at Supabase every time, and ownership and access are
   answered by row-level security and the two functions in
   supabase-store.sql.
   --------------------------------------------------------------------- */

const STORE_SLOTS = ['click', 'guide', 'drums', 'bass', 'keys', 'guitars', 'piano', 'aux_keys', 'horns', 'bgv'];
const STORE_TICKET_MINUTES = 60;
const STORE_PART_BYTES = 50 * 1024 * 1024;

function storeSay(obj, status) {
  // a 204 may not carry a body, and a preflight is one
  const r = withCors(new Response(status === 204 ? null : JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  }));
  r.headers.set('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  return r;
}

/* Who is asking. The token is shown to Supabase, not decoded here, so a
   forged or expired one is refused by the party that issued it. */
async function storeUser(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + jwt }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id, email: u.email || '', jwt } : null;
  } catch (e) { return null; }
}

/* A call to the database as the person (their RLS applies). */
async function asUser(user, path, init) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, init, {
    headers: Object.assign({ 'content-type': 'application/json', apikey: SUPABASE_KEY,
                             Authorization: 'Bearer ' + user.jwt }, (init && init.headers) || {})
  }));
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body };
}

/* A call as the Worker itself (no RLS). Only for writes the browser must
   not be able to make - track rows - and reads of things the shelf does
   not show, such as a submitted version the studio is reviewing. */
async function asService(env, path, init) {
  if (!env.SUPABASE_SERVICE_KEY) return { ok: false, status: 503, body: 'no service key' };
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, init, {
    headers: Object.assign({ 'content-type': 'application/json', apikey: env.SUPABASE_SERVICE_KEY,
                             Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY }, (init && init.headers) || {})
  }));
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body };
}

const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

/* The version, if this person may edit it: theirs, and not yet on the
   shelf. Everything an upload does starts here. */
async function editableVersion(user, versionId) {
  if (!isUuid(versionId)) return null;
  const v = await asUser(user, 'store_versions?id=eq.' + versionId + '&select=id,creator_slug,status,kind');
  const row = v.ok && Array.isArray(v.body) && v.body[0];
  if (!row) return null;
  if (row.status !== 'draft' && row.status !== 'rejected') return null;
  const own = await asUser(user, 'rpc/owns_creator', { method: 'POST', body: JSON.stringify({ p_slug: row.creator_slug }) });
  return own.ok && own.body === true ? row : null;
}

async function storeRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const api = path.startsWith('/api/store/');
  if (!api && !path.startsWith('/download/store/') && !path.startsWith('/store-art/')) return null;

  if (request.method === 'OPTIONS') return storeSay({}, 204);

  // ---- cover art, public, cached ----
  const art = path.match(/^\/store-art\/([0-9a-f-]{36})$/i);
  if (art && request.method === 'GET') {
    if (!env.DOWNLOADS) return null;
    const obj = await env.DOWNLOADS.get('store/' + art[1].toLowerCase() + '/art');
    if (!obj) return null;
    const h = new Headers(); obj.writeHttpMetadata(h);
    h.set('cache-control', 'public, max-age=3600');
    h.set('etag', obj.httpEtag);
    return new Response(obj.body, { status: 200, headers: h });
  }

  // ---- a ticketed track ----
  const dl = path.match(/^\/download\/store\/([0-9a-f-]{36})\/([a-z_]+)$/i);
  if (dl && (request.method === 'GET' || request.method === 'HEAD')) {
    return await serveTrack(dl[1].toLowerCase(), dl[2], url, env, request);
  }

  if (!api) return null;
  if (!env.DOWNLOADS || !env.DOWNLOAD_SECRET) return storeSay({ error: 'unavailable', message: 'The store is not set up on this Worker yet.' }, 503);

  const user = await storeUser(request);
  if (!user) return storeSay({ error: 'sign_in', message: 'Sign in first.' }, 401);

  // ---- the library: what this account can open ----
  if (path === '/api/store/library' && request.method === 'GET') {
    const r = await asUser(user, 'rpc/store_library', { method: 'POST', body: '{}' });
    if (!r.ok) return storeSay({ error: 'upstream_error', message: String(r.body && r.body.message || r.body) }, 502);
    return storeSay({ items: (r.body || []).map(it => Object.assign({}, it, {
      manifest: SITE + '/api/store/manifest/' + it.version_id,
      art: it.art_key ? SITE + '/store-art/' + it.version_id : null
    })) });
  }

  // ---- the manifest ----
  const mf = path.match(/^\/api\/store\/manifest\/([0-9a-f-]{36})$/i);
  if (mf && request.method === 'GET') return await storeManifest(user, mf[1].toLowerCase(), env, request);

  // ---- uploads ----
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch (e) { body = {}; } }

  if (path === '/api/store/upload/start' && request.method === 'POST') {
    const v = await editableVersion(user, body.version);
    if (!v) return storeSay({ error: 'not_yours', message: 'That version is not yours to edit, or it is already submitted.' }, 403);
    const slot = String(body.slot || '');
    const isArt = slot === 'art';
    if (!isArt && STORE_SLOTS.indexOf(slot) < 0) return storeSay({ error: 'bad_slot', message: 'No such track slot.' }, 400);
    const key = 'store/' + v.id + '/' + (isArt ? 'art' : slot + '.wav');
    const type = isArt ? String(body.type || 'image/jpeg').slice(0, 60) : 'audio/wav';
    const mpu = await env.DOWNLOADS.createMultipartUpload(key, { httpMetadata: { contentType: type } });
    return storeSay({ key, upload_id: mpu.uploadId, part_bytes: STORE_PART_BYTES });
  }

  if (path === '/api/store/upload/part' && request.method === 'PUT') {
    const key = url.searchParams.get('key') || '', id = url.searchParams.get('id') || '';
    const n = parseInt(url.searchParams.get('n') || '0', 10);
    const m = key.match(/^store\/([0-9a-f-]{36})\/(art|[a-z_]+\.wav)$/i);
    if (!m || !id || !(n >= 1 && n <= 10000)) return storeSay({ error: 'bad_request' }, 400);
    if (!(await editableVersion(user, m[1]))) return storeSay({ error: 'not_yours' }, 403);
    try {
      const part = await env.DOWNLOADS.resumeMultipartUpload(key, id).uploadPart(n, request.body);
      return storeSay({ part_number: part.partNumber, etag: part.etag });
    } catch (e) {
      return storeSay({ error: 'part_failed', message: String(e && e.message) }, 502);
    }
  }

  if (path === '/api/store/upload/abort' && request.method === 'POST') {
    const key = String(body.key || ''), id = String(body.upload_id || '');
    const m = key.match(/^store\/([0-9a-f-]{36})\//i);
    if (!m || !id) return storeSay({ error: 'bad_request' }, 400);
    if (!(await editableVersion(user, m[1]))) return storeSay({ error: 'not_yours' }, 403);
    try { await env.DOWNLOADS.resumeMultipartUpload(key, id).abort(); } catch (e) {}
    return storeSay({ ok: true });
  }

  if (path === '/api/store/upload/complete' && request.method === 'POST') {
    const key = String(body.key || ''), id = String(body.upload_id || '');
    const m = key.match(/^store\/([0-9a-f-]{36})\/(art|([a-z_]+)\.wav)$/i);
    if (!m || !id || !Array.isArray(body.parts) || !body.parts.length) return storeSay({ error: 'bad_request' }, 400);
    const v = await editableVersion(user, m[1]);
    if (!v) return storeSay({ error: 'not_yours' }, 403);
    let obj;
    try {
      obj = await env.DOWNLOADS.resumeMultipartUpload(key, id)
        .complete(body.parts.map(p => ({ partNumber: Number(p.part_number), etag: String(p.etag) })));
    } catch (e) {
      return storeSay({ error: 'complete_failed', message: String(e && e.message) }, 502);
    }
    if (m[2] === 'art') {
      const r = await asService(env, 'store_versions?id=eq.' + v.id, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ art_key: key })
      });
      if (!r.ok) return storeSay({ error: 'db', message: String(r.body && r.body.message || r.body) }, 502);
      return storeSay({ ok: true, art: SITE + '/store-art/' + v.id });
    }
    const slot = m[3];
    const row = {
      version_id: v.id, slot, r2_key: key, bytes: obj.size, etag: obj.httpEtag,
      sample_rate: Number(body.sample_rate) || null, channels: Number(body.channels) || null,
      duration_seconds: Number(body.duration) || null, uploaded_at: new Date().toISOString()
    };
    const r = await asService(env, 'store_tracks?on_conflict=version_id,slot', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row)
    });
    if (!r.ok) return storeSay({ error: 'db', message: String(r.body && r.body.message || r.body) }, 502);
    return storeSay({ ok: true, slot, bytes: obj.size });
  }

  if (path === '/api/store/upload/remove' && request.method === 'POST') {
    const v = await editableVersion(user, body.version);
    const slot = String(body.slot || '');
    if (!v || STORE_SLOTS.indexOf(slot) < 0) return storeSay({ error: 'bad_request' }, 400);
    await env.DOWNLOADS.delete('store/' + v.id + '/' + slot + '.wav');
    await asService(env, 'store_tracks?version_id=eq.' + v.id + '&slot=eq.' + slot, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return storeSay({ ok: true });
  }

  return storeSay({ error: 'no_such_door' }, 404);
}

/* Everything PerformLive needs to build the song, for someone who may
   have it. The shape is documented in docs/performlive-store-integration.md
   and must not change without that file changing with it. */
async function storeManifest(user, versionId, env, request) {
  const access = await asUser(user, 'rpc/has_version_access', { method: 'POST', body: JSON.stringify({ p_version: versionId }) });
  if (!access.ok) return storeSay({ error: 'upstream_error', message: 'Could not check your account.' }, 502);
  if (access.body !== true) return storeSay({ error: 'not_owned', message: 'This account does not have that song.' }, 403);

  const [vr, tr, sr, pr] = await Promise.all([
    asService(env, 'store_versions?id=eq.' + versionId + '&select=*,store_songs(slug,title,writers),store_creators(slug,name,kind)'),
    asService(env, 'store_tracks?version_id=eq.' + versionId + '&select=slot,bytes,etag,sample_rate,channels,duration_seconds'),
    asService(env, 'store_sections?version_id=eq.' + versionId + '&select=position,name,seconds,bar&order=position'),
    asUser(user, 'store_purchases?version_id=eq.' + versionId + '&select=kind,expires_at,purchased_at&order=purchased_at.desc&limit=1')
  ]);
  const v = vr.ok && Array.isArray(vr.body) && vr.body[0];
  if (!v) return storeSay({ error: 'no_such_version' }, 404);

  const t = Date.now() + STORE_TICKET_MINUTES * 60 * 1000;
  const tracks = [];
  for (const row of (tr.ok && Array.isArray(tr.body) ? tr.body : [])) {
    const p = '/download/store/' + versionId + '/' + row.slot;
    tracks.push({
      slot: row.slot, order: STORE_SLOTS.indexOf(row.slot), format: 'wav',
      url: SITE + p + '?e=' + t + '&s=' + (await sign(env.DOWNLOAD_SECRET, p + ':' + t)),
      bytes: row.bytes, etag: row.etag, sample_rate: row.sample_rate, channels: row.channels,
      duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds)
    });
  }
  tracks.sort((a, b) => a.order - b.order);
  const purchase = pr.ok && Array.isArray(pr.body) && pr.body[0] || null;
  const song = v.store_songs || {}, maker = v.store_creators || {};

  return storeSay({
    manifest_version: 1,
    version_id: v.id,
    song: { id: v.song_id, slug: song.slug, title: song.title, writers: song.writers || null },
    version: { label: v.label, is_original: !!v.is_original, kind: v.kind, lane: v.lane,
               key: v.key, bpm: v.bpm == null ? null : Number(v.bpm), time_sig: v.time_sig || '4/4',
               length_seconds: v.length_seconds, year: v.year, album: v.album, feat: v.feat,
               youtube: v.youtube, art: v.art_key ? SITE + '/store-art/' + v.id : null },
    creator: { slug: maker.slug, name: maker.name, kind: maker.kind },
    licence: purchase
      ? { kind: purchase.kind, purchased_at: purchase.purchased_at, expires_at: purchase.expires_at || null }
      : { kind: 'owner', purchased_at: null, expires_at: null },
    slots: STORE_SLOTS,
    tracks,
    sections: (sr.ok && Array.isArray(sr.body) ? sr.body : []).map(x => ({
      position: x.position, name: x.name, seconds: Number(x.seconds), bar: x.bar
    })),
    links_expire_at: new Date(t).toISOString(),
    page: SITE + '/store/item?p=' + encodeURIComponent(song.slug || '')
  });
}

async function serveTrack(versionId, slot, url, env, request) {
  if (!env.DOWNLOADS || !env.DOWNLOAD_SECRET) return null;
  const expires = parseInt(url.searchParams.get('e') || '0', 10);
  const sig = url.searchParams.get('s') || '';
  if (!expires || Date.now() > expires) return null;
  const want = await sign(env.DOWNLOAD_SECRET, url.pathname + ':' + expires);
  if (!sameString(sig, want)) return null;
  if (STORE_SLOTS.indexOf(slot) < 0) return null;

  const object = await env.DOWNLOADS.get('store/' + versionId + '/' + slot + '.wav', { range: request.headers, onlyIf: request.headers });
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('content-type', 'audio/wav');
  headers.set('content-disposition', 'attachment; filename="' + slot + '.wav"');
  headers.set('cache-control', 'private, no-store');
  headers.set('accept-ranges', 'bytes');
  headers.set('access-control-allow-origin', '*');
  const partial = object.range && ('body' in object);
  return new Response(object.body, { status: partial && request.headers.has('range') ? 206 : 200, headers });
}
