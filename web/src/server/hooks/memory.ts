import { shellEscape } from '../../lib/shell';

/**
 * PreCompact/SessionEnd memory capture (TG6). Unlike every other hook event,
 * neither of these two reaches `/hooks/<sessionId>` directly — an `http`
 * handler can only see `transcript_path`, a file on the daemon host that a
 * remote server cannot read (m14 plan, TG6 Completion Summary spike). The
 * `command` hook built here runs entirely on the daemon host: it reads its
 * own stdin payload, tails the transcript, and detaches a nested `claude -p`
 * job with no MCP access and no write tools (see `MEMORY_CAPTURE_DENIED_TOOLS`)
 * that reads the tail and prints a JSON distillation to stdout. The shell
 * script then POSTs that stdout to `/hooks/<sessionId>` as a synthetic
 * `MEMORY_CAPTURE_HOOK_EVENT` event, ingested by `handleMemoryCaptureIngest`
 * (`./memory-capture-ingest.ts` — a separate module because it needs the
 * server-only DB layer, and this file is also imported client-side via
 * `@/lib/agent-types`) — a documented special case in `handleHookRequest`,
 * not a registry entry, because it must still resolve and insert after the
 * originating terminal's live session state is gone (see that function's own
 * comment). `PreCompact`/`SessionEnd` themselves are still never registered
 * as `HookHandler`s — this feature owns their entire lifecycle out of band.
 */

/** FR-MEMORY-310: origin marker, force-set server-side — the model's JSON is never trusted to include it. */
export const MEMORY_CAPTURE_ORIGIN_TAG = 'hook-capture';

/**
 * Synthetic `hook_event_name` the shell script's follow-up POST carries.
 * Distinct from the real `PreCompact`/`SessionEnd` CLI events so nothing
 * else that might reach `/hooks/<sessionId>` can be mistaken for it.
 */
export const MEMORY_CAPTURE_HOOK_EVENT = 'MemoryCapture';

/**
 * A transcript is untrusted input — it holds whatever the session read, web
 * pages and other agents' output included — and this job reads one detached,
 * with nobody watching. The job has no `--mcp-config` at all, so no MCP tool
 * (Engy's ~32 tools included) is reachable regardless of allow/deny lists;
 * the deny list below covers every built-in tool it does not need — only
 * `Read` is required to read the capped transcript. `--allowedTools` cannot
 * substitute for this: it widens the user's existing permissions rather than
 * replacing them, so `Bash` stays live through `~/.claude/settings.json`
 * (measured). Only the deny list actually blocks.
 */
const MEMORY_CAPTURE_DENIED_TOOLS =
  'Bash Edit Write NotebookEdit WebFetch WebSearch Task Agent KillShell BashOutput Glob Grep TodoWrite';

// Bounds the cost driver the spike measured ($0.34 on a near-empty
// transcript, scaling with size): feed only the tail, never the whole file.
export const MEMORY_CAPTURE_TRANSCRIPT_TAIL_BYTES = 60_000;

// Posting the distillation happens inside the already-detached background
// job, off the parent hook's critical path — this only bounds how long that
// background job itself can hang on a stalled connection.
const MEMORY_CAPTURE_POST_TIMEOUT_SECONDS = 10;

const MEMORY_CAPTURE_PROMPT =
  'You are a background memory-capture job for an Engy-managed Claude Code session that just reached hook event $EVENT. ' +
  'Read the session transcript tail at $CAPPED -- JSONL, one entry per line. ' +
  'Apply the engy:session-distill extraction criteria: reflect on the conversation and extract 1 to 3 atomic, non-obvious, durable learnings -- a decision and its rationale, a gotcha found the hard way, a rejected approach -- that the code or commit history would not already reveal. Skip anything routine or already obvious from a diff. ' +
  'Print ONLY a single JSON object to stdout, with no prose before or after it: {"memories":[{"content":"...","type":"capture","tags":["..."]}]}. Structure each memory\'s content as Core claim / What surprised / Connects to / Contradicts, one claim per memory. If nothing is worth remembering, or the transcript cannot be read, print {"memories":[]}.';

/**
 * Bash script for the PreCompact/SessionEnd `command` hook. Runs under an
 * explicitly nested `bash -c` — not whatever shell the CLI invokes `command`
 * hooks with — because `disown` is a bash builtin, and the spike found both
 * `nohup` and `disown` load-bearing for the background job surviving the
 * parent PTY being killed, which is exactly the `SessionEnd` case.
 *
 * The returned string is itself shell-escaped once (for the outer
 * `bash -c '...'` wrapping); the inner script's own single-quoted segments
 * (the `node -e` calls) are written naturally and survive that single
 * escape pass intact.
 */
export function buildMemoryCaptureCommand(hookUrl: string): string {
  const script = [
    `INFO="$(node -e 'const p=JSON.parse(process.env.PAYLOAD||"{}");console.log(p.transcript_path||"");console.log(p.hook_event_name||"");console.log(p.reason||"")' 2>/dev/null)"`,
    `TRANSCRIPT="$(printf '%s\\n' "$INFO" | sed -n 1p)"`,
    `EVENT="$(printf '%s\\n' "$INFO" | sed -n 2p)"`,
    `REASON="$(printf '%s\\n' "$INFO" | sed -n 3p)"`,
    // SessionEnd's 'clear' reason is an explicit user discard (FR-MEMORY-300).
    // PreCompact has no 'reason' field, so this is always true there.
    `if [ "$REASON" != "clear" ] && [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then`,
    `  CAPPED="$(mktemp)"`,
    `  tail -c ${MEMORY_CAPTURE_TRANSCRIPT_TAIL_BYTES} "$TRANSCRIPT" > "$CAPPED" 2>/dev/null || cp "$TRANSCRIPT" "$CAPPED"`,
    // Every fd of the whole backgrounded compound is redirected away from
    // whatever pipes the caller's stdio happens to be (not just claude's own
    // stdout/stderr): a grandchild that keeps an inherited pipe write-end
    // open blocks the caller's read of *its own* stdout until that fd
    // closes, which defeats the detach even though nohup/disown succeed.
    `  { OUT="$(nohup claude -p "${MEMORY_CAPTURE_PROMPT}" --disallowedTools "${MEMORY_CAPTURE_DENIED_TOOLS}" < /dev/null 2>/dev/null)"; rm -f "$CAPPED"; if [ -n "$OUT" ]; then DISTILLATION="$OUT" node -e 'process.stdout.write(JSON.stringify({hook_event_name:"${MEMORY_CAPTURE_HOOK_EVENT}",distillation:process.env.DISTILLATION||""}))' | curl -s -m ${MEMORY_CAPTURE_POST_TIMEOUT_SECONDS} -X POST '${hookUrl}' -H 'Content-Type: application/json' -d @- > /dev/null 2>&1; fi; } < /dev/null > /dev/null 2>&1 &`,
    `  disown`,
    `fi`,
    `printf '{}'`,
  ].join('\n');
  return `PAYLOAD="$(cat)" bash -c '${shellEscape(script)}'`;
}
