import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

/* The website's end of docs/release-standard.md.

   An app repo's /release puts a package under releases/<app>/<version>/ in
   the R2 bucket and tells this chat. Here, /receive lists what is waiting,
   checks a package against §2 of the standard, pulls it into
   release-inbox/<app>/<version>/ (ignored by git), and hands the model the
   hand-off notes with the standard's §6 as its instructions. The model does
   the website work; this module never writes to the catalog, the bucket's
   <app>/ folders, or main. */

const MUST = ['handoff.md', 'brag/brag.mp4', 'brag/brag.jpg', 'brag/share-copy.txt']

type ReleaseRef = { app: string; version: string; path: string }

const waiting = atom({ plugin: 'release-receiver', key: 'waiting' } as const, [] as readonly ReleaseRef[])
const current = atom({ plugin: 'release-receiver', key: 'current' } as const, null as ReleaseRef | null)

let root = 'r2:amanorsac-downloads/releases'
let bucket = 'amanorsac-downloads'

async function rclone($: EngineInterface, args: readonly string[], timeoutMs = 120_000) {
  const ran = await $.process.run(['rclone', ...args], { timeoutMs })
  if (ran.exitCode !== 0) throw new Error(`rclone ${args[0]} failed: ${ran.stderr.trim().slice(0, 300)}`)
  return ran.stdout
}

/* releases/<app>/<version>/ as { app, version, path }. */
async function scan($: EngineInterface): Promise<ReleaseRef[]> {
  const out = await rclone($, ['lsjson', '--dirs-only', '-R', '--max-depth', '2', root])
  const dirs = (JSON.parse(out) as { Path: string; IsDir: boolean }[]).filter(d => d.IsDir && d.Path.includes('/'))
  return dirs.map(d => {
    const [app, version] = d.Path.split('/')
    return { app, version, path: `${root}/${d.Path}` }
  })
}

