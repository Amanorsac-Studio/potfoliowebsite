/* =====================================================================
   Charts for the studio's own pages. Inline SVG, no library: nothing
   to fetch, nothing to allow in the security policy, and every colour
   is read from the page's tokens so light and dark both work.

     Charts.line(el, { days, series:[{key,label,color,money}], active })
         a time series - one line per active series, soft area under the
         first, gridlines, a hover crosshair with every series' value.
         Money series share the left axis; count series share the right
         one, so revenue and visits can sit in one picture without one
         flattening the other, and without a visits line being read
         against a dollar scale.
     Charts.area(el, { days, series:[{key,label,color}] })
         the same frame, but the series stack: downloads by source.
     Charts.lines(el, { rows:[{x,label}], series:[{key,label,color}] })
         several lines on one count axis, x labelled from rows - opens
         per app per week.
     Charts.spark(el, values, color)         a tiny line, no axes
     Charts.bars(el, rows, {label,value,note})   horizontal bars, sorted
     Charts.ring(el, parts)                  a donut of shares

   `days` rows look like [{ day:'2026-09-01', revenue_cents:1200, ... }].
   ===================================================================== */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString(); }
  function usd(c) { return '$' + (Number(c || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function short(v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : String(Math.round(v)); }
  function day(iso) { return new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function ceiling(peak) {
    if (peak <= 0) return 1;
    var step = Math.pow(10, Math.floor(Math.log10(peak)));
    var m = peak / step;
    var nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return nice * step;
  }
  /* a smooth path through points, Catmull-Rom turned into cubic curves */
  function smooth(pts) {
    if (pts.length < 2) return pts.length ? 'M' + pts[0][0] + ' ' + pts[0][1] : '';
    var d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x + ' ' + c1y + ',' + c2x + ' ' + c2y + ',' + p2[0] + ' ' + p2[1];
    }
    return d;
  }
  function frame(el) {
    el.classList.add('chart');
    var svg = el.querySelector('svg'); if (!svg) { svg = document.createElementNS(NS, 'svg'); el.appendChild(svg); }
    var tip = el.querySelector('.tip'); if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip); }
    return { svg: svg, tip: tip, W: el.clientWidth || 800, H: el.clientHeight || 260 };
  }
  function empty(el, f, text) {
    f.svg.setAttribute('viewBox', '0 0 ' + f.W + ' ' + f.H);
    f.svg.innerHTML = '<text x="' + f.W / 2 + '" y="' + f.H / 2 + '" text-anchor="middle" fill="currentColor" opacity=".45" font-size="13">' + esc(text || 'Nothing in this window yet.') + '</text>';
    el.onmousemove = el.onmouseleave = null;
  }
  /* the hover: crosshair, a dot per series, a tooltip with every value */
  function hover(el, f, rows, series, x, yOf, labelOf, valueOf) {
    var cx = f.svg.querySelector('[data-cx]');
    el.onmousemove = function (e) {
      var b = el.getBoundingClientRect();
      var px = (e.clientX - b.left) * (f.W / b.width);
      var i = Math.round((px - x(0)) / ((x(rows.length - 1) - x(0)) / Math.max(1, rows.length - 1)));
      i = Math.max(0, Math.min(rows.length - 1, i));
      cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.setAttribute('opacity', '.35');
      var top = f.H;
      series.forEach(function (s, si) {
        var yy = yOf(i, si);
        var dot = f.svg.querySelector('[data-dot="' + si + '"]');
        if (dot) { dot.setAttribute('cx', x(i)); dot.setAttribute('cy', yy); dot.setAttribute('opacity', '1'); }
        top = Math.min(top, yy);
      });
      f.tip.innerHTML = '<small>' + esc(labelOf(i)) + '</small>' + series.map(function (s, si) {
        return '<span style="color:' + s.color + '">●</span> ' + valueOf(i, si) + ' <span class="k">' + esc(s.label) + '</span>';
      }).join('<br>');
      var lx = x(i) / f.W * b.width;
      f.tip.style.left = Math.min(b.width - 90, Math.max(90, lx)) + 'px';
      f.tip.style.top = Math.max(0, top / f.H * b.height - 8) + 'px';
      f.tip.style.opacity = 1;
    };
    el.onmouseleave = function () { f.tip.style.opacity = 0; cx.setAttribute('opacity', '0'); f.svg.querySelectorAll('[data-dot]').forEach(function (d) { d.setAttribute('opacity', '0'); }); };
  }
  function xMarks(rows, x, labelOf, H, B) {
    var marks = [0, Math.floor((rows.length - 1) / 3), Math.floor(2 * (rows.length - 1) / 3), rows.length - 1].filter(function (v, i, a) { return a.indexOf(v) === i; });
    return marks.map(function (i) {
      var a = i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle';
      return '<text x="' + x(i) + '" y="' + (H - 7) + '" text-anchor="' + a + '" font-size="10" fill="currentColor" opacity=".45">' + esc(labelOf(i)) + '</text>';
    }).join('');
  }

  function line(el, opts) {
    var rows = opts.days || [], series = (opts.series || []).filter(function (s) { return !opts.active || opts.active.indexOf(s.key) >= 0; });
    var f = frame(el), W = f.W, H = f.H;
    if (!rows.length || !series.length) return empty(el, f);
    /* two axes at most: money on the left, counts on the right. When
       only one kind is showing it takes the left axis alone. */
    var hasMoney = series.some(function (s) { return s.money; }), hasCount = series.some(function (s) { return !s.money; });
    var two = hasMoney && hasCount;
    var L = 46, R = two ? 40 : 12, T = 14, B = 26;
    var peak = { money: 0, count: 0 };
    series.forEach(function (s) { rows.forEach(function (r) { var k = s.money ? 'money' : 'count'; peak[k] = Math.max(peak[k], Number(r[s.key]) || 0); }); });
    var scale = { money: ceiling(peak.money), count: ceiling(peak.count) };
    var x = function (i) { return L + (W - L - R) * (rows.length === 1 ? .5 : i / (rows.length - 1)); };
    var y = function (v, s) { return T + (H - T - B) * (1 - v / scale[s.money ? 'money' : 'count']); };
    var leftMoney = hasMoney;                       // the left axis is money whenever money is showing
    var g = '';
    for (var i = 0; i <= 4; i++) {
      var yy = T + (H - T - B) * (i / 4), fr = 1 - i / 4;
      g += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="currentColor" opacity=".08"/>' +
        '<text x="' + (L - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" fill="currentColor" opacity=".45">' + (leftMoney ? '$' + short(scale.money * fr / 100) : short(scale.count * fr)) + '</text>';
      if (two) g += '<text x="' + (W - R + 8) + '" y="' + (yy + 3.5) + '" text-anchor="start" font-size="10" fill="currentColor" opacity=".45">' + short(scale.count * fr) + '</text>';
    }
    g += xMarks(rows, x, function (i) { return day(rows[i].day); }, H, B);
    var defs = '<defs>' + series.map(function (s, si) {
      return '<linearGradient id="cf' + si + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".22"/><stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient>';
    }).join('') + '</defs>';
    var paths = series.map(function (s, si) {
      var pts = rows.map(function (r, i) { return [x(i), y(Number(r[s.key]) || 0, s)]; });
      var d = smooth(pts);
      var area = si === 0 ? '<path d="' + d + ' L' + x(rows.length - 1) + ' ' + (H - B) + ' L' + x(0) + ' ' + (H - B) + ' Z" fill="url(#cf0)"/>' : '';
      return area + '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"' + (s.money || !two ? '' : ' stroke-dasharray="0"') + '/>';
    }).join('');
    var dots = series.map(function (s, si) { return '<circle data-dot="' + si + '" r="4" fill="' + s.color + '" stroke="var(--surface,#fff)" stroke-width="2" opacity="0"/>'; }).join('');
    f.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    f.svg.innerHTML = defs + g + paths + '<line data-cx y1="' + T + '" y2="' + (H - B) + '" stroke="currentColor" opacity="0" stroke-dasharray="3 3"/>' + dots;
    hover(el, f, rows, series, x,
      function (i, si) { return y(Number(rows[i][series[si].key]) || 0, series[si]); },
      function (i) { return day(rows[i].day); },
      function (i, si) { var v = Number(rows[i][series[si].key]) || 0; return series[si].money ? usd(v) : num(v); });
  }

  /* stacked: each series sits on the ones before it, one count axis */
  function area(el, opts) {
    var rows = opts.days || [], series = (opts.series || []).filter(function (s) { return !opts.active || opts.active.indexOf(s.key) >= 0; });
    var f = frame(el), W = f.W, H = f.H;
    if (!rows.length || !series.length) return empty(el, f);
    var L = 46, R = 12, T = 14, B = 26;
    var tops = rows.map(function (r) { var t = 0; series.forEach(function (s) { t += Number(r[s.key]) || 0; }); return t; });
    var scale = ceiling(Math.max.apply(null, tops));
    var x = function (i) { return L + (W - L - R) * (rows.length === 1 ? .5 : i / (rows.length - 1)); };
    var y = function (v) { return T + (H - T - B) * (1 - v / scale); };
    var g = '';
    for (var i = 0; i <= 4; i++) {
      var yy = T + (H - T - B) * (i / 4);
      g += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="currentColor" opacity=".08"/>' +
        '<text x="' + (L - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" fill="currentColor" opacity=".45">' + short(scale * (1 - i / 4)) + '</text>';
    }
    g += xMarks(rows, x, function (i) { return day(rows[i].day); }, H, B);
    /* running totals per row, so series k is drawn between cum[k-1] and cum[k] */
    var cum = rows.map(function () { return [0]; });
    series.forEach(function (s, si) { rows.forEach(function (r, i) { cum[i].push(cum[i][si] + (Number(r[s.key]) || 0)); }); });
    var paths = series.map(function (s, si) {
      var upper = rows.map(function (r, i) { return [x(i), y(cum[i][si + 1])]; });
      var lower = rows.map(function (r, i) { return [x(i), y(cum[i][si])]; }).reverse();
      var d = smooth(upper) + ' L' + lower[0][0] + ' ' + lower[0][1] + smooth(lower).replace(/^M[^C]*/, '') + ' Z';
      return '<path d="' + d + '" fill="' + s.color + '" fill-opacity=".28"/>' +
        '<path d="' + smooth(upper) + '" fill="none" stroke="' + s.color + '" stroke-width="1.8" stroke-linejoin="round"/>';
    }).join('');
    var dots = series.map(function (s, si) { return '<circle data-dot="' + si + '" r="4" fill="' + s.color + '" stroke="var(--surface,#fff)" stroke-width="2" opacity="0"/>'; }).join('');
    f.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    f.svg.innerHTML = g + paths + '<line data-cx y1="' + T + '" y2="' + (H - B) + '" stroke="currentColor" opacity="0" stroke-dasharray="3 3"/>' + dots;
    hover(el, f, rows, series, x,
      function (i, si) { return y(cum[i][si + 1]); },
      function (i) { return day(rows[i].day) + ' · ' + num(tops[i]) + ' in all'; },
      function (i, si) { return num(rows[i][series[si].key] || 0); });
  }

  /* several lines, one count axis, x labels from rows[i].label */
  function lines(el, opts) {
    var rows = opts.rows || [], series = opts.series || [];
    var f = frame(el), W = f.W, H = f.H;
    if (!rows.length || !series.length) return empty(el, f, opts.empty);
    var L = 40, R = 12, T = 14, B = 26, peak = 0;
    series.forEach(function (s) { rows.forEach(function (r) { peak = Math.max(peak, Number(r[s.key]) || 0); }); });
    var scale = ceiling(peak);
    var x = function (i) { return L + (W - L - R) * (rows.length === 1 ? .5 : i / (rows.length - 1)); };
    var y = function (v) { return T + (H - T - B) * (1 - v / scale); };
    var g = '';
    for (var i = 0; i <= 4; i++) {
      var yy = T + (H - T - B) * (i / 4);
      g += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="currentColor" opacity=".08"/>' +
        '<text x="' + (L - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" fill="currentColor" opacity=".45">' + short(scale * (1 - i / 4)) + '</text>';
    }
    g += xMarks(rows, x, function (i) { return rows[i].label; }, H, B);
    var paths = series.map(function (s) {
      return '<path d="' + smooth(rows.map(function (r, i) { return [x(i), y(Number(r[s.key]) || 0)]; })) + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    }).join('');
    var dots = series.map(function (s, si) { return '<circle data-dot="' + si + '" r="4" fill="' + s.color + '" stroke="var(--surface,#fff)" stroke-width="2" opacity="0"/>'; }).join('');
    f.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    f.svg.innerHTML = g + paths + '<line data-cx y1="' + T + '" y2="' + (H - B) + '" stroke="currentColor" opacity="0" stroke-dasharray="3 3"/>' + dots;
    hover(el, f, rows, series, x,
      function (i, si) { return y(Number(rows[i][series[si].key]) || 0); },
      function (i) { return rows[i].label; },
      function (i, si) { return num(rows[i][series[si].key] || 0); });
  }

  function spark(el, values, color) {
    var W = 120, H = 34, n = values.length;
    if (!n) { el.innerHTML = ''; return; }
    var peak = Math.max(1, Math.max.apply(null, values));
    var pts = values.map(function (v, i) { return [n === 1 ? W / 2 : i * W / (n - 1), 3 + (H - 6) * (1 - v / peak)]; });
    var d = smooth(pts);
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="sp' + color.replace(/\W/g, '') + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".25"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#sp' + color.replace(/\W/g, '') + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  function bars(el, rows, o) {
    o = o || {};
    var val = o.value || function (r) { return r.value; }, lab = o.label || function (r) { return r.label; };
    var peak = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Number(val(r)) || 0; })));
    el.innerHTML = rows.length ? rows.map(function (r) {
      var v = Number(val(r)) || 0;
      return '<li><span class="lab">' + esc(lab(r)) + (o.sub ? '<small>' + esc(o.sub(r)) + '</small>' : '') + '</span>' +
        '<span class="num">' + (o.note ? o.note(r) : (o.money ? usd(v) : num(v))) + '</span>' +
        '<span class="track"><i style="width:' + Math.round(v / peak * 100) + '%;background:' + (o.color || 'var(--accent)') + '"></i></span></li>';
    }).join('') : '<li class="empty">' + esc(o.empty || 'Nothing yet.') + '</li>';
  }

  function ring(el, parts, o) {
    o = o || {};
    var total = parts.reduce(function (n, p) { return n + (Number(p.value) || 0); }, 0);
    var r = 40, c = 2 * Math.PI * r, off = 0;
    var arcs = parts.map(function (p) {
      var f = total ? (Number(p.value) || 0) / total : 0;
      var s = '<circle r="' + r + '" cx="50" cy="50" fill="none" stroke="' + p.color + '" stroke-width="12" stroke-dasharray="' + (f * c) + ' ' + (c - f * c) + '" stroke-dashoffset="' + (-off * c) + '" transform="rotate(-90 50 50)"/>';
      off += f; return s;
    }).join('');
    el.innerHTML = '<div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle r="' + r + '" cx="50" cy="50" fill="none" stroke="var(--surface-2)" stroke-width="12"/>' + arcs +
      '<text x="50" y="54" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">' + esc(o.centre != null ? o.centre : num(total)) + '</text></svg>' +
      '<ul>' + parts.map(function (p) {
        var f = total ? Math.round((Number(p.value) || 0) / total * 100) : 0;
        return '<li><i style="background:' + p.color + '"></i>' + esc(p.label) + '<b>' + f + '%</b></li>';
      }).join('') + '</ul></div>';
  }

  /* The one rule for every comparison arrow on every page: a period
     before that is too small to compare against says so, instead of
     "▲ 10980%". For money, `floor` is in cents. */
  function delta(now, before, o) {
    o = o || {};
    now = Number(now) || 0; before = Number(before) || 0;
    var floor = o.floor != null ? o.floor : 20;
    if (before < floor) return '<span class="d">' + (now ? 'too few before to compare' : '—') + '</span>';
    var ch = Math.round((now - before) / before * 100);
    if (!isFinite(ch) || ch === 0) return '<span class="d">level with the period before</span>';
    var good = o.lowerIsBetter ? ch < 0 : ch > 0;
    return '<span class="d ' + (good ? 'up' : 'down') + '">' + (ch > 0 ? '▲' : '▼') + ' ' + Math.abs(ch) + '% vs prior period</span>';
  }

  window.Charts = { line: line, area: area, lines: lines, spark: spark, bars: bars, ring: ring, delta: delta, usd: usd, num: num, short: short };
})();
