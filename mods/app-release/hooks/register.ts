import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

/* An app repo's end of the Release Standard (docs/release-standard.md in
   the website repo). /release <version> does the mechanical steps itself:
   it reads the version, checks the GitHub build, fetches its installers
   and sums them, lays the package folder out, and after the model has
   recorded the app, run /brag and written the notes, /release upload
   lists the package back from the bucket and compares bytes before the
   hand-off message. The steps that need judgement (recording, the brag,
   the notes) are handed to the model as instructions, with the standard's
   words. It never writes under <app>/ in the bucket: that is the website's. */

type ReleaseRun = { version: string; dir: string; stage: string }
const run = atom({ plugin: 'app-release', key: 'run' } as const, null as ReleaseRun | null)

let app = ''
let root = 'r2:amanorsac-downloads/releases'
let website = ''

async function sh($: EngineInterface, argv: readonly string[], timeoutMs = 120_000) {
  const ran = await $.process.run(argv, { timeoutMs })
  return { ok: ran.exitCode === 0, out: ran.stdout.trim(), err: ran.stderr.trim() }
}

/* The version the code says it is, from the first of these that exists. */
async function codeVersion($: EngineInterface): Promise<string | null> {
  for (const f of ['package.json', 'app.json', 'pubspec.yaml', 'VERSION', 'version.txt']) {
    try {
      const text = await $.fs.read(f)
      const m = text.match(/"version"\s*:\s*"([^"]+)"/) || text.match(/^version:\s*([\w.+-]+)/m) || text.match(/^\s*([\d]+\.[\d]+\.[\d]+)\s*$/m)
      if (m) return m[1].split('+')[0]
    } catch {}
  }
  const tag = await sh($, ['git', 'describe', '--tags', '--abbrev=0'])
  return tag.ok ? tag.out.replace(/^v/, '') : null
}

async function ghRelease($: EngineInterface, version: string) {
  const r = await sh($, ['gh', 'api', `repos/{owner}/{repo}/releases/tags/v${version}`], 60_000)
  if (!r.ok) {
    const r2 = await sh($, ['gh', 'api', `repos/{owner}/{repo}/releases/tags/${version}`], 60_000)
    if (!r2.ok) return null
    return JSON.parse(r2.out) as { assets: { name: string; size: number; browser_download_url: string }[] }
  }
  return JSON.parse(r.out) as { assets: { name: string; size: number; browser_download_url: string }[] }
}

function platformOf(name: string): string | null {
  const n = name.toLowerCase()
  if (/\.(exe|msi)$/.test(n) || /windows|win64|win32/.test(n)) return 'windows'
  if (/arm64|aarch64|apple-?silicon/.test(n) && /\.(dmg|pkg|zip)$/.test(n)) return 'mac-arm64'
  if (/x64|x86_64|intel/.test(n) && /\.(dmg|pkg|zip)$/.test(n)) return 'mac-x64'
  if (/\.(dmg|pkg)$/.test(n) || /mac|darwin|osx/.test(n)) return 'mac'
  if (/\.(apk|aab)$/.test(n) || /android/.test(n)) return 'android'
  if (/\.ipa$/.test(n) || /\bios\b/.test(n)) return 'ios'
  return null
}

