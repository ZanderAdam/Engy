interface TerminalActivityParsed {
  titles: string[];
  // OSC 9;4;<state>;<progress> progress-state sequences found in this chunk,
  // in order. `'set'` is state 4 (attention/paused), `'clear'` is state 0 —
  // the two states title.ts's hook handlers emit. Other states (1 normal
  // progress, 2 error, 3 indeterminate) aren't emitted by Engy and are
  // ignored here, same as any other unrecognised OSC param.
  attention: Array<'set' | 'clear'>;
}

const BEL = '\x07';
const ESC = '\x1b';

/**
 * Stateful parser that carries incomplete OSC sequences across chunk boundaries.
 *
 * Create one instance per terminal session and call `parse()` for each incoming
 * data chunk. When an OSC sequence is split across chunks the partial tail is
 * buffered and prepended to the next chunk so the sequence is parsed whole.
 */
interface TerminalActivityParser {
  parse(chunk: string): TerminalActivityParsed;
}

export function createTerminalActivityParser(): TerminalActivityParser {
  // Holds the unfinished tail of the previous chunk (at most an open "ESC ] …" fragment)
  let pending = '';

  return {
    parse(chunk: string): TerminalActivityParsed {
      const data = pending + chunk;
      pending = '';

      const titles: string[] = [];
      const attention: Array<'set' | 'clear'> = [];
      let i = 0;

      while (i < data.length) {
        if (data[i] !== ESC || data[i + 1] !== ']') {
          i++;
          continue;
        }

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

        const body = data.slice(oscStart, endIdx);
        const semiPos = body.indexOf(';');
        if (semiPos !== -1) {
          const oscParam = body.slice(0, semiPos);
          if (oscParam === '0' || oscParam === '2') {
            titles.push(body.slice(semiPos + 1));
          } else if (oscParam === '9') {
            const [progressParam, state] = body.slice(semiPos + 1).split(';');
            if (progressParam === '4' && state === '4') attention.push('set');
            else if (progressParam === '4' && state === '0') attention.push('clear');
          }
        }

        i = endIdx + terminatorLen;
      }

      return { titles, attention };
    },
  };
}
