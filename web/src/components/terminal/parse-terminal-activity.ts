interface TerminalActivityParsed {
  titles: string[];
  hasBell: boolean;
}

const BEL = '\x07';
const ESC = '\x1b';

/**
 * Parse raw terminal data for OSC title changes and standalone bell characters.
 *
 * Extracts titles from OSC 0 and OSC 2 sequences (both BEL and ST terminators).
 * Detects standalone bell characters that are NOT part of an OSC sequence.
 */
export function parseTerminalActivity(data: string): TerminalActivityParsed {
  const titles: string[] = [];
  let hasBell = false;
  let i = 0;

  while (i < data.length) {
    if (data[i] === ESC && data[i + 1] === ']') {
      // Start of OSC sequence: ESC ]
      const oscStart = i + 2;

      // Find terminator first: BEL (\x07) or ST (ESC \)
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
        // Unterminated OSC — skip past the ESC ]
        i = oscStart;
        continue;
      }

      // Find semicolon within the bounded OSC body
      const body = data.slice(oscStart, endIdx);
      const semiPos = body.indexOf(';');
      if (semiPos !== -1) {
        const oscParam = body.slice(0, semiPos);
        if (oscParam === '0' || oscParam === '2') {
          titles.push(body.slice(semiPos + 1));
        }
      }

      i = endIdx + terminatorLen;
    } else if (data[i] === BEL) {
      hasBell = true;
      i++;
    } else {
      i++;
    }
  }

  return { titles, hasBell };
}
