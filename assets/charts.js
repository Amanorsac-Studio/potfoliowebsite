/* =====================================================================
   Charts for the studio's own pages. Inline SVG, no library: nothing
   to fetch, nothing to allow in the security policy, and every colour
   is read from the page's tokens so light and dark both work.

     Charts.line(el, { days, series:[{key,label,color,money}], active })
         a time series - one line per active series, soft area under the
         first, gridlines, a hover crosshair with every series' value.
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

  function line(el, opts) {
    var rows = opts.days || [], series = (opts.series || []).filter(function (s) { return !opts.active || opts.active.indexOf(s.key) >= 0; });
    el.classList.add('chart');
    var W = el.clientWidth || 800, H = el.clientHeight || 260;
    var L = 46, R = 12, T = 14, B = 26;
    var svg = el.querySelector('svg'); if (!svg) { svg = document.createElementNS(NS, 'svg'); el.appendChild(svg); }
    var tip = el.querySelector('.tip'); if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip); }
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    if (!rows.length || !series.length) {
      svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" fill="currentColor" opacity=".45" font-size="13">Nothing in this window yet.</text>';
      el.onmousemove = el.onmouseleave = null; return;
    }
    /* each series on its own scale when they are different units, so
       revenue and visits can share one picture without one flattening
       the other. One scale when there is one series. */
    var scales = series.map(function (s) {
      var peak = 0; rows.forEach(function (r) { peak = Math.max(peak, Number(r[s.key]) || 0); });
      return ceiling(peak);
    });
    var x = function (i) { return L + (W - L - R) * (rows.length === 1 ? .5 : i / (rows.length - 1)); };
    var y = function (v, si) { return T + (H - T - B) * (1 - v / scales[si]); };
    var g = '';
    for (var i = 0; i <= 4; i++) {
      var yy = T + (H - T - B) * (i / 4), v = scales[0] * (1 - i / 4);
      g += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="currentColor" opacity=".08"/>' +
        '<text x="' + (L - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" fill="currentColor" opacity=".45">' + (series[0].money ? '$' + short(v / 100) : short(v)) + '</text>';
    }
    var marks = [0, Math.floor((rows.length - 1) / 3), Math.floor(2 * (rows.length - 1) / 3), rows.length - 1].filter(function (v, i, a) { return a.indexOf(v) === i; });
    marks.forEach(function (i) {
      var a = i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle';
      g += '<text x="' + x(i) + '" y="' + (H - 7) + '" text-anchor="' + a + '" font-size="10" fill="currentColor" opacity=".45">' + esc(day(rows[i].day)) + '</text>';
    });
    var defs = '<defs>' + series.map(function (s, si) {
      return '<linearGradient id="cf' + si + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".22"/><stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient>';
    }).join('') + '</defs>';
    var paths = series.map(function (s, si) {
      var pts = rows.map(function (r, i) { return [x(i), y(Number(r[s.key]) || 0, si)]; });
      var d = smooth(pts);
      var area = si === 0 ? '<path d="' + d + ' L' + x(rows.length - 1) + ' ' + (H - B) + ' L' + x(0) + ' ' + (H - B) + ' Z" fill="url(#cf0)"/>' : '';
      return area + '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
    }).join('');
    var dots = series.map(function (s, si) { return '<circle data-dot="' + si + '" r="4" fill="' + s.color + '" stroke="var(--surface,#fff)" stroke-width="2" opacity="0"/>'; }).join('');
    svg.innerHTML = defs + g + paths + '<line data-cx y1="' + T + '" y2="' + (H - B) + '" stroke="currentColor" opacity="0" stroke-dasharray="3 3"/>' + dots;
    var cx = svg.querySelector('[data-cx]');
    el.onmousemove = function (e) {
      var b = el.getBoundingClientRect();
      var px = (e.clientX - b.left) * (W / b.width);
      var i = Math.round((px - L) / ((W - L - R) / Math.max(1, rows.length - 1)));
      i = Math.max(0, Math.min(rows.length - 1, i));
      cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.setAttribute('opacity', '.35');
      var top = H;
      series.forEach(function (s, si) {
        var v = Number(rows[i][s.key]) || 0, yy = y(v, si);
        var dot = svg.querySelector('[data-dot="' + si + '"]');
        dot.setAttribute('cx', x(i)); dot.setAttribute('cy', yy); dot.setAttribute('opacity', '1');
        top = Math.min(top, yy);
      });
      tip.innerHTML = '<small>' + esc(day(rows[i].day)) + '</small>' + series.map(function (s) {
        var v = Number(rows[i][s.key]) || 0;
        return '<span style="color:' + s.color + '">●</span> ' + (s.money ? usd(v) : num(v)) + ' <span class="k">' + esc(s.label) + '</span>';
      }).join('<br>');
      var lx = x(i) / W * b.width;
      tip.style.left = Math.min(b.width - 90, Math.max(90, lx)) + 'px';
      tip.style.top = Math.max(0, top / H * b.height - 8) + 'px';
      tip.style.opacity = 1;
    };
    el.onmouseleave = function () { tip.style.opacity = 0; cx.setAttribute('opacity', '0'); svg.querySelectorAll('[data-dot]').forEach(function (d) { d.setAttribute('opacity', '0'); }); };
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
    }).join('') : '<li class="empty">Nothing yet.</li>';
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

  window.Charts = { line: line, spark: spark, bars: bars, ring: ring, usd: usd, num: num, short: short };
})();
