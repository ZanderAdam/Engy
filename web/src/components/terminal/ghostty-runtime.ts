import { Ghostty } from 'ghostty-web';

// Copied into public/ by the `sync:wasm` script. Loading from a static URL
// rather than ghostty-web's own init() keeps the WASM off the bundler's asset
// graph — init() resolves it via `new URL(..., import.meta.url)`, which depends
// on Next emitting a node_modules binary that neither dev nor build is asked to.
const WASM_URL = '/ghostty-vt.wasm';

let loading: Promise<Ghostty> | null = null;

/** One WASM instance shared by every terminal in the tab. */
export function loadGhostty(): Promise<Ghostty> {
  loading ??= Ghostty.load(WASM_URL).catch((error: unknown) => {
    // Don't cache the failure — the next terminal opened should try again.
    loading = null;
    throw error;
  });
  return loading;
}
