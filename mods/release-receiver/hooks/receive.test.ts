import { test, expect } from 'claude-code/testing'

/* rclone as the bucket would answer it, stood under the plugin. */
function bucket(dirs: string[], files: Record<string, { Path: string; Size: number }[]>) {
  return (argv: readonly string[]) => {
    const [cmd, ...rest] = argv.slice(1)
    if (cmd === 'lsjson' && rest.includes('--dirs-only')) {
      return JSON.stringify(dirs.map(d => ({ Path: d, IsDir: true })))
    }
    if (cmd === 'lsjson') {
      const target = rest[rest.length - 1]
      const key = Object.keys(files).find(k => target.endsWith(k)) ?? ''
      return JSON.stringify((files[key] ?? []).map(f => ({ ...f, IsDir: false })))
    }
    if (cmd === 'copy') return ''
    throw new Error('unexpected rclone ' + cmd)
  }
}

const complete = [
  { Path: 'handoff.md', Size: 900 }, { Path: 'brag/brag.mp4', Size: 5_000_000 }, { Path: 'brag/brag.jpg', Size: 80_000 },
  { Path: 'brag/share-copy.txt', Size: 200 }, { Path: 'installers/App-1.2.3-Windows.exe', Size: 136_000_000 },
  { Path: 'screenshots/01-home.png', Size: 230_000 },
]

test('lists what is waiting', ($, on) => {
  const answer = bucket(['chordlight88', 'chordlight88/2.0.4', 'nebulatide2', 'nebulatide2/2.0.3'], {})
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: answer(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return (async () => {
    const r = await $.command.run({ command: 'receive', args: 'list' })
    expect(r.text).toContain('chordlight88 2.0.4')
    expect(r.text).toContain('nebulatide2 2.0.3')
  })()
})

test('refuses an incomplete package and pulls nothing', ($, on) => {
  const copies: string[] = []
  const answer = bucket(['app', 'app/1.2.3'], { 'app/1.2.3': complete.filter(f => f.Path !== 'brag/brag.mp4') })
  on('process.run', ($, e) => {
    if (e.argv[1] === 'copy') copies.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: answer(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return (async () => {
    const r = await $.command.run({ command: 'receive', args: 'app 1.2.3' })
    expect(r.text).toContain('not a complete package')
    expect(r.text).toContain('brag/brag.mp4')
    expect(copies).toEqual([])
    expect(r.context ?? []).toEqual([])
  })()
})

test('pulls a complete package and hands the notes to the model', ($, on) => {
  const copies: string[] = []
  const answer = bucket(['app', 'app/1.2.3'], { 'app/1.2.3': complete })
  on('process.run', ($, e) => {
    if (e.argv[1] === 'copy') copies.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: answer(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', ($, e) => ({ value: String(e.path).endsWith('handoff.md') ? '# App 1.2.3\n\n## Release\n- app: app\n' : '' }))
  on('fs.write', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/work/site' }))
  return (async () => {
    const r = await $.command.run({ command: 'receive', args: 'app 1.2.3' })
    expect(copies.length).toBe(1)
    expect(copies[0]).toContain('releases/app/1.2.3')
    expect(r.text).toContain('App-1.2.3-Windows.exe  136000000 bytes')
    const notes = (r.context ?? []).join('\n')
    expect(notes).toContain('docs/release-standard.md §6')
    expect(notes).toContain('Do NOT set a price')
    expect(notes).toContain('# App 1.2.3')
  })()
})
