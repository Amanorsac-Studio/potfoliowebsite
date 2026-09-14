/* =====================================================================
   Which state an app is in, here.

   catalog.json carries two answers for an app: "status", which is what
   the live site says, and "preview_status", which a workers.dev preview
   build uses instead when it is present. That is how something can be
   coming_soon in public while being fully on sale on a preview link,
   without keeping two copies of the catalog and hand-merging them.

   Everything that cares - the store's badges, the buy button - asks
   this file rather than reading status directly, so there is one rule
   in one place.

   Four states are in use: "available", "coming_soon", "hidden", which
   takes the app off the shelf entirely rather than badging it - for a
   product that is finished but is not to be named in public yet - and
   "withdrawn", a released app whose build has been taken down while
   something is fixed. Only "withdrawn" stops the Worker handing the
   file over; a hidden app's link has to keep working, because that is
   how it is shown to the people who are meant to see it.
   ===================================================================== */
(function () {
  var PREVIEW = /\.workers\.dev$/i.test(location.hostname);

  function stateOf(app) {
    if (!app) return 'available';
    if (PREVIEW && app.preview_status) return app.preview_status;
    return app.status || 'available';
  }

  var pending = null;
  function catalog() {
    if (!pending) {
      pending = fetch('/catalog.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : { apps: {} }; })
        .catch(function () { return { apps: {} }; });
    }
    return pending;
  }

  /* Resolve one app's state. Never rejects: if the catalog cannot be
     read, the page keeps whatever it was built with rather than
     collapsing into "coming soon" over a dropped request. */
  function state(id) {
    return catalog().then(function (c) {
      var a = (c.apps || {})[String(id || '').toLowerCase()];
      return a ? stateOf(a) : null;
    });
  }

  window.StoreState = { preview: PREVIEW, state: state, catalog: catalog, stateOf: stateOf };
})();
