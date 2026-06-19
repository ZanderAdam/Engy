// Daemon copy of the bell/prompt detection from
// web/src/components/terminal/parse-terminal-activity.ts. The logic is
// duplicated rather than shared because @engy/common is types-only. Daemon-side
// we only need bell + input-prompt detection (not OSC titles), but we still
// scan OSC sequences so a BEL that terminates an OSC isn't counted as a
// standalone bell.

interface TerminalActivityParsed {
  hasBell: boolean;
  hasPrompt: boolean;
}

const BEL = '\x07';
const ESC = '\x1b';

// High-precision markers that a program is waiting for user input. Kept
// conservative so normal output (and shell prompts like starship's bare "❯")
// don't trip a false "waiting".
const PROMPT_PATTERNS: readonly RegExp[] = [
  /\((?:y\/n|yes\/no|y\/N|Y\/n|n\/y)\)/i,
  /\[(?:y\/n|yes\/no|y\/N|Y\/n)\]/i,
  /press\s+(?:enter|return|any key)\s+to\s+continue/i,
  /do you want to (?:proceed|continue)/i,
  /❯\s*\d+\.\s/,
];

function detectPrompt(data: string): boolean {
  return PROMPT_PATTERNS.some((re) => re.test(data));
}

export interface TerminalActivityParser {
  parse(chunk: string): TerminalActivityParsed;
}

/**
 * Stateful parser carrying an incomplete OSC tail across chunk boundaries, so a
 * BEL that terminates a split OSC sequence isn't mistaken for a standalone bell.
 * Create one per session.
 */
export function createTerminalActivityParser(): TerminalActivityParser {
  let pending = '';

  return {
    parse(chunk: string): TerminalActivityParsed {
      const data = pending + chunk;
      pending = '';

      let hasBell = false;
      let i = 0;

      while (i < data.length) {
        if (data[i] === ESC && data[i + 1] === ']') {
          const oscStart = i + 2;

          let endIdx = -1;
          let terminatorLen = 0;
          for (let j = oscStart; j < data.length; j++) {
            if (data[j] === BEL) {
              endIdx = j;
              terminatorLen = 1;
              break;
            }
            if (data[j] === ESC && data[j + 1] === '\\') {
              endIdx = j;
              terminatorLen = 2;
              break;
            }
          }

          if (endIdx === -1) {
            pending = data.slice(i);
            break;
          }

          i = endIdx + terminatorLen;
        } else if (data[i] === BEL) {
          hasBell = true;
          i++;
        } else {
          i++;
        }
      }

      return { hasBell, hasPrompt: detectPrompt(data) };
    },
  };
}
