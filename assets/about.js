/* The About page's moving parts.

   Everything here is decoration on top of a page that already reads in
   full without it: the section pill, the arrivals, the name drifting
   behind the figure, the pass on its lanyard, the periodic table, the
   things built and the count. The table and the work cards read the
   catalogue, so a new app appears here the day it appears in the store. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---- arrivals ---- */
  var arrive = function (el) { el.classList.add('in'); };
  if ('IntersectionObserver' in window && !still) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { arrive(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var watch = function (el) { io.observe(el); };
    $$('.ab [data-in]').forEach(watch);
  } else {
    $$('.ab [data-in]').forEach(arrive);
  }

  /* ---- the section pill follows the reader ---- */
  var links = $$('.ab-nav a');
  var bySec = {};
  links.forEach(function (a) { bySec[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var seen = {};
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { seen[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0; });
      var best = null, top = 0;
      Object.keys(seen).forEach(function (k) { if (seen[k] > top) { top = seen[k]; best = k; } });
      links.forEach(function (a) { a.classList.remove('on'); });
      if (best && bySec[best]) bySec[best].classList.add('on');
    }, { threshold: [0, 0.15, 0.3, 0.5, 0.7], rootMargin: '-20% 0px -40% 0px' });
    Object.keys(bySec).forEach(function (id) { var s = document.getElementById(id); if (s) so.observe(s); });
  }

  /* ---- the name drifts behind the figure ---- */
  var hero = $('.ab-hero'), name = $('.ab-name');
  if (hero && name && !still && matchMedia('(pointer:fine)').matches) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      name.style.setProperty('--px', (-x * 26).toFixed(1) + 'px');
      name.style.setProperty('--py', (-y * 12).toFixed(1) + 'px');
    });
    hero.addEventListener('pointerleave', function () {
      name.style.setProperty('--px', '0px'); name.style.setProperty('--py', '0px');
    });
  }

  /* ---- the pass: pull it and it swings back ---- */
  var sw = $('#ab-swing');
  if (sw && !still) {
    var held = false, x0 = 0, ang = 0, vel = 0, raf = 0;
    var put = function () { sw.style.transform = 'rotate(' + ang.toFixed(2) + 'deg)'; };
    var settle = function () {
      vel += -0.06 * ang; vel *= 0.94; ang += vel; put();
      if (Math.abs(ang) < 0.15 && Math.abs(vel) < 0.05) {
        sw.classList.remove('held'); sw.style.transform = ''; raf = 0; return;
      }
      raf = requestAnimationFrame(settle);
    };
    sw.addEventListener('pointerdown', function (e) {
      held = true; x0 = e.clientX; cancelAnimationFrame(raf); raf = 0;
      ang = 0; vel = 0; sw.classList.add('held'); put();
      sw.setPointerCapture && sw.setPointerCapture(e.pointerId);
    });
    sw.addEventListener('pointermove', function (e) {
      if (!held) return;
      var next = Math.max(-28, Math.min(28, (e.clientX - x0) / 6));
      vel = next - ang; ang = next; put();
    });
    var let_go = function () { if (!held) return; held = false; raf = requestAnimationFrame(settle); };
    sw.addEventListener('pointerup', let_go);
    sw.addEventListener('pointercancel', let_go);
  }

  /* ---- the periodic table ---- */
  var FAM = {
    studio: { label: 'Studio', c: '#1d2232', fg: '#fff' },
    stage: { label: 'Stage', c: '#8f8474', fg: '#fff' },
    apps: { label: 'Apps', c: '#b6ab9b', fg: '#16161a' },
    plugins: { label: 'Plug-ins', c: '#d6cdbf', fg: '#16161a' }
  };
  var CRAFT = [
    { s: 'Mx', n: 'Mixing', f: 'studio', d: 'Vocal-forward mixing for close harmony, gospel, highlife and live worship records.', href: 'mixing.html' },
    { s: 'Ms', n: 'Mastering', f: 'studio', d: 'Mastering on its own, or with the mix.', href: 'mixing.html' },
    { s: 'Pr', n: 'Production', f: 'studio', d: 'Worship records, live album productions and first releases with independent artists.' },
    { s: 'Br', n: 'Broadcast mix', f: 'studio', d: 'The broadcast mix for a multicultural congregation in Virginia, every week.' },
    { s: 'La', n: 'Live audio', f: 'studio', d: 'Live and broadcast audio for services and events.' },
    { s: 'Fs', n: 'Fender Studio Pro', f: 'studio', d: 'The DAW the Studio Bundle’s church template is built in.', href: 'studiobundle.html' },
    { s: 'Pn', n: 'Session piano', f: 'stage', d: 'Session piano for records and for services.' },
    { s: 'Kb', n: 'Keys', f: 'stage', d: 'Keyboard for churches and a live band, from Accra on.' },
    { s: 'Md', n: 'Music direction', f: 'stage', d: 'Music director, from churches in Accra to a multicultural congregation in Virginia.' },
    { s: 'Wr', n: 'Worship records', f: 'stage', d: 'Worship records and live album productions.' },
    { s: 'Ar', n: 'Artists', f: 'stage', d: 'Helping young, independent artists get their songs out of their heads and into the world.' }
  ];
  var SYM = { chordlight88: 'Cl', stemsorter: 'Ss', easystems: 'Es', nebulatide2: 'N2', nebulatide: 'Nt', performlive: 'Pl',
    pulseroom: 'Pu', harmoniemd: 'Hm', secondout: 'So', ambanalog: 'An', ambdigital: 'Dg', afdgate: 'Ag', aether: 'Ae', alignpro: 'Ap' };

  var grid = $('#pt-table'), detail = $('#ab-detail'), fams = $('#ab-fams');
  var els = [];

  function show(el) {
    if (!detail || !el) return;
    var f = FAM[el.f];
    detail.style.setProperty('--c', f.c); detail.style.setProperty('--fg', f.fg);
    detail.innerHTML =
      '<div class="big">' + (el.icon ? '<img src="' + esc(el.icon) + '" alt="">' : esc(el.s)) + '</div>' +
      '<p class="fam">' + esc(f.label) + (el.soon ? ' · coming soon' : '') + '</p>' +
      '<h3>' + esc(el.n) + '</h3><p>' + esc(el.d) + '</p>' +
      (el.href ? '<a href="' + esc(el.href) + '">' + (el.f === 'apps' || el.f === 'plugins' ? 'Open the page' : 'See more') + ' →</a>' : '');
  }

  function build(list) {
    els = list;
    grid.innerHTML = list.map(function (el, i) {
      var f = FAM[el.f], tag = el.href ? 'a' : 'div';
      return '<' + tag + ' class="ab-el" data-i="' + i + '" data-f="' + el.f + '"' + (el.href ? ' href="' + esc(el.href) + '"' : ' tabindex="0"') +
        ' style="--c:' + f.c + ';--fg:' + f.fg + '" aria-label="' + esc(el.n + ', ' + f.label) + '">' +
        '<span class="n">' + String(i + 1).padStart(2, '0') + '</span><span class="s">' + esc(el.s) + '</span><span class="w">' + esc(el.n) + '</span></' + tag + '>';
    }).join('');
    var counts = {};
    list.forEach(function (el) { counts[el.f] = (counts[el.f] || 0) + 1; });
    fams.innerHTML = Object.keys(FAM).map(function (k) {
      return '<button class="ab-fam" type="button" aria-pressed="false" data-f="' + k + '" style="--c:' + FAM[k].c + '"><i></i>' + FAM[k].label + ' <span style="opacity:.55">' + (counts[k] || 0) + '</span></button>';
    }).join('');
    var lead = $('#ab-pt-count');
    if (lead) lead.textContent = list.length + ' elements in four families. Point at a tile to see it, or pick a family to light it up.';
    show(list[0]);
  }

  if (grid) {
    grid.addEventListener('pointerover', function (e) { var t = e.target.closest('.ab-el'); if (t) show(els[+t.dataset.i]); });
    grid.addEventListener('focusin', function (e) { var t = e.target.closest('.ab-el'); if (t) show(els[+t.dataset.i]); });
    fams.addEventListener('click', function (e) {
      var b = e.target.closest('.ab-fam'); if (!b) return;
      var on = b.getAttribute('aria-pressed') !== 'true';
      $$('.ab-fam', fams).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      $$('.ab-el', grid).forEach(function (x) { x.classList.remove('lit'); });
      grid.classList.toggle('dim', on);
      if (on) {
        b.setAttribute('aria-pressed', 'true');
        var first = null;
        $$('.ab-el[data-f="' + b.dataset.f + '"]', grid).forEach(function (x) { x.classList.add('lit'); if (!first) first = x; });
        if (first) show(els[+first.dataset.i]);
      }
    });
    build(CRAFT.slice());
  }

  /* ---- the catalogue: the table's apps and plug-ins, the work, the count ---- */
  fetch('/catalog.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (cat) {
    var apps = cat.apps || {};
    var ids = Object.keys(apps).filter(function (id) {
      var a = apps[id];
      if (!a || a.status === 'hidden' || (a.kind !== 'app' && a.kind !== 'plugin')) return false;
      if (id === 'nebulatide' && apps.nebulatide2 && apps.nebulatide2.status !== 'hidden') return false;
      return true;
    });
    var made = ids.map(function (id) {
      var a = apps[id];
      return { id: id, s: SYM[id] || (a.name || id).replace(/[^A-Za-z]/g, '').slice(0, 2), n: a.name || id,
        f: a.kind === 'plugin' ? 'plugins' : 'apps', d: a.tagline || '', href: a.page || null, icon: a.icon || null,
        soon: a.status === 'coming_soon' };
    });
    if (grid) build(CRAFT.concat(made.filter(function (m) { return m.f === 'apps'; }), made.filter(function (m) { return m.f === 'plugins'; })));

    var released = made.filter(function (m) { return !m.soon; }).length;
    var cnt = $('#ab-count');
    if (cnt && released) cnt.textContent = released;
    var tag = $('#ab-built-tag');
    if (tag && released) tag.textContent = released + ' released, more on the way';

    var work = $('#ab-work');
    if (work) {
      var pick = made.filter(function (m) { return !m.soon; }).slice(0, 7);
      work.insertAdjacentHTML('beforeend', pick.map(function (m) {
        return '<a class="ab-card" href="' + esc(m.href || 'apps.html') + '">' +
          '<span class="ic">' + (m.icon ? '<img src="' + esc(m.icon) + '" alt="" loading="lazy">' : '') + '</span>' +
          '<span class="kind">' + (m.f === 'plugins' ? 'Plug-in' : 'App') + '</span>' +
          '<h3>' + esc(m.n) + '</h3><p>' + esc(m.d) + '</p><span class="go">See ' + esc(m.n) + ' →</span></a>';
      }).join(''));
    }
  }).catch(function () { /* the page reads in full without the catalogue */ });
})();
