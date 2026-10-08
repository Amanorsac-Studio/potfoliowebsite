/* The About page's moving parts.

   Everything here is decoration on top of a page that already reads in
   full without it. In order of the page:

     the hero arriving in layers, then parting as you scroll
     the section pill, with one dark lozenge that slides between sections
     the studio pass dropping on its lanyard, swinging, tilting to the pointer
     the periodic table, its tiles flipping up, the detail popping
     things built: tall panels that open where you point
     services: a dark bar that slides down the list as you read or point
     the journey line drawing itself, each stop lighting as you reach it
     the moments dealt in, their numbers counting up

   The table and the panels read the catalogue, so a new app appears here
   the day it appears in the store. Anyone who has asked their system for
   less motion gets the finished page with nothing moving. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(pointer:fine)').matches;
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var main = $('.ab');
  if (!main) return;

  /* ---- the hero arrives ---- */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      main.classList.remove('boot');
      setTimeout(function () { main.classList.add('ready'); }, 1700);
    });
  });

  /* ---- arrivals: everything marked data-in, data-drop rises or drops once ---- */
  var arrived = [];
  var onArrive = function (el) {
    el.classList.add('in');
    arrived.forEach(function (fn) { fn(el); });
  };
  var targets = $$('.ab [data-in], .ab [data-drop]');
  if ('IntersectionObserver' in window && !still) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { onArrive(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    targets.forEach(function (el) { io.observe(el); });
  } else {
    targets.forEach(onArrive);
  }

  /* ---- the section pill: a lozenge that slides to the section in view ---- */
  var nav = $('.ab-nav'), ul = nav && $('ul', nav);
  var links = $$('.ab-nav a');
  var bySec = {};
  links.forEach(function (a) { bySec[a.getAttribute('href').slice(1)] = a; });
  function place(a) {
    if (!ul) return;
    if (!a) { ul.style.setProperty('--o', 0); return; }
    // measured against the list itself: each link sits in its own li
    var left = a.getBoundingClientRect().left - ul.getBoundingClientRect().left + ul.scrollLeft - ul.clientLeft;
    ul.style.setProperty('--x', left.toFixed(1) + 'px');
    ul.style.setProperty('--w', a.offsetWidth + 'px');
    ul.style.setProperty('--o', 1);
    // keep the active link in view when the pill scrolls sideways on a phone
    if (ul.scrollWidth > ul.clientWidth) {
      var want = left - (ul.clientWidth - a.offsetWidth) / 2;
      ul.scrollTo({ left: want, behavior: still ? 'auto' : 'smooth' });
    }
  }
  if (nav) nav.classList.add('sliding');
  if ('IntersectionObserver' in window) {
    var seen = {};
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { seen[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0; });
      var best = null, top = 0;
      Object.keys(seen).forEach(function (k) { if (seen[k] > top) { top = seen[k]; best = k; } });
      links.forEach(function (a) { a.classList.remove('on'); });
      var a = best && bySec[best];
      if (a) a.classList.add('on');
      place(a);
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75], rootMargin: '-25% 0px -45% 0px' });
    Object.keys(bySec).forEach(function (id) { var s = document.getElementById(id); if (s) so.observe(s); });
    window.addEventListener('resize', function () { place($('.ab-nav a.on')); });
  }

  /* ---- the hero parts as you scroll: the name rises and fades, the figure lags ---- */
  var hero = $('.ab-hero'), name = $('.ab-name'), fig = $('.ab-figure'), title = $('.ab-title');
  if (hero && !still) {
    var ticking = false;
    var onScroll = function () {
      ticking = false;
      var h = hero.offsetHeight || 1, y = Math.min(window.scrollY, h);
      var k = y / h;
      if (name) { name.style.setProperty('--fade', (1 - k * 1.1).toFixed(3)); name.style.setProperty('--py', (-y * 0.35).toFixed(1) + 'px'); }
      if (title) title.style.setProperty('--lead', (-y * 0.08).toFixed(1) + 'px');
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();
    if (name && fine) {
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        name.style.setProperty('--px', (-((e.clientX - r.left) / r.width - 0.5) * 26).toFixed(1) + 'px');
      });
      hero.addEventListener('pointerleave', function () { name.style.setProperty('--px', '0px'); });
    }
  }

  /* ---- the pass: pull it and it swings back; it tilts toward the pointer ---- */
  var sw = $('#ab-swing'), pass = $('#ab-pass');
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
      if (sw.setPointerCapture) sw.setPointerCapture(e.pointerId);
    });
    sw.addEventListener('pointermove', function (e) {
      if (held) {
        var next = Math.max(-28, Math.min(28, (e.clientX - x0) / 6));
        vel = next - ang; ang = next; put();
        return;
      }
      if (!pass || !fine) return;
      var r = pass.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      pass.style.setProperty('--ry', ((px - 0.5) * 18).toFixed(2) + 'deg');
      pass.style.setProperty('--rx', ((0.5 - py) * 14).toFixed(2) + 'deg');
      pass.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      pass.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      pass.style.setProperty('--go', 1);
    });
    sw.addEventListener('pointerleave', function () {
      if (!pass) return;
      pass.style.setProperty('--rx', '0deg'); pass.style.setProperty('--ry', '0deg'); pass.style.setProperty('--go', 0);
    });
    var letGo = function () { if (!held) return; held = false; raf = requestAnimationFrame(settle); };
    sw.addEventListener('pointerup', letGo);
    sw.addEventListener('pointercancel', letGo);
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
  var els = [], shown = null;

  function show(el) {
    if (!detail || !el || el === shown) return;
    shown = el;
    var f = FAM[el.f];
    detail.style.setProperty('--c', f.c); detail.style.setProperty('--fg', f.fg);
    detail.innerHTML =
      '<div class="big">' + (el.icon ? '<img src="' + esc(el.icon) + '" alt="">' : esc(el.s)) + '</div>' +
      '<p class="fam">' + esc(f.label) + (el.soon ? ' · coming soon' : '') + '</p>' +
      '<h3>' + esc(el.n) + '</h3><p>' + esc(el.d) + '</p>' +
      (el.href ? '<a href="' + esc(el.href) + '">' + (el.f === 'apps' || el.f === 'plugins' ? 'Open the page' : 'See more') + ' →</a>' : '');
    if (!still) { detail.classList.remove('pop'); void detail.offsetWidth; detail.classList.add('pop'); }
  }

  function build(list) {
    els = list; shown = null;
    grid.innerHTML = list.map(function (el, i) {
      var f = FAM[el.f], tag = el.href ? 'a' : 'div';
      return '<' + tag + ' class="ab-el" data-i="' + i + '" data-f="' + el.f + '"' + (el.href ? ' href="' + esc(el.href) + '"' : ' tabindex="0"') +
        ' style="--c:' + f.c + ';--fg:' + f.fg + ';--i:' + i + '" aria-label="' + esc(el.n + ', ' + f.label) + '">' +
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

  if (grid && detail && fams) {
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

  /* ---- things built: the panel you point at opens ---- */
  var acc = $('#ab-work');
  function wirePanels() {
    if (!acc) return;
    var panels = $$('.ab-panel', acc);
    panels.forEach(function (p, i) { p.style.setProperty('--i', i); });
    var open = function (p) { panels.forEach(function (x) { x.classList.toggle('open', x === p); }); };
    panels.forEach(function (p) {
      p.addEventListener('pointerenter', function () { if (fine) open(p); });
      p.addEventListener('focus', function () { open(p); });
      p.addEventListener('click', function (e) {
        // on a touch screen the first tap opens the panel, the second follows the link
        if (!fine && !p.classList.contains('open') && innerWidth > 900) { e.preventDefault(); open(p); }
      });
    });
  }

  /* ---- the catalogue: table tiles, panels, the count ---- */
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
        art: a.art || null, soon: a.status === 'coming_soon' };
    });
    if (grid && detail && fams) build(CRAFT.concat(made.filter(function (m) { return m.f === 'apps'; }), made.filter(function (m) { return m.f === 'plugins'; })));

    var released = made.filter(function (m) { return !m.soon; });
    var cnt = $('#ab-count');
    if (cnt && released.length) { cnt.setAttribute('data-count', released.length); cnt.textContent = released.length; }
    var tag = $('#ab-built-tag');
    if (tag && released.length) tag.textContent = released.length + ' released, more on the way';

    if (acc) {
      var first = $('.ab-panel', acc);
      if (first) first.classList.add('dark');
      acc.insertAdjacentHTML('beforeend', released.slice(0, 7).map(function (m, i) {
        return '<a class="ab-panel" href="' + esc(m.href || 'apps.html') + '"' + (m.art ? ' style="--art:url(\'/' + esc(m.art).replace(/^\//, '') + '\')"' : '') + '>' +
          '<span class="vt"><b>' + String(i + 2).padStart(2, '0') + '</b>' + esc(m.n) + '</span>' +
          '<span class="pc">' + (m.icon ? '<span class="ic"><img src="' + esc(m.icon) + '" alt="" loading="lazy"></span>' : '') +
          '<span class="kind">' + (m.f === 'plugins' ? 'Plug-in' : 'App') + '</span>' +
          '<span class="h">' + esc(m.n) + '</span><span class="t">' + esc(m.d) + '</span>' +
          '<span class="go">See ' + esc(m.n) + ' &rarr;</span></span><span class="art"></span></a>';
      }).join(''));
    }
    wirePanels();
  }).catch(function () { wirePanels(); });

  /* ---- services: the bar follows the pointer, or the reader ---- */
  var list = $('#ab-list');
  if (list) {
    var rows = $$('li', list), pointed = null;
    var mark = function (li) {
      rows.forEach(function (r) { r.classList.toggle('on', r === li); });
      if (!li) { list.style.setProperty('--bo', 0); return; }
      list.style.setProperty('--by', li.offsetTop + 'px');
      list.style.setProperty('--bh', li.offsetHeight + 'px');
      list.style.setProperty('--bo', 1);
    };
    rows.forEach(function (li) {
      li.addEventListener('pointerenter', function () { pointed = li; mark(li); });
      li.addEventListener('focusin', function () { pointed = li; mark(li); });
    });
    list.addEventListener('pointerleave', function () { pointed = null; follow(); });
    var follow = function () {
      if (pointed) return;
      var mid = innerHeight * 0.48, best = null, bd = 1e9;
      rows.forEach(function (li) {
        var r = li.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bd) { bd = d; best = li; }
      });
      var lr = list.getBoundingClientRect();
      mark(lr.bottom < 0 || lr.top > innerHeight ? null : best);
    };
    var lt = false;
    window.addEventListener('scroll', function () { if (!lt) { lt = true; requestAnimationFrame(function () { lt = false; follow(); }); } }, { passive: true });
    follow();
    // choosing a service fills in the form at the bottom
    list.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-svc]'); if (!a) return;
      var sel = $('#service');
      if (sel) { sel.value = a.getAttribute('data-svc'); }
      setTimeout(function () { var m = $('#message'); if (m) m.focus({ preventScroll: true }); }, 700);
    });
  }

  /* ---- the journey: the line draws with the reader, the stops light up ---- */
  var time = $('#ab-time');
  if (time) {
    var line = $('.ab-line', time), steps = $$('.ab-step', time);
    var draw = function () {
      var r = time.getBoundingClientRect(), mid = innerHeight * 0.6;
      var p = still ? 1 : Math.max(0, Math.min(1, (mid - r.top) / (r.height || 1)));
      if (line) line.style.setProperty('--p', p.toFixed(3));
      steps.forEach(function (s) { s.classList.toggle('on', still || s.getBoundingClientRect().top < mid); });
    };
    var jt = false;
    window.addEventListener('scroll', function () { if (!jt) { jt = true; requestAnimationFrame(function () { jt = false; draw(); }); } }, { passive: true });
    window.addEventListener('resize', draw);
    draw();
  }

  /* ---- moments: dealt in, numbers counting up ---- */
  var moments = $('.ab-moments');
  if (moments) $$('.ab-mo', moments).forEach(function (m, i) { m.style.setProperty('--i', i); });
  arrived.push(function (el) {
    if (el !== moments) return;
    $$('[data-count]', el).forEach(function (n, i) {
      var to = +n.getAttribute('data-count') || 0, suf = n.getAttribute('data-suffix') || '';
      if (still || !to) { n.textContent = to + suf; return; }
      var t0 = null, dur = 1300 + i * 120;
      n.textContent = '0' + suf;
      var step = function (t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0 - i * 110) / dur);
        if (k < 0) { requestAnimationFrame(step); return; }
        var e = 1 - Math.pow(1 - k, 4);
        n.textContent = Math.round(to * e) + suf;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
  // anything that arrived before the hook above was registered
  if (moments && moments.classList.contains('in')) arrived.forEach(function (fn) { fn(moments); });
})();
