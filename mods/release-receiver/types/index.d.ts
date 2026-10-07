export type ReleaseRef = { app: string; version: string; path: string }

declare module 'claude-code' {
  interface PluginState {
    'release-receiver': { waiting: ReleaseRef[]; current: ReleaseRef | null }
  }
}
