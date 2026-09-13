/* =====================================================================
   One Supabase client for the whole page.

   Four separate files used to call createClient for themselves -
   site-auth.js, app-purchase.js, app-reviews.js by way of its own
   fetches, portal.js, and my-apps.html inline. On a product page that
   meant two or three clients in one tab, each with its own auth
   listener, all writing the same localStorage key. The browser says so
   out loud: "Multiple GoTrueClient instances detected in the same
   browser context." They can and do disagree about who is signed in.

   Everything now asks here and gets the same one back.

       var sb = window.amanorsacClient();

   Loaded after assets/vendor/supabase-<version>.js and before anything
   that needs a client.
   ===================================================================== */
(function () {
  var URL = 'https://kdxckigyhpnwhwgjdgqq.supabase.co';
  /* Publishable, and public on purpose: it is the key the browser is
     meant to hold. Every table it can reach is governed by row-level
     security, and nothing it can do is anything a signed-in visitor
     could not already do. The service key lives only in the Worker. */
  var KEY = 'sb_publishable_PlVBmRgFdhTkVMurXLiBFQ_NjiVssQp';

  var one = null;
  window.amanorsacClient = function () {
    if (one) return one;
    if (!window.supabase || !window.supabase.createClient) return null;
    one = window.supabase.createClient(URL, KEY);
    return one;
  };
  window.AMANORSAC_SUPABASE = { url: URL, key: KEY };
})();