export const register: Register = (on, options) => {
  const remote = String(options.remote ?? 'r2')
  bucket = String(options.bucket ?? 'amanorsac-downloads')
  root = `${remote}:${bucket}/releases`

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'receive',
      description: 'Pick up an app release package from R2 and hand its notes to the model',
      argumentHint: '[app version] | list',
    })
    const started = await next(e)
    if (!e.isInteractive) return started
    // A look at the bucket on start, so a release that landed while this chat
    // was closed is on the status line before anyone asks.
    void (async () => {
      try {
        const found = await scan($)
        await update($, waiting, () => found)
        if (found.length) {
          $.ui.status(`${found.length} release${found.length === 1 ? '' : 's'} waiting: /receive`)
          $.ui.toast(`Release${found.length === 1 ? '' : 's'} waiting in R2: ${found.map(r => `${r.app} ${r.version}`).join(', ')}. Run /receive.`)
        }
      } catch (err) {
        $.ui.log(`release-receiver: could not list ${root}: ${(err as Error).message}`, { to: 'debug' })
      }
    })()
    return started
  })

  on('command.run', { command: 'receive' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/).filter(Boolean)

    let found: ReleaseRef[]
    try { found = await scan($) }
    catch (err) { return { text: `Could not list ${root}: ${(err as Error).message}` } }
    await update($, waiting, () => found)

    if (!found.length) {
      $.ui.status(undefined)
      return { text: `Nothing waiting under ${root}.` }
    }
    if (!args.length || args[0] === 'list') {
      return { text: 'Waiting in R2:\n' + found.map(r => `  ${r.app} ${r.version}`).join('\n') + '\n\nRun /receive <app> <version> to pick one up.' }
    }
    const [app, version] = args
    const ref = found.find(r => r.app === app && r.version === version)
    if (!ref) return { text: `No releases/${app}/${version}/ in the bucket. /receive list shows what is there.` }

    /* §2 of the standard: what MUST be in the package. */
    const listing = JSON.parse(await rclone($, ['lsjson', '-R', ref.path])) as { Path: string; Size: number; IsDir: boolean }[]
    const files = listing.filter(f => !f.IsDir)
    const names = new Set(files.map(f => f.Path))
    const missing = MUST.filter(m => !names.has(m))
    const installers = files.filter(f => f.Path.startsWith('installers/'))
    const shots = files.filter(f => /^screenshots\/\d\d-.+\.png$/.test(f.Path))
    if (!installers.length) missing.push('installers/ (at least one)')
    if (!shots.length) missing.push('screenshots/NN-<what>.png (at least one)')
    if (missing.length) {
      return { text: `releases/${app}/${version}/ is not a complete package (docs/release-standard.md §2). Missing:\n` + missing.map(m => `  ${m}`).join('\n') + '\n\nNothing was pulled down. Ask the app repo to finish the package and run /receive again.' }
    }

    /* Pull it into the inbox, which .git/info/exclude keeps out of commits. */
    const cwd = await $.session.cwd()
    const inbox = `release-inbox/${app}/${version}`
    try {
      const excl = await $.fs.read('.git/info/exclude').catch(() => '')
      if (!excl.includes('release-inbox/')) await $.fs.write('.git/info/exclude', excl.replace(/\s*$/, '\n') + 'release-inbox/\n')
    } catch {}
    try { await rclone($, ['copy', ref.path, `${cwd}/${inbox}`, '--transfers', '4'], 600_000) }
    catch (err) { return { text: `Pulling the package failed: ${(err as Error).message}` } }

    const handoff = await $.fs.read(`${inbox}/handoff.md`)
    const sizes = installers.map(f => `  ${f.Path.replace('installers/', '')}  ${f.Size} bytes`).join('\n')
    await update($, current, () => ref)
    await update($, waiting, list => list.filter(r => r.path !== ref.path))
    $.ui.status(`receiving ${app} ${version}`)

    const text =
      `Pulled releases/${app}/${version}/ into ${inbox}/ (${files.length} files).\n\nInstallers in the package:\n${sizes}\n\nThe hand-off notes follow for the model. Nothing on the site has changed yet.`
    const context = [
      `A release package for "${app}" version ${version} is in ${inbox}/ and its notes are below. Follow docs/release-standard.md §6 exactly, in this order:\n` +
      `1. Read the notes. If anything in §2 is missing or the notes are incomplete, stop and say what is missing.\n` +
      `2. Copy each installer to its catalog name under ${bucket}/${app}/ with rclone copyto (never overwrite a name the catalog already serves; new names carry the version), then rclone lsl that folder and compare byte counts to the package's. Only after the listing confirms them may catalog.json change; keep the previous keys as alt_keys.\n` +
      `3. Convert screenshots to webp at 1600 and 800 wide into images/apps/${app}/; copy brag/brag.mp4 to video/${app}-promo.mp4 and put it on the app's page muted, looped, no controls, playing only while on screen, like easystems.html does.\n` +
      `4. Set the catalog version, add a "New in ${version}" section to the page from What's new, add a news entry, and add a notice block only if the notes' "Email owners" says yes.\n` +
      `5. Commit and push the working branch, run the site checks.\n` +
      `6. Report what changed and ask two questions: the price (or confirm unchanged) and the go-ahead. Do NOT set a price, change a status to available, or push main until both are answered.\n` +
      `Secrets rule stands: no service_role, signing or payment secret keys in any file.\n\n--- handoff.md ---\n${handoff}`,
    ]
    return { text, context }
  })

  /* Every website session knows the standard exists and where the inbox is. */
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    const now = await read($, current)
    const queue = await read($, waiting)
    const text =
      `Release handling for this website repo is governed by docs/release-standard.md. App repos put release packages under ${root}/<app>/<version>/; /receive <app> <version> pulls one into release-inbox/ and hands over its notes. ` +
      (now ? `A release is being received now: ${now.app} ${now.version} (release-inbox/${now.app}/${now.version}/). ` : '') +
      (queue.length ? `Waiting in the bucket: ${queue.map(r => `${r.app} ${r.version}`).join(', ')}. ` : '') +
      `Nothing goes live (no price set, no status to available, no push to main) without the person's explicit go-ahead and price.`
    return { sections: [...sections, { id: 'release-receiver:standard', text, scope: 'session' }] }
  })
}
