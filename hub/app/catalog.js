// The Amanorsac collection as the Hub knows it when it cannot reach the
// website. The live copy is GET https://amanorsac.studio/api/hub/catalog,
// built by worker.js from its own installer table, and it wins whenever
// it answers - so a new build on the website reaches the Hub without a
// Hub release. Keep the two in step when adding an app.
window.HUB_CATALOG = {
  generatedAt: null,
  apps: [
    { id: 'nebulatide', name: 'Nebula Tide', tagline: 'An ocean of sound. In every key.',
      blurb: 'Endless, seamless drone pads recorded in all twelve keys. Deep Current included.',
      kind: 'app', status: 'available', free: true, licensed: false, color: '#4FE3FF',
      page: 'https://amanorsac.studio/nebulatide.html',
      platforms: { windows: { size: '279 MB', version: '1.2.2' }, mac: { size: '289 MB', version: '1.2.2' } } },
    { id: 'pulseroom', name: 'PulseRoom', tagline: 'Every mixing answer. One tempo.',
      blurb: 'Your reference desk: delay and reverb times, EQ cheat sheet, compression, mix chains.',
      kind: 'app', status: 'available', free: true, licensed: false, color: '#3fd3e4',
      page: 'https://amanorsac.studio/pulseroom.html',
      platforms: { windows: { size: '78 MB', version: null }, mac: { size: '171 MB', version: null } } },
    { id: 'secondout', name: 'SecondOut', tagline: 'One master bus. Two independent outputs.',
      blurb: 'Send your master to a second output device, drift-corrected, without touching the mix.',
      kind: 'plugin', status: 'available', free: false, licensed: true, color: '#3fe083',
      page: 'https://amanorsac.studio/secondout.html',
      platforms: { windows: { size: null, version: '1.3.0' } } },
    { id: 'performlive', name: 'PerformLive', tagline: 'Live performance, perfected.',
      blurb: 'Stem decks, scenes and warm pads laid out for a service.',
      kind: 'app', status: 'coming_soon', free: false, licensed: true, color: '#7B7DF7',
      page: 'https://amanorsac.studio/performlive.html', platforms: {} },
    { id: 'harmoniemd', name: 'HarmonieMD', tagline: 'Share. Simplify. Serve.',
      blurb: 'The choir rehearsal studio: parts, setlists and a multi-track editor.',
      kind: 'app', status: 'coming_soon', free: false, licensed: true, color: '#3ED598',
      page: 'https://amanorsac.studio/harmoniemd.html', platforms: {} },
  ],
};