export const register: Register = (on, options) => {
  app = String(options.app ?? '')
  const remote = String(options.remote ?? 'r2')
  const bucket = String(options.bucket ?? 'amanorsac-downloads')
  root = `${remote}:${bucket}/releases`
  website = String(options.website_session ?? '')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'release',
      description: 'Release this app to the website: installers, recording, brag video, notes, R2 upload, hand-off',
      argumentHint: '<version> | upload | status',
    })
    return next(e)
  })

  on('command.run', { command: 'release' }, async ($, e) => {
    const [sub, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const state = await read($, run)

    if (!app) return { text: 'app-release: set the "Catalog id" option for this plugin first (the app\'s id in the website\'s catalog.json).' }

    if (!sub || sub === 'status') {
      return { text: state ? `Release ${state.version} in progress, stage: ${state.stage}. Package folder: ${state.dir}/` : 'No release in progress. /release <version> starts one.' }
    }

    /* ---- /release upload: list back, compare, hand off ---- */
    if (sub === 'upload') {
      if (!state) return { text: 'No release in progress. /release <version> first.' }
      const dir = state.dir
      const need = ['handoff.md', 'brag/brag.mp4', 'brag/brag.jpg', 'brag/share-copy.txt']
      const missing: string[] = []
      for (const f of need) { try { await $.fs.stat(`${dir}/${f}`) } catch { missing.push(f) } }
      const shots = (await $.fs.list(`${dir}/screenshots`).catch(() => [])).filter(x => /^\d\d-.+\.png$/.test(x.name))
      if (!shots.length) missing.push('screenshots/NN-<what>.png')
      const inst = (await $.fs.list(`${dir}/installers`).catch(() => []))
      if (!inst.length) missing.push('installers/')
      if (missing.length) return { text: `The package is not complete (release-standard §2). Missing:\n` + missing.map(m => `  ${m}`).join('\n') }

      const dest = `${root}/${app}/${state.version}`
      const cwd = await $.session.cwd()
      const up = await sh($, ['rclone', 'copy', `${cwd}/${dir}`, dest, '--transfers', '4'], 600_000)
      if (!up.ok) return { text: `Upload failed: ${up.err.slice(0, 400)}` }
      const back = await sh($, ['rclone', 'lsjson', '-R', dest], 120_000)
      if (!back.ok) return { text: `Uploaded, but listing ${dest} back failed: ${back.err.slice(0, 300)}` }
      const remoteFiles = new Map((JSON.parse(back.out) as { Path: string; Size: number; IsDir: boolean }[]).filter(f => !f.IsDir).map(f => [f.Path, f.Size]))
      const local = await sh($, ['find', `${cwd}/${dir}`, '-type', 'f', '-printf', '%P\t%s\n'])
      const bad: string[] = []
      for (const line of local.out.split('\n').filter(Boolean)) {
        const [p, size] = line.split('\t')
        if (remoteFiles.get(p) !== Number(size)) bad.push(`${p} (local ${size}, bucket ${remoteFiles.get(p) ?? 'missing'})`)
      }
      if (bad.length) return { text: `Uploaded, but the bucket does not match the package:\n` + bad.map(b => `  ${b}`).join('\n') + '\n\nRun /release upload again.' }

      await update($, run, r => (r ? { ...r, stage: 'uploaded' } : r))
      $.ui.status(`released ${app} ${state.version}: tell the website chat`)
      const msg = `Release package ready: ${app} ${state.version} at ${dest}/ (${remoteFiles.size} files, listed back and byte-matched). Run /receive ${app} ${state.version}.`
      return {
        text: `Package uploaded to ${dest}/ and verified (${remoteFiles.size} files, bytes match).\n\nHand-off message for the website chat:\n\n${msg}`,
        context: [
          `Send the hand-off now. ` + (website ? `The website chat is "${website}": SendMessage({ to: "${website}", message: <the hand-off message above> }).` : `Call ListAgents, find the website repo's chat (potfoliowebsite / amanorsac.studio), and SendMessage it the hand-off message above.`) +
          ` If no website chat is running, say so and give the person the message to paste. Then the release is handed off; the website chat does the rest and asks the person for the price and the go-ahead.`,
        ],
      }
    }

    /* ---- /release <version>: check, fetch, lay out, hand the judgement steps to the model ---- */
    const version = sub.replace(/^v/, '')
    if (!/^\d+\.\d+\.\d+/.test(version)) return { text: `"${sub}" is not a version. /release 2.0.4` }
    const inCode = await codeVersion($)
    if (inCode && inCode !== version) return { text: `The code says ${inCode}, not ${version}. Bump the version and push before releasing.` }

    const rel = await ghRelease($, version)
    if (!rel) return { text: `No GitHub release tagged v${version} (or ${version}). Push the tag, let the build finish, then run /release ${version} again.` }
    const assets = rel.assets.filter(a => platformOf(a.name))
    if (!assets.length) return { text: `The GitHub release v${version} has no installers attached yet. Wait for the build, then run /release ${version} again.` }

    const dir = `release/${version}`
    await sh($, ['mkdir', '-p', `${dir}/installers`, `${dir}/screenshots`, `${dir}/brag`])
    try {
      const excl = await $.fs.read('.git/info/exclude').catch(() => '')
      if (!excl.includes('release/')) await $.fs.write('.git/info/exclude', excl.replace(/\s*$/, '\n') + 'release/\n')
    } catch {}
    const rows: string[] = []
    for (const a of assets) {
      const dl = await sh($, ['gh', 'release', 'download', `v${version}`, '--pattern', a.name, '--dir', `${dir}/installers`, '--clobber'], 600_000)
      if (!dl.ok) {
        const dl2 = await sh($, ['curl', '-fsSL', '-o', `${dir}/installers/${a.name}`, a.browser_download_url], 600_000)
        if (!dl2.ok) return { text: `Could not download ${a.name}: ${dl2.err.slice(0, 200)}` }
      }
      const sum = await sh($, ['sha256sum', `${dir}/installers/${a.name}`])
      const st = await $.fs.stat(`${dir}/installers/${a.name}`)
      rows.push(`| ${platformOf(a.name)} | ${a.name} | ${st.size} | ${sum.ok ? sum.out.split(/\s+/)[0] : '?'} |`)
    }
    const log = await sh($, ['git', 'log', '--oneline', '-40'])
    const today = new Date().toISOString().slice(0, 10)
    const platforms = [...new Set(assets.map(a => platformOf(a.name)))].join(', ')
    const skeleton =
`# ${app} ${version}

## Release
- app: ${app}
- version: ${version}
- date: ${today}
- platforms: ${platforms}
- licensed: <yes|no>
- free: <yes|no>
- price: unchanged | ask

## What's new
- <one line per change a buyer would notice, most important first>

## Email owners
<yes|no>
<one sentence for the email, if yes>

## Installers
| platform | file | bytes | sha256 |
${rows.join('\n')}

## Screenshots
| file | shows |
| 01-<what>.png | <what it shows> |

## Website
- <anything the page must say differently now>
- <anything that MUST NOT appear in public yet>

## Known issues
- <what a buyer might hit, and what to tell them>
`
    await $.fs.write(`${dir}/handoff.md`, skeleton)
    await update($, run, () => ({ version, dir, stage: 'recording' }))
    $.ui.status(`releasing ${app} ${version}: record, brag, notes, then /release upload`)

    return {
      text: `Release ${version}: GitHub build found, ${assets.length} installer${assets.length === 1 ? '' : 's'} downloaded and summed into ${dir}/installers/. A handoff.md skeleton is in ${dir}/.\n\nNext, with the model: record the app, run /brag, finish the notes. Then /release upload.`,
      context: [
        `A release of "${app}" ${version} is laid out in ${dir}/ (installers downloaded and summed, handoff.md is a skeleton with the installer table filled). Finish the package per the Release Standard (docs/release-standard.md in the website repo, §2–§5), in this order, and stop to ask the person wherever a step needs their computer:\n` +
        `1. Record the app. Desktop app: it is built on this computer; launch the built app, capture every main screen to ${dir}/screenshots/NN-<what>.png in the order a new user meets them (real data, nothing private, no developer paths on screen), and record 30–90 s of it in use to ${dir}/recording.mp4 with no narration. If this chat cannot drive the screen, give the person exact steps and file names and wait. Mobile app: copy the store screenshots from the repo instead.\n` +
        `2. Run /brag (brag-slim) on this repo with those screenshots and the recording as its material, output into ${dir}/brag/ (brag.mp4, brag.jpg, share-copy.txt). Every line on screen must be the app's own wording; real screens only.\n` +
        `3. Fill handoff.md: licensed/free/price, What's new from the git log below in a buyer's words, Email owners, the Screenshots table, Website notes, Known issues. Then show it to the person and wait for their read.\n` +
        `4. When they are happy, tell them to run /release upload.\n` +
        `Never upload anything to the bucket's ${app}/ folder; only /release upload writes, and only under releases/.\n\nRecent commits:\n${log.out}`,
      ],
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    const state = await read($, run)
    const text =
      `This app repo releases through /release, per the studio's Release Standard (docs/release-standard.md in the amanorsac.studio website repo): build and test locally, GitHub makes the final installers, /release <version> fetches them and lays out the package, the model records the app and runs /brag and writes handoff.md, /release upload sends the package to R2 under releases/${app || '<app>'}/<version>/ and hands off to the website chat. ` +
      (state ? `A release is in progress: ${state.version}, stage ${state.stage}, folder ${state.dir}/. ` : '') +
      `Never upload to the bucket's <app>/ folder from this repo; the website's receiver owns it.`
    return { sections: [...sections, { id: 'app-release:standard', text, scope: 'session' }] }
  })
}
