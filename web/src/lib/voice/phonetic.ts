export interface DoubleMetaphoneCode {
  primary: string;
  secondary: string;
}

function isVowel(char: string): boolean {
  return char !== '' && 'AEIOUY'.includes(char);
}

function charAt(word: string, index: number): string {
  return index >= 0 && index < word.length ? word[index] : '';
}

export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

const SIMPLE_CONSONANTS: Record<string, string> = {
  B: 'P',
  F: 'F',
  J: 'J',
  K: 'K',
  L: 'L',
  M: 'M',
  N: 'N',
  Q: 'K',
  R: 'R',
  V: 'F',
  Z: 'S',
};

export function doubleMetaphone(input: string, maxLength = 6): DoubleMetaphoneCode {
  const word = normalizeToken(input).toUpperCase();
  if (!word) return { primary: '', secondary: '' };

  let index = /^(GN|KN|PN|WR|PS)/.test(word) ? 1 : 0;
  let primary = '';
  let secondary = '';

  const append = (code: string, alt: string = code) => {
    primary += code;
    secondary += alt;
  };

  while (index < word.length && (primary.length < maxLength || secondary.length < maxLength)) {
    const ch = word[index];

    if (isVowel(ch)) {
      if (index === 0) append('A');
      index += 1;
      continue;
    }

    const simpleCode = SIMPLE_CONSONANTS[ch];
    if (simpleCode) {
      append(simpleCode);
      index += charAt(word, index + 1) === ch ? 2 : 1;
      continue;
    }

    switch (ch) {
      case 'C':
        if (charAt(word, index + 1) === 'H') {
          if (word.startsWith('SCH', index - 1)) {
            append('K');
          } else {
            append('X', 'K');
          }
          index += 2;
        } else if (charAt(word, index + 1) === 'K') {
          append('K');
          index += 2;
        } else if ('IEY'.includes(charAt(word, index + 1))) {
          append('S');
          index += 2;
        } else {
          append('K');
          index += charAt(word, index + 1) === 'C' ? 2 : 1;
        }
        break;
      case 'D':
        if (charAt(word, index + 1) === 'G' && 'IEY'.includes(charAt(word, index + 2))) {
          append('J');
          index += 3;
        } else {
          append('T');
          index += charAt(word, index + 1) === 'D' ? 2 : 1;
        }
        break;
      case 'G':
        if (charAt(word, index + 1) === 'H') {
          const after = charAt(word, index + 2);
          if (index === 0) {
            append('K');
          } else if (after === '' || isVowel(after)) {
            append('F');
          }
          index += 2;
        } else if (charAt(word, index + 1) === 'N') {
          index += 1;
        } else if ('IEY'.includes(charAt(word, index + 1))) {
          append('J', 'K');
          index += 2;
        } else {
          append('K');
          index += charAt(word, index + 1) === 'G' ? 2 : 1;
        }
        break;
      case 'H': {
        const before = charAt(word, index - 1);
        const after = charAt(word, index + 1);
        if (index === 0 || (isVowel(before) && isVowel(after))) {
          append('H');
        }
        index += 1;
        break;
      }
      case 'P':
        if (charAt(word, index + 1) === 'H') {
          append('F');
          index += 2;
        } else {
          append('P');
          index += charAt(word, index + 1) === 'P' ? 2 : 1;
        }
        break;
      case 'S':
        if (charAt(word, index + 1) === 'H') {
          append('X');
          index += 2;
        } else if (word.startsWith('SCH', index)) {
          append('K');
          index += 3;
        } else if (charAt(word, index + 1) === 'C' && 'IEY'.includes(charAt(word, index + 2))) {
          append('S');
          index += 3;
        } else {
          append('S');
          index += charAt(word, index + 1) === 'S' ? 2 : 1;
        }
        break;
      case 'T':
        if (charAt(word, index + 1) === 'H') {
          append('0');
          index += 2;
        } else if (word.startsWith('TCH', index)) {
          append('X');
          index += 3;
        } else {
          append('T');
          index += charAt(word, index + 1) === 'T' ? 2 : 1;
        }
        break;
      case 'W':
        if (isVowel(charAt(word, index + 1))) {
          append('W');
        }
        index += 1;
        break;
      case 'X':
        append(index === 0 ? 'S' : 'KS');
        index += 1;
        break;
      default:
        index += 1;
        break;
    }
  }

  return { primary: primary.slice(0, maxLength), secondary: secondary.slice(0, maxLength) };
}

export function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(
        Math.min(currentRow[j - 1] + 1, previousRow[j] + 1, previousRow[j - 1] + cost),
      );
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

function similarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

function bestCodeSimilarity(a: DoubleMetaphoneCode, b: DoubleMetaphoneCode): number {
  const pairs: Array<[string, string]> = [
    [a.primary, b.primary],
    [a.primary, b.secondary],
    [a.secondary, b.primary],
    [a.secondary, b.secondary],
  ];

  let best = 0;
  for (const [x, y] of pairs) {
    if (!x || !y) continue;
    best = Math.max(best, similarity(x, y));
  }
  return best;
}

export function phoneticSimilarity(a: string, b: string): number {
  const normalizedA = normalizeToken(a);
  const normalizedB = normalizeToken(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;

  const rawSimilarity = similarity(normalizedA, normalizedB);
  const codeSimilarity = bestCodeSimilarity(
    doubleMetaphone(normalizedA),
    doubleMetaphone(normalizedB),
  );

  return Math.max(rawSimilarity, codeSimilarity);
}
