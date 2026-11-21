export type EngySession = { hookUrl: string | null; memoryCapture: boolean };

declare module 'claude-code' {
  interface PluginState {
    engy: { session: EngySession };
  }
}
