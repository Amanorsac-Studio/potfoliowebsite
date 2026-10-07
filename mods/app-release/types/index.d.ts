export type ReleaseRun = { version: string; dir: string; stage: string }

declare module 'claude-code' {
  interface PluginState {
    'app-release': { run: ReleaseRun | null }
  }
}
