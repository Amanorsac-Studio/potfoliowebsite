/* =====================================================================
   A creator adds a song: /store/new  (and /store/new?v=<id> to carry on)

   Five parts on one page, saved as they go so a closed tab loses
   nothing:

     1  the song       title, what kind of version, key, tempo, video
     2  the cover      one picture
     3  the tracks     ten WAVs into their slots, checked in the
                       browser before a byte moves: same length, same
                       sample rate, WAV and nothing else
     4  the sections   play the Guide, tap Verse / Chorus / Bridge as
                       they arrive; bars are worked out from the tempo
     5  price, submit  rent and buy; then it goes to the studio

   Files go browser → Worker → R2 in fifty-megabyte parts, two at a
   time, each part retried on its own. The Worker checks the session
   on every part; see storeRoutes in worker.js.
   ===================================================================== */
(function () {
  'use strict';
  var S = window.Store;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = S.esc;
  var KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
  var SECTION_NAMES = ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Bridge', 'Interlude', 'Tag', 'Vamp', 'Out'];
  var LABELS = ['Original', 'Live', 'Arrangement', 'Medley', 'Cover'];

  var me = null, version = null, song = null, tracks = {}, sections = [], localFiles = {};

  function sb() { return S.sb(); }
  async function token() {
    var r = await sb().auth.getSession();
    return r && r.data && r.data.session ? r.data.session.access_token : null;
  }
  async function api(path, body, method) {
    var t = await token();
    var r = await fetch(path, { method: method || 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status));
    return j;
  }
  function say(el, text, kind) { el.hidden = !text; el.className = 'msg ' + (kind || ''); el.textContent = text || ''; }
  function slugify(s) { return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  function ytId(v) {
    v = String(v || '').trim();
    if (!v) return null;
    var m = v.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/) || v.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : null;
  }
  function fmt(sec) { sec = Math.max(0, sec || 0); var m = Math.floor(sec / 60); return m + ':' + ('0' + (sec - m * 60).toFixed(1)).slice(-4); }
  function mb(n) { return n >= 1024 * 1024 * 1024 ? (n / 1073741824).toFixed(2) + ' GB' : Math.round(n / 1048576) + ' MB'; }

  /* ---------------- the WAV header ----------------
     Enough of RIFF to know what the file is without decoding it: the
     fmt chunk for rate and channels, the data chunk for length. */
  async function wavInfo(file) {
    var head = new DataView(await file.slice(0, 1024 * 64).arrayBuffer());
    var tag = function (o) { return String.fromCharCode(head.getUint8(o), head.getUint8(o + 1), head.getUint8(o + 2), head.getUint8(o + 3)); };
    if (head.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
    var p = 12, fmt = null, dataBytes = null;
    while (p + 8 <= head.byteLength) {
      var id = tag(p), size = head.getUint32(p + 4, true);
      if (id === 'fmt ') {
        fmt = { format: head.getUint16(p + 8, true), channels: head.getUint16(p + 10, true), rate: head.getUint32(p + 12, true),
                bits: head.getUint16(p + 22, true) };
      } else if (id === 'data') { dataBytes = size === 0xFFFFFFFF || size === 0 ? file.size - (p + 8) : size; break; }
      p += 8 + size + (size % 2);
    }
    if (!fmt) throw new Error('No format chunk in this WAV.');
    if (fmt.format !== 1 && fmt.format !== 3 && fmt.format !== 0xFFFE) throw new Error('Compressed WAV is not accepted; export PCM.');
    if ([44100, 48000, 88200, 96000].indexOf(fmt.rate) < 0) throw new Error('Sample rate ' + fmt.rate + ' Hz - use 44.1 or 48 kHz.');
    var bytesPerSec = fmt.rate * fmt.channels * (fmt.bits / 8);
    var duration = dataBytes && bytesPerSec ? dataBytes / bytesPerSec : null;
    return { rate: fmt.rate, channels: fmt.channels, bits: fmt.bits, duration: duration };
  }

  /* ---------------- upload, in parts ---------------- */
  function putPart(url, blob, t, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('PUT', url);
      x.setRequestHeader('Authorization', 'Bearer ' + t);
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () {
        var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300 && j.etag) resolve(j); else reject(new Error(j.message || j.error || ('part failed, HTTP ' + x.status)));
      };
      x.onerror = function () { reject(new Error('network error')); };
      x.send(blob);
    });
  }
  async function upload(file, slot, meta, onProgress) {
    var t = await token();
    var start = await api('/api/store/upload/start', { version: version.id, slot: slot, type: file.type || 'application/octet-stream' });
    var size = start.part_bytes, n = Math.max(1, Math.ceil(file.size / size));
    var done = new Array(n).fill(0), parts = new Array(n);
    var report = function () { if (onProgress) onProgress(done.reduce(function (a, b) { return a + b; }, 0) / n); };
    var next = 0;
    async function worker() {
      while (next < n) {
        var i = next++;
        var blob = file.slice(i * size, Math.min(file.size, (i + 1) * size));
        var url = '/api/store/upload/part?key=' + encodeURIComponent(start.key) + '&id=' + encodeURIComponent(start.upload_id) + '&n=' + (i + 1);
        var tries = 0;
        for (;;) {
          try {
            var r = await putPart(url, blob, t, function (f) { done[i] = f; report(); });
            parts[i] = { part_number: r.part_number, etag: r.etag }; done[i] = 1; report(); break;
          } catch (e) {
            if (++tries >= 4) { try { await api('/api/store/upload/abort', { key: start.key, upload_id: start.upload_id }); } catch (x) {} throw e; }
            await new Promise(function (ok) { setTimeout(ok, 1500 * tries); });
          }
        }
      }
    }
    await Promise.all([worker(), worker()]);
    return api('/api/store/upload/complete', Object.assign({ key: start.key, upload_id: start.upload_id, parts: parts }, meta || {}));
  }

  /* ---------------- 1 · the song ---------------- */
  function drawSong() {
    var v = version || {}, s = song || {};
    $('#song').innerHTML =
      '<div class="row"><label>Title <span class="req">*</span><input name="title" required maxlength="120" value="' + esc(s.title || '') + '"></label>' +
      '<label>This version is<select name="label">' + LABELS.map(function (l) { return '<option' + ((v.label || 'Original') === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="row"><label>Writers <span class="hint">who wrote it</span><input name="writers" maxlength="200" value="' + esc(s.writers || '') + '"></label>' +
      '<label>Featuring <span class="hint">(if anyone)</span><input name="feat" maxlength="120" value="' + esc(v.feat || '') + '"></label></div>' +
      '<div class="row"><label>Key <span class="req">*</span><select name="key"><option value="">Choose</option>' +
        KEYS.map(function (k) { return '<optgroup label="' + k + '"><option' + (v.key === k ? ' selected' : '') + '>' + k + '</option><option' + (v.key === k + 'm' ? ' selected' : '') + '>' + k + 'm</option></optgroup>'; }).join('') + '</select></label>' +
      '<label>Tempo, BPM <span class="req">*</span><input name="bpm" type="number" min="30" max="300" step="0.01" value="' + esc(v.bpm || '') + '"></label></div>' +
      '<div class="row"><label>Time signature<select name="time_sig">' + ['4/4', '3/4', '6/8', '12/8', '2/4'].map(function (t) { return '<option' + ((v.time_sig || '4/4') === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
      '<label>Year<input name="year" type="number" min="1900" max="2100" value="' + esc(v.year || '') + '"></label></div>' +
      '<div class="row"><label>Album <span class="hint">(if any)</span><input name="album" maxlength="120" value="' + esc(v.album || '') + '"></label>' +
      '<label>YouTube link <span class="hint">the song\'s own video</span><input name="youtube" placeholder="https://www.youtube.com/watch?v=…" value="' + esc(v.youtube ? 'https://www.youtube.com/watch?v=' + v.youtube : '') + '"></label></div>' +
      '<label class="consent" ' + ((v.label || 'Original') === 'Original' || v.label === 'Live' ? 'hidden' : '') + '>Whose song is this, and how are the rights cleared? <span class="req">*</span><span class="hint">A version of someone else\'s song goes on the shelf only with their say-so. Say who wrote it and how you have permission.</span><textarea name="consent">' + esc(v.consent || '') + '</textarea></label>' +
      '<div><button class="btn" type="submit">Save</button> <span class="msg" id="song-out" hidden></span></div>';
    $('#song select[name=label]').addEventListener('change', function (e) {
      $('#song .consent').hidden = e.target.value === 'Original' || e.target.value === 'Live';
    });
  }
  async function saveSong(e) {
    e.preventDefault();
    var f = $('#song'), out = $('#song-out'), fd = new FormData(f);
    var label = fd.get('label');
    var yt = ytId(fd.get('youtube'));
    if (fd.get('youtube') && !yt) return say(out, 'That does not look like a YouTube link.', 'bad');
    if (label !== 'Original' && label !== 'Live' && !String(fd.get('consent') || '').trim()) return say(out, 'Say how the rights are cleared.', 'bad');
    var fields = {
      label: label, is_original: label === 'Original' || label === 'Live', feat: fd.get('feat') || null,
      key: fd.get('key') || null, bpm: fd.get('bpm') ? Number(fd.get('bpm')) : null, time_sig: fd.get('time_sig'),
      year: fd.get('year') ? Number(fd.get('year')) : null, album: fd.get('album') || null,
      youtube: yt, consent: fd.get('consent') || null
    };
    say(out, 'Saving…');
    try {
      if (!song) {
        var base = slugify(fd.get('title')), slug = base;
        for (var i = 2; i < 30; i++) {
          var hit = await sb().from('store_songs').select('id').eq('slug', slug).maybeSingle();
          if (!hit.data) break;
          slug = base + '-' + i;
        }
        song = S.need(await sb().from('store_songs').insert({ slug: slug, title: fd.get('title'), writers: fd.get('writers') || null, created_by: me.user_id }).select().single());
        version = S.need(await sb().from('store_versions').insert(Object.assign({ song_id: song.id, creator_slug: me.slug, status: 'draft' }, fields)).select().single());
        history.replaceState(null, '', '/store/new?v=' + version.id);
      } else {
        version = S.need(await sb().from('store_versions').update(fields).eq('id', version.id).select().single());
        if (song.created_by === me.user_id) await sb().from('store_songs').update({ title: fd.get('title'), writers: fd.get('writers') || null }).eq('id', song.id);
      }
      say(out, 'Saved.', 'ok');
      unlock();
    } catch (err) { say(out, err.message, 'bad'); }
  }

  /* ---------------- 2 · the cover ---------------- */
  function drawCover() {
    var box = $('#cover');
    box.innerHTML = '<div class="coverpick"><div class="cover">' + S.cover({ id: version.id, title: song.title, creator: me.slug, creatorName: me.name, art: version.art_key ? '/store-art/' + version.id + '?t=' + Date.now() : null }) + '</div>' +
      '<div><p class="dim">Square, JPG or PNG, up to 5 MB. Without one, the title on your colour is used.</p>' +
      '<label class="btn ghost" style="margin-top:12px">Choose picture<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>' +
      '<div class="bar" hidden><i></i></div><p class="msg" id="cover-out" hidden></p></div></div>';
    $('#cover input[type=file]').addEventListener('change', async function (e) {
      var file = e.target.files[0]; if (!file) return;
      var out = $('#cover-out'), bar = $('#cover .bar');
      if (file.size > 5 * 1024 * 1024) return say(out, 'That picture is over 5 MB.', 'bad');
      bar.hidden = false; say(out, '');
      try {
        await upload(file, 'art', {}, function (f) { $('i', bar).style.width = Math.round(f * 100) + '%'; });
        version.art_key = 'store/' + version.id + '/art';
        drawCover(); say($('#cover-out'), 'Cover saved.', 'ok');
      } catch (err) { say(out, err.message, 'bad'); bar.hidden = true; }
    });
  }

  /* ---------------- 3 · the tracks ---------------- */
  function drawTracks() {
    var box = $('#tracks');
    box.innerHTML = '<p class="dim">WAV files, one per slot, all the same length and starting at the same moment. Click and Guide are the two the band hears in their ears; the other eight are the music. Click, Guide, Drums, Bass, Keys and Backing vocals are needed; Guitars, Piano, Aux piano and Horns can stay empty if the song has none. No lead vocal: the Guide is the voice in the ear.</p>' +
      '<div class="slots">' + S.SLOTS.map(function (slot) {
        var t = tracks[slot];
        var needed = ['click', 'guide', 'drums', 'bass', 'keys', 'bgv'].indexOf(slot) >= 0;
        return '<div class="slotrow" data-slot="' + slot + '"><b>' + esc(S.SLOT_NAMES[slot]) + (needed ? '' : ' <span class="faint" style="font-weight:400;font-size:11px">optional</span>') + '</b>' +
          '<span class="st">' + (t ? mb(t.bytes) + ' · ' + (t.sample_rate ? (t.sample_rate / 1000) + ' kHz' : '') + (t.duration_seconds ? ' · ' + fmt(Number(t.duration_seconds)) : '') : 'Not yet') + '</span>' +
          '<div class="bar" hidden><i></i></div>' +
          '<label class="btn ' + (t ? 'ghost' : '') + ' sm">' + (t ? 'Replace' : 'Choose file') + '<input type="file" accept=".wav,audio/wav,audio/x-wav" hidden></label>' +
          (t ? '<button class="btn quiet sm" data-remove="' + slot + '">Remove</button>' : '') +
          '<p class="msg" hidden></p></div>';
      }).join('') + '</div>';
    $$('#tracks input[type=file]').forEach(function (inp) {
      inp.addEventListener('change', function (e) { var row = e.target.closest('.slotrow'); if (e.target.files[0]) takeTrack(row.getAttribute('data-slot'), e.target.files[0], row); });
    });
    $$('#tracks [data-remove]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var slot = b.getAttribute('data-remove');
        try { await api('/api/store/upload/remove', { version: version.id, slot: slot }); delete tracks[slot]; delete localFiles[slot]; drawTracks(); drawSections(); } catch (e) { alert(e.message); }
      });
    });
  }
  function referenceDuration(exceptSlot) {
    var ds = [];
    Object.keys(tracks).forEach(function (s) { if (s !== exceptSlot && tracks[s].duration_seconds) ds.push(Number(tracks[s].duration_seconds)); });
    return ds.length ? ds[0] : null;
  }
  async function takeTrack(slot, file, row) {
    var out = $('.msg', row), bar = $('.bar', row), st = $('.st', row);
    say(out, '');
    var info;
    try { info = await wavInfo(file); } catch (e) { return say(out, e.message, 'bad'); }
    var ref = referenceDuration(slot);
    if (ref && info.duration && Math.abs(info.duration - ref) > 0.05) {
      return say(out, 'This one is ' + fmt(info.duration) + ' long; the others are ' + fmt(ref) + '. Every track must be the same length.', 'bad');
    }
    var refRate = Object.keys(tracks).map(function (s) { return tracks[s].sample_rate; }).filter(Boolean)[0];
    if (refRate && info.rate !== refRate) return say(out, 'This one is ' + info.rate + ' Hz; the others are ' + refRate + ' Hz.', 'bad');
    bar.hidden = false; st.textContent = 'Uploading ' + mb(file.size) + '…';
    try {
      var r = await upload(file, slot, { sample_rate: info.rate, channels: info.channels, duration: info.duration }, function (f) { $('i', bar).style.width = Math.round(f * 100) + '%'; });
      tracks[slot] = { slot: slot, bytes: r.bytes, sample_rate: info.rate, channels: info.channels, duration_seconds: info.duration };
      localFiles[slot] = file;
      if (info.duration) await sb().from('store_versions').update({ length_seconds: Math.round(info.duration) }).eq('id', version.id);
      drawTracks(); drawSections();
    } catch (e) { say(out, e.message, 'bad'); bar.hidden = true; st.textContent = 'Not yet'; }
  }

  /* ---------------- 4 · the sections ---------------- */
  var audio = null;
  function beatsPerBar() { return parseInt(String(version.time_sig || '4/4').split('/')[0], 10) || 4; }
  function barAt(sec) { return version.bpm ? Math.floor(sec * Number(version.bpm) / 60 / beatsPerBar()) + 1 : null; }
  async function guideSource() {
    if (localFiles.guide) return URL.createObjectURL(localFiles.guide);
    if (!tracks.guide) return null;
    var m = await api('/api/store/manifest/' + version.id, null, 'GET');
    var g = (m.tracks || []).filter(function (t) { return t.slot === 'guide'; })[0];
    return g ? g.url : null;
  }
  function drawSections() {
    var box = $('#sections');
    if (!tracks.guide) { box.innerHTML = '<p class="dim">Upload the Guide track first; the sections are marked against it. This step is optional: the studio checks and finalises the sections in review.</p>'; return; }
    box.innerHTML = '<p class="dim">Optional, but a help: press play and tap a section name the moment it starts. The studio checks and finalises these in review. Bars are worked out from the tempo (' + (version.bpm ? Number(version.bpm) + ' BPM, ' + (version.time_sig || '4/4') : 'set the tempo above') + '). You can fix the numbers by hand.</p>' +
      '<div class="player"><button type="button" id="sec-play" aria-label="Play"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></button><div class="bars" id="sec-bars"></div><span class="t" id="sec-t">0:00.0</span></div>' +
      '<div class="taps">' + SECTION_NAMES.map(function (n) { return '<button type="button" class="btn ghost sm" data-tap="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
      '<table class="tbl sections"><thead><tr><th>#</th><th>Section</th><th>Starts at</th><th>Bar</th><th></th></tr></thead><tbody id="sec-rows"></tbody></table>' +
      '<div style="margin-top:12px"><button class="btn" type="button" id="sec-save">Save sections</button> <span class="msg" id="sec-out" hidden></span></div>';
    var bars = $('#sec-bars'); var html = ''; for (var i = 0; i < 60; i++) html += '<i style="height:' + (20 + (i * 37) % 70) + '%"></i>'; bars.innerHTML = html;
    if (audio) { audio.pause(); audio = null; }
    guideSource().then(function (src) {
      if (!src) return;
      audio = new Audio(src);
      var play = $('#sec-play'), t = $('#sec-t');
      play.addEventListener('click', function () { if (audio.paused) audio.play().catch(function () {}); else audio.pause(); });
      audio.addEventListener('play', function () { play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'; });
      audio.addEventListener('pause', function () { play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>'; });
      audio.addEventListener('timeupdate', function () {
        var f = audio.duration ? audio.currentTime / audio.duration : 0;
        $$('#sec-bars i').forEach(function (b, i, all) { b.classList.toggle('on', i / all.length < f); });
        t.textContent = fmt(audio.currentTime);
      });
      bars.addEventListener('click', function (e) { var r = bars.getBoundingClientRect(); if (audio.duration) audio.currentTime = audio.duration * ((e.clientX - r.left) / r.width); });
    });
    $$('#sections [data-tap]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sec = audio ? audio.currentTime : 0;
        sections.push({ name: b.getAttribute('data-tap'), seconds: Math.round(sec * 1000) / 1000, bar: barAt(sec) });
        sections.sort(function (a, c) { return a.seconds - c.seconds; });
        drawRows();
      });
    });
    $('#sec-save').addEventListener('click', saveSections);
    drawRows();
  }
  function drawRows() {
    $('#sec-rows').innerHTML = sections.map(function (s, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td><input value="' + esc(s.name) + '" data-f="name" data-i="' + i + '"></td>' +
        '<td><input type="number" step="0.001" min="0" value="' + s.seconds + '" data-f="seconds" data-i="' + i + '"></td>' +
        '<td><input type="number" step="1" min="1" value="' + (s.bar || '') + '" data-f="bar" data-i="' + i + '"></td>' +
        '<td><button type="button" class="btn quiet sm" data-del="' + i + '">Remove</button></td></tr>';
    }).join('') || '<tr><td colspan="5" class="dim">No sections yet.</td></tr>';
    $$('#sec-rows input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var s = sections[+inp.getAttribute('data-i')], f = inp.getAttribute('data-f');
        if (f === 'name') s.name = inp.value.trim() || s.name;
        else if (f === 'seconds') { s.seconds = Math.max(0, Number(inp.value) || 0); s.bar = barAt(s.seconds); sections.sort(function (a, c) { return a.seconds - c.seconds; }); drawRows(); }
        else s.bar = Number(inp.value) || null;
      });
    });
    $$('#sec-rows [data-del]').forEach(function (b) { b.addEventListener('click', function () { sections.splice(+b.getAttribute('data-del'), 1); drawRows(); }); });
  }
  async function saveSections() {
    var out = $('#sec-out');
    say(out, 'Saving…');
    try {
      S.need(await sb().from('store_sections').delete().eq('version_id', version.id));
      if (sections.length) {
        S.need(await sb().from('store_sections').insert(sections.map(function (s, i) {
          return { version_id: version.id, position: i + 1, name: s.name, seconds: s.seconds, bar: s.bar };
        })));
      }
      say(out, 'Saved.', 'ok');
    } catch (e) { say(out, e.message, 'bad'); }
  }

  /* ---------------- 5 · price and submit ---------------- */
  function drawPrice() {
    $('#price').innerHTML =
      '<div class="row"><label>Rent for 14 days, USD<input name="rent" type="number" min="0.5" step="0.5" value="' + (version.rent_cents / 100) + '"></label>' +
      '<label>Buy, USD<input name="buy" type="number" min="0.5" step="0.5" value="' + (version.buy_cents / 100) + '"></label></div>' +
      '<div><button class="btn ghost" type="button" id="price-save">Save prices</button> <span class="msg" id="price-out" hidden></span></div>' +
      '<hr style="border:0;border-top:1px solid var(--border);margin:24px 0">' +
      '<p class="dim">When everything above is in, send it to the studio. It is checked once; you will hear back on your dashboard.</p>' +
      '<div style="margin-top:12px"><button class="btn" type="button" id="submit">Submit for review</button> <span class="msg" id="submit-out" hidden></span></div>';
    $('#price-save').addEventListener('click', async function () {
      var out = $('#price-out');
      var rent = Math.round(Number($('#price [name=rent]').value) * 100), buy = Math.round(Number($('#price [name=buy]').value) * 100);
      if (!(rent >= 50 && buy >= 50)) return say(out, 'Fifty cents is the least Stripe will take.', 'bad');
      try { version = S.need(await sb().from('store_versions').update({ rent_cents: rent, buy_cents: buy }).eq('id', version.id).select().single()); say(out, 'Saved.', 'ok'); }
      catch (e) { say(out, e.message, 'bad'); }
    });
    $('#submit').addEventListener('click', async function () {
      var out = $('#submit-out');
      say(out, 'Sending…');
      var r = await sb().rpc('submit_version', { p_version: version.id });
      if (r.error) return say(out, r.error.message, 'bad');
      say(out, 'Submitted. Thank you.', 'ok');
      setTimeout(function () { location.href = '/store/dashboard'; }, 900);
    });
  }

  function unlock() {
    var on = !!version;
    ['cover', 'tracks', 'sections', 'price'].forEach(function (id) { $('#' + id).closest('section').classList.toggle('locked', !on); });
    if (on) { drawCover(); drawTracks(); drawSections(); drawPrice(); }
  }

  /* ---------------- go ---------------- */
  document.addEventListener('DOMContentLoaded', async function () {
    var main = $('#main');
    var u = await S.whoAmI();
    if (!u) { main.innerHTML = '<div class="wrap"><div class="empty">Sign in first.<br><button class="btn" id="si">Sign in</button></div></div>'; $('#si').addEventListener('click', S.signInHere); return; }
    var r = await sb().rpc('my_creator');
    me = r.data && (Array.isArray(r.data) ? r.data[0] : r.data);
    if (!me || !me.slug) { main.innerHTML = '<div class="wrap"><div class="empty">This account is not a creator account yet.<br><a class="btn" href="/store/creators#apply">Apply to sell</a></div></div>'; return; }
    $('#wizard').hidden = false;
    var vid = new URL(location.href).searchParams.get('v');
    if (vid) {
      var vr = await sb().from('store_versions').select('*,store_songs(*)').eq('id', vid).maybeSingle();
      if (vr.data) {
        version = vr.data; song = vr.data.store_songs; delete version.store_songs;
        if (version.status !== 'draft' && version.status !== 'rejected') {
          main.innerHTML = '<div class="wrap"><div class="empty">That one is ' + (version.status === 'submitted' ? 'in review' : 'on the shelf') + ' and cannot be edited. <a href="/store/dashboard">Dashboard</a></div></div>'; return;
        }
        var tr = await sb().from('store_tracks').select('slot,bytes,sample_rate,channels,duration_seconds').eq('version_id', vid);
        (tr.data || []).forEach(function (t) { tracks[t.slot] = t; });
        var sr = await sb().from('store_sections').select('name,seconds,bar').eq('version_id', vid).order('position');
        sections = (sr.data || []).map(function (s) { return { name: s.name, seconds: Number(s.seconds), bar: s.bar }; });
        if (version.review_note) { var n = $('#note'); n.hidden = false; n.className = 'msg bad'; n.textContent = 'Sent back: ' + version.review_note; }
      }
    }
    drawSong();
    $('#song').addEventListener('submit', saveSong);
    unlock();
  });
})();
